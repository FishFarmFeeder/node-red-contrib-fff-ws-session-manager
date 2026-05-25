# Design: fix-prod-critical

## Architecture Overview

This is a single-file behavioral patch scoped to `ws-session.js` and `ws-session.html` (plus tests, `package.json`, `.github/workflows/ci.yml`, `README.md`, `CHANGELOG.md`). No new modules, no folder restructure, no extracted services — the node remains a self-contained Node-RED contributed node. One new runtime dependency is introduced: `async-mutex` (declared explicitly in `dependencies`, was previously a transitive accident). The unifying design contract is: **every input message flows through `Mutex.runExclusive(async () => { validate → resolve event → mutate sessions → write context → send })` and `done()` is always invoked**, eliminating both the silent-drop class of bugs (`#6`) and the lock-leak-on-early-return class. Five of the eight defects (`#2`, `#3`, `#4`, `#5`, `#8`) are local mutations of existing helpers (`encrypt`, `decrypt`, `getSessions`, `setSessions`, init block, catch handlers); the remaining three touch the HTML template (`#1`, `#5`) and the input handler shape (`#6`). The public message contract (input/output shapes, output port count, error-output behavior) and the storage key are preserved — this is wire-compatible with v0.0.2 consumers.

## Component Diagrams (ASCII)

### Today (v0.0.2)

```
input msg
   │
   ▼
node.on('input', function(msg, send, done))
   │
   ▼
if (contextLock) { node.warn(...); return; }  ◄── done() NEVER called (Bug #6)
   │
   ▼
contextLock = true
   │
   ▼
try {
  validate msg.status / event / sessionId
     │
     ▼
  getSessions()  ──► catch → node.error + updateStatus() ──► getSessions() ──► loop (Bug #8)
     │
     ▼
  switch (event) { connect | disconnect | update | timeout | get_sessions }
     │
     ▼
  setSessions(map)  ──► context.set(key, Map)  ──► serialised as {} on file stores (Bug #4)
                              │
                              └──► encrypt() catch returns plaintext (Bug #2 silent downgrade)
                                     decrypt() catch returns {}        (Bug #3 phantom session)
  send([msg, null])
} finally {
  contextLock = false
  done()
}

Init block (lines 140-145): unconditional setSessions(new Map()) — wipes every restart (Bug #5)
HTML: no #encryption-key-row, no #node-input-preserveSessions (Bug #1, partial Bug #5)
```

### After (v0.0.3)

```
input msg
   │
   ▼
node.on('input', function(msg, send, done))
   │
   ▼
mutex.runExclusive(async () => {
     │
     ▼
   validate msg.status / event / sessionId
     │
     ▼
   getSessions()  ──► catch → node.error + node.status(red) directly (no recurse) (Bug #8)
     │            ──► plain-object branch decodes new wire format    (Bug #4)
     │            ──► entries where decrypt() === null are filtered  (Bug #3)
     │
     ▼
   apply event
     │
     ▼
   setSessions(map) ──► context.set(key, Object.fromEntries(encryptedMap))  (Bug #4)
                              │
                              └──► encrypt() catch RE-THROWS                  (Bug #2)
                                     setSessions catch logs + sends to err out
   send([msg, null])
})
.then(()  => done(),
      err => done(err))     ◄── done() ALWAYS called (Bug #6)

Init block: if (!preserveSessions) setSessions(new Map())                    (Bug #5)
HTML: + #encryption-key-row + #node-input-preserveSessions checkbox           (Bug #1, #5)
HTML defaults: + preserveSessions: {value: true}                              (Bug #5)
Constructor: if (encryptConfig && no credential key) → node.warn + disable    (Bug #1 hardening)
```

## Detailed Design — Per Bug

### Bug #1 — Encryption-key HTML input

**Files**: `ws-session.html`, `ws-session.js` (constructor hardening)

**Approach**: Add a new `<div class="form-row" id="encryption-key-row">` containing a label + `<input type="password" id="node-input-encryptionKey">` placed AFTER the "Encrypt Config" checkbox row (replacing the explanatory HTML comment on line 62). The existing `oneditprepare` jQuery toggle (lines 18-26) already references `#encryption-key-row` — no JS change is needed in the editor script. The `.change()` invocation on line 26 runs once on load, so if the checkbox starts unchecked the row stays hidden; if checked, it shows immediately.

**Skeleton**:

```html
<div class="form-row" id="encryption-key-row">
    <label for="node-input-encryptionKey"><i class="fa fa-key"></i> Encryption Key</label>
    <input type="password" id="node-input-encryptionKey">
</div>
```

**Credentials wiring**: `registerType` in `ws-session.js` line 295 already declares `credentials: { encryptionKey: { type: 'password' } }`. The HTML `<input id="node-input-encryptionKey">` is what Node-RED matches by ID to populate and persist the credential — no additional editor JS is required.

**Credential warning when key missing** (FR-1 no-silent-default scenario): in the `ws-session.js` constructor, after reading credentials, replace the unconditional fallback on line 14 with:

```js
var providedKey = (node.credentials && node.credentials.encryptionKey) || config.encryptionKey;
var encryptionKey;
if (encryptConfig && !providedKey) {
    node.warn('Encryption enabled but no key provided in credentials; disabling encryption for this node');
    encryptConfig = false;     // flip the flag locally so encrypt()/decrypt() short-circuit
    encryptionKey = null;
} else {
    encryptionKey = providedKey || 'default_key_change_me';  // harmless fallback when encryption is off
}
```

This guarantees the hardcoded `'default_key_change_me'` is never used as an actual cipher key in production. When encryption is requested but no key is configured, the node fails safe to plaintext storage with a visible warning rather than silently using a known-bad key.

### Bug #2 — `encrypt()` re-throw

**File**: `ws-session.js` lines 26-39

**Before**:

```js
function encrypt(text) {
    if (!encryptConfig) return text;
    try {
        ...
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        node.error('Encryption failed: ' + error.message);
        return text;   // SILENT DOWNGRADE — plaintext smuggled into ciphertext slot
    }
}
```

**After**:

```js
function encrypt(text) {
    if (!encryptConfig) return text;
    const key = deriveKey(encryptionKey);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(JSON.stringify(text), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}
```

The `try/catch` is removed entirely — any thrown error propagates up to `setSessions`'s own try/catch (lines 127-130), which already logs `Error saving sessions to context: <msg>` and sets a red status. The session write is aborted — `context.set` is never reached, so on-disk state is unchanged. **Behavioral addition**: in `setSessions`'s catch block, additionally route the original message to the error output so downstream Catch nodes / monitoring flows can react:

```js
} catch (error) {
    node.error('Error saving sessions to context: ' + error.message);
    node.status({fill:'red', shape:'ring', text: 'Error saving'});
    // NEW: surface to error output so downstream flows can react
    // (requires plumbing the current msg + send into setSessions, or hoisting the
    //  try/catch to the input handler. Recommend hoisting — see implementation note below.)
}
```

**Implementation note**: cleanest path is to remove `setSessions`'s internal try/catch and let the input handler's `runExclusive` promise rejection handler (`done(err)`) be the single error funnel. Node-RED auto-surfaces `done(err)` to the Catch node infrastructure and logs it. This collapses two error paths into one — consistent with the "single contract" principle of this design.

### Bug #3 — `decrypt()` returns null + filter

**File**: `ws-session.js` `decrypt()` (lines 41-58), `getSessions()` (lines 84-111)

**Contract change**: `decrypt()` returns `null` on any failure (currently `{}`). `getSessions()` iterates stored entries and:

- builds a new Map containing only entries whose `decrypt(session.config)` is non-null
- collects the IDs of entries that returned null
- after the loop, fires `node.error('Decryption failed for sessions: ' + badIds.join(', '))` ONCE (batched) if any bad entries were found — single batched error avoids log spam under widespread corruption (e.g. wrong key after a rotation accidentally lost the credential)
- returns the filtered Map

**`decrypt` after**:

```js
function decrypt(encrypted) {
    if (!encryptConfig) return encrypted;
    try {
        if (typeof encrypted !== 'string') throw new Error('Invalid encrypted payload');
        const parts = encrypted.split(':');
        if (parts.length !== 2) throw new Error('Invalid encrypted format');
        const iv = Buffer.from(parts[0], 'hex');
        const data = parts[1];
        const key = deriveKey(encryptionKey);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    } catch (error) {
        // Caller is responsible for batched node.error and entry omission.
        return null;
    }
}
```

**`getSessions` after** (with Bug #4 plain-object branch folded in):

```js
function getSessions() {
    try {
        var stored = context.get(fullContextKey);
        var decryptedMap = new Map();
        var badIds = [];

        if (stored instanceof Map) {
            // Legacy in-memory path (process still has Map ref from before upgrade)
            for (let [key, session] of stored) {
                var dec = decrypt(session.config);
                if (dec === null) { badIds.push(key); continue; }
                decryptedMap.set(key, { id: session.id, config: dec, connectedAt: session.connectedAt });
            }
        } else if (Array.isArray(stored)) {
            // Legacy array migration (preserved unchanged from v0.0.2)
            stored.forEach(s => decryptedMap.set(s.id, s));
        } else if (stored && typeof stored === 'object') {
            // NEW: plain-object wire format (Bug #4)
            for (var key of Object.keys(stored)) {
                var session = stored[key];
                var dec = decrypt(session.config);
                if (dec === null) { badIds.push(key); continue; }
                decryptedMap.set(key, { id: session.id, config: dec, connectedAt: session.connectedAt });
            }
        }

        if (badIds.length) {
            node.error('Decryption failed for sessions: ' + badIds.join(', '));
        }
        return decryptedMap;
    } catch (error) {
        node.error('Error retrieving sessions from context: ' + error.message);
        node.status({fill:'red', shape:'ring', text: 'Error reading'});  // Bug #8: direct, no recurse
        return new Map();
    }
}
```

### Bug #4 — Map serialization

**File**: `ws-session.js` `setSessions()` (lines 114-131), `getSessions()` (covered above)

**Wire format**: plain JS object keyed by sessionId, values `{ id, config, connectedAt }` where `config` is either:
- the raw plaintext object (when `encryptConfig === false`), or
- the `'<ivHex>:<cipherHex>'` string produced by `encrypt()` (when `encryptConfig === true`).

JSON-safe by construction → survives `JSON.stringify` in `localfilesystem` and any other persistent store that round-trips through JSON.

**`setSessions` change**: build the encrypted Map in memory (same as today), then convert before persisting:

```js
function setSessions(sessions) {
    var encryptedMap = new Map();
    for (let [key, session] of sessions) {
        encryptedMap.set(key, {
            id: session.id,
            config: encrypt(session.config),   // may throw — propagates to runExclusive rejection
            connectedAt: session.connectedAt
        });
    }
    context.set(fullContextKey, Object.fromEntries(encryptedMap));   // NEW: plain object
    updateStatus();
}
```

(Internal try/catch removed per the implementation note in Bug #2 — error funnel is now `runExclusive` rejection → `done(err)`.)

**Note on Map-in-memory legacy path**: kept intact. If an existing v0.0.2 process upgraded in-place still has a Map reference in the global context from before the npm bump, the `instanceof Map` branch in `getSessions` handles it. After the first `setSessions` call in 0.0.3, the stored value is a plain object — all subsequent reads go through the new branch. This is a safe in-place migration with zero user action required.

### Bug #5 — `preserveSessions` config

**Files**: `ws-session.js` constructor (lines 139-145), `ws-session.html`

**JS change** — replace lines 139-145:

```js
// Optionally reset persisted sessions on startup (default: preserve)
var preserveSessions = config.preserveSessions !== false;  // undefined or true → true; only explicit false wipes
if (!preserveSessions) {
    try {
        setSessions(new Map());
    } catch (err) {
        node.error('Failed to reset sessions on start: ' + err.message);
    }
}
```

**HTML changes** — two edits to `ws-session.html`:

1. Add `preserveSessions: {value: true}` to the `defaults` object (line 5-11):

```js
defaults: {
    name: {value:""},
    contextKey: {value:"ws_sessions"},
    scope: {value:"global"},
    prefix: {value:""},
    encryptConfig: {value:false},
    preserveSessions: {value:true}     // NEW
},
```

2. Add a new `<div class="form-row">` between the "Encrypt Config" row (line 58-61) and the new encryption-key row (Bug #1):

```html
<div class="form-row">
    <label for="node-input-preserveSessions"><i class="fa fa-archive"></i> Preserve Sessions</label>
    <input type="checkbox" id="node-input-preserveSessions" title="Keep sessions across Node-RED restarts (default: true)">
</div>
```

**Default semantics**: `config.preserveSessions !== false` treats both `undefined` (old deployed flows pre-0.0.3) and `true` as "preserve". Only an explicit `false` triggers the wipe. This is the safest default — old flows that never set the field automatically migrate to the safer behavior.

### Bug #6 — async-mutex

**Files**: `ws-session.js` (top + input handler), `package.json`

**Require + instantiate** (top of `ws-session.js`, line 2-3):

```js
const crypto = require('crypto');
const { Mutex } = require('async-mutex');
```

And inside `WsSessionNode` (after line 6, alongside `var node = this;`):

```js
var mutex = new Mutex();
```

Per-node-instance mutex (not module-level) — two different `fff-ws-session` nodes in the same flow each get their own queue. This matches v0.0.2's per-instance `contextLock` boolean semantics; the per-`contextKey` cross-node race is intentionally **not** fixed here (deferred to `evolve-session-model`).

**Handler shape** — replace lines 150-292 with:

```js
node.on('input', function(msg, send, done) {
    mutex.runExclusive(async function () {
        // ── validation block (msg.status / event / sessionId) ── unchanged from v0.0.2
        // ── event dispatch (connect | disconnect | update | timeout | get_sessions) ── unchanged
        // ── setSessions(sessions) on the mutating events; send([msg, null])
        // NOTE: replace all early `return;` after sending an error output with `return;`
        //       (still inside the async fn) — runExclusive treats fn-return as success,
        //       which is what we want: done() with no error is correct after a validation
        //       failure since we already sent the error message to output 2.
    }).then(
        function () { done(); },
        function (err) { done(err); }   // err already logged by setSessions OR by re-thrown encrypt()
    );
});
```

**Why `runExclusive` over `acquire`/`release`**: automatic release on throw or rejection. Eliminates the entire class of "lock leaked on early return" bugs. The v0.0.2 try/finally guarded against this for sync code paths, but the new design is async and `runExclusive` is the idiomatic safe wrapper.

**Why pass `done(err)` only on thrown errors, not validation failures**: Node-RED's `done()` contract is "operation completed". A validation failure where we sent an error message to output 2 IS a completed operation from the runtime's perspective — the message was handled. `done(err)` is reserved for unhandled exceptions (encryption failures, context store I/O errors). This matches existing Node-RED ecosystem conventions and avoids double-counting errors in Node-RED's metrics.

**`send` and `done` inside async function**: Node-RED's `node.on('input', (msg, send, done) => ...)` API documents that `send` and `done` are safe to call from any async context including promise callbacks — they are bound to the runtime, not the call stack. Confirmed against Node-RED 3.x docs (the `done` callback was specifically introduced to support async patterns). No special handling needed.

**Test impact** — `test/ws-session.extra.test.js`:

- `should block concurrent access (second call ignored)` currently asserts second message dropped. Spec FR-6 requires both processed. **Rewrite** to assert both connects succeed and `get_sessions` returns `count === 2`.
- `decrypt returns {} on failure` (or equivalent) — rewrite to assert `decrypt() === null` and the malformed entry is omitted from `getSessions()`.
- `decrypt error path logs node.error` — rewrite expected message to the batched form: `'Decryption failed for sessions: <id1>, <id2>'`.

**Out-of-scope clarification**: the mutex is per-node-instance, not per-`contextKey`. Two `fff-ws-session` nodes pointing at the same global context key still race against each other. Fixing that requires a module-level keyed mutex registry, deferred to `evolve-session-model`.

### Bug #8 — Recursion-safe error status

**File**: `ws-session.js` `getSessions()` catch (lines 106-110)

**Before**:

```js
} catch (error) {
    node.error('Error retrieving sessions from context: ' + error.message);
    updateStatus();   // calls getSessions() → if context.get still fails → infinite recursion
    return new Map();
}
```

**After**:

```js
} catch (error) {
    node.error('Error retrieving sessions from context: ' + error.message);
    node.status({fill:'red', shape:'ring', text: 'Error reading'});   // direct, no recurse
    return new Map();
}
```

**Audit of other catch blocks in `ws-session.js`**:

- `setSessions` catch (lines 127-130): already calls `node.status` directly. No change.
- `encrypt` catch (lines 35-38): removed entirely per Bug #2.
- `decrypt` catch (lines 54-57): returns `null` per Bug #3 — no status update from inside `decrypt`, batched by `getSessions` caller.
- Init block catch (lines 143-145): logs only, no status call. No change.

All status updates from error paths are now direct `node.status(...)` calls. The only call site of `updateStatus()` remaining is in the happy path of `setSessions` (after a successful write), which is safe — `getSessions` succeeds there because we just wrote a known-good value.

## Migration Strategy

In-place patch upgrade with zero user action required.

- **Memory-store users**: zero impact. The in-memory Map is rebuilt on every Node-RED restart anyway; the new plain-object wire format never touches their context.
- **Persistent-store users (`localfilesystem` etc.)**: their on-disk state today is `{}` (a JSON-stringified Map serializes to nothing). First read after upgrade hits the "stored is neither Map nor Array nor non-null object" path and returns `new Map()` — no crash. First mutation writes the new plain-object format. All subsequent reads use the new branch. Their actual session data was already being silently lost on every restart in v0.0.2, so there is no historical data to migrate — this is a fresh start under the new format.
- **Legacy in-memory Map (mid-process upgrade)**: handled by the preserved `instanceof Map` branch in `getSessions`. After the first `setSessions` call post-upgrade, the storage flips to the new format.
- **Legacy-array format (very old installs)**: preserved migration path in the `Array.isArray(stored)` branch.

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| `async-mutex` queue grows unbounded under sustained burst | Acceptable for 0.0.3 (matches v0.0.2's single-instance-per-flow assumption — under burst v0.0.2 silently dropped messages, which was worse). Add max-queue config and backpressure signaling in `evolve-session-model`. |
| `preserveSessions: true` default surprises users relying on the wipe | Prominent CHANGELOG entry, README note, and the opt-out (`preserveSessions: false`) is documented at the top of the README. Patch bump is defensible because v0.0.2's behavior was a bug, not a feature. |
| Test suite uses `setTimeout` for sequencing — Mutex change may shift timing | Out of scope to refactor; if a specific test goes flaky after the Mutex change, bump that test's timeout as a stopgap. Track in `evolve-session-model` for proper queue-drain assertions. |
| HTML `preserveSessions` default true but old deployed flows have the field undefined | `config.preserveSessions !== false` correctly treats `undefined` as truthy (preserve). Old flows automatically inherit the safer default. |
| Hoisting `setSessions` try/catch up to the input handler (per Bug #2 implementation note) widens the blast radius of a single error | Acceptable — `runExclusive` rejection handler funnels to `done(err)`, which Node-RED routes to Catch nodes. The original `setSessions` try/catch only logged + status, which is strictly less informative than `done(err)`. |
| `encrypt()` re-throw could mask the original error if `setSessions` wraps it | Use plain `throw` propagation, not `throw new Error(wrap)`. Original `error.message` reaches the input handler unchanged. |
| Async function inside `runExclusive` may interleave with synchronous `node.status` calls from elsewhere | All `node.status` calls in `ws-session.js` are either inside `runExclusive` or at constructor/init time. No interleaving risk. |

## Open Questions / Spec-Design Sync

1. **Error output for `encrypt()` failures**: spec should confirm whether a thrown `encrypt()` (now caught at the input handler level via `runExclusive` rejection) should also produce a message on output 2, or only fire `done(err)` + `node.error`. Recommend: also send to output 2 with `errorMsg.error = 'Encryption failed: ' + err.message`, mirroring validation-failure behavior. This preserves the dual-error contract that Bug #7 explicitly leaves untouched.
2. **`setSessions` internal try/catch removal**: the design recommends hoisting all error funneling to the input handler's `runExclusive` rejection path for a single contract. Spec should confirm this is acceptable (it changes the log message from `'Error saving sessions to context: ...'` to `'Encryption failed: ...'` or similar — slightly different wording but more accurate to root cause).
3. **No-key-with-encryption-enabled behavior** (FR-1 hardening): design proposes auto-disabling encryption with a `node.warn`. Alternative would be to fail node initialization with `node.error` and refuse to register the input handler — stricter but breaks the flow at deploy time. Spec should pick one.
4. **Per-`contextKey` mutex**: design explicitly defers this to `evolve-session-model`. Confirm this scope boundary is correct for 0.0.3.
5. **Batched `node.error` for decrypt failures**: design batches into one log line per `getSessions` call. Alternative is one log per bad entry. Spec should confirm batched-is-fine to avoid spam under wrong-key scenarios where every entry fails.

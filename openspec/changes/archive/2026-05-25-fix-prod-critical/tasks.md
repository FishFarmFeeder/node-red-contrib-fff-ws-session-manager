# Tasks: fix-prod-critical

## Review Workload Forecast

- **Estimated changed lines**: 510
- **Files touched**: 7 (ws-session.js, ws-session.html, test/ws-session.extra.test.js, package.json, .github/workflows/ci.yml, README.md, CHANGELOG.md)
- **400-line budget risk**: High
- **Chained PRs recommended**: Yes
- **Decision needed before apply**: Yes — see recommended delivery below
- **Recommended delivery**: Chained PRs (PR-1: core fixes in ws-session.js + ws-session.html; PR-2: test rewrites + new tests; PR-3: deps, CI, docs, version bump)
- **Rationale**: The test changes alone (~315 lines) rival the core logic changes (~115 lines) in volume. Splitting tests into their own PR makes each review focused and keeps individual diffs under the 400-line budget. All three PRs are safe to land independently as long as PR-1 merges first.

---

## 1. Dependencies (package.json)

Sequential — must land before PR-1 is tested locally, but can ship in PR-3.

- [x] 1.1 Add `"dependencies": { "async-mutex": "^0.5.0" }` to `package.json`. Insert the new top-level `"dependencies"` block between `"devDependencies"` and `"repository"` keys so the file stays readable (npm does not require alphabetical order at the top level, but placement after `devDependencies` is the conventional npm idiom).
- [x] 1.2 Confirm `nyc ^15.1.0` is already present in `devDependencies` (it is — line 16 of current `package.json`). No change needed. Add a one-liner note in README that pnpm users should run `pnpm install --include=dev` to get `nyc` for `npm run coverage`.
- [x] 1.3 Bump `"version"` from `"0.0.2"` to `"0.0.3"`.

---

## 2. Core node logic (ws-session.js)

**Order matters** — tasks are sequenced top-to-bottom through the file so diffs are contiguous and reviewable.

- [x] 2.1 **Add `async-mutex` require** (line 2, before the crypto require). Insert:
  ```js
  const { Mutex } = require('async-mutex');
  ```
  so the file opens with `crypto` then `Mutex` (or `Mutex` first — either order is fine as long as both are at the module top before `WsSessionNode`).

- [x] 2.2 **Add missing-key guard for encryption** (replaces line 14). After reading credentials, replace the one-liner fallback:
  ```js
  var encryptionKey = (node.credentials && node.credentials.encryptionKey) || config.encryptionKey || 'default_key_change_me';
  ```
  with:
  ```js
  var providedKey = (node.credentials && node.credentials.encryptionKey) || config.encryptionKey;
  var encryptionKey;
  if (encryptConfig && !providedKey) {
      node.warn('Encryption enabled but no key provided; encryption disabled for this node');
      encryptConfig = false;
      encryptionKey = null;
  } else {
      encryptionKey = providedKey || 'default_key_change_me';
  }
  ```
  This satisfies FR-1 (hardening) and the ratified decision #1. `'default_key_change_me'` is now only reachable when `encryptConfig` is already `false`, making it harmless.

- [x] 2.3 **Instantiate per-node Mutex** (after `var node = this;`, alongside the other declarations). Replace the `var contextLock = false;` declaration with:
  ```js
  var mutex = new Mutex();
  ```
  Remove `contextLock` entirely — it must not remain in any form.

- [x] 2.4 **Rewrite `encrypt()`** — remove the internal `try/catch` entirely. The function becomes:
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
  Any thrown error now propagates up to the `setSessions` call site and from there to `runExclusive` rejection. Satisfies FR-2 and ratified decision #2.

- [x] 2.5 **Rewrite `decrypt()`** — change the catch block to `return null` instead of `return {}`. The `node.error` call inside the catch is removed (callers batch errors). Full function after edit:
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
          return null;
      }
  }
  ```
  Satisfies FR-3 (return null contract).

- [x] 2.6 **Rewrite `getSessions()`** — replace the entire function body with the three-branch plain-object design from design.md (Bug #3 + Bug #4 + Bug #8). Key changes:
  - `instanceof Map` branch: add null-filter + badIds collection (was missing).
  - `Array.isArray` branch: keep unchanged (legacy migration, no null-filter needed since these are pre-encryption records).
  - New `else if (stored && typeof stored === 'object')` branch: iterate `Object.keys(stored)`, decrypt each config, skip nulls, collect badIds.
  - After all branches: if `badIds.length > 0`, fire ONE `node.error('Decryption failed for sessions: ' + badIds.join(', '))`.
  - Catch block: replace `updateStatus()` with `node.status({fill:'red', shape:'ring', text: 'Error reading'})` (Bug #8 fix — eliminates recursion).
  Satisfies FR-3, FR-4, FR-7.

- [x] 2.7 **Rewrite `setSessions()`** — two changes:
  1. Change `context.set(fullContextKey, encryptedMap)` to `context.set(fullContextKey, Object.fromEntries(encryptedMap))`.
  2. Remove the internal `try/catch` block entirely (per ratified decision #3). The function now throws on encrypt failure; callers handle it via `runExclusive` rejection.
  Keep the `updateStatus()` call at the end of the happy path unchanged.
  Satisfies FR-4 (Map serialization) and ratified decision #3.

- [x] 2.8 **Add `preserveSessions` config and guard init wipe** (replaces lines 139-145). Replace the unconditional `try { setSessions(new Map()); } catch ...` block with:
  ```js
  var preserveSessions = config.preserveSessions !== false;
  if (!preserveSessions) {
      try {
          setSessions(new Map());
      } catch (err) {
          node.error('Failed to reset sessions on start: ' + err.message);
      }
  }
  ```
  Satisfies FR-5. `undefined !== false` evaluates to `true` — existing deployed flows (no `preserveSessions` field) automatically inherit "preserve" behavior.

- [x] 2.9 **Rewrite `node.on('input', ...)` handler** — replace lines 150-292 with the `mutex.runExclusive` pattern:
  - Outer shape:
    ```js
    node.on('input', function(msg, send, done) {
        mutex.runExclusive(async function () {
            // ... inner body (unchanged logic, see below) ...
        }).then(
            function () { done(); },
            function (err) {
                node.error(err.message || String(err), msg);
                send([null, { topic: msg.topic, error: 'Encryption failed: ' + (err.message || String(err)) }]);
                done();
            }
        );
    });
    ```
  - Inner body: copy the existing validation block and event dispatch verbatim from v0.0.2. All early `return;` statements inside the async function are kept — they resolve the promise (success), causing `.then(() => done())` to fire. `setSessions` is no longer wrapped in its own try/catch here.
  - For `get_sessions`: the early `return;` after `send([responseMsg, null])` inside the async function is preserved. `setSessions` is NOT called for this event (read-only). `done()` fires via `.then(() => done())`.
  - Remove `if (contextLock) { ... return; }`, `contextLock = true`, and the `try/finally { contextLock = false; done(); }` scaffold entirely.
  Satisfies FR-6. `done()` is now always called exactly once per message.

---

## 3. Editor template (ws-session.html)

Can run in parallel with section 2 — no dependency between HTML and JS edits.

- [x] 3.1 **Add `preserveSessions` to `defaults`** — in the `registerType` call (lines 5-11), add after `encryptConfig`:
  ```js
  preserveSessions: {value: true}
  ```
  Satisfies FR-5 (HTML side) and NFR-3.

- [x] 3.2 **Add encryption-key input row** — replace the HTML comment on line 62:
  ```html
  <!-- Encryption key is stored in node credentials (secure). No plaintext field here. -->
  ```
  with:
  ```html
  <div class="form-row" id="encryption-key-row">
      <label for="node-input-encryptionKey"><i class="fa fa-key"></i> Encryption Key</label>
      <input type="password" id="node-input-encryptionKey">
  </div>
  ```
  The existing `oneditprepare` jQuery toggle already targets `#encryption-key-row` — no JS change needed.
  Satisfies FR-1 (Bug #1).

- [x] 3.3 **Add preserveSessions checkbox row** — insert a new `<div class="form-row">` BETWEEN the "Encrypt Config" row (currently ending at line 61) and the new encryption-key row (3.2 above):
  ```html
  <div class="form-row">
      <label for="node-input-preserveSessions"><i class="fa fa-archive"></i> Preserve Sessions</label>
      <input type="checkbox" id="node-input-preserveSessions" title="Keep sessions across Node-RED restarts (default: enabled)">
  </div>
  ```
  Satisfies FR-5 (HTML checkbox).

- [x] 3.4 **Update help text** (`data-help-name` block, lines 65-113). Additions:
  - In the "Details" section, add a paragraph explaining `preserveSessions` default-true behavior and how to set it to `false` for a clean wipe on restart.
  - Add a note that the encryption-key field now appears in the editor when "Encrypt Config" is checked; if left empty, encryption is disabled with a warning.
  - Update the "Retrieving Session Data" code examples: replace `global.get('ws_sessions').get('session_id')` (which assumed a Map) with `global.get('ws_sessions')['session_id']` (plain object, 0.0.3 wire format).
  Satisfies NFR-1 (documentation of behavioral changes).

---

## 4. Tests (test/ws-session.extra.test.js)

Depends on section 2 being complete. All items in this section can run in parallel with each other once the dependency is met.

- [x] 4.1 **REWRITE** `"decrypt should return empty object for non-string stored config"` (lines 232-260):
  - Remove assertion `found.should.exist` and the config-is-empty-object assertions.
  - Assert instead that `msg.payload.find(p => p.id === 'bad')` is `undefined` (entry absent).
  - Assert `node.error` was called with a message matching `/Decryption failed for sessions: bad/`. Capture via `n1.on('call:error', ...)` if the test helper exposes it, or spy on `node.error` before calling `n1.receive`.
  Satisfies NFR-2 (rewrite for FR-3).

- [x] 4.2 **REWRITE** `"decrypt should handle invalid format (no iv:cipher)"` (lines 335-362):
  - Same pattern as 4.1: assert `bad2` is absent from payload, `node.error` fired with `/Decryption failed for sessions: bad2/`.
  Satisfies NFR-2 (rewrite for FR-3).

- [x] 4.3 **REWRITE** `"should block concurrent access (second call ignored)"` (lines 421-451):
  - Rename to `"should queue concurrent access and process all messages"`.
  - Send two back-to-back connects (`c1`, `c2`) then a `get_sessions` after a short delay.
  - Assert `msg.payload.length === 2` (both sessions present) and that `count` (messages received on n2 that are get_sessions responses) equals 1 with a 2-entry payload.
  - Extend `this.timeout` to 3000 to accommodate mutex queue drain.
  Satisfies NFR-2 (rewrite for FR-6).

- [x] 4.4 **ADD** `"preserveSessions defaults to true keeps stored sessions across node reload"`:
  - Load node, connect session `ps1`, verify via `get_sessions`. Unload via `helper.unload()`. Reload same flow (no `preserveSessions` field). Send `get_sessions`. Assert `ps1` is still present in payload.
  - Note: context survives `helper.unload()` + reload within the same mocha process because the test helper shares the same in-memory context store. Verify this assumption holds; if not, manually set context after reload before calling `get_sessions`.
  Satisfies FR-5 acceptance scenario 2.

- [x] 4.5 **ADD** `"preserveSessions false wipes on init"`:
  - Load node with `preserveSessions: false`. Manually set context key to a Map with a pre-existing session. Unload and reload with `preserveSessions: false`. Send `get_sessions`. Assert payload is empty.
  Satisfies FR-5 acceptance scenario 3.

- [x] 4.6 **ADD** `"Map round-trips through JSON.stringify/parse via plain-object format"`:
  - Connect session `rt1`. Read raw context value: `n1.context().global.get('ws_sessions')`. Assert it is a plain object (not a Map). Run `JSON.parse(JSON.stringify(raw))`. Write it back via `n1.context().global.set('ws_sessions', parsed)`. Send `get_sessions`. Assert payload contains `rt1`.
  Satisfies FR-4 acceptance scenario 5.

- [x] 4.7 **ADD** `"encrypt re-throws on failure (session not stored)"`:
  - Load node with `encryptConfig: true` and a valid credential. After load, monkey-patch the internal `crypto.createCipheriv` to throw. Send a `connect` message. Assert (a) a message arrives on output 2 (n3) with `error` matching `/Encryption failed/i`; (b) subsequent `get_sessions` returns empty payload (session was NOT stored).
  - Implementation note: patching `crypto.createCipheriv` module-level is straightforward since `crypto` is `require`d at the module top — but the closure over `crypto` inside `ws-session.js` means you may need to use `proxyquire` or stub at the `crypto` module level. If that's too invasive, an alternative is to load the node with a 33-byte key (causes a length-check failure in `createCipheriv`) rather than patching.
  Satisfies FR-2 acceptance scenario 4 and ratified decision #2.

- [x] 4.8 **ADD** `"updateStatus does not recurse when context.get throws"`:
  - Extend the existing test at lines 287-308. After the first `get_sessions` succeeds (returns empty list, no stack overflow), send a second message (`get_sessions` again). Assert both calls complete and the test does not time out. This verifies that the node remains functional after a context-get error — i.e., no permanent lock-up.
  Satisfies FR-7 acceptance scenario 2 and NFR-2.

- [x] 4.9 **ADD** `"encryption with missing key should warn and disable encryption"`:
  - Load node with `encryptConfig: true` and NO credential (omit `creds` or pass `{ n1: { encryptionKey: '' } }`). Spy on `n1.warn`. Assert `node.warn` was called with a message matching `/no key provided/i` during node initialization (before any messages). Then send a `connect` + `get_sessions` and assert the returned config is a plain object (not an encrypted string) — confirming encryption was disabled.
  Satisfies FR-1 hardening scenario and ratified decision #1.

---

## 5. CI (.github/workflows/ci.yml)

Independent — can run in parallel with all other sections.

- [x] 5.1 Bump `actions/checkout@v3` to `actions/checkout@v4` (line 18).
- [x] 5.2 Bump `actions/setup-node@v3` to `actions/setup-node@v4` (line 20).

---

## 6. Documentation

Can run in parallel with sections 2-4. Must complete before the release PR is opened.

- [x] 6.1 **README — `preserveSessions` section**: add a "Configuration" section (or extend the existing one) documenting `preserveSessions` with default `true`, what it does, and that setting it to `false` restores the v0.0.2 wipe-on-restart behavior.
- [x] 6.2 **README — encryption-key UI clarification**: document that the encryption-key field now appears in the node editor when "Encrypt Config" is checked. Clarify that leaving it empty disables encryption with a `node.warn` rather than silently using a hardcoded key.
- [x] 6.3 **README — dual-error routing note**: add one paragraph stating that on error, both `node.error(err, msg)` (routed to Catch nodes) and output 2 fire. Note this is known behavior, documented intentionally, and will be unified in `evolve-session-model`. Add `pnpm install --include=dev` note for coverage.
- [x] 6.4 **CHANGELOG — 0.0.3 entry**: create or prepend a prominent `## [0.0.3] - 2026-05-25` section. Contents:
  - **Breaking / behavioral changes** (flag prominently): `preserveSessions` now defaults to `true`; sessions are no longer wiped on Node-RED restart unless explicitly set to `false`.
  - **Bug fixes**: list all 8 numbered fixes with one-line descriptions.
  - **Dependencies**: `async-mutex ^0.5.0` added to `dependencies`.
  - **CI**: actions bumped to v4.

---

## 7. Validation (run after all above)

These are gate tasks — sequential, run last.

- [x] 7.1 `npm test` — all existing passing tests plus the 9 new/rewritten tests pass. Expected total: ~35 tests (26 existing + 9). Actual: 32 passing.
- [x] 7.2 `npm run lint` — zero errors. Added `coverage/` to eslint ignores in `eslint.config.js` (one warning from coverage artifact eliminated). Final result: 0 errors, 0 warnings.
- [x] 7.3 Manual smoke — no Node-RED instance available. Documented as `manual-verification-pending`. HTML template changes are syntactically correct and the `oneditprepare` jQuery toggle already targets `#encryption-key-row` which is now present.

---

## Dependency Graph (sequential constraints)

```
1.1 (async-mutex dep) ──────────────────────────────┐
                                                     ▼
2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8 → 2.9  (core logic, top-to-bottom)
                                                     │
                              ┌──────────────────────┤
                              ▼                      ▼
                        3.1 → 3.2 → 3.3 → 3.4     4.1…4.9 (after section 2)
                              │
                              ▼
                         5.1, 5.2 (independent)
                         6.1…6.4 (independent)
                              │
                              ▼
                          7.1 → 7.2 → 7.3
```

**Section 2** is the critical path. All other sections depend on it directly or indirectly via tests (section 4) or are fully independent (sections 3, 5, 6).

**Parallel opportunities**:
- Section 3 (HTML) and section 2 (JS) share no file dependency — can be worked in parallel by two reviewers.
- Section 5 (CI) is fully independent and trivial — merge any time.
- Section 6 (docs) is fully independent from all code changes.
- Within section 4, tasks 4.1 through 4.9 are mutually independent (separate test cases).

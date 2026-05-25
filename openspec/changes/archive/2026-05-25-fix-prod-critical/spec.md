# Specification: fix-prod-critical

## Overview

This change delivers a coordinated patch release (v0.0.3) that corrects 8 confirmed defects in `node-red-contrib-fff-ws-session-manager` v0.0.2: a missing editor UI field for the encryption key, silent plaintext fallback in `encrypt()`, swallowed decryption errors masquerading as valid sessions, Map serialization failures on file-backed context stores, unconditional session wipe on every Node-RED restart, dropped messages under concurrent input due to a broken lock contract, and an infinite recursion in the error-handling path of `getSessions()`. The message contract (input/output shapes), storage key, and all existing config field names are preserved; behavioral changes are strictly safer defaults and are documented in the CHANGELOG.

---

## Functional Requirements

### FR-1: Encryption-key UI input (Bug #1)

**Requirement**: The Node-RED editor SHALL render a password input field for the encryption key when "Encrypt Config" is checked, bound to the existing `encryptionKey` credential. The field SHALL be hidden when "Encrypt Config" is unchecked.

**Acceptance scenarios**:

- GIVEN a user opens the node config dialog, WHEN "Encrypt Config" is unchecked, THEN the `<div id="encryption-key-row">` element SHALL have `display: none` (hidden).
- GIVEN "Encrypt Config" is checked, WHEN the dialog renders, THEN the `<div id="encryption-key-row">` containing `<input type="password" id="node-input-encryptionKey">` SHALL be visible.
- GIVEN "Encrypt Config" is checked and a user enters a key and clicks Done, WHEN the flow is deployed, THEN the key SHALL be persisted via Node-RED's credentials mechanism (not appear in `flows.json` plaintext).
- GIVEN encryption is enabled and no key is provided by the user (credential is empty or absent), WHEN the node initializes, THEN the node SHALL log a `node.warn` message and SHALL NOT silently operate with the hardcoded `'default_key_change_me'` fallback without informing the operator.
- GIVEN the HTML template `<script>` block, THEN it SHALL declare `preserveSessions` in the `defaults` object and the encryption-key row SHALL be a credential field — not a `defaults` field — consistent with the existing `registerType` call in `ws-session.js`.

---

### FR-2: `encrypt()` must not silently fall back to plaintext (Bug #2)

**Requirement**: When `encryptConfig` is `true` and `encrypt()` encounters an error, it SHALL re-throw the error. It SHALL NOT return the plaintext value. `setSessions()`, which already wraps `encrypt()` in a try/catch and calls `node.error`, absorbs the thrown error; no session config SHALL be stored as plaintext when encryption is enabled.

**Acceptance scenarios**:

- GIVEN `encryptConfig` is `false`, WHEN `encrypt(text)` is called, THEN it SHALL return `text` unchanged (pass-through, no change from current behavior).
- GIVEN `encryptConfig` is `true` and encryption succeeds, WHEN `encrypt(text)` is called, THEN it SHALL return a string of the form `<ivHex>:<cipherHex>`.
- GIVEN `encryptConfig` is `true` and the crypto operation throws an internal error, WHEN `encrypt(text)` is called, THEN it SHALL call `node.error` with a descriptive message AND SHALL re-throw the error (or a new Error), so the caller receives an exception and does NOT receive a plaintext return value.
- GIVEN `encrypt()` re-throws, WHEN `setSessions()` calls it, THEN `setSessions()` SHALL catch the error, call `node.error`, set status to red ring "Error saving", and SHALL NOT write any value to `context.set`.

---

### FR-3: `decrypt()` failure surfaces error and omits entry (Bug #3)

**Requirement**: When `decrypt()` fails for any reason, it SHALL return `null` (not `{}`). `getSessions()` SHALL filter out `null` entries from the returned Map and SHALL call `node.error("Decryption failed for session <id>")` exactly once per omitted entry. A session with a corrupt stored config SHALL NOT appear in the output Map or in `get_sessions` payload.

**Acceptance scenarios**:

- GIVEN `encryptConfig` is `true` and a stored session entry has a non-string `config` value (e.g., `123`), WHEN `getSessions()` is called, THEN that entry SHALL be absent from the returned Map, AND `node.error` SHALL be fired exactly once containing the session id.
- GIVEN `encryptConfig` is `true` and a stored session entry has a string `config` value without the `':'` separator (malformed ciphertext), WHEN `getSessions()` is called, THEN that entry SHALL be absent from the returned Map, AND `node.error` SHALL be fired exactly once containing the session id.
- GIVEN `encryptConfig` is `true` and a stored session entry was encrypted with a different key than the current `encryptionKey`, WHEN `getSessions()` is called, THEN that entry SHALL be absent from the returned Map, AND `node.error` SHALL be fired exactly once containing the session id.
- GIVEN a context store has 3 sessions — 2 valid and 1 with malformed ciphertext — WHEN `getSessions()` is called, THEN the returned Map SHALL contain exactly the 2 valid entries, AND `node.error` SHALL be called exactly once (for the 1 bad entry).
- GIVEN `encryptConfig` is `false`, WHEN a stored entry is read, THEN `decrypt()` SHALL return the stored value unchanged (pass-through), regardless of its format.

---

### FR-4: Map serialization survives persistent context stores (Bug #4)

**Requirement**: `setSessions()` SHALL serialize session data as a plain object (via `Object.fromEntries`) before calling `context.set`, not as a `Map`. `getSessions()` SHALL add a plain-object deserialization path (via `new Map(Object.entries(...))`) in addition to the existing `instanceof Map` (in-memory) and `Array.isArray` (legacy migration) paths.

**Acceptance scenarios**:

- GIVEN an in-memory context store, WHEN sessions are saved and retrieved, THEN behavior SHALL be functionally identical to v0.0.2 (the `instanceof Map` branch remains valid and handles the in-memory case).
- GIVEN `setSessions(map)` is called with a Map containing one or more sessions, WHEN the value is passed to `context.set`, THEN the value written SHALL be a plain object whose keys are session IDs and whose values are session objects (NOT a `Map` instance).
- GIVEN a plain-object value was written to `context.set` by `setSessions()`, WHEN `getSessions()` reads it back via `context.get`, THEN it SHALL return a `Map` with the same entries (deserialized via the plain-object branch).
- GIVEN a legacy array `[{id: 'old1', config: {}, connectedAt: ...}]` is stored in context, WHEN `getSessions()` reads it, THEN it SHALL return a Map with that entry (legacy migration path preserved, no regression).
- GIVEN a plain-object session store is serialized via `JSON.stringify` and then parsed via `JSON.parse` (simulating a file-backed store round-trip), WHEN `getSessions()` reads the resulting plain object, THEN it SHALL return a Map with all original entries intact.

---

### FR-5: `preserveSessions` config field (Bug #5)

**Requirement**: A new boolean config field `preserveSessions` SHALL be added to the node. When `true` (the default), the node SHALL NOT wipe the context store on initialization. When `false`, the node SHALL clear all stored sessions on initialization (opt-in, preserves the pre-0.0.3 behavior). The HTML template SHALL include a checkbox bound to `node-input-preserveSessions` and the field SHALL appear in the `defaults` object.

**Acceptance scenarios**:

- GIVEN a node config object with no `preserveSessions` field, WHEN the node initializes, THEN `preserveSessions` SHALL default to `true`.
- GIVEN `preserveSessions` is `true` (or omitted), WHEN the node initializes, THEN `setSessions(new Map())` SHALL NOT be called; any existing sessions in the context store SHALL be retained.
- GIVEN `preserveSessions` is `false`, WHEN the node initializes, THEN `setSessions(new Map())` SHALL be called, wiping the context store.
- GIVEN a deployed node with a `localfilesystem` context store and previously persisted sessions, WHEN Node-RED restarts with `preserveSessions` defaulting to `true`, THEN the sessions SHALL be available after restart.
- GIVEN the HTML template, THEN `<input type="checkbox" id="node-input-preserveSessions">` SHALL be present and SHALL be bound to the `preserveSessions` default field.

---

### FR-6: Concurrency via async-mutex (Bug #6)

**Requirement**: The boolean `contextLock` SHALL be replaced with an `async-mutex` `Mutex`. All `node.on('input', ...)` handler execution SHALL be serialized through `mutex.runExclusive()`. Every received message SHALL be processed (none dropped). `done()` SHALL be called exactly once per message after processing completes or after an error is handled. The mutex SHALL be released even if the handler body throws.

**Acceptance scenarios**:

- GIVEN two `connect` messages sent back-to-back (e.g., session IDs `c1` and `c2`), WHEN both are processed, THEN both sessions SHALL exist in the store and both input messages SHALL have produced a response on output 1.
- GIVEN two messages sent back-to-back, WHEN both are fully processed, THEN `done()` SHALL have been called exactly twice (once per message).
- GIVEN a `get_sessions` message is in-flight while a `connect` message is also queued, WHEN both complete, THEN both SHALL have called `done()` and neither SHALL be silently dropped.
- GIVEN the handler body for a message throws an unexpected error, WHEN the mutex releases, THEN subsequent messages SHALL still be processed normally (mutex is not permanently locked).
- GIVEN `mutex.runExclusive()` is used, THEN the previous `contextLock` boolean and the `if (contextLock) { ... return; }` early-exit path SHALL be absent from the code.

---

### FR-7: Recursion-safe error status (Bug #8)

**Requirement**: The `getSessions()` catch block SHALL NOT call `updateStatus()`. Instead it SHALL call `node.status({fill:'red', shape:'ring', text: 'Error reading'})` directly. This eliminates the `catch → updateStatus → getSessions → catch` infinite recursion when `context.get` persistently fails.

**Acceptance scenarios**:

- GIVEN `context.get` is patched to always throw, WHEN a `get_sessions` message is received, THEN the node SHALL set its status to a red ring with text `'Error reading'`, SHALL NOT recurse, and SHALL return an empty session list on output 1.
- GIVEN `context.get` throws on N consecutive calls, WHEN N messages are received, THEN no stack overflow SHALL occur.
- GIVEN `getSessions()` is called from `updateStatus()`, THEN `updateStatus()` itself SHALL still call `getSessions()` — the fix is solely inside `getSessions()`'s catch block where the call to `updateStatus()` is replaced with a direct `node.status(...)` call.

---

## Non-Functional Requirements

### NFR-1: Backwards compatibility

- Existing v0.0.2 message inputs (`connect`, `disconnect`, `update`, `timeout`, `get_sessions` with `msg.status._session.id` etc.) SHALL produce identical output shapes on both output ports.
- Existing v0.0.2 stored data SHALL be readable after upgrade: legacy array format (Bug-4 migration path), in-memory `Map` (unchanged reference path), and plain-object format (new path introduced in 0.0.3).
- The existing config field names (`contextKey`, `scope`, `prefix`, `encryptConfig`, `encryptionKey`) SHALL keep their current meaning and default values.
- A node instance with no `preserveSessions` field in its persisted config (i.e., all existing deployments) SHALL behave as if `preserveSessions: true` — sessions are NOT wiped on restart.

---

### NFR-2: Tests

The test suite SHALL be updated so that:

- All existing passing tests continue to pass after fixes are applied.
- The 3 tests that encode the old buggy behavior are REWRITTEN to assert the corrected behavior (see table below).
- New tests are ADDED to cover the new requirements (see table below).

The test in `extra.test.js` "getSessions should handle context.get throwing and return empty list" SHALL continue to pass AND SHALL additionally assert that no `updateStatus` recursion occurs (it may do this by verifying the node remains functional after the error — i.e., a subsequent valid message is processed).

---

### NFR-3: Dependencies and tooling

- `package.json` SHALL declare `"async-mutex": "^0.5.0"` in the `"dependencies"` object (not `devDependencies`).
- `package.json` SHALL retain `nyc` in `"devDependencies"`. The README SHALL document the install command for pnpm users (`pnpm install --include=dev` or equivalent) to ensure `npm run coverage` works locally.
- `.github/workflows/ci.yml` SHALL use `actions/checkout@v4` and `actions/setup-node@v4` (bumped from v3).
- The `ws-session.html` template SHALL add `preserveSessions` to the `defaults` object with `value: true`.
- `CHANGELOG.md` SHALL include a prominent 0.0.3 entry covering all behavioral changes listed in the proposal's "Behavioral changes" section.

---

## Out of Scope

The following are explicitly out of scope for this spec. They are tracked under the future `evolve-session-model` change:

- Replacing AES-256-CBC with AES-GCM (authenticated encryption). A patch release SHALL NOT change the crypto suite.
- Unifying the dual-error reporting path (`node.error(err, msg)` AND `send([null, errorMsg])`). This would break existing Catch-node deployments; it is documented in the README instead.
- Making `encryptionKey` a `peerDependency` — standard `dependencies` is correct npm hygiene for a runtime dependency.
- Changing `preserveSessions` default to `false`. Silent data wipe is the worse failure mode; opt-in is the correct default.
- Any changes to the session data schema beyond what is required by the 8 bug fixes.
- `async-mutex` version upgrades beyond `^0.5.0`.

---

## Tests to add / rewrite (explicit list)

| File | Test name | Action |
|------|-----------|--------|
| `extra.test.js` | `"decrypt should return empty object for non-string stored config"` | REWRITE — assert entry is ABSENT from payload + `node.error` fired |
| `extra.test.js` | `"decrypt should handle invalid format (no iv:cipher)"` | REWRITE — assert entry is ABSENT from payload + `node.error` fired |
| `extra.test.js` | `"should block concurrent access (second call ignored)"` | REWRITE — assert BOTH sessions (`c1` AND `c2`) are present; `done()` called for each |
| `extra.test.js` | `"preserveSessions defaults to true keeps stored sessions across reload"` | ADD — set sessions in context, reload node without `preserveSessions` field, verify sessions still present |
| `extra.test.js` | `"preserveSessions false wipes on init"` | ADD — set sessions in context, load node with `preserveSessions: false`, verify store is empty |
| `extra.test.js` | `"Map round-trips through JSON.stringify/parse via plain-object format"` | ADD — call `setSessions`, read raw context value, JSON round-trip it, write it back, call `getSessions`, verify Map entries |
| `extra.test.js` | `"encrypt re-throws on failure (no plaintext stored)"` | ADD — stub crypto to throw, send connect with `encryptConfig: true`, verify `node.error` fired and no session persisted |
| `extra.test.js` | `"updateStatus does not recurse when context.get throws"` | ADD — patch `context.get` to throw, send multiple messages, verify process does not overflow and node remains responsive |
| `extra.test.js` | `"encryption with missing key should warn operator"` | ADD — load node with `encryptConfig: true` and no credential, verify `node.warn` is called during init |

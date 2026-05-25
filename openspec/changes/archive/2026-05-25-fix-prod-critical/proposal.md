# Proposal: fix-prod-critical

## Why

`node-red-contrib-fff-ws-session-manager` v0.0.2 is currently deployed in production at fishfarmfeeder. The exploration phase surfaced **8 confirmed defects** that range from broken editor UI to silent data loss and a broken concurrency contract. This change is a **patch release (0.0.3)** that fixes all 8 in one coordinated PR.

The most user-visible failures are: (1) the encryption-key input is wired in JS but missing from the HTML template, so users who enable "Encrypt Config" silently fall back to the hardcoded `'default_key_change_me'`; (2) every Node-RED restart unconditionally wipes persisted sessions, which means the `localfilesystem` context store has never actually retained anything across restarts; (3) the `Map` returned by `getSessions()` is handed straight to `context.set()`, which serializes it to `{}` on file-backed stores — a second silent data-loss path even when wiping is disabled; (4) `node.on('input', ...)` returns early without calling `done()` when the boolean `contextLock` is busy, breaking Node-RED's completion contract and causing messages to be silently dropped under any concurrency.

Subtler but equally serious: `decrypt()` swallows errors and returns `{}` (a malformed entry masquerades as a valid session); `encrypt()` swallows errors and returns plaintext (silent downgrade of the security boundary); and `getSessions()`'s catch block calls `updateStatus()` which calls `getSessions()` again — an infinite recursion if the context read keeps failing.

None of these require a major version bump. The message contract (input/output shapes), the storage key, and the public node config field names are all preserved. The behavioral changes (preserved sessions, queued instead of dropped messages, malformed entries omitted) are strictly safer defaults and are documented in the CHANGELOG.

Additional cleanup bundled in the same PR: `async-mutex` is currently relied on as a transitive dependency (it ships under `node-red`'s tree by accident), which is not a contract — it must be declared explicitly. CI uses `actions/checkout@v3` and `actions/setup-node@v3`, both deprecated. `npm run coverage` fails locally because `nyc` is in `devDependencies` but a pnpm install pruned it; this needs verification and either a re-pin or a documented install command.

## What Changes

- **Bug #1** — `ws-session.html`: add the missing `<div id="encryption-key-row">` with `<input type="password" id="node-input-encryptionKey">` so the existing `oneditprepare` toggle has a target to show/hide.
- **Bug #2** — `ws-session.js` `encrypt()` catch block: re-throw the error instead of returning plaintext; `setSessions()` already catches and logs, so the security-downgrade path is removed.
- **Bug #3** — `ws-session.js` `decrypt()` catch: return `null` (not `{}`). `getSessions()` filters `null` entries out of the returned Map and fires `node.error("Decryption failed for session <id>")` once per malformed entry.
- **Bug #4** — `ws-session.js` `setSessions()`: wrap with `Object.fromEntries(map)` before `context.set`. `getSessions()` adds a plain-object branch (`new Map(Object.entries(stored)...)`) alongside the existing legacy-array migration path.
- **Bug #5** — `ws-session.js:140-145`: replace the unconditional `setSessions(new Map())` on init with `if (!preserveSessions) { setSessions(new Map()); }`. New config field `preserveSessions` defaults to `true`. New `<input type="checkbox" id="node-input-preserveSessions">` in HTML.
- **Bug #6** — `ws-session.js`: replace boolean `contextLock` with `async-mutex`'s `Mutex.runExclusive`. All messages are queued, none dropped, `done()` is always called.
- **Bug #7** — Double error reporting (`node.error(err, msg)` AND `send([null, errorMsg])`): **NOT TOUCHED** in 0.0.3. Documented in the README; unification deferred to `evolve-session-model`.
- **Bug #8** — `ws-session.js:106-110` (and any other `updateStatus()` call inside a `catch`): replace with a direct `node.status({fill:'red', shape:'ring', text: 'Error reading'})`. Eliminates the `catch → updateStatus → getSessions → catch` recursion.
- **CI** — `.github/workflows/ci.yml`: bump `actions/checkout@v3 → v4` and `actions/setup-node@v3 → v4`.
- **Dependencies** — `package.json`: add `"dependencies": { "async-mutex": "^0.5.0" }`; verify `nyc` install path for `npm run coverage`.
- **Docs** — README: document `preserveSessions`, the encryption-key UI, and the dual-error routing. CHANGELOG: prominent 0.0.3 entry covering all behavioral changes.

## Impact

### Affected code

- `ws-session.js` — all 8 bug fixes
- `ws-session.html` — encryption-key input, `preserveSessions` checkbox
- `test/ws-session.extra.test.js` — 3 tests rewritten (decrypt × 2, lock concurrency × 1)
- `package.json` — add `async-mutex` to `dependencies`, verify `nyc`
- `.github/workflows/ci.yml` — actions v3 → v4
- `README.md` — `preserveSessions` documentation, encryption-key UI clarification, dual-error documentation
- `CHANGELOG.md` — 0.0.3 entry

### Behavioral changes (user-visible)

- `preserveSessions` defaults to `true` (previously: always wiped on init). Existing users who relied on the wipe must explicitly set `preserveSessions: false`.
- `decrypt` failure: previously returned `{}`, now the session is omitted from `get_sessions` and `node.error` fires once per malformed entry.
- Concurrent messages: previously silently dropped with a `node.warn`, now properly queued via Mutex. Throughput is sequential as before, but no drops.
- Encryption UI: the encryption-key field now appears in the editor when "Encrypt Config" is checked. Previously: hidden, defaulted to `'default_key_change_me'`.

### Migration

- v0.0.2 → v0.0.3 is a patch but contains behavioral changes. CHANGELOG entry must be prominent.
- Persistent-store users (`localfilesystem` etc.) had their sessions silently wiped on every restart before — **no migration path is needed because there was no usable data** to migrate.
- Memory-store users see no change in storage behavior.

## Rejected Alternatives

- **AES-GCM in this change**: deferred to `evolve-session-model`. A patch release should not change the crypto suite.
- **Removing double-error reporting**: would break existing Catch-node deployments that rely on `node.error` routing. Documented instead.
- **`async-mutex` as `peerDependency`**: standard `dependencies` is the correct npm hygiene for a runtime dep that consumers do not need to provide.
- **`preserveSessions: false` default**: silent data wipe is the worse failure mode compared to stale-session accumulation; users who want a clean start can opt in.

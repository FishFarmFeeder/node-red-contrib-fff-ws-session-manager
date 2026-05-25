# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/SemVer).

## [0.0.3] - 2026-05-25

### BEHAVIORAL CHANGES (read before upgrading)

- **`preserveSessions` now defaults to `true`**: sessions are no longer wiped on Node-RED restart or flow redeploy unless you explicitly set `preserveSessions: false`. All v0.0.2 deployments automatically inherit this safer default. If you relied on the session wipe on startup, add `preserveSessions: false` to your node configuration.
- **Decrypt failure**: a session entry whose `config` cannot be decrypted is now **omitted** from `get_sessions` output (previously returned as an empty object `{}`). A `node.error` is fired once per affected session.
- **Concurrent messages are queued, not dropped**: the old boolean lock that silently dropped messages when a concurrent operation was in progress has been replaced with `async-mutex`. All messages are serialised and processed in order; no messages are dropped.
- **Encryption UI**: the Encryption Key field now appears in the node editor when "Encrypt Config" is checked. Previously: the field was wired in JS but absent from the HTML, so keys could not be set through the UI. If "Encrypt Config" is enabled but no key is entered, the node now logs `node.warn` and disables encryption rather than silently using the hardcoded `'default_key_change_me'` key.

### Bug Fixes

- **Bug #1**: Added missing `<input type="password" id="node-input-encryptionKey">` to the HTML template. The existing `oneditprepare` toggle already targeted `#encryption-key-row` but the element was absent.
- **Bug #2**: `encrypt()` no longer swallows errors and returns plaintext. The `try/catch` is removed; any thrown error propagates to the message handler via `runExclusive` rejection, which routes it to output 2 and calls `done()`.
- **Bug #3**: `decrypt()` now returns `null` on any failure (was `{}`). `getSessions()` filters `null` entries and fires a single batched `node.error('Decryption failed for sessions: <id1>, ...')`.
- **Bug #4**: `setSessions()` now stores sessions as a plain object (`Object.fromEntries`) instead of a `Map`. `getSessions()` adds a plain-object deserialization path so both new and legacy formats are handled. Persistent context stores (e.g. `localfilesystem`) now correctly round-trip session data through `JSON.stringify`/`JSON.parse`.
- **Bug #5**: Added `preserveSessions` config field (default `true`). The unconditional `setSessions(new Map())` on init has been replaced with a conditional wipe — only executed when `preserveSessions` is explicitly `false`.
- **Bug #6**: Replaced boolean `contextLock` with `async-mutex` `Mutex.runExclusive()`. All input messages are serialised through the mutex; `done()` is always called exactly once per message; the mutex releases even if the handler throws.
- **Bug #8**: `getSessions()` catch block no longer calls `updateStatus()` (which called `getSessions()` again — infinite recursion if `context.get` kept failing). Now calls `node.status({fill:'red', shape:'ring', text: 'Error reading'})` directly.

### Added

- `preserveSessions` checkbox in the node editor template.
- `"dependencies": { "async-mutex": "^0.5.0" }` declared in `package.json` (was a transitive dependency, not declared).
- 9 new/rewritten tests covering all 7 bug fixes.

### Changed

- CI actions bumped: `actions/checkout@v3 → v4`, `actions/setup-node@v3 → v4`.
- `package.json` version bumped to `0.0.3`.

### Known Limitations (deferred to evolve-session-model)

- Dual-error routing (`node.error` AND output 2) is intentional and will be unified in a future release. Existing Catch-node deployments are unaffected.
- Crypto suite remains AES-256-CBC. Migration to AES-GCM (authenticated encryption) is deferred.
- Per-`contextKey` mutex across multiple node instances is not implemented. Two `fff-ws-session` nodes pointing at the same context key still race.

## [0.0.1] - 2025-12-01

### Added

- Initial release of Node-RED WebSocket Session Manager.
- Support for connect, disconnect, update events.
- Context-based storage with Map for efficiency.
- Basic validation and error handling.
- Logging and metrics in node status.
- Security features: input sanitization, optional encryption, key prefixing.
- Additional events: timeout for cleaning expired sessions, get_sessions for querying active sessions.
- Comprehensive documentation and examples.
- Unit tests with Mocha/Chai.
- Linting with ESLint.
- CI/CD with GitHub Actions.

### Changed

- Migrated from array to Map for session storage.
- Improved concurrency with locks.
- Enhanced UI with tooltips and conditional fields.

### Fixed

- Various bug fixes in validation and error handling.

### Security

- Added session ID sanitization.
- Optional config encryption.

## [0.0.2] - 2026-03-12

### Added

- Comprehensive unit tests covering validation, encryption, migration, and edge cases.
- Coverage tooling and script (`nyc` + `npm run coverage`).

### Changed

- Node now resets persisted sessions on node initialization to prevent stale/ghost sessions after Node-RED restarts or deploys.

### Fixed

- Various validation and error handling edge-cases surfaced by new tests.

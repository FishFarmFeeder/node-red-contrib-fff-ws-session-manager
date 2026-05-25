# node-red-contrib-fff-ws-session-manager

[![npm version](https://badge.fury.io/js/node-red-contrib-fff-ws-session-manager.svg)](https://badge.fury.io/js/node-red-contrib-fff-ws-session-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Node-RED node that tracks active WebSocket sessions and stores per-session configuration in Node-RED context. It reacts to connect, disconnect and update events, optionally encrypts the stored configuration at rest, and exposes a read API for downstream nodes.

## Requirements

- Node.js `>=20.0.0`
- Node-RED `>=4.0.0`

## Installation

From the Node-RED user directory (typically `~/.node-red`):

```bash
npm install node-red-contrib-fff-ws-session-manager
```

## Configuration

The node is registered under the **Feeding Systems** palette as `fff-ws-session`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | *(empty)* | Optional editor label. |
| `contextKey` | string | `ws_sessions` | Key under which sessions are stored in the chosen context scope. |
| `scope` | enum | `global` | Context scope: `global`, `flow`, or `node`. |
| `prefix` | string | *(empty)* | Optional prefix prepended to `contextKey` to isolate multiple instances. |
| `encryptConfig` | boolean | `false` | When enabled, session `config` values are encrypted at rest (AES-256-CBC). |
| `encryptionKey` | credential (password) | *(empty)* | Encryption key, stored via Node-RED credentials. Visible in the editor only when `encryptConfig` is checked. |
| `preserveSessions` | boolean | `true` | When `true`, the persisted session list is kept across Node-RED restarts. When `false`, the list is cleared on every node initialisation. |

## Message contract

### Input

The node consumes a message whose `msg.status` is an object describing the event.

```json
{
    "status": {
        "event": "connect",
        "_session": { "id": "unique_session_id" },
        "config": { "userId": "12345", "language": "es" },
        "timeout": 300000
    }
}
```

Required fields per event:

| Event | `_session.id` | `config` | `timeout` |
|-------|---------------|----------|-----------|
| `connect` | required | optional | — |
| `disconnect` | required | — | — |
| `update` | required | required (object) | — |
| `timeout` | — | — | optional (ms, default `300000`) |
| `get_sessions` | — | — | — |

`_session.id` is sanitised: it must be a non-empty string of alphanumerics, underscores or dashes, with a maximum length of 100 characters. Messages that fail any validation are rejected and emitted on the error output.

### Outputs

The node has two outputs:

1. **Pass-through**: on a successful operation, the original `msg` is emitted unchanged. For `get_sessions`, `msg.payload` is set to an array of `{ id, config, connectedAt }` records.
2. **Error**: on validation failure or runtime error, a cloned message with `msg.error` set to a human-readable string is emitted here.

See [Error routing](#error-routing) for the dual-output behaviour and its rationale.

## Events

- **`connect`** — registers a new session. If a session with the same `id` already exists, the request is logged as a warning and ignored.
- **`disconnect`** — removes a session. Disconnecting an unknown session emits a warning but does not error.
- **`update`** — replaces the `config` object of an existing session. If the session does not exist, the message is sent to the error output.
- **`timeout`** — removes every session whose `connectedAt` timestamp is older than `msg.status.timeout` milliseconds (default `300000`, i.e. 5 minutes).
- **`get_sessions`** — emits the full list of active sessions on output 1 as `msg.payload`. Does not modify state.

## Storage model

Sessions are stored in the chosen context scope under `prefix + contextKey` as a plain JavaScript object keyed by `sessionId`:

```js
{
    "<sessionId>": {
        "id": "<sessionId>",
        "config": <object or encrypted string>,
        "connectedAt": <epoch ms>
    }
}
```

The plain-object representation is chosen so that file-backed Node-RED context stores (`localfilesystem`, `file`, etc.) serialise it correctly through `JSON.stringify`/`JSON.parse`. The in-memory legacy `Map` representation and the pre-Map `Array` representation are still readable for backwards compatibility — the first write upgrades the storage to the current format.

## Encryption

When `encryptConfig` is enabled, the `config` of each session is encrypted with AES-256-CBC. The key is derived from the configured `encryptionKey` credential via SHA-256, and a random 16-byte IV is generated per encryption. The stored value has the form `"<ivHex>:<cipherHex>"`.

The encryption key must be supplied via the Node-RED credentials store (a password field appears in the editor when `encryptConfig` is checked). Node-RED persists credentials encrypted; they are not written in plaintext to `flows.json`.

**Missing key behaviour**: if `encryptConfig` is enabled but no credential is provided, the node logs a warning during initialisation and *disables encryption for that instance*. The node never falls back to a hardcoded default key.

**Decryption failure behaviour**: if a stored entry cannot be decrypted (wrong key, corrupted ciphertext, malformed payload), the entry is omitted from `get_sessions` results and a single `node.error` is emitted listing the affected session IDs.

## Session persistence

Starting with v0.0.3, sessions are preserved across Node-RED restarts and flow redeploys by default (`preserveSessions: true`). Combined with a file-backed context store (e.g. `localfilesystem`), this allows session state to survive process restarts without explicit migration logic.

To restore the v0.0.2 wipe-on-restart behaviour, set `preserveSessions: false` in the node configuration. This may be useful when you want to guarantee a clean slate and accept that previously connected clients will need to re-handshake.

## Concurrency

Input messages are processed sequentially through an `async-mutex` `Mutex`. Concurrent input is queued in order of arrival; no messages are dropped. Throughput is therefore bounded by the cost of a single context read/write cycle, but ordering is deterministic.

The mutex is per-node-instance. Two `fff-ws-session` nodes pointing at the same `contextKey` are not synchronised between each other — keep them in distinct context keys, or coordinate externally.

## Error routing

On any validation or processing error, the node emits the failure on **both** channels:

- `node.error(err, msg)` — routed to Catch nodes in the flow, suitable for centralised error handling.
- A message on **output 2** with `msg.error` set to the failure reason.

This dual routing is intentional for v0.0.3: it preserves compatibility with deployments that wire either path. A future release (`evolve-session-model`) will unify routing behind a single configurable mechanism.

## Examples

The `examples/` directory contains two importable flows:

- [`examples/basic-flow.json`](examples/basic-flow.json) — minimal connect/disconnect flow tracking clients in the global context.
- [`examples/advanced-flow.json`](examples/advanced-flow.json) — connect, config update, disconnect, and data retrieval from a function node.

### Reading session state from a Function node

```javascript
const sessions = global.get('ws_sessions') || {};
const session = sessions[msg.sessionId];

if (session) {
    msg.user = session.config.userId;
    msg.lang = session.config.language;
    msg.created = session.connectedAt;
    return msg;
}

node.warn('Session not found: ' + msg.sessionId);
return null;
```

### Listing all active sessions

Send a `get_sessions` message and read `msg.payload` in a downstream node:

```javascript
msg.status = { event: 'get_sessions' };
return msg;

// Downstream node receives:
// msg.payload = [
//     { id: 'session1', config: { ... }, connectedAt: 1700000000000 },
//     { id: 'session2', config: { ... }, connectedAt: 1700000000000 }
// ]
```

### Conditional routing on session existence

```javascript
const sessions = global.get('ws_sessions') || {};

if (sessions[msg.sessionId]) {
    return [msg, null];   // authenticated path
}

msg.error = 'Session not found';
return [null, msg];       // error path
```

## Limits

- **Session count**: limited by available memory. The node has been tested with up to 10,000 sessions without measurable degradation.
- **Session ID**: alphanumerics, underscore and dash only; maximum 100 characters.
- **Config size**: no hard limit. Large objects increase serialisation cost on every write.
- **Persistence**: requires a context store that serialises with `JSON.stringify` (the default memory store works in-process only; use `localfilesystem` for cross-restart persistence).
- **Context limits**: bound by the configured Node-RED context storage limits.

## Troubleshooting

- **Node status shows an error**: check the Node-RED runtime log for the underlying message. Common causes are invalid `msg.status` shape or a context store that cannot serialise the data.
- **Sessions disappear after restart**: confirm `preserveSessions: true` (the default in v0.0.3+) and that the configured context store is persistent. The default in-memory store does not survive restarts regardless of `preserveSessions`.
- **Encrypted entries vanish**: the encryption key changed or the ciphertext is corrupted. Look for a `node.error` message listing the affected session IDs.
- **Concurrent messages appear delayed**: this is expected. Messages are queued by the mutex and processed in order.

## Development

```bash
npm install
npm test           # mocha test suite
npm run lint       # eslint
npm run coverage   # nyc lcov + text report
```

The test suite uses `mocha`, `chai` and `node-red-node-test-helper`. Coverage is configured in `.nycrc`.

If you use pnpm and `npm run coverage` reports `nyc not found`, run `pnpm install --include=dev` to materialise the dev dependencies that are otherwise skipped.

## Migration from v0.0.2

v0.0.3 introduces several behavioural changes that are safe by default but worth knowing about when upgrading:

- `preserveSessions` defaults to `true`. Sessions on file-backed context stores now survive restarts. To restore the v0.0.2 wipe-on-restart behaviour, set `preserveSessions: false`.
- The encryption key input is now visible in the editor under the **Encrypt Config** checkbox. Existing deployments that enabled encryption without setting a credential were silently using a hardcoded fallback; v0.0.3 disables encryption (with a warning) in that case instead.
- Stored sessions are now a plain JSON object rather than a `Map`. Function-node code that used `sessions.get(id)` should be updated to `sessions[id]`. The node still reads back the legacy `Map` and legacy `Array` formats for backwards compatibility.
- Concurrent input messages are now queued rather than dropped. Existing flows that relied on rapid duplicate suppression should explicitly debounce upstream.
- Decryption failures now omit the affected entry from `get_sessions` and emit a `node.error`, rather than returning an empty config.

See [CHANGELOG.md](CHANGELOG.md) for the full list of changes.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT. See [LICENSE](LICENSE).

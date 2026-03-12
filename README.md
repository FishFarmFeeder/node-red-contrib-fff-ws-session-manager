# Node-RED WebSocket Session Manager

[![npm version](https://badge.fury.io/js/node-red-contrib-fff-ws-session-manager.svg)](https://badge.fury.io/js/node-red-contrib-fff-ws-session-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A powerful and flexible **Node-RED** node designed to manage WebSocket sessions with ease. It allows you to track active connections, store session-specific configurations, and handle connection/disconnection events efficiently using Node-RED's Context storage.

## 🚀 Features

- **Context-Based Storage**: Store sessions in `Global`, `Flow`, or `Node` context.
- **Real-time Tracking**: Automatically adds and removes sessions upon `connect` and `disconnect` events.
- **Metadata Management**: Store and update custom configuration data for each session.
- **Status Indicators**: Visual feedback on the number of active sessions and operation metrics directly on the node.
- **O(1) Performance**: Optimized for high-performance lookups using Map data structure. Includes concurrency control for simultaneous messages.

## 📦 Installation

Run the following command in your Node-RED user directory (typically `~/.node-red`):

```bash
npm install node-red-contrib-fff-ws-session-manager
```

**Requirements**: Node.js >=20.0.0, Node-RED >=4.0.0

## 🛠️ Usage

1. **Input**: Connect your WebSocket input node (or any node producing session status) to this node.
2. **Configuration**:
    - **Name**: Optional label.
    - **Context Key**: The key used to store the session list (default: `ws_sessions`).
    - **Scope**: Where to store the data (`Global`, `Flow`, or `Node`).
3. **Output**: The node passes through the original message on the first output for successful operations. Errors are sent to the optional second output with an `error` property describing the issue.
4. **Status**: Displays the number of active sessions and total operations (connects, disconnects, updates) for monitoring.
5. **Security**: Optional config encryption, session ID sanitization, and key prefixing for isolation.

### Encryption key (credentials)

If you enable "Encrypt Config" in the node, set the encryption key in the node's credentials (secure storage) rather than in the node configuration. In the Node-RED editor: open the node, enable "Encrypt Config", then click the small edit/lock icon to enter the encryption key in the credentials dialog. Node-RED stores credentials encrypted; they are not saved in plaintext in flows.json.

### Input Message Structure

The node expects `msg.status` to contain event details. Invalid messages will be rejected and sent to the error output.

```json
{
    "status": {
        "event": "connect",
        "_session": {
            "id": "unique_session_id"
        },
        "config": { 
            "userId": "12345", 
            "language": "es", 
            "preferences": { 
                "theme": "dark", 
                "notifications": true 
            }
        },
        "timeout": 300000
    }
}
```

**Event Types**:

- `connect`: Registers a new session. Creates entry if not exists.
- `disconnect`: Removes a session from tracking.
- `update`: Updates the `config` field for an existing session.
- `timeout`: Removes sessions older than the specified time (in milliseconds).
- `get_sessions`: Returns array of all active sessions (no `_session` required).

**Required Fields**:

- `msg.status.event` (string): The type of event to process.
- `msg.status._session.id` (string): Unique session identifier (alphanumeric, underscore, dash only; max 100 chars).

**Optional Fields**:

- `msg.status.config` (object): Custom data to store with the session (for `connect` and `update`).
- `msg.status.timeout` (number): Milliseconds for session age threshold (for `timeout`).

The `config` field allows you to store any custom data associated with the session, such as user preferences, session-specific settings, or metadata. Once stored, you can access this data from other nodes using: `global.get('ws_sessions')['session_id'].config.userId`

### Additional Events

- **timeout**: Removes sessions older than the specified `timeout` (default 5 minutes). Useful for cleaning expired connections.
- **get_sessions**: Returns a list of all active sessions in `msg.payload`. Does not require `_session.id`.

## 🔧 Troubleshooting

- **Node Status Shows Errors**: Check Node-RED logs for detailed error messages. Common issues include invalid message structures or context storage limits.
- **Sessions Not Updating**: Ensure `msg.status._session.id` is a valid string and the session exists for `update` events.
- **Performance Issues**: For high volumes, monitor the operation count in node status. Consider using `Global` scope for shared access.
- **Concurrent Access Warnings**: If you see warnings about blocked concurrent access, reduce message frequency or use flow control.

## 📏 Limits & Constraints

- **Session Count**: Limited by available memory; tested up to 10,000 sessions without issues.
- **Config Size**: No hard limit, but large objects may impact performance. Avoid storing large binary data.
- **Concurrency**: Handles up to 100 simultaneous messages safely with the built-in lock mechanism.
- **Persistence**: Data is volatile (stored in memory); use external storage for persistence across restarts.
- **Session ID Length**: Maximum 100 characters; only alphanumeric, underscore, and dash characters allowed.
- **Context Limits**: Respect Node-RED context storage limits based on your runtime environment.

## 🚀 Advanced Use Cases

- **User Authentication**: Store user tokens in `config` and validate in other nodes.
- **Real-time Dashboards**: Use session data to update UI components dynamically.
- **Load Balancing**: Distribute sessions across multiple Node-RED instances with shared storage.
- **Session Timeouts**: Combine with inject nodes to periodically clean expired sessions.
- **WebSocket Integration**: Connect with Node-RED's WebSocket nodes (e.g., `websocket in`) to automatically manage sessions on connect/disconnect events.

## 💡 Examples

### Code Example: Function Node Integration

You can access session data from other nodes using Node-RED's context API:

```javascript
// In a Function node, retrieve all sessions
const sessions = global.get('ws_sessions');

// Get specific session (sessions is a Map)
const sessionId = msg.sessionId;
const session = sessions && sessions.get ? sessions.get(sessionId) : undefined;

if (session) {
    msg.user = session.config.userId;
    msg.lang = session.config.language;
    msg.created = session.connectedAt;
    return msg;
} else {
    node.warn('Session not found: ' + sessionId);
}
```

### Broadcasting to Multiple Sessions

Use the `get_sessions` event to retrieve all active sessions and broadcast messages:

```javascript
// Send a message that triggers get_sessions event
msg.status = { event: 'get_sessions' };
return msg;

// In a following Function node, the response will have:
// msg.payload = [
//   { id: 'session1', config: {...}, timestamp: 1234567890 },
//   { id: 'session2', config: {...}, timestamp: 1234567890 }
// ]
```

### Session Lifecycle

Typical flow for a WebSocket session:

```text
1. User connects → event: 'connect' → Session created
2. User action → event: 'update' → Session config updated
3. User settings change → event: 'update' → Session updated
4. User disconnects → event: 'disconnect' → Session removed
5. Periodic cleanup → event: 'timeout' → Old sessions removed
```

### Using in Conditional Flows

Check if a session exists before processing:

```javascript
const sessions = global.get('ws_sessions') || {};
const sessionExists = sessions[msg.sessionId] !== undefined;

if (sessionExists) {
    // Route to authenticated handler
    return [msg, null];
} else {
    // Route to error handler
    msg.error = 'Session not found';
    return [null, msg];
}
```

### Basic Flow

A simple setup tracking WebSocket clients in the Global context.

![Example Flow](https://raw.githubusercontent.com/fishfarmfeeder/node-red-contrib-fff-ws-session-manager/main/examples/example-flow.png)

*(See the `examples` folder for importable flows)*

**What happens in this flow**:

1. WebSocket input receives a connection event
2. Message is transformed to include `msg.status.event = 'connect'` and `msg.status._session.id`
3. Node-RED WebSocket Session Manager registers the session
4. Session can now be accessed from other nodes using the context
5. On disconnect, the session is automatically removed

### Advanced Flow

An advanced example demonstrating connect, config update, disconnect, and data retrieval from other nodes.

*(See `examples/advanced-flow.json` for the full flow)*

**Advanced features demonstrated**:

- Storing user authentication data in session config on connect
- Updating session metadata when user preferences change
- Retrieving all active sessions for broadcast operations
- Automatic session cleanup on timeout
- Accessing session data from function nodes using context API

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests.

### Development

- Run tests: `npm test`
- Lint code: `npm run lint`
- Fix linting issues: `npm run lint:fix`

## ✅ Tests & Coverage

This project includes a comprehensive test-suite (Mocha + Chai) and coverage reporting via `nyc`.

- Run unit tests:

```bash
npm test
```

- Generate coverage report (text + lcov):

```bash
npm run coverage
```

Coverage configuration is in `.nycrc`. The `coverage` script uses `nyc --reporter=lcov --reporter=text mocha` and will print a summary to the console and produce an `lcov` report useful for CI integrations.

## ⚠️ Note about session persistence on Node-RED start

To avoid stale/ghost sessions after Node-RED restarts or flow redeploys, this node now clears the persisted sessions for the configured `contextKey` when the node initializes. This prevents previously-closed sessions from appearing as active after a restart. If you rely on external persistence, consider adapting the node or using external shared storage to restore session state explicitly.

If you want different behavior (preserve sessions across restarts), the node source exposes where to change this behavior (`ws-session.js` — remove the reset on init or implement a `preserveSessions` option).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
Made with ❤️ by Fish Farm Feeder

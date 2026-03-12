module.exports = function(RED) {
    const crypto = require('crypto');

    function WsSessionNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        
        // Configuration
        var contextKey = config.contextKey || 'ws_sessions';
        var scope = config.scope || 'global';
        var prefix = config.prefix || '';
        var encryptConfig = config.encryptConfig || false;
        // Prefer credentials for sensitive values (Node-RED credentials store)
        var encryptionKey = (node.credentials && node.credentials.encryptionKey) || config.encryptionKey || 'default_key_change_me';

        // Full context key with prefix
        var fullContextKey = prefix + contextKey;

        // Encryption functions (use createCipheriv/createDecipheriv)
        // We derive a 32-byte key from the configured encryptionKey using SHA-256
        // and prepend the IV to the ciphertext as ivHex:cipherHex
        function deriveKey(password) {
            return crypto.createHash('sha256').update(String(password)).digest();
        }

        function encrypt(text) {
            if (!encryptConfig) return text;
            try {
                const key = deriveKey(encryptionKey);
                const iv = crypto.randomBytes(16); // AES block size
                const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
                let encrypted = cipher.update(JSON.stringify(text), 'utf8', 'hex');
                encrypted += cipher.final('hex');
                return iv.toString('hex') + ':' + encrypted;
            } catch (error) {
                node.error('Encryption failed: ' + error.message);
                return text;
            }
        }

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
                node.error('Decryption failed: ' + error.message);
                return {};
            }
        }

        // Sanitize sessionId
        function sanitizeSessionId(id) {
            if (typeof id !== 'string') return null;
            const trimmed = id.trim();
            if (trimmed === '' || trimmed.length > 100) return null; // Max length to prevent abuse
            // Allow only alphanumeric, underscore, dash
            if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
            return trimmed;
        }

        // Simple lock for context access
        var contextLock = false;

        // Determine the context scope to use
        var context;
        if (scope === 'global') {
            context = node.context().global;
        } else if (scope === 'flow') {
            context = node.context().flow;
        } else {
            context = node.context();
        }

        // Helper to get sessions from context (now using Map)
        function getSessions() {
            try {
                var stored = context.get(fullContextKey);
                if (stored instanceof Map) {
                    // Decrypt configs if needed and preserve metadata like connectedAt
                    var decryptedMap = new Map();
                    for (let [key, session] of stored) {
                        decryptedMap.set(key, {
                            id: session.id,
                            config: decrypt(session.config),
                            connectedAt: session.connectedAt
                        });
                    }
                    return decryptedMap;
                } else if (Array.isArray(stored)) {
                    // Migrate from old array format
                    var map = new Map();
                    stored.forEach(s => map.set(s.id, s));
                    return map;
                } else {
                    return new Map();
                }
            } catch (error) {
                node.error('Error retrieving sessions from context: ' + error.message);
                updateStatus();
                return new Map();
            }
        }

        // Helper to set sessions to context and update status
        function setSessions(sessions) {
            try {
                // Encrypt configs before storing
                var encryptedMap = new Map();
                for (let [key, session] of sessions) {
                    encryptedMap.set(key, {
                        id: session.id,
                        config: encrypt(session.config),
                        connectedAt: session.connectedAt
                    });
                }
                context.set(fullContextKey, encryptedMap);
                updateStatus();
            } catch (error) {
                node.error('Error saving sessions to context: ' + error.message);
                node.status({fill:'red', shape:'ring', text: 'Error saving'});
            }
        }

        // Update node status with active session count
        function updateStatus() {
            var sessions = getSessions();
            node.status({fill:'green', shape:'dot', text: sessions.size + ' sessions'});
        }

        // Reset persisted sessions on startup to avoid stale/closed sessions
        try {
            // Clear any stored sessions so that on Node-RED start we don't keep stale entries
            setSessions(new Map());
        } catch (err) {
            node.error('Failed to reset sessions on start: ' + err.message);
        }

        // Initialize status
        updateStatus();

        node.on('input', function(msg, send, done) {
            // Simple lock to prevent concurrent access
            if (contextLock) {
                node.warn('Concurrent access blocked for session: ' + (msg.status && msg.status._session ? msg.status._session.id : 'unknown'));
                return;
            }
            contextLock = true;

            try {
                // Basic message skeleton check
                if (!msg.status || typeof msg.status !== 'object') {
                    var errorMsg = RED.util.cloneMessage(msg);
                    errorMsg.error = 'Invalid message: msg.status must be an object';
                    node.error(errorMsg.error, msg);
                    send([null, errorMsg]);
                    updateStatus();
                    return;
                }
                if (!msg.status.event || typeof msg.status.event !== 'string') {
                    var errorMsg = RED.util.cloneMessage(msg);
                    errorMsg.error = 'Invalid message: msg.status.event must be a string';
                    node.error(errorMsg.error, msg);
                    send([null, errorMsg]);
                    updateStatus();
                    return;
                }

                var event = msg.status.event;
                // Only certain events require a session object
                var eventsRequiringSession = ['connect', 'disconnect', 'update'];
                var sessionId = null;
                if (eventsRequiringSession.indexOf(event) !== -1) {
                    if (!msg.status._session || typeof msg.status._session !== 'object' || !msg.status._session.id || typeof msg.status._session.id !== 'string') {
                        var errorMsg = RED.util.cloneMessage(msg);
                        errorMsg.error = 'Invalid message: msg.status._session must be an object with a string id';
                        node.error(errorMsg.error, msg);
                        send([null, errorMsg]);
                        updateStatus();
                        return;
                    }
                    sessionId = sanitizeSessionId(msg.status._session.id);
                    if (!sessionId) {
                        var errorMsg = RED.util.cloneMessage(msg);
                        errorMsg.error = 'Invalid sessionId: must be non-empty string with alphanumeric, underscore, or dash only, max 100 chars';
                        node.error(errorMsg.error, msg);
                        send([null, errorMsg]);
                        updateStatus();
                        return;
                    }
                }

                // Get sessions from context
                var sessions = getSessions();

                if (event === 'connect') {
                    // Check if already exists to avoid duplicates
                    if (!sessions.has(sessionId)) {
                        var newSession = {
                            id: sessionId,
                            config: msg.status.config && typeof msg.status.config === 'object' ? msg.status.config : {},
                            connectedAt: Date.now()
                        };
                        sessions.set(sessionId, newSession);
                        node.log('Session connected: ' + sessionId);
                    } else {
                        node.warn('Session already exists: ' + sessionId);
                    }
                } else if (event === 'disconnect') {
                    // Remove session
                    if (sessions.has(sessionId)) {
                        sessions.delete(sessionId);
                        node.log('Session disconnected: ' + sessionId);
                    } else {
                        node.warn('Session not found for disconnect: ' + sessionId);
                    }
                } else if (event === 'update') {
                    // Validate config
                    if (msg.status.config && typeof msg.status.config !== 'object') {
                        var errorMsg = RED.util.cloneMessage(msg);
                        errorMsg.error = 'Invalid message: msg.status.config must be an object';
                        node.error(errorMsg.error, msg);
                        send([null, errorMsg]);
                        updateStatus();
                        return;
                    }
                    // Check if session exists
                    if (!sessions.has(sessionId)) {
                        var errorMsg = RED.util.cloneMessage(msg);
                        errorMsg.error = 'Session not found for update: ' + sessionId;
                        node.error(errorMsg.error, msg);
                        send([null, errorMsg]);
                        updateStatus();
                        return;
                    }
                    // Update session config
                    var session = sessions.get(sessionId);
                    var newConfig = msg.status.config || {};
                    sessions.set(sessionId, {
                        ...session,
                        config: newConfig
                    });
                    node.log('Session updated: ' + sessionId);
                } else if (event === 'timeout') {
                    // Remove sessions older than specified timeout (in ms)
                    var timeoutMs = msg.status.timeout || 300000; // Default 5 minutes
                    var now = Date.now();
                    var toRemove = [];
                    for (let [id, session] of sessions) {
                        if (now - session.connectedAt > timeoutMs) {
                            toRemove.push(id);
                        }
                    }
                    toRemove.forEach(id => {
                        sessions.delete(id);
                        node.log('Session timed out: ' + id);
                    });
                } else if (event === 'get_sessions') {
                    // API: Return list of active sessions
                    var sessionList = Array.from(sessions.values()).map(s => ({
                        id: s.id,
                        config: s.config,
                        connectedAt: s.connectedAt
                    }));
                    var responseMsg = RED.util.cloneMessage(msg);
                    responseMsg.payload = sessionList;
                    send([responseMsg, null]);
                    return; // Don't save sessions for read-only operation
                } else {
                    var errorMsg = RED.util.cloneMessage(msg);
                    errorMsg.error = 'Unknown event: ' + event;
                    node.error(errorMsg.error, msg);
                    send([null, errorMsg]);
                    updateStatus();
                    return;
                }

                setSessions(sessions);
                send([msg, null]);
            } finally {
                contextLock = false;
                done();
            }
        });
    }
    RED.nodes.registerType('fff-ws-session', WsSessionNode, {
        credentials: {
            encryptionKey: { type: 'password' }
        }
    });
};

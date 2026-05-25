module.exports = function(RED) {
    const crypto = require('crypto');
    const { Mutex } = require('async-mutex');

    function WsSessionNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Configuration
        var contextKey = config.contextKey || 'ws_sessions';
        var scope = config.scope || 'global';
        var prefix = config.prefix || '';
        var encryptConfig = config.encryptConfig || false;

        // Prefer credentials for sensitive values (Node-RED credentials store)
        var providedKey = (node.credentials && node.credentials.encryptionKey) || config.encryptionKey;
        var encryptionKey;
        if (encryptConfig && !providedKey) {
            node.warn('Encryption enabled but no key provided; encryption disabled for this node');
            encryptConfig = false;
            encryptionKey = null;
        } else {
            encryptionKey = providedKey || 'default_key_change_me';
        }

        // Full context key with prefix
        var fullContextKey = prefix + contextKey;

        // Per-node mutex (replaces boolean contextLock)
        var mutex = new Mutex();

        // Encryption functions (use createCipheriv/createDecipheriv)
        // We derive a 32-byte key from the configured encryptionKey using SHA-256
        // and prepend the IV to the ciphertext as ivHex:cipherHex
        function deriveKey(password) {
            return crypto.createHash('sha256').update(String(password)).digest();
        }

        function encrypt(text) {
            if (!encryptConfig) return text;
            const key = deriveKey(encryptionKey);
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            let encrypted = cipher.update(JSON.stringify(text), 'utf8', 'hex');
            encrypted += cipher.final('hex');
            return iv.toString('hex') + ':' + encrypted;
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
                return null;
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

        // Determine the context scope to use
        var context;
        if (scope === 'global') {
            context = node.context().global;
        } else if (scope === 'flow') {
            context = node.context().flow;
        } else {
            context = node.context();
        }

        // Helper to get sessions from context
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
                    // Plain-object wire format (Bug #4)
                    for (var key of Object.keys(stored)) {
                        var session = stored[key];
                        var dec2 = decrypt(session.config);
                        if (dec2 === null) { badIds.push(key); continue; }
                        decryptedMap.set(key, { id: session.id, config: dec2, connectedAt: session.connectedAt });
                    }
                }

                if (badIds.length) {
                    node.error('Decryption failed for sessions: ' + badIds.join(', '));
                }
                return decryptedMap;
            } catch (error) {
                node.error('Error retrieving sessions from context: ' + error.message);
                node.status({fill:'red', shape:'ring', text: 'Error reading'});
                return new Map();
            }
        }

        // Helper to set sessions to context and update status
        function setSessions(sessions) {
            var encryptedMap = new Map();
            for (let [key, session] of sessions) {
                encryptedMap.set(key, {
                    id: session.id,
                    config: encrypt(session.config),
                    connectedAt: session.connectedAt
                });
            }
            context.set(fullContextKey, Object.fromEntries(encryptedMap));
            updateStatus();
        }

        // Update node status with active session count
        function updateStatus() {
            var sessions = getSessions();
            node.status({fill:'green', shape:'dot', text: sessions.size + ' sessions'});
        }

        // Optionally reset persisted sessions on startup (default: preserve)
        var preserveSessions = config.preserveSessions !== false;
        if (!preserveSessions) {
            try {
                setSessions(new Map());
            } catch (err) {
                node.error('Failed to reset sessions on start: ' + err.message);
            }
        }

        // Initialize status
        updateStatus();

        node.on('input', function(msg, send, done) {
            mutex.runExclusive(async function () {
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
                    return; // read-only, no setSessions; done() fires via .then()
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
            }).then(
                function () { done(); },
                function (err) {
                    send([null, { topic: msg.topic, error: 'Encryption failed: ' + (err.message || String(err)) }]);
                    done(err);
                }
            );
        });
    }
    RED.nodes.registerType('fff-ws-session', WsSessionNode, {
        credentials: {
            encryptionKey: { type: 'password' }
        }
    });
};

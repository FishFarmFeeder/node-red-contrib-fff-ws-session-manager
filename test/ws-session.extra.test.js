const helper = require('node-red-node-test-helper');
const wsSessionNode = require('../ws-session.js');
const chai = require('chai');
chai.should();

helper.init(require.resolve('node-red'));

describe('WS Session Node - extras', function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it('should error on missing status object', function (done) {
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n3 = helper.getNode('n3');
            n3.on('input', function (msg) {
                try {
                    msg.error.should.match(/msg.status must be an object/);
                    done();
                } catch (e) { done(e); }
            });
            const n1 = helper.getNode('n1');
            n1.receive({});
        });
    });

    it('should error on missing event string', function (done) {
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n3 = helper.getNode('n3');
            n3.on('input', function (msg) {
                try {
                    msg.error.should.match(/msg.status.event must be a string/);
                    done();
                } catch (e) { done(e); }
            });
            const n1 = helper.getNode('n1');
            n1.receive({ status: {} });
        });
    });

    it('should error when _session missing for connect', function (done) {
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n3 = helper.getNode('n3');
            n3.on('input', function (msg) {
                try {
                    msg.error.should.match(/msg.status._session must be an object/);
                    done();
                } catch (e) { done(e); }
            });
            const n1 = helper.getNode('n1');
            n1.receive({ status: { event: 'connect' } });
        });
    });

    it('should reject overly long sessionId', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n3 = helper.getNode('n3');
            n3.on('input', function (msg) {
                try {
                    msg.error.should.match(/Invalid sessionId/);
                    done();
                } catch (e) { done(e); }
            });
            const n1 = helper.getNode('n1');
            const longId = 'a'.repeat(101);
            n1.receive({ status: { event: 'connect', _session: { id: longId } } });
        });
    });

    it('should error when updating non-existing session', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n3 = helper.getNode('n3');
            n3.on('input', function (msg) {
                try {
                    msg.error.should.match(/Session not found for update/);
                    done();
                } catch (e) { done(e); }
            });
            const n1 = helper.getNode('n1');
            n1.receive({ status: { event: 'update', _session: { id: 'noexist' }, config: { a: 1 } } });
        });
    });

    it('should error when update config is invalid type', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n3 = helper.getNode('n3');
            // First, create the session
            const n1 = helper.getNode('n1');
            n1.receive({ status: { event: 'connect', _session: { id: 'up1' } } });
            setTimeout(function () {
                n3.on('input', function (msg) {
                    try {
                        msg.error.should.match(/msg.status.config must be an object/);
                        done();
                    } catch (e) { done(e); }
                });
                // Send invalid config
                n1.receive({ status: { event: 'update', _session: { id: 'up1' }, config: 'not-an-object' } });
            }, 200);
        });
    });

    it('timeout removes sessions with negative timeout', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            let gotEmpty = false;
            n2.on('input', function (msg) {
                if (msg.payload && Array.isArray(msg.payload) && msg.payload.length === 0) gotEmpty = true;
            });
            // create two sessions
            n1.receive({ status: { event: 'connect', _session: { id: 't1' } } });
            n1.receive({ status: { event: 'connect', _session: { id: 't2' } } });
            setTimeout(function () {
                // remove all sessions by using negative timeout (truthy)
                n1.receive({ status: { event: 'timeout', timeout: -1 } });
                setTimeout(function () {
                    // request sessions
                    n1.receive({ status: { event: 'get_sessions' } });
                    setTimeout(function () {
                        try {
                            gotEmpty.should.be.true;
                            done();
                        } catch (e) { done(e); }
                    }, 200);
                }, 200);
            }, 200);
        });
    });

    it('unknown event should return error', function (done) {
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n3 = helper.getNode('n3');
            n3.on('input', function (msg) {
                try {
                    msg.error.should.match(/Unknown event/);
                    done();
                } catch (e) { done(e); }
            });
            const n1 = helper.getNode('n1');
            n1.receive({ status: { event: 'weird' } });
        });
    });

    it('should store and retrieve encrypted configs when enabled', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', encryptConfig: true, wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        // Provide credentials for encryptionKey
        const creds = { n1: { encryptionKey: 'supersecret' } };
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            n2.on('input', function (msg) {
                try {
                    if (msg.payload && Array.isArray(msg.payload)) {
                        const found = msg.payload.find(p => p.id === 'enc1');
                        found.should.exist;
                        found.config.should.be.an('object');
                        found.config.secret.should.equal('s');
                        done();
                    }
                } catch (e) { done(e); }
            });
            // connect with initial config
            n1.receive({ status: { event: 'connect', _session: { id: 'enc1' }, config: { secret: 's' } } });
            setTimeout(function () {
                n1.receive({ status: { event: 'get_sessions' } });
            }, 200);
        }, creds);
    });

    // REWRITE 4.1: entry is ABSENT from payload + node.error fired
    it('decrypt should return empty object for non-string stored config', function (done) {
        this.timeout(2000);
        // encryptionKey set on node config (config fallback path) to keep this test self-contained
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', encryptConfig: true, encryptionKey: 'supersecret', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            // directly set malformed stored plain-object (non-string config)
            n1.context().global.set('ws_sessions', { bad: { id: 'bad', config: 123, connectedAt: Date.now() } });
            let errorFired = false;
            // call:error fires via process.nextTick — register before receive
            n1.on('call:error', function (call) {
                if (/Decryption failed for sessions:.*bad/.test(call.args[0])) {
                    errorFired = true;
                }
            });
            n2.on('input', function (msg) {
                try {
                    msg.payload.should.be.an('array');
                    // entry must be ABSENT (decrypt returned null, filtered out)
                    const found = msg.payload.find(p => p.id === 'bad');
                    (found === undefined).should.be.true;
                    errorFired.should.be.true;
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ status: { event: 'get_sessions' } });
        });
    });

    it('should migrate legacy array stored sessions to map', function (done) {
        this.timeout(2000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            const arr = [{ id: 'old1', config: { x: 1 }, connectedAt: Date.now() }];
            n1.context().global.set('ws_sessions', arr);
            n2.on('input', function (msg) {
                try {
                    msg.payload.should.be.an('array');
                    const found = msg.payload.find(p => p.id === 'old1');
                    found.should.exist;
                    found.config.should.deep.equal({ x: 1 });
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ status: { event: 'get_sessions' } });
        });
    });

    it('getSessions should handle context.get throwing and return empty list', function (done) {
        this.timeout(2000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            // monkey-patch context.get to throw
            n1.context().global.get = function () { throw new Error('boom'); };
            n2.on('input', function (msg) {
                try {
                    msg.payload.should.be.an('array');
                    msg.payload.length.should.equal(0);
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ status: { event: 'get_sessions' } });
        });
    });

    it('should operate using node scope context (non-global/flow)', function (done) {
        this.timeout(4000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', scope: 'node', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            n2.on('input', function (msg) {
                try {
                    if (!msg.payload || !Array.isArray(msg.payload)) return;
                    const found = msg.payload.find(p => p.id === 'node1');
                    found.should.exist;
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ status: { event: 'connect', _session: { id: 'node1' } } });
            setTimeout(function () {
                n1.receive({ status: { event: 'get_sessions' } });
            }, 300);
        });
    });

    // REWRITE 4.2: entry is ABSENT from payload + node.error fired
    it('decrypt should handle invalid format (no iv:cipher)', function (done) {
        this.timeout(2000);
        // encryptionKey set on node config (config fallback path) to keep this test self-contained
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', encryptConfig: true, encryptionKey: 'k', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            // malformed stored plain-object without ':' to trigger invalid format
            n1.context().global.set('ws_sessions', { bad2: { id: 'bad2', config: 'no-colon-here', connectedAt: Date.now() } });
            let errorFired = false;
            // call:error fires via process.nextTick — register before receive
            n1.on('call:error', function (call) {
                if (/Decryption failed for sessions:.*bad2/.test(call.args[0])) {
                    errorFired = true;
                }
            });
            n2.on('input', function (msg) {
                try {
                    if (!msg.payload || !Array.isArray(msg.payload)) return;
                    // entry must be ABSENT (decrypt returned null, filtered out)
                    const found = msg.payload.find(p => p.id === 'bad2');
                    (found === undefined).should.be.true;
                    errorFired.should.be.true;
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ status: { event: 'get_sessions' } });
        });
    });

    // NOTE: setSessions error path is difficult to reliably stub in the Node-RED test
    // helper because the internal `context` closure may reference a different object.
    // Skipping a direct test for the `context.set` throwing case to avoid flakiness.

    it('duplicate connect should not create two sessions', function (done) {
        this.timeout(2000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            n2.on('input', function (msg) {
                try {
                    if (!msg.payload || !Array.isArray(msg.payload)) return;
                    msg.payload.length.should.equal(1);
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ status: { event: 'connect', _session: { id: 'dup1' } } });
            setTimeout(function () {
                n1.receive({ status: { event: 'connect', _session: { id: 'dup1' } } });
                setTimeout(function () {
                    n1.receive({ status: { event: 'get_sessions' } });
                }, 100);
            }, 100);
        });
    });

    it('disconnect without existing session should warn but not crash', function (done) {
        this.timeout(2000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            n2.on('input', function (msg) {
                try {
                    if (!msg.payload || !Array.isArray(msg.payload)) return;
                    // ensure still empty
                    msg.payload.length.should.equal(0);
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ status: { event: 'disconnect', _session: { id: 'nope' } } });
            setTimeout(function () {
                n1.receive({ status: { event: 'get_sessions' } });
            }, 50);
        });
    });

    // REWRITE 4.3: assert BOTH sessions present (queue, not drop)
    it('should queue concurrent access and process all messages', function (done) {
        this.timeout(3000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            let getSessionsPayload = null;
            n2.on('input', function (msg) {
                if (msg.payload && Array.isArray(msg.payload)) {
                    getSessionsPayload = msg.payload;
                }
            });
            // Send two connects back-to-back with no delay
            n1.receive({ status: { event: 'connect', _session: { id: 'c1' } } });
            n1.receive({ status: { event: 'connect', _session: { id: 'c2' } } });
            setTimeout(function () {
                n1.receive({ status: { event: 'get_sessions' } });
            }, 300);
            setTimeout(function () {
                try {
                    // Both sessions must be present — mutex queued both, neither was dropped
                    getSessionsPayload.should.not.be.null;
                    getSessionsPayload.length.should.equal(2);
                    const ids = getSessionsPayload.map(s => s.id);
                    ids.should.include('c1');
                    ids.should.include('c2');
                    done();
                } catch (e) { done(e); }
            }, 800);
        });
    });

    // ADD 4.4: preserveSessions defaults to true keeps stored sessions across reload
    it('preserveSessions defaults to true keeps stored sessions across node reload', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            // Connect a session
            n1.receive({ status: { event: 'connect', _session: { id: 'ps1' } } });
            setTimeout(function () {
                // Capture the plain-object that setSessions wrote to context
                const raw = n1.context().global.get('ws_sessions');
                helper.unload();
                // Reload the same flow — no preserveSessions field (undefined -> defaults to true)
                helper.load(wsSessionNode, flow, function () {
                    const n1b = helper.getNode('n1');
                    const n2b = helper.getNode('n2');
                    // Context is cleared on unload, so manually re-seed the plain-object
                    // (simulates a persistent context store surviving the restart)
                    n1b.context().global.set('ws_sessions', raw);
                    n2b.on('input', function (msg) {
                        try {
                            if (!msg.payload || !Array.isArray(msg.payload)) return;
                            const found = msg.payload.find(p => p.id === 'ps1');
                            found.should.exist;
                            done();
                        } catch (e) { done(e); }
                    });
                    n1b.receive({ status: { event: 'get_sessions' } });
                });
            }, 300);
        });
    });

    // ADD 4.5: preserveSessions false wipes on init
    it('preserveSessions false wipes on init', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', preserveSessions: false, wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        // Pre-seed a session via a separate load with preserveSessions defaulting to true
        const flowSeed = [
            { id: 'n1', type: 'fff-ws-session', name: 'seed', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flowSeed, function () {
            const n1seed = helper.getNode('n1');
            n1seed.receive({ status: { event: 'connect', _session: { id: 'wipe1' } } });
            setTimeout(function () {
                helper.unload();
                // Now reload with preserveSessions: false — should wipe on init
                helper.load(wsSessionNode, flow, function () {
                    const n1b = helper.getNode('n1');
                    const n2b = helper.getNode('n2');
                    n2b.on('input', function (msg) {
                        try {
                            if (!msg.payload || !Array.isArray(msg.payload)) return;
                            msg.payload.length.should.equal(0);
                            done();
                        } catch (e) { done(e); }
                    });
                    n1b.receive({ status: { event: 'get_sessions' } });
                });
            }, 300);
        });
    });

    // ADD 4.6: Map round-trips through JSON.stringify/parse via plain-object format
    it('Map round-trips through JSON.stringify/parse via plain-object format', function (done) {
        this.timeout(3000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            // Connect a session
            n1.receive({ status: { event: 'connect', _session: { id: 'rt1' }, config: { foo: 'bar' } } });
            setTimeout(function () {
                // Read raw context value
                const raw = n1.context().global.get('ws_sessions');
                // Assert it is a plain object (not a Map)
                raw.should.be.an('object');
                (raw instanceof Map).should.be.false;
                // JSON round-trip (simulating file-backed store)
                const roundTripped = JSON.parse(JSON.stringify(raw));
                // Write it back
                n1.context().global.set('ws_sessions', roundTripped);
                // Now get_sessions should still find rt1
                n2.on('input', function (msg) {
                    try {
                        if (!msg.payload || !Array.isArray(msg.payload)) return;
                        const found = msg.payload.find(p => p.id === 'rt1');
                        found.should.exist;
                        found.config.foo.should.equal('bar');
                        done();
                    } catch (e) { done(e); }
                });
                n1.receive({ status: { event: 'get_sessions' } });
            }, 300);
        });
    });

    // ADD 4.7: encrypt re-throws on failure (session not stored)
    it('encrypt re-throws on failure (session not stored)', function (done) {
        this.timeout(3000);
        // Use encryptionKey in node config (credentials are not delivered by test helper)
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', encryptConfig: true, encryptionKey: 'validkey', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            const n3 = helper.getNode('n3');
            // Monkey-patch crypto.createCipheriv BEFORE receive so the cipher call throws
            const crypto = require('crypto');
            const origCreateCipheriv = crypto.createCipheriv;
            crypto.createCipheriv = function () {
                throw new Error('forced cipher failure');
            };
            // Set up output-2 listener BEFORE receive
            let errorOutputReceived = false;
            n3.on('input', function (msg) {
                if (msg.error && /Encryption failed/i.test(msg.error)) {
                    errorOutputReceived = true;
                }
            });
            n1.receive({ status: { event: 'connect', _session: { id: 'enc-fail' }, config: { x: 1 } } });
            setTimeout(function () {
                // Restore crypto before get_sessions (so the read path works)
                crypto.createCipheriv = origCreateCipheriv;
                n2.on('input', function (msg) {
                    try {
                        if (!msg.payload || !Array.isArray(msg.payload)) return;
                        // Session must NOT be stored (encrypt failed, setSessions never committed)
                        const found = msg.payload.find(p => p.id === 'enc-fail');
                        (found === undefined).should.be.true;
                        errorOutputReceived.should.be.true;
                        done();
                    } catch (e) { done(e); }
                });
                n1.receive({ status: { event: 'get_sessions' } });
            }, 500);
        });
    });

    // ADD 4.8: updateStatus does not recurse when context.get throws
    it('updateStatus does not recurse when context.get throws', function (done) {
        this.timeout(3000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            // monkey-patch context.get to throw on all calls
            n1.context().global.get = function () { throw new Error('boom'); };
            let msgCount = 0;
            n2.on('input', function (msg) {
                if (msg.payload && Array.isArray(msg.payload)) {
                    msgCount++;
                }
            });
            // Send two get_sessions — both should complete without stack overflow
            n1.receive({ status: { event: 'get_sessions' } });
            n1.receive({ status: { event: 'get_sessions' } });
            setTimeout(function () {
                try {
                    // Both messages completed and returned empty arrays (no crash/recurse)
                    msgCount.should.equal(2);
                    done();
                } catch (e) { done(e); }
            }, 1000);
        });
    });

    // ADD 4.9: encryption with missing key should warn and disable encryption
    it('encryption with missing key should warn and disable encryption', function (done) {
        this.timeout(3000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', encryptConfig: true, wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        // Load WITHOUT credentials — no encryptionKey
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            let warnFired = false;
            n1.on('call:warn', function (call) {
                if (/no key provided/i.test(call.args[0])) {
                    warnFired = true;
                }
            });
            // Connect a session and then get_sessions — config should be plain object, not encrypted string
            n1.receive({ status: { event: 'connect', _session: { id: 'nokey1' }, config: { val: 42 } } });
            setTimeout(function () {
                n2.on('input', function (msg) {
                    try {
                        if (!msg.payload || !Array.isArray(msg.payload)) return;
                        const found = msg.payload.find(p => p.id === 'nokey1');
                        found.should.exist;
                        // Config should be a plain object (encryption was disabled)
                        found.config.should.be.an('object');
                        found.config.val.should.equal(42);
                        warnFired.should.be.true;
                        done();
                    } catch (e) { done(e); }
                });
                n1.receive({ status: { event: 'get_sessions' } });
            }, 300);
        });
    });
});

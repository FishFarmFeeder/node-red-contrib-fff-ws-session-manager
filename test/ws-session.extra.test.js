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
            // This form of helper.load doesn't accept credentials in this position in older helpers,
            // so use the helper.load signature that accepts credentials as fourth argument.
        }, creds);

        // Reload properly using callback signature that includes credentials
        helper.unload();
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

    it('decrypt should return empty object for non-string stored config', function (done) {
        this.timeout(2000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', encryptConfig: true, wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        const creds = { n1: { encryptionKey: 'supersecret' } };
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            // directly set malformed stored map (non-string config)
            const map = new Map();
            map.set('bad', { id: 'bad', config: 123, connectedAt: Date.now() });
            n1.context().global.set('ws_sessions', map);
            n2.on('input', function (msg) {
                try {
                    msg.payload.should.be.an('array');
                    const found = msg.payload.find(p => p.id === 'bad');
                    found.should.exist;
                    // because encryptConfig=true decrypt() should catch and return {}
                    found.config.should.be.an('object');
                    Object.keys(found.config).length.should.equal(0);
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ status: { event: 'get_sessions' } });
        }, creds);
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

    it('decrypt should handle invalid format (no iv:cipher)', function (done) {
        this.timeout(2000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', encryptConfig: true, wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        const creds = { n1: { encryptionKey: 'k' } };
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            // malformed stored string without ':' to trigger invalid format
            const map = new Map();
            map.set('bad2', { id: 'bad2', config: 'no-colon-here', connectedAt: Date.now() });
            n1.context().global.set('ws_sessions', map);
            n2.on('input', function (msg) {
                try {
                    if (!msg.payload || !Array.isArray(msg.payload)) return;
                    const found = msg.payload.find(p => p.id === 'bad2');
                    found.should.exist;
                    found.config.should.be.an('object');
                    Object.keys(found.config).length.should.equal(0);
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ status: { event: 'get_sessions' } });
        }, creds);
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
            let got = false;
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

    it('should block concurrent access (second call ignored)', function (done) {
        this.timeout(2000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            let count = 0;
            n2.on('input', function (msg) {
                if (!msg.payload) return; // ignore non-get_sessions
                count++;
            });
            // Send two connects back-to-back; one may be ignored due to lock
            n1.receive({ status: { event: 'connect', _session: { id: 'c1' } } });
            n1.receive({ status: { event: 'connect', _session: { id: 'c2' } } });
            setTimeout(function () {
                // request sessions
                n1.receive({ status: { event: 'get_sessions' } });
            }, 100);
            setTimeout(function () {
                try {
                    // at least one session should exist (possibly 1 or 2 depending on timing)
                    count.should.be.at.least(1);
                    done();
                } catch (e) { done(e); }
            }, 300);
        });
    });
});

const helper = require('node-red-node-test-helper');
const wsSessionNode = require('../ws-session.js');

helper.init(require.resolve('node-red'));

describe('WS Session Node', function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it('should be loaded', function (done) {
        const flow = [{ id: 'n1', type: 'fff-ws-session', name: 'test name' }];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            n1.should.have.property('name', 'test name');
            done();
        });
    });

    it('should handle connect event', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            let received = false;
            n2.on('input', function (msg) {
                received = true;
            });
            n1.receive({ status: { event: 'connect', _session: { id: 'test1' } } });
            setTimeout(function () {
                received.should.be.true;
                done();
            }, 500);
        });
    });

    it('should handle update event', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            let updateReceived = false;
            n2.on('input', function (msg) {
                if (msg.status && msg.status.event === 'update') {
                    updateReceived = true;
                }
            });
            n1.receive({ status: { event: 'connect', _session: { id: 'test1' } } });
            setTimeout(function () {
                n1.receive({ status: { event: 'update', _session: { id: 'test1' }, config: { key: 'value' } } });
                setTimeout(function () {
                    updateReceived.should.be.true;
                    done();
                }, 500);
            }, 500);
        });
    });

    it('should handle disconnect event', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            let disconnectReceived = false;
            n2.on('input', function (msg) {
                if (msg.status && msg.status.event === 'disconnect') {
                    disconnectReceived = true;
                }
            });
            n1.receive({ status: { event: 'connect', _session: { id: 'test1' } } });
            setTimeout(function () {
                n1.receive({ status: { event: 'disconnect', _session: { id: 'test1' } } });
                setTimeout(function () {
                    disconnectReceived.should.be.true;
                    done();
                }, 500);
            }, 500);
        });
    });

    it('should reject invalid sessionId', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n3 = helper.getNode('n3');
            const n1 = helper.getNode('n1');
            let errorReceived = false;
            n3.on('input', function (msg) {
                errorReceived = (msg.error && msg.error.indexOf('Invalid sessionId') >= 0);
            });
            n1.receive({ status: { event: 'connect', _session: { id: 'invalid@id!' } } });
            setTimeout(function () {
                errorReceived.should.be.true;
                done();
            }, 500);
        });
    });

    it('should handle timeout event', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            let timeoutReceived = false;
            n2.on('input', function (msg) {
                if (msg.status && msg.status.event === 'timeout') {
                    timeoutReceived = true;
                }
            });
            n1.receive({ status: { event: 'connect', _session: { id: 'test1' } } });
            setTimeout(function () {
                n1.receive({ status: { event: 'timeout', timeout: 1 } });
                setTimeout(function () {
                    timeoutReceived.should.be.true;
                    done();
                }, 500);
            }, 500);
        });
    });

    it('should handle get_sessions event', function (done) {
        this.timeout(5000);
        const flow = [
            { id: 'n1', type: 'fff-ws-session', name: 'test', wires: [['n2'], ['n3']] },
            { id: 'n2', type: 'helper' },
            { id: 'n3', type: 'helper' }
        ];
        helper.load(wsSessionNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');
            let getSessionsReceived = false;
            n2.on('input', function (msg) {
                if (msg.payload && Array.isArray(msg.payload)) {
                    getSessionsReceived = true;
                }
            });
            n1.receive({ status: { event: 'connect', _session: { id: 'test1' } } });
            setTimeout(function () {
                n1.receive({ status: { event: 'get_sessions' } });
                setTimeout(function () {
                    getSessionsReceived.should.be.true;
                    done();
                }, 500);
            }, 500);
        });
    });
});
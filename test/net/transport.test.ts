
import { WebRTCConnection, WebSocketConnection } from 'net/transport';
import { LinkupManager, LinkupAddress } from 'net/linkup';
import { describeProxy } from 'config';
import { Connection } from 'net/transport/Connection';

describeProxy('Transports', () => {

    test('WebRTC send / answer', (done) => {
        let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        //let linkupServer2 = LinkupManager.defaultLinkupServer;
        let linkupServer1 = LinkupManager.defaultLinkupServer;

        let address1 = new LinkupAddress(linkupServer1, 'addressOne_C');
        let address2 = new LinkupAddress(linkupServer1, 'addressTwo_C');

        let theCallId = 'DUMMY_CALL_ID_TEST_C';
        let channelName = "test_data_channel";

        linkupManager2.listenForMessagesNewCall(address2, (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => {
            receiver;
            let conn2 = new WebRTCConnection(linkupManager2, address2, sender, callId, (conn: Connection) => {
                expect(sender.linkupId).toEqual(address1.linkupId);
                expect(conn.getConnectionId()).toEqual(theCallId);
            });
            conn2.setMessageCallback((message: any, _conn: Connection) => {
                expect(message).toEqual("hola");
                conn2.send("chau");
            });
            conn2.answer(message);
        });

        let conn1 = new WebRTCConnection(linkupManager1, address1, address2, theCallId, (conn: Connection) => {
            conn.send("hola");
        });

        conn1.setMessageCallback((message: any) => {
            expect(message).toEqual("chau");
            done();
        });

        conn1.open(channelName);
    }, 15000);

    test('WebSocket send / answer', (done) => {

        //let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        //let linkupServer2 = LinkupManager.defaultLinkupServer;

        let listenAddress1 = 'ws://localhost:10000';
        let listenAddress2 = 'ws://localhost:10001';

        let address1 = new LinkupAddress(listenAddress1, 'addressOne_D');
        let address2 = new LinkupAddress(listenAddress2, 'addressTwo_D');

        let theCallId = 'DUMMY_CALL_ID_TEST_D';

        linkupManager2.listenForMessagesNewCall(address2, (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => {
            receiver;
            let conn2 = new WebSocketConnection(callId, address2, sender, (conn: Connection) => {
                expect(sender.linkupId).toEqual(address1.linkupId);
                expect(conn.getConnectionId()).toEqual(theCallId);
            });

            conn2.setMessageCallback((message: any, _conn: Connection) => {
                expect(message).toEqual("hola");
                conn2.send("chau");
            });

            conn2.answer(message);
        });

        let conn1 = new WebSocketConnection(theCallId, address1, address2, (conn: Connection) => {
            conn.send("hola");
        });

        conn1.setMessageCallback((message: any) => {
            expect(message).toEqual("chau");
            done();
        });

        setTimeout(() => { conn1.open(); }, 100);
        


    }, 15000);


    test('WebRTC -> WebSocket send / answer', (done) => {

        //let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        //let linkupServer2 = LinkupManager.defaultLinkupServer;

        let listenAddress1 = LinkupManager.defaultLinkupServer;
        let listenAddress2 = 'ws://localhost:10011';

        let address1 = new LinkupAddress(listenAddress1, 'addressOne_F');
        let address2 = new LinkupAddress(listenAddress2, 'addressTwo_F');

        let theCallId = 'DUMMY_CALL_ID_TEST_F';

        linkupManager2.listenForMessagesNewCall(address2, (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => {
            receiver;
            let conn2 = new WebSocketConnection(callId, address2, sender, (conn: Connection) => {
                expect(sender.linkupId).toEqual(address1.linkupId);
                expect(conn.getConnectionId()).toEqual(theCallId);
            });

            conn2.setMessageCallback((message: any, _conn: Connection) => {
                expect(message).toEqual("hola");
                conn2.send("chau");
            });

            conn2.answer(message);
        });

        let conn1 = new WebSocketConnection(theCallId, address1, address2, (conn: Connection) => {
            conn.send("hola");
        });

        conn1.setMessageCallback((message: any) => {
            expect(message).toEqual("chau");
            done();
        });

        setTimeout(() => { conn1.open(); }, 100);
        


    }, 15000);


    test('WebSocket -> WebRTC send / answer w/reverse connection', (done) => {

        let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        //let linkupServer2 = LinkupManager.defaultLinkupServer;

        let listenAddress1 = 'ws://localhost:10020';
        let listenAddress2 = LinkupManager.defaultLinkupServer;

        let address1 = new LinkupAddress(listenAddress1, 'addressOne_E');
        let address2 = new LinkupAddress(listenAddress2, 'addressTwo_E');

        let theCallId = 'DUMMY_CALL_ID_TEST_E';

        linkupManager2.listenForMessagesNewCall(address2, (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => {
            receiver;
            let conn2 = new WebSocketConnection(callId, address2, sender, (conn: Connection) => {
                expect(sender.linkupId).toEqual(address1.linkupId);
                expect(conn.getConnectionId()).toEqual(theCallId);
                expect(conn.initiatedLocally()).toBeFalsy();
            });

            conn2.setMessageCallback((message: any, _conn: Connection) => {
                expect(message).toEqual("hola");
                conn2.send("chau");
            });

            conn2.answer(message);
        });

        let conns:any = {};

        linkupManager1.listenForMessagesNewCall(address1, (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => {
            
            sender; receiver;

            if (callId === theCallId) {
                let c = conns[callId];
                c.answer(message);
            }
            
        });

        let conn1 = new WebSocketConnection(theCallId, address1, address2, (conn: Connection) => {
            conn.send("hola");
        }, linkupManager1);

        conns[theCallId] = conn1;

        conn1.setMessageCallback((message: any) => {
            expect(message).toEqual("chau");
            expect(conn1.initiatedLocally()).toBeTruthy();
            done();
        });

        setTimeout(() => { conn1.open(); }, 100);
        


    }, 15000);



});

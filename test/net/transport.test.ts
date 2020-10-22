
import { WebRTCConnection, WebSocketConnection } from 'net/transport';
import { LinkupManager, LinkupAddress } from 'net/linkup';
import { describeProxy } from 'config';
import { Connection } from 'net/transport/Connection';
import { RNGImpl } from 'crypto/random';

describeProxy('[TRA] Transports', () => {

    test('[TRA01] WebRTC send / answer', (done) => {
        let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        //let linkupServer2 = LinkupManager.defaultLinkupServer;
        let linkupServer1 = LinkupManager.defaultLinkupServer;

        const rnd = new RNGImpl().randomHexString(64);

        let address1 = new LinkupAddress(linkupServer1, 'addressOne_C_' + rnd);
        let address2 = new LinkupAddress(linkupServer1, 'addressTwo_C_' + rnd);

        let theCallId = 'DUMMY_CALL_ID_TEST_C_' + rnd;
        let channelName = "test_data_channel";

        let conn2: WebRTCConnection|undefined = undefined;

        linkupManager2.listenForMessagesNewCall(address2, (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => {
            receiver;
            conn2 = new WebRTCConnection(linkupManager2, address2, sender, callId, (conn: Connection) => {
                expect(sender.linkupId).toEqual(address1.linkupId);
                expect(conn.getConnectionId()).toEqual(theCallId);
            });
            conn2.setMessageCallback((message: any, _conn: Connection) => {
                expect(message).toEqual("hola");
                conn2?.send("chau");
            });
            conn2.answer(message);
        });

        let conn1 = new WebRTCConnection(linkupManager1, address1, address2, theCallId, (conn: Connection) => {
            conn.send("hola");
        });

        conn1.setMessageCallback((message: any) => {
            expect(message).toEqual("chau");
            conn1.close();
            conn2?.close();
            linkupManager1.shutdown();
            linkupManager2.shutdown();
            done();
        });

        conn1.open(channelName);
    }, 15000);

    test('[TRA02] WebSocket send / answer', (done) => {

        //let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        //let linkupServer2 = LinkupManager.defaultLinkupServer;

        let listenAddress1 = 'ws://localhost:10000';
        let listenAddress2 = 'ws://localhost:10001';

        const rnd = new RNGImpl().randomHexString(64);

        let address1 = new LinkupAddress(listenAddress1, 'addressOne_D_' + rnd);
        let address2 = new LinkupAddress(listenAddress2, 'addressTwo_D_' + rnd);

        let theCallId = 'DUMMY_CALL_ID_TEST_D_' + rnd;

        let conn2: WebSocketConnection|undefined = undefined;

        linkupManager2.listenForMessagesNewCall(address2, (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => {
            receiver;
            conn2 = new WebSocketConnection(callId, address2, sender, (conn: Connection) => {
                expect(sender.linkupId).toEqual(address1.linkupId);
                expect(conn.getConnectionId()).toEqual(theCallId);
            });

            conn2.setMessageCallback((message: any, _conn: Connection) => {
                expect(message).toEqual("hola");
                conn2?.send("chau");
            });

            conn2.answer(message);
        });

        let conn1 = new WebSocketConnection(theCallId, address1, address2, (conn: Connection) => {
            conn.send("hola");
        });

        conn1.setMessageCallback((message: any) => {
            expect(message).toEqual("chau");
            conn1.close();
            conn2?.close();
            linkupManager2.shutdown();
            done();
        });

        setTimeout(() => { conn1.open(); }, 100);
        


    }, 15000);


    test('[TRA03] WebRTC -> WebSocket send / answer', (done) => {

        //let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        //let linkupServer2 = LinkupManager.defaultLinkupServer;

        let listenAddress1 = LinkupManager.defaultLinkupServer;
        let listenAddress2 = 'ws://localhost:10011';

        const rnd = new RNGImpl().randomHexString(64);

        let address1 = new LinkupAddress(listenAddress1, 'addressOne_F_' + rnd);
        let address2 = new LinkupAddress(listenAddress2, 'addressTwo_F_' + rnd);

        let theCallId = 'DUMMY_CALL_ID_TEST_F_' + rnd;

        let conn2: WebSocketConnection|undefined = undefined;

        linkupManager2.listenForMessagesNewCall(address2, (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => {
            receiver;
            conn2 = new WebSocketConnection(callId, address2, sender, (conn: Connection) => {
                expect(sender.linkupId).toEqual(address1.linkupId);
                expect(conn.getConnectionId()).toEqual(theCallId);
            });

            conn2.setMessageCallback((message: any, _conn: Connection) => {
                expect(message).toEqual("hola");
                conn2?.send("chau");
            });

            conn2.answer(message);
        });

        let conn1 = new WebSocketConnection(theCallId, address1, address2, (conn: Connection) => {
            conn.send("hola");
        });

        conn1.setMessageCallback((message: any) => {
            expect(message).toEqual("chau");
            conn1.close();
            conn2?.close();
            linkupManager2.shutdown();
            done();
        });

        setTimeout(() => { conn1.open(); }, 100);
        


    }, 15000);


    test('[TRA04] WebSocket -> WebRTC send / answer w/reverse connection', (done) => {

        let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        //let linkupServer2 = LinkupManager.defaultLinkupServer;

        let listenAddress1 = 'ws://localhost:10020';
        let listenAddress2 = LinkupManager.defaultLinkupServer;

        const rnd = new RNGImpl().randomHexString(64);

        let address1 = new LinkupAddress(listenAddress1, 'addressOne_E_' + rnd);
        let address2 = new LinkupAddress(listenAddress2, 'addressTwo_E_' + rnd);

        let theCallId = 'DUMMY_CALL_ID_TEST_E_' + rnd;

        let conn2: WebSocketConnection|undefined = undefined;

        linkupManager2.listenForMessagesNewCall(address2, (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => {
            receiver;
            conn2 = new WebSocketConnection(callId, address2, sender, (conn: Connection) => {
                expect(sender.linkupId).toEqual(address1.linkupId);
                expect(conn.getConnectionId()).toEqual(theCallId);
                expect(conn.initiatedLocally()).toBeFalsy();
            });

            conn2.setMessageCallback((message: any, _conn: Connection) => {
                expect(message).toEqual("hola");
                conn2?.send("chau");
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
            conn1.close();
            conn2?.close();
            linkupManager1.shutdown();
            linkupManager2.shutdown();
            done();
        });

        setTimeout(() => { conn1.open(); }, 100);
        


    }, 15000);



});

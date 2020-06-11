
import { WebRTCConnection } from 'net/transport';
import { LinkupManager, LinkupAddress } from 'net/linkup';

describe('Transports', () => {

    test('WebRTC send / answer', (done) => {
        let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        //let linkupServer2 = 'wss://mypeer.net:443';
        let linkupServer1 = 'ws://localhost:3002';

        let address1 = new LinkupAddress(linkupServer1, 'addressOne_C');
        let address2 = new LinkupAddress(linkupServer1, 'addressTwo_C');

        let theCallId = 'DUMMY_CALL_ID_TEST_C';
        let channelName = "test_data_channel";

        linkupManager2.listenForMessagesNewCall(address2, (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => {
            receiver;
            let conn2 = new WebRTCConnection(linkupManager2, address2, sender, callId, (conn: WebRTCConnection) => {
                expect(sender.linkupId).toEqual(address1.linkupId);
                expect(conn.getCallId()).toEqual(theCallId);
            });
            conn2.setMessageCallback((message: any, _conn: WebRTCConnection) => {
                expect(message).toEqual("hola");
                conn2.send("chau");
            });
            conn2.answer(message);
        });

        let conn1 = new WebRTCConnection(linkupManager1, address1, address2, theCallId, (conn: WebRTCConnection) => {
            conn.send("hola");
        });

        conn1.setMessageCallback((message: any) => {
            expect(message).toEqual("chau");
            done();
        });

        conn1.open(channelName);
    }, 15000);
});

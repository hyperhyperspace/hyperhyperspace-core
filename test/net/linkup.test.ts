import { LinkupManager, LinkupAddress } from 'net/linkup';
import { describeProxy } from 'config';
import { RNGImpl } from 'crypto/random';

describeProxy('[LNK] Single-host LinkupManager', () => {
    test('[LNK01] Call starting', (done) => {
        let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        const rnd = new RNGImpl().randomHexString(64);

        let address1 = new LinkupAddress(LinkupManager.defaultLinkupServer, 'addressOne_A_' + rnd);
        let address2 = new LinkupAddress(LinkupManager.defaultLinkupServer, 'addressTwo_A_' + rnd);

        let callId = 'DUMMY_CALL_ID_TEST_A';
        let message = 'MESSAGE_' + rnd;

        // one is going to listen for a message in a new call
        // two is going to send a message in a new call DUMMY_CALL_ID_TEST_A

        let int:any = undefined;

        linkupManager1.listenForMessagesNewCall(address1, (sender: LinkupAddress, recipient: LinkupAddress, rcvdCallId: string, rcvdMessage: any) => {
            
            expect(sender.linkupId).toEqual(address2.linkupId);
            expect(sender.serverURL).toEqual(address2.serverURL);
            expect(recipient.linkupId).toEqual(address1.linkupId);
            expect(recipient.serverURL).toEqual(address1.serverURL);
            expect(rcvdCallId).toEqual(callId);
            expect(rcvdMessage).toEqual(message);
            if (int !== undefined) { clearInterval(int); }
            linkupManager1.shutdown();
            linkupManager2.shutdown();
            done();
        });
        
        int = window.setInterval(() => {
            linkupManager2.sendMessageOnCall(address2, address1, callId, message);
        }, 100);

        

    }, 20000);

    test('[LNK02] Call answering', (done) => {
        let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        const rnd = new RNGImpl().randomHexString(64);

        let address1 = new LinkupAddress(LinkupManager.defaultLinkupServer, 'addressOne_B_' + rnd);
        let address2 = new LinkupAddress(LinkupManager.defaultLinkupServer, 'addressTwo_B_' + rnd);

        let callId =  'DUMMY_CALL_ID_TEST_B';
        let message = 'MESSAGE_' + rnd;
        let reply   = 'REPLY';

        // one is going to listen for a message in a new call
        // two is going to send a message in a new call DUMMY_CALL_ID_TEST_B
        // one is going to send a message back on call DUMMT_CALL_ID_TEST_B

        let int:any = undefined;

        linkupManager1.listenForMessagesNewCall(address1, (sender: LinkupAddress, recipient: LinkupAddress, rcvdCallId: string, rcvdMessage: any) => {
            expect(sender.linkupId).toEqual(address2.linkupId);
            expect(sender.serverURL).toEqual(address2.serverURL);
            expect(recipient.linkupId).toEqual(address1.linkupId);
            expect(recipient.serverURL).toEqual(address1.serverURL);
            expect(rcvdCallId).toEqual(callId);
            expect(rcvdMessage).toEqual(message);
            linkupManager1.sendMessageOnCall(address1, address2, callId, reply);
            
        });

        linkupManager2.listenForMessagesOnCall(address2, callId, (message: string) => {
            expect(message).toEqual(reply);
            if (int !== undefined) { clearInterval(int); }
            linkupManager1.shutdown();
            linkupManager2.shutdown();
            done();
        });
        
        int = window.setInterval(() => {
            linkupManager2.sendMessageOnCall(address2, address1, callId, message);
        }, 100);

        

    }, 20000);

    test('[LNK03] Raw messaging', (done) => {
        let linkupManager1 = new LinkupManager();
        let linkupManager2 = new LinkupManager();

        const rnd = new RNGImpl().randomHexString(64);

        let address1 = new LinkupAddress(LinkupManager.defaultLinkupServer, 'addressOne_C_' + rnd);
        let address2 = new LinkupAddress(LinkupManager.defaultLinkupServer, 'addressTwo_C_' + rnd);

        let message = 'MESSAGE_' + rnd;

        let int: any = undefined;

        linkupManager1.listenForRawMessages(address1, (sender: LinkupAddress, recipient: LinkupAddress, rcvdMessage: any) => {
            expect(sender.linkupId).toEqual(address2.linkupId);
            expect(sender.serverURL).toEqual(address2.serverURL);
            expect(recipient.linkupId).toEqual(address1.linkupId);
            expect(recipient.serverURL).toEqual(address1.serverURL);
            expect(rcvdMessage).toEqual(message);
            if (int !== undefined) { clearInterval(int); }
            linkupManager1.shutdown();
            linkupManager2.shutdown();
            done();
        });

        int = window.setInterval(() => {
            linkupManager2.sendRawMessage(address2, address1, message);
        }, 100);
    }, 20000);
});
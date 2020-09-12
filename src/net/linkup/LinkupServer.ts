import { LinkupAddress } from './LinkupAddress';

type NewCallMessageCallback = (sender: LinkupAddress, recipient: LinkupAddress, callId: string, message: any) => void;
type MessageCallback        = (message: any) => void;

type ListeningAddressesQueryCallback  = (queryId: string, matches: Array<LinkupAddress>) => void;


interface LinkupServer {
    listenForMessagesNewCall(recipient: LinkupAddress, callback: NewCallMessageCallback): void;
    listenForMessagesOnCall(recipient: LinkupAddress, callId: string, callback: MessageCallback): void;
    listenForLinkupAddressQueries(callback: ListeningAddressesQueryCallback): void;
    sendMessage(sender: LinkupAddress, recipient: LinkupAddress, callId: string, data: any): void;
    sendListeningAddressesQuery(queryId: string, addresses: Array<LinkupAddress>): void;
    close(): void;
}

export { LinkupServer, NewCallMessageCallback, MessageCallback, ListeningAddressesQueryCallback };
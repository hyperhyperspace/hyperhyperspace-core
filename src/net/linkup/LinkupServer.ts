import { LinkupAddress } from './LinkupAddress';

type NewCallMessageCallback = (sender: LinkupAddress, recipient: LinkupAddress, callId: string, instanceId: string, message: any) => void;
type MessageCallback        = (instanceId: string, message: any) => void;

type ListeningAddressesQueryCallback  = (queryId: string, matches: Array<LinkupAddress>) => void;

type RawMessageCallback = (sender: LinkupAddress, recipient: LinkupAddress, message: any) => void;

interface LinkupServer {
    listenForMessagesNewCall(recipient: LinkupAddress, callback: NewCallMessageCallback): void;
    listenForMessagesOnCall(recipient: LinkupAddress, callId: string, callback: MessageCallback): void;
    listenForLinkupAddressQueries(callback: ListeningAddressesQueryCallback): void;
    sendMessage(sender: LinkupAddress, recipient: LinkupAddress, callId: string, data: any): void;
    sendListeningAddressesQuery(queryId: string, addresses: Array<LinkupAddress>): void;

    listenForRawMessages(recipient: LinkupAddress, callback: RawMessageCallback): void;
    sendRawMessage(sender: LinkupAddress, recipient: LinkupAddress, data: any, sendLimit?: number): void;

    close(): void;
}

export { LinkupServer, RawMessageCallback, NewCallMessageCallback, MessageCallback, ListeningAddressesQueryCallback };
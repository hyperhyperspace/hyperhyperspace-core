
class WebRTCShim {
    static getNewRTCPeerConnection(servers: any) : RTCPeerConnection {
        return new RTCPeerConnection(servers);
    }
}

export { WebRTCShim }

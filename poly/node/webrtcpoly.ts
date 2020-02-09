
const DefaultRTCPeerConnection = require('wrtc').RTCPeerConnection;

class WebRTCShim {
    static getNewRTCPeerConnection(servers: any) : RTCPeerConnection {
        return new  DefaultRTCPeerConnection(servers);
    }
}

export { WebRTCShim }
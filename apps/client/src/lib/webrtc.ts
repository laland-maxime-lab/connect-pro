// webrtc.ts — WebRTC peer connection for the CONTROLLER (client side)
// Receives video stream from host, sends input events via DataChannel

export interface WebRTCClientOptions {
  sessionId: string;
  myDeviceId: string;
  partnerDeviceId: string;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionState: (state: 'connecting' | 'connected' | 'relay' | 'failed') => void;
  onLatency: (ms: number) => void;
  sendSignal: (payload: object) => void;
  sendRelay: (data: object) => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export class WebRTCClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private opts: WebRTCClientOptions;
  private connected = false;
  private useRelay = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private iceTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingStart = 0;

  constructor(opts: WebRTCClientOptions) {
    this.opts = opts;
  }

  /** Controller initiates — creates offer */
  async initiate() {
    this.cleanup();
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.opts.onConnectionState('connecting');

    // Create DataChannel for input events (controller → host)
    this.dc = this.pc.createDataChannel('input', { ordered: true });
    this.setupDataChannel(this.dc);

    // Receive video stream from host
    this.pc.ontrack = (e) => {
      if (e.streams[0]) this.opts.onRemoteStream(e.streams[0]);
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.opts.sendSignal({
          type: 'ice-candidate',
          sessionId: this.opts.sessionId,
          targetDeviceId: this.opts.partnerDeviceId,
          fromDeviceId: this.opts.myDeviceId,
          candidate: e.candidate.toJSON(),
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      if (state === 'connected') {
        if (this.iceTimeout) clearTimeout(this.iceTimeout);
        this.connected = true;
        this.opts.onConnectionState('connected');
        this.startPing();
      } else if (state === 'failed' || state === 'disconnected') {
        this.fallbackRelay();
      }
    };

    // 15s ICE timeout → relay fallback
    this.iceTimeout = setTimeout(() => {
      if (!this.connected && !this.useRelay) this.fallbackRelay();
    }, 15_000);

    const offer = await this.pc.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: false,
    });
    await this.pc.setLocalDescription(offer);

    this.opts.sendSignal({
      type: 'offer',
      sessionId: this.opts.sessionId,
      targetDeviceId: this.opts.partnerDeviceId,
      fromDeviceId: this.opts.myDeviceId,
      sdp: offer,
    });
  }

  /** Handle incoming signaling messages */
  async handleSignal(payload: any) {
    if (!this.pc) return;
    try {
      if (payload.type === 'answer' && payload.sdp) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } else if (payload.type === 'ice-candidate' && payload.candidate) {
        await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    } catch (e) {
      console.error('[WebRTC] Signal error:', e);
    }
  }

  /** Handle relay data (fallback path) */
  handleRelay(data: any) {
    if (data.type === 'pong') {
      this.opts.onLatency(Math.max(1, Date.now() - this.pingStart));
    }
  }

  /** Send an input event to the host */
  sendInput(event: object) {
    const msg = JSON.stringify(event);
    if (this.dc?.readyState === 'open' && !this.useRelay) {
      try {
        this.dc.send(msg);
        return;
      } catch { /* fall through to relay */ }
    }
    this.opts.sendRelay(event);
  }

  private setupDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => {
      this.connected = true;
      this.opts.onConnectionState('connected');
      this.startPing();
    };
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'pong') {
          this.opts.onLatency(Math.max(1, Date.now() - this.pingStart));
        }
      } catch { /* ignore */ }
    };
    dc.onclose = () => {
      if (!this.useRelay) this.fallbackRelay();
    };
  }

  private startPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      this.pingStart = Date.now();
      this.sendInput({ type: 'ping', timestamp: this.pingStart });
    }, 2000);
  }

  private fallbackRelay() {
    if (this.useRelay) return;
    this.useRelay = true;
    this.connected = true;
    this.opts.onConnectionState('relay');
    this.startPing();
  }

  cleanup() {
    if (this.iceTimeout) clearTimeout(this.iceTimeout);
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.dc?.close();
    this.pc?.close();
    this.pc = null;
    this.dc = null;
    this.connected = false;
    this.useRelay = false;
  }
}

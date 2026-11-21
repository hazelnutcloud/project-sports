import type {
  PeerConnectionStatus,
  RealtimeMessage,
  ReliableMessage,
  SignalPayload,
} from '../types/network';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

interface PeerSlot {
  peerId: string;
  pc: RTCPeerConnection;
  reliable: RTCDataChannel | null;
  realtime: RTCDataChannel | null;
  status: PeerConnectionStatus;
  pendingIce: RTCIceCandidateInit[];
  isInitiator: boolean;
}

export interface PeerManagerCallbacks {
  sendSignal: (toPeerId: string, payload: SignalPayload) => void;
  onReliableMessage: (fromPeerId: string, msg: ReliableMessage) => void;
  onRealtimeMessage: (fromPeerId: string, msg: RealtimeMessage) => void;
  onPeerStatusChange: (peerId: string, status: PeerConnectionStatus) => void;
}

export class PeerManager {
  public readonly localPeerId: string;
  private readonly peers = new Map<string, PeerSlot>();
  private readonly callbacks: PeerManagerCallbacks;

  constructor(localPeerId: string, callbacks: PeerManagerCallbacks) {
    this.localPeerId = localPeerId;
    this.callbacks = callbacks;
  }

  public async connectToPeer(remotePeerId: string, forceInitiator?: boolean): Promise<void> {
    if (remotePeerId === this.localPeerId) return;
    if (this.peers.has(remotePeerId)) return;

    const isInitiator = forceInitiator ?? this.localPeerId < remotePeerId;
    const slot = this.createPeerSlot(remotePeerId, isInitiator);

    if (isInitiator) {
      const reliable = slot.pc.createDataChannel('reliable', { ordered: true });
      const realtime = slot.pc.createDataChannel('realtime', {
        ordered: false,
        maxRetransmits: 0,
      });
      this.attachChannel(slot, reliable, 'reliable');
      this.attachChannel(slot, realtime, 'realtime');

      const offer = await slot.pc.createOffer();
      await slot.pc.setLocalDescription(offer);
      this.callbacks.sendSignal(remotePeerId, { kind: 'offer', sdp: offer });
    }
  }

  public async handleSignal(fromPeerId: string, payload: SignalPayload): Promise<void> {
    let slot = this.peers.get(fromPeerId);
    if (!slot) {
      slot = this.createPeerSlot(fromPeerId, false);
    }

    if (payload.kind === 'offer') {
      // Polite glare resolution: if both offered simultaneously, lexicographically larger peer yields
      const offerCollision = slot.pc.signalingState !== 'stable';
      const isPolite = this.localPeerId > fromPeerId;
      if (offerCollision && !isPolite) {
        return;
      }
      if (offerCollision) {
        await slot.pc.setLocalDescription({ type: 'rollback' });
      }

      await slot.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await this.flushPendingIce(slot);

      const answer = await slot.pc.createAnswer();
      await slot.pc.setLocalDescription(answer);
      this.callbacks.sendSignal(fromPeerId, { kind: 'answer', sdp: answer });
      return;
    }

    if (payload.kind === 'answer') {
      if (slot.pc.signalingState === 'have-local-offer') {
        await slot.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await this.flushPendingIce(slot);
      }
      return;
    }

    if (payload.kind === 'ice') {
      if (slot.pc.remoteDescription) {
        try {
          await slot.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // Ignore stale candidates
        }
      } else {
        slot.pendingIce.push(payload.candidate);
      }
    }
  }

  public disconnectPeer(remotePeerId: string): void {
    const slot = this.peers.get(remotePeerId);
    if (!slot) return;
    slot.reliable?.close();
    slot.realtime?.close();
    slot.pc.close();
    this.peers.delete(remotePeerId);
    this.callbacks.onPeerStatusChange(remotePeerId, 'disconnected');
  }

  public closeAll(): void {
    for (const id of Array.from(this.peers.keys())) {
      this.disconnectPeer(id);
    }
  }

  public getStatus(remotePeerId: string): PeerConnectionStatus {
    return this.peers.get(remotePeerId)?.status ?? 'disconnected';
  }

  public getConnectedPeerIds(): string[] {
    return Array.from(this.peers.values())
      .filter((s) => s.status === 'connected')
      .map((s) => s.peerId);
  }

  public sendReliable(remotePeerId: string, msg: ReliableMessage): boolean {
    const ch = this.peers.get(remotePeerId)?.reliable;
    if (ch && ch.readyState === 'open') {
      ch.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  public broadcastReliable(msg: ReliableMessage, filterPeerIds?: string[]): void {
    const raw = JSON.stringify(msg);
    const allowed = filterPeerIds ? new Set(filterPeerIds) : null;
    for (const slot of this.peers.values()) {
      if (allowed && !allowed.has(slot.peerId)) continue;
      if (slot.reliable && slot.reliable.readyState === 'open') {
        slot.reliable.send(raw);
      }
    }
  }

  public sendRealtime(remotePeerId: string, msg: RealtimeMessage): boolean {
    const ch = this.peers.get(remotePeerId)?.realtime;
    if (ch && ch.readyState === 'open') {
      // Backpressure guard for high-frequency IMU/snapshot messages
      if (ch.bufferedAmount > 16384) return false;
      ch.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  public broadcastRealtime(msg: RealtimeMessage, filterPeerIds?: string[]): void {
    const raw = JSON.stringify(msg);
    const allowed = filterPeerIds ? new Set(filterPeerIds) : null;
    for (const slot of this.peers.values()) {
      if (allowed && !allowed.has(slot.peerId)) continue;
      if (
        slot.realtime &&
        slot.realtime.readyState === 'open' &&
        slot.realtime.bufferedAmount <= 16384
      ) {
        slot.realtime.send(raw);
      }
    }
  }

  private createPeerSlot(remotePeerId: string, isInitiator: boolean): PeerSlot {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const slot: PeerSlot = {
      peerId: remotePeerId,
      pc,
      reliable: null,
      realtime: null,
      status: 'connecting',
      pendingIce: [],
      isInitiator,
    };
    this.peers.set(remotePeerId, slot);
    this.callbacks.onPeerStatusChange(remotePeerId, 'connecting');

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.callbacks.sendSignal(remotePeerId, {
          kind: 'ice',
          candidate: ev.candidate.toJSON(),
        });
      }
    };

    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      if (ch.label === 'reliable') {
        this.attachChannel(slot, ch, 'reliable');
      } else if (ch.label === 'realtime') {
        this.attachChannel(slot, ch, 'realtime');
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed' || state === 'closed') {
        this.updateStatus(slot, 'failed');
      } else if (state === 'disconnected') {
        this.updateStatus(slot, 'disconnected');
      } else if (state === 'connected') {
        this.checkReady(slot);
      }
    };

    return slot;
  }

  private attachChannel(
    slot: PeerSlot,
    channel: RTCDataChannel,
    kind: 'reliable' | 'realtime'
  ): void {
    if (kind === 'reliable') {
      slot.reliable = channel;
    } else {
      slot.realtime = channel;
    }

    channel.onopen = () => {
      this.checkReady(slot);
    };

    channel.onclose = () => {
      if (kind === 'reliable') {
        this.updateStatus(slot, 'disconnected');
      }
    };

    channel.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data));
        if (kind === 'reliable') {
          this.callbacks.onReliableMessage(slot.peerId, parsed as ReliableMessage);
        } else {
          this.callbacks.onRealtimeMessage(slot.peerId, parsed as RealtimeMessage);
        }
      } catch {
        // Ignore malformed packets
      }
    };
  }

  private checkReady(slot: PeerSlot): void {
    if (slot.reliable?.readyState === 'open') {
      this.updateStatus(slot, 'connected');
    }
  }

  private updateStatus(slot: PeerSlot, status: PeerConnectionStatus): void {
    if (slot.status === status) return;
    slot.status = status;
    this.callbacks.onPeerStatusChange(slot.peerId, status);
  }

  private async flushPendingIce(slot: PeerSlot): Promise<void> {
    const queue = slot.pendingIce.splice(0, slot.pendingIce.length);
    for (const candidate of queue) {
      try {
        await slot.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale candidates
      }
    }
  }
}

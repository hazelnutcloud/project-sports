import type { SportId } from '../data/sports';
import type {
  PeerRole,
  RoomPeerInfo,
  SignalPayload,
  SignalingInMessage,
  SignalingOutMessage,
} from '../types/network';

export interface SignalingEvents {
  onOpen?: () => void;
  onClose?: () => void;
  onRoomJoined?: (data: {
    roomCode: string;
    peerId: string;
    hostDisplayId: string | null;
    sport?: SportId;
    peers: RoomPeerInfo[];
  }) => void;
  onPeerJoined?: (peer: RoomPeerInfo, hostDisplayId: string | null) => void;
  onPeerLeft?: (peerId: string, hostDisplayId: string | null) => void;
  onSignal?: (fromPeerId: string, payload: SignalPayload) => void;
  onError?: (message: string, code?: string) => void;
}

export class SignalingClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: number | null = null;
  private readonly url: string;
  private events: SignalingEvents;

  constructor(events: SignalingEvents, customUrl?: string) {
    this.events = events;
    if (customUrl) {
      this.url = customUrl;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.url = `${protocol}//${window.location.host}/ws`;
    }
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const ws = new WebSocket(this.url);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        settled = true;
        this.startHeartbeat();
        this.events.onOpen?.();
        resolve();
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("Couldn't reach the game room. Check your Wi-Fi and try again."));
        }
      };

      ws.onclose = () => {
        this.stopHeartbeat();
        this.events.onClose?.();
      };

      ws.onmessage = (ev) => {
        let msg: SignalingInMessage;
        try {
          msg = JSON.parse(String(ev.data)) as SignalingInMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'room-joined':
            this.events.onRoomJoined?.({
              roomCode: msg.roomCode,
              peerId: msg.peerId,
              hostDisplayId: msg.hostDisplayId,
              sport: msg.sport,
              peers: msg.peers,
            });
            break;
          case 'peer-joined':
            this.events.onPeerJoined?.(msg.peer, msg.hostDisplayId);
            break;
          case 'peer-left':
            this.events.onPeerLeft?.(msg.peerId, msg.hostDisplayId);
            break;
          case 'signal':
            this.events.onSignal?.(msg.fromPeerId, msg.payload);
            break;
          case 'error':
            this.events.onError?.(msg.message, msg.code);
            break;
          case 'pong':
            break;
        }
      };
    });
  }

  public send(msg: SignalingOutMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public createRoom(peerId: string, displayName: string, sport: SportId = 'bowling'): void {
    this.send({ type: 'create-room', peerId, displayName, sport });
  }

  public joinRoom(
    roomCode: string,
    peerId: string,
    role: PeerRole,
    displayName: string,
    targetDisplayId?: string
  ): void {
    this.send({
      type: 'join-room',
      roomCode: roomCode.trim().toUpperCase(),
      peerId,
      role,
      displayName,
      targetDisplayId,
    });
  }

  public sendSignal(toPeerId: string, payload: SignalPayload): void {
    this.send({ type: 'signal', toPeerId, payload });
  }

  public close(): void {
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.send({ type: 'leave-room' });
      } catch {
        // ignore
      }
      this.ws.close();
      this.ws = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

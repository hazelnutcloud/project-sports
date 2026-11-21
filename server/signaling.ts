import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';

export type PeerRole = 'display' | 'controller';
export type RoomSportId = 'bowling' | 'tennis' | 'golf' | 'badminton';

export interface RoomPeerInfo {
  peerId: string;
  role: PeerRole;
  displayName: string;
  targetDisplayId?: string;
}

interface InternalPeer extends RoomPeerInfo {
  ws: WebSocket;
}

interface Room {
  code: string;
  sport: RoomSportId;
  hostDisplayId: string | null;
  peers: Map<string, InternalPeer>;
}

function normalizeSport(val: unknown): RoomSportId {
  if (val === 'tennis' || val === 'golf' || val === 'badminton') return val;
  return 'bowling';
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  return `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

function safeSend(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export class SignalingHub {
  private readonly rooms = new Map<string, Room>();
  private readonly socketMeta = new Map<
    WebSocket,
    { roomCode: string; peerId: string }
  >();

  public handleConnection(ws: WebSocket): void {
    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        safeSend(ws, { type: 'error', message: 'Invalid JSON payload' });
        return;
      }

      const type = msg.type;
      if (type === 'ping') {
        safeSend(ws, { type: 'pong', ts: Date.now() });
        return;
      }

      if (type === 'create-room') {
        this.handleCreateRoom(ws, msg);
        return;
      }

      if (type === 'join-room') {
        this.handleJoinRoom(ws, msg);
        return;
      }

      if (type === 'signal') {
        this.handleSignal(ws, msg);
        return;
      }

      if (type === 'leave-room') {
        this.removeSocket(ws);
        return;
      }
    });

    ws.on('close', () => {
      this.removeSocket(ws);
    });

    ws.on('error', () => {
      this.removeSocket(ws);
    });
  }

  public getRoomCount(): number {
    return this.rooms.size;
  }

  public getRoomSport(code: string): RoomSportId | null {
    const room = this.rooms.get(code.trim().toUpperCase());
    return room ? room.sport : null;
  }

  public getRoomPeers(code: string): RoomPeerInfo[] {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return [];
    return Array.from(room.peers.values()).map((p) => ({
      peerId: p.peerId,
      role: p.role,
      displayName: p.displayName,
      targetDisplayId: p.targetDisplayId,
    }));
  }

  private handleCreateRoom(ws: WebSocket, msg: Record<string, unknown>): void {
    this.removeSocket(ws);

    const peerId = String(msg.peerId ?? '').trim();
    const displayName = String(msg.displayName ?? 'Host Screen').trim() || 'Host Screen';
    if (!peerId) {
      safeSend(ws, { type: 'error', message: 'peerId is required' });
      return;
    }

    const requested = typeof msg.roomCode === 'string' ? msg.roomCode.trim().toUpperCase() : '';
    const code =
      requested.length === 4 && !this.rooms.has(requested)
        ? requested
        : generateRoomCode(new Set(this.rooms.keys()));

    const peer: InternalPeer = {
      peerId,
      role: 'display',
      displayName,
      ws,
    };

    const sport = normalizeSport(msg.sport);
    const room: Room = {
      code,
      sport,
      hostDisplayId: peerId,
      peers: new Map([[peerId, peer]]),
    };
    this.rooms.set(code, room);
    this.socketMeta.set(ws, { roomCode: code, peerId });

    safeSend(ws, {
      type: 'room-joined',
      roomCode: code,
      peerId,
      hostDisplayId: room.hostDisplayId,
      sport: room.sport,
      peers: this.serializePeers(room),
    });
  }

  private handleJoinRoom(ws: WebSocket, msg: Record<string, unknown>): void {
    this.removeSocket(ws);

    const roomCode = String(msg.roomCode ?? '').trim().toUpperCase();
    const peerId = String(msg.peerId ?? '').trim();
    const role: PeerRole = msg.role === 'controller' ? 'controller' : 'display';
    const displayName =
      String(msg.displayName ?? '').trim() ||
      (role === 'controller' ? 'Player Phone' : 'Guest Screen');
    const targetDisplayId =
      typeof msg.targetDisplayId === 'string' && msg.targetDisplayId.trim()
        ? msg.targetDisplayId.trim()
        : undefined;

    if (!roomCode || !peerId) {
      safeSend(ws, { type: 'error', message: 'roomCode and peerId are required' });
      return;
    }

    const room = this.rooms.get(roomCode);
    if (!room) {
      safeSend(ws, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: `Room "${roomCode}" was not found. Double-check the 4-letter code.`,
      });
      return;
    }

    // If a peer reconnects with the same peerId, replace old entry cleanly
    const existing = room.peers.get(peerId);
    if (existing && existing.ws !== ws) {
      this.socketMeta.delete(existing.ws);
      existing.ws.close();
    }

    const resolvedTarget =
      role === 'controller'
        ? targetDisplayId && room.peers.has(targetDisplayId)
          ? targetDisplayId
          : room.hostDisplayId ?? undefined
        : undefined;

    const peer: InternalPeer = {
      peerId,
      role,
      displayName,
      targetDisplayId: resolvedTarget,
      ws,
    };
    room.peers.set(peerId, peer);
    if (!room.hostDisplayId && role === 'display') {
      room.hostDisplayId = peerId;
    }
    this.socketMeta.set(ws, { roomCode, peerId });

    const peerInfo: RoomPeerInfo = {
      peerId: peer.peerId,
      role: peer.role,
      displayName: peer.displayName,
      targetDisplayId: peer.targetDisplayId,
    };

    safeSend(ws, {
      type: 'room-joined',
      roomCode,
      peerId,
      hostDisplayId: room.hostDisplayId,
      sport: room.sport,
      peers: this.serializePeers(room),
    });

    for (const other of room.peers.values()) {
      if (other.peerId !== peerId) {
        safeSend(other.ws, {
          type: 'peer-joined',
          peer: peerInfo,
          hostDisplayId: room.hostDisplayId,
        });
      }
    }
  }

  private handleSignal(ws: WebSocket, msg: Record<string, unknown>): void {
    const meta = this.socketMeta.get(ws);
    if (!meta) return;

    const room = this.rooms.get(meta.roomCode);
    if (!room) return;

    const toPeerId = String(msg.toPeerId ?? '');
    const target = room.peers.get(toPeerId);
    if (!target) return;

    safeSend(target.ws, {
      type: 'signal',
      fromPeerId: meta.peerId,
      payload: msg.payload,
    });
  }

  private removeSocket(ws: WebSocket): void {
    const meta = this.socketMeta.get(ws);
    if (!meta) return;
    this.socketMeta.delete(ws);

    const room = this.rooms.get(meta.roomCode);
    if (!room) return;

    const entry = room.peers.get(meta.peerId);
    if (entry && entry.ws === ws) {
      room.peers.delete(meta.peerId);
    } else {
      return;
    }

    if (room.hostDisplayId === meta.peerId) {
      const nextDisplay = Array.from(room.peers.values()).find(
        (p) => p.role === 'display'
      );
      room.hostDisplayId = nextDisplay ? nextDisplay.peerId : null;
    }

    if (room.peers.size === 0) {
      this.rooms.delete(meta.roomCode);
      return;
    }

    for (const remaining of room.peers.values()) {
      safeSend(remaining.ws, {
        type: 'peer-left',
        peerId: meta.peerId,
        hostDisplayId: room.hostDisplayId,
      });
    }
  }

  private serializePeers(room: Room): RoomPeerInfo[] {
    return Array.from(room.peers.values()).map((p) => ({
      peerId: p.peerId,
      role: p.role,
      displayName: p.displayName,
      targetDisplayId: p.targetDisplayId,
    }));
  }
}

export interface UpgradeableServer {
  on(
    event: 'upgrade',
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
  ): unknown;
}

export function attachSignalingServer(
  httpServer: HttpServer | HttpsServer | UpgradeableServer,
  wsPath = '/ws'
): { wss: WebSocketServer; hub: SignalingHub } {
  const wss = new WebSocketServer({ noServer: true });
  const hub = new SignalingHub();

  wss.on('connection', (ws) => {
    hub.handleConnection(ws);
  });

  httpServer.on(
    'upgrade',
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url ?? '/', 'https://localhost');
      if (url.pathname !== wsPath) {
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  );

  return { wss, hub };
}

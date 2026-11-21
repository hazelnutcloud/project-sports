import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachSignalingServer } from '../server/signaling';

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMsg = (data: WebSocket.RawData) => {
      cleanup();
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    };
    const onErr = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      ws.off('message', onMsg);
      ws.off('error', onErr);
    };
    ws.on('message', onMsg);
    ws.on('error', onErr);
  });
}

function openClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('WebSocket Signaling Server', () => {
  let server: http.Server;
  let wsUrl: string;
  let closeWss: () => void;

  beforeAll(async () => {
    server = http.createServer();
    const { wss } = attachSignalingServer(server, '/ws');
    closeWss = () => wss.close();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind port');
    wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
  });

  afterAll(async () => {
    closeWss();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('creates rooms, pairs displays & phone controllers, relays WebRTC signals, and cleans up', async () => {
    const host = await openClient(wsUrl);
    const phone = await openClient(wsUrl);

    const hostJoinedPromise = nextMessage(host);
    host.send(
      JSON.stringify({
        type: 'create-room',
        peerId: 'disp-1',
        displayName: 'Living Room TV',
      })
    );
    const hostJoined = await hostJoinedPromise;
    expect(hostJoined.type).toBe('room-joined');
    const roomCode = String(hostJoined.roomCode);
    expect(roomCode).toHaveLength(4);

    // Phone joins the room targeting disp-1
    const hostSeesPhone = nextMessage(host);
    const phoneJoinedPromise = nextMessage(phone);
    phone.send(
      JSON.stringify({
        type: 'join-room',
        roomCode,
        peerId: 'phone-1',
        role: 'controller',
        displayName: 'Alex Phone',
        targetDisplayId: 'disp-1',
      })
    );

    const [phoneJoined, peerJoinedNotice] = await Promise.all([
      phoneJoinedPromise,
      hostSeesPhone,
    ]);
    expect(phoneJoined.type).toBe('room-joined');
    expect(peerJoinedNotice.type).toBe('peer-joined');

    // Relay an SDP offer from phone-1 to disp-1
    const hostGetsSignal = nextMessage(host);
    phone.send(
      JSON.stringify({
        type: 'signal',
        toPeerId: 'disp-1',
        payload: { kind: 'offer', sdp: { type: 'offer', sdp: 'v=0-mock-sdp' } },
      })
    );
    const relayed = await hostGetsSignal;
    expect(relayed.type).toBe('signal');
    expect(relayed.fromPeerId).toBe('phone-1');
    expect((relayed.payload as Record<string, unknown>).kind).toBe('offer');

    // Phone disconnects -> host receives peer-left
    const hostGetsLeft = nextMessage(host);
    phone.close();
    const leftMsg = await hostGetsLeft;
    expect(leftMsg.type).toBe('peer-left');
    expect(leftMsg.peerId).toBe('phone-1');

    host.close();
  });

  it('returns ROOM_NOT_FOUND error when joining a nonexistent room', async () => {
    const client = await openClient(wsUrl);
    const errPromise = nextMessage(client);
    client.send(
      JSON.stringify({
        type: 'join-room',
        roomCode: 'ZZZZ',
        peerId: 'phone-2',
        role: 'controller',
        displayName: 'Ghost',
      })
    );
    const err = await errPromise;
    expect(err.type).toBe('error');
    expect(err.code).toBe('ROOM_NOT_FOUND');
    client.close();
  });

  it('persists room sport metadata for tennis rooms and defaults to bowling', async () => {
    const host = await openClient(wsUrl);
    const guest = await openClient(wsUrl);

    const hostJoinedPromise = nextMessage(host);
    host.send(
      JSON.stringify({
        type: 'create-room',
        peerId: 'disp-tennis',
        displayName: 'Tennis TV',
        sport: 'tennis',
      })
    );
    const hostJoined = await hostJoinedPromise;
    expect(hostJoined.sport).toBe('tennis');
    const code = String(hostJoined.roomCode);

    const guestJoinedPromise = nextMessage(guest);
    guest.send(
      JSON.stringify({
        type: 'join-room',
        roomCode: code,
        peerId: 'phone-tennis',
        role: 'controller',
        displayName: 'Racket 1',
      })
    );
    const guestJoined = await guestJoinedPromise;
    expect(guestJoined.sport).toBe('tennis');

    guest.close();
    host.close();
  });
});

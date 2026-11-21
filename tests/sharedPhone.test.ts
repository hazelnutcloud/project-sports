import { describe, expect, it, vi } from 'vitest';
import type { MatchState, PlayerProfile, ThrowParams } from '../src/types/game';
import type { ReliableMessage, RealtimeMessage, RoomPeerInfo } from '../src/types/network';
import {
  buildControllerStatusPayloads,
  DisplayLobbyController,
  MAX_ROOM_PLAYERS,
} from '../src/network/LobbyController';
import { createEmptyScorecard } from '../src/rules/scoring';

// Mock SignalingClient and PeerManager so we can drive DisplayLobbyController deterministically in Node
type MockSignalingEvents = {
  onRoomJoined?: (data: {
    roomCode: string;
    peerId: string;
    hostDisplayId: string | null;
    peers: RoomPeerInfo[];
  }) => void;
  onPeerJoined?: (peer: RoomPeerInfo, hostDisplayId: string | null) => void;
  onPeerLeft?: (peerId: string, hostDisplayId: string | null) => void;
};

type MockPeerCallbacks = {
  onReliableMessage: (fromPeerId: string, msg: ReliableMessage) => void;
  onRealtimeMessage: (fromPeerId: string, msg: RealtimeMessage) => void;
  onPeerStatusChange: (peerId: string, status: 'connected' | 'disconnected') => void;
};

const harness = {
  signalingEvents: null as MockSignalingEvents | null,
  peerCallbacks: null as MockPeerCallbacks | null,
  sentReliable: [] as Array<{ to: string; msg: ReliableMessage }>,
};

vi.mock('../src/network/SignalingClient', () => ({
  SignalingClient: class {
    constructor(events: MockSignalingEvents) {
      harness.signalingEvents = events;
    }
    async connect() {}
    createRoom() {}
    joinRoom() {}
    sendSignal() {}
    close() {}
  },
}));

vi.mock('../src/network/PeerManager', () => ({
  PeerManager: class {
    constructor(_localPeerId: string, callbacks: MockPeerCallbacks) {
      harness.peerCallbacks = callbacks;
    }
    async connectToPeer() {}
    async handleSignal() {}
    disconnectPeer() {}
    closeAll() {}
    sendReliable(to: string, msg: ReliableMessage) {
      harness.sentReliable.push({ to, msg });
      return true;
    }
    broadcastReliable(msg: ReliableMessage, filterPeerIds?: string[]) {
      for (const to of filterPeerIds ?? []) {
        harness.sentReliable.push({ to, msg });
      }
    }
    sendRealtime() {
      return true;
    }
    broadcastRealtime() {}
  },
}));

function makeHostController() {
  harness.sentReliable = [];
  const remoteAims: Array<{ playerId: string; xOffset: number }> = [];
  const remotePoses: Array<{ playerId: string }> = [];
  const throws: Array<{ playerId: string; params: ThrowParams }> = [];

  const controller = new DisplayLobbyController(
    {
      onMatchStateChange: () => {},
      onPeerStatusesChange: () => {},
      onRemoteAim: (playerId, aim) => remoteAims.push({ playerId, xOffset: aim.xOffset }),
      onRemoteArmPose: (playerId) => remotePoses.push({ playerId }),
      onThrowRelease: (playerId, params) => throws.push({ playerId, params }),
      onRemoteLaneSnapshot: () => {},
      onCallout: () => {},
      onError: () => {},
    },
    'disp-host'
  );

  // Simulate host room creation
  harness.signalingEvents?.onRoomJoined?.({
    roomCode: 'ABCD',
    peerId: 'disp-host',
    hostDisplayId: 'disp-host',
    peers: [{ peerId: 'disp-host', role: 'display', displayName: 'TV' }],
  });

  const connectPhone = (peerId: string, displayName: string) => {
    const peer: RoomPeerInfo = {
      peerId,
      role: 'controller',
      displayName,
      targetDisplayId: 'disp-host',
    };
    harness.signalingEvents?.onPeerJoined?.(peer, 'disp-host');
    harness.peerCallbacks?.onPeerStatusChange(peerId, 'connected');
  };

  const disconnectPhone = (peerId: string) => {
    harness.signalingEvents?.onPeerLeft?.(peerId, 'disp-host');
  };

  const fromPeer = (peerId: string, msg: ReliableMessage) => {
    harness.peerCallbacks?.onReliableMessage(peerId, msg);
  };

  const fromPeerRealtime = (peerId: string, msg: RealtimeMessage) => {
    harness.peerCallbacks?.onRealtimeMessage(peerId, msg);
  };

  const lastStatusSentTo = (peerId: string) => {
    const matching = harness.sentReliable.filter(
      (entry) => entry.to === peerId && entry.msg.type === 'controller-status'
    );
    return matching[matching.length - 1]?.msg;
  };

  return {
    controller,
    connectPhone,
    disconnectPhone,
    fromPeer,
    fromPeerRealtime,
    lastStatusSentTo,
    remoteAims,
    remotePoses,
    throws,
  };
}

describe('Shared Phone Pass-and-Play Multiplayer', () => {
  it('registers multiple players on one phone, enforces 4-player max, and sends a single consolidated status per phone', () => {
    const ctx = makeHostController();

    // Phone 1 connects -> registers Alex automatically
    ctx.connectPhone('phone-1', 'Alex');
    expect(ctx.controller.getState().players).toHaveLength(1);
    expect(ctx.controller.getState().players[0].name).toBe('Alex');

    // Phone 1 requests adding Sam & Taylor directly from the phone
    ctx.fromPeer('phone-1', {
      type: 'request-register-player',
      name: 'Sam',
      displayId: 'disp-host',
      controllerPeerId: 'phone-1',
      allowSharedController: true,
    });
    ctx.controller.addPhonePlayer('phone-1', 'Taylor');
    ctx.controller.addPhonePlayer('phone-1', 'Jordan');
    // 5th player must be ignored (max 4)
    ctx.controller.addPhonePlayer('phone-1', 'Overflow');

    const state = ctx.controller.getState();
    expect(state.players).toHaveLength(MAX_ROOM_PLAYERS);
    expect(state.players.map((p) => p.name)).toEqual(['Alex', 'Sam', 'Taylor', 'Jordan']);
    expect(new Set(state.players.map((p) => p.controllerPeerId))).toEqual(new Set(['phone-1']));
    expect(new Set(state.players.map((p) => p.color)).size).toBe(4);
    expect(new Set(state.players.map((p) => p.laneIndex)).size).toBe(4);

    // Consolidated status payload lists all 4 players in one message
    const lastStatus = ctx.lastStatusSentTo('phone-1');
    expect(lastStatus?.type).toBe('controller-status');
    if (lastStatus?.type === 'controller-status') {
      expect(lastStatus.players).toHaveLength(4);
      expect(lastStatus.roomPlayerCount).toBe(4);
      expect(lastStatus.maxPlayers).toBe(4);
      expect(lastStatus.players.map((p) => p.name)).toEqual([
        'Alex',
        'Sam',
        'Taylor',
        'Jordan',
      ]);
    }
  });

  it('allows renaming, recoloring, and removing extra shared players while keeping at least one per phone', () => {
    const ctx = makeHostController();
    ctx.connectPhone('phone-1', 'Alex');
    ctx.controller.addPhonePlayer('phone-1', 'Sam');

    const [alex, sam] = ctx.controller.getState().players;

    // Phone 1 renames & changes color for Sam
    ctx.fromPeer('phone-1', {
      type: 'update-player-profile',
      playerId: sam.id,
      name: 'Samantha',
      color: 'gold',
    });
    expect(ctx.controller.getState().players[1].name).toBe('Samantha');
    expect(ctx.controller.getState().players[1].color).toBe('gold');

    // Phone 1 removes Sam
    ctx.fromPeer('phone-1', { type: 'request-remove-player', playerId: sam.id });
    expect(ctx.controller.getState().players).toHaveLength(1);
    expect(ctx.controller.getState().players[0].id).toBe(alex.id);

    // Attempting to remove the last remaining player on phone-1 is blocked
    ctx.fromPeer('phone-1', { type: 'request-remove-player', playerId: alex.id });
    expect(ctx.controller.getState().players).toHaveLength(1);
    ctx.controller.removePlayer(alex.id);
    expect(ctx.controller.getState().players).toHaveLength(1);
  });

  it('rotates turns across players sharing one phone and updates the featured active player on controller-status', () => {
    const ctx = makeHostController();
    ctx.connectPhone('phone-1', 'Alex');
    ctx.controller.addPhonePlayer('phone-1', 'Sam');

    const [alex, sam] = ctx.controller.getState().players;
    ctx.controller.startMatch();

    // Turn 1: Alex is active
    expect(ctx.controller.getState().activePlayerByDisplay['disp-host']).toBe(alex.id);
    let status = ctx.lastStatusSentTo('phone-1');
    expect(status?.type).toBe('controller-status');
    if (status?.type === 'controller-status') {
      expect(status.isMyTurn).toBe(true);
      expect(status.playerId).toBe(alex.id);
      expect(status.playerName).toBe('Alex');
      expect(status.players.find((p) => p.playerId === alex.id)?.isActiveTurn).toBe(true);
      expect(status.players.find((p) => p.playerId === sam.id)?.isActiveTurn).toBe(false);
    }

    // Throwing as inactive player (Sam) while Alex is up must be ignored
    const throwParams: ThrowParams = {
      xOffset: 0,
      aimAngle: 0,
      speed: 11,
      spin: -0.2,
      loft: 0.2,
    };
    ctx.fromPeer('phone-1', {
      type: 'throw-release',
      playerId: sam.id,
      throwParams,
    });
    expect(ctx.throws).toHaveLength(0);

    // Throwing as active player (Alex) succeeds
    ctx.fromPeer('phone-1', {
      type: 'throw-release',
      playerId: alex.id,
      throwParams,
    });
    expect(ctx.throws).toHaveLength(1);
    expect(ctx.throws[0].playerId).toBe(alex.id);

    // Alex bowls a Strike -> Frame 1 completes -> turn advances to Sam on the same phone!
    harness.sentReliable = [];
    ctx.controller.reportLocalRollSettled(alex.id, 10, [], false);

    expect(ctx.controller.getState().activePlayerByDisplay['disp-host']).toBe(sam.id);
    // Exactly ONE controller-status should have been sent to phone-1 for the turn transition
    const statusMsgs = harness.sentReliable.filter(
      (e) => e.to === 'phone-1' && e.msg.type === 'controller-status'
    );
    expect(statusMsgs).toHaveLength(1);
    status = statusMsgs[0].msg;
    if (status.type === 'controller-status') {
      expect(status.isMyTurn).toBe(true);
      expect(status.playerId).toBe(sam.id);
      expect(status.playerName).toBe('Sam');
      expect(status.frameNumber).toBe(1);
      expect(status.rollNumber).toBe(1);
      expect(status.players.find((p) => p.playerId === sam.id)?.isActiveTurn).toBe(true);
      expect(status.players.find((p) => p.playerId === alex.id)?.isActiveTurn).toBe(false);
    }
  });

  it('prevents one phone from controlling or editing players owned by another phone', () => {
    const ctx = makeHostController();
    ctx.connectPhone('phone-1', 'Alex');
    ctx.connectPhone('phone-2', 'Jordan');
    ctx.controller.addPhonePlayer('phone-1', 'Sam');

    const [alex, jordan, sam] = ctx.controller.getState().players;

    // Phone 2 tries to rename or remove Phone 1's players -> ignored
    ctx.fromPeer('phone-2', {
      type: 'update-player-profile',
      playerId: sam.id,
      name: 'Hacked',
    });
    ctx.fromPeer('phone-2', { type: 'request-remove-player', playerId: sam.id });
    expect(ctx.controller.getState().players.find((p) => p.id === sam.id)?.name).toBe('Sam');

    // Start match: Alex (phone-1) is active
    ctx.controller.startMatch();
    ctx.fromPeer('phone-2', {
      type: 'aim-update',
      playerId: alex.id,
      aim: { xOffset: 0.25, aimAngle: 0 },
    });
    ctx.fromPeerRealtime('phone-2', {
      type: 'arm-pose',
      playerId: alex.id,
      pose: { pitch: -0.5, roll: 0, holdingGrip: true, phase: 'backswing' },
      aim: { xOffset: 0.25, aimAngle: 0 },
    });
    expect(ctx.remoteAims).toHaveLength(0);
    expect(ctx.remotePoses).toHaveLength(0);

    // Phone 1 aiming as Alex works
    ctx.fromPeer('phone-1', {
      type: 'aim-update',
      playerId: alex.id,
      aim: { xOffset: 0.2, aimAngle: 0 },
    });
    expect(ctx.remoteAims).toHaveLength(1);

    // Status sent to Phone 2 reports isMyTurn = false and activePlayerName = 'Alex'
    const phone2Status = ctx.lastStatusSentTo('phone-2');
    expect(phone2Status?.type).toBe('controller-status');
    if (phone2Status?.type === 'controller-status') {
      expect(phone2Status.isMyTurn).toBe(false);
      expect(phone2Status.playerId).toBe(jordan.id);
      expect(phone2Status.activePlayerName).toBe('Alex');
    }
  });

  it('removes all shared players when their phone disconnects in lobby', () => {
    const ctx = makeHostController();
    ctx.connectPhone('phone-1', 'Alex');
    ctx.controller.addPhonePlayer('phone-1', 'Sam');
    ctx.controller.addDesktopPlayer('Desk');
    expect(ctx.controller.getState().players).toHaveLength(3);

    ctx.disconnectPhone('phone-1');
    const remaining = ctx.controller.getState().players;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe('Desk');
    expect(Object.keys(ctx.controller.getState().scorecards)).toEqual([remaining[0].id]);
  });

  it('buildControllerStatusPayloads selects the active player on a shared phone or next unfinished player when waiting', () => {
    const p1: PlayerProfile = {
      id: 'p1',
      name: 'Alex',
      color: 'purple',
      displayId: 'disp-1',
      controllerPeerId: 'phone-1',
      isDesktopFallback: false,
      laneIndex: 2,
      connected: true,
    };
    const p2: PlayerProfile = {
      id: 'p2',
      name: 'Sam',
      color: 'coral',
      displayId: 'disp-1',
      controllerPeerId: 'phone-1',
      isDesktopFallback: false,
      laneIndex: 3,
      connected: true,
    };
    const p3: PlayerProfile = {
      id: 'p3',
      name: 'Jordan',
      color: 'cyan',
      displayId: 'disp-1',
      controllerPeerId: 'phone-2',
      isDesktopFallback: false,
      laneIndex: 1,
      connected: true,
    };

    const state: MatchState = {
      roomCode: 'TEST',
      hostDisplayId: 'disp-1',
      phase: 'playing',
      players: [p1, p2, p3],
      scorecards: {
        p1: { ...createEmptyScorecard('p1'), isFinished: true, totalScore: 150 },
        p2: { ...createEmptyScorecard('p2'), totalScore: 90 },
        p3: { ...createEmptyScorecard('p3'), totalScore: 110 },
      },
      activePlayerByDisplay: { 'disp-1': 'p3' },
    };

    const payloads = buildControllerStatusPayloads(state, 'disp-1');
    expect(payloads.size).toBe(2);

    const phone1 = payloads.get('phone-1')!;
    expect(phone1.isMyTurn).toBe(false);
    // p1 is finished, so featured player on phone-1 should be p2 (next unfinished)
    expect(phone1.playerId).toBe('p2');
    expect(phone1.players).toHaveLength(2);
    expect(phone1.activePlayerName).toBe('Jordan');

    const phone2 = payloads.get('phone-2')!;
    expect(phone2.isMyTurn).toBe(true);
    expect(phone2.playerId).toBe('p3');
    expect(phone2.players).toHaveLength(1);
  });
});

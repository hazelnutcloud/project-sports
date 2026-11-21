import { BALL_COLOR_ORDER, type BallColorId } from '../types/game';
import type {
  HapticPattern,
  PeerConnectionStatus,
  RealtimeMessage,
  ReliableMessage,
  RoomPeerInfo,
} from '../types/network';
import type {
  TennisCalloutType,
  TennisControllerStatusPayload,
  TennisCourtMode,
  TennisCourtSlot,
  TennisMatchConfig,
  TennisMatchState,
  TennisPlayer,
  TennisRacketPose,
  TennisRallyPhase,
  TennisSlotId,
  TennisStateSnapshot,
  TennisSwingInput,
  TennisTeamId,
} from '../types/tennis';
import {
  createTennisScoreState,
  getTennisPointDisplay,
  recordPointWon,
  recordServeFault,
  type TennisPointReason,
} from '../rules/tennisScoring';
import { createPeerId, MAX_ROOM_PLAYERS } from './LobbyController';
import { SignalingClient } from './SignalingClient';
import { PeerManager } from './PeerManager';

const AI_ROSTER: Record<TennisSlotId, { name: string; color: BallColorId }> = {
  'near-back': { name: 'CPU Maya', color: 'cyan' },
  'near-front': { name: 'CPU Leo', color: 'purple' },
  'far-back': { name: 'CPU Ren', color: 'coral' },
  'far-front': { name: 'CPU Kai', color: 'gold' },
};

/**
 * Builds the 2 (singles) or 4 (doubles) court slots from the registered human players,
 * filling any empty slots cleanly with Spocco CPU players.
 */
export function buildTennisCourtSlots(
  players: TennisPlayer[],
  courtMode: TennisCourtMode
): TennisCourtSlot[] {
  const nearHumans = players.filter((p) => p.team === 'near');
  const farHumans = players.filter((p) => p.team === 'far');

  const slotIds: TennisSlotId[] =
    courtMode === 'doubles'
      ? ['near-back', 'near-front', 'far-back', 'far-front']
      : ['near-back', 'far-back'];

  const usedColors = new Set<BallColorId>(players.map((p) => p.color));
  const pickAiColor = (fallback: BallColorId): BallColorId => {
    if (!usedColors.has(fallback)) {
      usedColors.add(fallback);
      return fallback;
    }
    const free = BALL_COLOR_ORDER.find((c) => !usedColors.has(c)) ?? fallback;
    usedColors.add(free);
    return free;
  };

  return slotIds.map((slotId) => {
    const team: TennisTeamId = slotId.startsWith('near') ? 'near' : 'far';
    const role = slotId.endsWith('front') ? 'front' : 'back';
    const teamHumans = team === 'near' ? nearHumans : farHumans;
    const human = role === 'back' ? teamHumans[0] : teamHumans[1];

    if (human) {
      return {
        slotId,
        team,
        role,
        playerId: human.id,
        isAi: false,
        name: human.name,
        color: human.color,
      };
    }

    const aiSpec = AI_ROSTER[slotId];
    return {
      slotId,
      team,
      role,
      playerId: null,
      isAi: true,
      name: aiSpec.name,
      color: pickAiColor(aiSpec.color),
    };
  });
}

export interface TennisDisplayLobbyCallbacks {
  onMatchStateChange: (state: TennisMatchState) => void;
  onPeerStatusesChange: (statuses: Record<string, PeerConnectionStatus>) => void;
  onServeToss: (playerId: string) => void;
  onPlayerSwing: (swing: TennisSwingInput) => void;
  onRemoteRacketPose: (playerId: string, pose: TennisRacketPose) => void;
  onRemoteSnapshot: (snapshot: TennisStateSnapshot) => void;
  onCallout: (callout: TennisCalloutType, subtitle?: string) => void;
  onError: (message: string) => void;
}

export class TennisDisplayLobbyController {
  public readonly displayId: string;
  private readonly signaling: SignalingClient;
  private readonly peers: PeerManager;
  private readonly callbacks: TennisDisplayLobbyCallbacks;

  private roomPeers = new Map<string, RoomPeerInfo>();
  private peerStatuses: Record<string, PeerConnectionStatus> = {};
  private currentRallyPhase: TennisRallyPhase = 'waiting-serve';
  private state: TennisMatchState;

  constructor(callbacks: TennisDisplayLobbyCallbacks, displayId = createPeerId('disp')) {
    this.displayId = displayId;
    this.callbacks = callbacks;

    const defaultConfig: TennisMatchConfig = {
      courtMode: 'singles',
      format: 'best-of-3',
      difficulty: 'pro',
    };

    this.state = {
      roomCode: '',
      hostDisplayId: '',
      phase: 'lobby',
      config: defaultConfig,
      players: [],
      slots: buildTennisCourtSlots([], defaultConfig.courtMode),
      score: createTennisScoreState(defaultConfig.format, defaultConfig.courtMode),
    };

    this.signaling = new SignalingClient({
      onRoomJoined: ({ roomCode, hostDisplayId, peers }) => {
        this.state = {
          ...this.state,
          roomCode,
          hostDisplayId: hostDisplayId ?? this.displayId,
        };
        this.roomPeers.clear();
        for (const p of peers) {
          this.roomPeers.set(p.peerId, p);
          if (p.peerId !== this.displayId) {
            this.maybeConnectToPeer(p);
          }
        }
        this.emitState();
      },
      onPeerJoined: (peer, hostDisplayId) => {
        this.roomPeers.set(peer.peerId, peer);
        if (hostDisplayId) {
          this.state = { ...this.state, hostDisplayId };
        }
        this.maybeConnectToPeer(peer);
      },
      onPeerLeft: (peerId, hostDisplayId) => {
        const departed = this.roomPeers.get(peerId);
        this.roomPeers.delete(peerId);
        this.peers.disconnectPeer(peerId);
        delete this.peerStatuses[peerId];
        this.callbacks.onPeerStatusesChange({ ...this.peerStatuses });

        if (hostDisplayId) {
          this.state = { ...this.state, hostDisplayId };
        }
        if (this.isHost() && departed) {
          this.handlePeerDepartedAsHost(departed);
        }
      },
      onSignal: (fromPeerId, payload) => {
        void this.peers.handleSignal(fromPeerId, payload);
      },
      onError: (msg) => this.callbacks.onError(msg),
    });

    this.peers = new PeerManager(this.displayId, {
      sendSignal: (to, payload) => this.signaling.sendSignal(to, payload),
      onReliableMessage: (from, msg) => this.handleReliableMessage(from, msg),
      onRealtimeMessage: (from, msg) => this.handleRealtimeMessage(from, msg),
      onPeerStatusChange: (peerId, status) => {
        this.peerStatuses[peerId] = status;
        this.callbacks.onPeerStatusesChange({ ...this.peerStatuses });
        if (status === 'connected') {
          this.onPeerConnected(peerId);
        }
      },
    });
  }

  public isHost(): boolean {
    return this.state.hostDisplayId === this.displayId;
  }

  public getState(): TennisMatchState {
    return this.state;
  }

  public async hostRoom(displayName = 'Tennis Court Screen'): Promise<void> {
    await this.signaling.connect();
    this.signaling.createRoom(this.displayId, displayName, 'tennis');
  }

  public async joinRoom(roomCode: string, displayName = 'Guest Court Screen'): Promise<void> {
    await this.signaling.connect();
    this.signaling.joinRoom(roomCode, this.displayId, 'display', displayName);
  }

  public addDesktopPlayer(name?: string): void {
    if (this.state.phase !== 'lobby' || this.state.players.length >= MAX_ROOM_PLAYERS) return;
    const localDesktops = this.state.players.filter(
      (p) => p.displayId === this.displayId && p.isDesktopFallback
    );
    if (localDesktops.length >= 2) return;

    const desktopSlot: 1 | 2 = localDesktops.some((p) => p.desktopSlot === 1) ? 2 : 1;
    const playerName = name?.trim() || `Player ${this.state.players.length + 1}`;
    const controllerPeerId = `desktop-${this.displayId}-${desktopSlot}`;

    if (this.isHost()) {
      this.registerPlayerAsHost({
        name: playerName,
        displayId: this.displayId,
        controllerPeerId,
        isDesktopFallback: true,
        desktopSlot,
      });
    } else if (this.state.hostDisplayId) {
      this.peers.sendReliable(this.state.hostDisplayId, {
        type: 'request-register-player',
        name: playerName,
        displayId: this.displayId,
        controllerPeerId,
      });
    }
  }

  public removePlayer(playerId: string): void {
    if (this.state.phase !== 'lobby') return;
    const target = this.state.players.find((p) => p.id === playerId);
    if (!target || !target.isDesktopFallback) return;

    if (this.isHost()) {
      this.removePlayerAsHost(playerId);
    } else if (this.state.hostDisplayId && target.displayId === this.displayId) {
      this.peers.sendReliable(this.state.hostDisplayId, {
        type: 'request-remove-player',
        playerId,
      });
    }
  }

  public updatePlayerProfile(
    playerId: string,
    patch: { name?: string; color?: BallColorId }
  ): void {
    if (this.isHost()) {
      this.applyProfileUpdateAsHost(playerId, patch.name, patch.color);
    } else if (this.state.hostDisplayId) {
      this.peers.sendReliable(this.state.hostDisplayId, {
        type: 'update-player-profile',
        playerId,
        ...patch,
      });
    }
  }

  public assignPlayerTeam(playerId: string, team: TennisTeamId): void {
    if (this.state.phase !== 'lobby') return;
    if (this.isHost()) {
      this.applyTeamAssignAsHost(playerId, team);
    } else if (this.state.hostDisplayId) {
      this.peers.sendReliable(this.state.hostDisplayId, {
        type: 'tennis-assign-team',
        playerId,
        team,
      });
    }
  }

  public updateConfig(patch: Partial<TennisMatchConfig>): void {
    if (!this.isHost() || this.state.phase !== 'lobby') return;
    const nextConfig: TennisMatchConfig = { ...this.state.config, ...patch };
    // Auto-enforce doubles if >2 players or >1 player on either team
    const nearCount = this.state.players.filter((p) => p.team === 'near').length;
    const farCount = this.state.players.filter((p) => p.team === 'far').length;
    if (this.state.players.length > 2 || nearCount > 1 || farCount > 1) {
      nextConfig.courtMode = 'doubles';
    }
    this.state = {
      ...this.state,
      config: nextConfig,
      slots: buildTennisCourtSlots(this.state.players, nextConfig.courtMode),
      score: createTennisScoreState(nextConfig.format, nextConfig.courtMode),
    };
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  public startMatch(): void {
    if (!this.isHost()) return;
    if (this.state.players.length === 0) {
      this.addDesktopPlayer('Player 1');
    }

    const slots = buildTennisCourtSlots(this.state.players, this.state.config.courtMode);
    const score = createTennisScoreState(
      this.state.config.format,
      this.state.config.courtMode,
      'near'
    );

    this.currentRallyPhase = 'waiting-serve';
    this.state = {
      ...this.state,
      phase: 'playing',
      slots,
      score,
    };
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  public rematch(): void {
    if (!this.isHost()) return;
    this.startMatch();
  }

  public setRallyPhase(phase: TennisRallyPhase): void {
    if (this.currentRallyPhase === phase) return;
    this.currentRallyPhase = phase;
    this.notifyAllLocalControllers();
  }

  public submitLocalServeToss(playerId: string): void {
    if (this.isHost()) {
      this.callbacks.onServeToss(playerId);
    } else if (this.state.hostDisplayId) {
      this.peers.sendReliable(this.state.hostDisplayId, {
        type: 'tennis-serve-toss',
        playerId,
      });
    }
  }

  public submitLocalSwing(swing: TennisSwingInput): void {
    if (this.isHost()) {
      this.callbacks.onPlayerSwing(swing);
    } else if (this.state.hostDisplayId) {
      this.peers.sendReliable(this.state.hostDisplayId, {
        type: 'tennis-swing',
        playerId: swing.playerId,
        swing,
      });
    }
  }

  public reportPointResolved(
    winner: TennisTeamId,
    reason: TennisPointReason,
    rallyLength: number
  ): void {
    if (!this.isHost() || this.state.phase !== 'playing') return;
    const outcome = recordPointWon(this.state.score, winner, reason, rallyLength);
    this.state = {
      ...this.state,
      phase: outcome.matchWonBy ? 'finished' : 'playing',
      score: outcome.score,
    };

    // Haptics for local phone players on winning/losing team
    for (const p of this.state.players) {
      if (!p.isDesktopFallback && p.controllerPeerId && p.displayId === this.displayId) {
        this.sendHapticToPlayer(p.id, p.team === winner ? 'point-won' : 'fault');
      }
    }

    if (outcome.callout) {
      this.emitCalloutAsHost(outcome.callout, outcome.subtitle);
    }

    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  public reportServeFault(): void {
    if (!this.isHost() || this.state.phase !== 'playing') return;
    const outcome = recordServeFault(this.state.score);
    this.state = {
      ...this.state,
      phase: outcome.matchWonBy ? 'finished' : 'playing',
      score: outcome.score,
    };

    if (outcome.callout) {
      this.emitCalloutAsHost(outcome.callout, outcome.subtitle);
    }

    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  public emitCalloutAsHost(callout: TennisCalloutType, subtitle?: string): void {
    this.callbacks.onCallout(callout, subtitle);
    if (this.isHost()) {
      this.peers.broadcastReliable(
        { type: 'tennis-callout', callout, subtitle },
        this.getOtherDisplayPeerIds()
      );
    }
  }

  public broadcastLocalSnapshot(snapshot: TennisStateSnapshot): void {
    if (!this.isHost()) return;
    const others = this.getOtherDisplayPeerIds();
    if (others.length === 0) return;
    this.peers.broadcastRealtime({ type: 'tennis-snapshot', snapshot }, others);
  }

  public sendHapticToPlayer(playerId: string, pattern: HapticPattern): void {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.isDesktopFallback || !player.controllerPeerId) return;
    if (player.displayId !== this.displayId) return;
    this.peers.sendReliable(player.controllerPeerId, { type: 'haptic', pattern });
  }

  public destroy(): void {
    this.peers.closeAll();
    this.signaling.close();
  }

  private maybeConnectToPeer(peer: RoomPeerInfo): void {
    if (peer.role === 'display') {
      void this.peers.connectToPeer(peer.peerId);
    } else if (
      peer.role === 'controller' &&
      (peer.targetDisplayId === this.displayId || (!peer.targetDisplayId && this.isHost()))
    ) {
      void this.peers.connectToPeer(peer.peerId);
    }
  }

  private onPeerConnected(peerId: string): void {
    const info = this.roomPeers.get(peerId);
    if (!info) return;

    if (info.role === 'display') {
      if (this.isHost()) {
        this.peers.sendReliable(peerId, { type: 'tennis-match-state', state: this.state });
      }
      return;
    }

    if (info.role === 'controller') {
      const existing = this.state.players.find((p) => p.controllerPeerId === peerId);
      if (!existing && this.state.phase === 'lobby') {
        if (this.isHost()) {
          this.registerPlayerAsHost({
            name: info.displayName,
            displayId: this.displayId,
            controllerPeerId: peerId,
            isDesktopFallback: false,
          });
        } else if (this.state.hostDisplayId) {
          this.peers.sendReliable(this.state.hostDisplayId, {
            type: 'request-register-player',
            name: info.displayName,
            displayId: this.displayId,
            controllerPeerId: peerId,
          });
        }
      } else {
        this.notifyAllLocalControllers();
      }
    }
  }

  private handleReliableMessage(fromPeerId: string, msg: ReliableMessage): void {
    const fromPeer = this.roomPeers.get(fromPeerId);
    const isFromController = fromPeer?.role === 'controller';

    switch (msg.type) {
      case 'tennis-match-state': {
        this.state = msg.state;
        this.emitState();
        this.notifyAllLocalControllers();
        break;
      }
      case 'request-register-player': {
        if (!this.isHost() || this.state.phase !== 'lobby') return;
        const isDesktop = msg.controllerPeerId.startsWith('desktop-');
        this.registerPlayerAsHost({
          name: msg.name,
          color: msg.color,
          displayId: msg.displayId,
          controllerPeerId: msg.controllerPeerId,
          isDesktopFallback: isDesktop,
        });
        break;
      }
      case 'request-remove-player': {
        if (!this.isHost() || this.state.phase !== 'lobby') return;
        this.removePlayerAsHost(msg.playerId);
        break;
      }
      case 'update-player-profile': {
        if (isFromController) {
          const owned = this.state.players.find(
            (p) => p.id === msg.playerId && p.controllerPeerId === fromPeerId
          );
          if (!owned) return;
          if (this.isHost()) {
            this.applyProfileUpdateAsHost(msg.playerId, msg.name, msg.color);
          } else if (this.state.hostDisplayId) {
            this.peers.sendReliable(this.state.hostDisplayId, msg);
          }
          return;
        }
        if (this.isHost()) {
          this.applyProfileUpdateAsHost(msg.playerId, msg.name, msg.color);
        }
        break;
      }
      case 'tennis-assign-team': {
        if (this.state.phase !== 'lobby') return;
        if (isFromController) {
          const owned = this.state.players.find(
            (p) => p.id === msg.playerId && p.controllerPeerId === fromPeerId
          );
          if (!owned) return;
          if (this.isHost()) {
            this.applyTeamAssignAsHost(msg.playerId, msg.team);
          } else if (this.state.hostDisplayId) {
            this.peers.sendReliable(this.state.hostDisplayId, msg);
          }
          return;
        }
        if (this.isHost()) {
          this.applyTeamAssignAsHost(msg.playerId, msg.team);
        }
        break;
      }
      case 'tennis-serve-toss': {
        const player = isFromController
          ? this.state.players.find((p) => p.controllerPeerId === fromPeerId)
          : this.state.players.find((p) => p.id === msg.playerId);
        if (!player) return;
        if (isFromController) {
          this.sendHapticToPlayer(player.id, 'serve-toss');
        }
        this.submitLocalServeToss(player.id);
        break;
      }
      case 'tennis-swing': {
        const player = isFromController
          ? this.state.players.find((p) => p.controllerPeerId === fromPeerId)
          : this.state.players.find((p) => p.id === msg.playerId);
        if (!player) return;
        this.submitLocalSwing({ ...msg.swing, playerId: player.id });
        break;
      }
      case 'tennis-callout': {
        this.callbacks.onCallout(msg.callout, msg.subtitle);
        break;
      }
      default:
        break;
    }
  }

  private handleRealtimeMessage(fromPeerId: string, msg: RealtimeMessage): void {
    if (msg.type === 'tennis-racket-pose') {
      const player = this.state.players.find((p) => p.controllerPeerId === fromPeerId);
      if (!player) return;
      this.callbacks.onRemoteRacketPose(player.id, msg.pose);
    } else if (msg.type === 'tennis-snapshot') {
      this.callbacks.onRemoteSnapshot(msg.snapshot);
    }
  }

  private registerPlayerAsHost(input: {
    name: string;
    color?: BallColorId;
    displayId: string;
    controllerPeerId: string;
    isDesktopFallback: boolean;
    desktopSlot?: 1 | 2;
  }): void {
    if (this.state.players.length >= MAX_ROOM_PLAYERS) return;
    if (this.state.players.some((p) => p.controllerPeerId === input.controllerPeerId)) return;

    const usedColors = new Set(this.state.players.map((p) => p.color));
    const color =
      input.color ??
      BALL_COLOR_ORDER.find((c) => !usedColors.has(c)) ??
      BALL_COLOR_ORDER[this.state.players.length % BALL_COLOR_ORDER.length];

    // Smart team auto-placement:
    // 1st player -> near, 2nd player -> far (head-to-head!), 3rd -> near, 4th -> far
    const nearCount = this.state.players.filter((p) => p.team === 'near').length;
    const farCount = this.state.players.filter((p) => p.team === 'far').length;
    const team: TennisTeamId = nearCount <= farCount ? 'near' : 'far';

    const nextPlayers: TennisPlayer[] = [
      ...this.state.players,
      {
        id: createPeerId('tp'),
        name: input.name.trim().slice(0, 14) || `Player ${this.state.players.length + 1}`,
        color,
        displayId: input.displayId,
        controllerPeerId: input.controllerPeerId,
        isDesktopFallback: input.isDesktopFallback,
        desktopSlot: input.desktopSlot,
        team,
        connected: true,
      },
    ];

    const nextCourtMode: TennisCourtMode =
      nextPlayers.length > 2 ? 'doubles' : this.state.config.courtMode;
    const nextConfig: TennisMatchConfig = { ...this.state.config, courtMode: nextCourtMode };

    this.state = {
      ...this.state,
      config: nextConfig,
      players: nextPlayers,
      slots: buildTennisCourtSlots(nextPlayers, nextCourtMode),
      score: createTennisScoreState(nextConfig.format, nextCourtMode),
    };
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  private removePlayerAsHost(playerId: string): void {
    const nextPlayers = this.state.players.filter((p) => p.id !== playerId);
    this.state = {
      ...this.state,
      players: nextPlayers,
      slots: buildTennisCourtSlots(nextPlayers, this.state.config.courtMode),
    };
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  private applyProfileUpdateAsHost(
    playerId: string,
    name?: string,
    color?: BallColorId
  ): void {
    const nextPlayers = this.state.players.map((p) =>
      p.id === playerId
        ? {
            ...p,
            name: name !== undefined ? name.trim().slice(0, 14) || p.name : p.name,
            color: color ?? p.color,
          }
        : p
    );
    this.state = {
      ...this.state,
      players: nextPlayers,
      slots: buildTennisCourtSlots(nextPlayers, this.state.config.courtMode),
    };
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  private applyTeamAssignAsHost(playerId: string, team: TennisTeamId): void {
    const targetCount = this.state.players.filter(
      (p) => p.team === team && p.id !== playerId
    ).length;
    if (targetCount >= 2) return;

    const nextPlayers = this.state.players.map((p) =>
      p.id === playerId ? { ...p, team } : p
    );
    const nearCount = nextPlayers.filter((p) => p.team === 'near').length;
    const farCount = nextPlayers.filter((p) => p.team === 'far').length;
    const nextCourtMode: TennisCourtMode =
      nearCount > 1 || farCount > 1 ? 'doubles' : this.state.config.courtMode;

    const nextConfig: TennisMatchConfig = { ...this.state.config, courtMode: nextCourtMode };
    this.state = {
      ...this.state,
      config: nextConfig,
      players: nextPlayers,
      slots: buildTennisCourtSlots(nextPlayers, nextCourtMode),
      score: createTennisScoreState(nextConfig.format, nextCourtMode),
    };
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  private handlePeerDepartedAsHost(peer: RoomPeerInfo): void {
    if (this.state.phase === 'lobby') {
      const nextPlayers = this.state.players.filter(
        (p) => p.controllerPeerId !== peer.peerId && p.displayId !== peer.peerId
      );
      this.state = {
        ...this.state,
        players: nextPlayers,
        slots: buildTennisCourtSlots(nextPlayers, this.state.config.courtMode),
      };
    } else {
      this.state = {
        ...this.state,
        players: this.state.players.map((p) =>
          p.controllerPeerId === peer.peerId || p.displayId === peer.peerId
            ? { ...p, connected: false }
            : p
        ),
      };
    }
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  private broadcastMatchStateAsHost(): void {
    this.emitState();
    this.peers.broadcastReliable(
      { type: 'tennis-match-state', state: this.state },
      this.getOtherDisplayPeerIds()
    );
  }

  private notifyAllLocalControllers(): void {
    const display = getTennisPointDisplay(this.state.score);
    for (const p of this.state.players) {
      if (p.displayId !== this.displayId || p.isDesktopFallback || !p.controllerPeerId) {
        continue;
      }

      const servingSlotObj = this.state.slots.find(
        (s) => s.slotId === this.state.score.servingSlot
      );
      const isMyServe =
        this.state.phase === 'playing' &&
        (servingSlotObj?.playerId === p.id ||
          (servingSlotObj?.isAi === true && servingSlotObj.team === p.team));

      const payload: TennisControllerStatusPayload = {
        playerId: p.id,
        playerName: p.name,
        color: p.color,
        team: p.team,
        phase: this.state.phase,
        rallyPhase: this.currentRallyPhase,
        isMyServe,
        canSwing:
          this.state.phase === 'playing' &&
          (this.currentRallyPhase === 'rally' ||
            (isMyServe &&
              (this.currentRallyPhase === 'waiting-serve' ||
                this.currentRallyPhase === 'serve-toss'))),
        courtMode: this.state.config.courtMode,
        format: this.state.config.format,
        gamesNear: this.state.score.games.near,
        gamesFar: this.state.score.games.far,
        pointsNearLabel: display.nearLabel,
        pointsFarLabel: display.farLabel,
        serveFaultCount: this.state.score.serveFaultCount,
        winnerTeam: this.state.score.winnerTeam,
        roomPlayerCount: this.state.players.length,
        maxPlayers: MAX_ROOM_PLAYERS,
      };

      this.peers.sendReliable(p.controllerPeerId, {
        type: 'tennis-controller-status',
        payload,
      });
    }
  }

  private getOtherDisplayPeerIds(): string[] {
    return Array.from(this.roomPeers.values())
      .filter((p) => p.role === 'display' && p.peerId !== this.displayId)
      .map((p) => p.peerId);
  }

  private emitState(): void {
    this.callbacks.onMatchStateChange(this.state);
  }
}

export interface TennisPhoneSessionCallbacks {
  onConnectionStatus: (status: PeerConnectionStatus) => void;
  onControllerStatus: (status: TennisControllerStatusPayload) => void;
  onHaptic: (pattern: HapticPattern) => void;
  onError: (message: string) => void;
}

/**
 * WebRTC Phone Controller Session for Spocco Tennis.
 */
export class TennisPhoneControllerSession {
  public readonly peerId: string;
  private readonly signaling: SignalingClient;
  private readonly peers: PeerManager;
  private readonly callbacks: TennisPhoneSessionCallbacks;
  private targetDisplayId: string | null = null;
  private assignedPlayerId = '';

  constructor(callbacks: TennisPhoneSessionCallbacks, peerId = createPeerId('tphone')) {
    this.peerId = peerId;
    this.callbacks = callbacks;

    this.signaling = new SignalingClient({
      onRoomJoined: ({ hostDisplayId, peers }) => {
        const self = peers.find((p) => p.peerId === this.peerId);
        this.targetDisplayId =
          self?.targetDisplayId ??
          hostDisplayId ??
          peers.find((p) => p.role === 'display')?.peerId ??
          null;
        if (!this.targetDisplayId) {
          this.callbacks.onError('No active tennis screen was found in this room.');
          return;
        }
        void this.peers.connectToPeer(this.targetDisplayId);
      },
      onPeerLeft: (peerId) => {
        if (peerId === this.targetDisplayId) {
          this.callbacks.onConnectionStatus('disconnected');
          this.callbacks.onError('The tennis game screen disconnected.');
        }
      },
      onSignal: (fromPeerId, payload) => {
        void this.peers.handleSignal(fromPeerId, payload);
      },
      onError: (msg) => this.callbacks.onError(msg),
    });

    this.peers = new PeerManager(this.peerId, {
      sendSignal: (to, payload) => this.signaling.sendSignal(to, payload),
      onReliableMessage: (_from, msg) => {
        if (msg.type === 'tennis-controller-status') {
          this.assignedPlayerId = msg.payload.playerId;
          this.callbacks.onControllerStatus(msg.payload);
        } else if (msg.type === 'haptic') {
          this.callbacks.onHaptic(msg.pattern);
        }
      },
      onRealtimeMessage: () => {},
      onPeerStatusChange: (peerId, status) => {
        if (peerId === this.targetDisplayId) {
          this.callbacks.onConnectionStatus(status);
        }
      },
    });
  }

  public async connect(
    roomCode: string,
    playerName: string,
    targetDisplayId?: string
  ): Promise<void> {
    await this.signaling.connect();
    this.signaling.joinRoom(
      roomCode,
      this.peerId,
      'controller',
      playerName.trim() || 'Player',
      targetDisplayId
    );
  }

  public sendServeToss(): void {
    if (!this.targetDisplayId) return;
    this.peers.sendReliable(this.targetDisplayId, {
      type: 'tennis-serve-toss',
      playerId: this.assignedPlayerId,
    });
  }

  public sendSwing(swing: Omit<TennisSwingInput, 'playerId'>): void {
    if (!this.targetDisplayId) return;
    this.peers.sendReliable(this.targetDisplayId, {
      type: 'tennis-swing',
      playerId: this.assignedPlayerId,
      swing: { ...swing, playerId: this.assignedPlayerId },
    });
  }

  public sendRacketPose(pose: TennisRacketPose): void {
    if (!this.targetDisplayId) return;
    this.peers.sendRealtime(this.targetDisplayId, {
      type: 'tennis-racket-pose',
      playerId: this.assignedPlayerId,
      pose,
    });
  }

  public switchTeam(team: TennisTeamId): void {
    if (!this.targetDisplayId || !this.assignedPlayerId) return;
    this.peers.sendReliable(this.targetDisplayId, {
      type: 'tennis-assign-team',
      playerId: this.assignedPlayerId,
      team,
    });
  }

  public updateProfile(patch: { name?: string; color?: BallColorId }): void {
    if (!this.targetDisplayId || !this.assignedPlayerId) return;
    this.peers.sendReliable(this.targetDisplayId, {
      type: 'update-player-profile',
      playerId: this.assignedPlayerId,
      ...patch,
    });
  }

  public destroy(): void {
    this.peers.closeAll();
    this.signaling.close();
  }
}

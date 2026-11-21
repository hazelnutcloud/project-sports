import {
  BALL_COLOR_ORDER,
  PLAYER_LANE_ORDER,
  type AimState,
  type ArmPoseState,
  type BallColorId,
  type LaneSnapshot,
  type MatchState,
  type PlayerProfile,
  type RollResult,
  type ThrowParams,
} from '../types/game';
import type {
  ControllerPlayerSummary,
  HapticPattern,
  PeerConnectionStatus,
  RealtimeMessage,
  ReliableMessage,
  RoomPeerInfo,
} from '../types/network';
import { createEmptyScorecard, recordRoll } from '../rules/scoring';
import { SignalingClient } from './SignalingClient';
import { PeerManager } from './PeerManager';

export const MAX_ROOM_PLAYERS = 4;

export function createPeerId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${rand}`;
}

export function buildControllerStatusPayloads(
  state: MatchState,
  displayId: string
): Map<string, ControllerStatusPayload> {
  const result = new Map<string, ControllerStatusPayload>();
  const activeId = state.activePlayerByDisplay[displayId] ?? null;
  const activePlayer = state.players.find((p) => p.id === activeId);

  const grouped = new Map<string, PlayerProfile[]>();
  for (const player of state.players) {
    if (player.displayId !== displayId) continue;
    if (player.isDesktopFallback || !player.controllerPeerId) continue;
    const list = grouped.get(player.controllerPeerId);
    if (list) {
      list.push(player);
    } else {
      grouped.set(player.controllerPeerId, [player]);
    }
  }

  for (const [controllerPeerId, phonePlayers] of grouped.entries()) {
    const summaries: ControllerPlayerSummary[] = phonePlayers.map((player) => {
      const card = state.scorecards[player.id];
      const frame = card?.frames[card.currentFrameIndex];
      return {
        playerId: player.id,
        name: player.name,
        color: player.color,
        laneIndex: player.laneIndex,
        frameNumber: frame?.frameNumber ?? 1,
        rollNumber: (frame?.rolls.length ?? 0) + 1,
        totalScore: card?.totalScore ?? 0,
        isFinished: card?.isFinished ?? false,
        isActiveTurn: state.phase === 'playing' && activeId === player.id,
      };
    });

    const featured =
      summaries.find((s) => s.isActiveTurn) ??
      summaries.find((s) => !s.isFinished) ??
      summaries[0];

    result.set(controllerPeerId, {
      playerId: featured.playerId,
      isMyTurn: featured.isActiveTurn,
      frameNumber: featured.frameNumber,
      rollNumber: featured.rollNumber,
      totalScore: featured.totalScore,
      phase: state.phase,
      activePlayerName: activePlayer?.name ?? '',
      ballColor: featured.color,
      playerName: featured.name,
      players: summaries,
      roomPlayerCount: state.players.length,
      maxPlayers: MAX_ROOM_PLAYERS,
    });
  }

  return result;
}

export interface DisplayLobbyCallbacks {
  onMatchStateChange: (state: MatchState) => void;
  onPeerStatusesChange: (statuses: Record<string, PeerConnectionStatus>) => void;
  onRemoteAim: (playerId: string, aim: AimState) => void;
  onRemoteArmPose: (playerId: string, pose: ArmPoseState, aim: AimState) => void;
  onThrowRelease: (playerId: string, throwParams: ThrowParams) => void;
  onRemoteLaneSnapshot: (snapshot: LaneSnapshot) => void;
  onCallout: (playerId: string, callout: RollResult['callout'], pinsKnocked: number) => void;
  onError: (message: string) => void;
}

/**
 * Coordinates Hybrid Multiplayer on a Display (Desktop/TV):
 * - Connects P2P via WebRTC to all other Displays in the room
 * - Connects P2P via WebRTC to all Phone Controllers paired to this Display
 * - If this Display is the Host, maintains authoritative MatchState & scoring
 */
export class DisplayLobbyController {
  public readonly displayId: string;
  private readonly signaling: SignalingClient;
  private readonly peers: PeerManager;
  private readonly callbacks: DisplayLobbyCallbacks;

  private roomPeers = new Map<string, RoomPeerInfo>();
  private peerStatuses: Record<string, PeerConnectionStatus> = {};
  private lastNotifiedTurnByController = new Map<string, string>();
  private state: MatchState;

  constructor(callbacks: DisplayLobbyCallbacks, displayId = createPeerId('disp')) {
    this.displayId = displayId;
    this.callbacks = callbacks;

    this.state = {
      roomCode: '',
      hostDisplayId: '',
      phase: 'lobby',
      players: [],
      scorecards: {},
      activePlayerByDisplay: {},
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
      onError: (message) => {
        this.callbacks.onError(message);
      },
    });

    this.peers = new PeerManager(this.displayId, {
      sendSignal: (to, payload) => this.signaling.sendSignal(to, payload),
      onReliableMessage: (fromPeerId, msg) => this.handleReliableMessage(fromPeerId, msg),
      onRealtimeMessage: (fromPeerId, msg) => this.handleRealtimeMessage(fromPeerId, msg),
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

  public getState(): MatchState {
    return this.state;
  }

  public async hostRoom(displayName = 'Main Alley Screen'): Promise<void> {
    await this.signaling.connect();
    this.signaling.createRoom(this.displayId, displayName);
  }

  public async joinRoom(roomCode: string, displayName = 'Guest Alley Screen'): Promise<void> {
    await this.signaling.connect();
    this.signaling.joinRoom(roomCode, this.displayId, 'display', displayName);
  }

  public addDesktopPlayer(name?: string): void {
    if (this.state.phase !== 'lobby' || this.state.players.length >= MAX_ROOM_PLAYERS) return;
    const localCount = this.state.players.filter((p) => p.displayId === this.displayId).length;
    const playerName = name?.trim() || `Bowler ${this.state.players.length + 1}`;
    const controllerPeerId = `desktop-${this.displayId}-${localCount + 1}`;

    if (this.isHost()) {
      this.registerPlayerAsHost({
        name: playerName,
        displayId: this.displayId,
        controllerPeerId,
        isDesktopFallback: true,
        allowSharedController: false,
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

  public addPhonePlayer(controllerPeerId: string, name?: string, color?: BallColorId): void {
    if (this.state.phase !== 'lobby' || this.state.players.length >= MAX_ROOM_PLAYERS) return;
    const isKnownLocalPhone =
      this.state.players.some(
        (p) =>
          p.displayId === this.displayId &&
          !p.isDesktopFallback &&
          p.controllerPeerId === controllerPeerId
      ) || this.roomPeers.get(controllerPeerId)?.role === 'controller';
    if (!isKnownLocalPhone) return;

    const playerName = name?.trim() || `Player ${this.state.players.length + 1}`;
    if (this.isHost()) {
      this.registerPlayerAsHost({
        name: playerName,
        color,
        displayId: this.displayId,
        controllerPeerId,
        isDesktopFallback: false,
        allowSharedController: true,
      });
    } else if (this.state.hostDisplayId) {
      this.peers.sendReliable(this.state.hostDisplayId, {
        type: 'request-register-player',
        name: playerName,
        color,
        displayId: this.displayId,
        controllerPeerId,
        allowSharedController: true,
      });
    }
  }

  public updatePlayerProfile(playerId: string, patch: { name?: string; color?: BallColorId }): void {
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

  public removePlayer(playerId: string): void {
    if (this.state.phase !== 'lobby') return;
    const target = this.state.players.find((p) => p.id === playerId);
    if (!target || !this.canRemovePlayer(target)) return;

    if (this.isHost()) {
      this.removePlayerAsHost(playerId);
    } else if (this.state.hostDisplayId && target.displayId === this.displayId) {
      this.peers.sendReliable(this.state.hostDisplayId, {
        type: 'request-remove-player',
        playerId,
      });
    }
  }

  public removeDesktopPlayer(playerId: string): void {
    this.removePlayer(playerId);
  }

  public startMatch(): void {
    if (!this.isHost()) return;
    if (this.state.players.length === 0) {
      this.addDesktopPlayer('Player 1');
    }

    const scorecards: MatchState['scorecards'] = {};
    for (const p of this.state.players) {
      scorecards[p.id] = createEmptyScorecard(p.id);
    }

    this.state = {
      ...this.state,
      phase: 'playing',
      scorecards,
    };
    this.refreshActivePlayersPerDisplayAsHost();
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  public rematch(): void {
    if (!this.isHost()) return;
    this.startMatch();
  }

  public submitLocalThrow(playerId: string, throwParams: ThrowParams): void {
    // Notify our local engine immediately
    this.callbacks.onThrowRelease(playerId, throwParams);
    // Notify other displays so they can trigger audio/visual anticipation if needed
    const displayPeerIds = this.getOtherDisplayPeerIds();
    this.peers.broadcastReliable(
      { type: 'throw-release', playerId, throwParams },
      displayPeerIds
    );
  }

  public broadcastLocalLaneSnapshot(snapshot: LaneSnapshot): void {
    const displayPeerIds = this.getOtherDisplayPeerIds();
    if (displayPeerIds.length === 0) return;
    this.peers.broadcastRealtime({ type: 'lane-snapshot', snapshot }, displayPeerIds);
  }

  public reportLocalRollSettled(
    playerId: string,
    pinsKnocked: number,
    standingPinIds: number[],
    isGutter: boolean
  ): RollResult | null {
    const card = this.state.scorecards[playerId];
    if (!card) return null;

    const { result } = recordRoll(card, pinsKnocked, standingPinIds, isGutter);

    // Trigger haptics on paired phone immediately
    const player = this.state.players.find((p) => p.id === playerId);
    if (player?.controllerPeerId && !player.isDesktopFallback) {
      if (
        result.callout === 'STRIKE' ||
        result.callout === 'DOUBLE' ||
        result.callout === 'TURKEY' ||
        result.callout === 'FOUR_BAGGER' ||
        result.callout === 'FIVE_BAGGER' ||
        result.callout === 'PERFECT_GAME'
      ) {
        this.sendHapticToPlayer(playerId, 'strike');
      } else if (result.callout === 'SPARE' || result.callout === 'NICE_PICKUP') {
        this.sendHapticToPlayer(playerId, 'spare');
      } else if (result.isGutter) {
        this.sendHapticToPlayer(playerId, 'gutter');
      }
    }

    if (this.isHost()) {
      this.applyRollSettledAsHost(result);
    } else if (this.state.hostDisplayId) {
      this.peers.sendReliable(this.state.hostDisplayId, {
        type: 'roll-settled',
        result,
      });
    }

    return result;
  }

  public sendHapticToPlayer(playerId: string, pattern: HapticPattern): void {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.isDesktopFallback || !player.controllerPeerId) return;
    this.peers.sendReliable(player.controllerPeerId, { type: 'haptic', pattern });
  }

  public getActiveLocalPlayer(): PlayerProfile | null {
    const activeId = this.state.activePlayerByDisplay[this.displayId];
    if (!activeId) return null;
    return this.state.players.find((p) => p.id === activeId) ?? null;
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
      (peer.targetDisplayId === this.displayId ||
        (!peer.targetDisplayId && this.isHost()))
    ) {
      // Display waits for controller offer OR initiates deterministically
      void this.peers.connectToPeer(peer.peerId);
    }
  }

  private onPeerConnected(peerId: string): void {
    const info = this.roomPeers.get(peerId);
    if (!info) return;

    if (info.role === 'display') {
      if (this.isHost()) {
        this.peers.sendReliable(peerId, { type: 'match-state', state: this.state });
      }
      return;
    }

    // A mobile controller connected directly to THIS display
    if (info.role === 'controller') {
      const existing = this.state.players.find((p) => p.controllerPeerId === peerId);
      if (!existing && this.state.phase === 'lobby') {
        if (this.isHost()) {
          this.registerPlayerAsHost({
            name: info.displayName,
            displayId: this.displayId,
            controllerPeerId: peerId,
            isDesktopFallback: false,
            allowSharedController: false,
          });
        } else if (this.state.hostDisplayId) {
          this.peers.sendReliable(this.state.hostDisplayId, {
            type: 'request-register-player',
            name: info.displayName,
            displayId: this.displayId,
            controllerPeerId: peerId,
            allowSharedController: false,
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
      case 'match-state': {
        this.state = msg.state;
        if (this.state.phase !== 'playing') {
          this.lastNotifiedTurnByController.clear();
        }
        this.emitState();
        this.notifyAllLocalControllers();
        break;
      }
      case 'request-register-player': {
        if (this.state.phase !== 'lobby') return;
        if (isFromController) {
          if (this.isHost()) {
            this.registerPlayerAsHost({
              name: msg.name,
              color: msg.color,
              displayId: this.displayId,
              controllerPeerId: fromPeerId,
              isDesktopFallback: false,
              allowSharedController: true,
            });
          } else if (this.state.hostDisplayId) {
            this.peers.sendReliable(this.state.hostDisplayId, {
              type: 'request-register-player',
              name: msg.name,
              color: msg.color,
              displayId: this.displayId,
              controllerPeerId: fromPeerId,
              allowSharedController: true,
            });
          }
          return;
        }
        if (!this.isHost()) return;
        this.registerPlayerAsHost({
          name: msg.name,
          color: msg.color,
          displayId: msg.displayId,
          controllerPeerId: msg.controllerPeerId,
          isDesktopFallback: msg.controllerPeerId.startsWith('desktop-'),
          allowSharedController: Boolean(msg.allowSharedController),
        });
        break;
      }
      case 'request-remove-player': {
        if (this.state.phase !== 'lobby') return;
        const target = this.state.players.find((p) => p.id === msg.playerId);
        if (!target || !this.canRemovePlayer(target)) return;

        if (isFromController) {
          if (target.isDesktopFallback || target.controllerPeerId !== fromPeerId) return;
          if (this.isHost()) {
            this.removePlayerAsHost(target.id);
          } else if (this.state.hostDisplayId) {
            this.peers.sendReliable(this.state.hostDisplayId, {
              type: 'request-remove-player',
              playerId: target.id,
            });
          }
          return;
        }

        if (!this.isHost()) return;
        if (target.displayId !== fromPeerId) return;
        this.removePlayerAsHost(target.id);
        break;
      }
      case 'update-player-profile': {
        if (isFromController) {
          const target = this.state.players.find((p) => p.id === msg.playerId);
          if (!target || target.controllerPeerId !== fromPeerId) return;
          if (this.isHost()) {
            this.applyProfileUpdateAsHost(msg.playerId, msg.name, msg.color);
          } else if (this.state.hostDisplayId) {
            this.peers.sendReliable(this.state.hostDisplayId, {
              type: 'update-player-profile',
              playerId: msg.playerId,
              name: msg.name,
              color: msg.color,
            });
          }
          return;
        }
        if (!this.isHost()) return;
        this.applyProfileUpdateAsHost(msg.playerId, msg.name, msg.color);
        break;
      }
      case 'aim-update': {
        const player = this.resolvePlayerForController(fromPeerId, msg.playerId);
        if (!player) return;
        if (this.state.activePlayerByDisplay[this.displayId] !== player.id) return;
        this.callbacks.onRemoteAim(player.id, msg.aim);
        break;
      }
      case 'throw-release': {
        if (fromPeer?.role === 'display') {
          const remotePlayer = this.state.players.find(
            (p) => p.id === msg.playerId && p.displayId !== this.displayId
          );
          if (!remotePlayer) return;
          this.callbacks.onThrowRelease(remotePlayer.id, msg.throwParams);
          break;
        }

        const player = this.resolvePlayerForController(fromPeerId, msg.playerId);
        if (!player || player.displayId !== this.displayId) return;
        if (this.state.phase !== 'playing') return;
        if (this.state.activePlayerByDisplay[this.displayId] !== player.id) return;
        this.sendHapticToPlayer(player.id, 'release');
        this.submitLocalThrow(player.id, msg.throwParams);
        break;
      }
      case 'roll-settled': {
        if (!this.isHost()) return;
        this.applyRollSettledAsHost(msg.result);
        break;
      }
      case 'callout-broadcast': {
        this.callbacks.onCallout(msg.playerId, msg.callout, msg.pinsKnocked);
        break;
      }
      default:
        break;
    }
  }

  private handleRealtimeMessage(fromPeerId: string, msg: RealtimeMessage): void {
    if (msg.type === 'arm-pose') {
      const player = this.resolvePlayerForController(fromPeerId, msg.playerId);
      if (!player) return;
      if (this.state.activePlayerByDisplay[this.displayId] !== player.id) return;
      this.callbacks.onRemoteArmPose(player.id, msg.pose, msg.aim);
      return;
    }
    if (msg.type === 'lane-snapshot') {
      this.callbacks.onRemoteLaneSnapshot(msg.snapshot);
    }
  }

  private resolvePlayerForController(
    fromPeerId: string,
    claimedPlayerId: string
  ): PlayerProfile | undefined {
    if (claimedPlayerId) {
      return this.state.players.find(
        (p) => p.id === claimedPlayerId && p.controllerPeerId === fromPeerId
      );
    }
    const activeId = this.state.activePlayerByDisplay[this.displayId];
    return (
      this.state.players.find(
        (p) => p.id === activeId && p.controllerPeerId === fromPeerId
      ) ?? this.state.players.find((p) => p.controllerPeerId === fromPeerId)
    );
  }

  private canRemovePlayer(target: PlayerProfile): boolean {
    if (target.isDesktopFallback) return true;
    if (!target.controllerPeerId) return false;
    const sharedCount = this.state.players.filter(
      (p) => !p.isDesktopFallback && p.controllerPeerId === target.controllerPeerId
    ).length;
    return sharedCount > 1;
  }

  private removePlayerAsHost(playerId: string): void {
    if (this.state.phase !== 'lobby') return;
    const target = this.state.players.find((p) => p.id === playerId);
    if (!target || !this.canRemovePlayer(target)) return;

    const nextScorecards = { ...this.state.scorecards };
    delete nextScorecards[playerId];

    this.state = {
      ...this.state,
      players: this.state.players.filter((p) => p.id !== playerId),
      scorecards: nextScorecards,
    };
    this.reassignLanesAndTurnsAsHost();
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  private registerPlayerAsHost(input: {
    name: string;
    color?: BallColorId;
    displayId: string;
    controllerPeerId: string;
    isDesktopFallback: boolean;
    allowSharedController: boolean;
  }): void {
    if (this.state.phase !== 'lobby') return;
    if (this.state.players.length >= MAX_ROOM_PLAYERS) return;
    if (
      !input.allowSharedController &&
      this.state.players.some((p) => p.controllerPeerId === input.controllerPeerId)
    ) {
      return;
    }

    const usedColors = new Set(this.state.players.map((p) => p.color));
    const color =
      input.color ??
      BALL_COLOR_ORDER.find((c) => !usedColors.has(c)) ??
      BALL_COLOR_ORDER[this.state.players.length % BALL_COLOR_ORDER.length];

    const playerId = createPeerId('p');
    const laneIndex = PLAYER_LANE_ORDER[this.state.players.length] ?? 2;

    const profile: PlayerProfile = {
      id: playerId,
      name: input.name.trim().slice(0, 16) || `Bowler ${this.state.players.length + 1}`,
      color,
      displayId: input.displayId,
      controllerPeerId: input.controllerPeerId,
      isDesktopFallback: input.isDesktopFallback,
      laneIndex,
      connected: true,
    };

    const nextPlayers = [...this.state.players, profile];
    const nextScorecards = {
      ...this.state.scorecards,
      [playerId]: createEmptyScorecard(playerId),
    };

    this.state = {
      ...this.state,
      players: nextPlayers,
      scorecards: nextScorecards,
    };
    this.refreshActivePlayersPerDisplayAsHost();
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  private applyProfileUpdateAsHost(
    playerId: string,
    name?: string,
    color?: BallColorId
  ): void {
    this.state = {
      ...this.state,
      players: this.state.players.map((p) =>
        p.id === playerId
          ? {
              ...p,
              name: name !== undefined ? name.trim().slice(0, 16) || p.name : p.name,
              color: color ?? p.color,
            }
          : p
      ),
    };
    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  private handlePeerDepartedAsHost(peer: RoomPeerInfo): void {
    if (this.state.phase === 'lobby') {
      const removedIds = new Set(
        this.state.players
          .filter(
            (p) => p.controllerPeerId === peer.peerId || p.displayId === peer.peerId
          )
          .map((p) => p.id)
      );
      const nextPlayers = this.state.players.filter((p) => !removedIds.has(p.id));
      const nextScorecards = { ...this.state.scorecards };
      for (const id of removedIds) {
        delete nextScorecards[id];
      }
      this.state = { ...this.state, players: nextPlayers, scorecards: nextScorecards };
      this.reassignLanesAndTurnsAsHost();
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

  private applyRollSettledAsHost(result: RollResult): void {
    const prevCard = this.state.scorecards[result.playerId];
    if (!prevCard) return;

    const { scorecard, result: computed } = recordRoll(
      prevCard,
      result.pinsKnocked,
      result.standingPinIds,
      result.isGutter
    );

    const nextScorecards = {
      ...this.state.scorecards,
      [result.playerId]: scorecard,
    };

    this.state = {
      ...this.state,
      scorecards: nextScorecards,
    };

    // Broadcast callout banner across all displays
    this.callbacks.onCallout(result.playerId, computed.callout, computed.pinsKnocked);
    this.peers.broadcastReliable(
      {
        type: 'callout-broadcast',
        playerId: result.playerId,
        callout: computed.callout,
        pinsKnocked: computed.pinsKnocked,
      },
      this.getOtherDisplayPeerIds()
    );

    // Advance turn on that player's display if their frame finished
    const player = this.state.players.find((p) => p.id === result.playerId);
    if (player && computed.frameCompleted) {
      this.advanceTurnForDisplayAsHost(player.displayId, player.id);
    }

    // Check if ALL players across all displays are finished
    const allFinished =
      this.state.players.length > 0 &&
      this.state.players.every((p) => this.state.scorecards[p.id]?.isFinished);

    if (allFinished) {
      this.state = {
        ...this.state,
        phase: 'finished',
      };
    }

    this.broadcastMatchStateAsHost();
    this.notifyAllLocalControllers();
  }

  private advanceTurnForDisplayAsHost(displayId: string, justFinishedPlayerId: string): void {
    const localPlayers = this.state.players.filter((p) => p.displayId === displayId);
    if (localPlayers.length === 0) {
      this.state.activePlayerByDisplay = {
        ...this.state.activePlayerByDisplay,
        [displayId]: null,
      };
      return;
    }

    // Find next unfinished player in round-robin order who is on the lowest frame
    const idx = localPlayers.findIndex((p) => p.id === justFinishedPlayerId);
    const ordered = [
      ...localPlayers.slice(idx + 1),
      ...localPlayers.slice(0, idx + 1),
    ];
    const nextUnfinished = ordered.find((p) => !this.state.scorecards[p.id]?.isFinished);

    this.state = {
      ...this.state,
      activePlayerByDisplay: {
        ...this.state.activePlayerByDisplay,
        [displayId]: nextUnfinished ? nextUnfinished.id : null,
      },
    };
  }

  private reassignLanesAndTurnsAsHost(): void {
    this.state = {
      ...this.state,
      players: this.state.players.map((p, idx) => ({
        ...p,
        laneIndex: PLAYER_LANE_ORDER[idx] ?? 2,
      })),
    };
    this.refreshActivePlayersPerDisplayAsHost();
  }

  private refreshActivePlayersPerDisplayAsHost(): void {
    const map: Record<string, string | null> = {};
    const displayIds = new Set(this.state.players.map((p) => p.displayId));
    for (const dId of displayIds) {
      const local = this.state.players.filter((p) => p.displayId === dId);
      const current = this.state.activePlayerByDisplay[dId];
      const stillValid =
        current &&
        local.some((p) => p.id === current && !this.state.scorecards[p.id]?.isFinished);
      if (stillValid) {
        map[dId] = current;
      } else {
        const firstUnfinished = local.find((p) => !this.state.scorecards[p.id]?.isFinished);
        map[dId] = firstUnfinished ? firstUnfinished.id : null;
      }
    }
    this.state = { ...this.state, activePlayerByDisplay: map };
  }

  private broadcastMatchStateAsHost(): void {
    this.emitState();
    this.peers.broadcastReliable(
      { type: 'match-state', state: this.state },
      this.getOtherDisplayPeerIds()
    );
  }

  private notifyAllLocalControllers(): void {
    if (this.state.phase !== 'playing') {
      this.lastNotifiedTurnByController.clear();
    }

    const payloads = buildControllerStatusPayloads(this.state, this.displayId);
    for (const [controllerPeerId, payload] of payloads.entries()) {
      this.peers.sendReliable(controllerPeerId, {
        type: 'controller-status',
        ...payload,
      });

      if (payload.isMyTurn) {
        const turnKey = `${payload.playerId}-${payload.frameNumber}-${payload.rollNumber}`;
        if (this.lastNotifiedTurnByController.get(controllerPeerId) !== turnKey) {
          this.lastNotifiedTurnByController.set(controllerPeerId, turnKey);
          this.peers.sendReliable(controllerPeerId, {
            type: 'haptic',
            pattern: 'your-turn',
          });
        }
      } else {
        this.lastNotifiedTurnByController.delete(controllerPeerId);
      }
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

export interface ControllerStatusPayload {
  playerId: string;
  isMyTurn: boolean;
  frameNumber: number;
  rollNumber: number;
  totalScore: number;
  phase: MatchState['phase'];
  activePlayerName: string;
  ballColor: BallColorId;
  playerName: string;
  players: ControllerPlayerSummary[];
  roomPlayerCount: number;
  maxPlayers: number;
}

export interface PhoneSessionCallbacks {
  onConnectionStatus: (status: PeerConnectionStatus) => void;
  onControllerStatus: (status: ControllerStatusPayload) => void;
  onHaptic: (pattern: HapticPattern) => void;
  onError: (message: string) => void;
}

/**
 * Lightweight WebRTC client for a Mobile Phone Controller pairing directly to its Display.
 */
export class PhoneControllerSession {
  public readonly peerId: string;
  private readonly signaling: SignalingClient;
  private readonly peers: PeerManager;
  private readonly callbacks: PhoneSessionCallbacks;
  private targetDisplayId: string | null = null;
  private assignedPlayerId = '';

  constructor(callbacks: PhoneSessionCallbacks, peerId = createPeerId('phone')) {
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
          this.callbacks.onError('No active game screen was found in this room.');
          return;
        }
        void this.peers.connectToPeer(this.targetDisplayId);
      },
      onPeerLeft: (peerId) => {
        if (peerId === this.targetDisplayId) {
          this.callbacks.onConnectionStatus('disconnected');
          this.callbacks.onError('The game screen disconnected.');
        }
      },
      onSignal: (fromPeerId, payload) => {
        void this.peers.handleSignal(fromPeerId, payload);
      },
      onError: (msg) => {
        this.callbacks.onError(msg);
      },
    });

    this.peers = new PeerManager(this.peerId, {
      sendSignal: (to, payload) => this.signaling.sendSignal(to, payload),
      onReliableMessage: (_from, msg) => {
        if (msg.type === 'controller-status') {
          this.assignedPlayerId = msg.playerId;
          this.callbacks.onControllerStatus(msg);
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

  public sendAim(aim: AimState): void {
    if (!this.targetDisplayId) return;
    this.peers.sendReliable(this.targetDisplayId, {
      type: 'aim-update',
      playerId: this.assignedPlayerId,
      aim,
    });
  }

  public sendArmPose(pose: ArmPoseState, aim: AimState): void {
    if (!this.targetDisplayId) return;
    this.peers.sendRealtime(this.targetDisplayId, {
      type: 'arm-pose',
      playerId: this.assignedPlayerId,
      pose,
      aim,
    });
  }

  public sendThrow(throwParams: ThrowParams): void {
    if (!this.targetDisplayId) return;
    this.peers.sendReliable(this.targetDisplayId, {
      type: 'throw-release',
      playerId: this.assignedPlayerId,
      throwParams,
    });
  }

  public addPlayer(name?: string, color?: BallColorId): void {
    if (!this.targetDisplayId) return;
    this.peers.sendReliable(this.targetDisplayId, {
      type: 'request-register-player',
      name: name?.trim() || 'Player',
      color,
      displayId: this.targetDisplayId,
      controllerPeerId: this.peerId,
      allowSharedController: true,
    });
  }

  public removePlayer(playerId: string): void {
    if (!this.targetDisplayId) return;
    this.peers.sendReliable(this.targetDisplayId, {
      type: 'request-remove-player',
      playerId,
    });
  }

  public updatePlayerProfile(
    playerId: string,
    patch: { name?: string; color?: BallColorId }
  ): void {
    if (!this.targetDisplayId) return;
    this.peers.sendReliable(this.targetDisplayId, {
      type: 'update-player-profile',
      playerId,
      ...patch,
    });
  }

  public destroy(): void {
    this.peers.closeAll();
    this.signaling.close();
  }
}

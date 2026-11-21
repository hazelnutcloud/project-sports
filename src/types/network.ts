import type {
  AimState,
  ArmPoseState,
  BallColorId,
  LaneSnapshot,
  MatchState,
  RollResult,
  ThrowParams,
} from './game';
import type { SportId } from '../data/sports';
import type {
  TennisCalloutType,
  TennisControllerStatusPayload,
  TennisMatchConfig,
  TennisMatchState,
  TennisRacketPose,
  TennisStateSnapshot,
  TennisSwingInput,
  TennisTeamId,
} from './tennis';

export type PeerRole = 'display' | 'controller';

export interface RoomPeerInfo {
  peerId: string;
  role: PeerRole;
  displayName: string;
  targetDisplayId?: string;
}

export type SignalingOutMessage =
  | {
      type: 'create-room';
      peerId: string;
      displayName: string;
      roomCode?: string;
      sport?: SportId;
    }
  | {
      type: 'join-room';
      roomCode: string;
      peerId: string;
      role: PeerRole;
      displayName: string;
      targetDisplayId?: string;
    }
  | { type: 'signal'; toPeerId: string; payload: SignalPayload }
  | { type: 'leave-room' }
  | { type: 'ping' };

export type SignalPayload =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

export type SignalingInMessage =
  | {
      type: 'room-joined';
      roomCode: string;
      peerId: string;
      hostDisplayId: string | null;
      sport?: SportId;
      peers: RoomPeerInfo[];
    }
  | { type: 'peer-joined'; peer: RoomPeerInfo; hostDisplayId: string | null }
  | { type: 'peer-left'; peerId: string; hostDisplayId: string | null }
  | { type: 'signal'; fromPeerId: string; payload: SignalPayload }
  | { type: 'error'; code?: string; message: string }
  | { type: 'pong'; ts: number };

export type HapticPattern =
  | 'tick'
  | 'release'
  | 'pin-hit'
  | 'strike'
  | 'spare'
  | 'gutter'
  | 'your-turn'
  | 'racket-hit'
  | 'smash-hit'
  | 'serve-toss'
  | 'point-won'
  | 'fault';

export interface ControllerPlayerSummary {
  playerId: string;
  name: string;
  color: BallColorId;
  laneIndex: number;
  frameNumber: number;
  rollNumber: number;
  totalScore: number;
  isFinished: boolean;
  isActiveTurn: boolean;
}

export type ReliableMessage =
  | { type: 'match-state'; state: MatchState }
  | {
      type: 'request-register-player';
      name: string;
      color?: BallColorId;
      displayId: string;
      controllerPeerId: string;
      allowSharedController?: boolean;
    }
  | { type: 'request-remove-player'; playerId: string }
  | { type: 'update-player-profile'; playerId: string; name?: string; color?: BallColorId }
  | { type: 'start-match' }
  | { type: 'rematch' }
  | { type: 'aim-update'; playerId: string; aim: AimState }
  | { type: 'throw-release'; playerId: string; throwParams: ThrowParams }
  | { type: 'roll-settled'; result: RollResult }
  | {
      type: 'controller-status';
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
  | { type: 'haptic'; pattern: HapticPattern }
  | { type: 'callout-broadcast'; playerId: string; callout: RollResult['callout']; pinsKnocked: number }
  // Tennis reliable messages
  | { type: 'tennis-match-state'; state: TennisMatchState }
  | { type: 'tennis-config-update'; config: Partial<TennisMatchConfig> }
  | { type: 'tennis-assign-team'; playerId: string; team: TennisTeamId }
  | { type: 'tennis-serve-toss'; playerId: string }
  | { type: 'tennis-swing'; playerId: string; swing: TennisSwingInput }
  | { type: 'tennis-controller-status'; payload: TennisControllerStatusPayload }
  | { type: 'tennis-callout'; callout: TennisCalloutType; subtitle?: string };

export type RealtimeMessage =
  | { type: 'arm-pose'; playerId: string; pose: ArmPoseState; aim: AimState }
  | { type: 'lane-snapshot'; snapshot: LaneSnapshot }
  // Tennis realtime messages
  | { type: 'tennis-racket-pose'; playerId: string; pose: TennisRacketPose }
  | { type: 'tennis-snapshot'; snapshot: TennisStateSnapshot };

export type PeerConnectionStatus = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed';

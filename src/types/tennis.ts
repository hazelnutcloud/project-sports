import type { BallColorId, MatchPhase } from './game';

export type TennisTeamId = 'near' | 'far';
export type TennisCourtRole = 'back' | 'front';
export type TennisSlotId = 'near-back' | 'near-front' | 'far-back' | 'far-front';
export type TennisCourtMode = 'singles' | 'doubles';
export type TennisFormat = '1-game' | 'best-of-3';
export type TennisDifficulty = 'rookie' | 'pro' | 'champion';
export type TennisShotType = 'flat' | 'topspin' | 'slice' | 'lob' | 'smash' | 'serve';
export type TennisStrokeSide = 'forehand' | 'backhand' | 'overhead';

export type TennisRallyPhase =
  | 'waiting-serve'
  | 'serve-toss'
  | 'rally'
  | 'point-over'
  | 'game-over'
  | 'match-over';

export type TennisCalloutType =
  | 'ACE'
  | 'POWER_SERVE'
  | 'FAULT'
  | 'DOUBLE_FAULT'
  | 'LET'
  | 'OUT'
  | 'NET'
  | 'DEUCE'
  | 'ADVANTAGE'
  | 'GAME_POINT'
  | 'MATCH_POINT'
  | 'GAME'
  | 'SMASH'
  | 'NICE_SHOT'
  | 'MATCH_WIN';

export interface TennisMatchConfig {
  courtMode: TennisCourtMode;
  format: TennisFormat;
  difficulty: TennisDifficulty;
}

export interface TennisPlayer {
  id: string;
  name: string;
  color: BallColorId;
  displayId: string;
  controllerPeerId: string | null;
  isDesktopFallback: boolean;
  desktopSlot?: 1 | 2;
  team: TennisTeamId;
  connected: boolean;
}

export interface TennisCourtSlot {
  slotId: TennisSlotId;
  team: TennisTeamId;
  role: TennisCourtRole;
  playerId: string | null;
  isAi: boolean;
  name: string;
  color: BallColorId;
}

export interface TennisSwingInput {
  playerId: string;
  strokeSide: TennisStrokeSide;
  shotType: TennisShotType;
  /** Normalized swing power in [0, 1] */
  power: number;
  /** Optional aim bias in [-1, 1] (-1 = left sideline, +1 = right sideline) */
  aimBias: number;
  /** Spin in [-1, 1] (negative = backspin slice, positive = topspin) */
  spin: number;
  timestampMs: number;
}

export interface TennisRacketPose {
  /** Racket pitch in radians */
  pitch: number;
  /** Racket face roll in radians */
  roll: number;
  /** Racket horizontal yaw in radians */
  yaw: number;
  /** Instantaneous swing energy [0..1] */
  swingEnergy: number;
}

export interface TennisMatchStats {
  aces: { near: number; far: number };
  winners: { near: number; far: number };
  doubleFaults: { near: number; far: number };
  longestRally: number;
  totalPoints: number;
}

export interface TennisScoreState {
  format: TennisFormat;
  courtMode: TennisCourtMode;
  gamesToWin: number;
  games: { near: number; far: number };
  points: { near: number; far: number };
  servingTeam: TennisTeamId;
  servingSlot: TennisSlotId;
  serverRotationIndex: number;
  serveSide: 'deuce' | 'ad';
  serveFaultCount: 0 | 1;
  winnerTeam: TennisTeamId | null;
  currentRally: number;
  stats: TennisMatchStats;
}

export interface TennisMatchState {
  roomCode: string;
  hostDisplayId: string;
  phase: MatchPhase;
  config: TennisMatchConfig;
  players: TennisPlayer[];
  slots: TennisCourtSlot[];
  score: TennisScoreState;
}

export interface TennisAvatarSnapshot {
  slotId: TennisSlotId;
  team: TennisTeamId;
  role: TennisCourtRole;
  color: BallColorId;
  name: string;
  isAi: boolean;
  x: number;
  z: number;
  facingY: number;
  runSpeed: number;
  swingKind: 'none' | 'forehand' | 'backhand' | 'serve' | 'volley' | 'celebrate';
  swingProgress: number; // 0..1
  racketPitch: number;
  racketRoll: number;
}

export interface TennisStateSnapshot {
  rallyPhase: TennisRallyPhase;
  ballActive: boolean;
  ballPos: [number, number, number];
  ballVel: [number, number, number];
  ballSpin: number;
  shotType: TennisShotType;
  isPowerShot: boolean;
  rallyCount: number;
  serveTossProgress: number; // 0..1 (sweet spot near 0.5)
  targetMarker: {
    visible: boolean;
    x: number;
    z: number;
    urgency: number; // 0..1 shrinks ring as ball arrives
    team: TennisTeamId;
  };
  avatars: TennisAvatarSnapshot[];
}

export interface TennisControllerStatusPayload {
  playerId: string;
  playerName: string;
  color: BallColorId;
  team: TennisTeamId;
  phase: MatchPhase;
  rallyPhase: TennisRallyPhase;
  isMyServe: boolean;
  canSwing: boolean;
  courtMode: TennisCourtMode;
  format: TennisFormat;
  gamesNear: number;
  gamesFar: number;
  pointsNearLabel: string;
  pointsFarLabel: string;
  serveFaultCount: 0 | 1;
  winnerTeam: TennisTeamId | null;
  roomPlayerCount: number;
  maxPlayers: number;
}

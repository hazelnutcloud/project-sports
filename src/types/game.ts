export type BallColorId = 'purple' | 'coral' | 'cyan' | 'gold';

export interface BallColorSpec {
  id: BallColorId;
  label: string;
  primary: string;
  swirl: string;
  accent: string;
  trail: string;
}

export const BALL_COLORS: Record<BallColorId, BallColorSpec> = {
  purple: {
    id: 'purple',
    label: 'Spocco Purple',
    primary: '#7c3aed',
    swirl: '#c084fc',
    accent: '#4c1d95',
    trail: '#38f8e2',
  },
  coral: {
    id: 'coral',
    label: 'Sunset Coral',
    primary: '#f43f5e',
    swirl: '#fda4af',
    accent: '#9f1239',
    trail: '#fbbf24',
  },
  cyan: {
    id: 'cyan',
    label: 'Aqua Surge',
    primary: '#0891b2',
    swirl: '#67e8f9',
    accent: '#155e75',
    trail: '#a78bfa',
  },
  gold: {
    id: 'gold',
    label: 'Solar Gold',
    primary: '#d97706',
    swirl: '#fde047',
    accent: '#92400e',
    trail: '#34d399',
  },
};

export const BALL_COLOR_ORDER: BallColorId[] = ['purple', 'coral', 'cyan', 'gold'];

// Maps up to 4 players onto our 5-lane alley (center lane = 2)
export const PLAYER_LANE_ORDER = [2, 3, 1, 4] as const;

export interface PlayerProfile {
  id: string;
  name: string;
  color: BallColorId;
  displayId: string;
  controllerPeerId: string | null;
  isDesktopFallback: boolean;
  laneIndex: number;
  connected: boolean;
}

export interface AimState {
  /** Lateral offset from lane center in meters (-0.42 to +0.42) */
  xOffset: number;
  /** Aim angle in radians (-0.18 to +0.18, positive aims right) */
  aimAngle: number;
}

export interface ArmPoseState {
  /** Normalized swing angle in radians: negative = backswing, positive = forward swing */
  pitch: number;
  /** Wrist roll in radians: negative = counter-clockwise (left hook), positive = right hook */
  roll: number;
  /** True while holding ZR / thumb grip */
  holdingGrip: boolean;
  /** Current swing phase for visual feedback */
  phase: 'idle' | 'armed' | 'backswing' | 'forwardswing' | 'released';
}

export interface ThrowParams {
  xOffset: number;
  aimAngle: number;
  /** Initial ball speed down the lane in m/s (6.5 .. 14.5) */
  speed: number;
  /** Hook spin in [-1, 1]: negative hooks left (typical right-hander), positive hooks right */
  spin: number;
  /** Subtle vertical loft in m/s (0 .. 1.6) */
  loft: number;
}

export type CalloutType =
  | 'STRIKE'
  | 'DOUBLE'
  | 'TURKEY'
  | 'FOUR_BAGGER'
  | 'FIVE_BAGGER'
  | 'SPARE'
  | 'SPLIT'
  | 'GUTTER'
  | 'NICE_PICKUP'
  | 'PERFECT_GAME';

export interface FrameData {
  frameNumber: number; // 1..10
  rolls: number[];
  /** Symbols per roll: 'X', '/', '-', '1'..'9' */
  symbols: string[];
  /** Cumulative score up to this frame once resolved, else null */
  cumulativeScore: number | null;
  isStrike: boolean;
  isSpare: boolean;
  isSplit: boolean;
  isComplete: boolean;
}

export interface PlayerScorecard {
  playerId: string;
  frames: FrameData[];
  currentFrameIndex: number; // 0..9
  totalScore: number;
  isFinished: boolean;
  consecutiveStrikes: number;
  /** Indices (0..9) of pins currently standing on this player's lane */
  standingPinIds: number[];
}

export interface RollResult {
  playerId: string;
  frameNumber: number;
  rollIndexInFrame: number;
  pinsKnocked: number;
  standingPinIds: number[];
  isGutter: boolean;
  callout: CalloutType | null;
  needsFullReset: boolean;
  frameCompleted: boolean;
  gameFinished: boolean;
}

export type MatchPhase = 'lobby' | 'playing' | 'finished';

export interface MatchState {
  roomCode: string;
  hostDisplayId: string;
  phase: MatchPhase;
  players: PlayerProfile[];
  scorecards: Record<string, PlayerScorecard>;
  /** Per-display active local player id */
  activePlayerByDisplay: Record<string, string | null>;
}

export interface LaneClearingSnapshot {
  sweeperY: number;
  sweeperZ: number;
  setterVisible: boolean;
  setterY: number;
  setterZOffset: number;
  grippedPinIds: number[];
}

export interface LaneSnapshot {
  playerId: string;
  laneIndex: number;
  color: BallColorId;
  ballActive: boolean;
  ballPos: [number, number, number];
  ballQuat: [number, number, number, number];
  ballSpin: number;
  /** Array of 10 pin transforms [px, py, pz, qx, qy, qz, qw] */
  pins: Array<[number, number, number, number, number, number, number] | null>;
  clearing?: LaneClearingSnapshot;
}

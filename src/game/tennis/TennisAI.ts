import type {
  TennisCourtMode,
  TennisDifficulty,
  TennisShotType,
  TennisSlotId,
  TennisSwingInput,
  TennisTeamId,
} from '../../types/tennis';
import {
  COURT_HALF_LENGTH,
  DOUBLES_HALF_WIDTH,
  SINGLES_HALF_WIDTH,
  type BallInterceptPrediction,
  type TennisBallState,
} from './TennisPhysics';

export interface CourtActorState {
  slotId: TennisSlotId;
  team: TennisTeamId;
  role: 'back' | 'front';
  isAi: boolean;
  playerId: string | null;
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface DifficultyProfile {
  sprintSpeed: number;
  accel: number;
  reactionDelaySec: number;
  aimAccuracy: number; // 0..1
  powerMin: number;
  powerMax: number;
  timingJitter: number; // max random timing offset
  powerServeChance: number;
  lobChance: number;
  sliceChance: number;
  missChanceOnExtreme: number;
}

export const AI_DIFFICULTY_PROFILES: Record<TennisDifficulty, DifficultyProfile> = {
  rookie: {
    sprintSpeed: 5.4,
    accel: 16,
    reactionDelaySec: 0.24,
    aimAccuracy: 0.52,
    powerMin: 0.35,
    powerMax: 0.62,
    timingJitter: 0.32,
    powerServeChance: 0.05,
    lobChance: 0.08,
    sliceChance: 0.14,
    missChanceOnExtreme: 0.28,
  },
  pro: {
    sprintSpeed: 6.7,
    accel: 22,
    reactionDelaySec: 0.12,
    aimAccuracy: 0.78,
    powerMin: 0.52,
    powerMax: 0.82,
    timingJitter: 0.16,
    powerServeChance: 0.22,
    lobChance: 0.16,
    sliceChance: 0.24,
    missChanceOnExtreme: 0.12,
  },
  champion: {
    sprintSpeed: 7.9,
    accel: 28,
    reactionDelaySec: 0.04,
    aimAccuracy: 0.94,
    powerMin: 0.68,
    powerMax: 0.96,
    timingJitter: 0.07,
    powerServeChance: 0.48,
    lobChance: 0.22,
    sliceChance: 0.28,
    missChanceOnExtreme: 0.04,
  },
};

export const HUMAN_SPRINT_SPEED = 7.6;
export const HUMAN_ACCEL = 26;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Returns the resting home court coordinates for any court slot.
 */
export function getHomeCourtPosition(
  slotId: TennisSlotId,
  courtMode: TennisCourtMode
): { x: number; z: number } {
  const isNear = slotId.startsWith('near');
  const isFront = slotId.endsWith('front');
  const sign = isNear ? 1 : -1;

  if (courtMode === 'singles') {
    return { x: 0, z: sign * (COURT_HALF_LENGTH - 0.35) };
  }

  if (isFront) {
    // Front net player shades slightly opposite the baseline player
    return { x: isNear ? -1.45 : 1.45, z: sign * 3.85 };
  }
  return { x: isNear ? 1.15 : -1.15, z: sign * (COURT_HALF_LENGTH - 0.4) };
}

/**
 * Determines which actor on the receiving team should chase the incoming ball
 * (handles Singles 1-player and Doubles front/back split).
 */
export function selectResponsibleSlot(
  teamActors: CourtActorState[],
  prediction: BallInterceptPrediction | null,
  ball: TennisBallState
): TennisSlotId | null {
  if (teamActors.length === 0) return null;
  if (teamActors.length === 1) return teamActors[0].slotId;

  const front = teamActors.find((a) => a.role === 'front');
  const back = teamActors.find((a) => a.role === 'back');
  if (!front || !back) return teamActors[0].slotId;

  // Front player takes short/mid volleys near the net if ball is reachable and not a soaring lob
  if (prediction) {
    const absBounceZ = Math.abs(prediction.bouncePos.z);
    const absStrikeZ = Math.abs(prediction.strikePos.z);
    const isLob = ball.shotType === 'lob';
    const frontDistX = Math.abs(front.x - prediction.bouncePos.x);

    if (!isLob && (absBounceZ < 6.4 || absStrikeZ < 6.6) && frontDistX < 3.6) {
      return front.slotId;
    }
  }

  return back.slotId;
}

/**
 * Computes the desired target position for a player slot using Switch Sports Auto-Run.
 * Leaves comfortable racket reach offset (~0.72m) laterally so strokes animate cleanly.
 */
export function computeAutoRunTarget(
  actor: CourtActorState,
  responsibleSlot: TennisSlotId | null,
  prediction: BallInterceptPrediction | null,
  ball: TennisBallState,
  courtMode: TennisCourtMode,
  manualNudgeX = 0
): { x: number; z: number } {
  const home = getHomeCourtPosition(actor.slotId, courtMode);
  const maxW = (courtMode === 'doubles' ? DOUBLES_HALF_WIDTH : SINGLES_HALF_WIDTH) + 1.45;
  const sign = actor.team === 'near' ? 1 : -1;

  if (!ball.active || !prediction || prediction.receivingTeam !== actor.team) {
    // Ball going away -> smoothly recover to home position (with subtle lateral shade toward ball X)
    const shadeX = ball.active ? clamp(ball.pos.x * 0.25, -1.6, 1.6) : 0;
    return {
      x: clamp(home.x + shadeX + manualNudgeX * 0.8, -maxW, maxW),
      z: home.z,
    };
  }

  if (actor.slotId === responsibleSlot) {
    const strike = prediction.strikePos;
    // Stand slightly to the left of the ball for a forehand (for right-handed near player)
    // or to the right when ball is clearly on backhand side
    const sideOffset = strike.x >= actor.x ? -0.68 * sign : 0.68 * sign;
    let targetZ = strike.z;

    if (actor.role === 'front' && courtMode === 'doubles') {
      // Front player intercepts closer to net on the volley
      targetZ = sign * clamp(Math.abs(prediction.bouncePos.z) * 0.72, 2.3, 5.4);
    } else {
      targetZ = sign * clamp(Math.abs(strike.z) + 0.35, 4.5, COURT_HALF_LENGTH + 1.85);
    }

    return {
      x: clamp(strike.x + sideOffset + manualNudgeX * 0.35, -maxW, maxW),
      z: targetZ,
    };
  }

  // Non-chasing doubles partner shifts laterally to guard the open half of the court
  const partnerShadeX = prediction.strikePos.x >= 0 ? -1.85 : 1.85;
  return {
    x: clamp(partnerShadeX, -maxW + 0.8, maxW - 0.8),
    z: home.z,
  };
}

/**
 * Advances an actor's position smoothly toward their auto-run target.
 */
export function stepActorMovement(
  actor: CourtActorState,
  target: { x: number; z: number },
  dt: number,
  difficulty: TennisDifficulty
): number {
  const maxSpeed = actor.isAi
    ? AI_DIFFICULTY_PROFILES[difficulty].sprintSpeed
    : HUMAN_SPRINT_SPEED;
  const accel = actor.isAi ? AI_DIFFICULTY_PROFILES[difficulty].accel : HUMAN_ACCEL;

  const dx = target.x - actor.x;
  const dz = target.z - actor.z;
  const dist = Math.hypot(dx, dz);

  let desiredVx = 0;
  let desiredVz = 0;
  if (dist > 0.04) {
    const speed = Math.min(maxSpeed, dist * 5.8);
    desiredVx = (dx / dist) * speed;
    desiredVz = (dz / dist) * speed;
  }

  const blend = 1 - Math.exp(-accel * dt);
  actor.vx += (desiredVx - actor.vx) * blend;
  actor.vz += (desiredVz - actor.vz) * blend;
  actor.x += actor.vx * dt;
  actor.z += actor.vz * dt;

  return Math.hypot(actor.vx, actor.vz);
}

/**
 * Decides what shot an AI player should hit when the ball enters their strike zone.
 */
export function decideAiReturnSwing(
  actor: CourtActorState,
  ball: TennisBallState,
  opponentPositions: Array<{ x: number; z: number }>,
  difficulty: TennisDifficulty,
  courtMode: TennisCourtMode,
  nowMs: number
): TennisSwingInput | null {
  const profile = AI_DIFFICULTY_PROFILES[difficulty];
  const halfW = courtMode === 'doubles' ? DOUBLES_HALF_WIDTH : SINGLES_HALF_WIDTH;

  // Check if ball is far / extreme and AI occasionally whiffs on lower difficulty
  const distToBall = Math.hypot(ball.pos.x - actor.x, ball.pos.z - actor.z);
  if (distToBall > 2.35) return null;
  if (distToBall > 1.75 && Math.random() < profile.missChanceOnExtreme) {
    return null;
  }

  // Pick open space away from opponents
  const avgOppX =
    opponentPositions.length > 0
      ? opponentPositions.reduce((s, p) => s + p.x, 0) / opponentPositions.length
      : 0;
  const targetSide = avgOppX >= 0 ? -1 : 1;
  const rawAim = targetSide * (0.45 + Math.random() * 0.42);
  const aimBias = clamp(
    rawAim * profile.aimAccuracy + (Math.random() * 2 - 1) * (1 - profile.aimAccuracy) * 0.5,
    -0.88,
    0.88
  );

  // Pick shot type based on ball height, court position, and difficulty
  let shotType: TennisShotType = 'topspin';
  let spin = 0.55;
  const roll = Math.random();

  if (ball.pos.y > 1.75 && Math.abs(actor.z) < 6.5) {
    shotType = 'smash';
    spin = 0.35;
  } else if (actor.role === 'front' && Math.abs(actor.z) < 5.5) {
    shotType = 'flat';
    spin = 0.1;
  } else if (roll < profile.lobChance && opponentPositions.some((p) => Math.abs(p.z) < 5.5)) {
    shotType = 'lob';
    spin = 0.25;
  } else if (roll < profile.lobChance + profile.sliceChance) {
    shotType = 'slice';
    spin = -0.65;
  } else {
    shotType = 'topspin';
    spin = 0.65;
  }

  const power =
    profile.powerMin + Math.random() * (profile.powerMax - profile.powerMin);
  const strokeSide =
    shotType === 'smash'
      ? 'overhead'
      : (actor.team === 'near' ? ball.pos.x >= actor.x : ball.pos.x <= actor.x)
        ? 'forehand'
        : 'backhand';

  // Ensure aim stays within sensible bounds scaled to court width
  const safeAim = clamp(aimBias * (halfW / SINGLES_HALF_WIDTH > 1.1 ? 0.92 : 0.86), -0.92, 0.92);

  return {
    playerId: actor.playerId ?? actor.slotId,
    strokeSide,
    shotType,
    power,
    aimBias: safeAim,
    spin,
    timestampMs: nowMs,
  };
}

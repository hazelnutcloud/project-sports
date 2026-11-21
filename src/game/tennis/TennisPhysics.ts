import type {
  TennisCourtMode,
  TennisShotType,
  TennisTeamId,
} from '../../types/tennis';

// Regulation tennis court geometry in meters (net at z = 0; near team at +z, far team at -z)
export const COURT_HALF_LENGTH = 11.885;
export const SINGLES_HALF_WIDTH = 4.115;
export const DOUBLES_HALF_WIDTH = 5.485;
export const SERVICE_LINE_Z = 6.4;
export const NET_CENTER_HEIGHT = 0.914;
export const NET_POST_HEIGHT = 1.07;
export const NET_HALF_WIDTH = 5.95;
export const BALL_RADIUS = 0.055; // Slightly enlarged from 0.0335m for crisp TV readability
export const LINE_TOLERANCE = 0.065; // Ball touching the chalk line counts as IN

export const TENNIS_GRAVITY = -11.4; // Snappy arcade-authentic gravity (m/s^2)
export const AIR_DRAG_XZ = 0.09; // Linear horizontal air drag (1/s)
export const MAGNUS_Y_SCALE = -4.2; // Positive spin (topspin) pushes ball downward

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TennisBallState {
  active: boolean;
  pos: Vec3;
  vel: Vec3;
  /** Topspin (+) or backspin slice (-) in [-1, 1] */
  spin: number;
  shotType: TennisShotType;
  isPowerShot: boolean;
  isServe: boolean;
  serveSide: 'deuce' | 'ad';
  lastHitByTeam: TennisTeamId;
  bouncesOnOpponentSide: number;
  bouncesOnOwnSide: number;
  crossedNet: boolean;
  clippedNet: boolean;
  flightTime: number;
}

export type TennisPhysicsEvent =
  | { kind: 'bounce'; pos: Vec3; speed: number; inBounds: boolean }
  | { kind: 'net-hit'; pos: Vec3 }
  | { kind: 'net-cord'; pos: Vec3 }
  | { kind: 'let'; pos: Vec3 }
  | { kind: 'serve-fault'; reason: 'out' | 'net'; pos: Vec3 }
  | { kind: 'out'; lastHitBy: TennisTeamId; pos: Vec3 }
  | { kind: 'net-fault'; lastHitBy: TennisTeamId; pos: Vec3 }
  | { kind: 'double-bounce'; winner: TennisTeamId; pos: Vec3 };

export interface ShotLaunchRequest {
  from: Vec3;
  hittingTeam: TennisTeamId;
  shotType: TennisShotType;
  /** 0..1 power */
  power: number;
  /** -1 (early) .. 0 (sweet spot) .. +1 (late) */
  timingOffset: number;
  /** -1 (left) .. +1 (right) */
  aimBias: number;
  /** -1 (slice) .. +1 (topspin) */
  spin: number;
  courtMode: TennisCourtMode;
  serveSide?: 'deuce' | 'ad';
  isPowerShot?: boolean;
  /** Optional explicit target override (useful for AI placement & tests) */
  targetOverride?: { x: number; z: number };
}

export interface ShotLaunchResult {
  vel: Vec3;
  spin: number;
  target: { x: number; z: number };
  flightTime: number;
  isPowerShot: boolean;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function getNetHeightAtX(x: number): number {
  const frac = clamp(Math.abs(x) / NET_HALF_WIDTH, 0, 1);
  return NET_CENTER_HEIGHT + (NET_POST_HEIGHT - NET_CENTER_HEIGHT) * frac * frac;
}

export function getActiveHalfWidth(courtMode: TennisCourtMode): number {
  return courtMode === 'doubles' ? DOUBLES_HALF_WIDTH : SINGLES_HALF_WIDTH;
}

/**
 * Returns the legal diagonal service box bounds for a serve hit by `servingTeam`
 * from `serveSide` ('deuce' or 'ad').
 */
export function getServiceBoxBounds(
  servingTeam: TennisTeamId,
  serveSide: 'deuce' | 'ad'
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (servingTeam === 'near') {
    // Near serves from +z into -z service boxes
    const minZ = -SERVICE_LINE_Z;
    const maxZ = 0;
    if (serveSide === 'deuce') {
      // Near deuce (+x) serves diagonally to far left (-x)
      return { minX: -SINGLES_HALF_WIDTH, maxX: 0, minZ, maxZ };
    }
    return { minX: 0, maxX: SINGLES_HALF_WIDTH, minZ, maxZ };
  }

  // Far serves from -z into +z service boxes
  const minZ = 0;
  const maxZ = SERVICE_LINE_Z;
  if (serveSide === 'deuce') {
    // Far deuce (-x) serves diagonally to near right (+x)
    return { minX: 0, maxX: SINGLES_HALF_WIDTH, minZ, maxZ };
  }
  return { minX: -SINGLES_HALF_WIDTH, maxX: 0, minZ, maxZ };
}

export function isPointInServiceBox(
  x: number,
  z: number,
  servingTeam: TennisTeamId,
  serveSide: 'deuce' | 'ad'
): boolean {
  const box = getServiceBoxBounds(servingTeam, serveSide);
  return (
    x >= box.minX - LINE_TOLERANCE &&
    x <= box.maxX + LINE_TOLERANCE &&
    z >= box.minZ - LINE_TOLERANCE &&
    z <= box.maxZ + LINE_TOLERANCE
  );
}

export function isPointInCourt(
  x: number,
  z: number,
  targetTeam: TennisTeamId,
  courtMode: TennisCourtMode
): boolean {
  const halfW = getActiveHalfWidth(courtMode) + LINE_TOLERANCE;
  if (Math.abs(x) > halfW) return false;
  if (targetTeam === 'far') {
    return z <= 0.05 && z >= -(COURT_HALF_LENGTH + LINE_TOLERANCE);
  }
  return z >= -0.05 && z <= COURT_HALF_LENGTH + LINE_TOLERANCE;
}

/**
 * Returns the standing server coordinates behind the baseline for the given side.
 */
export function getServerStartPosition(
  servingTeam: TennisTeamId,
  serveSide: 'deuce' | 'ad'
): { x: number; z: number } {
  if (servingTeam === 'near') {
    return {
      x: serveSide === 'deuce' ? 1.55 : -1.55,
      z: COURT_HALF_LENGTH + 0.42,
    };
  }
  return {
    x: serveSide === 'deuce' ? -1.55 : 1.55,
    z: -(COURT_HALF_LENGTH + 0.42),
  };
}

/**
 * Computes exact initial 3D velocity for an arcade-authentic tennis stroke accounting for
 * gravity, linear horizontal air drag, Magnus topspin/slice acceleration, and net clearance.
 */
export function computeShotLaunch(req: ShotLaunchRequest): ShotLaunchResult {
  const targetSign = req.hittingTeam === 'near' ? -1 : 1; // near shoots toward -z, far toward +z
  const halfW = getActiveHalfWidth(req.courtMode);
  const power = clamp(req.power, 0.15, 1);
  const timing = clamp(req.timingOffset, -1, 1);
  const aimBias = clamp(req.aimBias, -1, 1);

  let spin = clamp(req.spin, -1, 1);
  if (req.shotType === 'topspin') spin = Math.max(0.45, spin);
  else if (req.shotType === 'slice') spin = Math.min(-0.45, spin);
  else if (req.shotType === 'lob') spin = 0.25;
  else if (req.shotType === 'smash') spin = 0.35;
  else if (req.shotType === 'serve') spin = req.isPowerShot ? 0.3 : 0.45;

  let tx = 0;
  let tz = 0;

  if (req.targetOverride) {
    tx = req.targetOverride.x;
    tz = req.targetOverride.z;
  } else if (req.shotType === 'serve') {
    const side = req.serveSide ?? 'deuce';
    const box = getServiceBoxBounds(req.hittingTeam, side);
    const boxCenterX = (box.minX + box.maxX) * 0.5;
    const boxHalfW = (box.maxX - box.minX) * 0.5;

    // Aim bias + slight timing offset shifts serve across the service box (wide vs T)
    const steer = clamp(aimBias * 0.72 + timing * 0.45, -1.15, 1.15);
    tx = boxCenterX + steer * (boxHalfW - 0.32);

    // Depth inside service box; mistimed overpowered serve can go slightly long
    const depthBase = 4.65 + power * 1.15 + Math.abs(timing) * 0.75;
    tz = targetSign * depthBase;
  } else {
    // Timing steers cross-court / down-the-line just like Wii / Switch Sports!
    // For near player hitting from right (+x), early (-timing) pulls left (-x), late (+timing) pushes right (+x).
    const timingSteer = req.hittingTeam === 'near' ? timing : -timing;
    const combinedSteer = clamp(aimBias * 0.65 + timingSteer * 0.72, -1.18, 1.18);

    // Extremely mistimed shots can drift just past the sideline
    const outRisk = Math.max(0, Math.abs(timing) - 0.76) * 2.2;
    tx = combinedSteer * (halfW - 0.35 + outRisk);

    if (req.shotType === 'lob') {
      tz = targetSign * (9.3 + power * 2.0 + outRisk * 0.6);
    } else if (req.shotType === 'slice') {
      tz = targetSign * (5.6 + power * 4.2);
    } else if (req.shotType === 'smash') {
      tz = targetSign * (5.2 + power * 3.8);
    } else {
      // Flat / Topspin rally depth
      const longRisk = power > 0.9 && Math.abs(timing) > 0.72 ? 1.1 : 0;
      tz = targetSign * (6.8 + power * 4.1 + longRisk);
    }
  }

  const dx = tx - req.from.x;
  const dz = tz - req.from.z;
  const horizDist = Math.hypot(dx, dz);

  // Choose target horizontal speed based on shot type & power
  let nominalSpeed: number;
  let minNetClearance: number;
  if (req.shotType === 'serve') {
    nominalSpeed = req.isPowerShot ? 29.5 + power * 5.0 : 21.5 + power * 6.5;
    minNetClearance = 0.22;
  } else if (req.shotType === 'smash') {
    nominalSpeed = 25.0 + power * 6.0;
    minNetClearance = 0.26;
  } else if (req.shotType === 'lob') {
    nominalSpeed = 10.2 + power * 2.2;
    minNetClearance = 2.8;
  } else if (req.shotType === 'slice') {
    nominalSpeed = 13.0 + power * 5.2;
    minNetClearance = 0.36;
  } else if (req.shotType === 'topspin') {
    nominalSpeed = 16.5 + power * 7.8;
    minNetClearance = 0.42;
  } else {
    nominalSpeed = 16.0 + power * 7.2;
    minNetClearance = 0.32;
  }

  const ay = TENNIS_GRAVITY + spin * MAGNUS_Y_SCALE;
  let flightTime = clamp(horizDist / nominalSpeed, 0.38, 2.35);

  const solveForTime = (T: number): Vec3 => {
    const dragFactor =
      AIR_DRAG_XZ > 1e-5
        ? AIR_DRAG_XZ / (1 - Math.exp(-AIR_DRAG_XZ * T))
        : 1 / T;
    const x = dx * dragFactor;
    const z = dz * dragFactor;
    const y = (BALL_RADIUS - req.from.y - 0.5 * ay * T * T) / T;
    return { x, y, z };
  };

  let vel = solveForTime(flightTime);

  // Check height at net crossing (z = 0) and raise arc slightly if shot would unintentionally hit net
  const crossingFraction =
    Math.abs(dz) > 0.1 ? clamp(-req.from.z / dz, 0.05, 0.95) : 0.5;
  const approxNetX = req.from.x + dx * crossingFraction;
  const requiredNetY = getNetHeightAtX(approxNetX) + BALL_RADIUS + minNetClearance;

  // Compute exact net crossing time with horizontal drag: 1 - e^(-k*tNet) = crossingFraction * (1 - e^(-k*T))
  const getHeightAtNet = (T: number, v: Vec3): number => {
    const expTerm = 1 - crossingFraction * (1 - Math.exp(-AIR_DRAG_XZ * T));
    const tNet =
      AIR_DRAG_XZ > 1e-5 && expTerm > 1e-4
        ? -Math.log(expTerm) / AIR_DRAG_XZ
        : T * crossingFraction;
    return req.from.y + v.y * tNet + 0.5 * ay * tNet * tNet;
  };

  for (let iter = 0; iter < 12; iter++) {
    const yAtNet = getHeightAtNet(flightTime, vel);
    if (yAtNet >= requiredNetY) break;
    flightTime = Math.min(2.45, flightTime + 0.055);
    vel = solveForTime(flightTime);
  }

  // Lob boost ensures soaring overhead arc even from mid-court
  if (req.shotType === 'lob') {
    flightTime = Math.max(flightTime, 1.48);
    vel = solveForTime(flightTime);
  }

  return {
    vel,
    spin,
    target: { x: tx, z: tz },
    flightTime,
    isPowerShot: Boolean(req.isPowerShot || (req.shotType === 'smash' && power > 0.72)),
  };
}

export function createIdleBall(): TennisBallState {
  return {
    active: false,
    pos: { x: 0, y: 1.0, z: COURT_HALF_LENGTH },
    vel: { x: 0, y: 0, z: 0 },
    spin: 0,
    shotType: 'flat',
    isPowerShot: false,
    isServe: false,
    serveSide: 'deuce',
    lastHitByTeam: 'near',
    bouncesOnOpponentSide: 0,
    bouncesOnOwnSide: 0,
    crossedNet: false,
    clippedNet: false,
    flightTime: 0,
  };
}

/**
 * Steps the tennis ball simulation forward by `dt` seconds using sub-stepping
 * for accurate net crossings and ground bounce line calls.
 */
export function stepTennisBall(
  ball: TennisBallState,
  dt: number,
  courtMode: TennisCourtMode
): TennisPhysicsEvent[] {
  if (!ball.active || dt <= 0) return [];

  const events: TennisPhysicsEvent[] = [];
  const subSteps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / subSteps;

  for (let s = 0; s < subSteps; s++) {
    if (!ball.active) break;

    const prevX = ball.pos.x;
    const prevY = ball.pos.y;
    const prevZ = ball.pos.z;

    const ay = TENNIS_GRAVITY + ball.spin * MAGNUS_Y_SCALE;

    // Exponential horizontal drag + exact vertical kinematics per sub-step
    const dragDecay = Math.exp(-AIR_DRAG_XZ * h);
    const nextVx = ball.vel.x * dragDecay;
    const nextVz = ball.vel.z * dragDecay;
    const avgVx = (ball.vel.x + nextVx) * 0.5;
    const avgVz = (ball.vel.z + nextVz) * 0.5;

    ball.pos.x += avgVx * h;
    ball.pos.z += avgVz * h;
    ball.pos.y += ball.vel.y * h + 0.5 * ay * h * h;

    ball.vel.x = nextVx;
    ball.vel.z = nextVz;
    ball.vel.y += ay * h;
    ball.flightTime += h;

    // 1. Check Net Plane Crossing (z = 0)
    if ((prevZ > 0 && ball.pos.z <= 0) || (prevZ < 0 && ball.pos.z >= 0)) {
      const denom = prevZ - ball.pos.z;
      const frac = Math.abs(denom) > 1e-6 ? clamp(prevZ / denom, 0, 1) : 0.5;
      const crossX = prevX + (ball.pos.x - prevX) * frac;
      const crossY = prevY + (ball.pos.y - prevY) * frac;

      if (Math.abs(crossX) <= NET_HALF_WIDTH) {
        const netH = getNetHeightAtX(crossX);
        const cordZoneBottom = netH - 0.05;
        const cordZoneTop = netH + BALL_RADIUS * 0.55;

        if (crossY < cordZoneBottom) {
          // Solid net hit -> damp and drop on hitter's side
          ball.pos.x = crossX;
          ball.pos.y = Math.max(BALL_RADIUS, crossY);
          ball.pos.z = prevZ > 0 ? 0.06 : -0.06;
          ball.vel.x *= 0.25;
          ball.vel.y = Math.min(0.6, Math.abs(ball.vel.y) * 0.2);
          ball.vel.z = -ball.vel.z * 0.18;
          ball.active = false;
          events.push({ kind: 'net-hit', pos: { ...ball.pos } });
          if (ball.isServe) {
            events.push({ kind: 'serve-fault', reason: 'net', pos: { ...ball.pos } });
          } else {
            events.push({
              kind: 'net-fault',
              lastHitBy: ball.lastHitByTeam,
              pos: { ...ball.pos },
            });
          }
          break;
        } else if (crossY <= cordZoneTop) {
          // Clipped top tape -> deflect slightly upward & slow down
          ball.clippedNet = true;
          ball.crossedNet = true;
          ball.vel.z *= 0.72;
          ball.vel.x *= 0.85;
          ball.vel.y = Math.max(ball.vel.y * 0.5, 1.85);
          events.push({ kind: 'net-cord', pos: { x: crossX, y: netH, z: 0 } });
        } else {
          ball.crossedNet = true;
        }
      } else {
        ball.crossedNet = true;
      }
    }

    // 2. Check Ground Bounce (y <= BALL_RADIUS)
    if (ball.pos.y <= BALL_RADIUS && ball.vel.y < 0) {
      const denom = prevY - ball.pos.y;
      const frac = denom > 1e-6 ? clamp((prevY - BALL_RADIUS) / denom, 0, 1) : 1;
      const bounceX = prevX + (ball.pos.x - prevX) * frac;
      const bounceZ = prevZ + (ball.pos.z - prevZ) * frac;
      const impactSpeed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);

      ball.pos.x = bounceX;
      ball.pos.y = BALL_RADIUS;
      ball.pos.z = bounceZ;

      const targetTeam: TennisTeamId = ball.lastHitByTeam === 'near' ? 'far' : 'near';
      const onTargetSide =
        (targetTeam === 'far' && bounceZ < 0) || (targetTeam === 'near' && bounceZ > 0);

      // Apply spin-modulated restitution on hard court
      const restitution = clamp(0.74 + ball.spin * 0.08, 0.62, 0.84);
      const horizRetention = clamp(0.84 + ball.spin * 0.09, 0.72, 0.95);
      ball.vel.y = Math.abs(ball.vel.y) * restitution;
      ball.vel.x *= horizRetention;
      ball.vel.z *= horizRetention;
      ball.spin *= 0.45;

      if (!onTargetSide) {
        ball.bouncesOnOwnSide += 1;
        events.push({ kind: 'bounce', pos: { ...ball.pos }, speed: impactSpeed, inBounds: false });
        if (ball.isServe) {
          ball.active = false;
          events.push({ kind: 'serve-fault', reason: 'out', pos: { ...ball.pos } });
        } else if (ball.bouncesOnOwnSide >= 1) {
          ball.active = false;
          events.push({
            kind: 'net-fault',
            lastHitBy: ball.lastHitByTeam,
            pos: { ...ball.pos },
          });
        }
        break;
      }

      ball.bouncesOnOpponentSide += 1;

      if (ball.bouncesOnOpponentSide === 1) {
        if (ball.isServe) {
          const inBox = isPointInServiceBox(
            bounceX,
            bounceZ,
            ball.lastHitByTeam,
            ball.serveSide
          );
          events.push({ kind: 'bounce', pos: { ...ball.pos }, speed: impactSpeed, inBounds: inBox });
          if (!inBox) {
            ball.active = false;
            events.push({ kind: 'serve-fault', reason: 'out', pos: { ...ball.pos } });
            break;
          }
          if (ball.clippedNet) {
            ball.active = false;
            events.push({ kind: 'let', pos: { ...ball.pos } });
            break;
          }
        } else {
          const inBounds = isPointInCourt(bounceX, bounceZ, targetTeam, courtMode);
          events.push({
            kind: 'bounce',
            pos: { ...ball.pos },
            speed: impactSpeed,
            inBounds,
          });
          if (!inBounds) {
            ball.active = false;
            events.push({
              kind: 'out',
              lastHitBy: ball.lastHitByTeam,
              pos: { ...ball.pos },
            });
            break;
          }
        }
      } else {
        // Second bounce on the opponent's side -> hitter wins the point!
        events.push({ kind: 'bounce', pos: { ...ball.pos }, speed: impactSpeed, inBounds: true });
        ball.active = false;
        events.push({
          kind: 'double-bounce',
          winner: ball.lastHitByTeam,
          pos: { ...ball.pos },
        });
        break;
      }
    }

    // 3. Safety backstop boundary (ball flies far past the stadium)
    if (Math.abs(ball.pos.z) > 22 || Math.abs(ball.pos.x) > 14) {
      ball.active = false;
      if (ball.bouncesOnOpponentSide >= 1) {
        events.push({
          kind: 'double-bounce',
          winner: ball.lastHitByTeam,
          pos: { ...ball.pos },
        });
      } else if (ball.isServe) {
        events.push({ kind: 'serve-fault', reason: 'out', pos: { ...ball.pos } });
      } else {
        events.push({
          kind: 'out',
          lastHitBy: ball.lastHitByTeam,
          pos: { ...ball.pos },
        });
      }
      break;
    }
  }

  return events;
}

export interface BallInterceptPrediction {
  /** Predicted landing/first-bounce point on court */
  bouncePos: Vec3;
  /** Time until first bounce (or 0 if already bounced) */
  timeToBounce: number;
  /** Ideal strike point (after bounce at comfortable waist height, or volley point) */
  strikePos: Vec3;
  /** Time from now until ball arrives at `strikePos` */
  timeToStrike: number;
  /** Receiving team that should play this ball */
  receivingTeam: TennisTeamId;
}

/**
 * Predicts where the active ball will bounce and reach ideal strike height on the receiving side.
 * Drives both Switch Sports Auto-Run and the floor timing indicator ring!
 */
export function predictBallIntercept(
  ball: TennisBallState,
  courtMode: TennisCourtMode
): BallInterceptPrediction | null {
  if (!ball.active) return null;
  const receivingTeam: TennisTeamId = ball.lastHitByTeam === 'near' ? 'far' : 'near';

  // Shallow clone for fast forward simulation
  const sim: TennisBallState = {
    ...ball,
    pos: { ...ball.pos },
    vel: { ...ball.vel },
  };

  let bouncePos: Vec3 | null = sim.bouncesOnOpponentSide >= 1 ? { ...sim.pos } : null;
  let timeToBounce = sim.bouncesOnOpponentSide >= 1 ? 0 : -1;
  let bestStrikePos: Vec3 | null = null;
  let bestStrikeTime = 0;

  const dt = 1 / 60;
  let elapsed = 0;

  for (let i = 0; i < 180; i++) {
    if (!sim.active) break;
    elapsed += dt;
    const evs = stepTennisBall(sim, dt, courtMode);

    for (const ev of evs) {
      if (ev.kind === 'bounce' && !bouncePos) {
        bouncePos = { ...ev.pos };
        timeToBounce = elapsed;
      }
    }

    const onReceivingSide =
      (receivingTeam === 'near' && sim.pos.z > 0.5) ||
      (receivingTeam === 'far' && sim.pos.z < -0.5);

    if (onReceivingSide && sim.bouncesOnOpponentSide === 1) {
      // Ideal groundstroke strike is near the top of the bounce (~0.85m..1.25m) as ball slows down
      const idealZ = receivingTeam === 'near' ? 11.2 : -11.2;
      const distPastBaseline =
        receivingTeam === 'near' ? sim.pos.z - idealZ : idealZ - sim.pos.z;

      if (
        !bestStrikePos &&
        ((sim.vel.y <= 0.6 && sim.pos.y <= 1.35) || distPastBaseline >= 0.4)
      ) {
        bestStrikePos = { ...sim.pos };
        bestStrikeTime = elapsed;
        break;
      }
    }
  }

  const finalBounce = bouncePos ?? { ...sim.pos };
  const finalStrike = bestStrikePos ?? {
    x: clamp(finalBounce.x, -DOUBLES_HALF_WIDTH - 1.2, DOUBLES_HALF_WIDTH + 1.2),
    y: 0.95,
    z:
      receivingTeam === 'near'
        ? clamp(finalBounce.z + 1.8, 2.2, COURT_HALF_LENGTH + 1.4)
        : clamp(finalBounce.z - 1.8, -(COURT_HALF_LENGTH + 1.4), -2.2),
  };

  return {
    bouncePos: finalBounce,
    timeToBounce: Math.max(0, timeToBounce),
    strikePos: finalStrike,
    timeToStrike: bestStrikePos ? bestStrikeTime : Math.max(0.15, timeToBounce + 0.25),
    receivingTeam,
  };
}

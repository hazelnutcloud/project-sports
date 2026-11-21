import RAPIER from '@dimforge/rapier3d-compat';
import type { ThrowParams } from '../types/game';

export const LANE_WIDTH = 1.06;
export const GUTTER_WIDTH = 0.24;
export const LANE_PITCH = 1.80;
export const LANE_COUNT = 5;

export const FOUL_LINE_Z = 0;
export const APPROACH_START_Z = 3.6;
export const HEAD_PIN_Z = -18.29;
export const DECK_END_Z = -19.55;
export const PIT_BACK_Z = -21.05;

export const BALL_RADIUS = 0.109;
export const PIN_HEIGHT = 0.381;
export const PIN_ROW_DZ = 0.264;
export const PIN_COL_DX = 0.3048;

export const PIN_REST_Y = 0.145;
export const SWEEPER_PARK_Y = 1.08;
export const SWEEPER_PARK_Z = -18.92;
export const SWEEPER_DOWN_Y = 0.08;
export const SWEEPER_GUARD_Z = HEAD_PIN_Z + 0.44;
export const SWEEPER_BACK_Z = DECK_END_Z - 0.16;

export const SETTER_ENGAGED_Y = 0.39;
export const SETTER_LIFT_DELTA = 0.46;
export const SETTER_LIFTED_Y = SETTER_ENGAGED_Y + SETTER_LIFT_DELTA;
export const SETTER_PARK_Y = 1.14;
export const SETTER_PARK_Z_OFFSET = -0.58;

// Rapier3D 16-bit membership + 16-bit filter collision groups
const GROUP_STATIC = 0x0001;
const GROUP_BALL = 0x0002;
const GROUP_PIN = 0x0004;
const GROUP_SWEEPER = 0x0008;

function makeCollisionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

const COLLISION_STATIC = makeCollisionGroups(GROUP_STATIC, GROUP_BALL | GROUP_PIN);
const COLLISION_BALL = makeCollisionGroups(GROUP_BALL, GROUP_STATIC | GROUP_PIN);
const COLLISION_PIN = makeCollisionGroups(
  GROUP_PIN,
  GROUP_STATIC | GROUP_BALL | GROUP_PIN | GROUP_SWEEPER
);
const COLLISION_SWEEPER = makeCollisionGroups(GROUP_SWEEPER, GROUP_PIN);

export function getLaneCenterX(laneIndex: number): number {
  return (laneIndex - 2) * LANE_PITCH;
}

/**
 * Standard 10-pin coordinates relative to lane center (x, z).
 * Index 0 = Pin 1 (headpin), Index 9 = Pin 10 (back right).
 */
export const PIN_LOCAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, HEAD_PIN_Z], // 1
  [-PIN_COL_DX * 0.5, HEAD_PIN_Z - PIN_ROW_DZ], // 2
  [PIN_COL_DX * 0.5, HEAD_PIN_Z - PIN_ROW_DZ], // 3
  [-PIN_COL_DX, HEAD_PIN_Z - PIN_ROW_DZ * 2], // 4
  [0, HEAD_PIN_Z - PIN_ROW_DZ * 2], // 5
  [PIN_COL_DX, HEAD_PIN_Z - PIN_ROW_DZ * 2], // 6
  [-PIN_COL_DX * 1.5, HEAD_PIN_Z - PIN_ROW_DZ * 3], // 7
  [-PIN_COL_DX * 0.5, HEAD_PIN_Z - PIN_ROW_DZ * 3], // 8
  [PIN_COL_DX * 0.5, HEAD_PIN_Z - PIN_ROW_DZ * 3], // 9
  [PIN_COL_DX * 1.5, HEAD_PIN_Z - PIN_ROW_DZ * 3], // 10
];

export interface BodyPose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export type ClearingMode = 'preserve-standing' | 'full-reset';

export type ClearingPhase =
  | 'idle'
  | 'guard-drop'
  | 'lift-standing'
  | 'sweep-back'
  | 'sweep-retract'
  | 'lower-pins'
  | 'setter-retract';

export interface LaneClearingVisualState {
  active: boolean;
  mode: ClearingMode;
  phase: ClearingPhase;
  sweeperY: number;
  sweeperZ: number;
  setterVisible: boolean;
  setterY: number;
  setterZOffset: number;
  grippedPinIds: number[];
}

export interface LanePhysicsState {
  laneIndex: number;
  ballActive: boolean;
  inGutter: boolean;
  inPit: boolean;
  ballSpeed: number;
  ballSpin: number;
  ballPose: BodyPose;
  pinPoses: Array<BodyPose | null>;
  clearing: LaneClearingVisualState;
}

interface InternalClearingState {
  active: boolean;
  mode: ClearingMode;
  phase: ClearingPhase;
  phaseElapsed: number;
  dropZ: number;
  preservedPinIds: number[];
  sweptPinIds: number[];
  pinsToSet: number[];
  liftedStartPoses: Map<number, BodyPose>;
  freshRackSpawned: boolean;
  sweeperBody: RAPIER.RigidBody | null;
  sweeperY: number;
  sweeperZ: number;
  setterVisible: boolean;
  setterY: number;
  setterZOffset: number;
  grippedPinIds: number[];
}

interface InternalLane {
  laneIndex: number;
  centerX: number;
  ballBody: RAPIER.RigidBody | null;
  ballColliderHandle: number | null;
  ballSpin: number;
  initialSpin: number;
  initialSideSlip: number;
  inGutter: boolean;
  inPit: boolean;
  ballEnteredPitFully: boolean;
  throwElapsed: number;
  pinHitTime: number | null;
  pinBodies: Array<RAPIER.RigidBody | null>;
  pinColliderHandles: Set<number>;
  clearing: InternalClearingState;
}

export interface PhysicsCollisionEvent {
  laneIndex: number;
  kind: 'pin-impact' | 'gutter-enter';
  intensity: number;
  position: [number, number, number];
  duringClearing?: boolean;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function nlerpToIdentity(
  q: { x: number; y: number; z: number; w: number },
  t: number
): { x: number; y: number; z: number; w: number } {
  const sign = q.w < 0 ? -1 : 1;
  const inv = 1 - t;
  const x = q.x * sign * inv;
  const y = q.y * sign * inv;
  const z = q.z * sign * inv;
  const w = q.w * sign * inv + t;
  const len = Math.hypot(x, y, z, w) || 1;
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}

function createIdleClearingState(): InternalClearingState {
  return {
    active: false,
    mode: 'full-reset',
    phase: 'idle',
    phaseElapsed: 0,
    dropZ: SWEEPER_GUARD_Z,
    preservedPinIds: [],
    sweptPinIds: [],
    pinsToSet: [],
    liftedStartPoses: new Map(),
    freshRackSpawned: false,
    sweeperBody: null,
    sweeperY: SWEEPER_PARK_Y,
    sweeperZ: SWEEPER_PARK_Z,
    setterVisible: false,
    setterY: SETTER_PARK_Y,
    setterZOffset: SETTER_PARK_Z_OFFSET,
    grippedPinIds: [],
  };
}

let rapierInitPromise: Promise<void> | null = null;
export function ensureRapierReady(): Promise<void> {
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init();
  }
  return rapierInitPromise;
}

const GRAVITY = 9.81;

/**
 * Computes the spatially-varying kinetic friction coefficient mu(x, z) of our house-shot maple lane:
 * - Front oil zone (0 .. ~7.6m, past the 4.57m arrows): very low friction so the ball skids
 *   cleanly along the player's aim line while preserving its stored side-spin.
 * - Mid-lane oil-to-dry transition (~7.6m .. 15.2m): friction ramps up smoothly (slightly earlier
 *   on the outer boards like a real house shot) so the ball begins arcing across the lane.
 * - Dry maple backend (~15.2m .. 18.29m): high dry friction bites into remaining side-spin,
 *   driving a pronounced sweeping curve into the pocket.
 */
export function getLaneFriction(distDownLane: number, localX: number): number {
  const edgeNorm = clamp01((Math.abs(localX) - 0.14) / 0.34);
  const oilStart = 7.6 - edgeNorm * 1.4;
  const dryFull = 15.2 - edgeNorm * 1.4;
  const muOil = 0.016 + edgeNorm * 0.014;
  const muDry = 0.275;
  const dryBlend = smoothstep((distDownLane - oilStart) / (dryFull - oilStart));
  return muOil + (muDry - muOil) * dryBlend;
}

/**
 * Multi-lane Rapier3D physics engine with realistic bowling dynamics:
 * - Continuous Collision Detection (CCD) on fast bowling balls
 * - Compound tapered pin colliders with low center of mass
 * - Authentic Skid -> Hook -> Roll oil-to-dry contact friction & torque coupling
 * - Energy-absorbing pit curtain & one-way pit trap preventing back-wall rebounds
 * - Physics-driven pinsetter & kinematic sweeper clearing cycle
 */
export class BowlingPhysicsWorld {
  private world: RAPIER.World;
  private eventQueue: RAPIER.EventQueue;
  private lanes = new Map<number, InternalLane>();
  private fixedDt = 1 / 120;
  private accumulator = 0;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.dt = this.fixedDt;
    this.eventQueue = new RAPIER.EventQueue(true);

    for (let i = 0; i < LANE_COUNT; i++) {
      this.buildStaticLane(i);
      this.lanes.set(i, {
        laneIndex: i,
        centerX: getLaneCenterX(i),
        ballBody: null,
        ballColliderHandle: null,
        ballSpin: 0,
        initialSpin: 0,
        initialSideSlip: 0,
        inGutter: false,
        inPit: false,
        ballEnteredPitFully: false,
        throwElapsed: 0,
        pinHitTime: null,
        pinBodies: Array(10).fill(null),
        pinColliderHandles: new Set(),
        clearing: createIdleClearingState(),
      });
      this.resetPins(i, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
  }

  public static async create(): Promise<BowlingPhysicsWorld> {
    await ensureRapierReady();
    return new BowlingPhysicsWorld();
  }

  public resetPins(laneIndex: number, standingPinIds: number[]): void {
    const lane = this.lanes.get(laneIndex);
    if (!lane) return;

    this.cleanupClearingResources(lane);

    for (let i = 0; i < 10; i++) {
      this.removePinBody(lane, i);
    }
    lane.pinColliderHandles.clear();

    const standingSet = new Set(standingPinIds);
    for (let i = 0; i < 10; i++) {
      if (!standingSet.has(i)) continue;
      this.spawnDynamicPin(lane, i);
    }
  }

  public startClearing(
    laneIndex: number,
    mode: ClearingMode,
    standingPinIds: number[]
  ): void {
    const lane = this.lanes.get(laneIndex);
    if (!lane) return;

    this.cleanupClearingResources(lane);

    // If the ball somehow stopped on the deck (not in the pit), clear it before sweeping
    if (lane.ballBody && !lane.inPit) {
      this.clearBall(laneIndex);
    }

    const validStanding =
      mode === 'preserve-standing'
        ? standingPinIds.filter((id) => id >= 0 && id < 10 && lane.pinBodies[id] !== null)
        : [];
    const preserveSet = new Set(validStanding);

    const sweptPinIds: number[] = [];
    let maxSweptZ = HEAD_PIN_Z;

    for (let i = 0; i < 10; i++) {
      const pin = lane.pinBodies[i];
      if (!pin) continue;
      if (preserveSet.has(i)) continue;
      sweptPinIds.push(i);
      const pos = pin.translation();
      // Only push dropZ forward for pins still near the pin deck
      if (pos.y > -0.25 && pos.z > DECK_END_Z - 0.15 && pos.z < HEAD_PIN_Z + 2.5) {
        if (pos.z > maxSweptZ) {
          maxSweptZ = pos.z;
        }
      }
    }

    const dropZ = Math.min(
      HEAD_PIN_Z + 2.2,
      Math.max(SWEEPER_GUARD_Z, maxSweptZ + 0.24)
    );

    const effectiveMode: ClearingMode =
      mode === 'preserve-standing' && validStanding.length > 0
        ? 'preserve-standing'
        : 'full-reset';

    lane.clearing = {
      active: true,
      mode: effectiveMode,
      phase: 'guard-drop',
      phaseElapsed: 0,
      dropZ,
      preservedPinIds: effectiveMode === 'preserve-standing' ? validStanding : [],
      sweptPinIds,
      pinsToSet:
        effectiveMode === 'preserve-standing'
          ? validStanding
          : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      liftedStartPoses: new Map(),
      freshRackSpawned: false,
      sweeperBody: null,
      sweeperY: SWEEPER_PARK_Y,
      sweeperZ: SWEEPER_PARK_Z,
      setterVisible: effectiveMode === 'preserve-standing',
      setterY: SETTER_PARK_Y,
      setterZOffset: SETTER_PARK_Z_OFFSET,
      grippedPinIds: [],
    };
  }

  public isClearing(laneIndex: number): boolean {
    const lane = this.lanes.get(laneIndex);
    return lane ? lane.clearing.active : false;
  }

  public cancelClearing(laneIndex: number): void {
    const lane = this.lanes.get(laneIndex);
    if (!lane) return;
    this.cleanupClearingResources(lane);
  }

  public cancelAllClearing(): void {
    for (const lane of this.lanes.values()) {
      this.cleanupClearingResources(lane);
    }
  }

  public clearBall(laneIndex: number): void {
    const lane = this.lanes.get(laneIndex);
    if (!lane) return;
    if (lane.ballBody) {
      this.world.removeRigidBody(lane.ballBody);
      lane.ballBody = null;
      lane.ballColliderHandle = null;
    }
    lane.inGutter = false;
    lane.inPit = false;
    lane.ballEnteredPitFully = false;
    lane.ballSpin = 0;
    lane.initialSpin = 0;
    lane.initialSideSlip = 0;
    lane.throwElapsed = 0;
    lane.pinHitTime = null;
  }

  public launchBall(laneIndex: number, params: ThrowParams): void {
    const lane = this.lanes.get(laneIndex);
    if (!lane) return;
    this.clearBall(laneIndex);

    const startX = lane.centerX + Math.max(-0.44, Math.min(0.44, params.xOffset));
    const startY = BALL_RADIUS + 0.035;
    const startZ = FOUL_LINE_Z - 0.12;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(startX, startY, startZ)
      .setCcdEnabled(true)
      .setLinearDamping(0.01)
      .setAngularDamping(0.02);

    const ball = this.world.createRigidBody(bodyDesc);
    // Use zero native collider friction with Min combine rule on the ball so Rapier does NOT
    // apply uniform dry friction at the foul line (which would kick the ball sideways immediately
    // on landing). Instead, applyLaneForces computes spatially-varying oil-to-dry contact friction
    // and coupled rolling torque every substep while keeping pin-on-lane friction untouched.
    const colDesc = RAPIER.ColliderDesc.ball(BALL_RADIUS)
      .setMass(6.8)
      .setFriction(0.0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0.42)
      .setCollisionGroups(COLLISION_BALL)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const col = this.world.createCollider(colDesc, ball);

    const sinA = Math.sin(params.aimAngle);
    const cosA = Math.cos(params.aimAngle);
    const vx = sinA * params.speed;
    const vz = -cosA * params.speed;
    const vy = Math.max(0, Math.min(1.5, params.loft));

    ball.setLinvel({ x: vx, y: vy, z: vz }, true);

    // Frame-aligned release spin:
    // - Forward roll is intentionally below pure roll (skid phase in the front oil)
    // - Side-roll perpendicular to travel direction stores hook rev energy that bites on dry maple
    // - Zero-spin throws at any aimAngle have strictly collinear slip -> dead-straight travel
    const clampedSpin = Math.max(-1, Math.min(1, params.spin));
    const spinAbs = Math.abs(clampedSpin);
    const spinShaped = Math.sign(clampedSpin) * Math.pow(spinAbs, 0.9);
    const speedScale = 0.55 + 0.45 * (params.speed / 10.5);
    const omegaFwd = (params.speed / BALL_RADIUS) * (0.72 - 0.14 * spinAbs);
    const omegaSide = spinShaped * 56.0 * speedScale;

    ball.setAngvel(
      {
        x: -omegaFwd * cosA + omegaSide * sinA,
        y: clampedSpin * 5.0,
        z: -omegaFwd * sinA - omegaSide * cosA,
      },
      true
    );

    lane.ballBody = ball;
    lane.ballColliderHandle = col.handle;
    lane.ballSpin = clampedSpin;
    lane.initialSpin = clampedSpin;
    lane.initialSideSlip = Math.abs(omegaSide * BALL_RADIUS);
    lane.inGutter = false;
    lane.inPit = false;
    lane.ballEnteredPitFully = false;
    lane.throwElapsed = 0;
    lane.pinHitTime = null;
  }

  public step(deltaSec: number): PhysicsCollisionEvent[] {
    const clampedDelta = Math.min(deltaSec, 0.08);
    this.accumulator += clampedDelta;
    const events: PhysicsCollisionEvent[] = [];

    while (this.accumulator >= this.fixedDt) {
      this.applyLaneForces(this.fixedDt, events);
      this.stepAllClearing(this.fixedDt);
      this.world.step(this.eventQueue);
      this.enforceSweepContainment();
      this.enforcePitContainment();
      this.drainCollisions(events);
      this.accumulator -= this.fixedDt;
    }

    return events;
  }

  public isRollSettled(laneIndex: number): boolean {
    const lane = this.lanes.get(laneIndex);
    if (!lane || !lane.ballBody) return true;

    // Max safety timeout
    if (lane.throwElapsed > 7.0) return true;
    if (lane.inPit && lane.throwElapsed > 4.2) return true;
    if (lane.pinHitTime !== null && lane.throwElapsed - lane.pinHitTime > 2.6) {
      return true;
    }

    const pos = lane.ballBody.translation();
    const vel = lane.ballBody.linvel();
    const ballSlow = Math.hypot(vel.x, vel.y, vel.z) < 0.25;
    const ballDone = lane.inPit || pos.z < DECK_END_Z - 0.1 || (lane.throwElapsed > 1.2 && ballSlow);
    if (!ballDone) return false;

    // Wait briefly after ball hits pit/pins so pins finish toppling
    if (lane.pinHitTime !== null && lane.throwElapsed - lane.pinHitTime < 0.85) {
      return false;
    }

    // Check if all remaining pins are nearly at rest
    for (const pin of lane.pinBodies) {
      if (!pin) continue;
      const pv = pin.linvel();
      const pw = pin.angvel();
      const speed = Math.hypot(pv.x, pv.y, pv.z);
      const angSpeed = Math.hypot(pw.x, pw.y, pw.z);
      if (speed > 0.18 || angSpeed > 0.55) {
        return false;
      }
    }

    return true;
  }

  public evaluateStandingPins(laneIndex: number): number[] {
    const lane = this.lanes.get(laneIndex);
    if (!lane) return [];

    const standing: number[] = [];
    for (let i = 0; i < 10; i++) {
      const pin = lane.pinBodies[i];
      if (!pin) continue;

      const pos = pin.translation();
      if (pos.y < 0.04 || pos.z < DECK_END_Z - 0.05) continue;

      // Compute pin local +Y axis dot world +Y (1 = upright, cos(28°) ≈ 0.883)
      const q = pin.rotation();
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      if (upY > 0.86) {
        standing.push(i);
      }
    }
    return standing;
  }

  public getLaneState(laneIndex: number): LanePhysicsState {
    const lane = this.lanes.get(laneIndex)!;
    let ballPose: BodyPose = {
      x: lane.centerX,
      y: BALL_RADIUS,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
    };
    let ballSpeed = 0;

    if (lane.ballBody) {
      const p = lane.ballBody.translation();
      const q = lane.ballBody.rotation();
      const v = lane.ballBody.linvel();
      ballPose = { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
      ballSpeed = Math.hypot(v.x, v.y, v.z);
    }

    const pinPoses = lane.pinBodies.map((pin) => {
      if (!pin) return null;
      const p = pin.translation();
      const q = pin.rotation();
      return { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
    });

    const c = lane.clearing;
    return {
      laneIndex,
      ballActive: lane.ballBody !== null,
      inGutter: lane.inGutter,
      inPit: lane.inPit,
      ballSpeed,
      ballSpin: lane.ballSpin,
      ballPose,
      pinPoses,
      clearing: {
        active: c.active,
        mode: c.mode,
        phase: c.phase,
        sweeperY: c.sweeperY,
        sweeperZ: c.sweeperZ,
        setterVisible: c.setterVisible,
        setterY: c.setterY,
        setterZOffset: c.setterZOffset,
        grippedPinIds: c.grippedPinIds,
      },
    };
  }

  public dispose(): void {
    this.eventQueue.free();
    this.world.free();
  }

  private spawnDynamicPin(lane: InternalLane, pinIndex: number): void {
    this.removePinBody(lane, pinIndex);
    const [ox, oz] = PIN_LOCAL_OFFSETS[pinIndex];
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(lane.centerX + ox, PIN_REST_Y, oz)
      .setLinearDamping(0.12)
      .setAngularDamping(0.14)
      .setCanSleep(true);
    const body = this.world.createRigidBody(bodyDesc);

    // Authentic 3-part tapered bowling pin collider:
    // 1. Narrow base foot (r=0.029m) so pins stand cleanly yet topple authentically on glancing hits
    const baseFoot = RAPIER.ColliderDesc.cylinder(0.035, 0.029)
      .setTranslation(0, -0.11, 0)
      .setMass(0.42)
      .setFriction(0.32)
      .setRestitution(0.45)
      .setCollisionGroups(COLLISION_PIN)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    // 2. Wide mid-belly (r=0.058m) aligned with ball center height for crisp pin-to-pin scatter
    const midBelly = RAPIER.ColliderDesc.cylinder(0.068, 0.058)
      .setTranslation(0, -0.01, 0)
      .setMass(0.76)
      .setFriction(0.26)
      .setRestitution(0.62)
      .setCollisionGroups(COLLISION_PIN)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    // 3. Slender upper neck & head
    const upperNeck = RAPIER.ColliderDesc.cylinder(0.085, 0.029)
      .setTranslation(0, 0.142, 0)
      .setMass(0.35)
      .setFriction(0.24)
      .setRestitution(0.55)
      .setCollisionGroups(COLLISION_PIN)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    const c0 = this.world.createCollider(baseFoot, body);
    const c1 = this.world.createCollider(midBelly, body);
    const c2 = this.world.createCollider(upperNeck, body);

    lane.pinBodies[pinIndex] = body;
    lane.pinColliderHandles.add(c0.handle);
    lane.pinColliderHandles.add(c1.handle);
    lane.pinColliderHandles.add(c2.handle);
  }

  private spawnKinematicPin(
    lane: InternalLane,
    pinIndex: number,
    pose: BodyPose
  ): RAPIER.RigidBody {
    this.removePinBody(lane, pinIndex);
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(pose.x, pose.y, pose.z)
      .setRotation({ x: pose.qx, y: pose.qy, z: pose.qz, w: pose.qw });
    const body = this.world.createRigidBody(bodyDesc);
    lane.pinBodies[pinIndex] = body;
    return body;
  }

  private removePinBody(lane: InternalLane, pinIndex: number): void {
    const body = lane.pinBodies[pinIndex];
    if (!body) return;
    const count = body.numColliders();
    for (let k = 0; k < count; k++) {
      const col = body.collider(k);
      lane.pinColliderHandles.delete(col.handle);
    }
    this.world.removeRigidBody(body);
    lane.pinBodies[pinIndex] = null;
  }

  private removeSweeperBody(lane: InternalLane): void {
    if (lane.clearing.sweeperBody) {
      this.world.removeRigidBody(lane.clearing.sweeperBody);
      lane.clearing.sweeperBody = null;
    }
  }

  private cleanupClearingResources(lane: InternalLane): void {
    this.removeSweeperBody(lane);
    lane.clearing = createIdleClearingState();
  }

  private createSweeperBody(lane: InternalLane, z: number): void {
    this.removeSweeperBody(lane);
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      lane.centerX,
      0.12,
      z
    );
    const body = this.world.createRigidBody(bodyDesc);
    // Spans full maple lane + both gutters and extends down into gutter trough & up to 0.36m
    // (clear of lifted standing pins at y >= 0.46m, tall enough so fallen pins never hop over)
    const colDesc = RAPIER.ColliderDesc.cuboid(
      LANE_WIDTH * 0.5 + GUTTER_WIDTH,
      0.24,
      0.045
    )
      .setFriction(0.12)
      .setRestitution(0.12)
      .setCollisionGroups(COLLISION_SWEEPER);
    this.world.createCollider(colDesc, body);
    lane.clearing.sweeperBody = body;
  }

  private stepAllClearing(dt: number): void {
    for (const lane of this.lanes.values()) {
      if (!lane.clearing.active) continue;
      this.stepLaneClearing(lane, dt);
    }
  }

  private stepLaneClearing(lane: InternalLane, dt: number): void {
    const c = lane.clearing;
    c.phaseElapsed += dt;

    if (c.phase === 'guard-drop') {
      const dur = c.mode === 'preserve-standing' ? 0.32 : 0.24;
      const t = clamp01(c.phaseElapsed / dur);

      // Sweeper slides forward while high, then drops straight down in front of pins
      if (t < 0.35) {
        const k = smoothstep(t / 0.35);
        c.sweeperZ = lerp(SWEEPER_PARK_Z, c.dropZ, k);
        c.sweeperY = lerp(SWEEPER_PARK_Y, 0.96, k);
      } else {
        const k = smoothstep((t - 0.35) / 0.65);
        c.sweeperZ = c.dropZ;
        c.sweeperY = lerp(0.96, SWEEPER_DOWN_Y, k);
      }

      if (c.mode === 'preserve-standing') {
        c.setterVisible = true;
        if (t < 0.42) {
          const k = smoothstep(t / 0.42);
          c.setterY = lerp(SETTER_PARK_Y, 0.92, k);
          c.setterZOffset = lerp(SETTER_PARK_Z_OFFSET, 0, k);
        } else {
          const k = smoothstep((t - 0.42) / 0.58);
          c.setterY = lerp(0.92, SETTER_ENGAGED_Y, k);
          c.setterZOffset = 0;
        }
      }

      if (t >= 1) {
        c.phaseElapsed = 0;
        if (c.mode === 'preserve-standing') {
          this.beginLiftStandingPhase(lane);
        } else {
          this.beginSweepBackPhase(lane);
        }
      }
      return;
    }

    if (c.phase === 'lift-standing') {
      const dur = 0.34;
      const t = clamp01(c.phaseElapsed / dur);
      const k = smoothstep(t);

      c.sweeperY = SWEEPER_DOWN_Y;
      c.sweeperZ = c.dropZ;
      c.setterVisible = true;
      c.setterY = lerp(SETTER_ENGAGED_Y, SETTER_LIFTED_Y, k);
      c.setterZOffset = 0;

      for (const pinId of c.preservedPinIds) {
        const body = lane.pinBodies[pinId];
        const start = c.liftedStartPoses.get(pinId);
        if (!body || !start) continue;
        const [ox, oz] = PIN_LOCAL_OFFSETS[pinId];
        const targetX = lane.centerX + ox;
        const targetZ = oz;
        const nextX = lerp(start.x, targetX, k);
        const nextY = lerp(start.y, PIN_REST_Y, k) + SETTER_LIFT_DELTA * k;
        const nextZ = lerp(start.z, targetZ, k);
        const nextQ = nlerpToIdentity(
          { x: start.qx, y: start.qy, z: start.qz, w: start.qw },
          k
        );
        body.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ });
        body.setNextKinematicRotation(nextQ);
      }

      if (t >= 1) {
        c.phaseElapsed = 0;
        this.beginSweepBackPhase(lane);
      }
      return;
    }

    if (c.phase === 'sweep-back') {
      const dur = 0.56;
      const t = clamp01(c.phaseElapsed / dur);
      const k = smoothstep(t);

      c.sweeperY = SWEEPER_DOWN_Y;
      c.sweeperZ = lerp(c.dropZ, SWEEPER_BACK_Z, k);

      if (c.sweeperBody) {
        c.sweeperBody.setNextKinematicTranslation({
          x: lane.centerX,
          y: 0.12,
          z: c.sweeperZ,
        });
      }

      // Hold preserved standing pins steady up in the pinsetter grippers
      if (c.mode === 'preserve-standing') {
        c.setterVisible = true;
        c.setterY = SETTER_LIFTED_Y;
        c.setterZOffset = 0;
        this.holdKinematicPinsAtSetter(lane, c.preservedPinIds, SETTER_LIFTED_Y, 0);
      }

      if (t >= 1) {
        this.removeSweeperBody(lane);
        c.phase = 'sweep-retract';
        c.phaseElapsed = 0;
      }
      return;
    }

    if (c.phase === 'sweep-retract') {
      const dur = c.mode === 'preserve-standing' ? 0.26 : 0.30;
      const t = clamp01(c.phaseElapsed / dur);
      const k = smoothstep(t);

      // Sweeper returns forward LOW safely underneath any lifted standing pins
      c.sweeperY = SWEEPER_DOWN_Y;
      c.sweeperZ = lerp(SWEEPER_BACK_Z, SWEEPER_GUARD_Z, k);

      if (c.mode === 'preserve-standing') {
        c.setterVisible = true;
        c.setterY = SETTER_LIFTED_Y;
        c.setterZOffset = 0;
        this.holdKinematicPinsAtSetter(lane, c.preservedPinIds, SETTER_LIFTED_Y, 0);
      } else {
        // In full-reset mode, once swept pins have dropped into the pit, glide the fresh 10-pin rack out of the hood
        if (t >= 0.4) {
          const rackT = smoothstep((t - 0.4) / 0.6);
          c.setterVisible = true;
          c.setterY = lerp(1.02, SETTER_LIFTED_Y, rackT);
          c.setterZOffset = lerp(-0.45, 0, rackT);
          if (!c.freshRackSpawned) {
            c.freshRackSpawned = true;
            this.clearSweptPinsAndBall(lane);
            c.grippedPinIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
            for (const pinId of c.pinsToSet) {
              const [ox, oz] = PIN_LOCAL_OFFSETS[pinId];
              this.spawnKinematicPin(lane, pinId, {
                x: lane.centerX + ox,
                y: PIN_REST_Y + (c.setterY - SETTER_ENGAGED_Y),
                z: oz + c.setterZOffset,
                qx: 0,
                qy: 0,
                qz: 0,
                qw: 1,
              });
            }
          } else {
            this.holdKinematicPinsAtSetter(lane, c.pinsToSet, c.setterY, c.setterZOffset);
          }
        }
      }

      if (t >= 1) {
        if (c.mode === 'preserve-standing') {
          this.clearSweptPinsAndBall(lane);
        }
        c.phase = 'lower-pins';
        c.phaseElapsed = 0;
      }
      return;
    }

    if (c.phase === 'lower-pins') {
      const dur = c.mode === 'preserve-standing' ? 0.26 : 0.34;
      const t = clamp01(c.phaseElapsed / dur);
      const k = smoothstep(t);

      c.sweeperY = SWEEPER_DOWN_Y;
      c.sweeperZ = SWEEPER_GUARD_Z;
      c.setterVisible = true;
      c.setterY = lerp(SETTER_LIFTED_Y, SETTER_ENGAGED_Y, k);
      c.setterZOffset = 0;

      this.holdKinematicPinsAtSetter(lane, c.pinsToSet, c.setterY, 0);

      if (t >= 1) {
        // Release all placed pins as settled upright dynamic bodies at exact rack spots
        for (const pinId of c.pinsToSet) {
          this.spawnDynamicPin(lane, pinId);
        }
        c.grippedPinIds = [];
        c.phase = 'setter-retract';
        c.phaseElapsed = 0;
      }
      return;
    }

    if (c.phase === 'setter-retract') {
      const dur = 0.26;
      const t = clamp01(c.phaseElapsed / dur);

      // Pinsetter lifts straight off pins then tucks back inside the dark pit bay
      c.setterVisible = true;
      if (t < 0.52) {
        const k = smoothstep(t / 0.52);
        c.setterY = lerp(SETTER_ENGAGED_Y, 0.94, k);
        c.setterZOffset = 0;
      } else {
        const k = smoothstep((t - 0.52) / 0.48);
        c.setterY = lerp(0.94, SETTER_PARK_Y, k);
        c.setterZOffset = lerp(0, SETTER_PARK_Z_OFFSET, k);
      }

      // Sweeper lifts straight up in front of Pin 1 then tucks neatly under the lightbox
      if (t < 0.62) {
        const k = smoothstep(t / 0.62);
        c.sweeperY = lerp(SWEEPER_DOWN_Y, SWEEPER_PARK_Y, k);
        c.sweeperZ = SWEEPER_GUARD_Z;
      } else {
        const k = smoothstep((t - 0.62) / 0.38);
        c.sweeperY = SWEEPER_PARK_Y;
        c.sweeperZ = lerp(SWEEPER_GUARD_Z, SWEEPER_PARK_Z, k);
      }

      if (t >= 1) {
        this.cleanupClearingResources(lane);
      }
    }
  }

  private beginLiftStandingPhase(lane: InternalLane): void {
    const c = lane.clearing;
    c.phase = 'lift-standing';
    c.phaseElapsed = 0;
    c.grippedPinIds = [...c.preservedPinIds];
    c.liftedStartPoses.clear();

    for (const pinId of c.preservedPinIds) {
      const existing = lane.pinBodies[pinId];
      if (!existing) continue;
      const p = existing.translation();
      const q = existing.rotation();
      const startPose: BodyPose = {
        x: p.x,
        y: p.y,
        z: p.z,
        qx: q.x,
        qy: q.y,
        qz: q.z,
        qw: q.w,
      };
      c.liftedStartPoses.set(pinId, startPose);
      this.spawnKinematicPin(lane, pinId, startPose);
    }
  }

  private beginSweepBackPhase(lane: InternalLane): void {
    const c = lane.clearing;
    c.phase = 'sweep-back';
    c.phaseElapsed = 0;
    this.createSweeperBody(lane, c.dropZ);

    // Wake every swept dynamic pin so sleeping fallen pins react immediately on contact
    for (const pinId of c.sweptPinIds) {
      const pin = lane.pinBodies[pinId];
      if (pin) {
        pin.wakeUp();
      }
    }
  }

  private holdKinematicPinsAtSetter(
    lane: InternalLane,
    pinIds: number[],
    setterY: number,
    setterZOffset: number
  ): void {
    const pinY = PIN_REST_Y + (setterY - SETTER_ENGAGED_Y);
    for (const pinId of pinIds) {
      const body = lane.pinBodies[pinId];
      if (!body) continue;
      const [ox, oz] = PIN_LOCAL_OFFSETS[pinId];
      body.setNextKinematicTranslation({
        x: lane.centerX + ox,
        y: pinY,
        z: oz + setterZOffset,
      });
      body.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    }
  }

  private clearSweptPinsAndBall(lane: InternalLane): void {
    for (const pinId of lane.clearing.sweptPinIds) {
      this.removePinBody(lane, pinId);
    }
    if (lane.ballBody) {
      this.clearBall(lane.laneIndex);
    }
  }

  private enforceSweepContainment(): void {
    for (const lane of this.lanes.values()) {
      const c = lane.clearing;
      if (!c.active || c.phase !== 'sweep-back') continue;

      for (const pinId of c.sweptPinIds) {
        const pin = lane.pinBodies[pinId];
        if (!pin) continue;
        const pos = pin.translation();
        // Keep swept pins cleanly ahead of the sweeping face so none squeeze around a corner
        if (pos.y > -0.25 && pos.z > DECK_END_Z - 0.2 && pos.z > c.sweeperZ - 0.055) {
          const vel = pin.linvel();
          pin.setTranslation(
            { x: pos.x, y: pos.y, z: c.sweeperZ - 0.06 },
            true
          );
          pin.setLinvel(
            { x: vel.x * 0.85, y: Math.min(vel.y, 0.4), z: Math.min(vel.z, -2.8) },
            true
          );
        }
      }
    }
  }

  private enforcePitContainment(): void {
    for (const lane of this.lanes.values()) {
      const ball = lane.ballBody;
      if (!ball) continue;

      const pos = ball.translation();
      const vel = ball.linvel();

      if (pos.z < DECK_END_Z) {
        lane.inPit = true;
      }
      if (pos.z < DECK_END_Z - BALL_RADIUS) {
        lane.ballEnteredPitFully = true;
      }

      if (!lane.inPit) continue;

      const nearCurtain = pos.z <= PIT_BACK_Z + 0.12 + BALL_RADIUS + 0.10;
      const rebounding = vel.z > 0 || vel.y > 0.05;
      const onPitFloor = pos.y < -0.35;

      if (nearCurtain || rebounding) {
        const damp = nearCurtain ? Math.exp(-18 * this.fixedDt) : 0.7;
        ball.setLinvel(
          {
            x: vel.x * damp,
            y: Math.min(0, vel.y),
            z: Math.min(0, vel.z * damp),
          },
          true
        );
        const av = ball.angvel();
        const angDamp = Math.exp(-20 * this.fixedDt);
        ball.setAngvel(
          { x: av.x * angDamp, y: av.y * angDamp, z: av.z * angDamp },
          true
        );
      } else if (onPitFloor) {
        const floorDamp = Math.exp(-6 * this.fixedDt);
        ball.setLinvel(
          { x: vel.x * floorDamp, y: vel.y, z: vel.z * floorDamp },
          true
        );
        const av = ball.angvel();
        ball.setAngvel(
          { x: av.x * floorDamp, y: av.y * floorDamp, z: av.z * floorDamp },
          true
        );
      }

      // Hard one-way pit trap: once the ball has entered the pit, it can NEVER return onto the deck
      if (lane.ballEnteredPitFully && pos.z > DECK_END_Z - BALL_RADIUS) {
        ball.setTranslation(
          { x: pos.x, y: Math.min(pos.y, 0.0), z: DECK_END_Z - BALL_RADIUS },
          true
        );
        const nextVel = ball.linvel();
        ball.setLinvel(
          { x: nextVel.x * 0.5, y: Math.min(0, nextVel.y), z: Math.min(0, nextVel.z) },
          true
        );
      }
    }
  }

  private applyLaneForces(dt: number, events: PhysicsCollisionEvent[]): void {
    for (const lane of this.lanes.values()) {
      const ball = lane.ballBody;
      if (!ball) continue;

      lane.throwElapsed += dt;
      const pos = ball.translation();
      const vel = ball.linvel();
      const localX = pos.x - lane.centerX;

      if (pos.z < DECK_END_Z) {
        lane.inPit = true;
      }
      if (pos.z < DECK_END_Z - BALL_RADIUS) {
        lane.ballEnteredPitFully = true;
      }

      // Check gutter entry
      if (!lane.inGutter && !lane.inPit && Math.abs(localX) > LANE_WIDTH * 0.5 + 0.03) {
        lane.inGutter = true;
        events.push({
          laneIndex: lane.laneIndex,
          kind: 'gutter-enter',
          intensity: Math.min(1, Math.abs(vel.z) / 10),
          position: [pos.x, pos.y, pos.z],
        });
      }

      if (lane.inGutter && !lane.inPit) {
        // Keep ball cleanly guided down the gutter trough into the pit
        const gutterCenter =
          lane.centerX + Math.sign(localX) * (LANE_WIDTH * 0.5 + GUTTER_WIDTH * 0.5);
        const pullX = (gutterCenter - pos.x) * 32 - vel.x * 8;
        ball.applyImpulse({ x: pullX * dt, y: 0, z: 0 }, true);
        // Ensure ball keeps rolling smoothly to the pit
        if (vel.z > -4.2) {
          ball.setLinvel({ x: vel.x * 0.85, y: vel.y, z: -4.8 }, true);
        }
        continue;
      }

      // Authentic Skid -> Hook -> Roll contact friction on the oiled-to-dry maple lane
      if (!lane.inPit && pos.y <= BALL_RADIUS + 0.025 && Math.hypot(vel.x, vel.z) > 0.15) {
        const distDownLane = Math.max(0, FOUL_LINE_Z - pos.z);
        const mu = getLaneFriction(distDownLane, localX);
        const angvel = ball.angvel();

        // Contact-patch slip velocity at bottom of ball r_c = (0, -R, 0):
        // v_slip = v_horiz + omega x (0, -R, 0) = (vx + wz*R, 0, vz - wx*R)
        const vSlipX = vel.x + angvel.z * BALL_RADIUS;
        const vSlipZ = vel.z - angvel.x * BALL_RADIUS;
        const slipSpeed = Math.hypot(vSlipX, vSlipZ);

        if (slipSpeed > 1e-4) {
          const mass = ball.mass();
          // Exact solid-sphere (I = 2/5 m R^2) sticking clamp prevents pure-roll overshoot
          const jMax = mu * mass * GRAVITY * dt;
          const jStop = (2 / 7) * mass * slipSpeed;
          const jMag = Math.min(jMax, jStop);

          const jx = -(vSlipX / slipSpeed) * jMag;
          const jz = -(vSlipZ / slipSpeed) * jMag;

          // Apply both horizontal contact friction impulse and coupled torque r_c x J
          ball.applyImpulse({ x: jx, y: 0, z: jz }, true);
          ball.applyTorqueImpulse(
            { x: -BALL_RADIUS * jz, y: 0, z: BALL_RADIUS * jx },
            true
          );
        }

        // Update visual spin telemetry smoothly as stored side-slip converts into curving roll
        if (lane.initialSideSlip > 0.05) {
          const slipRatio = clamp01(Math.abs(vSlipX) / lane.initialSideSlip);
          lane.ballSpin = lane.initialSpin * (0.35 + 0.65 * slipRatio);
        }
      }
    }
  }

  private drainCollisions(events: PhysicsCollisionEvent[]): void {
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;

      for (const lane of this.lanes.values()) {
        const isBall1 = lane.ballColliderHandle === h1;
        const isBall2 = lane.ballColliderHandle === h2;
        const isPin1 = lane.pinColliderHandles.has(h1);
        const isPin2 = lane.pinColliderHandles.has(h2);

        if ((isBall1 && isPin2) || (isBall2 && isPin1)) {
          if (lane.pinHitTime === null) {
            lane.pinHitTime = lane.throwElapsed;
          }
          const ball = lane.ballBody;
          const speed = ball
            ? Math.hypot(ball.linvel().x, ball.linvel().y, ball.linvel().z)
            : 8;
          const p = ball ? ball.translation() : { x: lane.centerX, y: 0.15, z: HEAD_PIN_Z };
          events.push({
            laneIndex: lane.laneIndex,
            kind: 'pin-impact',
            intensity: Math.min(16, speed * 1.25),
            position: [p.x, p.y, p.z],
            duringClearing: lane.clearing.active,
          });
        } else if (isPin1 && isPin2) {
          if (lane.pinHitTime === null && lane.ballBody) {
            lane.pinHitTime = lane.throwElapsed;
          }
          events.push({
            laneIndex: lane.laneIndex,
            kind: 'pin-impact',
            intensity: lane.clearing.active ? 2.4 : 6.5,
            position: [lane.centerX, 0.18, HEAD_PIN_Z - 0.3],
            duringClearing: lane.clearing.active,
          });
        }
      }
    });
  }

  private buildStaticLane(laneIndex: number): void {
    const cx = getLaneCenterX(laneIndex);

    // 1. Main Maple Lane + Approach surface (y = 0 at top face)
    const laneLength = APPROACH_START_Z - DECK_END_Z; // ~23.15 m
    const laneCenterZ = (APPROACH_START_Z + DECK_END_Z) * 0.5;
    const laneCol = RAPIER.ColliderDesc.cuboid(LANE_WIDTH * 0.5, 0.1, laneLength * 0.5)
      .setTranslation(cx, -0.1, laneCenterZ)
      .setFriction(0.16)
      .setRestitution(0.15)
      .setCollisionGroups(COLLISION_STATIC);
    this.world.createCollider(laneCol);

    // 2. Left & Right Gutter floors + outer channel walls
    const gutterLen = FOUL_LINE_Z - DECK_END_Z;
    const gutterCenterZ = (FOUL_LINE_Z + DECK_END_Z) * 0.5;
    for (const side of [-1, 1] as const) {
      const gutterX = cx + side * (LANE_WIDTH * 0.5 + GUTTER_WIDTH * 0.5);
      // Recessed gutter floor
      const gFloor = RAPIER.ColliderDesc.cuboid(GUTTER_WIDTH * 0.55, 0.05, gutterLen * 0.5)
        .setTranslation(gutterX, -0.16, gutterCenterZ)
        .setFriction(0.08)
        .setRestitution(0.05)
        .setCollisionGroups(COLLISION_STATIC);
      this.world.createCollider(gFloor);

      // Outer divider wall preventing ball from hopping into adjacent lane
      const wallX = cx + side * (LANE_WIDTH * 0.5 + GUTTER_WIDTH + 0.04);
      const wall = RAPIER.ColliderDesc.cuboid(0.05, 0.32, gutterLen * 0.5)
        .setTranslation(wallX, 0.12, gutterCenterZ)
        .setFriction(0.15)
        .setRestitution(0.25)
        .setCollisionGroups(COLLISION_STATIC);
      this.world.createCollider(wall);
    }

    // 3. Pin Deck Side Kickbacks (realistic bouncy side walls next to pins!)
    const kickbackLen = 2.6;
    const kickbackZ = HEAD_PIN_Z - 0.85;
    for (const side of [-1, 1] as const) {
      const kbX = cx + side * (LANE_WIDTH * 0.5 + GUTTER_WIDTH + 0.04);
      const kb = RAPIER.ColliderDesc.cuboid(0.06, 0.45, kickbackLen * 0.5)
        .setTranslation(kbX, 0.25, kickbackZ)
        .setFriction(0.2)
        .setRestitution(0.55)
        .setCollisionGroups(COLLISION_STATIC);
      this.world.createCollider(kb);
    }

    // 4. Sunken Pin Pit floor & energy-absorbing back curtain (zero bounce!)
    const pitLen = DECK_END_Z - PIT_BACK_Z + 0.5;
    const pitCenterZ = (DECK_END_Z + PIT_BACK_Z) * 0.5;
    const pitFloor = RAPIER.ColliderDesc.cuboid(LANE_PITCH * 0.48, 0.1, pitLen * 0.5)
      .setTranslation(cx, -0.62, pitCenterZ)
      .setFriction(0.9)
      .setRestitution(0.0)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(COLLISION_STATIC);
    this.world.createCollider(pitFloor);

    // Cushioned back curtain: Min restitution=0 prevents bouncing back onto pins,
    // and low vertical friction prevents forward ball spin from kicking the ball upward.
    const backWall = RAPIER.ColliderDesc.cuboid(LANE_PITCH * 0.48, 0.85, 0.12)
      .setTranslation(cx, 0.1, PIT_BACK_Z)
      .setFriction(0.04)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0.0)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(COLLISION_STATIC);
    this.world.createCollider(backWall);
  }
}

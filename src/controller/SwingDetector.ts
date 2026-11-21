import type { AimState, ArmPoseState, ThrowParams } from '../types/game';
import type {
  ImuTraceEvent,
  ImuTraceRecord,
  ImuTraceSample,
  OrientEulerDeg,
  RawImuSample,
  Vec3,
} from './ThrowTraceRecorder';

export interface SwingDetectorConfig {
  /** Minimum hinge angular speed (deg/s) to start accumulating backswing direction */
  backswingEngageSpeedDeg: number;
  /** Minimum angle (deg) swung away from resting side pose to lock the backswing axis */
  backswingLockAngleDeg: number;
  /** Forward swing angular velocity (deg/s) needed to transition BACKSWING -> FORWARDSWING */
  forwardEngageRateDeg: number;
  /** Minimum peak forward angular velocity (deg/s) required for a valid throw */
  minForwardPeakDeg: number;
  /** Ratio of peak forward speed below which auto-release triggers near/past hip bottom */
  releaseDecelRatio: number;
  /** Minimum time (ms) in forward swing before auto-release can fire */
  minForwardDurationMs: number;
  /** Max time (ms) in forward swing before forcing release if peak met */
  maxForwardDurationMs: number;
  /** Cooldown (ms) after a release before another grip can arm */
  cooldownMs: number;
}

const DEFAULT_CONFIG: SwingDetectorConfig = {
  backswingEngageSpeedDeg: 35,
  backswingLockAngleDeg: 7,
  forwardEngageRateDeg: 55,
  minForwardPeakDeg: 110,
  releaseDecelRatio: 0.78,
  minForwardDurationMs: 55,
  maxForwardDurationMs: 550,
  cooldownMs: 650,
};

export interface SwingLiveTelemetry {
  swingAngleDeg: number;
  swingRateDeg: number;
  twistAngleDeg: number;
  twistRateDeg: number;
  hingeSpeedDeg: number;
  lateralPullDeg: number;
  accelMag: number;
  axisLocked: boolean;
  forwardAxis: Vec3 | null;
  forearmUpAxis: Vec3;
  gyroSource: 'orient-quat' | 'device-motion' | 'none';
}

export interface SwingDetectorOutput {
  pose: ArmPoseState;
  telemetry: SwingLiveTelemetry;
  releasedThrow: ThrowParams | null;
  completedTrace: ImuTraceRecord | null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vecLen(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3): Vec3 | null {
  const len = vecLen(v);
  if (len < 1e-6) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function roundVec3(v: Vec3 | null): Vec3 | null {
  if (!v) return null;
  return { x: round3(v.x), y: round3(v.y), z: round3(v.z) };
}

/**
 * Computes World-Up expressed in phone local coordinates (X=right, Y=top, Z=out-of-screen)
 * from W3C DeviceOrientationEvent (beta, gamma).
 */
export function computeWorldUpInPhoneFrame(orient: OrientEulerDeg): Vec3 {
  const b = (orient.beta * Math.PI) / 180;
  const g = (orient.gamma * Math.PI) / 180;
  const raw = {
    x: -Math.cos(b) * Math.sin(g),
    y: Math.sin(b),
    z: Math.cos(b) * Math.cos(g),
  };
  return normalize(raw) ?? { x: 0, y: 1, z: 0 };
}

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** W3C intrinsic Z-X'-Y'' Euler (alpha, beta, gamma) -> unit quaternion (phone -> world) */
function eulerToQuat(o: OrientEulerDeg): Quat {
  const a = ((o.alpha * Math.PI) / 180) * 0.5;
  const b = ((o.beta * Math.PI) / 180) * 0.5;
  const g = ((o.gamma * Math.PI) / 180) * 0.5;

  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cg = Math.cos(g);
  const sg = Math.sin(g);

  return {
    w: ca * cb * cg - sa * sb * sg,
    x: ca * sb * cg - sa * cb * sg,
    y: ca * cb * sg + sa * sb * cg,
    z: sa * cb * cg + ca * sb * sg,
  };
}

function rotateVecByQuat(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Local angular velocity (deg/s) between two consecutive orientation quaternions */
function quatDeltaToGyroDeg(prev: Quat, curr: Quat, dtSec: number): Vec3 {
  let w = prev.w * curr.w + prev.x * curr.x + prev.y * curr.y + prev.z * curr.z;
  let x = prev.w * curr.x - prev.x * curr.w - prev.y * curr.z + prev.z * curr.y;
  let y = prev.w * curr.y + prev.x * curr.z - prev.y * curr.w - prev.z * curr.x;
  let z = prev.w * curr.z - prev.x * curr.y + prev.y * curr.x - prev.z * curr.w;

  if (w < 0) {
    w = -w;
    x = -x;
    y = -y;
    z = -z;
  }

  const sinHalf = Math.hypot(x, y, z);
  if (sinHalf < 1e-6) return { x: 0, y: 0, z: 0 };

  const angleRad = 2 * Math.atan2(sinHalf, clamp(w, -1, 1));
  const degPerSec = (angleRad * (180 / Math.PI)) / dtSec;
  return {
    x: (x / sinHalf) * degPerSec,
    y: (y / sinHalf) * degPerSec,
    z: (z / sinHalf) * degPerSec,
  };
}

function orientEqual(a: OrientEulerDeg | null, b: OrientEulerDeg | null): boolean {
  if (!a || !b) return false;
  return a.alpha === b.alpha && a.beta === b.beta && a.gamma === b.gamma;
}

/**
 * Orientation-agnostic bowling swing detector (V3):
 * 1. Calibrates forearm-up axis u0 on ZR touch-down (hand naturally at side, any phone grip).
 * 2. Prefers deduplicated DeviceOrientation quaternion angular velocity (`orient-quat`) so
 *    Chrome Android's rotationRate axis-swap quirk never pollutes twist or swing axes.
 * 3. Locks the shoulder hinge axis from initial backswing motion (never inverted).
 * 4. Measures physical horizontal pull angle (`lateralPullDeg`) of your forward swing relative
 *    to your backswing plane so physically aiming/swinging left or right steers the ball.
 * 5. Integrates forearm twist ONLY during the forward swing (no backswing drift).
 * 6. Supports both hold-ZR auto-release AND natural manual lift-release on forward swing.
 */
export class SwingDetector {
  private readonly cfg: SwingDetectorConfig;

  private phase: ArmPoseState['phase'] = 'idle';
  private holdingGrip = false;
  private cooldownUntilMs = 0;

  // Latest raw state
  private lastSampleMs = 0;
  private latestOrient: OrientEulerDeg | null = null;
  private latestAccelG: Vec3 | null = null;
  private prevOrient: OrientEulerDeg | null = null;
  private prevOrientQuat: Quat | null = null;
  private prevOrientChangeMs = 0;
  private lastOrientGyro: Vec3 = { x: 0, y: 0, z: 0 };
  private lastKnownForwardAxis: Vec3 | null = null;

  // Per-grip calibrated frame
  private gripStartMs = 0;
  private startOrient: OrientEulerDeg | null = null;
  private forearmUpAxis: Vec3 = { x: 0, y: 1, z: 0 };
  private backswingAccum: Vec3 = { x: 0, y: 0, z: 0 };
  private backswingAxis: Vec3 | null = null;
  private forwardAxis: Vec3 | null = null;
  private gyroSource: 'orient-quat' | 'device-motion' | 'none' = 'none';

  // World-space backswing stance forward direction (XY unit vector) for lateral throw aiming
  private maxBackswingHoriz = 0;
  private stanceForwardXY: { x: number; y: number } | null = null;
  private weightedPullSum = 0;
  private weightedPullDenom = 0;

  // Integrated & smoothed swing kinematics
  private smoothGyro: Vec3 = { x: 0, y: 0, z: 0 };
  private swingAngleDeg = 0;
  private swingRateDeg = 0;
  private forwardTwistAngleDeg = 0;
  private twistRateDeg = 0;
  private hingeSpeedDeg = 0;
  private latestAccelMag = 0;

  // Throw peak tracking
  private minBackswingAngleDeg = 0;
  private maxForwardAngleDeg = 0;
  private forwardStartMs = 0;
  private peakForwardRateDeg = 0;
  private peakAccelMag = 0;
  private twistAngleAtPeakDeg = 0;
  private twistRateAtPeakDeg = 0;

  // Debug trace buffer
  private recordTrace = false;
  private practiceOnly = false;
  private traceSamples: ImuTraceSample[] = [];
  private traceEvents: ImuTraceEvent[] = [];

  constructor(config?: Partial<SwingDetectorConfig>) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  public getPhase(): ArmPoseState['phase'] {
    return this.phase;
  }

  public setDebugTracing(enabled: boolean): void {
    this.recordTrace = enabled;
  }

  public reset(): void {
    this.phase = 'idle';
    this.holdingGrip = false;
    this.backswingAxis = null;
    this.forwardAxis = null;
    this.stanceForwardXY = null;
    this.backswingAccum = { x: 0, y: 0, z: 0 };
    this.swingAngleDeg = 0;
    this.swingRateDeg = 0;
    this.forwardTwistAngleDeg = 0;
    this.twistRateDeg = 0;
    this.smoothGyro = { x: 0, y: 0, z: 0 };
    this.traceSamples = [];
    this.traceEvents = [];
  }

  public setGripHeld(
    held: boolean,
    timestampMs: number,
    aim: AimState,
    practiceOnly = false
  ): SwingDetectorOutput {
    if (held && !this.holdingGrip) {
      this.holdingGrip = true;
      this.practiceOnly = practiceOnly;

      if (timestampMs >= this.cooldownUntilMs || practiceOnly) {
        this.calibrateAtGripStart(timestampMs);
      }
      return {
        pose: this.buildPose(),
        telemetry: this.buildTelemetry(),
        releasedThrow: null,
        completedTrace: null,
      };
    }

    if (!held && this.holdingGrip) {
      this.holdingGrip = false;

      // Lifting thumb mid-forward-swing is a natural first-class manual release!
      if (
        this.phase === 'forwardswing' &&
        this.peakForwardRateDeg >= this.cfg.minForwardPeakDeg * 0.72
      ) {
        const throwParams = this.computeThrow(aim);
        this.logEvent(timestampMs, 'LIFT_RELEASE', {
          lateralPullDeg: round2(this.getEffectiveLateralPullDeg()),
          forwardTwistAngleDeg: round2(this.forwardTwistAngleDeg),
          throwParams,
        });
        const trace = this.finalizeTrace(timestampMs, aim, throwParams, 'lift-release');
        this.phase = 'released';
        this.cooldownUntilMs = timestampMs + this.cfg.cooldownMs;
        return {
          pose: this.buildPose(),
          telemetry: this.buildTelemetry(),
          releasedThrow: throwParams,
          completedTrace: trace,
        };
      }

      let trace: ImuTraceRecord | null = null;
      if (this.phase !== 'idle' && this.phase !== 'released') {
        this.logEvent(timestampMs, 'CANCELLED_GRIP_LIFT', {
          fromPhase: this.phase,
          swingAngleDeg: round2(this.swingAngleDeg),
          peakForwardRateDeg: round2(this.peakForwardRateDeg),
        });
        trace = this.finalizeTrace(timestampMs, aim, null, 'cancelled');
      }

      this.phase = 'idle';
      this.swingAngleDeg = 0;
      this.swingRateDeg = 0;
      this.forwardTwistAngleDeg = 0;
      this.twistRateDeg = 0;
      return {
        pose: this.buildPose(),
        telemetry: this.buildTelemetry(),
        releasedThrow: null,
        completedTrace: trace,
      };
    }

    return {
      pose: this.buildPose(),
      telemetry: this.buildTelemetry(),
      releasedThrow: null,
      completedTrace: null,
    };
  }

  public pushSample(sample: RawImuSample, aim: AimState): SwingDetectorOutput {
    const dtSec =
      this.lastSampleMs > 0
        ? clamp((sample.timestampMs - this.lastSampleMs) / 1000, 0.002, 0.08)
        : 0.016;
    this.lastSampleMs = sample.timestampMs;

    if (sample.accelG) {
      this.latestAccelG = sample.accelG;
    }

    // Prefer deduplicated DeviceOrientation quaternion angular velocity (`orient-quat`)
    // whenever orient changes dynamically, eliminating Chrome Android's rotationRate axis swap!
    // If orient stays completely static while gyroDeg is active (e.g., synthetic tests or gyro-only devices),
    // seamlessly use sample.gyroDeg.
    let rawGyro: Vec3 = { x: 0, y: 0, z: 0 };
    let currQuat: Quat | null = null;

    if (sample.orient) {
      this.latestOrient = sample.orient;
      currQuat = eulerToQuat(sample.orient);
      const changed = !orientEqual(sample.orient, this.prevOrient);

      if (changed && this.prevOrientQuat) {
        const dtOrient = clamp(
          (sample.timestampMs - this.prevOrientChangeMs) / 1000,
          0.004,
          0.1
        );
        this.lastOrientGyro = quatDeltaToGyroDeg(this.prevOrientQuat, currQuat, dtOrient);
        this.prevOrient = { ...sample.orient };
        this.prevOrientQuat = currQuat;
        this.prevOrientChangeMs = sample.timestampMs;
        this.gyroSource = 'orient-quat';
      } else if (!this.prevOrientQuat) {
        this.prevOrient = { ...sample.orient };
        this.prevOrientQuat = currQuat;
        this.prevOrientChangeMs = sample.timestampMs;
      }

      const orientAgeMs = sample.timestampMs - this.prevOrientChangeMs;
      if (this.gyroSource === 'orient-quat' && orientAgeMs < 90) {
        rawGyro = this.lastOrientGyro;
      } else if (sample.gyroDeg) {
        rawGyro = sample.gyroDeg;
        this.gyroSource = 'device-motion';
      }
    } else if (sample.gyroDeg) {
      rawGyro = sample.gyroDeg;
      this.gyroSource = 'device-motion';
    }

    const alpha = 0.45;
    this.smoothGyro = {
      x: this.smoothGyro.x * (1 - alpha) + rawGyro.x * alpha,
      y: this.smoothGyro.y * (1 - alpha) + rawGyro.y * alpha,
      z: this.smoothGyro.z * (1 - alpha) + rawGyro.z * alpha,
    };

    const accelMag = sample.accel
      ? Math.hypot(sample.accel.x, sample.accel.y, sample.accel.z)
      : 0;
    this.latestAccelMag = accelMag;

    if (this.phase === 'released' && sample.timestampMs >= this.cooldownUntilMs) {
      this.phase = 'idle';
    }

    if (!this.holdingGrip || this.phase === 'idle' || this.phase === 'released') {
      return {
        pose: this.buildPose(),
        telemetry: this.buildTelemetry(),
        releasedThrow: null,
        completedTrace: null,
      };
    }

    const u0 = this.forearmUpAxis;
    const twistRate = dot(this.smoothGyro, u0);
    const omegaHinge: Vec3 = {
      x: this.smoothGyro.x - twistRate * u0.x,
      y: this.smoothGyro.y - twistRate * u0.y,
      z: this.smoothGyro.z - twistRate * u0.z,
    };
    const hingeSpeed = vecLen(omegaHinge);

    this.twistRateDeg = twistRate;
    this.hingeSpeedDeg = hingeSpeed;

    // Track current world-space forearm vector uWorld = R(q) * u0
    const uWorld = currQuat ? rotateVecByQuat(currQuat, u0) : null;

    let releasedThrow: ThrowParams | null = null;
    let completedTrace: ImuTraceRecord | null = null;

    if (this.phase === 'armed') {
      if (hingeSpeed >= this.cfg.backswingEngageSpeedDeg) {
        this.backswingAccum = {
          x: this.backswingAccum.x + omegaHinge.x * dtSec,
          y: this.backswingAccum.y + omegaHinge.y * dtSec,
          z: this.backswingAccum.z + omegaHinge.z * dtSec,
        };
      } else {
        const decay = Math.exp(-4.5 * dtSec);
        this.backswingAccum = {
          x: this.backswingAccum.x * decay,
          y: this.backswingAccum.y * decay,
          z: this.backswingAccum.z * decay,
        };
      }

      const accumAngle = vecLen(this.backswingAccum);
      this.swingAngleDeg = -accumAngle;
      this.swingRateDeg = -hingeSpeed;

      if (accumAngle >= this.cfg.backswingLockAngleDeg) {
        const hBack = normalize(this.backswingAccum)!;
        this.backswingAxis = hBack;
        this.forwardAxis = { x: -hBack.x, y: -hBack.y, z: -hBack.z };
        this.lastKnownForwardAxis = this.forwardAxis;
        this.phase = 'backswing';
        this.minBackswingAngleDeg = this.swingAngleDeg;
        this.logEvent(sample.timestampMs, 'BACKSWING_LOCKED', {
          accumAngleDeg: round2(accumAngle),
          backswingAxis: roundVec3(this.backswingAxis),
          forwardAxis: roundVec3(this.forwardAxis),
        });
      }
    } else if (this.phase === 'backswing') {
      const hFwd = this.forwardAxis!;

      // Refine backswing axis early while swinging cleanly backward
      if (this.swingAngleDeg > -24 && dot(omegaHinge, this.backswingAxis!) > 25) {
        this.backswingAccum = {
          x: this.backswingAccum.x + omegaHinge.x * dtSec,
          y: this.backswingAccum.y + omegaHinge.y * dtSec,
          z: this.backswingAccum.z + omegaHinge.z * dtSec,
        };
        const refined = normalize(this.backswingAccum);
        if (refined) {
          this.backswingAxis = refined;
          this.forwardAxis = { x: -refined.x, y: -refined.y, z: -refined.z };
          this.lastKnownForwardAxis = this.forwardAxis;
        }
      }

      // Record world-space horizontal stance forward direction at deepest backswing
      if (uWorld) {
        const horiz = Math.hypot(uWorld.x, uWorld.y);
        if (horiz > this.maxBackswingHoriz && horiz > 0.25) {
          this.maxBackswingHoriz = horiz;
          this.stanceForwardXY = { x: uWorld.x / horiz, y: uWorld.y / horiz };
        }
      }

      this.swingRateDeg = dot(this.smoothGyro, this.forwardAxis ?? hFwd);
      this.swingAngleDeg += this.swingRateDeg * dtSec;
      this.minBackswingAngleDeg = Math.min(this.minBackswingAngleDeg, this.swingAngleDeg);

      if (this.swingRateDeg >= this.cfg.forwardEngageRateDeg) {
        this.phase = 'forwardswing';
        this.forwardStartMs = sample.timestampMs;
        this.peakForwardRateDeg = this.swingRateDeg;
        this.peakAccelMag = accelMag;
        // Reset forward-only twist & pull accumulators so backswing drift never biases the throw!
        this.forwardTwistAngleDeg = 0;
        this.twistAngleAtPeakDeg = 0;
        this.twistRateAtPeakDeg = this.twistRateDeg;
        this.weightedPullSum = 0;
        this.weightedPullDenom = 0;
        this.logEvent(sample.timestampMs, 'FORWARDSWING_START', {
          minBackswingAngleDeg: round2(this.minBackswingAngleDeg),
          swingRateDeg: round2(this.swingRateDeg),
          stanceForwardXY: this.stanceForwardXY
            ? { x: round3(this.stanceForwardXY.x), y: round3(this.stanceForwardXY.y) }
            : null,
        });
      }
    } else if (this.phase === 'forwardswing') {
      const hFwd = this.forwardAxis ?? this.lastKnownForwardAxis ?? { x: 0, y: 0, z: 1 };
      this.swingRateDeg = dot(this.smoothGyro, hFwd);
      this.swingAngleDeg += this.swingRateDeg * dtSec;
      this.maxForwardAngleDeg = Math.max(this.maxForwardAngleDeg, this.swingAngleDeg);

      // Integrate forearm twist strictly during the forward swing
      this.forwardTwistAngleDeg += twistRate * dtSec;

      // Measure horizontal left/right swing pull relative to the backswing plane!
      // Positive lateralPullDeg = pulled LEFT (CCW in world XY); Negative = pulled RIGHT (CW).
      if (uWorld && this.stanceForwardXY) {
        const f = this.stanceForwardXY;
        const l = { x: -f.y, y: f.x }; // 90 deg CCW = LEFT in world XY
        const uFwd = uWorld.x * f.x + uWorld.y * f.y;
        const uLeft = uWorld.x * l.x + uWorld.y * l.y;
        const horizMag = Math.hypot(uFwd, uLeft);
        if (horizMag > 0.22) {
          const pullDeg = (Math.atan2(uLeft, Math.max(0.25, Math.abs(uFwd))) * 180) / Math.PI;
          const weight = Math.max(0.1, this.swingRateDeg / 200) * horizMag;
          this.weightedPullSum += pullDeg * weight;
          this.weightedPullDenom += weight;
        }
      }

      const elapsedForwardMs = sample.timestampMs - this.forwardStartMs;

      if (this.swingRateDeg > this.peakForwardRateDeg) {
        this.peakForwardRateDeg = this.swingRateDeg;
        this.twistAngleAtPeakDeg = this.forwardTwistAngleDeg;
        this.twistRateAtPeakDeg = this.twistRateDeg;
      }
      if (accelMag > this.peakAccelMag) {
        this.peakAccelMag = accelMag;
      }

      const pastBottomDecel =
        this.peakForwardRateDeg >= this.cfg.minForwardPeakDeg &&
        elapsedForwardMs >= this.cfg.minForwardDurationMs &&
        this.swingAngleDeg >= -12 &&
        this.swingRateDeg <= this.peakForwardRateDeg * this.cfg.releaseDecelRatio;

      const sharpDecel =
        this.peakForwardRateDeg >= this.cfg.minForwardPeakDeg &&
        elapsedForwardMs >= this.cfg.minForwardDurationMs + 35 &&
        this.swingRateDeg <= this.peakForwardRateDeg * 0.58;

      const timedOutAtPeak =
        this.peakForwardRateDeg >= this.cfg.minForwardPeakDeg * 0.85 &&
        elapsedForwardMs >= this.cfg.maxForwardDurationMs;

      if (pastBottomDecel || sharpDecel || timedOutAtPeak) {
        releasedThrow = this.computeThrow(aim);
        this.logEvent(sample.timestampMs, 'AUTO_RELEASE', {
          reason: pastBottomDecel
            ? 'past-bottom-decel'
            : sharpDecel
              ? 'sharp-decel'
              : 'timeout-at-peak',
          swingAngleDeg: round2(this.swingAngleDeg),
          swingRateDeg: round2(this.swingRateDeg),
          peakForwardRateDeg: round2(this.peakForwardRateDeg),
          lateralPullDeg: round2(this.getEffectiveLateralPullDeg()),
          forwardTwistAngleDeg: round2(this.forwardTwistAngleDeg),
          throwParams: releasedThrow,
        });
        this.recordTraceSample(sample, accelMag);
        completedTrace = this.finalizeTrace(
          sample.timestampMs,
          aim,
          releasedThrow,
          timedOutAtPeak ? 'timeout' : 'auto-release'
        );
        this.phase = 'released';
        this.cooldownUntilMs = sample.timestampMs + this.cfg.cooldownMs;
        return {
          pose: this.buildPose(),
          telemetry: this.buildTelemetry(),
          releasedThrow,
          completedTrace,
        };
      }

      if (
        elapsedForwardMs > 220 &&
        this.swingRateDeg < -35 &&
        this.peakForwardRateDeg < this.cfg.minForwardPeakDeg
      ) {
        this.phase = 'backswing';
        this.peakForwardRateDeg = 0;
        this.peakAccelMag = 0;
        this.logEvent(sample.timestampMs, 'REVERT_TO_BACKSWING');
      }
    }

    this.recordTraceSample(sample, accelMag);

    return {
      pose: this.buildPose(),
      telemetry: this.buildTelemetry(),
      releasedThrow,
      completedTrace,
    };
  }

  private calibrateAtGripStart(timestampMs: number): void {
    this.phase = 'armed';
    this.gripStartMs = timestampMs;
    this.startOrient = this.latestOrient ? { ...this.latestOrient } : null;

    if (this.latestOrient) {
      this.forearmUpAxis = computeWorldUpInPhoneFrame(this.latestOrient);
    } else if (this.latestAccelG) {
      this.forearmUpAxis = normalize(this.latestAccelG) ?? { x: 0, y: 1, z: 0 };
    } else {
      this.forearmUpAxis = { x: 0, y: 1, z: 0 };
    }

    this.backswingAccum = { x: 0, y: 0, z: 0 };
    this.backswingAxis = null;
    this.forwardAxis = null;
    this.maxBackswingHoriz = 0;
    this.stanceForwardXY = null;
    this.weightedPullSum = 0;
    this.weightedPullDenom = 0;

    this.swingAngleDeg = 0;
    this.swingRateDeg = 0;
    this.forwardTwistAngleDeg = 0;
    this.twistRateDeg = 0;
    this.hingeSpeedDeg = 0;
    this.minBackswingAngleDeg = 0;
    this.maxForwardAngleDeg = 0;
    this.peakForwardRateDeg = 0;
    this.peakAccelMag = 0;
    this.twistAngleAtPeakDeg = 0;
    this.twistRateAtPeakDeg = 0;

    this.traceSamples = [];
    this.traceEvents = [];
    this.logEvent(timestampMs, 'GRIP_CALIBRATED', {
      startOrient: this.startOrient,
      forearmUpAxis: roundVec3(this.forearmUpAxis),
    });
  }

  private getEffectiveLateralPullDeg(): number {
    if (this.weightedPullDenom <= 0) return 0;
    return this.weightedPullSum / this.weightedPullDenom;
  }

  private computeThrow(aim: AimState): ThrowParams {
    // Speed curve: 110..480 deg/s -> 7.4..14.0 m/s
    const rateNorm = clamp((this.peakForwardRateDeg - 100) / 360, 0, 1);
    const accelBonus = clamp(this.peakAccelMag / 26, 0, 1) * 0.22;
    const backswingArcBonus = clamp(Math.abs(this.minBackswingAngleDeg) / 70, 0, 1) * 0.08;
    const combinedPower = clamp(rateNorm * 0.82 + accelBonus + backswingArcBonus, 0, 1);

    const speed = 7.4 + combinedPower * 6.6;

    // Physical horizontal aim pull from swing plane (positive pullDeg = LEFT -> negative aimAngle in PhysicsWorld)
    const pullDeg = this.getEffectiveLateralPullDeg();
    const deadzoneDeg = 4.5;
    let physicalAimOffset = 0;
    if (Math.abs(pullDeg) > deadzoneDeg) {
      const eff = Math.sign(pullDeg) * (Math.abs(pullDeg) - deadzoneDeg);
      // 18 deg deliberate pull left -> ~ -0.028 rad (shifts ball cleanly ~0.50m left down the 18m lane!)
      physicalAimOffset = clamp(-eff * 0.002, -0.055, 0.055);
    }

    // Forward-only forearm twist around calibrated gravity axis u0 -> hook spin.
    // A 0.14 deadzone prevents straight swings from drifting accidentally.
    const twistAngleComp = clamp(-this.twistAngleAtPeakDeg / 50, -1, 1);
    const twistRateComp = clamp(-this.twistRateAtPeakDeg / 260, -1, 1);
    const rawSpin = twistAngleComp * 0.65 + twistRateComp * 0.35;
    const spin =
      Math.abs(rawSpin) < 0.14
        ? 0
        : clamp(Math.sign(rawSpin) * ((Math.abs(rawSpin) - 0.14) / 0.86), -1, 1);

    // If player intentionally pulled left/right without twisting the opposite way,
    // don't let tiny incidental opposite twist fight their intended throw direction!
    const finalSpin =
      Math.abs(physicalAimOffset) > 0.015 &&
      Math.sign(spin) !== 0 &&
      Math.sign(spin) !== Math.sign(physicalAimOffset) &&
      Math.abs(spin) < 0.35
        ? 0
        : spin;

    const loft = clamp(0.16 + combinedPower * 0.24, 0.14, 0.44);

    return {
      xOffset: clamp(aim.xOffset, -0.42, 0.42),
      aimAngle: round3(clamp(aim.aimAngle + physicalAimOffset, -0.18, 0.18)),
      speed: round2(speed),
      spin: round3(finalSpin),
      loft: round2(loft),
    };
  }

  private recordTraceSample(sample: RawImuSample, accelMag: number): void {
    if (!this.recordTrace) return;
    if (this.traceSamples.length >= 600) return;

    this.traceSamples.push({
      tMs: Math.round(sample.timestampMs - this.gripStartMs),
      orient: sample.orient
        ? {
            alpha: round2(sample.orient.alpha),
            beta: round2(sample.orient.beta),
            gamma: round2(sample.orient.gamma),
          }
        : null,
      gyroDeg: sample.gyroDeg
        ? {
            x: round2(sample.gyroDeg.x),
            y: round2(sample.gyroDeg.y),
            z: round2(sample.gyroDeg.z),
          }
        : null,
      accel: sample.accel
        ? {
            x: round2(sample.accel.x),
            y: round2(sample.accel.y),
            z: round2(sample.accel.z),
          }
        : null,
      accelG: sample.accelG
        ? {
            x: round2(sample.accelG.x),
            y: round2(sample.accelG.y),
            z: round2(sample.accelG.z),
          }
        : null,
      swingAngleDeg: round2(this.swingAngleDeg),
      swingRateDeg: round2(this.swingRateDeg),
      twistAngleDeg: round2(this.forwardTwistAngleDeg),
      twistRateDeg: round2(this.twistRateDeg),
      hingeSpeedDeg: round2(this.hingeSpeedDeg),
      accelMag: round2(accelMag),
      phase: this.phase,
    });
  }

  private logEvent(
    timestampMs: number,
    type: string,
    detail?: Record<string, unknown>
  ): void {
    if (!this.recordTrace) return;
    this.traceEvents.push({
      tMs: Math.round(timestampMs - this.gripStartMs),
      type,
      detail,
    });
  }

  private finalizeTrace(
    timestampMs: number,
    aim: AimState,
    outcome: ThrowParams | null,
    endReason: ImuTraceRecord['summary']['endReason']
  ): ImuTraceRecord | null {
    if (!this.recordTrace) return null;

    const record: ImuTraceRecord = {
      version: 2,
      createdAtIso: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node-test',
      practiceOnly: this.practiceOnly,
      aim: { ...aim },
      calibration: {
        startOrient: this.startOrient,
        forearmUpAxis: roundVec3(this.forearmUpAxis)!,
        backswingAxis: roundVec3(this.backswingAxis),
        forwardAxis: roundVec3(this.forwardAxis),
        stanceForwardXY: this.stanceForwardXY
          ? { x: round3(this.stanceForwardXY.x), y: round3(this.stanceForwardXY.y) }
          : null,
        gyroSource: this.gyroSource,
      },
      summary: {
        durationMs: Math.max(0, Math.round(timestampMs - this.gripStartMs)),
        sampleCount: this.traceSamples.length,
        minBackswingAngleDeg: round2(this.minBackswingAngleDeg),
        maxForwardAngleDeg: round2(this.maxForwardAngleDeg),
        peakForwardRateDeg: round2(this.peakForwardRateDeg),
        peakAccelMag: round2(this.peakAccelMag),
        forwardTwistAngleDeg: round2(this.forwardTwistAngleDeg),
        twistRateAtPeakDeg: round2(this.twistRateAtPeakDeg),
        lateralPullDeg: round2(this.getEffectiveLateralPullDeg()),
        endReason,
      },
      outcome,
      events: [...this.traceEvents],
      samples: [...this.traceSamples],
    };

    this.traceSamples = [];
    this.traceEvents = [];
    return record;
  }

  private buildPose(): ArmPoseState {
    const pitchDeg = clamp(this.swingAngleDeg, -88, 95);
    const rollDeg = clamp(-this.forwardTwistAngleDeg, -70, 70);
    return {
      pitch: (pitchDeg * Math.PI) / 180,
      roll: (rollDeg * Math.PI) / 180,
      holdingGrip: this.holdingGrip,
      phase: this.phase,
    };
  }

  private buildTelemetry(): SwingLiveTelemetry {
    return {
      swingAngleDeg: round2(this.swingAngleDeg),
      swingRateDeg: round2(this.swingRateDeg),
      twistAngleDeg: round2(this.forwardTwistAngleDeg),
      twistRateDeg: round2(this.twistRateDeg),
      hingeSpeedDeg: round2(this.hingeSpeedDeg),
      lateralPullDeg: round2(this.getEffectiveLateralPullDeg()),
      accelMag: round2(this.latestAccelMag),
      axisLocked: this.forwardAxis !== null,
      forwardAxis: roundVec3(this.forwardAxis),
      forearmUpAxis: roundVec3(this.forearmUpAxis)!,
      gyroSource: this.gyroSource,
    };
  }
}

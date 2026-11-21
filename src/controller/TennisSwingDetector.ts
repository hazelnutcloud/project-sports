import type {
  TennisRacketPose,
  TennisShotType,
  TennisStrokeSide,
  TennisSwingInput,
} from '../types/tennis';
import type { OrientEulerDeg, RawImuSample, Vec3 } from './ThrowTraceRecorder';
import { computeWorldUpInPhoneFrame } from './SwingDetector';

export interface TennisSwingDetectorConfig {
  /** Minimum combined angular velocity (deg/s) to trigger a racket swing */
  swingTriggerRateDeg: number;
  /** Minimum linear acceleration spike (m/s^2) that can also confirm a fast swing */
  swingAccelAssist: number;
  /** Upward acceleration or vertical pitch velocity needed to trigger a serve toss */
  tossUpAccelThreshold: number;
  tossPitchRateDeg: number;
  /** Cooldown (ms) after a swing fires so follow-through never double-triggers */
  swingCooldownMs: number;
  /** Cooldown (ms) after a toss fires */
  tossCooldownMs: number;
}

const DEFAULT_CONFIG: TennisSwingDetectorConfig = {
  swingTriggerRateDeg: 215,
  swingAccelAssist: 6.5,
  tossUpAccelThreshold: 7.5,
  tossPitchRateDeg: 170,
  swingCooldownMs: 360,
  tossCooldownMs: 650,
};

export interface TennisSwingDetectorOutput {
  pose: TennisRacketPose;
  swing: Omit<TennisSwingInput, 'playerId'> | null;
  serveTossTriggered: boolean;
}

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
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
 * Low-latency tennis racket IMU gesture detector:
 * - No grip-hold required (Nintendo Switch Sports style free swing)
 * - Uses deduplicated DeviceOrientation quaternion angular velocity (`orient-quat`)
 *   with automatic fallback to `sample.gyroDeg` for synthetic tests / gyro-only devices
 * - Classifies forehand vs backhand vs overhead, and flat / topspin / slice / lob
 * - Detects upward flick serve toss when `expectServeToss` is true
 */
export class TennisSwingDetector {
  private readonly cfg: TennisSwingDetectorConfig;

  private lastSampleMs = 0;
  private swingCooldownUntilMs = 0;
  private tossCooldownUntilMs = 0;

  private latestOrient: OrientEulerDeg | null = null;
  private prevOrient: OrientEulerDeg | null = null;
  private prevOrientQuat: Quat | null = null;
  private prevOrientChangeMs = 0;
  private lastOrientGyro: Vec3 = { x: 0, y: 0, z: 0 };
  private gyroSource: 'orient-quat' | 'device-motion' | 'none' = 'none';

  // Calibrated neutral ready stance
  private neutralOrient: OrientEulerDeg | null = null;
  private upAxis: Vec3 = { x: 0, y: 1, z: 0 };
  private smoothGyro: Vec3 = { x: 0, y: 0, z: 0 };
  private peakWindowRate = 0;

  constructor(config?: Partial<TennisSwingDetectorConfig>) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  public calibrate(): void {
    if (this.latestOrient) {
      this.neutralOrient = { ...this.latestOrient };
      this.upAxis = computeWorldUpInPhoneFrame(this.latestOrient);
    } else {
      this.neutralOrient = null;
      this.upAxis = { x: 0, y: 1, z: 0 };
    }
    this.smoothGyro = { x: 0, y: 0, z: 0 };
    this.peakWindowRate = 0;
  }

  public reset(): void {
    this.lastSampleMs = 0;
    this.swingCooldownUntilMs = 0;
    this.tossCooldownUntilMs = 0;
    this.prevOrient = null;
    this.prevOrientQuat = null;
    this.smoothGyro = { x: 0, y: 0, z: 0 };
    this.peakWindowRate = 0;
  }

  public pushSample(
    sample: RawImuSample,
    options: { expectServeToss?: boolean; isServeStrike?: boolean } = {}
  ): TennisSwingDetectorOutput {
    const rawDtSec =
      this.lastSampleMs > 0
        ? Math.max(0.002, (sample.timestampMs - this.lastSampleMs) / 1000)
        : 0.016;
    const dtSec = clamp(rawDtSec, 0.002, 0.08);
    this.lastSampleMs = sample.timestampMs;

    let rawGyro: Vec3 = { x: 0, y: 0, z: 0 };
    if (sample.orient) {
      this.latestOrient = sample.orient;
      if (!this.neutralOrient) {
        this.neutralOrient = { ...sample.orient };
        this.upAxis = computeWorldUpInPhoneFrame(sample.orient);
      }

      const currQuat = eulerToQuat(sample.orient);
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

    // Time-aware smoothing: ~0.54 at 60Hz while naturally clearing stale bias after pauses
    const alpha = 1 - Math.exp(-rawDtSec * 48);
    this.smoothGyro = {
      x: this.smoothGyro.x * (1 - alpha) + rawGyro.x * alpha,
      y: this.smoothGyro.y * (1 - alpha) + rawGyro.y * alpha,
      z: this.smoothGyro.z * (1 - alpha) + rawGyro.z * alpha,
    };

    const gyroMag = vecLen(this.smoothGyro);
    const accelMag = sample.accel ? vecLen(sample.accel) : 0;
    this.peakWindowRate = Math.max(this.peakWindowRate * Math.exp(-5 * dtSec), gyroMag);

    const pose = this.buildPose(gyroMag);

    // 1. Check Serve Toss Gesture (sharp upward flick when waiting to serve)
    if (options.expectServeToss && sample.timestampMs >= this.tossCooldownUntilMs) {
      const upAccel = sample.accel ? dot(sample.accel, this.upAxis) : 0;
      const pitchUpRate = this.smoothGyro.x; // pitching top of phone upward
      if (
        upAccel >= this.cfg.tossUpAccelThreshold ||
        pitchUpRate >= this.cfg.tossPitchRateDeg
      ) {
        this.tossCooldownUntilMs = sample.timestampMs + this.cfg.tossCooldownMs;
        this.swingCooldownUntilMs = sample.timestampMs + 220;
        return { pose, swing: null, serveTossTriggered: true };
      }
      return { pose, swing: null, serveTossTriggered: false };
    }

    // 2. Check Racket Swing Trigger
    if (sample.timestampMs < this.swingCooldownUntilMs) {
      return { pose, swing: null, serveTossTriggered: false };
    }

    const effectiveRate =
      gyroMag + Math.max(0, accelMag - this.cfg.swingAccelAssist) * 14;
    if (effectiveRate < this.cfg.swingTriggerRateDeg) {
      return { pose, swing: null, serveTossTriggered: false };
    }

    this.swingCooldownUntilMs = sample.timestampMs + this.cfg.swingCooldownMs;

    // Classify stroke side & shot type from phone local gyro axes:
    // Phone held upright like a racket handle (screen facing left/body, top edge pointing forward/up):
    // - Horizontal sweep around vertical axis (gyro.z / gyro.y): positive = forehand, negative = backhand
    // - Pitch forward/up (gyro.x): positive = upward scoop (lob/topspin), negative = downward chop (slice/overhead serve)
    // - Forearm pronation/supination roll (gyro.y): positive = topspin brush, negative = open-face slice
    const horizRate =
      Math.abs(this.smoothGyro.z) >= Math.abs(this.smoothGyro.y) * 0.7
        ? this.smoothGyro.z
        : this.smoothGyro.y;

    let strokeSide: TennisStrokeSide;
    if (options.isServeStrike || this.smoothGyro.x < -210) {
      strokeSide = 'overhead';
    } else if (horizRate >= 0) {
      strokeSide = 'forehand';
    } else {
      strokeSide = 'backhand';
    }

    const power = clamp((effectiveRate - 180) / 420, 0.25, 1);

    let shotType: TennisShotType = 'flat';
    let spin = 0;

    if (options.isServeStrike) {
      shotType = 'serve';
      spin = clamp(this.smoothGyro.y / 320, -0.3, 0.6);
    } else if (this.smoothGyro.x > 165 && Math.abs(horizRate) < Math.abs(this.smoothGyro.x) * 1.15) {
      // Distinct upward scoop -> Lob!
      shotType = 'lob';
      spin = 0.25;
    } else if (this.smoothGyro.x < -125 || this.smoothGyro.y < -165) {
      // Downward chop / open racket face -> Backspin Slice!
      shotType = 'slice';
      spin = clamp(-0.45 - Math.abs(this.smoothGyro.x) / 500, -0.95, -0.45);
    } else if (this.smoothGyro.x > 55 || this.smoothGyro.y > 140) {
      // Upward brush / closed face pronation -> Topspin!
      shotType = 'topspin';
      spin = clamp(0.45 + (this.smoothGyro.x + Math.max(0, this.smoothGyro.y)) / 650, 0.45, 0.95);
    } else {
      shotType = 'flat';
      spin = clamp(this.smoothGyro.y / 600, -0.25, 0.35);
    }

    // Subtle directional bias from horizontal swing yaw
    const aimBias = clamp(-horizRate / 650, -0.65, 0.65);

    return {
      pose,
      serveTossTriggered: false,
      swing: {
        strokeSide,
        shotType,
        power: round3(power),
        aimBias: round3(aimBias),
        spin: round3(spin),
        timestampMs: sample.timestampMs,
      },
    };
  }

  private buildPose(gyroMag: number): TennisRacketPose {
    const base = this.neutralOrient;
    const cur = this.latestOrient;
    let pitch = 0;
    let roll = 0;
    let yaw = 0;

    if (cur && base) {
      pitch = clamp(((cur.beta - base.beta) * Math.PI) / 180, -1.2, 1.2);
      roll = clamp(((cur.gamma - base.gamma) * Math.PI) / 180, -1.2, 1.2);
      let dAlpha = cur.alpha - base.alpha;
      if (dAlpha > 180) dAlpha -= 360;
      if (dAlpha < -180) dAlpha += 360;
      yaw = clamp((dAlpha * Math.PI) / 180, -1.3, 1.3);
    }

    return {
      pitch: round3(pitch),
      roll: round3(roll),
      yaw: round3(yaw),
      swingEnergy: round3(clamp(gyroMag / 480, 0, 1)),
    };
  }
}

export function getNeutralUpAxis(orient: OrientEulerDeg | null): Vec3 {
  if (!orient) return { x: 0, y: 1, z: 0 };
  return normalize(computeWorldUpInPhoneFrame(orient)) ?? { x: 0, y: 1, z: 0 };
}

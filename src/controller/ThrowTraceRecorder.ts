import type { AimState, ArmPoseState, ThrowParams } from '../types/game';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface OrientEulerDeg {
  alpha: number;
  beta: number;
  gamma: number;
}

export interface RawImuSample {
  timestampMs: number;
  /** W3C DeviceOrientationEvent (alpha, beta, gamma) in degrees */
  orient: OrientEulerDeg | null;
  /** W3C DeviceMotionEvent.rotationRate mapped to phone local axes (deg/s):
   *  x = beta (around +X), y = gamma (around +Y), z = alpha (around +Z)
   */
  gyroDeg: Vec3 | null;
  /** Linear acceleration excluding gravity (m/s^2) */
  accel: Vec3 | null;
  /** Acceleration including gravity (m/s^2) */
  accelG: Vec3 | null;
}

export interface ImuTraceSample {
  /** Milliseconds elapsed since ZR grip touch-down */
  tMs: number;
  orient: OrientEulerDeg | null;
  gyroDeg: Vec3 | null;
  accel: Vec3 | null;
  accelG: Vec3 | null;
  /** Derived values from SwingDetector */
  swingAngleDeg: number;
  swingRateDeg: number;
  twistAngleDeg: number;
  twistRateDeg: number;
  hingeSpeedDeg: number;
  accelMag: number;
  phase: ArmPoseState['phase'];
}

export interface ImuTraceEvent {
  tMs: number;
  type: string;
  detail?: Record<string, unknown>;
}

export interface ImuTraceRecord {
  version: 2;
  createdAtIso: string;
  userAgent: string;
  practiceOnly: boolean;
  aim: AimState;
  calibration: {
    startOrient: OrientEulerDeg | null;
    forearmUpAxis: Vec3;
    backswingAxis: Vec3 | null;
    forwardAxis: Vec3 | null;
    stanceForwardXY: { x: number; y: number } | null;
    gyroSource: 'orient-quat' | 'device-motion' | 'none';
  };
  summary: {
    durationMs: number;
    sampleCount: number;
    minBackswingAngleDeg: number;
    maxForwardAngleDeg: number;
    peakForwardRateDeg: number;
    peakAccelMag: number;
    forwardTwistAngleDeg: number;
    twistRateAtPeakDeg: number;
    lateralPullDeg: number;
    endReason: 'auto-release' | 'lift-release' | 'cancelled' | 'timeout';
  };
  outcome: ThrowParams | null;
  events: ImuTraceEvent[];
  samples: ImuTraceSample[];
}

export interface TraceUploadResult {
  ok: boolean;
  seq?: number;
  file?: string;
  latest?: string;
  error?: string;
}

export async function uploadDebugTrace(
  trace: ImuTraceRecord
): Promise<TraceUploadResult> {
  try {
    const res = await fetch('/api/debug/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trace),
    });
    const data = (await res.json()) as TraceUploadResult;
    return data;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error uploading trace',
    };
  }
}

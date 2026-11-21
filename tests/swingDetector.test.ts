import { describe, expect, it } from 'vitest';
import {
  SwingDetector,
  computeWorldUpInPhoneFrame,
} from '../src/controller/SwingDetector';
import type {
  ImuTraceRecord,
  OrientEulerDeg,
  RawImuSample,
  Vec3,
} from '../src/controller/ThrowTraceRecorder';
import type { AimState, ThrowParams } from '../src/types/game';

const DEFAULT_AIM: AimState = { xOffset: 0.05, aimAngle: -0.02 };

function runArbitraryGripSwing(options: {
  startOrient: OrientEulerDeg;
  /** Unit vector in phone coordinates along which the arm rotates during backswing */
  backswingAxis: Vec3;
  peakForwardRateDeg: number;
  twistRateAtPeakDeg?: number;
  accelPeak?: number;
  enableTrace?: boolean;
}) {
  const detector = new SwingDetector();
  if (options.enableTrace) detector.setDebugTracing(true);

  const u0 = computeWorldUpInPhoneFrame(options.startOrient);
  const bAxis = options.backswingAxis;

  // Prime detector with resting orientation before pressing ZR
  let t = 1000;
  detector.pushSample(
    {
      timestampMs: t,
      orient: options.startOrient,
      gyroDeg: { x: 0, y: 0, z: 0 },
      accel: { x: 0, y: 0, z: 0 },
      accelG: { x: u0.x * 9.81, y: u0.y * 9.81, z: u0.z * 9.81 },
    },
    DEFAULT_AIM
  );

  t += 16;
  detector.setGripHeld(true, t, DEFAULT_AIM);

  let released: ThrowParams | null = null;
  let trace: ImuTraceRecord | null = null;

  // Phase 1: Backswing along arbitrary backswingAxis (16 frames * 16ms * 140 deg/s ≈ 36 deg)
  for (let i = 0; i < 16; i++) {
    t += 16;
    const rate = 140;
    const sample: RawImuSample = {
      timestampMs: t,
      orient: options.startOrient,
      gyroDeg: {
        x: bAxis.x * rate,
        y: bAxis.y * rate,
        z: bAxis.z * rate,
      },
      accel: { x: 2, y: 1, z: 0 },
      accelG: null,
    };
    const out = detector.pushSample(sample, DEFAULT_AIM);
    if (out.releasedThrow) released = out.releasedThrow;
    if (out.completedTrace) trace = out.completedTrace;
  }
  expect(detector.getPhase()).toBe('backswing');

  // Phase 2: Forward swing along -backswingAxis + optional wrist twist around u0
  const profile = [
    0.25, 0.55, 0.85, 1.0, 1.0, 0.96, 0.88, 0.72, 0.52, 0.3, 0.15,
  ];
  const twistPeak = options.twistRateAtPeakDeg ?? 0;

  for (const frac of profile) {
    t += 16;
    const fwdRate = options.peakForwardRateDeg * frac;
    const twistRate = twistPeak * frac;
    const sample: RawImuSample = {
      timestampMs: t,
      orient: options.startOrient,
      gyroDeg: {
        x: -bAxis.x * fwdRate + u0.x * twistRate,
        y: -bAxis.y * fwdRate + u0.y * twistRate,
        z: -bAxis.z * fwdRate + u0.z * twistRate,
      },
      accel: { x: (options.accelPeak ?? 14) * frac, y: 0, z: 0 },
      accelG: null,
    };
    const out = detector.pushSample(sample, DEFAULT_AIM);
    if (out.releasedThrow) {
      released = out.releasedThrow;
      trace = out.completedTrace;
      break;
    }
  }

  return { detector, released, trace };
}

describe('Orientation-Agnostic Calibration-on-ZR SwingDetector', () => {
  it('auto-locks swing plane identically regardless of how the phone is held', () => {
    // 1. Side-held right-handed (+Y up, swing around -Z)
    const sideRight = runArbitraryGripSwing({
      startOrient: { alpha: 0, beta: 90, gamma: 0 },
      backswingAxis: { x: 0, y: 0, z: -1 },
      peakForwardRateDeg: 310,
    });

    // 2. Screen-facing-player portrait (+Y up, swing around -X)
    const portraitFront = runArbitraryGripSwing({
      startOrient: { alpha: 0, beta: 90, gamma: 0 },
      backswingAxis: { x: -1, y: 0, z: 0 },
      peakForwardRateDeg: 310,
    });

    // 3. Diagonal 45-deg twisted grip (+Y up, swing along normalized (1, 0, 1))
    const invSqrt2 = Math.SQRT1_2;
    const diagonal = runArbitraryGripSwing({
      startOrient: { alpha: 42, beta: 90, gamma: 0 },
      backswingAxis: { x: invSqrt2, y: 0, z: invSqrt2 },
      peakForwardRateDeg: 310,
    });

    expect(sideRight.released).not.toBeNull();
    expect(portraitFront.released).not.toBeNull();
    expect(diagonal.released).not.toBeNull();

    // All three grips produce the exact same speed & zero spin!
    expect(sideRight.released!.speed).toBeCloseTo(portraitFront.released!.speed, 1);
    expect(sideRight.released!.speed).toBeCloseTo(diagonal.released!.speed, 1);
    expect(sideRight.released!.spin).toBe(0);
    expect(sideRight.detector.getPhase()).toBe('released');
  });

  it('scales ball speed proportionally between soft and powerful swings', () => {
    const soft = runArbitraryGripSwing({
      startOrient: { alpha: 0, beta: 90, gamma: 0 },
      backswingAxis: { x: 0, y: 0, z: -1 },
      peakForwardRateDeg: 170,
      accelPeak: 5,
    });
    const hard = runArbitraryGripSwing({
      startOrient: { alpha: 0, beta: 90, gamma: 0 },
      backswingAxis: { x: 0, y: 0, z: -1 },
      peakForwardRateDeg: 430,
      accelPeak: 22,
    });

    expect(soft.released).not.toBeNull();
    expect(hard.released).not.toBeNull();
    expect(hard.released!.speed).toBeGreaterThan(soft.released!.speed + 2.0);
  });

  it('maps forearm twist around calibrated gravity axis u0 to left vs right hook spin', () => {
    // Positive twist around +u0 (right-hand supination) -> negative spin (left hook)
    const leftHook = runArbitraryGripSwing({
      startOrient: { alpha: 0, beta: 90, gamma: 0 },
      backswingAxis: { x: 0, y: 0, z: -1 },
      peakForwardRateDeg: 300,
      twistRateAtPeakDeg: 220,
    });
    // Negative twist around +u0 (right-hand pronation) -> positive spin (right hook)
    const rightHook = runArbitraryGripSwing({
      startOrient: { alpha: 0, beta: 90, gamma: 0 },
      backswingAxis: { x: 0, y: 0, z: -1 },
      peakForwardRateDeg: 300,
      twistRateAtPeakDeg: -220,
    });

    expect(leftHook.released!.spin).toBeLessThan(-0.2);
    expect(rightHook.released!.spin).toBeGreaterThan(0.2);
  });

  it('emits a complete inspectable ImuTraceRecord in Debug Mode (both on throw and on cancel)', () => {
    const { released, trace } = runArbitraryGripSwing({
      startOrient: { alpha: 15, beta: 85, gamma: 10 },
      backswingAxis: { x: 0, y: 0, z: -1 },
      peakForwardRateDeg: 320,
      enableTrace: true,
    });

    expect(released).not.toBeNull();
    expect(trace).not.toBeNull();
    expect(trace!.version).toBe(2);
    expect(trace!.calibration.forwardAxis).not.toBeNull();
    expect(trace!.calibration.forwardAxis!.z).toBeGreaterThan(0.9);
    expect(trace!.samples.length).toBeGreaterThan(15);
    expect(trace!.events.some((e) => e.type === 'BACKSWING_LOCKED')).toBe(true);
    expect(trace!.events.some((e) => e.type === 'AUTO_RELEASE')).toBe(true);
    expect(trace!.outcome).toEqual(released);

    // Cancelled throw also produces a trace for debugging why a swing didn't fire
    const detector = new SwingDetector();
    detector.setDebugTracing(true);
    detector.setGripHeld(true, 100, DEFAULT_AIM);
    detector.pushSample(
      {
        timestampMs: 116,
        orient: { alpha: 0, beta: 90, gamma: 0 },
        gyroDeg: { x: 0, y: 0, z: -120 },
        accel: { x: 0, y: 0, z: 0 },
        accelG: null,
      },
      DEFAULT_AIM
    );
    const cancelOut = detector.setGripHeld(false, 180, DEFAULT_AIM);
    expect(cancelOut.releasedThrow).toBeNull();
    expect(cancelOut.completedTrace).not.toBeNull();
    expect(cancelOut.completedTrace!.summary.endReason).toBe('cancelled');
  });
});

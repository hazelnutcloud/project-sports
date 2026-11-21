import { describe, expect, it } from 'vitest';
import { TennisSwingDetector } from '../src/controller/TennisSwingDetector';
import type { RawImuSample } from '../src/controller/ThrowTraceRecorder';

function makeSample(
  timestampMs: number,
  gyroDeg: { x: number; y: number; z: number },
  accel: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
): RawImuSample {
  return {
    timestampMs,
    orient: null,
    gyroDeg,
    accel,
    accelG: { x: 0, y: 9.81, z: 0 },
  };
}

describe('TennisSwingDetector IMU Gestures', () => {
  it('detects forehand topspin, backhand slice, lob scoop, and enforces cooldown', () => {
    const detector = new TennisSwingDetector();

    // Calm idle sample -> no trigger
    const idle = detector.pushSample(makeSample(100, { x: 5, y: 4, z: 2 }));
    expect(idle.swing).toBeNull();

    // Forehand topspin brush (positive horizontal z + upward x brush + pronation y)
    const fh = detector.pushSample(
      makeSample(120, { x: 110, y: 180, z: 320 }, { x: 8, y: 4, z: 6 })
    );
    expect(fh.swing).not.toBeNull();
    expect(fh.swing?.strokeSide).toBe('forehand');
    expect(fh.swing?.shotType).toBe('topspin');
    expect(fh.swing?.spin).toBeGreaterThan(0.4);

    // Immediate follow-through sample inside 360ms cooldown -> suppressed
    const followThrough = detector.pushSample(makeSample(200, { x: 80, y: 120, z: 360 }));
    expect(followThrough.swing).toBeNull();

    // After cooldown: Backhand slice (negative z + downward chop x)
    detector.pushSample(makeSample(520, { x: 0, y: 0, z: 0 }));
    const bhSlice = detector.pushSample(
      makeSample(540, { x: -240, y: -120, z: -280 }, { x: -7, y: -3, z: 2 })
    );
    expect(bhSlice.swing).not.toBeNull();
    expect(bhSlice.swing?.shotType).toBe('slice');
    expect(bhSlice.swing?.spin).toBeLessThan(-0.4);

    // After cooldown: High upward scoop -> Lob
    detector.pushSample(makeSample(950, { x: 0, y: 0, z: 0 }));
    const lob = detector.pushSample(
      makeSample(970, { x: 340, y: 40, z: 90 }, { x: 2, y: 9, z: 3 })
    );
    expect(lob.swing).not.toBeNull();
    expect(lob.swing?.shotType).toBe('lob');
  });

  it('detects upward serve toss flick and subsequent overhead serve strike', () => {
    const detector = new TennisSwingDetector();

    // Upward flick while expecting serve toss
    const toss = detector.pushSample(
      makeSample(1000, { x: 210, y: 10, z: 15 }, { x: 0, y: 10.5, z: 1 }),
      { expectServeToss: true }
    );
    expect(toss.serveTossTriggered).toBe(true);
    expect(toss.swing).toBeNull();

    // Overhead strike after brief toss cooldown
    const serve = detector.pushSample(
      makeSample(1350, { x: -340, y: 120, z: 160 }, { x: 5, y: 8, z: 10 }),
      { isServeStrike: true }
    );
    expect(serve.swing).not.toBeNull();
    expect(serve.swing?.shotType).toBe('serve');
    expect(serve.swing?.strokeSide).toBe('overhead');
    expect(serve.swing?.power).toBeGreaterThan(0.5);
  });
});

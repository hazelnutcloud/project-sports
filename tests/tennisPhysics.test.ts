import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  COURT_HALF_LENGTH,
  DOUBLES_HALF_WIDTH,
  NET_CENTER_HEIGHT,
  SINGLES_HALF_WIDTH,
  computeShotLaunch,
  createIdleBall,
  isPointInCourt,
  isPointInServiceBox,
  stepTennisBall,
  type TennisBallState,
} from '../src/game/tennis/TennisPhysics';

function simulateUntilFirstBounce(
  ball: TennisBallState,
  courtMode: 'singles' | 'doubles' = 'singles'
) {
  let minNetClearance = Infinity;
  let bouncePos: { x: number; y: number; z: number } | null = null;
  const allEvents: ReturnType<typeof stepTennisBall> = [];

  for (let i = 0; i < 300 && ball.active; i++) {
    const prevZ = ball.pos.z;
    const evs = stepTennisBall(ball, 1 / 60, courtMode);
    allEvents.push(...evs);
    if ((prevZ > 0 && ball.pos.z <= 0) || (prevZ < 0 && ball.pos.z >= 0)) {
      minNetClearance = Math.min(minNetClearance, ball.pos.y - NET_CENTER_HEIGHT);
    }
    const b = evs.find((e) => e.kind === 'bounce');
    if (b && b.kind === 'bounce' && !bouncePos) {
      bouncePos = b.pos;
      break;
    }
  }
  return { bouncePos, minNetClearance, events: allEvents };
}

describe('Tennis 3D Ballistics & Line Calling Physics', () => {
  it('guided shot solver clears the net and lands in-bounds for topspin, slice, lob, and serve', () => {
    const shots = ['flat', 'topspin', 'slice', 'lob', 'serve'] as const;
    for (const shotType of shots) {
      const from =
        shotType === 'serve'
          ? { x: 1.55, y: 2.45, z: COURT_HALF_LENGTH + 0.2 }
          : { x: 1.2, y: 0.95, z: 10.6 };

      const launch = computeShotLaunch({
        from,
        hittingTeam: 'near',
        shotType,
        power: 0.72,
        timingOffset: 0,
        aimBias: 0,
        spin: shotType === 'slice' ? -0.7 : 0.65,
        courtMode: 'singles',
        serveSide: 'deuce',
      });

      const ball: TennisBallState = {
        ...createIdleBall(),
        active: true,
        pos: { ...from },
        vel: { ...launch.vel },
        spin: launch.spin,
        shotType,
        isServe: shotType === 'serve',
        serveSide: 'deuce',
        lastHitByTeam: 'near',
      };

      const { bouncePos, events } = simulateUntilFirstBounce(ball, 'singles');
      expect(events.some((e) => e.kind === 'net-hit')).toBe(false);
      expect(bouncePos).not.toBeNull();
      if (bouncePos) {
        if (shotType === 'serve') {
          expect(isPointInServiceBox(bouncePos.x, bouncePos.z, 'near', 'deuce')).toBe(true);
        } else {
          expect(isPointInCourt(bouncePos.x, bouncePos.z, 'far', 'singles')).toBe(true);
        }
      }
    }
  });

  it('gives topspin a higher, faster post-bounce kick than backspin slice', () => {
    const makeBall = (spin: number): TennisBallState => ({
      ...createIdleBall(),
      active: true,
      pos: { x: 0, y: 1.2, z: -4.0 },
      vel: { x: 0, y: -5.0, z: -12.0 },
      spin,
      shotType: spin > 0 ? 'topspin' : 'slice',
      lastHitByTeam: 'near',
    });

    const topBall = makeBall(0.85);
    const sliceBall = makeBall(-0.85);

    simulateUntilFirstBounce(topBall, 'singles');
    simulateUntilFirstBounce(sliceBall, 'singles');

    expect(topBall.vel.y).toBeGreaterThan(sliceBall.vel.y);
    expect(Math.abs(topBall.vel.z)).toBeGreaterThan(Math.abs(sliceBall.vel.z));
  });

  it('enforces singles vs doubles sideline widths accurately', () => {
    const alleyX = (SINGLES_HALF_WIDTH + DOUBLES_HALF_WIDTH) * 0.5; // ~4.80m inside doubles alley
    expect(isPointInCourt(alleyX, -6.0, 'far', 'singles')).toBe(false);
    expect(isPointInCourt(alleyX, -6.0, 'far', 'doubles')).toBe(true);
  });

  it('detects serve faults and LET when a clipped serve lands inside the service box', () => {
    // Wide serve outside deuce service box -> serve-fault
    const faultBall: TennisBallState = {
      ...createIdleBall(),
      active: true,
      pos: { x: 1.5, y: 1.5, z: -3.0 }, // positive x on far side is wrong box for near deuce serve!
      vel: { x: 0, y: -8, z: -4 },
      isServe: true,
      serveSide: 'deuce',
      lastHitByTeam: 'near',
      crossedNet: true,
    };
    const faultOut = simulateUntilFirstBounce(faultBall, 'singles');
    expect(faultOut.events.some((e) => e.kind === 'serve-fault')).toBe(true);

    // Clipped serve landing inside valid deuce box -> LET
    const letBall: TennisBallState = {
      ...createIdleBall(),
      active: true,
      pos: { x: -1.6, y: 1.0, z: -3.2 },
      vel: { x: 0, y: -6, z: -3 },
      isServe: true,
      serveSide: 'deuce',
      lastHitByTeam: 'near',
      crossedNet: true,
      clippedNet: true,
    };
    const letOut = simulateUntilFirstBounce(letBall, 'singles');
    expect(letOut.events.some((e) => e.kind === 'let')).toBe(true);
  });

  it('emits double-bounce winner when ball bounces twice on opponent side', () => {
    const ball: TennisBallState = {
      ...createIdleBall(),
      active: true,
      pos: { x: 0, y: BALL_RADIUS + 0.5, z: -5.0 },
      vel: { x: 0, y: -4.0, z: -2.0 },
      lastHitByTeam: 'near',
      crossedNet: true,
    };

    const events: ReturnType<typeof stepTennisBall> = [];
    for (let i = 0; i < 200 && ball.active; i++) {
      events.push(...stepTennisBall(ball, 1 / 60, 'singles'));
    }
    const db = events.find((e) => e.kind === 'double-bounce');
    expect(db).toBeDefined();
    if (db && db.kind === 'double-bounce') {
      expect(db.winner).toBe('near');
    }
  });
});

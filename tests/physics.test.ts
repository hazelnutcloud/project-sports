import { describe, expect, it } from 'vitest';
import {
  BowlingPhysicsWorld,
  DECK_END_Z,
  HEAD_PIN_Z,
  PIN_REST_Y,
  getLaneCenterX,
} from '../src/game/PhysicsWorld';

describe('Rapier3D BowlingPhysicsWorld', () => {
  it('knocks down pins cleanly on a centered pocket throw without tunneling', async () => {
    const world = await BowlingPhysicsWorld.create();
    const laneIdx = 2;

    // Pocket hook shot entering the 1-3 pocket at healthy speed
    world.launchBall(laneIdx, {
      xOffset: 0.24,
      aimAngle: 0.005,
      speed: 11.8,
      spin: -0.2,
      loft: 0.16,
    });

    let hitPin = false;
    for (let step = 0; step < 300; step++) {
      const events = world.step(1 / 60);
      if (events.some((e) => e.laneIndex === laneIdx && e.kind === 'pin-impact')) {
        hitPin = true;
      }
      if (world.isRollSettled(laneIdx)) break;
    }

    const standing = world.evaluateStandingPins(laneIdx);
    expect(hitPin).toBe(true);
    expect(standing.length).toBeLessThanOrEqual(3);
    world.dispose();
  });

  it('applies measurable lateral hook curvature on spin throws', async () => {
    const world = await BowlingPhysicsWorld.create();
    const laneLeft = 1;
    const laneRight = 3;

    world.launchBall(laneLeft, {
      xOffset: 0,
      aimAngle: 0,
      speed: 10.0,
      spin: -0.85, // strong left hook
      loft: 0.15,
    });
    world.launchBall(laneRight, {
      xOffset: 0,
      aimAngle: 0,
      speed: 10.0,
      spin: 0.85, // strong right hook
      loft: 0.15,
    });

    // Step ~1.4 seconds down the lane (before hitting pins)
    for (let i = 0; i < 84; i++) {
      world.step(1 / 60);
    }

    const leftLocalX =
      world.getLaneState(laneLeft).ballPose.x - getLaneCenterX(laneLeft);
    const rightLocalX =
      world.getLaneState(laneRight).ballPose.x - getLaneCenterX(laneRight);

    expect(leftLocalX).toBeLessThan(-0.15);
    expect(rightLocalX).toBeGreaterThan(0.15);
    world.dispose();
  });

  it('skids straight in the front oil and arcs back sharply on the dry backend instead of kicking sideways at launch', async () => {
    const world = await BowlingPhysicsWorld.create();
    const laneIdx = 2;
    const cx = getLaneCenterX(laneIdx);
    world.resetPins(laneIdx, []);

    // Aim slightly RIGHT down the lane with a strong LEFT hook:
    // True curved bowling physics must move OUT to the right through the front oil,
    // hit a breakpoint near mid-lane, and bend back LEFT across the dry backend!
    world.launchBall(laneIdx, {
      xOffset: 0.2,
      aimAngle: 0.022,
      speed: 11.2,
      spin: -0.8,
      loft: 0.22,
    });

    let xAt6m: number | null = null;
    let xAt10m: number | null = null;
    let xAt17m: number | null = null;
    let maxRightX = -Infinity;

    for (let i = 0; i < 200; i++) {
      world.step(1 / 60);
      const p = world.getLaneState(laneIdx).ballPose;
      const lx = p.x - cx;
      if (lx > maxRightX) maxRightX = lx;
      if (xAt6m === null && p.z <= -6.0) xAt6m = lx;
      if (xAt10m === null && p.z <= -10.0) xAt10m = lx;
      if (xAt17m === null && p.z <= -17.0) {
        xAt17m = lx;
        break;
      }
    }

    expect(xAt6m).not.toBeNull();
    expect(xAt10m).not.toBeNull();
    expect(xAt17m).not.toBeNull();
    // Ball must travel OUT to the right past startX=0.20 in the front oil zone
    expect(xAt6m!).toBeGreaterThan(0.28);
    expect(maxRightX).toBeGreaterThan(0.32);
    // Then curve decisively back LEFT on the dry backend (non-monotonic curved path!)
    expect(xAt17m!).toBeLessThan(maxRightX - 0.25);
    expect(xAt17m!).toBeLessThan(0.15);
    world.dispose();
  });

  it('keeps zero-spin angled shots dead straight without spurious lateral drift', async () => {
    const world = await BowlingPhysicsWorld.create();
    const laneIdx = 2;
    const cx = getLaneCenterX(laneIdx);
    world.resetPins(laneIdx, []);

    const aimAngle = 0.025;
    const xOffset = -0.15;
    world.launchBall(laneIdx, {
      xOffset,
      aimAngle,
      speed: 11.0,
      spin: 0,
      loft: 0.2,
    });

    let finalX = 0;
    let finalZ = 0;
    for (let i = 0; i < 180; i++) {
      world.step(1 / 60);
      const p = world.getLaneState(laneIdx).ballPose;
      if (p.z <= HEAD_PIN_Z + 0.5) {
        finalX = p.x - cx;
        finalZ = p.z;
        break;
      }
    }

    const expectedX = xOffset + Math.tan(aimAngle) * (-finalZ - 0.12);
    expect(Math.abs(finalX - expectedX)).toBeLessThan(0.015);
    world.dispose();
  });

  it('catches extreme wide throws in the gutter cleanly', async () => {
    const world = await BowlingPhysicsWorld.create();
    const laneIdx = 2;

    world.launchBall(laneIdx, {
      xOffset: 0.4,
      aimAngle: 0.16,
      speed: 9.5,
      spin: 0.2,
      loft: 0.1,
    });

    let enteredGutter = false;
    for (let i = 0; i < 180; i++) {
      const events = world.step(1 / 60);
      if (events.some((e) => e.laneIndex === laneIdx && e.kind === 'gutter-enter')) {
        enteredGutter = true;
      }
      if (world.isRollSettled(laneIdx)) break;
    }

    expect(enteredGutter).toBe(true);
    expect(world.evaluateStandingPins(laneIdx)).toHaveLength(10);
    world.dispose();
  });

  it('absorbs high-speed ball impacts at the back curtain without bouncing back into pins', async () => {
    const world = await BowlingPhysicsWorld.create();
    const laneIdx = 2;

    // Leave only the 7 and 10 pins (indices 6 and 9) and fire a max-speed ball straight down the center into the back wall
    world.resetPins(laneIdx, [6, 9]);
    world.launchBall(laneIdx, {
      xOffset: 0,
      aimAngle: 0,
      speed: 14.5,
      spin: 0,
      loft: 0.1,
    });

    let enteredPit = false;
    let maxZAfterPit = -Infinity;

    for (let i = 0; i < 240; i++) {
      world.step(1 / 60);
      const state = world.getLaneState(laneIdx);
      if (state.inPit) {
        enteredPit = true;
        if (state.ballPose.z > maxZAfterPit) {
          maxZAfterPit = state.ballPose.z;
        }
      }
    }

    expect(enteredPit).toBe(true);
    // Ball must stay trapped in the pit and never rebound back onto the pin deck
    expect(maxZAfterPit).toBeLessThan(DECK_END_Z + 0.01);
    expect(world.evaluateStandingPins(laneIdx)).toEqual([6, 9]);
    world.dispose();
  });

  it('lifts standing pins and physically sweeps fallen pins backward during preserve-standing clearing', async () => {
    const world = await BowlingPhysicsWorld.create();
    const laneIdx = 2;

    // Throw an off-center shot so some pins fall and some remain standing
    world.launchBall(laneIdx, {
      xOffset: -0.22,
      aimAngle: -0.01,
      speed: 9.2,
      spin: 0.0,
      loft: 0.1,
    });

    for (let i = 0; i < 360; i++) {
      world.step(1 / 60);
      if (world.isRollSettled(laneIdx)) break;
    }

    const standing = world.evaluateStandingPins(laneIdx);
    expect(standing.length).toBeGreaterThan(0);
    expect(standing.length).toBeLessThan(10);
    const fallenIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(
      (id) => !standing.includes(id)
    );

    world.startClearing(laneIdx, 'preserve-standing', standing);
    expect(world.isClearing(laneIdx)).toBe(true);

    let standingWasRaisedDuringSweep = false;
    let fallenMovedBackDuringSweep = false;

    for (let i = 0; i < 220; i++) {
      world.step(1 / 60);
      const state = world.getLaneState(laneIdx);

      if (state.clearing.phase === 'sweep-back') {
        const allStandingHigh = standing.every((id) => {
          const p = state.pinPoses[id];
          return p !== null && p.y > 0.5;
        });
        if (allStandingHigh) {
          standingWasRaisedDuringSweep = true;
        }
        const anyFallenPushedToPit = fallenIds.some((id) => {
          const p = state.pinPoses[id];
          return p !== null && p.z < DECK_END_Z;
        });
        if (anyFallenPushedToPit) {
          fallenMovedBackDuringSweep = true;
        }
      }

      if (!world.isClearing(laneIdx)) break;
    }

    expect(world.isClearing(laneIdx)).toBe(false);
    expect(standingWasRaisedDuringSweep).toBe(true);
    expect(fallenMovedBackDuringSweep).toBe(true);

    // After clearing finishes, only the preserved standing pins remain upright on the deck
    const finalState = world.getLaneState(laneIdx);
    for (let i = 0; i < 10; i++) {
      if (standing.includes(i)) {
        expect(finalState.pinPoses[i]).not.toBeNull();
        expect(finalState.pinPoses[i]!.y).toBeCloseTo(PIN_REST_Y, 1);
      } else {
        expect(finalState.pinPoses[i]).toBeNull();
      }
    }
    expect(world.evaluateStandingPins(laneIdx)).toEqual(standing);
    world.dispose();
  });

  it('sweeps all remaining pins and lowers a fresh 10-pin rack during full-reset clearing', async () => {
    const world = await BowlingPhysicsWorld.create();
    const laneIdx = 2;

    // Simulate end-of-frame open Roll 2 where pins 6 and 9 are still standing
    world.resetPins(laneIdx, [6, 9]);
    world.startClearing(laneIdx, 'full-reset', []);

    let leftoverPinsSweptIntoPit = false;
    for (let i = 0; i < 200; i++) {
      world.step(1 / 60);
      const state = world.getLaneState(laneIdx);
      if (state.clearing.phase === 'sweep-back') {
        const p6 = state.pinPoses[6];
        const p9 = state.pinPoses[9];
        if (p6 && p9 && p6.z < DECK_END_Z && p9.z < DECK_END_Z) {
          leftoverPinsSweptIntoPit = true;
        }
      }
      if (!world.isClearing(laneIdx)) break;
    }

    expect(world.isClearing(laneIdx)).toBe(false);
    expect(leftoverPinsSweptIntoPit).toBe(true);
    expect(world.evaluateStandingPins(laneIdx)).toHaveLength(10);
    world.dispose();
  });
});

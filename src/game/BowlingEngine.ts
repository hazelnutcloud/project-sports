import * as THREE from 'three';
import type {
  AimState,
  ArmPoseState,
  BallColorId,
  LaneSnapshot,
  MatchPhase,
  PlayerProfile,
  ThrowParams,
} from '../types/game';
import {
  BowlingPhysicsWorld,
  LANE_COUNT,
  type ClearingMode,
  type ClearingPhase,
} from './PhysicsWorld';
import { buildSpoccoAlley, type SpoccoSceneRefs } from './SceneBuilder';
import { PinSetVisuals } from './PinSetVisuals';
import { BallVisuals } from './BallVisuals';
import { BowlerAvatar } from './BowlerAvatar';
import { CameraDirector } from './CameraDirector';
import { SoundEngine } from '../audio/SoundEngine';

interface ClearingCompletionPayload {
  pinsKnocked: number;
  standingPinIds: number[];
  isGutter: boolean;
}

interface ActiveLocalRoll {
  playerId: string;
  laneIndex: number;
  color: BallColorId;
  initialStandingCount: number;
  settled: boolean;
  clearingPayload: ClearingCompletionPayload | null;
  lastClearingPhase: ClearingPhase;
}

interface PendingLocalThrow {
  player: PlayerProfile;
  standingPinIds: number[];
  params: ThrowParams;
}

export interface RollOutcomePreview {
  needsFullReset: boolean;
  nextStandingPinIds: number[];
}

export interface BowlingEngineCallbacks {
  onLocalRollSettled: (
    playerId: string,
    pinsKnocked: number,
    standingPinIds: number[],
    isGutter: boolean
  ) => void;
  onLocalLaneSnapshot: (snapshot: LaneSnapshot) => void;
  getRollOutcomePreview?: (
    playerId: string,
    pinsKnocked: number,
    standingPinIds: number[],
    isGutter: boolean
  ) => RollOutcomePreview | null;
}

/**
 * Master Three.js + Rapier3D game engine driving the 5-lane Spocco Square alley.
 */
export class BowlingEngine {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cameraDirector: CameraDirector;
  private readonly physics: BowlingPhysicsWorld;
  private readonly sound: SoundEngine;
  private readonly callbacks: BowlingEngineCallbacks;

  private readonly pinVisuals: PinSetVisuals[] = [];
  private readonly ballVisuals: BallVisuals[] = [];
  private readonly avatar: BowlerAvatar;
  private readonly alleyRefs: SpoccoSceneRefs;

  private rafId: number | null = null;
  private lastFrameMs = 0;
  private snapshotAccum = 0;

  private phase: MatchPhase = 'lobby';
  private activeLocalPlayer: PlayerProfile | null = null;
  private currentAim: AimState = { xOffset: 0, aimAngle: 0 };
  private pendingLocalThrow: PendingLocalThrow | null = null;
  private activeLocalRoll: ActiveLocalRoll | null = null;
  private remoteLaneTimers = new Map<number, number>();
  private resizeObserver: ResizeObserver;

  private constructor(
    container: HTMLElement,
    physics: BowlingPhysicsWorld,
    sound: SoundEngine,
    callbacks: BowlingEngineCallbacks
  ) {
    this.container = container;
    this.physics = physics;
    this.sound = sound;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      48,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      120
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    container.appendChild(this.renderer.domElement);

    this.alleyRefs = buildSpoccoAlley(this.scene, this.renderer);
    this.cameraDirector = new CameraDirector(this.camera);

    for (let i = 0; i < LANE_COUNT; i++) {
      this.pinVisuals.push(new PinSetVisuals(this.scene, i));
      this.ballVisuals.push(new BallVisuals(this.scene, 'purple'));
    }

    this.avatar = new BowlerAvatar(this.scene);
    this.avatar.setMode('hidden');

    this.resizeObserver = new ResizeObserver(() => {
      const w = Math.max(1, this.container.clientWidth);
      const h = Math.max(1, this.container.clientHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
    this.resizeObserver.observe(this.container);

    this.lastFrameMs = performance.now();
    this.loop(this.lastFrameMs);
  }

  public static async create(
    container: HTMLElement,
    sound: SoundEngine,
    callbacks: BowlingEngineCallbacks
  ): Promise<BowlingEngine> {
    const physics = await BowlingPhysicsWorld.create();
    const engine = new BowlingEngine(container, physics, sound, callbacks);
    await Promise.all([engine.avatar.ready, engine.alleyRefs.ready]);
    return engine;
  }

  public setPhase(phase: MatchPhase): void {
    this.phase = phase;
    if (phase !== 'playing') {
      this.pendingLocalThrow = null;
      this.activeLocalRoll = null;
      this.physics.cancelAllClearing();
      this.sound.stopRollLoop();
      this.avatar.setMode('hidden');
      this.cameraDirector.setOverview();
    }
  }

  public isRollInProgress(): boolean {
    return this.pendingLocalThrow !== null || this.activeLocalRoll !== null;
  }

  public prepareTurn(
    player: PlayerProfile | null,
    standingPinIds: number[],
    animateSweep = false
  ): void {
    this.activeLocalPlayer = player;
    if (!player || this.phase !== 'playing') {
      this.pendingLocalThrow = null;
      this.avatar.setMode('hidden');
      this.cameraDirector.setOverview();
      return;
    }

    // Do not interrupt an actively rolling ball, clearing cycle, or in-progress throw animation
    if (
      (this.activeLocalRoll && this.activeLocalRoll.playerId === player.id) ||
      (this.pendingLocalThrow && this.pendingLocalThrow.player.id === player.id)
    ) {
      return;
    }

    this.physics.clearBall(player.laneIndex);
    if (animateSweep) {
      this.physics.startClearing(player.laneIndex, 'full-reset', []);
    } else {
      this.physics.resetPins(player.laneIndex, standingPinIds);
    }
    this.ballVisuals[player.laneIndex]?.setColor(player.color);
    this.ballVisuals[player.laneIndex]?.setVisible(false);

    this.currentAim = { xOffset: 0, aimAngle: 0 };
    this.avatar.setLane(player.laneIndex);
    this.avatar.setColor(player.color);
    this.avatar.setAim(this.currentAim);
    this.avatar.setArmPose({ pitch: 0, roll: 0, holdingGrip: false, phase: 'idle' });
    this.avatar.setMode('aiming');
    this.cameraDirector.setAimShot(player.laneIndex, 0, 0, this.avatar.getWorldPelvisZ());
  }

  public updateAim(aim: AimState): void {
    if (!this.activeLocalPlayer || this.isRollInProgress()) return;
    this.currentAim = aim;
    this.avatar.setAim(aim);
    this.cameraDirector.setAimShot(
      this.activeLocalPlayer.laneIndex,
      aim.xOffset,
      aim.aimAngle,
      this.avatar.getWorldPelvisZ()
    );
  }

  public updateArmPose(pose: ArmPoseState, aim: AimState): void {
    if (!this.activeLocalPlayer || this.isRollInProgress()) return;
    this.currentAim = aim;
    this.avatar.setAim(aim);
    this.avatar.setArmPose(pose);
    this.cameraDirector.setAimShot(
      this.activeLocalPlayer.laneIndex,
      aim.xOffset,
      aim.aimAngle,
      this.avatar.getWorldPelvisZ()
    );
  }

  public launchLocalThrow(
    player: PlayerProfile,
    standingPinIds: number[],
    params: ThrowParams
  ): void {
    if (this.isRollInProgress()) return;
    this.sound.unlock();

    // Ensure standing pins & avatar align cleanly with the throw aim before the approach plays
    this.physics.resetPins(player.laneIndex, standingPinIds);
    this.ballVisuals[player.laneIndex]?.setColor(player.color);
    this.ballVisuals[player.laneIndex]?.clearTrail();

    this.currentAim = { xOffset: params.xOffset, aimAngle: params.aimAngle };
    this.avatar.setLane(player.laneIndex);
    this.avatar.setColor(player.color);
    this.avatar.setAim(this.currentAim);

    const pending: PendingLocalThrow = { player, standingPinIds, params };
    this.pendingLocalThrow = pending;

    this.avatar.playThrowSequence(() => {
      if (this.pendingLocalThrow !== pending) return;
      this.pendingLocalThrow = null;

      this.sound.playBallLanding(params.speed);
      this.physics.launchBall(player.laneIndex, params);

      this.activeLocalRoll = {
        playerId: player.id,
        laneIndex: player.laneIndex,
        color: player.color,
        initialStandingCount: standingPinIds.length,
        settled: false,
        clearingPayload: null,
        lastClearingPhase: 'idle',
      };
      this.cameraDirector.startFollow(player.laneIndex);
    });
  }

  public applyRemoteLaneSnapshot(snapshot: LaneSnapshot): void {
    const idx = snapshot.laneIndex;
    if (idx < 0 || idx >= LANE_COUNT) return;
    // Ignore snapshots for our own active rolling lane
    if (this.activeLocalRoll && this.activeLocalRoll.laneIndex === idx) return;

    this.remoteLaneTimers.set(idx, performance.now());
    this.pinVisuals[idx].syncFromTupleArray(snapshot.pins);
    this.pinVisuals[idx].syncClearing(snapshot.clearing);
    const ballVis = this.ballVisuals[idx];
    ballVis.setColor(snapshot.color);
    ballVis.sync(
      snapshot.ballActive,
      {
        x: snapshot.ballPos[0],
        y: snapshot.ballPos[1],
        z: snapshot.ballPos[2],
        qx: snapshot.ballQuat[0],
        qy: snapshot.ballQuat[1],
        qz: snapshot.ballQuat[2],
        qw: snapshot.ballQuat[3],
      },
      snapshot.ballSpin,
      snapshot.ballActive ? 9 : 0,
      0.033
    );
  }

  public dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingLocalThrow = null;
    this.activeLocalRoll = null;
    this.avatar.dispose();
    this.alleyRefs.dispose();
    this.resizeObserver.disconnect();
    this.sound.stopRollLoop();
    this.physics.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private loop = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.loop);

    const rawDt = Math.min(0.05, Math.max(0.001, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;

    const timeScale = this.cameraDirector.update(rawDt);
    const simDt = rawDt * timeScale;

    const events = this.physics.step(simDt);
    for (const ev of events) {
      if (this.activeLocalRoll && ev.laneIndex === this.activeLocalRoll.laneIndex) {
        if (ev.kind === 'pin-impact') {
          this.sound.playPinHit(ev.intensity);
          if (!ev.duringClearing && !this.activeLocalRoll.settled) {
            this.ballVisuals[ev.laneIndex].spawnImpactSparks(ev.position, 14);
          }
        } else if (ev.kind === 'gutter-enter') {
          this.sound.playGutterThud();
        }
      }
    }

    this.avatar.update(rawDt);

    // Gently track camera forward behind the bowler during the 4-step approach windup
    if (this.pendingLocalThrow) {
      this.cameraDirector.setAimShot(
        this.pendingLocalThrow.player.laneIndex,
        this.pendingLocalThrow.params.xOffset,
        this.pendingLocalThrow.params.aimAngle,
        this.avatar.getWorldPelvisZ()
      );
    }

    for (let i = 0; i < LANE_COUNT; i++) {
      // Skip overwriting lanes currently driven by a remote WebRTC peer
      const remoteTs = this.remoteLaneTimers.get(i);
      if (remoteTs && nowMs - remoteTs < 2500 && this.activeLocalRoll?.laneIndex !== i) {
        continue;
      }

      const laneState = this.physics.getLaneState(i);
      this.pinVisuals[i].syncFromPoses(laneState.pinPoses);
      this.pinVisuals[i].syncClearing(laneState.clearing);
      this.ballVisuals[i].sync(
        laneState.ballActive,
        laneState.ballPose,
        laneState.ballSpin,
        laneState.ballSpeed,
        simDt
      );

      if (this.activeLocalRoll && this.activeLocalRoll.laneIndex === i) {
        const roll = this.activeLocalRoll;

        if (!roll.settled) {
          this.cameraDirector.updateBallTracking(
            laneState.ballPose,
            laneState.ballSpeed,
            laneState.inGutter
          );
          this.sound.updateRollLoop(
            laneState.ballSpeed,
            laneState.ballActive && !laneState.inPit && !laneState.inGutter
          );
        } else if (laneState.clearing.phase !== roll.lastClearingPhase) {
          roll.lastClearingPhase = laneState.clearing.phase;
          if (
            laneState.clearing.phase === 'lift-standing' ||
            laneState.clearing.phase === 'lower-pins'
          ) {
            this.sound.playPinsetterCycle(0.32);
          } else if (laneState.clearing.phase === 'sweep-back') {
            this.sound.playSweeperSweep(0.54);
          }
        }

        // Broadcast lane physics snapshot at ~25Hz to remote displays
        this.snapshotAccum += rawDt;
        if (this.snapshotAccum >= 0.04) {
          this.snapshotAccum = 0;
          this.emitLaneSnapshot(roll, laneState);
        }

        if (!roll.settled && this.physics.isRollSettled(i)) {
          this.finishActiveRoll(roll, laneState.inGutter);
        } else if (roll.settled && roll.clearingPayload && !this.physics.isClearing(i)) {
          // Clearing cycle complete: broadcast final settled state and hand back turn control
          const payload = roll.clearingPayload;
          this.emitLaneSnapshot(roll, laneState);
          this.activeLocalRoll = null;
          this.callbacks.onLocalRollSettled(
            roll.playerId,
            payload.pinsKnocked,
            payload.standingPinIds,
            payload.isGutter
          );
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  private finishActiveRoll(roll: ActiveLocalRoll, inGutter: boolean): void {
    roll.settled = true;
    this.sound.stopRollLoop();

    const standingPinIds = this.physics.evaluateStandingPins(roll.laneIndex);
    const pinsKnocked = Math.max(0, roll.initialStandingCount - standingPinIds.length);

    const preview = this.callbacks.getRollOutcomePreview?.(
      roll.playerId,
      pinsKnocked,
      standingPinIds,
      inGutter
    );
    const clearingMode: ClearingMode = preview
      ? preview.needsFullReset
        ? 'full-reset'
        : 'preserve-standing'
      : standingPinIds.length === 0
        ? 'full-reset'
        : 'preserve-standing';

    roll.clearingPayload = {
      pinsKnocked,
      standingPinIds,
      isGutter: inGutter,
    };

    this.cameraDirector.setClearingShot(roll.laneIndex);
    this.physics.startClearing(roll.laneIndex, clearingMode, standingPinIds);
    roll.lastClearingPhase = 'guard-drop';
    this.sound.playPinsetterCycle(0.28);

    const stateAfterStart = this.physics.getLaneState(roll.laneIndex);
    this.emitLaneSnapshot(roll, stateAfterStart);
  }

  private emitLaneSnapshot(
    roll: ActiveLocalRoll,
    laneState: ReturnType<BowlingPhysicsWorld['getLaneState']>
  ): void {
    const bp = laneState.ballPose;
    const c = laneState.clearing;
    const snapshot: LaneSnapshot = {
      playerId: roll.playerId,
      laneIndex: roll.laneIndex,
      color: roll.color,
      ballActive: laneState.ballActive,
      ballPos: [bp.x, bp.y, bp.z],
      ballQuat: [bp.qx, bp.qy, bp.qz, bp.qw],
      ballSpin: laneState.ballSpin,
      pins: laneState.pinPoses.map((p) =>
        p ? [p.x, p.y, p.z, p.qx, p.qy, p.qz, p.qw] : null
      ),
      clearing: {
        sweeperY: c.sweeperY,
        sweeperZ: c.sweeperZ,
        setterVisible: c.setterVisible,
        setterY: c.setterY,
        setterZOffset: c.setterZOffset,
        grippedPinIds: c.grippedPinIds,
      },
    };
    this.callbacks.onLocalLaneSnapshot(snapshot);
  }
}

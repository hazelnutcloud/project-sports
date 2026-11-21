import * as THREE from 'three';
import type { BallColorId, MatchPhase } from '../../types/game';
import type {
  TennisAvatarSnapshot,
  TennisCalloutType,
  TennisCourtMode,
  TennisCourtSlot,
  TennisDifficulty,
  TennisMatchState,
  TennisRacketPose,
  TennisRallyPhase,
  TennisShotType,
  TennisSlotId,
  TennisStateSnapshot,
  TennisSwingInput,
  TennisTeamId,
} from '../../types/tennis';
import type { TennisPointReason } from '../../rules/tennisScoring';
import { otherTeam } from '../../rules/tennisScoring';
import {
  COURT_HALF_LENGTH,
  computeShotLaunch,
  createIdleBall,
  getServerStartPosition,
  predictBallIntercept,
  stepTennisBall,
  type BallInterceptPrediction,
  type TennisBallState,
} from './TennisPhysics';
import {
  AI_DIFFICULTY_PROFILES,
  computeAutoRunTarget,
  decideAiReturnSwing,
  getHomeCourtPosition,
  selectResponsibleSlot,
  stepActorMovement,
  type CourtActorState,
} from './TennisAI';
import { buildSpoccoTennisStadium, type TennisSceneRefs } from './TennisSceneBuilder';
import { TennisAvatar } from './TennisAvatar';
import { TennisBallVisuals } from './TennisBallVisuals';
import { TennisCameraDirector } from './TennisCameraDirector';
import { SoundEngine } from '../../audio/SoundEngine';

export interface TennisEngineCallbacks {
  onPointResolved: (winner: TennisTeamId, reason: TennisPointReason, rallyLength: number) => void;
  onServeFault: () => void;
  onRallyCallout: (callout: TennisCalloutType, subtitle?: string) => void;
  onRallyPhaseChange: (phase: TennisRallyPhase, rallyCount: number) => void;
  onLocalSnapshot: (snapshot: TennisStateSnapshot) => void;
  onPlayerHitHaptic: (playerId: string, isPowerShot: boolean) => void;
}

interface InternalActor extends CourtActorState {
  name: string;
  color: BallColorId;
  facingY: number;
  runSpeed: number;
  swingKind: TennisAvatarSnapshot['swingKind'];
  swingTimer: number;
  swingDuration: number;
  racketPitch: number;
  racketRoll: number;
  aiSwingReadyAt: number;
  aiHasSwungForShot: boolean;
}

const SERVE_TOSS_DURATION = 1.05; // seconds from toss launch back to waist drop
const SERVE_APEX_TIME = 0.52;
const SERVE_APEX_HEIGHT = 2.68;
const SERVE_START_HEIGHT = 1.15;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class TennisEngine {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cameraDirector: TennisCameraDirector;
  private readonly stadiumRefs: TennisSceneRefs;
  private readonly ballVisuals: TennisBallVisuals;
  private readonly sound: SoundEngine;
  private readonly callbacks: TennisEngineCallbacks;

  private readonly avatars = new Map<TennisSlotId, TennisAvatar>();
  private actors = new Map<TennisSlotId, InternalActor>();
  private manualNudgeByPlayer = new Map<string, number>();

  private rafId: number | null = null;
  private lastFrameMs = 0;
  private snapshotAccum = 0;
  private resizeObserver: ResizeObserver;

  private isAuthoritative = true;
  private matchPhase: MatchPhase = 'lobby';
  private courtMode: TennisCourtMode = 'singles';
  private difficulty: TennisDifficulty = 'pro';
  private servingTeam: TennisTeamId = 'near';
  private servingSlot: TennisSlotId = 'near-back';
  private serveSide: 'deuce' | 'ad' = 'deuce';

  private rallyPhase: TennisRallyPhase = 'waiting-serve';
  private ball: TennisBallState = createIdleBall();
  private prediction: BallInterceptPrediction | null = null;
  private rallyCount = 0;
  private shotSequenceId = 0;
  private lastHitTimeMs = 0;

  // Serve toss state
  private serveTossElapsed = 0;
  private aiServeTriggerTimer = 0;
  private pointResetTimer = 0;
  private remoteSnapshotTs = 0;
  private showcaseFrozen = false;
  private debugHandle: unknown = null;

  private constructor(
    container: HTMLElement,
    sound: SoundEngine,
    callbacks: TennisEngineCallbacks
  ) {
    this.container = container;
    this.sound = sound;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      46,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      160
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.stadiumRefs = buildSpoccoTennisStadium(this.scene, this.renderer);
    this.ballVisuals = new TennisBallVisuals(this.scene);
    this.cameraDirector = new TennisCameraDirector(this.camera);

    this.registerDebugHandle();

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
    callbacks: TennisEngineCallbacks
  ): Promise<TennisEngine> {
    const engine = new TennisEngine(container, sound, callbacks);
    await engine.stadiumRefs.ready;
    return engine;
  }

  public syncMatchState(state: TennisMatchState, isHost: boolean): void {
    const prevPhase = this.matchPhase;
    const prevPointsTotal =
      this.servingSlot !== state.score.servingSlot ||
      this.serveSide !== state.score.serveSide ||
      this.servingTeam !== state.score.servingTeam;

    this.isAuthoritative = isHost;
    this.matchPhase = state.phase;
    this.courtMode = state.config.courtMode;
    this.difficulty = state.config.difficulty;
    this.servingTeam = state.score.servingTeam;
    this.servingSlot = state.score.servingSlot;
    this.serveSide = state.score.serveSide;

    this.syncActorsFromSlots(state.slots);

    if (state.phase === 'lobby') {
      this.ball.active = false;
      this.ballVisuals.clearTrail();
      this.setRallyPhase('waiting-serve');
      this.cameraDirector.setOverview();
      return;
    }

    if (state.phase === 'finished') {
      this.ball.active = false;
      this.setRallyPhase('match-over');
      if (state.score.winnerTeam) {
        for (const actor of this.actors.values()) {
          if (actor.team === state.score.winnerTeam) {
            actor.swingKind = 'celebrate';
            actor.swingTimer = 0;
            actor.swingDuration = 2.4;
          }
        }
      }
      this.cameraDirector.setOverview();
      return;
    }

    // Playing phase
    if (prevPhase !== 'playing') {
      this.prepareServePoint();
    } else if (prevPointsTotal && this.rallyPhase === 'point-over') {
      // Wait for brief pointResetTimer to finish before preparing next serve
    }
  }

  public setManualNudge(playerId: string, nudgeX: number): void {
    this.manualNudgeByPlayer.set(playerId, clamp(nudgeX, -1, 1));
  }

  public updatePlayerRacketPose(playerId: string, pose: TennisRacketPose): void {
    for (const actor of this.actors.values()) {
      if (actor.playerId === playerId) {
        actor.racketPitch = pose.pitch;
        actor.racketRoll = pose.roll;
      }
    }
  }

  public handleServeToss(playerId: string): boolean {
    if (!this.isAuthoritative || this.matchPhase !== 'playing') return false;
    if (this.rallyPhase !== 'waiting-serve') return false;

    const server = this.actors.get(this.servingSlot);
    if (!server) return false;

    // Allow the serving slot's player (or any human on the serving team in solo/doubles convenience)
    if (!this.canPlayerControlSlot(playerId, server)) return false;

    this.startServeToss();
    return true;
  }

  public handlePlayerSwing(input: TennisSwingInput): boolean {
    if (!this.isAuthoritative || this.matchPhase !== 'playing') return false;

    // Case 1: Serve toss in progress -> strike the serve!
    if (this.rallyPhase === 'serve-toss') {
      const server = this.actors.get(this.servingSlot);
      if (!server || !this.canPlayerControlSlot(input.playerId, server)) return false;
      this.executeServeStrike(server, input);
      return true;
    }

    // Case 2: Waiting to serve -> swinging once gently initiates toss if player didn't press toss first
    if (this.rallyPhase === 'waiting-serve') {
      const server = this.actors.get(this.servingSlot);
      if (server && this.canPlayerControlSlot(input.playerId, server)) {
        this.startServeToss();
        return true;
      }
      return false;
    }

    // Case 3: Active Rally -> find eligible controlled actor on receiving team!
    if (this.rallyPhase !== 'rally' || !this.ball.active) return false;

    const receivingTeam = otherTeam(this.ball.lastHitByTeam);
    const teamActors = this.getTeamActors(receivingTeam);
    const controlled = teamActors.filter((a) => this.canPlayerControlSlot(input.playerId, a));
    if (controlled.length === 0) return false;

    // Pick the closest controlled actor to the ball
    let bestActor = controlled[0];
    let bestDist = Infinity;
    for (const a of controlled) {
      const d = Math.hypot(this.ball.pos.x - a.x, this.ball.pos.z - a.z);
      if (d < bestDist) {
        bestDist = d;
        bestActor = a;
      }
    }

    // Always play visual swing animation so input feels snappy even if early
    const isForehand =
      input.strokeSide === 'overhead'
        ? false
        : bestActor.team === 'near'
          ? this.ball.pos.x >= bestActor.x - 0.15
          : this.ball.pos.x <= bestActor.x + 0.15;

    const swingKind: TennisAvatarSnapshot['swingKind'] =
      input.shotType === 'smash'
        ? 'serve'
        : bestActor.role === 'front' && Math.abs(bestActor.z) < 6.0
          ? 'volley'
          : isForehand
            ? 'forehand'
            : 'backhand';

    bestActor.swingKind = swingKind;
    bestActor.swingTimer = 0;
    bestActor.swingDuration = 0.38;

    // Check strike reach window (generous Switch Sports window so rallies feel fun & rewarding!)
    const nowMs = performance.now();
    if (nowMs - this.lastHitTimeMs < 240) return false;

    const dx = Math.abs(this.ball.pos.x - bestActor.x);
    const dzSigned =
      bestActor.team === 'near'
        ? this.ball.pos.z - bestActor.z
        : bestActor.z - this.ball.pos.z;
    const absDz = Math.abs(dzSigned);

    // Must be on or approaching the receiving half and within racket reach
    const onPlayableHalf =
      bestActor.team === 'near' ? this.ball.pos.z > -1.0 : this.ball.pos.z < 1.0;
    const withinReach = onPlayableHalf && dx <= 2.45 && absDz <= 2.95 && this.ball.pos.y <= 3.35;

    if (!withinReach) {
      return false;
    }

    // Timing offset: negative = swung early (ball still in front of player), positive = swung late (ball past player)
    const timingOffset = clamp(dzSigned / 2.35, -1, 1);
    this.executeRallyStrike(bestActor, input, timingOffset);
    return true;
  }

  public applyRemoteSnapshot(snapshot: TennisStateSnapshot): void {
    if (this.isAuthoritative) return;
    this.remoteSnapshotTs = performance.now();
    this.rallyPhase = snapshot.rallyPhase;
    this.rallyCount = snapshot.rallyCount;

    for (const aSnap of snapshot.avatars) {
      let avatar = this.avatars.get(aSnap.slotId);
      if (!avatar) {
        avatar = new TennisAvatar(this.scene, aSnap.color, aSnap.team, !aSnap.isAi);
        this.avatars.set(aSnap.slotId, avatar);
      }
      avatar.setVisible(true);
      avatar.sync(aSnap, 0.033);
    }

    this.ballVisuals.sync(
      snapshot.ballActive,
      snapshot.ballPos,
      snapshot.ballVel,
      snapshot.ballSpin,
      snapshot.shotType,
      snapshot.isPowerShot,
      snapshot.targetMarker,
      0.033
    );

    if (snapshot.rallyPhase === 'rally' && snapshot.ballActive) {
      this.cameraDirector.setPlayTracking(snapshot.ballPos[0], snapshot.ballPos[2]);
    }
  }

  public getRallyPhase(): TennisRallyPhase {
    return this.rallyPhase;
  }

  public dispose(): void {
    const win = window as unknown as Record<string, unknown>;
    if (this.debugHandle && win.__tennisDebug === this.debugHandle) {
      delete win.__tennisDebug;
    }
    this.debugHandle = null;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const av of this.avatars.values()) {
      av.dispose();
    }
    this.avatars.clear();
    this.ballVisuals.dispose();
    this.stadiumRefs.dispose();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private canPlayerControlSlot(playerId: string, actor: InternalActor): boolean {
    if (actor.playerId === playerId) return true;
    // In 1P Doubles (user controls near-back while near-front is AI), allow user to serve if their team serves,
    // or if no human owns the specific slot on that team, let the team's human control it.
    if (actor.isAi) {
      const teamHasHuman = this.getTeamActors(actor.team).some((a) => a.playerId === playerId);
      if (teamHasHuman && actor.slotId === this.servingSlot) {
        return true;
      }
    }
    return false;
  }

  private syncActorsFromSlots(slots: TennisCourtSlot[]): void {
    const activeIds = new Set(slots.map((s) => s.slotId));

    // Hide/remove avatars no longer in active courtMode
    for (const [slotId, av] of this.avatars.entries()) {
      if (!activeIds.has(slotId)) {
        av.setVisible(false);
        this.actors.delete(slotId);
      }
    }

    for (const slot of slots) {
      let existing = this.actors.get(slot.slotId);
      if (!existing) {
        const home = getHomeCourtPosition(slot.slotId, this.courtMode);
        existing = {
          slotId: slot.slotId,
          team: slot.team,
          role: slot.role,
          isAi: slot.isAi,
          playerId: slot.playerId,
          name: slot.name,
          color: slot.color,
          x: home.x,
          z: home.z,
          vx: 0,
          vz: 0,
          facingY: slot.team === 'near' ? Math.PI : 0,
          runSpeed: 0,
          swingKind: 'none',
          swingTimer: 0,
          swingDuration: 0.35,
          racketPitch: 0,
          racketRoll: 0,
          aiSwingReadyAt: 0,
          aiHasSwungForShot: false,
        };
        this.actors.set(slot.slotId, existing);
      } else {
        existing.isAi = slot.isAi;
        existing.playerId = slot.playerId;
        existing.name = slot.name;
        existing.color = slot.color;
      }

      let avatar = this.avatars.get(slot.slotId);
      if (!avatar) {
        avatar = new TennisAvatar(this.scene, slot.color, slot.team, !slot.isAi);
        this.avatars.set(slot.slotId, avatar);
      }
      avatar.setColor(slot.color);
      avatar.setVisible(true);
    }
  }

  private prepareServePoint(): void {
    this.ball = createIdleBall();
    this.ballVisuals.clearTrail();
    this.prediction = null;
    this.rallyCount = 0;
    this.serveTossElapsed = 0;
    this.pointResetTimer = 0;

    // Position server behind baseline on deuce/ad side and others in legal receiving/doubles positions
    const serverPos = getServerStartPosition(this.servingTeam, this.serveSide);
    const receiverTeam = otherTeam(this.servingTeam);
    const receiverSign = receiverTeam === 'near' ? 1 : -1;
    // Receiver stands diagonally opposite server
    const receiverX = serverPos.x >= 0 ? -2.25 : 2.25;

    for (const actor of this.actors.values()) {
      actor.vx = 0;
      actor.vz = 0;
      actor.swingKind = 'none';
      actor.swingTimer = 0;
      actor.aiHasSwungForShot = false;
      actor.facingY = actor.team === 'near' ? Math.PI : 0;

      if (actor.slotId === this.servingSlot) {
        actor.x = serverPos.x;
        actor.z = serverPos.z;
      } else if (actor.team === this.servingTeam) {
        // Doubles server's partner stands at the net on the opposite half
        actor.x = serverPos.x >= 0 ? -1.85 : 1.85;
        actor.z = (actor.team === 'near' ? 1 : -1) * 3.6;
      } else if (actor.role === 'back') {
        actor.x = receiverX;
        actor.z = receiverSign * (COURT_HALF_LENGTH - 0.2);
      } else {
        // Doubles receiver's net partner stands opposite the returner
        actor.x = -receiverX * 0.72;
        actor.z = receiverSign * 4.4;
      }
    }

    // Hold ball visibly at server's left hand
    this.ball.active = true;
    this.ball.pos = {
      x: serverPos.x + (this.servingTeam === 'near' ? -0.26 : 0.26),
      y: SERVE_START_HEIGHT,
      z: serverPos.z + (this.servingTeam === 'near' ? -0.22 : 0.22),
    };
    this.ball.vel = { x: 0, y: 0, z: 0 };

    this.setRallyPhase('waiting-serve');
    this.cameraDirector.setServeShot(serverPos.x, this.servingTeam);

    // If AI is serving (and no human on that team owns the serve), schedule automatic AI toss
    const serverActor = this.actors.get(this.servingSlot);
    const humanControlsServe =
      serverActor &&
      (!serverActor.isAi ||
        this.getTeamActors(serverActor.team).some((a) => !a.isAi));
    this.aiServeTriggerTimer = humanControlsServe ? 0 : 0.85;
  }

  private startServeToss(): void {
    this.serveTossElapsed = 0;
    this.setRallyPhase('serve-toss');
    this.sound.playServeToss();
  }

  private executeServeStrike(server: InternalActor, input: TennisSwingInput): void {
    // Check toss timing against apex (t = SERVE_APEX_TIME)
    const apexDiff = Math.abs(this.serveTossElapsed - SERVE_APEX_TIME);
    const isPowerServe = apexDiff <= 0.115 && input.power >= 0.52;
    const timingOffset = clamp((this.serveTossElapsed - SERVE_APEX_TIME) / 0.36, -0.85, 0.85);

    const strikePos = {
      x: server.x,
      y: clamp(this.ball.pos.y, 1.85, 2.75),
      z: server.z + (server.team === 'near' ? -0.35 : 0.35),
    };

    const launch = computeShotLaunch({
      from: strikePos,
      hittingTeam: server.team,
      shotType: 'serve',
      power: isPowerServe ? 1.0 : clamp(input.power, 0.35, 0.92),
      timingOffset: isPowerServe ? timingOffset * 0.25 : timingOffset,
      aimBias: input.aimBias,
      spin: input.spin,
      courtMode: this.courtMode,
      serveSide: this.serveSide,
      isPowerShot: isPowerServe,
    });

    this.ball = {
      active: true,
      pos: { ...strikePos },
      vel: { ...launch.vel },
      spin: launch.spin,
      shotType: 'serve',
      isPowerShot: isPowerServe,
      isServe: true,
      serveSide: this.serveSide,
      lastHitByTeam: server.team,
      bouncesOnOpponentSide: 0,
      bouncesOnOwnSide: 0,
      crossedNet: false,
      clippedNet: false,
      flightTime: 0,
    };

    this.rallyCount = 1;
    this.shotSequenceId += 1;
    this.lastHitTimeMs = performance.now();
    this.resetAiSwingFlags();

    server.swingKind = 'serve';
    server.swingTimer = 0;
    server.swingDuration = 0.44;

    this.sound.playRacketHit(isPowerServe ? 1.0 : input.power, 'serve', isPowerServe);
    this.ballVisuals.clearTrail();
    this.ballVisuals.spawnHitSparks(strikePos, isPowerServe ? 0xff453a : 0xffe44d, isPowerServe ? 22 : 12);

    if (server.playerId) {
      this.callbacks.onPlayerHitHaptic(server.playerId, isPowerServe);
    }
    if (isPowerServe) {
      this.callbacks.onRallyCallout('POWER_SERVE', 'ROCKET SERVE!');
    }

    this.prediction = predictBallIntercept(this.ball, this.courtMode);
    this.setRallyPhase('rally');
  }

  private executeRallyStrike(
    actor: InternalActor,
    input: TennisSwingInput,
    timingOffset: number
  ): void {
    // High balls near the net upgrade to overhead SMASH!
    const isSmash =
      input.shotType === 'smash' ||
      (this.ball.pos.y > 1.72 && Math.abs(actor.z) < 6.8 && input.shotType !== 'lob');
    const shotType: TennisShotType = isSmash ? 'smash' : input.shotType;

    const strikePos = {
      x: this.ball.pos.x,
      y: clamp(this.ball.pos.y, 0.55, 2.55),
      z: this.ball.pos.z,
    };

    const launch = computeShotLaunch({
      from: strikePos,
      hittingTeam: actor.team,
      shotType,
      power: clamp(input.power, 0.25, 1),
      timingOffset,
      aimBias: input.aimBias,
      spin: input.spin,
      courtMode: this.courtMode,
      isPowerShot: isSmash || (Math.abs(timingOffset) < 0.16 && input.power > 0.82),
    });

    this.ball = {
      active: true,
      pos: { ...strikePos },
      vel: { ...launch.vel },
      spin: launch.spin,
      shotType,
      isPowerShot: launch.isPowerShot,
      isServe: false,
      serveSide: this.serveSide,
      lastHitByTeam: actor.team,
      bouncesOnOpponentSide: 0,
      bouncesOnOwnSide: 0,
      crossedNet: false,
      clippedNet: false,
      flightTime: 0,
    };

    this.rallyCount += 1;
    this.shotSequenceId += 1;
    this.lastHitTimeMs = performance.now();
    this.resetAiSwingFlags();

    this.sound.playRacketHit(input.power, shotType, launch.isPowerShot);
    this.ballVisuals.clearTrail();
    this.ballVisuals.spawnHitSparks(
      strikePos,
      launch.isPowerShot ? 0xff5a36 : shotType === 'slice' ? 0x38e8ff : 0xf4ff81,
      launch.isPowerShot ? 18 : 10
    );

    if (actor.playerId) {
      this.callbacks.onPlayerHitHaptic(actor.playerId, launch.isPowerShot);
    }
    if (isSmash) {
      this.callbacks.onRallyCallout('SMASH');
    }

    this.prediction = predictBallIntercept(this.ball, this.courtMode);
    this.callbacks.onRallyPhaseChange('rally', this.rallyCount);
  }

  private resetAiSwingFlags(): void {
    const profile = AI_DIFFICULTY_PROFILES[this.difficulty];
    const now = performance.now();
    for (const actor of this.actors.values()) {
      actor.aiHasSwungForShot = false;
      actor.aiSwingReadyAt = now + profile.reactionDelaySec * 1000;
    }
  }

  private getTeamActors(team: TennisTeamId): InternalActor[] {
    const list: InternalActor[] = [];
    for (const a of this.actors.values()) {
      if (a.team === team) list.push(a);
    }
    return list;
  }

  private setRallyPhase(next: TennisRallyPhase): void {
    this.rallyPhase = next;
    this.callbacks.onRallyPhaseChange(next, this.rallyCount);
  }

  private loop = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;

    this.stadiumRefs.update(dt);

    if (this.showcaseFrozen) {
      this.cameraDirector.update(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.matchPhase === 'playing' && this.isAuthoritative) {
      this.updateAuthoritativeSimulation(dt, nowMs);
    } else if (this.matchPhase === 'lobby' || this.matchPhase === 'finished') {
      // Animate lobby / podium idle avatars
      for (const actor of this.actors.values()) {
        if (actor.swingKind !== 'none') {
          actor.swingTimer += dt;
          if (actor.swingTimer >= actor.swingDuration) {
            actor.swingKind = this.matchPhase === 'finished' ? 'celebrate' : 'none';
            actor.swingTimer = 0;
          }
        }
        const av = this.avatars.get(actor.slotId);
        av?.sync(this.serializeActor(actor), dt);
      }
      this.ballVisuals.sync(
        false,
        [0, 1, 0],
        [0, 0, 0],
        0,
        'flat',
        false,
        { visible: false, x: 0, z: 0, urgency: 0, team: 'near' },
        dt
      );
    } else if (!this.isAuthoritative && nowMs - this.remoteSnapshotTs > 2000) {
      // Fallback idle rendering on guest display while waiting for host snapshots
      for (const actor of this.actors.values()) {
        this.avatars.get(actor.slotId)?.sync(this.serializeActor(actor), dt);
      }
    }

    this.cameraDirector.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private updateAuthoritativeSimulation(dt: number, nowMs: number): void {
    // 1. Handle post-point pause before setting up the next serve
    if (this.rallyPhase === 'point-over') {
      this.pointResetTimer -= dt;
      if (this.pointResetTimer <= 0 && this.matchPhase === 'playing') {
        this.prepareServePoint();
      }
    }

    // 2. Handle waiting-serve (AI auto-serve countdown)
    if (this.rallyPhase === 'waiting-serve') {
      const server = this.actors.get(this.servingSlot);
      if (server) {
        this.ball.active = true;
        this.ball.pos = {
          x: server.x + (server.team === 'near' ? -0.26 : 0.26),
          y: SERVE_START_HEIGHT,
          z: server.z + (server.team === 'near' ? -0.22 : 0.22),
        };
      }
      if (this.aiServeTriggerTimer > 0) {
        this.aiServeTriggerTimer -= dt;
        if (this.aiServeTriggerTimer <= 0) {
          this.startServeToss();
        }
      }
    }

    // 3. Handle serve-toss arc
    if (this.rallyPhase === 'serve-toss') {
      this.serveTossElapsed += dt;
      const server = this.actors.get(this.servingSlot);
      if (server) {
        // Parabolic toss peaking at SERVE_APEX_TIME
        const norm = this.serveTossElapsed / SERVE_TOSS_DURATION;
        const height =
          SERVE_START_HEIGHT +
          (SERVE_APEX_HEIGHT - SERVE_START_HEIGHT) * 4 * norm * (1 - norm);
        this.ball.active = true;
        this.ball.pos = {
          x: server.x + (server.team === 'near' ? 0.14 : -0.14),
          y: Math.max(SERVE_START_HEIGHT, height),
          z: server.z + (server.team === 'near' ? -0.32 : 0.32),
        };

        // AI strikes right near apex
        const humanOwnsServe =
          !server.isAi || this.getTeamActors(server.team).some((a) => !a.isAi);
        if (!humanOwnsServe) {
          const profile = AI_DIFFICULTY_PROFILES[this.difficulty];
          const desiredStrikeT =
            SERVE_APEX_TIME + (Math.random() < profile.powerServeChance ? 0.0 : 0.08);
          if (this.serveTossElapsed >= desiredStrikeT) {
            this.executeServeStrike(server, {
              playerId: server.slotId,
              strokeSide: 'overhead',
              shotType: 'serve',
              power: profile.powerMin + Math.random() * (profile.powerMax - profile.powerMin),
              aimBias: (Math.random() * 2 - 1) * 0.65 * profile.aimAccuracy,
              spin: 0.4,
              timestampMs: nowMs,
            });
          }
        }
      }

      // If human doesn't swing, toss resets smoothly back to hand (Switch Sports friendly!)
      if (this.serveTossElapsed >= SERVE_TOSS_DURATION) {
        this.serveTossElapsed = 0;
        this.setRallyPhase('waiting-serve');
      }
    }

    // 4. Active Rally physics + Auto-Run + AI returns
    if (this.rallyPhase === 'rally' && this.ball.active) {
      const events = stepTennisBall(this.ball, dt, this.courtMode);
      for (const ev of events) {
        if (ev.kind === 'bounce') {
          this.sound.playTennisBounce(ev.speed);
          this.ballVisuals.spawnBounceRing(ev.pos.x, ev.pos.z, ev.inBounds);
          // Recompute refined strike prediction right after bounce
          if (this.ball.active) {
            this.prediction = predictBallIntercept(this.ball, this.courtMode);
          }
        } else if (ev.kind === 'net-hit' || ev.kind === 'net-cord') {
          this.sound.playNetHit();
          this.stadiumRefs.triggerNetRipple(ev.kind === 'net-hit' ? 1.4 : 0.7);
        } else if (ev.kind === 'let') {
          this.callbacks.onRallyCallout('LET', 'Replay Serve');
          this.pointResetTimer = 1.25;
          this.setRallyPhase('point-over');
        } else if (ev.kind === 'serve-fault') {
          this.pointResetTimer = 1.45;
          this.setRallyPhase('point-over');
          this.callbacks.onServeFault();
        } else if (ev.kind === 'out') {
          const winner = otherTeam(ev.lastHitBy);
          this.finishPoint(winner, 'out');
        } else if (ev.kind === 'net-fault') {
          const winner = otherTeam(ev.lastHitBy);
          this.finishPoint(winner, 'net');
        } else if (ev.kind === 'double-bounce') {
          const reason: TennisPointReason =
            this.ball.isServe && this.rallyCount === 1 ? 'ace' : 'double-bounce';
          this.finishPoint(ev.winner, reason);
        }
      }

      if (this.ball.active) {
        this.cameraDirector.setPlayTracking(this.ball.pos.x, this.ball.pos.z);
        this.updateAutoRunAndAi(dt, nowMs);
      }
    } else if (this.rallyPhase === 'point-over') {
      // Gently let actors decelerate during celebration
      for (const actor of this.actors.values()) {
        actor.vx *= Math.exp(-8 * dt);
        actor.vz *= Math.exp(-8 * dt);
        actor.runSpeed = Math.hypot(actor.vx, actor.vz);
      }
    }

    // 5. Advance swing animation timers & sync 3D avatars
    for (const actor of this.actors.values()) {
      if (actor.swingKind !== 'none') {
        actor.swingTimer += dt;
        if (actor.swingTimer >= actor.swingDuration) {
          actor.swingKind = 'none';
          actor.swingTimer = 0;
        }
      }
      this.avatars.get(actor.slotId)?.sync(this.serializeActor(actor), dt);
    }

    // 6. Sync ball visuals & sweet-spot floor timing indicator
    const targetMarker = this.computeTargetMarker();
    this.ballVisuals.sync(
      this.ball.active,
      [this.ball.pos.x, this.ball.pos.y, this.ball.pos.z],
      [this.ball.vel.x, this.ball.vel.y, this.ball.vel.z],
      this.ball.spin,
      this.ball.shotType,
      this.ball.isPowerShot,
      targetMarker,
      dt
    );

    // 7. Broadcast snapshot at ~25Hz to remote displays
    this.snapshotAccum += dt;
    if (this.snapshotAccum >= 0.04) {
      this.snapshotAccum = 0;
      this.callbacks.onLocalSnapshot(this.buildSnapshot(targetMarker));
    }
  }

  private updateAutoRunAndAi(dt: number, nowMs: number): void {
    const receivingTeam = otherTeam(this.ball.lastHitByTeam);

    for (const team of ['near', 'far'] as const) {
      const teamActors = this.getTeamActors(team);
      const responsible =
        team === receivingTeam
          ? selectResponsibleSlot(teamActors, this.prediction, this.ball)
          : null;

      for (const actor of teamActors) {
        const manualNudge = actor.playerId
          ? this.manualNudgeByPlayer.get(actor.playerId) ?? 0
          : 0;
        const target = computeAutoRunTarget(
          actor,
          responsible,
          this.prediction,
          this.ball,
          this.courtMode,
          manualNudge
        );
        actor.runSpeed = stepActorMovement(actor, target, dt, this.difficulty);

        // Smoothly face net / ball
        const desiredFacing = actor.team === 'near' ? Math.PI : 0;
        actor.facingY = desiredFacing;

        // Check if this AI slot should strike the ball now
        if (
          actor.isAi &&
          team === receivingTeam &&
          actor.slotId === responsible &&
          !actor.aiHasSwungForShot &&
          nowMs >= actor.aiSwingReadyAt
        ) {
          const onTeamHalf =
            team === 'near' ? this.ball.pos.z > 0.6 : this.ball.pos.z < -0.6;
          const distZ = Math.abs(this.ball.pos.z - actor.z);
          const distX = Math.abs(this.ball.pos.x - actor.x);
          const canHitNow =
            onTeamHalf &&
            distX <= 1.95 &&
            distZ <= 1.25 &&
            this.ball.pos.y <= 2.4 &&
            (this.ball.bouncesOnOpponentSide >= 1 ||
              (actor.role === 'front' && Math.abs(actor.z) < 5.8));

          if (canHitNow) {
            actor.aiHasSwungForShot = true;
            const opponents = this.getTeamActors(otherTeam(team)).map((o) => ({
              x: o.x,
              z: o.z,
            }));
            const aiSwing = decideAiReturnSwing(
              actor,
              this.ball,
              opponents,
              this.difficulty,
              this.courtMode,
              nowMs
            );
            if (aiSwing) {
              const profile = AI_DIFFICULTY_PROFILES[this.difficulty];
              const jitter = (Math.random() * 2 - 1) * profile.timingJitter;
              actor.swingKind =
                aiSwing.shotType === 'smash'
                  ? 'serve'
                  : actor.role === 'front'
                    ? 'volley'
                    : aiSwing.strokeSide === 'forehand'
                      ? 'forehand'
                      : 'backhand';
              actor.swingTimer = 0;
              actor.swingDuration = 0.38;
              this.executeRallyStrike(actor, aiSwing, jitter);
              return;
            }
          }
        }
      }
    }
  }

  private finishPoint(winner: TennisTeamId, reason: TennisPointReason): void {
    this.pointResetTimer = 1.85;
    this.setRallyPhase('point-over');

    const winners = this.getTeamActors(winner);
    for (const w of winners) {
      w.swingKind = 'celebrate';
      w.swingTimer = 0;
      w.swingDuration = 1.4;
    }
    if (winners[0]) {
      this.cameraDirector.setCelebration(winners[0].x, winners[0].z);
    }

    this.callbacks.onPointResolved(winner, reason, this.rallyCount);
  }

  private computeTargetMarker(): TennisStateSnapshot['targetMarker'] {
    if (this.rallyPhase !== 'rally' || !this.ball.active || !this.prediction) {
      return { visible: false, x: 0, z: 0, urgency: 0, team: 'near' };
    }

    const receivingTeam = this.prediction.receivingTeam;
    const teamHasHuman = this.getTeamActors(receivingTeam).some((a) => !a.isAi);
    if (!teamHasHuman) {
      return { visible: false, x: 0, z: 0, urgency: 0, team: receivingTeam };
    }

    const dist = Math.hypot(
      this.ball.pos.x - this.prediction.strikePos.x,
      this.ball.pos.z - this.prediction.strikePos.z
    );
    const urgency = clamp(1 - dist / 14.5, 0, 1);

    return {
      visible: true,
      x: this.prediction.strikePos.x,
      z: this.prediction.strikePos.z,
      urgency,
      team: receivingTeam,
    };
  }

  private serializeActor(actor: InternalActor): TennisAvatarSnapshot {
    return {
      slotId: actor.slotId,
      team: actor.team,
      role: actor.role,
      color: actor.color,
      name: actor.name,
      isAi: actor.isAi,
      x: actor.x,
      z: actor.z,
      facingY: actor.facingY,
      runSpeed: actor.runSpeed,
      swingKind: actor.swingKind,
      swingProgress:
        actor.swingKind === 'none'
          ? 0
          : clamp(actor.swingTimer / Math.max(0.05, actor.swingDuration), 0, 1),
      racketPitch: actor.racketPitch,
      racketRoll: actor.racketRoll,
    };
  }

  private buildSnapshot(
    targetMarker: TennisStateSnapshot['targetMarker']
  ): TennisStateSnapshot {
    return {
      rallyPhase: this.rallyPhase,
      ballActive: this.ball.active,
      ballPos: [this.ball.pos.x, this.ball.pos.y, this.ball.pos.z],
      ballVel: [this.ball.vel.x, this.ball.vel.y, this.ball.vel.z],
      ballSpin: this.ball.spin,
      shotType: this.ball.shotType,
      isPowerShot: this.ball.isPowerShot,
      rallyCount: this.rallyCount,
      serveTossProgress:
        this.rallyPhase === 'serve-toss'
          ? clamp(this.serveTossElapsed / SERVE_TOSS_DURATION, 0, 1)
          : 0,
      targetMarker,
      avatars: Array.from(this.actors.values()).map((a) => this.serializeActor(a)),
    };
  }

  public getServeTossProgress(): number {
    if (this.rallyPhase !== 'serve-toss') return 0;
    return clamp(this.serveTossElapsed / SERVE_TOSS_DURATION, 0, 1);
  }

  private registerDebugHandle(): void {
    const win = window as unknown as Record<string, unknown>;
    const handle = {
      waitReady: async () => {
        await this.stadiumRefs.ready;
        await Promise.all(Array.from(this.avatars.values()).map((a) => a.ready));
      },
      setCamera: (pos: [number, number, number], lookAt: [number, number, number], fov = 46) => {
        this.cameraDirector.setCustomShot(pos, lookAt, fov);
        this.renderer.render(this.scene, this.camera);
      },
      clearCamera: () => {
        this.showcaseFrozen = false;
        this.cameraDirector.clearCustomShot();
      },
      stageShowcase: (options?: {
        nearPose?: TennisAvatarSnapshot['swingKind'];
        nearProgress?: number;
        nearX?: number;
        nearZ?: number;
        nearFacingY?: number;
        nearColor?: BallColorId;
        farPose?: TennisAvatarSnapshot['swingKind'];
        farProgress?: number;
        farX?: number;
        farZ?: number;
        farColor?: BallColorId;
        showFloorRings?: boolean;
        ballActive?: boolean;
        ballPos?: [number, number, number];
        trail?: Array<[number, number, number]>;
        shotType?: TennisShotType;
        isPowerShot?: boolean;
      }) => {
        const opts = options ?? {};
        this.showcaseFrozen = true;
        const nearActor = this.actors.get('near-back');
        const farActor = this.actors.get('far-back');
        if (nearActor) {
          nearActor.x = opts.nearX ?? 1.35;
          nearActor.z = opts.nearZ ?? 10.6;
          nearActor.vx = 0;
          nearActor.vz = 0;
          nearActor.runSpeed = 0;
          nearActor.facingY = opts.nearFacingY ?? Math.PI;
          if (opts.nearColor) nearActor.color = opts.nearColor;
          nearActor.swingKind = opts.nearPose ?? 'forehand';
          nearActor.swingDuration = 1.0;
          nearActor.swingTimer = opts.nearProgress ?? 0.42;
        }
        if (farActor) {
          farActor.x = opts.farX ?? -1.55;
          farActor.z = opts.farZ ?? -10.8;
          farActor.vx = 0;
          farActor.vz = 0;
          farActor.runSpeed = 0;
          farActor.facingY = 0;
          if (opts.farColor) farActor.color = opts.farColor;
          farActor.swingKind = opts.farPose ?? 'none';
          farActor.swingDuration = 1.0;
          farActor.swingTimer = opts.farProgress ?? 0;
        }
        const showRings = opts.showFloorRings ?? true;
        for (const actor of this.actors.values()) {
          const av = this.avatars.get(actor.slotId);
          av?.setFloorRingVisible(showRings);
          av?.sync(this.serializeActor(actor), 0.016);
        }

        const ballActive = opts.ballActive ?? true;
        const bp = opts.ballPos ?? [0.65, 1.55, 2.2];
        const st = opts.shotType ?? 'topspin';
        const pwr = opts.isPowerShot ?? false;
        this.ball.active = ballActive;
        this.ball.pos = { x: bp[0], y: bp[1], z: bp[2] };
        this.ball.vel = { x: -1.8, y: 2.2, z: -16.0 };
        this.ball.shotType = st;
        this.ball.isPowerShot = pwr;
        this.ballVisuals.clearTrail();
        this.ballVisuals.sync(
          ballActive,
          bp,
          [-1.8, 2.2, -16.0],
          0.65,
          st,
          pwr,
          { visible: false, x: 0, z: 0, urgency: 0, team: 'near' },
          0.016
        );
        if (ballActive && opts.trail && opts.trail.length >= 2) {
          this.ballVisuals.seedTrail(opts.trail, st, pwr);
        } else {
          this.ballVisuals.clearTrail();
        }
        this.renderer.render(this.scene, this.camera);
      },
      getDiagnostics: () => ({
        stadium: this.stadiumRefs.getDiagnostics(),
        avatars: Object.fromEntries(
          Array.from(this.avatars.entries()).map(([slot, av]) => [slot, av.getDiagnostics()])
        ),
        exposure: this.renderer.toneMappingExposure,
      }),
    };
    this.debugHandle = handle;
    win.__tennisDebug = handle;
  }
}

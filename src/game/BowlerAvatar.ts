import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  BALL_COLORS,
  type AimState,
  type ArmPoseState,
  type BallColorId,
} from '../types/game';
import { BALL_RADIUS, FOUL_LINE_Z, getLaneCenterX } from './PhysicsWorld';
import { getSwirledBallTexture } from './BallVisuals';

// Timestamps (seconds) from our 30fps Blender bowling animation (Frames 1..90)
const FPS = 30;
const T_READY_START = 1 / FPS;       // Frame 1: ready aiming stance
const T_READY_END = 14 / FPS;        // Frame 14: end of ready breathing / start push-away
const T_PUSH_AWAY = 19 / FPS;        // Frame 19: early step-1 / push-away response during armed phase
const T_BACKSWING_PEAK = 45 / FPS;   // Frame 45: peak backswing before slide & downswing
const T_RELEASE = 55 / FPS;          // Frame 55: exact ball release at the foul line
const T_CLIP_END = 90 / FPS - 0.002; // Clamp slightly inside 3.0s so mixer never pauses/wraps

const BOWLER_MODEL_URL = '/models/bowler.glb';

// In Blender our ball releases at X = -0.032m; after glTF Y-up + 180° Y rotation that is X = +0.032m.
// Shifting the bowler root by -0.032m aligns the released ball directly over the player's aim line.
const BALL_RELEASE_X_COMPENSATION = -0.032;

// Switch Sports translucent ghost opacities (matching bowling_play.mp4 so lane & pins stay clear)
const OPACITY_AIMING = 0.26;
const OPACITY_THROWING = 0.30;
const OPACITY_RELEASED = 0.14;
const BALL_OPACITY_AIMING = 0.48;

export type BowlerAvatarMode = 'aiming' | 'throwing' | 'released' | 'hidden';

/**
 * Stylized rigged Sportsmate bowler recreated from bowling_play.mp4 in Blender (/models/bowler.glb):
 * - Full 23-bone skinned character (sculpted hair bun, Spocco 'S' jersey, shorts, sneakers)
 * - Highly translucent Switch Sports gameplay silhouette so the lane arrows & pins remain
 *   clearly visible while casting a crisp shadow onto the maple approach deck
 * - Live-tracks armed -> backswing (F14..F45) -> forwardswing (F45..F55) in real time, then
 *   completes the Frame 55 foul-line release handoff and high follow-through (F55..F90)
 * - Attaches a color-matched glossy swirled bowling ball directly to the `BallAttach` hand bone
 */
export class BowlerAvatar {
  public readonly ready: Promise<void>;

  private readonly root = new THREE.Group();
  private readonly modelHolder = new THREE.Group();
  private readonly aimGroup = new THREE.Group();
  private readonly aimDots: THREE.Mesh[] = [];

  private readonly heldBall: THREE.Mesh;
  private readonly heldBallMat: THREE.MeshPhysicalMaterial;

  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private pelvisBone: THREE.Object3D | null = null;
  private avatarMaterials: THREE.MeshStandardMaterial[] = [];

  private mode: BowlerAvatarMode = 'hidden';
  private currentLaneX = 0;
  private currentAim: AimState = { xOffset: 0, aimAngle: 0 };
  private currentColor: BallColorId = 'purple';

  // Animation playback state
  private animTime = T_READY_START;
  private readyIdlePhase = 0;
  private targetLiveTime = T_READY_START;
  private peakBackswingPitch = 0;
  private isLiveSwinging = false;
  private throwSpeed = 1.4;
  private releaseFired = false;
  private onReleaseCallback: (() => void) | null = null;

  private currentOpacity = OPACITY_AIMING;
  private targetOpacity = OPACITY_AIMING;

  constructor(scene: THREE.Scene) {
    // Rotate exported glTF (+Z forward) by 180° around Y so the bowler faces -Z (toward pins)
    // and the right bowling arm (+X) & 4-step approach (+2.34m -> +0.24m Z) match PhysicsWorld.ts.
    this.modelHolder.rotation.y = Math.PI;
    this.root.add(this.modelHolder);

    // Held preview bowling ball (attached to `BallAttach` bone once GLB finishes loading)
    this.heldBallMat = new THREE.MeshPhysicalMaterial({
      map: getSwirledBallTexture('purple'),
      roughness: 0.1,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      transparent: true,
      opacity: BALL_OPACITY_AIMING,
      depthWrite: true,
    });
    this.heldBall = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 32, 24),
      this.heldBallMat
    );
    this.heldBall.castShadow = true;
    this.heldBall.visible = false;

    this.root.position.set(BALL_RELEASE_X_COMPENSATION, 0, FOUL_LINE_Z);
    this.root.visible = false;
    scene.add(this.root);

    // Glowing dotted aim-guide line on the maple floor
    const dotGeom = new THREE.CircleGeometry(0.032, 12);
    for (let i = 0; i < 16; i++) {
      const dotMat = new THREE.MeshBasicMaterial({
        color: 0x4ef2e4,
        transparent: true,
        opacity: 0.85 * (1 - i / 18),
        side: THREE.DoubleSide,
      });
      const dot = new THREE.Mesh(dotGeom, dotMat);
      dot.rotation.x = -Math.PI / 2;
      this.aimDots.push(dot);
      this.aimGroup.add(dot);
    }
    this.aimGroup.visible = false;
    scene.add(this.aimGroup);

    this.ready = this.loadModel();
  }

  private async loadModel(): Promise<void> {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync(BOWLER_MODEL_URL);
      const model = gltf.scene;

      const matSet = new Set<THREE.MeshStandardMaterial>();
      model.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = false;
          // Skinned root motion translates ~2.1m forward from rest pose; prevent premature frustum culling
          mesh.frustumCulled = false;

          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            if (m && 'opacity' in m) {
              const std = m as THREE.MeshStandardMaterial;
              std.transparent = true;
              std.depthWrite = true;
              std.opacity = this.currentOpacity;
              matSet.add(std);
            }
          }
        }
      });
      this.avatarMaterials = Array.from(matSet);

      this.modelHolder.add(model);

      // Attach the color-reactive preview bowling ball to the right hand's `BallAttach` bone
      const ballAttach = model.getObjectByName('BallAttach');
      if (ballAttach) {
        this.heldBall.position.set(0, 0, 0);
        ballAttach.add(this.heldBall);
      } else {
        this.modelHolder.add(this.heldBall);
      }

      this.pelvisBone = model.getObjectByName('Pelvis') ?? null;

      // Setup AnimationMixer with LoopRepeat (we clamp time manually so LoopOnce never auto-pauses
      // and freezes subsequent throws!)
      if (gltf.animations.length > 0) {
        this.mixer = new THREE.AnimationMixer(model);
        const clip = gltf.animations[0];
        this.action = this.mixer.clipAction(clip);
        this.action.setLoop(THREE.LoopRepeat, Infinity);
        this.action.play();
        this.applyAnimationTime(this.animTime);
      }

      this.syncVisibility();
    } catch (err) {
      console.error('[BowlerAvatar] Failed to load /models/bowler.glb:', err);
    }
  }

  public setColor(colorId: BallColorId): void {
    this.currentColor = colorId;
    const spec = BALL_COLORS[colorId];
    this.heldBallMat.map = getSwirledBallTexture(colorId);
    this.heldBallMat.needsUpdate = true;
    for (const dot of this.aimDots) {
      (dot.material as THREE.MeshBasicMaterial).color.set(spec.trail);
    }
  }

  public setLane(laneIndex: number): void {
    this.currentLaneX = getLaneCenterX(laneIndex);
    this.updateTransform();
  }

  public setAim(aim: AimState): void {
    this.currentAim = aim;
    this.updateTransform();
  }

  /**
   * Live-maps controller / desktop swing pose onto our 90-frame Blender animation:
   * - armed: responsive early push-away (Frames 1..19)
   * - backswing: approach steps & pendulum backswing (Frames 14..45)
   * - forwardswing: deep lunge slide & downswing toward the foul line (Frames 45..54.5)
   * - released: holds cleanly near Frame 55 until playThrowSequence takes over
   */
  public setArmPose(pose: ArmPoseState): void {
    if (this.mode !== 'aiming') return;

    if (!pose.holdingGrip && pose.phase === 'idle') {
      this.isLiveSwinging = false;
      this.peakBackswingPitch = 0;
      this.targetLiveTime = T_READY_START;
      return;
    }

    if (pose.phase === 'armed') {
      this.isLiveSwinging = true;
      this.peakBackswingPitch = Math.min(this.peakBackswingPitch, pose.pitch);
      const armedNorm = THREE.MathUtils.clamp(-pose.pitch / 0.28, 0, 1);
      this.targetLiveTime = THREE.MathUtils.lerp(T_READY_END, T_PUSH_AWAY, armedNorm);
      return;
    }

    if (pose.phase === 'backswing') {
      this.isLiveSwinging = true;
      this.peakBackswingPitch = Math.min(this.peakBackswingPitch, pose.pitch);
      // Map pitch (0 .. -0.85 rad) across Frames 14..45 so natural swings reach full backswing
      const backswingNorm = THREE.MathUtils.clamp(-pose.pitch / 0.85, 0, 1);
      this.targetLiveTime = THREE.MathUtils.lerp(
        T_READY_END,
        T_BACKSWING_PEAK,
        backswingNorm
      );
      return;
    }

    if (pose.phase === 'forwardswing') {
      this.isLiveSwinging = true;
      const startPitch = Math.min(-0.25, this.peakBackswingPitch);
      const span = Math.max(0.32, 0.22 - startPitch);
      const fwdNorm = THREE.MathUtils.clamp((pose.pitch - startPitch) / span, 0, 1);
      // Advance monotonically FORWARD through the slide & downswing (Frames 45 -> 54.5)
      const fwdTarget = THREE.MathUtils.lerp(T_BACKSWING_PEAK, T_RELEASE - 0.015, fwdNorm);
      this.targetLiveTime = Math.max(this.targetLiveTime, fwdTarget);
      return;
    }

    if (pose.phase === 'released') {
      // Do not snap back to idle right before launchLocalThrow arrives
      this.isLiveSwinging = true;
      this.targetLiveTime = Math.max(this.targetLiveTime, T_RELEASE - 0.01);
    }
  }

  /**
   * Plays the full 4-step Blender bowling animation seamlessly from the current live-swing
   * frame through Frame 55 (ball release at the foul line), invokes `onRelease` at the exact
   * release frame, and finishes with the high Switch Sports follow-through through Frame 90.
   */
  public playThrowSequence(onRelease: () => void): void {
    this.mode = 'throwing';
    this.isLiveSwinging = false;
    this.releaseFired = false;
    this.onReleaseCallback = onRelease;

    // If the player already swung near Frame 55 live, finish crisply; if fired quickly from
    // idle/swipe, play a snappy approach (~0.55s) into Frame 55 release.
    const remainingToRelease = Math.max(0.02, T_RELEASE - this.animTime);
    if (remainingToRelease > 0.65) {
      this.throwSpeed = THREE.MathUtils.clamp(remainingToRelease / 0.55, 1.4, 2.6);
    } else {
      this.throwSpeed = 1.35;
    }

    this.targetOpacity = OPACITY_THROWING;
    this.syncVisibility();
  }

  public cancelThrowSequence(): void {
    this.onReleaseCallback = null;
    this.releaseFired = false;
  }

  public setMode(mode: BowlerAvatarMode): void {
    this.mode = mode;
    if (mode === 'hidden') {
      this.cancelThrowSequence();
      this.root.visible = false;
      this.aimGroup.visible = false;
      this.heldBall.visible = false;
      return;
    }

    if (mode === 'aiming') {
      this.cancelThrowSequence();
      this.isLiveSwinging = false;
      this.peakBackswingPitch = 0;
      this.readyIdlePhase = 0;
      this.animTime = T_READY_START;
      this.targetLiveTime = T_READY_START;
      this.targetOpacity = OPACITY_AIMING;
      this.applyAnimationTime(this.animTime);
    } else if (mode === 'released') {
      this.animTime = Math.max(this.animTime, T_RELEASE);
      this.releaseFired = true;
      this.onReleaseCallback = null;
      this.targetOpacity = OPACITY_RELEASED;
      this.applyAnimationTime(this.animTime);
    }

    this.syncVisibility();
  }

  /**
   * Returns current world Z position of the bowler's pelvis (useful for subtle camera approach tracking).
   */
  public getWorldPelvisZ(): number {
    if (this.pelvisBone) {
      const wp = new THREE.Vector3();
      this.pelvisBone.getWorldPosition(wp);
      return wp.z;
    }
    return FOUL_LINE_Z + 2.34;
  }

  public update(dt: number): void {
    if (!this.root.visible) return;

    // Smooth opacity transitions (Switch Sports translucent ghosting)
    const opacityAlpha = 1 - Math.exp(-8 * dt);
    this.currentOpacity = THREE.MathUtils.lerp(
      this.currentOpacity,
      this.targetOpacity,
      opacityAlpha
    );
    for (const mat of this.avatarMaterials) {
      mat.opacity = this.currentOpacity;
    }
    this.heldBallMat.opacity = Math.min(BALL_OPACITY_AIMING, this.currentOpacity + 0.22);

    if (this.mode === 'aiming') {
      if (this.isLiveSwinging) {
        // Snappy real-time tracking of live phone swing / desktop power charge
        const scrubK = 1 - Math.exp(-18 * dt);
        this.animTime = THREE.MathUtils.lerp(
          this.animTime,
          this.targetLiveTime,
          scrubK
        );
      } else {
        // Gentle ready stance breathing ping-pong between Frame 1 and Frame 10
        this.readyIdlePhase += dt * 1.4;
        const breathe = 0.5 - 0.5 * Math.cos(this.readyIdlePhase * Math.PI);
        const targetIdle = THREE.MathUtils.lerp(T_READY_START, T_READY_END * 0.72, breathe);
        const idleK = 1 - Math.exp(-10 * dt);
        this.animTime = THREE.MathUtils.lerp(this.animTime, targetIdle, idleK);
      }
      this.applyAnimationTime(this.animTime);
      return;
    }

    if (this.mode === 'throwing' || this.mode === 'released') {
      const rate = this.releaseFired ? 1.0 : this.throwSpeed;
      this.animTime = Math.min(T_CLIP_END, this.animTime + dt * rate);
      this.applyAnimationTime(this.animTime);

      if (!this.releaseFired && this.animTime >= T_RELEASE) {
        this.releaseFired = true;
        this.mode = 'released';
        this.targetOpacity = OPACITY_RELEASED;
        this.syncVisibility();
        const cb = this.onReleaseCallback;
        this.onReleaseCallback = null;
        cb?.();
      }
    }
  }

  public dispose(): void {
    this.cancelThrowSequence();
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.action = null;
    this.heldBall.geometry.dispose();
    this.heldBallMat.dispose();
    for (const dot of this.aimDots) {
      (dot.material as THREE.Material).dispose();
    }
    if (this.aimDots[0]) {
      this.aimDots[0].geometry.dispose();
    }
  }

  private applyAnimationTime(timeSec: number): void {
    if (!this.mixer || !this.action) return;
    this.action.enabled = true;
    this.action.paused = false;
    this.action.timeScale = 1;
    const clamped = THREE.MathUtils.clamp(timeSec, T_READY_START, T_CLIP_END);
    this.mixer.setTime(clamped);
  }

  private syncVisibility(): void {
    const visible = this.mode !== 'hidden';
    this.root.visible = visible;
    this.aimGroup.visible = this.mode === 'aiming';
    this.heldBall.visible = this.mode === 'aiming' || (this.mode === 'throwing' && !this.releaseFired);
  }

  private updateTransform(): void {
    const bowlerX = this.currentLaneX + this.currentAim.xOffset;
    this.root.position.set(
      bowlerX + BALL_RELEASE_X_COMPENSATION,
      0,
      FOUL_LINE_Z
    );
    this.root.rotation.y = -this.currentAim.aimAngle;

    // Position glowing dotted aim line down the first ~5.5 meters of the lane
    const sinA = Math.sin(this.currentAim.aimAngle);
    const cosA = Math.cos(this.currentAim.aimAngle);
    for (let i = 0; i < this.aimDots.length; i++) {
      const dist = 0.35 + i * 0.36;
      const dx = bowlerX + sinA * dist;
      const dz = FOUL_LINE_Z - cosA * dist;
      this.aimDots[i].position.set(dx, 0.008, dz);
    }
  }

  public getColor(): BallColorId {
    return this.currentColor;
  }
}

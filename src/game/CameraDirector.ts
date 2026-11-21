import * as THREE from 'three';
import { FOUL_LINE_Z, HEAD_PIN_Z, getLaneCenterX } from './PhysicsWorld';

export type CameraShot = 'overview' | 'aim' | 'follow' | 'impact' | 'clearing';

/**
 * Multi-angle broadcast camera system matching bowling_play.mp4:
 * - overview: wide sunlit Spocco Square lobby vista
 * - aim: behind translucent bowler tracking lateral position
 * - follow: smooth glide behind rolling ball down the lane
 * - impact: dramatic low front-deck pin close-up on strong pocket hits (00:05-00:06!)
 */
export class CameraDirector {
  private readonly camera: THREE.PerspectiveCamera;
  private shot: CameraShot = 'overview';
  private laneCenterX = 0;

  private readonly targetPos = new THREE.Vector3(0, 2.2, 5.2);
  private readonly targetLook = new THREE.Vector3(0, 0.5, -14);
  private readonly currentLook = new THREE.Vector3(0, 0.5, -14);
  private overviewAngle = 0;
  private impactTriggeredForRoll = false;
  private slowMoRemaining = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.position.copy(this.targetPos);
    this.camera.lookAt(this.currentLook);
  }

  public getShot(): CameraShot {
    return this.shot;
  }

  public setOverview(): void {
    this.shot = 'overview';
    this.impactTriggeredForRoll = false;
    this.slowMoRemaining = 0;
  }

  public setAimShot(
    laneIndex: number,
    xOffset: number,
    aimAngle: number,
    bowlerZ = FOUL_LINE_Z + 2.34
  ): void {
    this.shot = 'aim';
    this.laneCenterX = getLaneCenterX(laneIndex);
    this.impactTriggeredForRoll = false;
    this.slowMoRemaining = 0;

    const focusX = this.laneCenterX + xOffset * 0.65;
    // Track cleanly behind the animated bowler (framing head-to-shoes + approach shadow like bowling_play.mp4)
    const camZ = THREE.MathUtils.clamp(bowlerZ + 1.85, FOUL_LINE_Z + 3.05, FOUL_LINE_Z + 4.25);
    const camY = THREE.MathUtils.lerp(1.48, 1.62, THREE.MathUtils.clamp((camZ - 3.05) / 1.2, 0, 1));
    this.targetPos.set(focusX, camY, camZ);
    this.targetLook.set(
      this.laneCenterX + xOffset + Math.sin(aimAngle) * 14,
      0.42,
      HEAD_PIN_Z
    );
  }

  public startFollow(laneIndex: number): void {
    this.shot = 'follow';
    this.laneCenterX = getLaneCenterX(laneIndex);
    this.impactTriggeredForRoll = false;
    this.slowMoRemaining = 0;
  }

  public setClearingShot(laneIndex: number): void {
    const wasImpact = this.shot === 'impact';
    this.shot = 'clearing';
    this.laneCenterX = getLaneCenterX(laneIndex);
    this.impactTriggeredForRoll = false;
    this.slowMoRemaining = 0;

    // If coming from the rear pit-side impact camera, snap cleanly in front of the pin deck
    // so the camera never flies through the sweeper or pins.
    if (wasImpact) {
      this.camera.position.set(this.laneCenterX, 1.12, HEAD_PIN_Z + 4.25);
      this.currentLook.set(this.laneCenterX, 0.38, HEAD_PIN_Z - 0.45);
    }
    this.targetPos.set(this.laneCenterX, 1.04, HEAD_PIN_Z + 3.65);
    this.targetLook.set(this.laneCenterX, 0.36, HEAD_PIN_Z - 0.45);
  }

  public updateBallTracking(
    ballPos: { x: number; y: number; z: number },
    ballSpeed: number,
    inGutter: boolean
  ): void {
    if (this.shot !== 'follow' && this.shot !== 'impact') return;

    const localX = ballPos.x - this.laneCenterX;

    // Trigger dramatic close-up pin-deck impact camera (like 00:05-00:06 of bowling_play.mp4!)
    // when a fast ball approaches the pocket cleanly
    if (
      !this.impactTriggeredForRoll &&
      !inGutter &&
      ballPos.z < HEAD_PIN_Z + 2.9 &&
      ballPos.z > HEAD_PIN_Z - 0.5 &&
      Math.abs(localX) < 0.34 &&
      ballSpeed > 7.6
    ) {
      this.impactTriggeredForRoll = true;
      this.shot = 'impact';
      this.slowMoRemaining = 0.55;
      // Snap cleanly to the dramatic close-up behind/front of the pins looking toward the alley & rear lounge!
      const sideSign = localX >= 0 ? -1 : 1;
      this.camera.position.set(
        this.laneCenterX + sideSign * 0.22,
        0.54,
        HEAD_PIN_Z - 1.52
      );
      this.currentLook.set(this.laneCenterX, 0.36, HEAD_PIN_Z + 3.5);
      this.targetPos.set(
        this.laneCenterX + sideSign * 0.34,
        0.58,
        HEAD_PIN_Z - 1.68
      );
      this.targetLook.set(this.laneCenterX, 0.34, HEAD_PIN_Z + 2.8);
      return;
    }

    if (this.shot === 'follow') {
      const clampedZ = Math.max(HEAD_PIN_Z + 2.8, ballPos.z);
      const camZ = clampedZ + 3.45;
      const camX = THREE.MathUtils.lerp(this.laneCenterX, ballPos.x, 0.42);
      this.targetPos.set(camX, 1.22, camZ);
      this.targetLook.set(
        THREE.MathUtils.lerp(this.laneCenterX, ballPos.x, 0.5),
        0.26,
        Math.min(HEAD_PIN_Z, ballPos.z - 4.5)
      );
    }
  }

  /**
   * Returns the active simulation time-scale (1.0 normally, brief slow-mo during strike impact).
   */
  public update(dt: number): number {
    let timeScale = 1.0;
    if (this.slowMoRemaining > 0) {
      this.slowMoRemaining = Math.max(0, this.slowMoRemaining - dt);
      timeScale = 0.48;
    }

    if (this.shot === 'overview') {
      this.overviewAngle += dt * 0.22;
      this.targetPos.set(
        Math.sin(this.overviewAngle) * 3.1,
        2.38,
        FOUL_LINE_Z + 3.85
      );
      this.targetLook.set(0, 0.92, HEAD_PIN_Z * 0.78);
    }

    const posAlpha = this.shot === 'impact' ? 1 - Math.exp(-3.5 * dt) : 1 - Math.exp(-6.5 * dt);
    const lookAlpha = this.shot === 'impact' ? 1 - Math.exp(-5.0 * dt) : 1 - Math.exp(-8.5 * dt);

    this.camera.position.lerp(this.targetPos, posAlpha);
    this.currentLook.lerp(this.targetLook, lookAlpha);
    this.camera.lookAt(this.currentLook);

    return timeScale;
  }
}

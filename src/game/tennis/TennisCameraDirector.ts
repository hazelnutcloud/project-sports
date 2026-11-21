import * as THREE from 'three';
import { COURT_HALF_LENGTH } from './TennisPhysics';

export type TennisCameraMode = 'overview' | 'serve' | 'play' | 'celebration' | 'custom';

/**
 * Broadcast Spocco Square Tennis camera director:
 * - overview: sunlit orbiting stadium vista during lobby
 * - serve: crisp behind-the-court framing focused slightly toward the server
 * - play: classic Switch Sports elevated TV angle tracking rally width without losing baseline sightlines
 * - celebration: gentle push-in after point / match winners
 * - custom: deterministic inspection angle override (snaps immediately)
 */
export class TennisCameraDirector {
  private readonly camera: THREE.PerspectiveCamera;
  private mode: TennisCameraMode = 'overview';
  private overviewAngle = 0.25;

  private readonly targetPos = new THREE.Vector3(0, 8.2, 20.4);
  private readonly targetLook = new THREE.Vector3(0, 0.8, -1.8);
  private readonly currentLook = new THREE.Vector3(0, 0.8, -1.8);

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.position.copy(this.targetPos);
    this.camera.lookAt(this.currentLook);
  }

  public setOverview(): void {
    this.mode = 'overview';
  }

  public setServeShot(serverX: number, servingTeam: 'near' | 'far'): void {
    if (this.mode === 'custom') return;
    this.mode = 'serve';
    if (servingTeam === 'near') {
      this.targetPos.set(THREE.MathUtils.clamp(serverX * 0.55, -2.4, 2.4), 6.2, COURT_HALF_LENGTH + 7.2);
      this.targetLook.set(serverX * 0.15, 0.9, -2.2);
    } else {
      this.targetPos.set(THREE.MathUtils.clamp(serverX * 0.25, -1.6, 1.6), 7.4, COURT_HALF_LENGTH + 8.4);
      this.targetLook.set(0, 0.8, -2.6);
    }
  }

  public setPlayTracking(ballX: number, ballZ: number): void {
    if (this.mode === 'custom') return;
    this.mode = 'play';
    const camX = THREE.MathUtils.clamp(ballX * 0.34, -2.6, 2.6);
    const netPull = THREE.MathUtils.clamp(1 - Math.abs(ballZ) / COURT_HALF_LENGTH, 0, 1);
    const camZ = COURT_HALF_LENGTH + 8.15 - netPull * 1.05;
    const camY = 7.45 - netPull * 0.45;
    this.targetPos.set(camX, camY, camZ);
    this.targetLook.set(THREE.MathUtils.clamp(ballX * 0.26, -2.2, 2.2), 0.75, -1.85 + ballZ * 0.08);
  }

  public setCelebration(focusX: number, focusZ: number): void {
    if (this.mode === 'custom') return;
    this.mode = 'celebration';
    const sign = focusZ >= 0 ? 1 : -1;
    this.targetPos.set(
      THREE.MathUtils.clamp(focusX * 0.65, -3.5, 3.5),
      4.4,
      sign > 0 ? Math.min(COURT_HALF_LENGTH + 5.2, focusZ + 5.8) : COURT_HALF_LENGTH + 4.8
    );
    this.targetLook.set(focusX * 0.85, 1.25, focusZ * 0.75);
  }

  public setCustomShot(
    pos: [number, number, number],
    lookAt: [number, number, number],
    fov?: number
  ): void {
    this.mode = 'custom';
    this.targetPos.set(pos[0], pos[1], pos[2]);
    this.targetLook.set(lookAt[0], lookAt[1], lookAt[2]);
    this.camera.position.copy(this.targetPos);
    this.currentLook.copy(this.targetLook);
    if (typeof fov === 'number' && fov > 10 && fov < 110) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.currentLook);
  }

  public clearCustomShot(): void {
    this.mode = 'play';
    this.camera.fov = 46;
    this.camera.updateProjectionMatrix();
  }

  public update(dt: number): void {
    if (this.mode === 'custom') {
      this.camera.position.copy(this.targetPos);
      this.currentLook.copy(this.targetLook);
      this.camera.lookAt(this.currentLook);
      return;
    }

    if (this.mode === 'overview') {
      // Smooth stadium vista sweep staying cleanly inside the open near-to-mid bowl (zero canopy clipping!)
      this.overviewAngle += dt * 0.22;
      const sway = Math.sin(this.overviewAngle);
      this.targetPos.set(
        sway * 9.8,
        10.2 + Math.cos(this.overviewAngle * 2) * 0.9,
        20.6 - Math.abs(sway) * 2.4
      );
      this.targetLook.set(0, 1.1, -2.0);
    }

    const posAlpha = 1 - Math.exp(-5.2 * dt);
    const lookAlpha = 1 - Math.exp(-6.8 * dt);
    this.camera.position.lerp(this.targetPos, posAlpha);
    this.currentLook.lerp(this.targetLook, lookAlpha);
    this.camera.lookAt(this.currentLook);
  }
}

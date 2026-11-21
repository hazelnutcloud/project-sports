import * as THREE from 'three';
import { BALL_COLORS, type BallColorId } from '../types/game';
import { BALL_RADIUS, type BodyPose } from './PhysicsWorld';

const ballTextureCache = new Map<BallColorId, THREE.CanvasTexture>();
let sharedBallBumpMap: THREE.CanvasTexture | null = null;

function getSharedBallBumpMap(): THREE.CanvasTexture {
  if (sharedBallBumpMap) return sharedBallBumpMap;

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, 1024, 512);

  // Subtle recessed finger holes in bump map for crisp specular bevels
  const holes: Array<[number, number, number]> = [
    [496, 236, 20],
    [546, 236, 20],
    [521, 306, 24],
  ];
  for (const [hx, hy, hr] of holes) {
    const grad = ctx.createRadialGradient(hx, hy, hr * 0.35, hx, hy, hr * 1.15);
    grad.addColorStop(0.0, '#101010');
    grad.addColorStop(0.75, '#242424');
    grad.addColorStop(1.0, '#d8d8d8');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(hx, hy, hr * 1.15, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  sharedBallBumpMap = tex;
  return tex;
}

export function getSwirledBallTexture(colorId: BallColorId): THREE.CanvasTexture {
  const cached = ballTextureCache.get(colorId);
  if (cached) return cached;

  const spec = BALL_COLORS[colorId];
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = spec.primary;
  ctx.fillRect(0, 0, 1024, 512);

  // Deep glossy marbled pearlized swirl bands (matching vibrant purple Switch Sports ball in frame_03 & frame_06!)
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = i % 3 === 0 ? spec.swirl : i % 3 === 1 ? spec.accent : '#ffffff';
    ctx.globalAlpha = i % 3 === 2 ? 0.16 : i % 2 === 0 ? 0.56 : 0.44;
    ctx.lineWidth = 18 + (i % 4) * 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const yBase = (i / 18) * 512;
    for (let x = 0; x <= 1024; x += 16) {
      const y =
        (yBase +
          Math.sin((x / 1024) * Math.PI * 4 + i * 0.85) * 44 +
          Math.cos((x / 1024) * Math.PI * 2 - i * 0.4) * 18 +
          512) %
        512;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Fine pearlescent metallic shimmer flecks
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  for (let i = 0; i < 240; i++) {
    const fx = (i * 193 + 37) % 1024;
    const fy = (i * 107 + 23) % 512;
    const fr = 1.2 + (i % 3) * 0.7;
    ctx.beginPath();
    ctx.arc(fx, fy, fr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Classic 3 drilled finger holes with inner shadow depth & crisp specular rim
  const holes: Array<[number, number, number]> = [
    [496, 236, 18],
    [546, 236, 18],
    [521, 306, 22],
  ];
  for (const [hx, hy, hr] of holes) {
    const hGrad = ctx.createRadialGradient(hx - hr * 0.2, hy - hr * 0.2, hr * 0.1, hx, hy, hr);
    hGrad.addColorStop(0.0, '#07050c');
    hGrad.addColorStop(0.8, '#160f24');
    hGrad.addColorStop(1.0, '#2a1d40');
    ctx.fillStyle = hGrad;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.lineWidth = 3.5;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  ballTextureCache.set(colorId, tex);
  return tex;
}

interface SparkParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

/**
 * Renders a lane's glossy marbled bowling ball, its glowing cyan spin aura/trail,
 * and energetic strike/impact spark bursts.
 */
export class BallVisuals {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly spinAura: THREE.Mesh;
  private readonly trailPoints: THREE.Mesh[] = [];
  private readonly trailPositions: THREE.Vector3[] = [];
  private readonly sparks: SparkParticle[] = [];
  private readonly sparkGroup = new THREE.Group();
  private currentColor: BallColorId = 'purple';
  private trailTimer = 0;

  constructor(scene: THREE.Scene, colorId: BallColorId = 'purple') {
    this.currentColor = colorId;
    this.material = new THREE.MeshPhysicalMaterial({
      map: getSwirledBallTexture(colorId),
      bumpMap: getSharedBallBumpMap(),
      bumpScale: 0.012,
      roughness: 0.08,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.35,
    });

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 40, 32),
      this.material
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    scene.add(this.mesh);

    // Subtle glowing cyan ring aura around spinning ball (visible on high hook!)
    const auraMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(BALL_COLORS[colorId].trail),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.spinAura = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS * 1.22, 24, 18),
      auraMat
    );
    this.mesh.add(this.spinAura);

    // Trail beads behind moving ball (long enough to trace the curving hook arc clearly)
    const trailGeom = new THREE.SphereGeometry(BALL_RADIUS * 0.62, 12, 10);
    for (let i = 0; i < 24; i++) {
      const tMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(BALL_COLORS[colorId].trail),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const bead = new THREE.Mesh(trailGeom, tMat);
      bead.visible = false;
      this.trailPoints.push(bead);
      this.trailPositions.push(new THREE.Vector3());
      scene.add(bead);
    }

    scene.add(this.sparkGroup);
  }

  public setColor(colorId: BallColorId): void {
    if (this.currentColor === colorId) return;
    this.currentColor = colorId;
    this.material.map = getSwirledBallTexture(colorId);
    this.material.needsUpdate = true;

    const trailCol = new THREE.Color(BALL_COLORS[colorId].trail);
    (this.spinAura.material as THREE.MeshBasicMaterial).color.copy(trailCol);
    for (const bead of this.trailPoints) {
      (bead.material as THREE.MeshBasicMaterial).color.copy(trailCol);
    }
  }

  public setVisible(visible: boolean): void {
    this.mesh.visible = visible;
    if (!visible) {
      this.clearTrail();
    }
  }

  public sync(
    visible: boolean,
    pose: BodyPose,
    spin: number,
    speed: number,
    dt: number
  ): void {
    this.mesh.visible = visible;
    this.updateSparks(dt);

    if (!visible) {
      this.clearTrail();
      return;
    }

    this.mesh.position.set(pose.x, pose.y, pose.z);
    this.mesh.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);

    const spinMag = Math.min(1, Math.abs(spin));
    const speedNorm = Math.min(1, speed / 12);
    const auraOpacity = spinMag > 0.2 ? spinMag * speedNorm * 0.34 : 0;
    (this.spinAura.material as THREE.MeshBasicMaterial).opacity = auraOpacity;

    // Update trailing glow beads
    this.trailTimer += dt;
    if (this.trailTimer >= 0.02 && speed > 2.2) {
      this.trailTimer = 0;
      for (let i = this.trailPositions.length - 1; i > 0; i--) {
        this.trailPositions[i].copy(this.trailPositions[i - 1]);
      }
      this.trailPositions[0].set(pose.x, pose.y, pose.z);
    }

    for (let i = 0; i < this.trailPoints.length; i++) {
      const bead = this.trailPoints[i];
      const pos = this.trailPositions[i];
      if (pos.lengthSq() < 0.0001 || speed < 2.0) {
        bead.visible = false;
        continue;
      }
      const fade = 1 - i / this.trailPoints.length;
      bead.visible = true;
      bead.position.copy(pos);
      const scale = fade * (0.55 + spinMag * 0.45);
      bead.scale.setScalar(scale);
      (bead.material as THREE.MeshBasicMaterial).opacity =
        fade * (0.14 + spinMag * 0.28) * speedNorm;
    }
  }

  public spawnImpactSparks(position: [number, number, number], count = 16): void {
    const geom = new THREE.OctahedronGeometry(0.032, 0);
    const color = new THREE.Color(BALL_COLORS[this.currentColor].trail);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xffffff : color,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const spark = new THREE.Mesh(geom, mat);
      spark.position.set(position[0], position[1] + 0.08, position[2]);
      this.sparkGroup.add(spark);
      const angle = Math.random() * Math.PI * 2;
      const spd = 1.6 + Math.random() * 4.4;
      this.sparks.push({
        mesh: spark,
        vel: new THREE.Vector3(
          Math.cos(angle) * spd,
          1.5 + Math.random() * 3.8,
          Math.sin(angle) * spd
        ),
        life: 0,
        maxLife: 0.45 + Math.random() * 0.35,
      });
    }
  }

  public clearTrail(): void {
    for (let i = 0; i < this.trailPoints.length; i++) {
      this.trailPoints[i].visible = false;
      this.trailPositions[i].set(0, 0, 0);
    }
  }

  private updateSparks(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life += dt;
      if (s.life >= s.maxLife) {
        this.sparkGroup.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      s.vel.y -= 9.5 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += 8 * dt;
      s.mesh.rotation.y += 6 * dt;
      const t = 1 - s.life / s.maxLife;
      s.mesh.scale.setScalar(t);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = t;
    }
  }
}

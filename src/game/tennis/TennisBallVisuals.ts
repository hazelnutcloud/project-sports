import * as THREE from 'three';
import type { TennisShotType, TennisTeamId } from '../../types/tennis';
import { BALL_RADIUS } from './TennisPhysics';

const SHOT_TRAIL_COLORS: Record<TennisShotType, number> = {
  flat: 0xf6ff8a,
  topspin: 0xffc845, // luminous sunlit gold-amber (glows cleanly additively over royal blue court!)
  slice: 0x5cf2ff,
  lob: 0xd8a8ff,
  smash: 0xff6242,
  serve: 0xfff066,
};

interface TennisBallTextures {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

/**
 * Generates crisp 512x256 optic-yellow felt textures with a mathematically seamless
 * 3D saddle-curve white rubber tennis ball seam and subtle fuzzy felt micro-bump.
 */
function createTennisBallTextures(): TennisBallTextures {
  const W = 512;
  const H = 256;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = W;
  albedoCanvas.height = H;
  const actx = albedoCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = W;
  bumpCanvas.height = H;
  const bctx = bumpCanvas.getContext('2d')!;

  const aImg = actx.createImageData(W, H);
  const bImg = bctx.createImageData(W, H);
  const aData = aImg.data;
  const bData = bImg.data;

  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H;
    const theta = v * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      const phi = u * Math.PI * 2;
      const x = sinT * Math.cos(phi);
      const y = sinT * Math.sin(phi);
      const z = cosT;

      // Exact smooth tennis ball saddle curve: z = 0.64 * (x^2 - y^2)
      const f = z - 0.64 * (x * x - y * y);
      const gx = -1.28 * x;
      const gy = 1.28 * y;
      const gz = 1.0;
      const dotN = gx * x + gy * y + gz * z;
      const tx = gx - dotN * x;
      const ty = gy - dotN * y;
      const tz = gz - dotN * z;
      const gradMag = Math.max(0.35, Math.hypot(tx, ty, tz));
      const dist = Math.abs(f) / gradMag;

      const h1 = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453;
      const noise = h1 - Math.floor(h1);
      const h2 = Math.sin(px * 39.346 + py * 11.135) * 24634.6345;
      const noise2 = h2 - Math.floor(h2);
      const felt = (noise * 0.65 + noise2 * 0.35 - 0.5) * 24;

      const idx = (py * W + px) * 4;

      if (dist < 0.048) {
        const seamBlend = THREE.MathUtils.smoothstep(dist, 0.032, 0.048);
        aData[idx] = THREE.MathUtils.clamp(Math.round(THREE.MathUtils.lerp(246, 212 + felt * 0.7, seamBlend)), 0, 255);
        aData[idx + 1] = THREE.MathUtils.clamp(Math.round(THREE.MathUtils.lerp(249, 245 + felt * 0.6, seamBlend)), 0, 255);
        aData[idx + 2] = THREE.MathUtils.clamp(Math.round(THREE.MathUtils.lerp(244, 48 + felt * 0.4, seamBlend)), 0, 255);
        aData[idx + 3] = 255;

        const bumpVal = Math.round(THREE.MathUtils.lerp(42, 160 + felt * 2.0, seamBlend));
        bData[idx] = bumpVal;
        bData[idx + 1] = bumpVal;
        bData[idx + 2] = bumpVal;
        bData[idx + 3] = 255;
      } else {
        aData[idx] = THREE.MathUtils.clamp(Math.round(215 + felt * 0.8), 0, 255);
        aData[idx + 1] = THREE.MathUtils.clamp(Math.round(246 + felt * 0.65), 0, 255);
        aData[idx + 2] = THREE.MathUtils.clamp(Math.round(46 + felt * 0.55), 0, 255);
        aData[idx + 3] = 255;

        const bumpVal = THREE.MathUtils.clamp(Math.round(155 + felt * 3.1), 0, 255);
        bData[idx] = bumpVal;
        bData[idx + 1] = bumpVal;
        bData[idx + 2] = bumpVal;
        bData[idx + 3] = 255;
      }
    }
  }

  actx.putImageData(aImg, 0, 0);
  bctx.putImageData(bImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = 4;

  return { map, bumpMap };
}

/**
 * Feathered translucent ribbon texture: bright soft core along v=0.5, smoothly fading to 0% alpha
 * at the ribbon edges (v=0, v=1) and tapering gently along its length (u=0 head -> u=1 tail).
 * Produces a sleek Switch Sports / Mario Tennis swoosh instead of a hard opaque strip.
 */
function createRibbonTrailTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const data = img.data;

  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H;
    // Silky Gaussian cross-section: luminous bright center core tapering smoothly to 0 at edges
    const distFromCenter = Math.abs(v - 0.5) * 2;
    const crossAlpha = Math.pow(Math.max(0, 1 - distFromCenter), 2.0);
    const coreBoost = Math.pow(Math.max(0, 1 - distFromCenter), 4.5);

    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W; // 0 = near ball head, 1 = tail end
      const headEase = THREE.MathUtils.smoothstep(u, 0.0, 0.05);
      const tailFade = Math.pow(Math.max(0, 1 - u), 1.55);
      const alpha = crossAlpha * headEase * tailFade;

      const idx = (py * W + px) * 4;
      // Warm white-hot center core fading into shot-colored outer aura
      const c = Math.round(195 + coreBoost * 60);
      data[idx] = c;
      data[idx + 1] = c;
      data[idx + 2] = c;
      data[idx + 3] = THREE.MathUtils.clamp(Math.round(alpha * 255), 0, 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Soft radial-gradient contact shadow texture for crisp court depth perception.
 */
function createSoftShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0.0, 'rgba(8, 22, 44, 0.72)');
  grad.addColorStop(0.45, 'rgba(10, 26, 52, 0.38)');
  grad.addColorStop(0.8, 'rgba(12, 28, 56, 0.10)');
  grad.addColorStop(1.0, 'rgba(12, 28, 56, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface BounceRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  maxAge: number;
}

interface Spark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
}

/**
 * Optic-yellow 3D tennis ball with:
 * - Fuzzy felt + mathematically seamless curved white saddle seam
 * - Soft radial court drop-shadow (critical for 3D depth perception)
 * - Sleek, soft-feathered translucent ribbon swoosh color-coded by shot type
 * - Expanding court bounce markers & impact sparks
 * - Sweet-spot timing ring at the predicted strike zone
 */
export class TennisBallVisuals {
  private readonly scene: THREE.Scene;
  private readonly ballMesh: THREE.Mesh;
  private readonly ballMat: THREE.MeshStandardMaterial;
  private readonly shadowMesh: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;

  // Sleek feathered crossed-ribbon swoosh trail
  private readonly trailMax = 26;
  private readonly trailHistory: THREE.Vector3[] = [];
  private readonly trailMesh: THREE.Mesh;
  private readonly trailGeo: THREE.BufferGeometry;
  private readonly trailMat: THREE.MeshBasicMaterial;
  private readonly trailPositions: Float32Array;
  private readonly trailUvs: Float32Array;

  // Sweet-spot timing indicator on court floor
  private readonly timingGroup = new THREE.Group();
  private readonly timingOuterMat: THREE.MeshBasicMaterial;
  private readonly timingInnerRing: THREE.Mesh;
  private readonly timingInnerMat: THREE.MeshBasicMaterial;

  // Transient bounce rings & sparks
  private readonly bounceRings: BounceRing[] = [];
  private readonly sparks: Spark[] = [];
  private readonly sparkGeo: THREE.SphereGeometry;
  private readonly bounceRingGeo: THREE.RingGeometry;
  private readonly disposables: Array<{ dispose: () => void }> = [];

  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpSideA = new THREE.Vector3();
  private readonly tmpSideB = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3(0, 1, 0);
  private readonly tmpAlt = new THREE.Vector3(1, 0, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const { map, bumpMap } = createTennisBallTextures();
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS * 1.4, 28, 22);
    this.ballMat = new THREE.MeshStandardMaterial({
      map,
      bumpMap,
      bumpScale: 0.008,
      roughness: 0.8,
      metalness: 0.0,
      emissive: new THREE.Color('#9be824'),
      emissiveIntensity: 0.16,
      envMapIntensity: 0.45,
    });
    this.ballMesh = new THREE.Mesh(ballGeo, this.ballMat);
    this.ballMesh.castShadow = true;
    this.ballMesh.visible = false;
    scene.add(this.ballMesh);
    this.disposables.push(map, bumpMap, ballGeo, this.ballMat);

    // Soft radial ground contact shadow
    const shadowTex = createSoftShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(0.54, 0.54);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    this.shadowMesh = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.shadowMesh.position.y = 0.011;
    this.shadowMesh.visible = false;
    scene.add(this.shadowMesh);
    this.disposables.push(shadowTex, shadowGeo, this.shadowMat);

    // Feathered crossed-ribbon swoosh geometry
    const vertsPerRibbon = this.trailMax * 2;
    const totalVerts = vertsPerRibbon * 2;
    this.trailPositions = new Float32Array(totalVerts * 3);
    this.trailUvs = new Float32Array(totalVerts * 2);

    const indices: number[] = [];
    for (let r = 0; r < 2; r++) {
      const base = r * vertsPerRibbon;
      for (let i = 0; i < this.trailMax - 1; i++) {
        const a = base + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeo.setAttribute('uv', new THREE.BufferAttribute(this.trailUvs, 2));
    this.trailGeo.setIndex(indices);

    const trailTex = createRibbonTrailTexture();
    // AdditiveBlending keeps warm gold/cyan/yellow trails luminous over the blue court (never muddy gray-brown!)
    this.trailMat = new THREE.MeshBasicMaterial({
      color: 0xffc845,
      map: trailTex,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.trailMesh = new THREE.Mesh(this.trailGeo, this.trailMat);
    this.trailMesh.frustumCulled = false;
    this.trailMesh.visible = false;
    scene.add(this.trailMesh);
    this.disposables.push(trailTex, this.trailGeo, this.trailMat);

    // Incoming sweet-spot timing target ring on floor
    const outerGeo = new THREE.RingGeometry(0.32, 0.4, 32);
    this.timingOuterMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outerMesh = new THREE.Mesh(outerGeo, this.timingOuterMat);
    outerMesh.rotation.x = -Math.PI / 2;
    this.timingGroup.add(outerMesh);

    const innerGeo = new THREE.RingGeometry(0.44, 0.52, 32);
    this.timingInnerMat = new THREE.MeshBasicMaterial({
      color: 0x38f8e2,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.timingInnerRing = new THREE.Mesh(innerGeo, this.timingInnerMat);
    this.timingInnerRing.rotation.x = -Math.PI / 2;
    this.timingGroup.add(this.timingInnerRing);

    this.timingGroup.position.y = 0.017;
    this.timingGroup.visible = false;
    scene.add(this.timingGroup);
    this.disposables.push(outerGeo, this.timingOuterMat, innerGeo, this.timingInnerMat);

    this.sparkGeo = new THREE.SphereGeometry(0.036, 8, 6);
    this.bounceRingGeo = new THREE.RingGeometry(0.12, 0.21, 28);
    this.disposables.push(this.sparkGeo, this.bounceRingGeo);
  }

  public clearTrail(): void {
    this.trailHistory.length = 0;
    this.trailMesh.visible = false;
  }

  public seedTrail(points: Array<[number, number, number]>, shotType: TennisShotType, isPowerShot: boolean): void {
    this.trailHistory.length = 0;
    for (const [x, y, z] of points.slice(0, this.trailMax)) {
      this.trailHistory.push(new THREE.Vector3(x, y, z));
    }
    const trailColor = isPowerShot ? 0xff453a : SHOT_TRAIL_COLORS[shotType];
    this.rebuildTrailGeometry(trailColor, isPowerShot);
  }

  public spawnBounceRing(x: number, z: number, inBounds: boolean): void {
    const mat = new THREE.MeshBasicMaterial({
      color: inBounds ? 0xffffff : 0xff4d6d,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.bounceRingGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.022, z);
    this.scene.add(mesh);
    this.bounceRings.push({ mesh, mat, age: 0, maxAge: 0.55 });
  }

  public spawnHitSparks(pos: { x: number; y: number; z: number }, colorHex: number, count = 12): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.Mesh(this.sparkGeo, mat);
      mesh.position.set(pos.x, pos.y, pos.z);
      const angle = Math.random() * Math.PI * 2;
      const spd = 2.2 + Math.random() * 4.5;
      const vel = new THREE.Vector3(
        Math.cos(angle) * spd,
        1.2 + Math.random() * 3.4,
        Math.sin(angle) * spd
      );
      this.scene.add(mesh);
      this.sparks.push({ mesh, vel, age: 0, maxAge: 0.28 + Math.random() * 0.16 });
    }
  }

  private rebuildTrailGeometry(trailColorHex: number, isPowerShot: boolean): void {
    const count = this.trailHistory.length;
    if (count < 2) {
      this.trailMesh.visible = false;
      return;
    }

    this.trailMat.color.setHex(trailColorHex);
    this.trailMat.opacity = isPowerShot ? 0.92 : 0.84;

    const maxRadius = BALL_RADIUS * (isPowerShot ? 2.15 : 1.82);
    const vertsPerRibbon = this.trailMax * 2;
    const pos = this.trailPositions;
    const uv = this.trailUvs;

    for (let i = 0; i < this.trailMax; i++) {
      const idx = Math.min(i, count - 1);
      const pt = this.trailHistory[idx];
      const prev = this.trailHistory[Math.max(0, idx - 1)];
      const next = this.trailHistory[Math.min(count - 1, idx + 1)];

      this.tmpDir.subVectors(prev, next);
      if (this.tmpDir.lengthSq() < 1e-6) {
        this.tmpDir.set(0, 0, -1);
      } else {
        this.tmpDir.normalize();
      }

      const refAxis = Math.abs(this.tmpDir.dot(this.tmpUp)) > 0.92 ? this.tmpAlt : this.tmpUp;
      this.tmpSideA.crossVectors(this.tmpDir, refAxis).normalize();
      this.tmpSideB.crossVectors(this.tmpDir, this.tmpSideA).normalize();

      const u = i < count ? i / Math.max(1, count - 1) : 1.0;
      // Sleek tapered swoosh: slim behind ball, graceful taper to sharp tip at tail
      const taper = Math.pow(Math.max(0, 1 - u), 1.35);
      const radius = maxRadius * taper;

      // Ribbon 0 along sideA
      const v0 = i * 2;
      const p0 = v0 * 3;
      const uv0 = v0 * 2;
      pos[p0] = pt.x + this.tmpSideA.x * radius;
      pos[p0 + 1] = pt.y + this.tmpSideA.y * radius;
      pos[p0 + 2] = pt.z + this.tmpSideA.z * radius;
      pos[p0 + 3] = pt.x - this.tmpSideA.x * radius;
      pos[p0 + 4] = pt.y - this.tmpSideA.y * radius;
      pos[p0 + 5] = pt.z - this.tmpSideA.z * radius;

      uv[uv0] = u;
      uv[uv0 + 1] = 0;
      uv[uv0 + 2] = u;
      uv[uv0 + 3] = 1;

      // Ribbon 1 along sideB
      const v1 = vertsPerRibbon + i * 2;
      const p1 = v1 * 3;
      const uv1 = v1 * 2;
      pos[p1] = pt.x + this.tmpSideB.x * radius;
      pos[p1 + 1] = pt.y + this.tmpSideB.y * radius;
      pos[p1 + 2] = pt.z + this.tmpSideB.z * radius;
      pos[p1 + 3] = pt.x - this.tmpSideB.x * radius;
      pos[p1 + 4] = pt.y - this.tmpSideB.y * radius;
      pos[p1 + 5] = pt.z - this.tmpSideB.z * radius;

      uv[uv1] = u;
      uv[uv1 + 1] = 0;
      uv[uv1 + 2] = u;
      uv[uv1 + 3] = 1;
    }

    (this.trailGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.trailGeo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
    this.trailMesh.visible = true;
  }

  public sync(
    active: boolean,
    pos: [number, number, number],
    vel: [number, number, number],
    spin: number,
    shotType: TennisShotType,
    isPowerShot: boolean,
    targetMarker: { visible: boolean; x: number; z: number; urgency: number; team: TennisTeamId },
    dt: number
  ): void {
    this.ballMesh.visible = active;
    this.shadowMesh.visible = active;

    if (active) {
      this.ballMesh.position.set(pos[0], pos[1], pos[2]);
      this.ballMesh.rotation.x += (vel[2] * 0.65 + spin * 20) * dt;
      this.ballMesh.rotation.z -= vel[0] * 0.65 * dt;

      const trailColor = isPowerShot ? 0xff453a : SHOT_TRAIL_COLORS[shotType];
      this.ballMat.emissive.setHex(isPowerShot ? 0xff6b2b : 0x9be824);
      this.ballMat.emissiveIntensity = isPowerShot ? 0.45 : 0.16;

      this.shadowMesh.position.set(pos[0], 0.011, pos[2]);
      const heightFactor = THREE.MathUtils.clamp(1 - pos[1] / 7.5, 0.28, 1.0);
      this.shadowMesh.scale.setScalar(0.65 + (1 - heightFactor) * 0.65);
      this.shadowMat.opacity = 0.56 * heightFactor;

      const speed = Math.hypot(vel[0], vel[1], vel[2]);
      if (speed > 2.2) {
        this.trailHistory.unshift(new THREE.Vector3(pos[0], pos[1], pos[2]));
        if (this.trailHistory.length > this.trailMax) {
          this.trailHistory.pop();
        }
        this.rebuildTrailGeometry(trailColor, isPowerShot);
      } else if (this.trailHistory.length < 2) {
        this.trailMesh.visible = false;
      }
    } else {
      this.clearTrail();
    }

    this.timingGroup.visible = targetMarker.visible;
    if (targetMarker.visible) {
      this.timingGroup.position.set(targetMarker.x, 0.017, targetMarker.z);
      const scale = THREE.MathUtils.lerp(2.15, 0.72, THREE.MathUtils.clamp(targetMarker.urgency, 0, 1));
      this.timingInnerRing.scale.setScalar(scale);
      const inSweetSpot = targetMarker.urgency >= 0.72 && targetMarker.urgency <= 0.96;
      this.timingInnerMat.color.setHex(inSweetSpot ? 0x58f947 : 0x38e8ff);
      this.timingOuterMat.color.setHex(inSweetSpot ? 0xfef08a : 0xffffff);
    }

    for (let i = this.bounceRings.length - 1; i >= 0; i--) {
      const r = this.bounceRings[i];
      r.age += dt;
      if (r.age >= r.maxAge) {
        this.scene.remove(r.mesh);
        r.mat.dispose();
        this.bounceRings.splice(i, 1);
      } else {
        const t = r.age / r.maxAge;
        r.mesh.scale.setScalar(1 + t * 2.6);
        r.mat.opacity = (1 - t) * 0.85;
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.maxAge) {
        this.scene.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        this.sparks.splice(i, 1);
      } else {
        s.vel.y -= 11 * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        const t = s.age / s.maxAge;
        s.mesh.scale.setScalar(1 - t * 0.75);
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      }
    }
  }

  public dispose(): void {
    this.scene.remove(this.ballMesh, this.shadowMesh, this.trailMesh, this.timingGroup);
    for (const r of this.bounceRings) {
      this.scene.remove(r.mesh);
      r.mat.dispose();
    }
    for (const s of this.sparks) {
      this.scene.remove(s.mesh);
      (s.mesh.material as THREE.Material).dispose();
    }
    for (const d of this.disposables) d.dispose();
  }
}

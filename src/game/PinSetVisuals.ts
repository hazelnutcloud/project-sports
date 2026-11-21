import * as THREE from 'three';
import {
  HEAD_PIN_Z,
  LANE_WIDTH,
  PIN_LOCAL_OFFSETS,
  PIN_REST_Y,
  PIN_ROW_DZ,
  SETTER_PARK_Y,
  SETTER_PARK_Z_OFFSET,
  SWEEPER_PARK_Y,
  SWEEPER_PARK_Z,
  getLaneCenterX,
  type BodyPose,
  type LaneClearingVisualState,
} from './PhysicsWorld';
import type { LaneClearingSnapshot } from '../types/game';

function createPinGeometry(): THREE.BufferGeometry {
  // Authentic USBC bowling pin silhouette (height 0.381 m), shifted down by 0.145 m
  // so mesh origin aligns with the Rapier3D rigid body's center of mass.
  const yOffset = -PIN_REST_Y;
  const profile: Array<[number, number]> = [
    [0.0, 0.0],
    [0.0285, 0.0],
    [0.032, 0.008],
    [0.037, 0.022],
    [0.0525, 0.062],
    [0.0605, 0.114], // widest belly
    [0.057, 0.158],
    [0.042, 0.202],
    [0.0245, 0.245], // narrow neck
    [0.0235, 0.276],
    [0.0308, 0.316],
    [0.0325, 0.346], // head crown
    [0.0265, 0.368],
    [0.0145, 0.378],
    [0.0, 0.381],
  ];

  const points = profile.map(([r, y]) => new THREE.Vector2(r, y + yOffset));
  const geom = new THREE.LatheGeometry(points, 32);
  geom.computeVertexNormals();
  return geom;
}

function createSpoccoPinTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Glossy crisp pearl-white lacquer body
  const grad = ctx.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0.0, '#ffffff');
  grad.addColorStop(0.82, '#f6f8fc');
  grad.addColorStop(1.0, '#e3e8f0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);

  // Vivid hot-pink base band near bottom (matching frame_05 & frame_06!)
  ctx.fillStyle = '#e81f84';
  ctx.fillRect(0, 926, 1024, 34);

  // Crisp double zigzag chevron band around the slender neck
  const drawChevron = (baseY: number, color: string, amp: number, thickness: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 4;
    ctx.beginPath();
    const teeth = 10;
    const step = 1024 / teeth;
    for (let i = 0; i <= teeth; i++) {
      const x = i * step;
      const y = i % 2 === 0 ? baseY - amp : baseY + amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  drawChevron(324, '#2563eb', 20, 20); // Electric blue upper chevron
  drawChevron(372, '#ec1f86', 22, 26); // Vivid pink lower chevron

  // Crisp metallic-slate Spocco Square circular 'S' emblem on front belly
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.72)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(512, 658, 66, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(71, 85, 105, 0.78)';
  ctx.font = '900 72px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', 512, 662);

  // Micro "SPOCCO SQUARE" brand line underneath emblem (matching close-up in frame_05!)
  ctx.font = '800 18px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(100, 116, 139, 0.68)';
  ctx.fillText('SPOCCO SQUARE', 512, 748);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function createPinsetterDeckGeometry(): THREE.BufferGeometry {
  // Trapezoidal carrier plate shaped to wrap the 10-pin triangle cleanly
  const frontZ = HEAD_PIN_Z + 0.08;
  const backZ = HEAD_PIN_Z - PIN_ROW_DZ * 3 - 0.11;
  const frontHalfW = 0.14;
  const backHalfW = 0.56;

  const shape = new THREE.Shape();
  // Shape lies in XY, rotated -PI/2 around X so +Y maps to -Z
  shape.moveTo(-frontHalfW, -frontZ);
  shape.lineTo(frontHalfW, -frontZ);
  shape.lineTo(backHalfW, -backZ);
  shape.lineTo(-backHalfW, -backZ);
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: 0.036,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  geom.rotateX(-Math.PI / 2);
  return geom;
}

let sharedPinGeom: THREE.BufferGeometry | null = null;
let sharedPinMat: THREE.MeshPhysicalMaterial | null = null;

function getSharedPinAssets() {
  if (!sharedPinGeom) sharedPinGeom = createPinGeometry();
  if (!sharedPinMat) {
    sharedPinMat = new THREE.MeshPhysicalMaterial({
      map: createSpoccoPinTexture(),
      roughness: 0.12,
      metalness: 0.02,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.2,
    });
  }
  return { geom: sharedPinGeom, mat: sharedPinMat };
}

/**
 * Places a static decorative 10-pin rack on flanking visual-only outer lanes (-1 and 5)
 * so the 7-lane Spocco Square vista looks full and authentic.
 */
export function createDecorativePinSet(parent: THREE.Object3D, laneIndex: number): THREE.Group {
  const group = new THREE.Group();
  const centerX = getLaneCenterX(laneIndex);
  const { geom, mat } = getSharedPinAssets();

  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const [ox, oz] = PIN_LOCAL_OFFSETS[i];
    mesh.position.set(centerX + ox, PIN_REST_Y, oz);
    group.add(mesh);
  }

  parent.add(group);
  return group;
}

/**
 * Renders the 10 Spocco Square pins, animated mechanical sweeper bar,
 * and overhead pinsetter gripper deck for one lane.
 */
export class PinSetVisuals {
  public readonly laneIndex: number;
  private readonly centerX: number;
  private readonly group = new THREE.Group();
  private readonly pinMeshes: THREE.Mesh[] = [];
  private readonly sweeperGroup = new THREE.Group();
  private readonly pinsetterGroup = new THREE.Group();
  private readonly gripperLedMeshes: THREE.Mesh[] = [];
  private readonly ledIdleMat: THREE.MeshStandardMaterial;
  private readonly ledActiveMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, laneIndex: number) {
    this.laneIndex = laneIndex;
    this.centerX = getLaneCenterX(laneIndex);
    const { geom, mat } = getSharedPinAssets();

    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const [ox, oz] = PIN_LOCAL_OFFSETS[i];
      mesh.position.set(this.centerX + ox, PIN_REST_Y, oz);
      this.pinMeshes.push(mesh);
      this.group.add(mesh);
    }

    // Shared mechanical materials
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x16202e,
      roughness: 0.3,
      metalness: 0.72,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.22,
      metalness: 0.85,
    });
    const cyanAccentMat = new THREE.MeshStandardMaterial({
      color: 0x4efce6,
      emissive: 0x2de8d4,
      emissiveIntensity: 1.2,
      roughness: 0.2,
    });
    this.ledIdleMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: 0x0f172a,
      emissiveIntensity: 0.2,
      roughness: 0.35,
      metalness: 0.5,
    });
    this.ledActiveMat = new THREE.MeshStandardMaterial({
      color: 0x5efce8,
      emissive: 0x2de8d4,
      emissiveIntensity: 1.8,
      roughness: 0.15,
    });

    // 1. Sleek mechanical sweeper bar (local y=0 matches physics blade center at SWEEPER_DOWN_Y)
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH + 0.08, 0.11, 0.075),
      darkSteelMat
    );
    blade.castShadow = true;
    this.sweeperGroup.add(blade);

    // Soft dark rubber bottom sweep edge
    const rubberLip = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH + 0.1, 0.022, 0.082),
      new THREE.MeshStandardMaterial({ color: 0x0c1118, roughness: 0.85, metalness: 0.1 })
    );
    rubberLip.position.y = -0.052;
    this.sweeperGroup.add(rubberLip);

    const accentStrip = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH - 0.06, 0.018, 0.082),
      cyanAccentMat
    );
    accentStrip.position.y = 0.014;
    this.sweeperGroup.add(accentStrip);

    // Compact swept-back chrome support arms so parked sweeper tucks cleanly under the lightbox
    for (const side of [-1, 1] as const) {
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.032, 0.20, 0.042),
        chromeMat
      );
      arm.position.set(side * (LANE_WIDTH * 0.5 + 0.022), 0.11, -0.02);
      arm.rotation.x = 0.16;
      this.sweeperGroup.add(arm);
    }

    this.sweeperGroup.position.set(this.centerX, SWEEPER_PARK_Y, SWEEPER_PARK_Z);
    this.group.add(this.sweeperGroup);

    // 2. Overhead Pinsetter Gripper Table (descends to grip & raise standing pins / lower fresh rack)
    const deckPlate = new THREE.Mesh(createPinsetterDeckGeometry(), darkSteelMat);
    deckPlate.position.y = 0.012;
    deckPlate.castShadow = true;
    this.pinsetterGroup.add(deckPlate);

    // Glowing cyan front accent nose on the pinsetter carrier plate
    const noseAccent = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.014, 0.022),
      cyanAccentMat
    );
    noseAccent.position.set(0, 0.03, HEAD_PIN_Z + 0.088);
    this.pinsetterGroup.add(noseAccent);

    // 10 individual pin-cup grippers aligned to PIN_LOCAL_OFFSETS[0..9]
    const cupOuterGeom = new THREE.CylinderGeometry(0.044, 0.048, 0.105, 18, 1, true);
    const cupCollarGeom = new THREE.TorusGeometry(0.046, 0.007, 8, 20);
    const cupLedGeom = new THREE.TorusGeometry(0.048, 0.005, 8, 20);
    cupCollarGeom.rotateX(Math.PI / 2);
    cupLedGeom.rotateX(Math.PI / 2);

    for (let i = 0; i < 10; i++) {
      const [ox, oz] = PIN_LOCAL_OFFSETS[i];
      const cupGroup = new THREE.Group();
      cupGroup.position.set(ox, 0, oz);

      const sleeve = new THREE.Mesh(cupOuterGeom, darkSteelMat);
      sleeve.position.y = -0.042;
      cupGroup.add(sleeve);

      const collar = new THREE.Mesh(cupCollarGeom, chromeMat);
      collar.position.y = -0.092;
      cupGroup.add(collar);

      const ledRing = new THREE.Mesh(cupLedGeom, this.ledIdleMat);
      ledRing.position.y = -0.012;
      cupGroup.add(ledRing);
      this.gripperLedMeshes.push(ledRing);

      this.pinsetterGroup.add(cupGroup);
    }

    // Dual brushed-chrome vertical actuator lift columns anchored at back of carrier plate
    // (z = -18.95 goes straight up inside the dark PitBay behind the SPOCCO SQUARE lightbox)
    const rodGeom = new THREE.CylinderGeometry(0.022, 0.022, 0.72, 14);
    const rodZ = HEAD_PIN_Z - PIN_ROW_DZ * 2.5;
    for (const side of [-1, 1] as const) {
      const rod = new THREE.Mesh(rodGeom, chromeMat);
      rod.position.set(side * 0.34, 0.39, rodZ);
      this.pinsetterGroup.add(rod);
    }

    this.pinsetterGroup.position.set(this.centerX, SETTER_PARK_Y, SETTER_PARK_Z_OFFSET);
    this.pinsetterGroup.visible = false;
    this.group.add(this.pinsetterGroup);

    scene.add(this.group);
  }

  public syncClearing(
    clearing: LaneClearingVisualState | LaneClearingSnapshot | undefined
  ): void {
    if (!clearing) {
      this.sweeperGroup.position.set(this.centerX, SWEEPER_PARK_Y, SWEEPER_PARK_Z);
      this.pinsetterGroup.visible = false;
      return;
    }

    this.sweeperGroup.position.set(this.centerX, clearing.sweeperY, clearing.sweeperZ);
    this.pinsetterGroup.visible = clearing.setterVisible;
    if (clearing.setterVisible) {
      this.pinsetterGroup.position.set(
        this.centerX,
        clearing.setterY,
        clearing.setterZOffset
      );
      const gripped = new Set(clearing.grippedPinIds);
      for (let i = 0; i < 10; i++) {
        this.gripperLedMeshes[i].material = gripped.has(i)
          ? this.ledActiveMat
          : this.ledIdleMat;
      }
    }
  }

  public syncFromPoses(poses: Array<BodyPose | null>): void {
    for (let i = 0; i < 10; i++) {
      const pose = poses[i];
      const mesh = this.pinMeshes[i];
      if (!pose) {
        mesh.visible = false;
      } else {
        mesh.visible = true;
        mesh.position.set(pose.x, pose.y, pose.z);
        mesh.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
      }
    }
  }

  public syncFromTupleArray(
    pins: Array<[number, number, number, number, number, number, number] | null>
  ): void {
    for (let i = 0; i < 10; i++) {
      const p = pins[i];
      const mesh = this.pinMeshes[i];
      if (!p) {
        mesh.visible = false;
      } else {
        mesh.visible = true;
        mesh.position.set(p[0], p[1], p[2]);
        mesh.quaternion.set(p[3], p[4], p[5], p[6]);
      }
    }
  }
}

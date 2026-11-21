import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BALL_COLORS, type BallColorId } from '../../types/game';
import type { TennisAvatarSnapshot, TennisTeamId } from '../../types/tennis';

const PLAYER_MODEL_URL = '/models/tennis_player.glb';
const RIVAL_MODEL_URL = '/models/tennis_rival.glb';

// Shared GLB template cache so singles (2) or doubles (4) fetch each model once
const cachedModelPromises = new Map<string, Promise<GLTF>>();
function loadModelTemplate(url: string): Promise<GLTF> {
  let p = cachedModelPromises.get(url);
  if (!p) {
    const loader = new GLTFLoader();
    p = loader.loadAsync(url).catch((err) => {
      cachedModelPromises.delete(url);
      throw err;
    });
    cachedModelPromises.set(url, p);
  }
  return p;
}

/**
 * Helper binding a bone or transform node with its rest pose + character-space basis,
 * allowing anatomically accurate delta rotations regardless of Blender bone roll axes.
 */
interface JointBinding {
  node: THREE.Object3D;
  restPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  parentWorldQuatInv: THREE.Quaternion;
}

const _qDelta = new THREE.Quaternion();
const _qAxis = new THREE.Quaternion();
const _vAxis = new THREE.Vector3();
const _charX = new THREE.Vector3(1, 0, 0);
const _charY = new THREE.Vector3(0, 1, 0);
const _charZ = new THREE.Vector3(0, 0, 1);

function captureJoint(
  modelRoot: THREE.Object3D,
  candidates: string[]
): JointBinding | null {
  let found: THREE.Object3D | null = null;
  for (const name of candidates) {
    found = modelRoot.getObjectByName(name) ?? null;
    if (found) break;
  }
  if (!found) {
    const lowerCandidates = candidates.map((c) => c.toLowerCase());
    modelRoot.traverse((obj) => {
      if (found) return;
      const ln = obj.name.toLowerCase();
      if (lowerCandidates.includes(ln)) {
        found = obj;
      }
    });
  }
  if (!found) return null;

  modelRoot.updateMatrixWorld(true);
  const rootWorldQuat = new THREE.Quaternion();
  modelRoot.getWorldQuaternion(rootWorldQuat);
  const rootWorldQuatInv = rootWorldQuat.clone().invert();

  const parentWorldQuat = new THREE.Quaternion();
  if (found.parent) {
    found.parent.getWorldQuaternion(parentWorldQuat);
  }
  const parentInRoot = rootWorldQuatInv.clone().multiply(parentWorldQuat);

  return {
    node: found,
    restPos: found.position.clone(),
    restQuat: found.quaternion.clone(),
    parentWorldQuatInv: parentInRoot.invert(),
  };
}

function applyJointDelta(
  joint: JointBinding | null,
  pitchX: number,
  yawY: number,
  rollZ: number
): void {
  if (!joint) return;
  _qDelta.identity();

  if (yawY !== 0) {
    _vAxis.copy(_charY).applyQuaternion(joint.parentWorldQuatInv);
    _qAxis.setFromAxisAngle(_vAxis, yawY);
    _qDelta.premultiply(_qAxis);
  }
  if (pitchX !== 0) {
    _vAxis.copy(_charX).applyQuaternion(joint.parentWorldQuatInv);
    _qAxis.setFromAxisAngle(_vAxis, pitchX);
    _qDelta.premultiply(_qAxis);
  }
  if (rollZ !== 0) {
    _vAxis.copy(_charZ).applyQuaternion(joint.parentWorldQuatInv);
    _qAxis.setFromAxisAngle(_vAxis, rollZ);
    _qDelta.premultiply(_qAxis);
  }

  joint.node.quaternion.copy(_qDelta).multiply(joint.restQuat);
}

/**
 * Tight, soft elliptical ground AO contact shadow right under a player's sneakers.
 */
function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.48);
  grad.addColorStop(0.0, 'rgba(8, 22, 48, 0.52)');
  grad.addColorStop(0.45, 'rgba(10, 26, 54, 0.24)');
  grad.addColorStop(0.78, 'rgba(12, 30, 58, 0.06)');
  grad.addColorStop(1.0, 'rgba(12, 30, 58, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Refined feathered ground indicator ring (subtle gameplay cue, never a harsh debug halo).
 */
function createSubtleFloorRingTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;

  const grad = ctx.createRadialGradient(cx, cy, size * 0.36, cx, cy, size * 0.49);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.0)');
  grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.22)');
  grad.addColorStop(0.58, 'rgba(255, 255, 255, 0.78)');
  grad.addColorStop(0.72, 'rgba(255, 255, 255, 0.18)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface TennisAvatarDiagnostics {
  usingGlb: boolean;
  modelUrl: string;
  foundJoints: string[];
  materialNames: string[];
  bboxMin: [number, number, number] | null;
  bboxMax: [number, number, number] | null;
}

/**
 * Stylized articulated Spocco Sportsmate tennis avatar:
 * - Loads `/models/tennis_player.glb` for near team and `/models/tennis_rival.glb` for far rival
 *   (falling back gracefully to tinted `tennis_player.glb` if rival GLB is absent)
 * - ZERO artificial emissive wash on skin/face/clothing so directional sun + sky fill sculpt rich 3D form!
 * - Crisp double-sided racket strings, honored baked AO maps, per-instance outfit tinting
 * - Fluid athletic tennis key poses: natural forward-right ready hold, waist-high forehand drive (zero head clip!),
 *   side-on L-cocked pro trophy serve pose, grounded bent-knee wide stances flush at Y = 0.000
 */
export class TennisAvatar {
  public readonly ready: Promise<void>;

  private readonly root = new THREE.Group();
  private readonly modelHolder = new THREE.Group();
  private readonly fallbackGroup = new THREE.Group();
  private readonly floorRing: THREE.Mesh;
  private readonly contactShadow: THREE.Mesh;
  private readonly leftShoeShadow: THREE.Mesh;
  private readonly rightShoeShadow: THREE.Mesh;
  private readonly tmpFootPos = new THREE.Vector3();

  private usingGlb = false;
  private loadedModelUrl = '';
  private glbModel: THREE.Object3D | null = null;
  private restBaseY = 0;
  private jointPelvis: JointBinding | null = null;
  private jointSpine: JointBinding | null = null;
  private jointChest: JointBinding | null = null;
  private jointHead: JointBinding | null = null;
  private jointArmR: JointBinding | null = null;
  private jointForearmR: JointBinding | null = null;
  private jointHandR: JointBinding | null = null;
  private jointArmL: JointBinding | null = null;
  private jointForearmL: JointBinding | null = null;
  private jointLegL: JointBinding | null = null;
  private jointShinL: JointBinding | null = null;
  private jointFootL: JointBinding | null = null;
  private jointLegR: JointBinding | null = null;
  private jointShinR: JointBinding | null = null;
  private jointFootR: JointBinding | null = null;
  private jointRacket: JointBinding | null = null;

  private readonly jerseyMats: THREE.MeshStandardMaterial[] = [];
  private readonly accentMats: THREE.MeshStandardMaterial[] = [];
  private readonly allMaterialNames: string[] = [];

  private readonly fbBody = new THREE.Group();
  private readonly fbRightArm = new THREE.Group();
  private readonly fbLeftArm = new THREE.Group();
  private readonly fbLeftLeg = new THREE.Group();
  private readonly fbRightLeg = new THREE.Group();
  private readonly fbJerseyMat: THREE.MeshStandardMaterial;
  private readonly fbTrimMat: THREE.MeshStandardMaterial;

  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly disposables: Array<{ dispose: () => void }> = [];

  private stridePhase = 0;
  private idlePhase = Math.random() * Math.PI * 2;
  private currentColor: BallColorId;
  private readonly team: TennisTeamId;
  private readonly isHuman: boolean;
  private isDistinctRivalMesh = false;

  constructor(scene: THREE.Scene, color: BallColorId, team: TennisTeamId, isHuman: boolean) {
    this.currentColor = color;
    this.team = team;
    this.isHuman = isHuman;
    const spec = BALL_COLORS[color];

    // Soft body-span ambient shadow + twin per-shoe contact AO shadows tracking each sneaker sole at Y = 0.0025!
    const shadowTex = createContactShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(0.95, 0.72);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });
    this.contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.003;
    this.root.add(this.contactShadow);

    const shoeShadowGeo = new THREE.PlaneGeometry(0.32, 0.44);
    const shoeShadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.leftShoeShadow = new THREE.Mesh(shoeShadowGeo, shoeShadowMat);
    this.leftShoeShadow.rotation.x = -Math.PI / 2;
    this.leftShoeShadow.position.set(0.14, 0.0028, 0.02);
    this.root.add(this.leftShoeShadow);

    this.rightShoeShadow = new THREE.Mesh(shoeShadowGeo, shoeShadowMat);
    this.rightShoeShadow.rotation.x = -Math.PI / 2;
    this.rightShoeShadow.position.set(-0.14, 0.0028, 0.02);
    this.root.add(this.rightShoeShadow);

    this.disposables.push(shadowTex, shadowGeo, shadowMat, shoeShadowGeo, shoeShadowMat);

    // Sleek subtle feathered floor ring
    const ringTex = createSubtleFloorRingTexture();
    const ringGeo = new THREE.PlaneGeometry(1.02, 1.02);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: spec.primary,
      map: ringTex,
      transparent: true,
      opacity: isHuman ? 0.32 : 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.floorRing = new THREE.Mesh(ringGeo, this.ringMat);
    this.floorRing.rotation.x = -Math.PI / 2;
    this.floorRing.position.y = 0.012;
    this.root.add(this.floorRing);
    this.disposables.push(ringTex, ringGeo, this.ringMat);

    this.fbJerseyMat = new THREE.MeshStandardMaterial({ color: spec.primary, roughness: 0.68 });
    this.fbTrimMat = new THREE.MeshStandardMaterial({ color: spec.swirl, roughness: 0.55 });
    this.disposables.push(this.fbJerseyMat, this.fbTrimMat);
    this.buildFallbackAvatar(team);
    this.fallbackGroup.visible = false;
    this.root.add(this.fallbackGroup);

    this.root.add(this.modelHolder);
    scene.add(this.root);

    this.ready = this.loadGlbModel();
  }

  public setFloorRingVisible(visible: boolean): void {
    this.floorRing.visible = visible;
  }

  private async loadGlbModel(): Promise<void> {
    try {
      let gltf: GLTF;
      if (this.team === 'far') {
        try {
          gltf = await loadModelTemplate(RIVAL_MODEL_URL);
          this.loadedModelUrl = RIVAL_MODEL_URL;
          this.isDistinctRivalMesh = true;
        } catch {
          gltf = await loadModelTemplate(PLAYER_MODEL_URL);
          this.loadedModelUrl = PLAYER_MODEL_URL;
          this.isDistinctRivalMesh = false;
        }
      } else {
        gltf = await loadModelTemplate(PLAYER_MODEL_URL);
        this.loadedModelUrl = PLAYER_MODEL_URL;
        this.isDistinctRivalMesh = false;
      }

      const cloned = SkeletonUtils.clone(gltf.scene);
      this.glbModel = cloned;

      const clonedMatMap = new Map<THREE.Material, THREE.Material>();

      cloned.traverse((obj) => {
        if (!(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        const srcMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const instMats = srcMats.map((m) => {
          if (!m) return m;
          const existing = clonedMatMap.get(m);
          if (existing) return existing;

          const mName = m.name || '';
          if (mName) this.allMaterialNames.push(mName);
          const lm = mName.toLowerCase();

          const isJersey =
            lm.includes('playerjersey') ||
            lm.includes('jersey') ||
            lm.includes('shirt') ||
            lm.includes('polo') ||
            lm.includes('top');
          const isAccent =
            lm.includes('playeraccent') ||
            lm.includes('accent') ||
            lm.includes('trim') ||
            lm.includes('headband') ||
            lm.includes('visorband') ||
            lm.includes('wristband');
          const isHair = lm.includes('hair');

          let mat = m;
          if (isJersey || isAccent || isHair) {
            mat = m.clone();
            this.disposables.push(mat);
          }

          if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const std = mat as THREE.MeshStandardMaterial;
            for (const tex of [std.map, std.roughnessMap, std.normalMap, std.aoMap]) {
              if (tex) {
                tex.anisotropy = 8;
                tex.needsUpdate = true;
              }
            }
            if (std.aoMap) {
              std.aoMapIntensity = 0.95;
            }

            // ZERO artificial emissive on skin/face/clothing so directional sun & sky fill sculpt crisp 3D form!
            if (lm.includes('tripobody') || lm.includes('tripo')) {
              // Preserve baked Tripo PBR albedo untouched (never multiply flat team tint over skin/face!)
              std.color.setHex(0xffffff);
              std.roughness = Math.max(std.roughness, 0.66);
              std.metalness = 0.0;
              std.emissive.setHex(0x000000);
              std.emissiveIntensity = 0.0;
              std.envMapIntensity = 0.36;
            } else if (isJersey) {
              std.roughness = Math.max(std.roughness, 0.72);
              std.metalness = 0.0;
              std.envMapIntensity = 0.35;
              // Only tint solid untextured jerseys (preserve rich baked textures if present!)
              if (!std.map && !this.isDistinctRivalMesh) {
                this.jerseyMats.push(std);
              }
            } else if (isAccent) {
              std.roughness = Math.max(std.roughness, 0.58);
              std.envMapIntensity = 0.42;
              if (!std.map && !this.isDistinctRivalMesh) {
                this.accentMats.push(std);
              }
            } else if (lm.includes('skin') || lm.includes('playerface') || lm === 'mat_face') {
              std.roughness = Math.max(std.roughness, 0.56);
              std.metalness = 0.0;
              std.emissive.setHex(0x000000);
              std.emissiveIntensity = 0.0;
              std.envMapIntensity = 0.36;
            } else if (lm.includes('shorts') || lm.includes('skort') || lm.includes('skirt')) {
              std.roughness = Math.max(std.roughness, 0.78);
              std.metalness = 0.0;
              std.envMapIntensity = 0.3;
            } else if (lm.includes('string')) {
              // Crisp high-visibility double-sided strings (stay legible even at grazing 3/4 angles!)
              std.side = THREE.DoubleSide;
              std.roughness = 0.32;
              std.metalness = 0.04;
              std.envMapIntensity = 0.9;
              if (std.alphaTest > 0 || std.transparent) {
                std.alphaTest = Math.max(std.alphaTest, 0.18);
                std.transparent = false;
                std.depthWrite = true;
              }
            } else if (lm.includes('racketframe') || lm.includes('racket_frame')) {
              std.roughness = Math.min(std.roughness, 0.32);
              std.metalness = Math.max(std.metalness, 0.25);
              std.envMapIntensity = 1.1;
            } else if (lm.includes('eyeiris') || lm.includes('eyespec')) {
              std.roughness = Math.min(std.roughness, 0.1);
              std.envMapIntensity = 1.15;
            } else if (isHair) {
              std.roughness = Math.max(std.roughness, 0.48);
              std.envMapIntensity = 0.48;
              if (this.team === 'far' && !this.isDistinctRivalMesh && !std.map) {
                std.color.offsetHSL(0.03, 0.06, 0.07);
              }
            } else {
              std.envMapIntensity = 0.42;
            }
            std.needsUpdate = true;
          }

          clonedMatMap.set(m, mat);
          return mat;
        });

        mesh.material = Array.isArray(mesh.material) ? instMats : instMats[0];
      });

      this.modelHolder.add(cloned);
      this.modelHolder.updateMatrixWorld(true);

      // Auto-ground rest sneaker soles cleanly at Y = 0.0
      const box = new THREE.Box3().setFromObject(cloned);
      if (!box.isEmpty() && Number.isFinite(box.min.y)) {
        if (Math.abs(box.min.y) > 0.002 && Math.abs(box.min.y) < 1.2) {
          cloned.position.y -= box.min.y;
        }
      }
      this.restBaseY = cloned.position.y;
      this.modelHolder.updateMatrixWorld(true);

      // Bind all 17 spec bones / groups
      this.jointPelvis = captureJoint(cloned, ['Pelvis', 'Hips', 'Body', 'Root_Body']);
      this.jointSpine = captureJoint(cloned, ['Spine', 'Torso', 'Waist']);
      this.jointChest = captureJoint(cloned, ['Chest', 'UpperTorso', 'Spine1', 'Spine2']);
      this.jointHead = captureJoint(cloned, ['Head', 'Neck_Head']);
      this.jointArmR = captureJoint(cloned, ['Arm_R', 'UpperArm_R', 'Shoulder_R', 'RightArm']);
      this.jointForearmR = captureJoint(cloned, ['Forearm_R', 'LowerArm_R', 'RightForeArm']);
      this.jointHandR = captureJoint(cloned, ['Hand_R', 'RightHand']);
      this.jointArmL = captureJoint(cloned, ['Arm_L', 'UpperArm_L', 'Shoulder_L', 'LeftArm']);
      this.jointForearmL = captureJoint(cloned, ['Forearm_L', 'LowerArm_L', 'LeftForeArm']);
      this.jointLegL = captureJoint(cloned, ['Leg_L', 'Thigh_L', 'UpperLeg_L', 'LeftUpLeg']);
      this.jointShinL = captureJoint(cloned, ['Shin_L', 'Calf_L', 'LowerLeg_L', 'LeftLeg']);
      this.jointFootL = captureJoint(cloned, ['Foot_L', 'LeftFoot']);
      this.jointLegR = captureJoint(cloned, ['Leg_R', 'Thigh_R', 'UpperLeg_R', 'RightUpLeg']);
      this.jointShinR = captureJoint(cloned, ['Shin_R', 'Calf_R', 'LowerLeg_R', 'RightLeg']);
      this.jointFootR = captureJoint(cloned, ['Foot_R', 'RightFoot']);
      this.jointRacket = captureJoint(cloned, ['RacketRoot', 'Racket', 'TennisRacket']);

      this.usingGlb = true;
      this.fallbackGroup.visible = false;
      this.applyOutfitColor(this.currentColor);
    } catch (err) {
      console.warn('[TennisAvatar] /models/tennis_player.glb unavailable, using fallback avatar:', err);
      this.usingGlb = false;
      this.fallbackGroup.visible = true;
    }
  }

  private buildFallbackAvatar(team: TennisTeamId): void {
    const skinMat = new THREE.MeshStandardMaterial({ color: '#f6c09e', roughness: 0.6 });
    const hairMat = new THREE.MeshStandardMaterial({
      color: team === 'near' ? '#2c221e' : '#533928',
      roughness: 0.65,
    });
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 });
    const shortsMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.78 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#162436', roughness: 0.4 });
    const stringMat = new THREE.MeshBasicMaterial({
      color: '#f8fafc',
      transparent: true,
      opacity: 0.72,
      wireframe: true,
    });
    this.disposables.push(skinMat, hairMat, whiteMat, shortsMat, darkMat, stringMat);

    this.fallbackGroup.add(this.fbBody);

    const legGeo = new THREE.CapsuleGeometry(0.085, 0.44, 6, 10);
    const shoeGeo = new THREE.BoxGeometry(0.16, 0.11, 0.28);
    this.disposables.push(legGeo, shoeGeo);

    for (const [pivot, xOff] of [
      [this.fbLeftLeg, 0.13],
      [this.fbRightLeg, -0.13],
    ] as const) {
      pivot.position.set(xOff, 0.76, 0);
      const leg = new THREE.Mesh(legGeo, skinMat);
      leg.position.y = -0.32;
      leg.castShadow = true;
      pivot.add(leg);
      const shoe = new THREE.Mesh(shoeGeo, whiteMat);
      shoe.position.set(0, -0.7, 0.05);
      shoe.castShadow = true;
      pivot.add(shoe);
      this.fbBody.add(pivot);
    }

    const shortsGeo = new THREE.CylinderGeometry(0.22, 0.24, 0.28, 14);
    const shorts = new THREE.Mesh(shortsGeo, shortsMat);
    shorts.position.y = 0.84;
    shorts.castShadow = true;
    this.fbBody.add(shorts);

    const torsoGeo = new THREE.CapsuleGeometry(0.22, 0.34, 8, 14);
    const torso = new THREE.Mesh(torsoGeo, this.fbJerseyMat);
    torso.position.y = 1.18;
    torso.castShadow = true;
    this.fbBody.add(torso);

    const headGeo = new THREE.SphereGeometry(0.21, 18, 16);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.66;
    head.castShadow = true;
    this.fbBody.add(head);

    const hairGeo = new THREE.SphereGeometry(0.218, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 1.67;
    this.fbBody.add(hair);

    const brimGeo = new THREE.BoxGeometry(0.24, 0.024, 0.16);
    const brim = new THREE.Mesh(brimGeo, whiteMat);
    brim.position.set(0, 1.72, 0.2);
    this.fbBody.add(brim);

    const armGeo = new THREE.CapsuleGeometry(0.062, 0.38, 6, 10);
    const handGeo = new THREE.SphereGeometry(0.068, 10, 8);
    this.disposables.push(shortsGeo, torsoGeo, headGeo, hairGeo, brimGeo, armGeo, handGeo);

    this.fbLeftArm.position.set(0.29, 1.36, 0);
    const lArm = new THREE.Mesh(armGeo, skinMat);
    lArm.position.y = -0.22;
    lArm.castShadow = true;
    this.fbLeftArm.add(lArm);
    const lHand = new THREE.Mesh(handGeo, skinMat);
    lHand.position.y = -0.45;
    this.fbLeftArm.add(lHand);
    this.fbBody.add(this.fbLeftArm);

    this.fbRightArm.position.set(-0.29, 1.36, 0);
    const rArm = new THREE.Mesh(armGeo, skinMat);
    rArm.position.y = -0.22;
    rArm.castShadow = true;
    this.fbRightArm.add(rArm);
    const rHand = new THREE.Mesh(handGeo, skinMat);
    rHand.position.y = -0.45;
    this.fbRightArm.add(rHand);

    const racketPivot = new THREE.Group();
    racketPivot.position.set(0, -0.45, 0.03);
    racketPivot.rotation.x = Math.PI * 0.42;
    const handleGeo = new THREE.CylinderGeometry(0.024, 0.028, 0.24, 10);
    const handle = new THREE.Mesh(handleGeo, darkMat);
    handle.position.y = 0.08;
    racketPivot.add(handle);
    const hoopGeo = new THREE.TorusGeometry(0.21, 0.02, 10, 24);
    hoopGeo.scale(0.84, 1.15, 0.85);
    const hoop = new THREE.Mesh(hoopGeo, this.fbJerseyMat);
    hoop.position.y = 0.54;
    hoop.castShadow = true;
    racketPivot.add(hoop);
    const stringGeo = new THREE.CircleGeometry(0.195, 16);
    stringGeo.scale(0.84, 1.15, 1);
    const strings = new THREE.Mesh(stringGeo, stringMat);
    strings.position.y = 0.54;
    racketPivot.add(strings);
    this.disposables.push(handleGeo, hoopGeo, stringGeo);

    this.fbRightArm.add(racketPivot);
    this.fbBody.add(this.fbRightArm);
  }

  private applyOutfitColor(color: BallColorId): void {
    const spec = BALL_COLORS[color];
    this.fbJerseyMat.color.set(spec.primary);
    this.fbTrimMat.color.set(spec.swirl);
    this.ringMat.color.set(spec.primary);
    this.ringMat.opacity = this.isHuman ? 0.32 : 0.12;

    for (const mat of this.jerseyMats) {
      mat.color.set(spec.primary);
      mat.needsUpdate = true;
    }
    for (const mat of this.accentMats) {
      mat.color.set(spec.swirl);
      mat.needsUpdate = true;
    }
  }

  public setColor(color: BallColorId): void {
    if (this.currentColor === color) return;
    this.currentColor = color;
    this.applyOutfitColor(color);
  }

  public setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  public sync(snap: TennisAvatarSnapshot, dt: number): void {
    this.setColor(snap.color);
    this.root.position.set(snap.x, 0, snap.z);
    this.root.rotation.y = snap.facingY;

    this.idlePhase += dt * 4.5;

    let bobY = 0;
    let strideSin = 0;
    let legAmp = 0;

    if (snap.runSpeed > 0.35) {
      this.stridePhase += dt * Math.min(18, 7 + snap.runSpeed * 1.45);
      legAmp = Math.min(0.62, snap.runSpeed * 0.1);
      strideSin = Math.sin(this.stridePhase);
      bobY = Math.abs(Math.cos(this.stridePhase)) * 0.042;
    } else {
      bobY = (0.5 + 0.5 * Math.sin(this.idlePhase)) * 0.01;
    }

    if (this.usingGlb) {
      this.syncGlbRig(snap, bobY, strideSin, legAmp);
    } else {
      this.syncFallbackRig(snap, bobY, strideSin, legAmp, dt);
    }
  }

  /**
   * Drives the Blender GLB rig in character-root space (+Z forward, +Y up, -X right/racket, +X left).
   * Re-authored for Round 3:
   * - Ready stance: relaxed shoulders, natural forward-right racket hold clear of chest/face, bent knees flush on Y=0
   * - Forehand: athletic side-out waist/chest drive forward toward net — ZERO arm/racket clipping behind head!
   * - Serve: true side-on pro trophy pose (55° sideways coil, left toss arm extended up, right elbow bent 90° L-cocked back)
   */
  private syncGlbRig(
    snap: TennisAvatarSnapshot,
    bobY: number,
    strideSin: number,
    legAmp: number
  ): void {
    const p = snap.swingProgress;
    const isRunning = snap.runSpeed > 0.35;

    // Default charismatic Nintendo Switch Sports athletic two-handed ready stance:
    // Low bent-knee crouch (~25 deg), shoulder-width+ stance, forward lean, right hand gripping angled racket
    // with stringbed ~40 deg OPEN toward camera/opponent, left hand poised cleanly near the racket throat!
    let stanceCrouchY = -0.046;
    let bodyY = bobY;
    let bodyYaw = 0.12;
    let spinePitch = 0.18;
    let spineYaw = -0.08;
    let chestPitch = 0.08;

    // Legs (authentic athletic shoulder-width+ bent-knee crouch, flat soles)
    let lLegPitch = -0.42;
    let lLegRoll = 0.15;
    let lLegYaw = 0.08;
    let lShinPitch = 0.74;
    let lShinRoll = -0.1;

    let rLegPitch = -0.42;
    let rLegRoll = -0.15;
    let rLegYaw = -0.08;
    let rShinPitch = 0.74;
    let rShinRoll = 0.1;

    // Right (racket, -X) arm: tucked from 45-deg A-pose, bent forward-inward holding racket diagonally across front
    // with the entire oval hoop & stenciled strings turned ~40 deg OPEN (NEVER edge-on, NEVER blocking face!)
    let rArmPitch = -0.52;
    let rArmYaw = 0.22;
    let rArmRoll = 0.38;
    let rForearmPitch = -0.78;
    let rForearmYaw = 0.32;
    let rForearmRoll = 0.04;
    let rHandPitch = -0.14;
    let rHandYaw = 0.14; // keeps racket hoop broadside/3/4 open in front view!
    let rHandRoll = -0.06;

    // Left (balance, +X) arm: poised naturally forward-inward near the racket throat (classic two-handed tennis ready!)
    let lArmPitch = -0.54;
    let lArmYaw = -0.34;
    let lArmRoll = -0.38;
    let lForearmPitch = -0.82;
    let lForearmYaw = -0.44;

    if (snap.swingKind === 'forehand') {
      // Dynamic athletic forehand crouch -> coiled prep -> waist-high drive -> crisp high follow-through
      const t = Math.min(1, p * 1.2);
      const sweep = Math.sin(p * Math.PI);
      const coilToFollow = THREE.MathUtils.lerp(-1.0, 1.0, t);

      stanceCrouchY = -0.052;
      bodyYaw = coilToFollow * 0.56;
      spineYaw = coilToFollow * 0.36;
      spinePitch = 0.18 - sweep * 0.04;
      chestPitch = 0.08;

      // Grounded open-stance bent-knee weight transfer
      lLegPitch = -0.48;
      lLegRoll = 0.16;
      lShinPitch = 0.8;
      rLegPitch = -0.26;
      rLegRoll = -0.18;
      rShinPitch = 0.64;

      rArmPitch = THREE.MathUtils.lerp(0.2, -0.84, t) - sweep * 0.16;
      rArmYaw = THREE.MathUtils.lerp(-0.28, 0.44, t);
      rArmRoll = THREE.MathUtils.lerp(0.06, 0.32, t) - sweep * 0.12;
      rForearmPitch = THREE.MathUtils.lerp(-0.34, -0.58, t);
      rForearmYaw = THREE.MathUtils.lerp(0.04, 0.28, t);
      rForearmRoll = 0.04;
      rHandPitch = -0.1;
      rHandYaw = THREE.MathUtils.lerp(0.06, 0.24, t);
      rHandRoll = 0.04;

      // Left arm smoothly counter-balances compactly in front of torso
      lArmPitch = THREE.MathUtils.lerp(-0.62, -0.32, t);
      lArmYaw = THREE.MathUtils.lerp(-0.4, -0.08, t);
      lArmRoll = -0.42;
      lForearmPitch = -0.82;
      lForearmYaw = -0.4;
    } else if (snap.swingKind === 'backhand') {
      const t = Math.min(1, p * 1.25);
      const sweep = Math.sin(p * Math.PI);
      const coilToFollow = THREE.MathUtils.lerp(1.0, -1.0, t);

      stanceCrouchY = -0.05;
      bodyYaw = coilToFollow * 0.5;
      spineYaw = coilToFollow * 0.34;
      spinePitch = 0.18;

      rLegPitch = -0.46;
      rLegRoll = -0.15;
      rShinPitch = 0.78;
      lLegPitch = -0.26;
      lLegRoll = 0.16;
      lShinPitch = 0.62;

      rArmPitch = THREE.MathUtils.lerp(-0.38, -0.68, t) - sweep * 0.1;
      rArmYaw = THREE.MathUtils.lerp(0.54, -0.38, t);
      rArmRoll = THREE.MathUtils.lerp(0.46, -0.06, t);
      rForearmPitch = THREE.MathUtils.lerp(-0.58, -0.28, t);
      rForearmYaw = 0.18;
      rHandYaw = THREE.MathUtils.lerp(0.24, -0.2, t);
      rHandRoll = 0.08;

      lArmPitch = -0.42;
      lArmYaw = -0.22 - coilToFollow * 0.16;
      lArmRoll = -0.42;
      lForearmPitch = -0.68;
      lForearmYaw = -0.32;
    } else if (snap.swingKind === 'serve') {
      // Authentic coiled side-on Pro Trophy Serve Pose -> Explosive Overhead Strike
      const t = Math.min(1, p * 1.35);
      const trophy = Math.max(0, 1 - t * 1.5);

      stanceCrouchY = THREE.MathUtils.lerp(-0.058, -0.012, t);
      bodyYaw = THREE.MathUtils.lerp(-1.05, 0.24, t);
      spineYaw = THREE.MathUtils.lerp(-0.32, 0.22, t);
      spinePitch = THREE.MathUtils.lerp(-0.14, 0.22, t);
      chestPitch = THREE.MathUtils.lerp(-0.08, 0.1, t);

      // Deep coiled trophy serve knees (front left foot planted, back right knee deeply loaded)
      lLegPitch = THREE.MathUtils.lerp(-0.48, -0.2, t);
      lLegRoll = 0.12;
      lShinPitch = THREE.MathUtils.lerp(0.84, 0.34, t);
      rLegPitch = THREE.MathUtils.lerp(-0.16, 0.16, t);
      rLegRoll = -0.16;
      rShinPitch = THREE.MathUtils.lerp(0.76, 0.3, t);

      // Sharply bent L-cocked right trophy elbow behind shoulder (ZERO straight stick-arm!)
      rArmPitch = THREE.MathUtils.lerp(0.18, -0.48, t) - Math.sin(t * Math.PI) * 1.48;
      rArmYaw = THREE.MathUtils.lerp(-0.44, 0.32, t);
      rArmRoll = THREE.MathUtils.lerp(-0.68, 0.28, t);
      rForearmPitch = THREE.MathUtils.lerp(-1.52, -0.24, t); // sharp ~90-deg bent trophy elbow!
      rForearmYaw = THREE.MathUtils.lerp(-0.32, 0.18, t);
      rForearmRoll = 0.34 * trophy;
      rHandPitch = -0.18 * trophy;
      rHandYaw = 0.08;
      rHandRoll = -0.14 * trophy;

      // Left toss arm reaches smoothly upward toward the ball with relaxed slight elbow bend
      lArmPitch = THREE.MathUtils.lerp(-2.14, -0.28, t);
      lArmYaw = THREE.MathUtils.lerp(-0.14, -0.08, t);
      lArmRoll = THREE.MathUtils.lerp(-0.24, -0.44, t);
      lForearmPitch = THREE.MathUtils.lerp(-0.22, -0.68, t);
      lForearmYaw = -0.18 * (1 - trophy);
    } else if (snap.swingKind === 'volley') {
      const punch = Math.sin(p * Math.PI);
      stanceCrouchY = -0.048;
      bodyYaw = punch * 0.26;
      spinePitch = 0.2;

      rArmPitch = -0.54 - punch * 0.24;
      rArmYaw = 0.14 + punch * 0.28;
      rArmRoll = 0.28;
      rForearmPitch = -0.6;
      rForearmYaw = 0.24;
      rHandYaw = 0.12;
      rHandRoll = -0.04;

      lArmPitch = -0.46;
      lArmYaw = -0.28;
      lArmRoll = -0.4;
      lForearmPitch = -0.74;
      lForearmYaw = -0.34;
    } else if (snap.swingKind === 'celebrate') {
      const hop = Math.abs(Math.sin(p * Math.PI * 2));
      stanceCrouchY = 0;
      bodyY = hop * 0.22;
      bodyYaw = 0;
      spinePitch = -0.06;
      chestPitch = -0.04;

      lLegPitch = -0.16;
      lLegRoll = 0.1;
      lShinPitch = 0.28;
      rLegPitch = -0.16;
      rLegRoll = -0.1;
      rShinPitch = 0.28;

      rArmPitch = -2.15;
      rArmYaw = 0;
      rArmRoll = -0.12;
      rForearmPitch = -0.24;
      rForearmYaw = 0;
      rHandYaw = 0.08;
      rHandRoll = 0;
      lArmPitch = -2.0;
      lArmYaw = 0;
      lArmRoll = 0.12;
      lForearmPitch = -0.24;
      lForearmYaw = 0;
    } else {
      // Charismatic two-handed athletic ready stance + live phone tilt preview
      const breathe = Math.sin(this.idlePhase);
      stanceCrouchY = -0.046 - (0.5 + 0.5 * breathe) * 0.008;
      rArmPitch = -0.52 + snap.racketPitch * 0.32;
      rArmYaw = 0.22 - snap.racketRoll * 0.22;
      rArmRoll = 0.38 - snap.racketRoll * 0.14;
      rForearmPitch = -0.78;
      rForearmYaw = 0.32;
      rHandPitch = -0.14;
      rHandYaw = 0.14;
      rHandRoll = -0.06;
      lArmPitch = -0.54;
      lArmYaw = -0.34;
      lArmRoll = -0.38;
      lForearmPitch = -0.82;
      lForearmYaw = -0.44;
    }

    if (isRunning) {
      stanceCrouchY = -0.022;
      lLegPitch = strideSin * legAmp - 0.16;
      lLegRoll = 0.06;
      lLegYaw = 0;
      lShinPitch = Math.max(0.12, -lLegPitch * 0.95) + 0.14;
      lShinRoll = -0.04;

      rLegPitch = -strideSin * legAmp - 0.16;
      rLegRoll = -0.06;
      rLegYaw = 0;
      rShinPitch = Math.max(0.12, -rLegPitch * 0.95) + 0.14;
      rShinRoll = 0.04;
    }

    this.modelHolder.position.y = bodyY + stanceCrouchY;
    this.modelHolder.rotation.y = bodyYaw;

    // Spine / chest / head (eyes locked across net!)
    applyJointDelta(this.jointSpine, spinePitch, spineYaw * 0.55, 0);
    applyJointDelta(this.jointChest, chestPitch, spineYaw * 0.45, 0);
    applyJointDelta(
      this.jointHead,
      -(spinePitch + chestPitch) * 0.85,
      -bodyYaw * 0.65 - spineYaw * 0.55,
      0
    );

    // Arms, forearms & wrist
    applyJointDelta(this.jointArmR, rArmPitch, rArmYaw, rArmRoll);
    applyJointDelta(this.jointForearmR, rForearmPitch, rForearmYaw, rForearmRoll);
    applyJointDelta(this.jointHandR, rHandPitch, rHandYaw, rHandRoll);
    applyJointDelta(this.jointArmL, lArmPitch, lArmYaw, lArmRoll);
    applyJointDelta(this.jointForearmL, lForearmPitch, lForearmYaw, 0);

    // Legs, knees & flat-compensated ankles
    applyJointDelta(this.jointLegL, lLegPitch, lLegYaw, lLegRoll);
    applyJointDelta(this.jointShinL, lShinPitch, 0, lShinRoll);
    applyJointDelta(this.jointFootL, -(lLegPitch + lShinPitch) * 0.88, 0, -(lLegRoll + lShinRoll) * 0.85);

    applyJointDelta(this.jointLegR, rLegPitch, rLegYaw, rLegRoll);
    applyJointDelta(this.jointShinR, rShinPitch, 0, rShinRoll);
    applyJointDelta(this.jointFootR, -(rLegPitch + rShinPitch) * 0.88, 0, -(rLegRoll + rShinRoll) * 0.85);

    if (this.glbModel) {
      this.glbModel.position.y = this.restBaseY;
      // Live-track individual shoe contact AO shadows directly underneath Foot_L and Foot_R!
      this.root.updateMatrixWorld(true);
      if (this.jointFootL) {
        this.jointFootL.node.getWorldPosition(this.tmpFootPos);
        this.root.worldToLocal(this.tmpFootPos);
        this.leftShoeShadow.position.set(this.tmpFootPos.x, 0.0028, this.tmpFootPos.z + 0.03);
      }
      if (this.jointFootR) {
        this.jointFootR.node.getWorldPosition(this.tmpFootPos);
        this.root.worldToLocal(this.tmpFootPos);
        this.rightShoeShadow.position.set(this.tmpFootPos.x, 0.0028, this.tmpFootPos.z + 0.03);
      }
    }
  }

  private syncFallbackRig(
    snap: TennisAvatarSnapshot,
    bobY: number,
    strideSin: number,
    legAmp: number,
    dt: number
  ): void {
    if (snap.runSpeed > 0.35) {
      this.fbLeftLeg.rotation.x = strideSin * legAmp;
      this.fbRightLeg.rotation.x = -strideSin * legAmp;
    } else {
      const relax = 1 - Math.exp(-12 * dt);
      this.fbLeftLeg.rotation.x *= 1 - relax;
      this.fbRightLeg.rotation.x *= 1 - relax;
    }
    this.fbBody.position.y = bobY;

    const p = snap.swingProgress;
    if (snap.swingKind === 'forehand') {
      const sweep = Math.sin(p * Math.PI);
      const yaw = THREE.MathUtils.lerp(-1.1, 1.2, Math.min(1, p * 1.35));
      this.fbBody.rotation.y = yaw * 0.35;
      this.fbRightArm.rotation.set(-0.55 - sweep * 0.45, yaw, -0.35);
      this.fbLeftArm.rotation.set(-0.3, -yaw * 0.4, 0.3);
    } else if (snap.swingKind === 'backhand') {
      const sweep = Math.sin(p * Math.PI);
      const yaw = THREE.MathUtils.lerp(1.1, -1.1, Math.min(1, p * 1.35));
      this.fbBody.rotation.y = yaw * 0.35;
      this.fbRightArm.rotation.set(-0.5 - sweep * 0.4, yaw, 0.3);
      this.fbLeftArm.rotation.set(-0.35, -yaw * 0.3, 0.2);
    } else if (snap.swingKind === 'serve') {
      const pitch = THREE.MathUtils.lerp(-2.65, -0.2, Math.min(1, p * 1.45));
      this.fbBody.rotation.y = THREE.MathUtils.lerp(-0.35, 0.35, p);
      this.fbRightArm.rotation.set(pitch, 0.15, -0.2);
      this.fbLeftArm.rotation.set(-1.6 * (1 - p), 0, 0.2);
    } else if (snap.swingKind === 'celebrate') {
      const hop = Math.abs(Math.sin(p * Math.PI * 2));
      this.fbBody.position.y = hop * 0.22;
      this.fbBody.rotation.y = 0;
      this.fbRightArm.rotation.set(-2.4, 0, -0.35);
      this.fbLeftArm.rotation.set(-2.1, 0, 0.35);
    } else {
      this.fbBody.rotation.y = 0;
      this.fbRightArm.rotation.set(-0.78 + snap.racketPitch * 0.4, 0.25, -0.25);
      this.fbLeftArm.rotation.set(-0.55, -0.25, 0.25);
    }
  }

  public getDiagnostics(): TennisAvatarDiagnostics {
    const foundJoints: string[] = [];
    const check: Array<[string, JointBinding | null]> = [
      ['Pelvis', this.jointPelvis],
      ['Spine', this.jointSpine],
      ['Chest', this.jointChest],
      ['Head', this.jointHead],
      ['Arm_R', this.jointArmR],
      ['Forearm_R', this.jointForearmR],
      ['Hand_R', this.jointHandR],
      ['Arm_L', this.jointArmL],
      ['Forearm_L', this.jointForearmL],
      ['Leg_L', this.jointLegL],
      ['Shin_L', this.jointShinL],
      ['Foot_L', this.jointFootL],
      ['Leg_R', this.jointLegR],
      ['Shin_R', this.jointShinR],
      ['Foot_R', this.jointFootR],
      ['Racket', this.jointRacket],
    ];
    for (const [label, b] of check) {
      if (b) foundJoints.push(`${label}->${b.node.name}`);
    }

    let bboxMin: [number, number, number] | null = null;
    let bboxMax: [number, number, number] | null = null;
    if (this.glbModel) {
      this.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.glbModel);
      if (!box.isEmpty()) {
        bboxMin = [box.min.x, box.min.y, box.min.z];
        bboxMax = [box.max.x, box.max.y, box.max.z];
      }
    }

    return {
      usingGlb: this.usingGlb,
      modelUrl: this.loadedModelUrl,
      foundJoints,
      materialNames: Array.from(new Set(this.allMaterialNames)).sort(),
      bboxMin,
      bboxMax,
    };
  }

  public dispose(): void {
    this.root.parent?.remove(this.root);
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

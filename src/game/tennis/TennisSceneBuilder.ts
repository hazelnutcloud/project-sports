import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  COURT_HALF_LENGTH,
  DOUBLES_HALF_WIDTH,
  NET_CENTER_HEIGHT,
  NET_HALF_WIDTH,
  NET_POST_HEIGHT,
  SERVICE_LINE_Z,
  SINGLES_HALF_WIDTH,
} from './TennisPhysics';

const COURT_MODEL_URL = '/models/tennis_court.glb';

export interface TennisStadiumDiagnostics {
  usingGlb: boolean;
  meshCount: number;
  materialNames: string[];
  dynamicNetCount: number;
  aoMapCount: number;
  bboxMin: [number, number, number] | null;
  bboxMax: [number, number, number] | null;
}

export interface TennisSceneRefs {
  ready: Promise<void>;
  triggerNetRipple: (intensity?: number) => void;
  update: (dt: number) => void;
  getDiagnostics: () => TennisStadiumDiagnostics;
  dispose: () => void;
}

const APRON_HALF_WIDTH = 11.2;
const APRON_HALF_LENGTH = 18.6;

/**
 * High-contrast sunlit outdoor PMREM environment map:
 * - Rich azure sky upper hemisphere + bright sun specular softbox for crisp glass & brushed-metal reflections
 * - Restrained lower-hemisphere bounce so matte stadium walls & characters keep deep, sculptural 3D form shading!
 */
function createTennisEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const domeCanvas = document.createElement('canvas');
  domeCanvas.width = 512;
  domeCanvas.height = 256;
  const ctx = domeCanvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#1874e6');
  grad.addColorStop(0.32, '#5cb8fc');
  grad.addColorStop(0.48, '#b8e4ff');
  grad.addColorStop(0.54, '#eaf6ff'); // bright sky-blue horizon so vertical pavilion windows reflect vibrant sky!
  grad.addColorStop(0.72, '#a8d4f4');
  grad.addColorStop(1.0, '#629cc4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Crisp sunlit cloud reflection bands for shimmering glass windows & balustrades
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(36, 92, 130, 24);
  ctx.fillRect(220, 82, 165, 28);
  ctx.fillRect(405, 96, 100, 22);
  ctx.fillStyle = 'rgba(225, 245, 255, 0.72)';
  ctx.fillRect(0, 122, 512, 18);

  const domeTex = new THREE.CanvasTexture(domeCanvas);
  domeTex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide })
  );
  envScene.add(dome);

  // Bright warm solar reflection softbox for glass/steel specular glints
  const sunPanelMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.4, 2.2, 1.85),
  });
  const sunPanel = new THREE.Mesh(new THREE.PlaneGeometry(11, 8), sunPanelMat);
  sunPanel.position.set(18, 22, 12);
  sunPanel.lookAt(0, 0, 0);
  envScene.add(sunPanel);

  // Cool sky reflection strip opposite sun
  const skyPanelMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.58, 1.02, 1.48),
  });
  const skyPanel = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), skyPanelMat);
  skyPanel.position.set(-18, 13, -14);
  skyPanel.lookAt(0, 0, 0);
  envScene.add(skyPanel);

  const envRT = pmrem.fromScene(envScene, 0.028);
  domeTex.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  sunPanel.geometry.dispose();
  sunPanelMat.dispose();
  skyPanel.geometry.dispose();
  skyPanelMat.dispose();
  pmrem.dispose();
  return envRT;
}

/**
 * High-res 2048x1024 painterly sunlit sky dome with vibrant azure sky and sculpted cumulus clouds
 * framed cleanly in the visible horizon band (+4°..+28° elevation).
 */
function createTennisSkyDome(): THREE.Mesh {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.0, '#0d56c4');
  grad.addColorStop(0.20, '#227eea');
  grad.addColorStop(0.36, '#48a4f7');
  grad.addColorStop(0.45, '#72c2fd');
  grad.addColorStop(0.495, '#9ed9ff');
  grad.addColorStop(0.515, '#d6f0ff');
  grad.addColorStop(0.56, '#bfe3f7');
  grad.addColorStop(1.0, '#96c9ae');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const sunGlow = ctx.createRadialGradient(1480, 345, 18, 1480, 345, 300);
  sunGlow.addColorStop(0.0, 'rgba(255, 253, 238, 0.82)');
  sunGlow.addColorStop(0.3, 'rgba(255, 245, 212, 0.28)');
  sunGlow.addColorStop(1.0, 'rgba(255, 240, 200, 0.0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(0, 0, W, H);

  const drawCumulus = (cx: number, cy: number, sx: number, sy: number, alpha = 0.94) => {
    const puffs: Array<[number, number, number, number]> = [
      [-74, 14, 48, 20],
      [-38, 2, 56, 28],
      [-4, -12, 64, 34],
      [34, -4, 58, 30],
      [68, 10, 46, 22],
      [0, 16, 92, 16],
    ];

    for (const wrapOff of [0, -W, W]) {
      const bx = cx + wrapOff;
      if (bx < -220 || bx > W + 220) continue;

      ctx.fillStyle = `rgba(148, 196, 242, ${(alpha * 0.62).toFixed(2)})`;
      for (const [dx, dy, rx, ry] of puffs) {
        ctx.beginPath();
        ctx.ellipse(bx + dx * sx, cy + (dy + 8) * sy, rx * sx * 1.02, ry * sy * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = `rgba(253, 254, 255, ${(alpha * 0.94).toFixed(2)})`;
      for (const [dx, dy, rx, ry] of puffs) {
        ctx.beginPath();
        ctx.ellipse(bx + dx * sx, cy + dy * sy, rx * sx, ry * sy, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = `rgba(255, 252, 240, ${(alpha * 0.8).toFixed(2)})`;
      for (const [dx, dy, rx, ry] of puffs.slice(1, 4)) {
        ctx.beginPath();
        ctx.ellipse(bx + (dx + 5) * sx, cy + (dy - 7) * sy, rx * sx * 0.7, ry * sy * 0.54, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  drawCumulus(210, 462, 1.05, 0.74, 0.92);
  drawCumulus(680, 452, 1.18, 0.84, 0.95);
  drawCumulus(1120, 464, 1.0, 0.76, 0.92);
  drawCumulus(1560, 448, 1.15, 0.82, 0.94);
  drawCumulus(1920, 460, 0.95, 0.72, 0.9);

  drawCumulus(440, 408, 0.92, 0.82, 0.92);
  drawCumulus(910, 396, 1.04, 0.88, 0.94);
  drawCumulus(1380, 404, 0.96, 0.84, 0.92);
  drawCumulus(1790, 398, 0.88, 0.8, 0.9);

  drawCumulus(620, 336, 0.85, 0.7, 0.75);
  drawCumulus(1260, 328, 0.9, 0.72, 0.78);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(128, 40, 28),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
  );
  mesh.renderOrder = -10;
  return mesh;
}

function createFallbackCourtTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 4096;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const worldXToPx = (x: number) => ((x + APRON_HALF_WIDTH) / (APRON_HALF_WIDTH * 2)) * W;
  const worldZToPx = (z: number) => ((z + APRON_HALF_LENGTH) / (APRON_HALF_LENGTH * 2)) * H;

  const apronGrad = ctx.createLinearGradient(0, 0, 0, H);
  apronGrad.addColorStop(0, '#449e47');
  apronGrad.addColorStop(0.5, '#4fb150');
  apronGrad.addColorStop(1, '#449e47');
  ctx.fillStyle = apronGrad;
  ctx.fillRect(0, 0, W, H);

  const leftX = worldXToPx(-DOUBLES_HALF_WIDTH);
  const rightX = worldXToPx(DOUBLES_HALF_WIDTH);
  const topZ = worldZToPx(-COURT_HALF_LENGTH);
  const botZ = worldZToPx(COURT_HALF_LENGTH);

  const innerGrad = ctx.createLinearGradient(0, topZ, 0, botZ);
  innerGrad.addColorStop(0, '#2a72b8');
  innerGrad.addColorStop(0.5, '#3482cc');
  innerGrad.addColorStop(1, '#2a72b8');
  ctx.fillStyle = innerGrad;
  ctx.fillRect(leftX, topZ, rightX - leftX, botZ - topZ);

  const lineW = (0.075 / (APRON_HALF_WIDTH * 2)) * W;
  const lineH = (0.075 / (APRON_HALF_LENGTH * 2)) * H;
  ctx.fillStyle = '#ffffff';

  const drawHLine = (x1: number, x2: number, z: number, extraThick = 1) => {
    const px1 = worldXToPx(x1) - lineW * 0.5;
    const px2 = worldXToPx(x2) + lineW * 0.5;
    const pz = worldZToPx(z) - (lineH * extraThick) * 0.5;
    ctx.fillRect(px1, pz, px2 - px1, lineH * extraThick);
  };
  const drawVLine = (x: number, z1: number, z2: number) => {
    const px = worldXToPx(x) - lineW * 0.5;
    const pz1 = worldZToPx(z1);
    const pz2 = worldZToPx(z2);
    ctx.fillRect(px, pz1, lineW, pz2 - pz1);
  };

  drawHLine(-DOUBLES_HALF_WIDTH, DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH, 1.35);
  drawHLine(-DOUBLES_HALF_WIDTH, DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH, 1.35);
  drawVLine(-DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH, COURT_HALF_LENGTH);
  drawVLine(DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH, COURT_HALF_LENGTH);
  drawVLine(-SINGLES_HALF_WIDTH, -COURT_HALF_LENGTH, COURT_HALF_LENGTH);
  drawVLine(SINGLES_HALF_WIDTH, -COURT_HALF_LENGTH, COURT_HALF_LENGTH);
  drawHLine(-SINGLES_HALF_WIDTH, SINGLES_HALF_WIDTH, -SERVICE_LINE_Z);
  drawHLine(-SINGLES_HALF_WIDTH, SINGLES_HALF_WIDTH, SERVICE_LINE_Z);
  drawVLine(0, -SERVICE_LINE_Z, SERVICE_LINE_Z);
  drawVLine(0, -COURT_HALF_LENGTH, -COURT_HALF_LENGTH + 0.35);
  drawVLine(0, COURT_HALF_LENGTH - 0.35, COURT_HALF_LENGTH);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

function createFallbackNetMeshTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 128);
  ctx.strokeStyle = 'rgba(24, 34, 48, 0.85)';
  ctx.lineWidth = 3;
  for (let x = 0; x <= 256; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  for (let y = 0; y <= 128; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 2.2);
  return tex;
}

function buildFallbackStadium(
  group: THREE.Group,
  disposables: Array<{ dispose: () => void }>,
  dynamicNetTargets: Array<{ obj: THREE.Object3D; baseZ: number; weight: number }>
): void {
  const plazaGeo = new THREE.PlaneGeometry(140, 140);
  const plazaMat = new THREE.MeshStandardMaterial({ color: '#e6eff6', roughness: 0.9 });
  const plaza = new THREE.Mesh(plazaGeo, plazaMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = -0.03;
  plaza.receiveShadow = true;
  group.add(plaza);
  disposables.push(plazaGeo, plazaMat);

  const courtTex = createFallbackCourtTexture();
  const courtGeo = new THREE.PlaneGeometry(APRON_HALF_WIDTH * 2, APRON_HALF_LENGTH * 2);
  const courtMat = new THREE.MeshStandardMaterial({ map: courtTex, roughness: 0.78, metalness: 0.04 });
  const courtMesh = new THREE.Mesh(courtGeo, courtMat);
  courtMesh.rotation.x = -Math.PI / 2;
  courtMesh.receiveShadow = true;
  group.add(courtMesh);
  disposables.push(courtTex, courtGeo, courtMat);

  const postGeo = new THREE.CylinderGeometry(0.055, 0.06, NET_POST_HEIGHT + 0.08, 16);
  const postMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.32, metalness: 0.65 });
  disposables.push(postGeo, postMat);
  for (const xSign of [-1, 1] as const) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(xSign * NET_HALF_WIDTH, (NET_POST_HEIGHT + 0.08) * 0.5, 0);
    post.castShadow = true;
    group.add(post);
  }

  const netTex = createFallbackNetMeshTexture();
  const netGeo = new THREE.PlaneGeometry(NET_HALF_WIDTH * 2, NET_CENTER_HEIGHT, 24, 4);
  const posAttr = netGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    if (vy > 0) {
      const frac = Math.min(1, Math.abs(vx) / NET_HALF_WIDTH);
      posAttr.setY(i, vy + (NET_POST_HEIGHT - NET_CENTER_HEIGHT) * frac * frac);
    }
  }
  netGeo.computeVertexNormals();
  const netMat = new THREE.MeshStandardMaterial({
    map: netTex,
    alphaTest: 0.25,
    side: THREE.DoubleSide,
    roughness: 0.8,
  });
  const netMesh = new THREE.Mesh(netGeo, netMat);
  netMesh.position.set(0, NET_CENTER_HEIGHT * 0.5, 0);
  netMesh.castShadow = true;
  netMesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: netTex,
    alphaTest: 0.25,
  });
  group.add(netMesh);
  dynamicNetTargets.push({ obj: netMesh, baseZ: 0, weight: 1.0 });
  disposables.push(netTex, netGeo, netMat, netMesh.customDepthMaterial);

  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = -1 + (i / 24) * 2;
    pts.push(new THREE.Vector3(t * NET_HALF_WIDTH, NET_CENTER_HEIGHT + (NET_POST_HEIGHT - NET_CENTER_HEIGHT) * t * t, 0));
  }
  const tapeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.034, 8, false);
  const tapeMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35 });
  const tapeMesh = new THREE.Mesh(tapeGeo, tapeMat);
  tapeMesh.castShadow = true;
  group.add(tapeMesh);
  dynamicNetTargets.push({ obj: tapeMesh, baseZ: 0, weight: 0.7 });
  disposables.push(tapeGeo, tapeMat);
}

/**
 * Builds the Spocco Square Tennis Stadium:
 * - High-contrast Cycles-calibrated sunlit daylight rig (5:1 key-to-fill ratio!) so bleachers,
 *   architecture, and players display crisp 3D form shading & luminous cool-blue shadows instead of flat ambient wash
 * - 4096x4096 tight-frustum soft PCF shadow map + custom alpha-cutout depth material on Net_Mesh
 *   so the net weave, headband, posts, BOTH players, umpire chair & stands cast crisp grounding shadows
 * - Bright sky HDRI specular reflections on tempered glass balustrades/windows & brushed metal
 * - Honors baked Cycles AO (`aoMap` / vertex colors) from `/models/tennis_court.glb`
 */
export function buildSpoccoTennisStadium(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer
): TennisSceneRefs {
  const stadiumGroup = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const dynamicNetTargets: Array<{ obj: THREE.Object3D; baseZ: number; weight: number }> = [];

  let usingGlb = false;
  let glbRoot: THREE.Object3D | null = null;
  let meshCount = 0;
  let aoMapCount = 0;
  const materialNamesSet = new Set<string>();

  // 1. Painterly Sunlit Sky Dome & Subtle Atmospheric Perspective Fog
  scene.background = new THREE.Color('#7dc6fb');
  scene.fog = new THREE.Fog('#d2ecff', 72, 185);

  const envRT = createTennisEnvironment(renderer);
  scene.environment = envRT.texture;
  // Balanced global env intensity: crisp sky reflections on glass/steel while keeping architectural 3D form
  scene.environmentIntensity = 0.46;
  disposables.push(envRT);

  const skyDome = createTennisSkyDome();
  stadiumGroup.add(skyDome);
  disposables.push(skyDome.geometry, skyDome.material as THREE.Material);

  // 2. Airy Sunlit Resort Daylight Rig (Switch Sports clarity: bright sky shadow fill + warm key + flattering front/rim!)
  const hemi = new THREE.HemisphereLight('#cbe8ff', '#f4e0c4', 0.74);
  hemi.position.set(0, 26, 0);
  scene.add(hemi);

  // Warm sunlight key casting 4096px soft-edged grounding shadows across court, net, players & stands
  const sun = new THREE.DirectionalLight('#fff4de', 2.48);
  sun.position.set(16, 25, 13);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 76;
  sun.shadow.camera.left = -17.5;
  sun.shadow.camera.right = 17.5;
  sun.shadow.camera.top = 19.5;
  sun.shadow.camera.bottom = -19.5;
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.004;
  sun.shadow.radius = 2.35;
  scene.add(sun);

  // Bright cool sky fill from shadow side (keeps sideline shadows & canopy undersides airy sunlit sky-blue!)
  const skyFill = new THREE.DirectionalLight('#8ed2ff', 0.36);
  skyFill.position.set(-18, 14, 8);
  scene.add(skyFill);

  // Gentle front bounce fill so player faces & knees stay warm and flattering without harsh knee creases
  const frontFill = new THREE.DirectionalLight('#fff2dc', 0.28);
  frontFill.position.set(-4, 5, 20);
  scene.add(frontFill);

  // Clean warm golden rim/backlight separating player silhouettes & hair cleanly from the blue court
  const warmRim = new THREE.DirectionalLight('#ffe6be', 0.56);
  warmRim.position.set(-10, 12, -20);
  scene.add(warmRim);

  // 3. Outer safety horizon ground plane below the stadium plaza
  const safetyGroundGeo = new THREE.PlaneGeometry(280, 280);
  const safetyGroundMat = new THREE.MeshStandardMaterial({
    color: '#72ab68',
    roughness: 0.95,
    metalness: 0.0,
    envMapIntensity: 0.2,
  });
  const safetyGround = new THREE.Mesh(safetyGroundGeo, safetyGroundMat);
  safetyGround.rotation.x = -Math.PI / 2;
  safetyGround.position.y = -0.22;
  safetyGround.receiveShadow = false;
  stadiumGroup.add(safetyGround);
  disposables.push(safetyGroundGeo, safetyGroundMat);

  // 4. Crisp sky-reflective physical glass materials for balustrades & sunlit stadium pavilion windows
  const railingGlassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#8cd4ff'),
    transparent: true,
    opacity: 0.28,
    roughness: 0.05,
    metalness: 0.14,
    reflectivity: 1.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 2.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Opaque/glossy sky-blue architectural curtain-wall glass (matches Cycles' bright sunlit blue stadium windows!)
  const pavilionGlassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#64bbf5'),
    emissive: new THREE.Color('#2d95e0'),
    emissiveIntensity: 0.22,
    transparent: false,
    roughness: 0.07,
    metalness: 0.18,
    reflectivity: 1.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 2.1,
    side: THREE.DoubleSide,
  });
  disposables.push(railingGlassMat, pavilionGlassMat);

  // 5. Load Blender-crafted tennis_court.glb
  const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const loader = new GLTFLoader();
  const ready = loader
    .loadAsync(COURT_MODEL_URL)
    .then((gltf) => {
      const root = gltf.scene;
      glbRoot = root;
      usingGlb = true;
      const configuredMats = new Set<THREE.Material>();

      const dynamicNetGroup = root.getObjectByName('Net_Dynamic');
      if (dynamicNetGroup) {
        dynamicNetTargets.push({
          obj: dynamicNetGroup,
          baseZ: dynamicNetGroup.position.z,
          weight: 1.0,
        });
      }

      root.traverse((obj) => {
        if (!(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        meshCount += 1;

        const lname = mesh.name.toLowerCase();

        if (!dynamicNetGroup) {
          if (lname.includes('net_mesh') || lname === 'netmesh' || lname.includes('net_grid')) {
            dynamicNetTargets.push({ obj: mesh, baseZ: mesh.position.z, weight: 1.0 });
          } else if (lname.includes('net_headband') || lname.includes('net_tape') || lname.includes('headband')) {
            dynamicNetTargets.push({ obj: mesh, baseZ: mesh.position.z, weight: 0.7 });
          } else if (lname.includes('net_strap') || lname.includes('center_strap')) {
            dynamicNetTargets.push({ obj: mesh, baseZ: mesh.position.z, weight: 0.55 });
          }
        }

        const isFlatGround =
          lname.includes('court') ||
          lname.includes('apron') ||
          lname.includes('line') ||
          lname.includes('floor') ||
          lname.includes('plaza') ||
          lname.includes('ground') ||
          lname.includes('grass') ||
          lname.includes('turf') ||
          lname.includes('logo') ||
          lname.includes('decal') ||
          lname.includes('hill') ||
          lname.includes('ridge') ||
          lname.includes('lawn');
        const isGlass = lname.includes('glass') || lname.includes('window');
        const isNetMesh = lname.includes('net_mesh') || lname.includes('netmesh') || lname.includes('net_grid');

        mesh.receiveShadow = !isGlass && !isNetMesh;
        // Net_Mesh, Net_Headband, Net_Posts, umpire chair, benches, stands & props all cast real shadows!
        mesh.castShadow = !isFlatGround && !isGlass;

        const srcMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const upgradedMats = srcMats.map((m) => {
          if (!m) return m;
          const mName = m.name || '';
          if (mName) materialNamesSet.add(mName);
          const lmName = mName.toLowerCase();

          // Swap flat/milky glass & stadium windows for crisp sky-reflecting physical glass
          if (lmName.includes('glass') || lmName.includes('window') || isGlass) {
            return lmName.includes('railing') || lname.includes('railing') || lname.includes('balustrade')
              ? railingGlassMat
              : pavilionGlassMat;
          }

          if (configuredMats.has(m)) {
            // Still attach alpha-cutout depth material on any additional Net_Mesh mesh instances
            if (isNetMesh && (m as THREE.MeshStandardMaterial).map && !mesh.customDepthMaterial) {
              const std = m as THREE.MeshStandardMaterial;
              const depthMat = new THREE.MeshDepthMaterial({
                depthPacking: THREE.RGBADepthPacking,
                map: std.map,
                alphaTest: 0.3,
              });
              mesh.customDepthMaterial = depthMat;
              disposables.push(depthMat);
            }
            return m;
          }
          configuredMats.add(m);

          if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const std = m as THREE.MeshStandardMaterial;

            // Honor baked Cycles Ambient Occlusion maps & vertex-color AO (COLOR_0)
            if (std.aoMap) {
              std.aoMapIntensity = 1.0;
              aoMapCount += 1;
            }
            if (mesh.geometry.attributes.color) {
              std.vertexColors = true;
            }

            // Crisp trilinear mipmapping + max anisotropy on all textures (kills moiré & grazing blur!)
            for (const tex of [std.map, std.roughnessMap, std.normalMap, std.emissiveMap, std.bumpMap, std.aoMap]) {
              if (tex) {
                tex.anisotropy = maxAniso;
                tex.generateMipmaps = true;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.needsUpdate = true;
              }
            }

            if (
              lmName.includes('net_mesh') ||
              lmName.includes('netmesh') ||
              lmName.includes('net_grid') ||
              isNetMesh
            ) {
              std.side = THREE.DoubleSide;
              std.transparent = true;
              std.alphaTest = 0.28;
              std.depthWrite = false;
              std.roughness = 0.82;
              std.envMapIntensity = 0.35;
              std.needsUpdate = true;

              // Custom alpha-cutout depth material so the net weave casts a real grounding shadow onto the court!
              if (std.map) {
                const depthMat = new THREE.MeshDepthMaterial({
                  depthPacking: THREE.RGBADepthPacking,
                  map: std.map,
                  alphaTest: 0.28,
                });
                mesh.customDepthMaterial = depthMat;
                disposables.push(depthMat);
              }
            } else if (
              lmName.includes('screen') ||
              lmName.includes('scoreboard') ||
              lmName.includes('led') ||
              lmName.includes('glow') ||
              lmName.includes('sign')
            ) {
              std.envMapIntensity = 0.3;
              if (std.emissiveIntensity > 0) {
                std.emissiveIntensity = Math.min(std.emissiveIntensity, 1.35);
              }
              std.needsUpdate = true;
            } else if (lmName.includes('courtsurface') || lmName.includes('court_surface')) {
              // Balanced airy sunlit hard-court matching Blender Cycles (avoid harsh oversaturation)
              std.roughness = Math.max(std.roughness, 0.78);
              std.metalness = 0.0;
              std.envMapIntensity = 0.28;
              std.needsUpdate = true;
            } else if (lmName.includes('court') || lmName.includes('apron') || lmName.includes('line')) {
              std.roughness = Math.max(std.roughness, 0.76);
              std.metalness = 0.0;
              std.envMapIntensity = 0.28;
              std.needsUpdate = true;
            } else if (
              lmName.includes('steel') ||
              lmName.includes('chrome') ||
              lmName.includes('post') ||
              lmName.includes('metal') ||
              lmName.includes('lens')
            ) {
              // Crisp sunlit sky speculars on net posts, stair handrails, chrome ball hoppers & camera lens
              std.envMapIntensity = 1.45;
              std.needsUpdate = true;
            } else if (
              lmName.includes('leaf') ||
              lmName.includes('foliage') ||
              lmName.includes('hedge') ||
              lmName.includes('palm') ||
              lmName.includes('tree') ||
              (lmName.includes('tripo') && (lname.includes('tree') || lname.includes('palm') || lname.includes('foliage')))
            ) {
              std.roughness = Math.max(std.roughness, 0.72);
              std.metalness = 0.0;
              std.envMapIntensity = 0.36;
              std.needsUpdate = true;
            } else {
              // Keep architectural concrete, risers, seats & crowd crisply shaded (not ambient-washed)
              std.envMapIntensity = 0.45;
              std.needsUpdate = true;
            }
          }
          return m;
        });

        mesh.material = Array.isArray(mesh.material) ? upgradedMats : upgradedMats[0];
      });

      stadiumGroup.add(root);
    })
    .catch((err) => {
      console.warn('[TennisSceneBuilder] /models/tennis_court.glb unavailable, using fallback court:', err);
      buildFallbackStadium(stadiumGroup, disposables, dynamicNetTargets);
    });

  scene.add(stadiumGroup);

  let netRippleAmp = 0;
  let netRipplePhase = 0;

  return {
    ready,
    triggerNetRipple: (intensity = 1) => {
      netRippleAmp = Math.min(0.14, 0.065 * intensity);
      netRipplePhase = 0;
    },
    update: (dt: number) => {
      if (netRippleAmp > 0.0005) {
        netRipplePhase += dt * 36;
        netRippleAmp *= Math.exp(-5.5 * dt);
        const offsetZ = Math.sin(netRipplePhase) * netRippleAmp;
        for (const target of dynamicNetTargets) {
          target.obj.position.z = target.baseZ + offsetZ * target.weight;
        }
      } else if (netRippleAmp !== 0) {
        netRippleAmp = 0;
        for (const target of dynamicNetTargets) {
          target.obj.position.z = target.baseZ;
        }
      }
    },
    getDiagnostics: (): TennisStadiumDiagnostics => {
      let bboxMin: [number, number, number] | null = null;
      let bboxMax: [number, number, number] | null = null;
      if (glbRoot) {
        const box = new THREE.Box3().setFromObject(glbRoot);
        if (!box.isEmpty()) {
          bboxMin = [box.min.x, box.min.y, box.min.z];
          bboxMax = [box.max.x, box.max.y, box.max.z];
        }
      }
      return {
        usingGlb,
        meshCount,
        materialNames: Array.from(materialNamesSet).sort(),
        dynamicNetCount: dynamicNetTargets.length,
        aoMapCount,
        bboxMin,
        bboxMax,
      };
    },
    dispose: () => {
      scene.remove(stadiumGroup, hemi, sun, skyFill, frontFill, warmRim);
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}

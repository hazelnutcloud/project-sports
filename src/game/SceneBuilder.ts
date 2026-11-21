import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  APPROACH_START_Z,
  DECK_END_Z,
  FOUL_LINE_Z,
  LANE_WIDTH,
  getLaneCenterX,
} from './PhysicsWorld';
import { createDecorativePinSet } from './PinSetVisuals';

const ALLEY_MODEL_URL = '/models/spocco_alley.glb';
const VISUAL_LANE_INDICES = [-1, 0, 1, 2, 3, 4, 5] as const;

/**
 * Generates a balanced, smooth Spocco Square sunlit-atrium PMREM environment map.
 * Carefully calibrated luminance avoids bleached grazing-angle Fresnel glare on the
 * honey-maple lanes while giving brushed aluminum arches, pins, and bowling balls
 * crisp specular highlights.
 */
function createSpoccoEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();

  // Smooth sunlit sky-to-warm-wood gradient (no harsh rectangular white blobs on the floor!)
  const domeCanvas = document.createElement('canvas');
  domeCanvas.width = 512;
  domeCanvas.height = 256;
  const ctx = domeCanvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#6bb8f0');
  grad.addColorStop(0.32, '#b6dff7');
  grad.addColorStop(0.48, '#f5eadb');
  grad.addColorStop(0.56, '#c97b32');
  grad.addColorStop(1.0, '#5a3214');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  const domeTex = new THREE.CanvasTexture(domeCanvas);
  domeTex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(28, 32, 16),
    new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide })
  );
  envScene.add(dome);

  // Soft, diffuse overhead skylight glow strips (gentle intensity so clearcoat doesn't blow out)
  const softboxMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.22, 1.28) });
  for (let z = -15; z <= 9; z += 8) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.2), softboxMat);
    panel.position.set(0, 12.5, z);
    panel.rotation.x = Math.PI / 2;
    envScene.add(panel);
  }

  // Warm key sun bounce panel off to upper right
  const sunPanelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.45, 1.32, 1.05) });
  const sunPanel = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), sunPanelMat);
  sunPanel.position.set(16, 10, 8);
  sunPanel.lookAt(0, 0, 0);
  envScene.add(sunPanel);

  // Subtle mint-cyan Spocco lightbox bounce ahead
  const cyanPanelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.1, 0.98) });
  const cyanPanel = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.8), cyanPanelMat);
  cyanPanel.position.set(0, 2.8, -18);
  envScene.add(cyanPanel);

  const envRT = pmrem.fromScene(envScene, 0.055);
  domeTex.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  softboxMat.dispose();
  sunPanelMat.dispose();
  cyanPanelMat.dispose();
  pmrem.dispose();

  return envRT;
}

/**
 * Creates a vibrant daytime gradient sky dome visible through the glass atrium skylight walls.
 */
function createSkyDome(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#2d8be8');
  grad.addColorStop(0.32, '#69bbf8');
  grad.addColorStop(0.52, '#bce4ff');
  grad.addColorStop(0.62, '#e2f4ff');
  grad.addColorStop(1.0, '#b5d4ea');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Soft sunlit cumulus clouds in upper sky band
  ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
  const clouds = [
    [90, 145, 72, 22],
    [135, 138, 52, 18],
    [290, 120, 88, 24],
    [350, 130, 58, 18],
    [445, 155, 65, 20],
  ];
  for (const [cx, cy, rx, ry] of clouds) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(72, 32, 20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
  );
  mesh.renderOrder = -10;
  return mesh;
}

interface MapleLaneTextures {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

/**
 * Builds rich, vibrant 1024x2048 Spocco Square honey-amber maple bowling lane albedo +
 * oil-pattern roughness maps (matching the warm saturated golden-orange lanes in bowling_play.mp4!).
 */
function createMapleLaneTextures(): MapleLaneTextures {
  const width = 1024;
  const height = 2048;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 512;
  roughCanvas.height = 1024;
  const rctx = roughCanvas.getContext('2d')!;

  // Rich saturated Spocco Square honey-amber maple base
  ctx.fillStyle = '#e07d1f';
  ctx.fillRect(0, 0, width, height);

  // Base roughness (~0.36 satin-gloss varnish -> 92/255)
  rctx.fillStyle = 'rgb(96, 96, 96)';
  rctx.fillRect(0, 0, 512, 1024);

  // 39 regulation narrow maple boards with warm golden-amber shade variation & organic grain
  const boardCount = 39;
  const bw = width / boardCount;
  const rbw = 512 / boardCount;

  for (let i = 0; i < boardCount; i++) {
    const hash = ((i * 53 + 17) % 19) - 9;
    const r = Math.min(255, Math.max(0, 228 + hash * 2.0));
    const g = Math.min(255, Math.max(0, 126 + hash * 1.9));
    const b = Math.min(255, Math.max(0, 32 + hash * 1.1));
    ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    ctx.fillRect(i * bw, 0, bw + 0.8, height);

    // Subtle longitudinal wood grain
    const grainTint = i % 2 === 0 ? 'rgba(255, 200, 118, 0.14)' : 'rgba(135, 56, 8, 0.11)';
    ctx.fillStyle = grainTint;
    ctx.fillRect(i * bw + bw * 0.24, 0, bw * 0.36, height);

    // Plank butt-joint tone variation
    const spliceY = ((i * 397) % 1400) + 250;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(120, 48, 6, 0.09)' : 'rgba(255, 196, 112, 0.09)';
    ctx.fillRect(i * bw, spliceY, bw, height - spliceY);

    // Crisp fine dark-amber plank seam
    ctx.fillStyle = 'rgba(105, 42, 6, 0.20)';
    ctx.fillRect(i * bw, 0, 1.4, height);

    // Subtle per-board specular roughness variation
    const rVal = Math.round(82 + ((i * 29) % 24));
    rctx.fillStyle = `rgb(${rVal}, ${rVal}, ${rVal})`;
    rctx.fillRect(i * rbw, 0, rbw + 0.5, 1024);
  }

  // Warm golden sheen band down the center of the lane (without bleaching to white!)
  const oilGrad = ctx.createLinearGradient(0, 0, width, 0);
  oilGrad.addColorStop(0.0, 'rgba(135, 55, 8, 0.10)');
  oilGrad.addColorStop(0.25, 'rgba(255, 204, 116, 0.10)');
  oilGrad.addColorStop(0.5, 'rgba(255, 224, 152, 0.18)');
  oilGrad.addColorStop(0.75, 'rgba(255, 204, 116, 0.10)');
  oilGrad.addColorStop(1.0, 'rgba(135, 55, 8, 0.10)');
  ctx.fillStyle = oilGrad;
  ctx.fillRect(0, 0, width, height);

  const laneLen = FOUL_LINE_Z - DECK_END_Z; // 19.55m
  const zToY = (z: number) => ((z - DECK_END_Z) / laneLen) * height;

  // Slightly deeper caramelized amber tone on the pin deck (top 1.5m)
  const pinDeckGrad = ctx.createLinearGradient(0, 0, 0, zToY(-17.7));
  pinDeckGrad.addColorStop(0, 'rgba(145, 52, 6, 0.24)');
  pinDeckGrad.addColorStop(1, 'rgba(145, 52, 6, 0.0)');
  ctx.fillStyle = pinDeckGrad;
  ctx.fillRect(0, 0, width, zToY(-17.7));

  // Oil-pattern roughness gradient: smoother oil zone in mid-lane, satin back-end
  const rOilGrad = rctx.createLinearGradient(0, 0, 0, 1024);
  rOilGrad.addColorStop(0.0, 'rgba(110, 110, 110, 0.3)');
  rOilGrad.addColorStop(0.3, 'rgba(95, 95, 95, 0.25)');
  rOilGrad.addColorStop(0.65, 'rgba(68, 68, 68, 0.38)');
  rOilGrad.addColorStop(1.0, 'rgba(84, 84, 84, 0.25)');
  rctx.fillStyle = rOilGrad;
  rctx.fillRect(0, 0, 512, 1024);

  // Crisp black foul line right at bottom (z = 0)
  ctx.fillStyle = '#181412';
  ctx.fillRect(0, height - 10, width, 10);

  // Iconic 7 black chevron aiming arrows arranged in a '^' wedge
  const arrowBaseZ = -4.35;
  ctx.fillStyle = '#191410';
  for (let i = -3; i <= 3; i++) {
    const x = width * 0.5 + i * (width * 0.118);
    const zOffset = Math.abs(i) * 0.27;
    const y = zToY(arrowBaseZ + zOffset);
    ctx.beginPath();
    ctx.moveTo(x, y - 24);
    ctx.lineTo(x - 13, y + 14);
    ctx.lineTo(x + 13, y + 14);
    ctx.closePath();
    ctx.fill();
  }

  // Crisp dotted range-finder guide dashes behind outer arrows
  ctx.fillStyle = '#241810';
  for (const side of [-1, 1] as const) {
    const yDash = zToY(-3.18);
    for (let k = 0; k < 5; k++) {
      const x = width * 0.5 + side * (width * 0.21 + k * (width * 0.044));
      ctx.fillRect(x - 6, yDash - 3, 12, 6);
    }
  }

  // Range finder dots near foul line
  for (let i = -3; i <= 3; i++) {
    const x = width * 0.5 + i * (width * 0.118);
    ctx.beginPath();
    ctx.arc(x, zToY(-1.85), 5.0, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 12;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.anisotropy = 8;

  return { map, roughnessMap };
}

/**
 * Builds the matching seamless honey-maple Approach Deck texture behind the foul line
 * with warm sunlit golden wood planks and per-lane regulation approach guide dots.
 */
function createApproachDeckTexture(): THREE.CanvasTexture {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#dc7c20';
  ctx.fillRect(0, 0, width, height);

  const boards = 220;
  const bw = width / boards;
  for (let i = 0; i < boards; i++) {
    const shade = ((i * 41 + 9) % 15) - 7;
    const r = Math.min(255, Math.max(0, 224 + shade * 1.9));
    const g = Math.min(255, Math.max(0, 124 + shade * 1.7));
    const b = Math.min(255, Math.max(0, 32 + shade * 1.0));
    ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    ctx.fillRect(i * bw, 0, bw + 0.6, height);

    ctx.fillStyle = 'rgba(105, 42, 6, 0.13)';
    ctx.fillRect(i * bw, 0, 1, height);
  }

  // Soft warm sunlit pool across the center of the approach deck (matching frame_01!)
  const sunPool = ctx.createRadialGradient(
    width * 0.5,
    height * 0.58,
    width * 0.05,
    width * 0.5,
    height * 0.58,
    width * 0.46
  );
  sunPool.addColorStop(0, 'rgba(255, 226, 165, 0.24)');
  sunPool.addColorStop(0.55, 'rgba(255, 200, 124, 0.08)');
  sunPool.addColorStop(1, 'rgba(115, 48, 8, 0.16)');
  ctx.fillStyle = sunPool;
  ctx.fillRect(0, 0, width, height);

  // Continuous dark foul line along top edge (Z = 0)
  ctx.fillStyle = '#181412';
  ctx.fillRect(0, 0, width, 11);

  const deckWidthMeters = 13.8;
  const deckDepthMeters = 4.25;
  const xToPx = (xMeters: number) => ((xMeters + deckWidthMeters * 0.5) / deckWidthMeters) * width;
  const zToPy = (zMeters: number) => (zMeters / deckDepthMeters) * height;

  ctx.fillStyle = '#24160e';
  for (const laneIdx of VISUAL_LANE_INDICES) {
    const cx = getLaneCenterX(laneIdx);
    for (const rowZ of [0.24, 2.32]) {
      for (let d = -3; d <= 3; d++) {
        const dx = cx + d * (LANE_WIDTH * 0.118);
        ctx.beginPath();
        ctx.arc(xToPx(dx), zToPy(rowZ), 4.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 12;
  return tex;
}

/**
 * Builds the iconic vibrant mint-turquoise "SPOCCO SQUARE" lightbox sign with bold coral-pink
 * typography (matching frame_05.jpg!).
 */
function createSpoccoLightboxTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  // Vibrant saturated turquoise-mint glowing acrylic gradient
  const grad = ctx.createLinearGradient(0, 0, 1024, 192);
  grad.addColorStop(0.0, '#12cfa8');
  grad.addColorStop(0.22, '#2df0cc');
  grad.addColorStop(0.5, '#59ffe2');
  grad.addColorStop(0.78, '#2df0cc');
  grad.addColorStop(1.0, '#12cfa8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 192);

  // Subtle vertical diffuser shading
  const vGrad = ctx.createLinearGradient(0, 0, 0, 192);
  vGrad.addColorStop(0, 'rgba(6, 78, 68, 0.32)');
  vGrad.addColorStop(0.22, 'rgba(255, 255, 255, 0.12)');
  vGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.22)');
  vGrad.addColorStop(0.78, 'rgba(255, 255, 255, 0.10)');
  vGrad.addColorStop(1, 'rgba(6, 78, 68, 0.34)');
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, 1024, 192);

  // Inner metallic bezel lines
  ctx.strokeStyle = 'rgba(10, 88, 78, 0.55)';
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 16, 988, 160);

  // Bold vivid magenta-pink "SPOCCO SQUARE" typography with crisp light halo
  ctx.font = '900 84px Inter, system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.save();
  ctx.shadowColor = 'rgba(232, 42, 128, 0.5)';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255, 232, 244, 0.85)';
  ctx.strokeText('SPOCCO SQUARE', 512, 102);

  ctx.fillStyle = '#e8297c';
  ctx.fillText('SPOCCO SQUARE', 512, 102);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false; // glTF exported meshes use top-left UV origin
  tex.anisotropy = 8;
  return tex;
}

/**
 * Fine horizontal walnut wood-grain texture for architectural fascia & divider inlays.
 */
function createWalnutGrainTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#6c3e24';
  ctx.fillRect(0, 0, 512, 512);

  for (let y = 0; y < 512; y += 3) {
    const wave = Math.sin(y * 0.08) * 12 + Math.cos(y * 0.23) * 7;
    const r = Math.min(255, Math.max(0, 108 + wave));
    const g = Math.min(255, Math.max(0, 62 + wave * 0.62));
    const b = Math.min(255, Math.max(0, 35 + wave * 0.42));
    ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    ctx.fillRect(0, y, 512, 3);
  }

  ctx.fillStyle = 'rgba(28, 12, 4, 0.18)';
  for (let i = 0; i < 180; i++) {
    const x = (i * 97) % 512;
    const y = (i * 53) % 512;
    ctx.fillRect(x, y, 42 + (i % 55), 1.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

export interface SpoccoSceneRefs {
  alleyGroup: THREE.Group;
  ready: Promise<void>;
  dispose: () => void;
}

/**
 * Constructs the refined Spocco Square bowling alley:
 * - Loads our Blender + Tripo 3D architectural & prop GLB (/models/spocco_alley.glb)
 * - Combines with calibrated sunlit daylight & PMREM reflections, rich honey-amber maple lanes,
 *   vibrant botanical greenery, glowing turquoise/pink lightboxes, and decorative outer-lane pins.
 */
export function buildSpoccoAlley(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer
): SpoccoSceneRefs {
  const alleyGroup = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Balanced Sunlit PMREM Environment Map (gentle intensity keeps colors rich & saturated!)
  const envRT = createSpoccoEnvironment(renderer);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.42;
  disposables.push(envRT);

  // 2. Daytime Sky Dome & Soft Atmospheric Depth Fog
  scene.background = new THREE.Color(0x9ed4fa);
  scene.fog = new THREE.Fog(0xcfe9fc, 42, 92);
  const skyDome = createSkyDome();
  alleyGroup.add(skyDome);

  // 3. Punchy Sunlit Spocco Square Lighting Rig (high clarity & crisp diagonal bowler shadow)
  const hemiLight = new THREE.HemisphereLight(0xdcf0ff, 0x9c5a24, 0.56);
  hemiLight.position.set(0, 18, 0);
  scene.add(hemiLight);

  // Warm sunlight key casting the iconic diagonal shadow across the honey-maple approach
  const sunLight = new THREE.DirectionalLight(0xfff1d4, 1.65);
  sunLight.position.set(10, 15, 10);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 2;
  sunLight.shadow.camera.far = 52;
  sunLight.shadow.camera.left = -10.5;
  sunLight.shadow.camera.right = 10.5;
  sunLight.shadow.camera.top = 12;
  sunLight.shadow.camera.bottom = -24;
  sunLight.shadow.bias = -0.00045;
  sunLight.shadow.normalBias = 0.015;
  scene.add(sunLight);

  // Subtle cool atrium rim fill from pin-deck direction (adds sculpted depth without flattening)
  const rimLight = new THREE.DirectionalLight(0x88dcff, 0.30);
  rimLight.position.set(-8, 9, -22);
  scene.add(rimLight);

  // Overhead pin-deck spotlight pools illuminating the gleaming white pin racks
  for (const px of [-3.6, 0.0, 3.6]) {
    const pinSpot = new THREE.PointLight(0xdffff8, 2.0, 7.2, 1.7);
    pinSpot.position.set(px, 1.12, DECK_END_Z + 1.15);
    alleyGroup.add(pinSpot);
  }

  // Warm lounge accent light in rear concourse (makes reverse impact shot vibrant!)
  const loungeLight = new THREE.PointLight(0xffe9c8, 2.4, 14, 1.5);
  loungeLight.position.set(0, 3.2, APPROACH_START_Z + 3.2);
  alleyGroup.add(loungeLight);

  // 4. Rich Lacquered Honey-Amber Maple Lanes (7 visual lanes: 0..4 playable + -1 & 5 decorative)
  const { map: mapleMap, roughnessMap: mapleRough } = createMapleLaneTextures();
  disposables.push(mapleMap, mapleRough);

  const mapleMat = new THREE.MeshPhysicalMaterial({
    map: mapleMap,
    roughnessMap: mapleRough,
    roughness: 0.92, // modulated by roughnessMap (~0.28..0.40 satin-gloss varnish)
    metalness: 0.02,
    clearcoat: 0.28,
    clearcoatRoughness: 0.24,
    envMapIntensity: 0.42,
  });
  disposables.push(mapleMat);

  const laneLen = FOUL_LINE_Z - DECK_END_Z; // 19.55m
  const laneCenterZ = (FOUL_LINE_Z + DECK_END_Z) * 0.5;
  const laneGeom = new THREE.PlaneGeometry(LANE_WIDTH, laneLen);
  const deckLipGeom = new THREE.BoxGeometry(LANE_WIDTH, 0.24, 0.06);
  const deckLipMat = new THREE.MeshStandardMaterial({ color: 0x3b1f0d, roughness: 0.55 });
  disposables.push(laneGeom, deckLipGeom, deckLipMat);

  for (const laneIdx of VISUAL_LANE_INDICES) {
    const cx = getLaneCenterX(laneIdx);
    const laneMesh = new THREE.Mesh(laneGeom, mapleMat);
    laneMesh.rotation.x = -Math.PI / 2;
    laneMesh.position.set(cx, 0.0, laneCenterZ);
    laneMesh.receiveShadow = true;
    alleyGroup.add(laneMesh);

    const deckLip = new THREE.Mesh(deckLipGeom, deckLipMat);
    deckLip.position.set(cx, -0.12, DECK_END_Z - 0.02);
    alleyGroup.add(deckLip);
  }

  // Wide unified honey-maple Approach Deck behind foul line (Z = 0 to +4.25m)
  const approachTex = createApproachDeckTexture();
  disposables.push(approachTex);
  const approachMat = new THREE.MeshPhysicalMaterial({
    map: approachTex,
    roughness: 0.36,
    metalness: 0.02,
    clearcoat: 0.22,
    clearcoatRoughness: 0.28,
    envMapIntensity: 0.36,
  });
  disposables.push(approachMat);

  const approachDeck = new THREE.Mesh(new THREE.PlaneGeometry(13.8, 4.25), approachMat);
  approachDeck.rotation.x = -Math.PI / 2;
  approachDeck.position.set(0, 0.001, 2.125);
  approachDeck.receiveShadow = true;
  alleyGroup.add(approachDeck);

  // Decorative standing pin racks on the two outer flanking visual lanes (-1 and 5)
  createDecorativePinSet(alleyGroup, -1);
  createDecorativePinSet(alleyGroup, 5);

  // 5. Load Blender + Tripo 3D Spocco Alley Architecture & Props GLB
  const lightboxTex = createSpoccoLightboxTexture();
  const walnutTex = createWalnutGrainTexture();
  disposables.push(lightboxTex, walnutTex);

  const spoccoGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x8fd2f7,
    transparent: true,
    opacity: 0.22,
    roughness: 0.08,
    metalness: 0.08,
    reflectivity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  disposables.push(spoccoGlassMat);

  const loader = new GLTFLoader();
  const ready = loader
    .loadAsync(ALLEY_MODEL_URL)
    .then((gltf) => {
      const root = gltf.scene;
      // Track already-configured shared materials so instanced meshes never mutate the same material repeatedly!
      const configuredMats = new Set<THREE.Material>();

      root.traverse((obj) => {
        if (!(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        const name = mesh.name;

        const isHeroShadowCaster =
          name.startsWith('Divider_') ||
          name.startsWith('BallReturn_') ||
          name.startsWith('LoungeSofa_') ||
          name.startsWith('BallRack_') ||
          name.startsWith('Sign_BOWLING');
        mesh.castShadow = isHeroShadowCaster;
        mesh.receiveShadow =
          name.startsWith('Divider_') ||
          name.startsWith('Gutter_') ||
          name.startsWith('RearLounge_') ||
          name.startsWith('BallReturn_') ||
          name.startsWith('LoungeSofa_');

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const upgraded = mats.map((m) => {
          if (!m) return m;
          const mName = m.name || '';

          if (mName.startsWith('Mat_AtriumGlass')) {
            return spoccoGlassMat;
          }

          if (configuredMats.has(m)) {
            return m;
          }
          configuredMats.add(m);

          if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const std = m as THREE.MeshStandardMaterial;

            if (mName.startsWith('Mat_SpoccoLightbox')) {
              std.map = lightboxTex;
              std.emissiveMap = lightboxTex;
              std.color.setHex(0xffffff);
              std.emissive = new THREE.Color(0xffffff);
              std.emissiveIntensity = 1.25;
              std.roughness = 0.22;
              std.metalness = 0.0;
              std.envMapIntensity = 0.25;
              std.needsUpdate = true;
            } else if (mName.startsWith('Mat_PitAccentGlow')) {
              std.emissive = new THREE.Color(0x28f5d6);
              std.emissiveIntensity = 1.9;
              std.needsUpdate = true;
            } else if (mName.startsWith('Mat_CeilingLightStrip')) {
              std.emissiveIntensity = 1.1;
              std.needsUpdate = true;
            } else if (mName.startsWith('Mat_ClerestoryGlow')) {
              // Soft sky-blue tinted daylight clerestory glass (not glaring solid white!)
              std.color.setHex(0x8ec9f0);
              std.emissive = new THREE.Color(0x6ab4e8);
              std.emissiveIntensity = 0.42;
              std.roughness = 0.18;
              std.envMapIntensity = 0.6;
              std.needsUpdate = true;
            } else if (
              mName.startsWith('Mat_ExteriorTowerWhite') ||
              mName.startsWith('Mat_ExteriorTowerGlass')
            ) {
              std.color.setHex(mName.includes('Glass') ? 0x7cbde8 : 0xcde4f5);
              std.emissive = new THREE.Color(0x78bae6);
              std.emissiveIntensity = 0.18;
              std.needsUpdate = true;
            } else if (
              mName.startsWith('Mat_FasciaWalnut') ||
              mName.startsWith('Mat_RailWalnut') ||
              mName.startsWith('Mat_WoodSlat') ||
              mName.startsWith('Mat_RackWood')
            ) {
              std.map = walnutTex;
              std.color.setHex(0xd8b8a0);
              std.roughness = mName.startsWith('Mat_RailWalnut') ? 0.30 : 0.48;
              std.metalness = 0.04;
              std.envMapIntensity = 0.55;
              std.needsUpdate = true;
            } else if (mName.startsWith('Mat_RailSilver') || mName.startsWith('Mat_EmblemSilver')) {
              std.color.setHex(0xc4d0de);
              std.metalness = 0.72;
              std.roughness = 0.28;
              std.envMapIntensity = 0.9;
              std.needsUpdate = true;
            } else if (mName.startsWith('Mat_GutterDark')) {
              std.color.setHex(0x131a26);
              std.metalness = 0.38;
              std.roughness = 0.28;
              std.envMapIntensity = 0.65;
              std.needsUpdate = true;
            } else if (mName.startsWith('Mat_SteelDark') || mName.startsWith('Mat_PlanterSlate')) {
              std.color.setHex(0x1f2630);
              std.metalness = 0.45;
              std.roughness = 0.44;
              std.envMapIntensity = 0.55;
              std.needsUpdate = true;
            } else if (mName.startsWith('Mat_BowlingSignRed')) {
              // Deep saturated Spocco crimson red (stays bold under ACES tone mapping!)
              std.color.setHex(0xc21524);
              std.roughness = 0.28;
              std.metalness = 0.12;
              std.envMapIntensity = 0.55;
              std.needsUpdate = true;
            } else if (mName.startsWith('Mat_CanopyTerracotta')) {
              std.color.setHex(0x8e1e38);
              std.roughness = 0.48;
              std.metalness = 0.08;
              std.envMapIntensity = 0.4;
              std.needsUpdate = true;
            } else if (mName.startsWith('tripo_material_')) {
              // Configure each shared Tripo 3D PBR material ONCE (fixes overblown fern brightness!)
              if (name.includes('Fern')) {
                std.color.setRGB(0.86, 1.08, 0.76);
                std.roughness = 0.74;
                std.metalness = 0.0;
                std.envMapIntensity = 0.45;
              } else if (name.includes('MallTree')) {
                std.color.setRGB(0.92, 1.04, 0.85);
                std.roughness = 0.68;
                std.metalness = 0.0;
                std.envMapIntensity = 0.45;
              } else {
                std.envMapIntensity = 0.75;
              }
              std.needsUpdate = true;
            }
          }
          return m;
        });

        mesh.material = Array.isArray(mesh.material) ? upgraded : upgraded[0];
      });

      alleyGroup.add(root);
    })
    .catch((err) => {
      console.error('[SceneBuilder] Failed to load /models/spocco_alley.glb:', err);
    });

  scene.add(alleyGroup);

  return {
    alleyGroup,
    ready,
    dispose: () => {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}

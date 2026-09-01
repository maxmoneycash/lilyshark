// Lilyshark Field Demo — a scroll-driven 3D story of the Shelby off-grid
// pointer flow: T-Deck capture node → LoRa mesh → gateway → Shelby on Aptos.
// Scroll scrubs the whole sequence; every animation is a deterministic
// function of the timeline so the story plays forward and backward.
// Self-contained: three.js is vendored, no network requests.

import * as THREE from 'three';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from './vendor/geometries/RoundedBoxGeometry.js';

const COLORS = {
  bg: 0xf7eef2,
  pink: 0xe0479b,
  lime: 0x37a466,
  cyan: 0x2596a3,
  paper: 0x43303c,
  body: 0x1a1d22,
  grid1: 0xe3c8d6,
  grid2: 0xefdce6,
};

const isCoarse = matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------- renderer
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('scene'),
    antialias: true,
  });
} catch (e) {
  document.getElementById('fallback').style.display = 'grid';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isCoarse ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !isCoarse;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);
scene.fog = new THREE.FogExp2(0xecd9e2, 0.00085);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1600);
camera.position.set(-13, 5, 44);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), isCoarse ? 0.22 : 0.3, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- lights
// Hemisphere for sky/ground bounce, a warm key that casts, and a cool rim
// behind the field so silhouettes separate from the background.
scene.add(new THREE.HemisphereLight(0xffe4ef, 0xd8bfa8, 0.62));
const key = new THREE.DirectionalLight(0xfff0d6, 2.7);
key.position.set(-58, 74, 46);
key.castShadow = !isCoarse;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -70; key.shadow.camera.right = 70;
key.shadow.camera.top = 70; key.shadow.camera.bottom = -70;
key.shadow.camera.near = 20;
key.shadow.camera.far = 260;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.05;
scene.add(key);
const rim = new THREE.DirectionalLight(0xa8c8e8, 0.8);
rim.position.set(70, 26, -80);
scene.add(rim);
const pinkFill = new THREE.PointLight(COLORS.pink, 16, 90, 1.9);
pinkFill.position.set(0, 14, 22);
scene.add(pinkFill);

// ---------------------------------------------------------------- textures
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}
// fine speckle: sand grain on the ground, matte grain on plastic
function grainTex(size, contrast, repeat) {
  return canvasTex(size, (g, n) => {
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = 128 + (Math.random() - 0.5) * contrast + Math.sin(i * 0.37) * 6;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, repeat);
}
const softDot = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const sandBump = grainTex(256, 150, 26);
const sandRough = canvasTex(256, (g, n) => {
  const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = 232 + Math.random() * 23;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}, 26);
const plasticRough = grainTex(256, 60, 3);

// Image-based lighting generated from the sky itself, so metal and glass have
// something real to reflect instead of reading as flat clay.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 20);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const lo = new THREE.Color(0xf6dcc9), hi = new THREE.Color(0xa9d3ef);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 50 * 0.7 + 0.35, 0, 1);
    const c = lo.clone().lerp(hi, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff6e8 }));
  sun.position.set(-26, 30, 20);
  envScene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(50, 32),
    new THREE.MeshBasicMaterial({ color: 0xe4d6c8, side: THREE.DoubleSide }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -6;
  envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.03).texture;
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.5;
  pmrem.dispose();
}

// ---------------------------------------------------------------- sky
{
  const geo = new THREE.SphereGeometry(700, 32, 20);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const horizon = new THREE.Color(0xffd9e6), zenith = new THREE.Color(0x9ec9e8);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 700 * 2.4, 0, 1);
    const c = horizon.clone().lerp(zenith, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  })));
}

// ---------------------------------------------------------------- node sites
// Hoisted so terrain scatter can keep clear of them before the towers exist.
const NODES_POS = {
  tdeck:   new THREE.Vector3(-2, 0, 26),
  r1:      new THREE.Vector3(-30, 0, -8),
  r2:      new THREE.Vector3(18, 0, -30),
  gateway: new THREE.Vector3(60, 0, -70),
  amb1:    new THREE.Vector3(-58, 0, -46),
  amb2:    new THREE.Vector3(44, 0, 14),
  amb3:    new THREE.Vector3(-18, 0, -66),
  amb4:    new THREE.Vector3(-72, 0, 10),
  amb5:    new THREE.Vector3(76, 0, -22),
  amb6:    new THREE.Vector3(6, 0, -95),
};

// ---------------------------------------------------------------- terrain
function fbm(x, z) {
  return (
    6.4 * Math.sin(x * 0.019 + 1.7) * Math.cos(z * 0.016 + 0.4) +
    3.1 * Math.sin(x * 0.041 + 3.1) * Math.sin(z * 0.048 + 1.2) +
    1.5 * Math.cos(x * 0.089 + 0.8) * Math.cos(z * 0.077 + 2.2) +
    0.6 * Math.sin(x * 0.180 + 2.6) * Math.cos(z * 0.164 + 0.9) +
    0.25 * Math.sin(x * 0.365 + 1.1) * Math.sin(z * 0.331 + 3.3)
  );
}
function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  const flat = THREE.MathUtils.smoothstep(r, 74, 200); // keep the node field walkable
  return Math.max(fbm(x, z), -1.5) * flat + 0.35 * Math.sin(x * 0.21) * Math.cos(z * 0.19) * (1 - flat);
}
{
  const geo = new THREE.PlaneGeometry(760, 760, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  // sand in the hollows, pale dust on the flats, warm rock on the rises
  const cSand = new THREE.Color(0xc9a882);
  const cDust = new THREE.Color(0xe0c9a8);
  const cRock = new THREE.Color(0xa8877e);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y - 0.12);
    const t = THREE.MathUtils.clamp(y / 8 + 0.4, 0, 1);
    const c = (t < 0.5 ? cSand.clone().lerp(cDust, t * 2) : cDust.clone().lerp(cRock, (t - 0.5) * 2));
    // gentle mottling so the surface is never one dead flat tone
    const m = 1 + 0.045 * Math.sin(x * 0.7 + z * 0.53) + 0.03 * Math.cos(x * 1.9 - z * 1.3);
    col[i * 3] = c.r * m; col[i * 3 + 1] = c.g * m; col[i * 3 + 2] = c.b * m;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1.0, metalness: 0.0,
    roughnessMap: sandRough, bumpMap: sandBump, bumpScale: 0.28,
  }));
  terrain.receiveShadow = true;
  scene.add(terrain);
}

// Distant ranges as noise-cut silhouette curtains. Three rings at increasing
// distance and decreasing contrast give real aerial perspective, and because
// each is a full ring the horizon reads correctly from every camera angle.
function ridgeRing(radius, height, color, seed, segments = 220) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, segments, 1, true);
  const pos = geo.attributes.position;
  const half = height / 2;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0) continue; // leave the skirt buried
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const n =
      0.52 * Math.sin(a * 3.1 + seed) +
      0.30 * Math.sin(a * 7.3 + seed * 2.1) +
      0.18 * Math.sin(a * 13.7 + seed * 0.7) +
      0.10 * Math.sin(a * 23.1 + seed * 3.3);
    pos.setY(i, half * (0.42 + 0.58 * (n * 0.5 + 0.5)));
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, fog: false, depthWrite: true,
  }));
  m.position.y = -height * 0.12;
  return m;
}
scene.add(ridgeRing(310, 58, 0xb08fa5, 1.4));
scene.add(ridgeRing(400, 104, 0xc7abbd, 3.9));
scene.add(ridgeRing(520, 140, 0xdcc5d3, 7.2));

// ground scatter: pebbles and dry tufts, instanced, kept clear of the nodes
{
  const clearOf = (x, z, r) => {
    for (const k of Object.keys(NODES_POS)) {
      if (Math.hypot(NODES_POS[k].x - x, NODES_POS[k].z - z) < r) return false;
    }
    return true;
  };
  const pebbleGeo = new THREE.DodecahedronGeometry(1, 0);
  const pebbleMat = new THREE.MeshStandardMaterial({
    color: 0x9d8577, roughness: 0.92, metalness: 0.0, flatShading: true,
  });
  const tuftGeo = new THREE.ConeGeometry(0.26, 1.5, 4, 1);
  const tuftMat = new THREE.MeshStandardMaterial({
    color: 0x87905f, roughness: 1, metalness: 0, flatShading: true,
  });
  const N_P = isCoarse ? 120 : 260, N_T = isCoarse ? 90 : 200;
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, N_P);
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, N_T);
  pebbles.castShadow = tufts.castShadow = !isCoarse;
  pebbles.receiveShadow = true;
  const d = new THREE.Object3D();
  let pi = 0, ti = 0, guard = 0;
  while ((pi < N_P || ti < N_T) && guard++ < 6000) {
    const a = Math.random() * Math.PI * 2;
    const r = 10 + Math.pow(Math.random(), 0.6) * 150;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!clearOf(x, z, 5)) continue;
    const y = terrainHeight(x, z);
    if (pi < N_P && Math.random() < 0.55) {
      const sc = 0.18 + Math.random() * 0.75;
      d.position.set(x, y + sc * 0.34, z);
      d.scale.set(sc * (1 + Math.random() * 0.5), sc * 0.62, sc);
      d.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      d.updateMatrix();
      pebbles.setMatrixAt(pi++, d.matrix);
    } else if (ti < N_T) {
      const sc = 0.5 + Math.random() * 0.8;
      d.position.set(x, y + sc * 0.7, z);
      d.scale.set(sc * (0.6 + Math.random() * 0.6), sc * (0.7 + Math.random() * 0.9), sc * 0.7);
      d.rotation.set(0, Math.random() * 3, (Math.random() - 0.5) * 0.35);
      d.updateMatrix();
      tufts.setMatrixAt(ti++, d.matrix);
    }
  }
  pebbles.count = pi; tufts.count = ti;
  scene.add(pebbles); scene.add(tufts);
}

// sun with a soft halo
{
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(20, 48),
    new THREE.MeshBasicMaterial({ color: 0xfff0f6, transparent: true, opacity: 0.95, fog: false })
  );
  sun.position.set(-250, 175, -400);
  sun.lookAt(0, 0, 0);
  scene.add(sun);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot, color: 0xffd2e4, transparent: true, opacity: 0.55, depthWrite: false,
    blending: THREE.NormalBlending, fog: false,
  }));
  glow.scale.setScalar(150);
  glow.position.copy(sun.position);
  scene.add(glow);
}

// drifting clouds
const clouds = [];
{
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 0, flatShading: false,
    emissive: 0xffeef6, emissiveIntensity: 0.75, transparent: true, opacity: 0.92, fog: false,
  });
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let j = 0; j < puffs; j++) {
      const r = 6 + ((i * 7 + j * 13) % 8);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), mat);
      m.position.set(j * r * 0.9 - puffs * 2.5, ((j * 5) % 3) * 2.2, ((j * 3) % 5) * 1.5);
      m.scale.y = 0.5;
      g.add(m);
    }
    g.position.set(-260 + ((i * 149) % 520), 96 + ((i * 37) % 46), -300 + ((i * 211) % 420));
    g.userData.speed = 0.8 + (i % 4) * 0.35;
    scene.add(g);
    clouds.push(g);
  }
}

// ---------------------------------------------------------------- labels
// Boxless outlined text, held at constant screen size and faded by distance
// so annotations read like survey markings instead of floating billboards.
const worldLabels = [];
function makeLabel(text, colorCss, scale = 1, maxDist = 240) {
  const fs = 44, pad = 10;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w; c.height = fs + pad * 2;
  const g = c.getContext('2d');
  g.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.strokeText(text, pad, c.height / 2 + 2);
  g.fillStyle = colorCss;
  g.fillText(text, pad, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: true, fog: false, opacity: 0.95,
  }));
  sp.userData.aspect = c.width / c.height;
  sp.userData.base = 0.9 * scale;
  sp.userData.maxDist = maxDist;
  worldLabels.push(sp);
  return sp;
}
const _labelPos = new THREE.Vector3();
function updateLabels() {
  for (const sp of worldLabels) {
    if (!sp.parent) continue;
    sp.getWorldPosition(_labelPos);
    const d = _labelPos.distanceTo(camera.position);
    const h = sp.userData.base * d / 42;
    sp.scale.set(h * sp.userData.aspect, h, 1);
    const near = THREE.MathUtils.smoothstep(d, 10, 18);
    const far = 1 - THREE.MathUtils.smoothstep(d, sp.userData.maxDist * 0.62, sp.userData.maxDist);
    sp.material.opacity = 0.92 * near * far;
  }
}

// ---------------------------------------------------------------- mesh nodes
const beacons = [];
const MAT = {
  galv: new THREE.MeshStandardMaterial({ color: 0x8d93a0, roughness: 0.42, metalness: 0.85, roughnessMap: plasticRough }),
  cabinet: new THREE.MeshStandardMaterial({ color: 0xb9b3bd, roughness: 0.55, metalness: 0.35 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xcfc6c0, roughness: 0.95, metalness: 0.02, roughnessMap: sandRough }),
  solar: new THREE.MeshStandardMaterial({ color: 0x1d2b47, roughness: 0.18, metalness: 0.55 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x25272c, roughness: 0.8, metalness: 0.1 }),
};
// A LoRa relay as it actually stands in a field: three-leg galvanised lattice
// on a concrete pad, cross-braced, with a solar panel, a battery cabinet, a
// panel antenna and a beacon on top.
function makeRelayNode(label, labelColor, tall = 1) {
  const grp = new THREE.Group();
  const H = 7.4 * tall;
  const legR = 0.9, topR = 0.32;

  // pad
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.85, 0.28, 6), MAT.concrete);
  pad.position.y = 0.14;
  pad.receiveShadow = true; pad.castShadow = true;
  grp.add(pad);

  // three legs, converging
  const legGeo = new THREE.CylinderGeometry(0.075, 0.10, H, 6);
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const bx = Math.cos(a) * legR, bz = Math.sin(a) * legR;
    const tx = Math.cos(a) * topR, tz = Math.sin(a) * topR;
    const leg = new THREE.Mesh(legGeo, MAT.galv);
    leg.position.set((bx + tx) / 2, H / 2 + 0.25, (bz + tz) / 2);
    const dx = tx - bx, dz = tz - bz;
    leg.rotation.z = Math.atan2(-dx, H);
    leg.rotation.x = Math.atan2(dz, H);
    leg.castShadow = true;
    grp.add(leg);
    legs.push({ bx, bz, tx, tz });
  }
  // horizontal rungs + diagonal bracing between legs
  const braceMat = MAT.galv;
  const RUNGS = Math.max(4, Math.round(5 * tall));
  for (let r = 0; r <= RUNGS; r++) {
    const f = r / RUNGS;
    const y = 0.35 + f * (H - 0.3);
    const rad = legR + (topR - legR) * f;
    for (let i = 0; i < 3; i++) {
      const a0 = (i / 3) * Math.PI * 2, a1 = ((i + 1) / 3) * Math.PI * 2;
      const p0 = new THREE.Vector3(Math.cos(a0) * rad, y, Math.sin(a0) * rad);
      const p1 = new THREE.Vector3(Math.cos(a1) * rad, y, Math.sin(a1) * rad);
      const mid = p0.clone().lerp(p1, 0.5);
      const len = p0.distanceTo(p1);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 5), braceMat);
      bar.position.copy(mid);
      bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
      grp.add(bar);
      // diagonal to the next level
      if (r < RUNGS) {
        const f2 = (r + 1) / RUNGS;
        const y2 = 0.35 + f2 * (H - 0.3);
        const rad2 = legR + (topR - legR) * f2;
        const q1 = new THREE.Vector3(Math.cos(a1) * rad2, y2, Math.sin(a1) * rad2);
        const dmid = p0.clone().lerp(q1, 0.5);
        const dlen = p0.distanceTo(q1);
        const diag = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, dlen, 5), braceMat);
        diag.position.copy(dmid);
        diag.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q1.clone().sub(p0).normalize());
        grp.add(diag);
      }
    }
  }

  // battery / radio cabinet beside the pad
  const cab = new THREE.Mesh(new RoundedBoxGeometry(1.15, 1.35, 0.85, 2, 0.06), MAT.cabinet);
  cab.position.set(1.85, 0.68, 0.45);
  cab.rotation.y = -0.3;
  cab.castShadow = true; cab.receiveShadow = true;
  grp.add(cab);
  for (let i = 0; i < 4; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.03), MAT.galv);
    vent.position.set(1.85, 0.95 - i * 0.14, 0.45);
    vent.rotation.y = -0.3;
    vent.position.add(new THREE.Vector3(Math.sin(-0.3) * 0.43, 0, Math.cos(-0.3) * 0.43));
    grp.add(vent);
  }

  // solar panel on a short arm
  const solarArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), MAT.galv);
  solarArm.position.set(-0.9, H * 0.52, 0);
  solarArm.rotation.z = Math.PI / 2;
  grp.add(solarArm);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 1.25), MAT.solar);
  panel.position.set(-1.7, H * 0.55, 0);
  panel.rotation.z = 0.55;
  panel.rotation.y = 0.2;
  panel.castShadow = true;
  grp.add(panel);
  const panelFrame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 1.35), MAT.galv);
  panelFrame.position.copy(panel.position);
  panelFrame.rotation.copy(panel.rotation);
  panelFrame.position.y -= 0.05;
  grp.add(panelFrame);

  // panel antenna + top whip
  const ant = new THREE.Mesh(new RoundedBoxGeometry(0.42, 1.5, 0.18, 2, 0.06), MAT.rubber);
  ant.position.set(0.55, H - 1.1, 0.12);
  ant.castShadow = true;
  grp.add(ant);
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 2.0, 6), MAT.rubber);
  whip.position.y = H + 0.85;
  whip.castShadow = true;
  grp.add(whip);

  const beaconMat = new THREE.MeshStandardMaterial({
    color: labelColor, emissive: labelColor, emissiveIntensity: 1.4, roughness: 0.35,
  });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), beaconMat);
  tip.position.y = H + 1.95;
  grp.add(tip);
  const halo = new THREE.PointLight(labelColor, 6, 22, 2);
  halo.position.y = H + 1.95;
  grp.add(halo);
  beacons.push({ mat: beaconMat, light: halo, base: labelColor, phase: Math.random() * Math.PI * 2 });

  const lbl = makeLabel(label, '#43303C', 0.72);
  lbl.position.y = H + 3.4;
  grp.add(lbl);
  grp.userData.h = H + 1.95;
  return grp;
}

const NODES = {
  tdeck:   { pos: NODES_POS.tdeck },
  r1:      { pos: NODES_POS.r1,      label: 'RELAY 1F4C · MESHTASTIC', color: COLORS.lime, tall: 1.05 },
  r2:      { pos: NODES_POS.r2,      label: 'RELAY A9E2 · MESHCORE',   color: COLORS.lime, tall: 0.95 },
  gateway: { pos: NODES_POS.gateway, label: 'GATEWAY · IP UPLINK',     color: COLORS.cyan, tall: 1.25 },
  amb1:    { pos: NODES_POS.amb1,    label: 'NODE 77D0 · RNODE',       color: COLORS.lime, tall: 0.9 },
  amb2:    { pos: NODES_POS.amb2,    label: 'NODE C3B8 · MESHTASTIC',  color: COLORS.lime, tall: 1.0 },
  amb3:    { pos: NODES_POS.amb3,    label: 'NODE 04AF · MESHCORE',    color: COLORS.lime, tall: 0.85 },
  amb4:    { pos: NODES_POS.amb4,    label: 'NODE 3E91 · MESHTASTIC',  color: COLORS.lime, tall: 0.9 },
  amb5:    { pos: NODES_POS.amb5,    label: 'NODE B44A · RNODE',       color: COLORS.lime, tall: 0.8 },
  amb6:    { pos: NODES_POS.amb6,    label: 'NODE 9D07 · MESHTASTIC',  color: COLORS.lime, tall: 1.1 },
};
for (const k of Object.keys(NODES)) {
  if (k === 'tdeck') continue;
  const n = NODES[k];
  n.group = makeRelayNode(n.label, n.color, n.tall);
  n.group.position.copy(n.pos);
  scene.add(n.group);
}
const _antTip = new THREE.Vector3();
const antennaTop = (k) => k === 'tdeck'
  ? tdeckAntennaTip.getWorldPosition(_antTip).clone()
  : NODES[k].pos.clone().add(new THREE.Vector3(0, NODES[k].group.userData.h + 0.2, 0));

// ---------------------------------------------------------------- T-Deck
const screenCanvas = document.createElement('canvas');
screenCanvas.width = 640; screenCanvas.height = 480;
const sctx = screenCanvas.getContext('2d');
const screenTex = new THREE.CanvasTexture(screenCanvas);
screenTex.colorSpace = THREE.SRGBColorSpace;
screenTex.anisotropy = 8;

const feed = { rows: [], resolved: false, pointerSeen: false };
const PROTOS = ['MTSTC', 'MSHCR', 'RNODE'];
function randHex(n) { let s = ''; for (let i = 0; i < n; i++) s += '0123456789ABCDEF'[Math.random() * 16 | 0]; return s; }
let feedClock = 0;
function pushFeedRow(shelby = false) {
  feed.rows.push({
    t: new Date(feedClock * 1000 + 1755250000000).toISOString().slice(14, 22),
    proto: shelby ? 'MTSTC' : PROTOS[Math.random() * 3 | 0],
    src: '!' + randHex(4), dst: shelby ? '^all ' : (Math.random() < 0.4 ? '^all ' : '!' + randHex(4)),
    type: shelby ? 'SHLB PTR' : ['TEXT', 'POS', 'NODEINFO', 'TELEM', 'ACK', 'ROUTE'][Math.random() * 6 | 0],
    snr: (Math.random() * 14 - 4).toFixed(1),
    shelby,
  });
  if (shelby) feed.pointerSeen = true;
  if (feed.rows.length > 11) feed.rows.shift();
  drawScreen();
}
function drawResolvedPhoto(x, y, w, h) {
  const sky2 = sctx.createLinearGradient(0, y, 0, y + h);
  sky2.addColorStop(0, '#1b2f4a'); sky2.addColorStop(0.62, '#7a4a6e'); sky2.addColorStop(1, '#f05aa6');
  sctx.fillStyle = sky2; sctx.fillRect(x, y, w, h);
  sctx.fillStyle = '#f2b8d4';
  sctx.beginPath(); sctx.arc(x + w * 0.72, y + h * 0.38, 9, 0, Math.PI * 2); sctx.fill();
  sctx.fillStyle = '#0b1016';
  sctx.beginPath();
  sctx.moveTo(x, y + h);
  sctx.lineTo(x + w * 0.3, y + h * 0.45); sctx.lineTo(x + w * 0.52, y + h);
  sctx.closePath(); sctx.fill();
  sctx.beginPath();
  sctx.moveTo(x + w * 0.4, y + h);
  sctx.lineTo(x + w * 0.72, y + h * 0.58); sctx.lineTo(x + w, y + h);
  sctx.closePath(); sctx.fill();
  sctx.strokeStyle = '#66F05A'; sctx.lineWidth = 3;
  sctx.strokeRect(x, y, w, h);
}
function drawScreen() {
  const w = screenCanvas.width, h = screenCanvas.height;
  sctx.fillStyle = '#04070a'; sctx.fillRect(0, 0, w, h);
  sctx.fillStyle = '#F05AA6'; sctx.fillRect(0, 0, w, 42);
  sctx.fillStyle = '#04070a'; sctx.font = '600 25px ui-monospace, Menlo, monospace';
  sctx.fillText('LILYSHARK α · 1 TRAFFIC', 12, 30);
  sctx.textAlign = 'right';
  sctx.font = '600 20px ui-monospace, Menlo, monospace';
  sctx.fillText('906.875MHz SF11', w - 12, 29);
  sctx.textAlign = 'left';
  sctx.fillStyle = '#71D8DF'; sctx.font = '19px ui-monospace, Menlo, monospace';
  sctx.fillText('TIME      PROTO  SRC    DST    TYPE     SNR', 12, 74);
  sctx.strokeStyle = 'rgba(240,244,239,0.25)';
  sctx.beginPath(); sctx.moveTo(0, 86); sctx.lineTo(w, 86); sctx.stroke();
  sctx.font = '20px ui-monospace, Menlo, monospace';
  feed.rows.forEach((r, i) => {
    const y = 116 + i * 32;
    if (r.shelby) { sctx.fillStyle = 'rgba(240,90,166,0.22)'; sctx.fillRect(0, y - 22, w, 29); }
    sctx.fillStyle = r.shelby ? '#F05AA6' : '#66F05A';
    sctx.fillText(`${r.t} ${r.proto} ${r.src} ${r.dst} ${r.type.padEnd(8)} ${r.snr}`, 12, y);
  });
  if (feed.resolved) {
    sctx.fillStyle = 'rgba(4,7,10,0.92)'; sctx.fillRect(46, 130, w - 92, 220);
    sctx.strokeStyle = '#66F05A'; sctx.lineWidth = 3; sctx.strokeRect(46, 130, w - 92, 220);
    drawResolvedPhoto(66, 152, 176, 140);
    sctx.fillStyle = '#66F05A'; sctx.font = '600 27px ui-monospace, Menlo, monospace';
    sctx.fillText('SHELBY POINTER', 264, 196);
    sctx.fillText('RESOLVED ✓', 264, 230);
    sctx.font = '19px ui-monospace, Menlo, monospace'; sctx.fillStyle = '#F0F4EF';
    sctx.fillText('blob 4.2 MB', 264, 272);
    sctx.fillText('owner 0x9c…e1', 264, 300);
    sctx.lineWidth = 1;
  }
  screenTex.needsUpdate = true;
}
drawScreen();

function textPlane(text, colorCss, fontPx, wUnits, hUnits) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round(512 * hUnits / wUnits);
  const g = c.getContext('2d');
  g.font = `600 ${fontPx}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = colorCss;
  g.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wUnits, hUnits),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  return m;
}

function roundedRectShape(w, h, r) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2 + r, -h / 2);
  sh.lineTo(w / 2 - r, -h / 2);
  sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  sh.lineTo(w / 2, h / 2 - r);
  sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  sh.lineTo(-w / 2 + r, h / 2);
  sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  sh.lineTo(-w / 2, -h / 2 + r);
  sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return sh;
}

// LILYGO T-Deck Pro: chamfered portrait body, LILYGO strip over a recessed
// 4:3 screen, chevron trackball band, inset QWERTY well, whip antenna.
const tdeck = new THREE.Group();
let tdeckAntennaTip;
{
  const W = 7.2, H = 11.4, D = 1.5, FRONT = D / 2;
  const depth = D - 0.3;
  const bodyGeo = new THREE.ExtrudeGeometry(roundedRectShape(W, H, 0.62), {
    depth, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 3, curveSegments: 14,
  });
  bodyGeo.translate(0, 0, -depth / 2 - 0.15);
  bodyGeo.computeVertexNormals();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e35, roughness: 0.44, metalness: 0.45, roughnessMap: plasticRough,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true; body.receiveShadow = true;
  tdeck.add(body);

  // rubberised side rails, like the moulded grips on the real shell
  const railMat = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.85, metalness: 0.1 });
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.34, H - 1.6, D - 0.1, 2, 0.14), railMat);
    rail.position.set(sx * (W / 2 - 0.05), 0.2, 0);
    rail.castShadow = true;
    tdeck.add(rail);
  }
  // side buttons
  for (const [sy, len] of [[2.4, 1.1], [1.0, 0.55]]) {
    const btn = new THREE.Mesh(new RoundedBoxGeometry(0.14, len, 0.3, 2, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.35, metalness: 0.8 }));
    btn.position.set(W / 2 + 0.04, sy, 0);
    tdeck.add(btn);
  }
  // USB-C slot on the bottom edge
  const usb = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.22, 0.3, 2, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.6, metalness: 0.4 }));
  usb.position.set(0, -H / 2 + 0.02, 0);
  tdeck.add(usb);

  // earpiece slot + camera dot + LILYGO strip
  const slot = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.12, 0.12, 2, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.8, metalness: 0.2 }));
  slot.position.set(0, H / 2 - 0.42, FRONT - 0.02);
  tdeck.add(slot);
  const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 16),
    new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.1, metalness: 0.9 }));
  cam.rotation.x = Math.PI / 2;
  cam.position.set(-2.2, H / 2 - 0.42, FRONT - 0.01);
  tdeck.add(cam);
  const logo = textPlane('LILYGO', '#b9bec7', 66, 2.0, 0.5);
  logo.position.set(0, H / 2 - 0.95, FRONT + 0.012);
  tdeck.add(logo);

  // recessed screen well: glass plate set back behind a raised bezel frame
  const SW = 6.5, SH = 4.88, wellZ = FRONT - 0.13;
  const well = new THREE.Mesh(new THREE.BoxGeometry(SW + 0.3, SH + 0.3, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.5, metalness: 0.2 }));
  well.position.set(0, 2.15, wellZ - 0.06);
  tdeck.add(well);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH),
    new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(0, 2.15, wellZ);
  tdeck.add(screen);
  // bezel frame standing proud of the display
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.35, metalness: 0.6 });
  const fw = 0.22;
  for (const [w, h, x, y] of [
    [SW + 0.26 + fw * 2, fw, 0, 2.15 + SH / 2 + 0.13 + fw / 2],
    [SW + 0.26 + fw * 2, fw, 0, 2.15 - SH / 2 - 0.13 - fw / 2],
    [fw, SH + 0.26, -(SW / 2 + 0.13 + fw / 2), 2.15],
    [fw, SH + 0.26, SW / 2 + 0.13 + fw / 2, 2.15],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.16), frameMat);
    bar.position.set(x, y, FRONT - 0.02);
    bar.castShadow = true;
    tdeck.add(bar);
  }

  // trackball band with chevron markings
  const chevL = textPlane('❯❯❯', '#c6cad1', 84, 1.7, 0.55);
  chevL.position.set(-2.15, -0.85, FRONT + 0.012);
  tdeck.add(chevL);
  const chevR = textPlane('❮❮❮', '#c6cad1', 84, 1.7, 0.55);
  chevR.position.set(2.15, -0.85, FRONT + 0.012);
  tdeck.add(chevR);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.1, 14, 36),
    new THREE.MeshStandardMaterial({ color: 0xb6bcc6, roughness: 0.22, metalness: 0.95 }));
  ring.position.set(0, -0.85, FRONT + 0.03);
  ring.castShadow = true;
  tdeck.add(ring);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.37, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0x1a1c21, roughness: 0.22, metalness: 0.5 }));
  ball.position.set(0, -0.85, FRONT + 0.1);
  tdeck.add(ball);

  // keyboard: recessed well, light deck, domed dark keys
  const deck = new THREE.Mesh(new RoundedBoxGeometry(6.6, 4.5, 0.12, 2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xa8adb8, roughness: 0.5, metalness: 0.25, roughnessMap: plasticRough }));
  deck.position.set(0, -3.55, FRONT - 0.11);
  deck.receiveShadow = true;
  tdeck.add(deck);
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.5, metalness: 0.28 });
  const keyGeo = new RoundedBoxGeometry(0.54, 0.56, 0.22, 3, 0.14);
  const ROWS = [
    { y: -2.15, n: 10, x0: -2.88, dx: 0.64 },
    { y: -2.90, n: 10, x0: -2.88, dx: 0.64 },
    { y: -3.65, n: 10, x0: -2.88, dx: 0.64 },
  ];
  for (const row of ROWS) {
    for (let c = 0; c < row.n; c++) {
      const kbtn = new THREE.Mesh(keyGeo, keyMat);
      kbtn.position.set(row.x0 + c * row.dx, row.y, FRONT - 0.02);
      kbtn.castShadow = true;
      tdeck.add(kbtn);
    }
  }
  for (const [x, w] of [[-2.88, 0.54], [-2.24, 0.54], [-1.3, 0.8], [0.15, 1.9], [1.6, 0.8], [2.4, 0.54], [2.98, 0.54]]) {
    const kbtn = new THREE.Mesh(new RoundedBoxGeometry(w, 0.56, 0.22, 3, 0.14), keyMat);
    kbtn.position.set(x, -4.4, FRONT - 0.02);
    kbtn.castShadow = true;
    tdeck.add(kbtn);
  }
  const foot = textPlane('▸ LILYGO ◂', '#8a8f99', 44, 1.9, 0.4);
  foot.position.set(0, -5.25, FRONT + 0.012);
  tdeck.add(foot);

  // whip antenna on an SMA collar off the top edge
  const antGrp = new THREE.Group();
  antGrp.position.set(2.3, H / 2 - 0.1, 0);
  antGrp.rotation.z = -0.13;
  const antMat = new THREE.MeshStandardMaterial({ color: 0x131519, roughness: 0.72, metalness: 0.25 });
  const smaMat = new THREE.MeshStandardMaterial({ color: 0xb9a37a, roughness: 0.3, metalness: 0.95 });
  const sma = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.42, 14), smaMat);
  sma.position.y = 0.24;
  antGrp.add(sma);
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 14), antMat);
  boot.position.y = 0.62;
  antGrp.add(boot);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.26, 14),
    new THREE.MeshStandardMaterial({ color: 0xefe9df, roughness: 0.5 }));
  band.position.y = 0.95;
  antGrp.add(band);
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.078, 8.0, 10), antMat);
  whip.position.y = 5.1;
  whip.castShadow = true;
  antGrp.add(whip);
  const whipTip = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 12), antMat);
  whipTip.position.y = 9.15;
  antGrp.add(whipTip);
  tdeckAntennaTip = new THREE.Object3D();
  tdeckAntennaTip.position.y = 9.15;
  antGrp.add(tdeckAntennaTip);
  tdeck.add(antGrp);

  const spill = new THREE.PointLight(0x7de86f, 5, 9, 2);
  spill.position.set(0, 2.2, FRONT + 2.0);
  tdeck.add(spill);

  // propped against the field case
  tdeck.position.copy(NODES.tdeck.pos).add(new THREE.Vector3(0, 5.35, 0));
  tdeck.rotation.x = -0.30;
  tdeck.rotation.y = 0.12;
  scene.add(tdeck);

  // pelican-style field case it rests on
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x4a3f49, roughness: 0.62, metalness: 0.18, roughnessMap: plasticRough });
  const kit = new THREE.Mesh(new RoundedBoxGeometry(8.2, 2.8, 5.0, 3, 0.28), caseMat);
  kit.position.copy(NODES.tdeck.pos).add(new THREE.Vector3(0.4, 1.4, -4.0));
  kit.rotation.y = 0.18;
  kit.castShadow = true; kit.receiveShadow = true;
  scene.add(kit);
  const lip = new THREE.Mesh(new RoundedBoxGeometry(8.3, 0.22, 5.1, 2, 0.09),
    new THREE.MeshStandardMaterial({ color: 0x2f2830, roughness: 0.6, metalness: 0.3 }));
  lip.position.copy(kit.position).add(new THREE.Vector3(0, 0.35, 0));
  lip.rotation.y = 0.18;
  scene.add(lip);
  for (const dx of [-2.4, 2.4]) {
    const latch = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.5, 0.22, 2, 0.07),
      new THREE.MeshStandardMaterial({ color: 0xc2c7cf, roughness: 0.3, metalness: 0.9 }));
    const off = new THREE.Vector3(dx, 0.25, 2.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.18);
    latch.position.copy(kit.position).add(off);
    latch.rotation.y = 0.18;
    latch.castShadow = true;
    scene.add(latch);
  }

  // soft contact shadow so nothing looks pasted onto the ground
  const shadowTex = canvasTex(128, (g, n) => {
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, 'rgba(90,60,80,0.55)');
    gr.addColorStop(0.55, 'rgba(90,60,80,0.22)');
    gr.addColorStop(1, 'rgba(90,60,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(20, 16),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.copy(NODES.tdeck.pos).add(new THREE.Vector3(0.6, 0.06, -1.6));
  scene.add(contact);
}

// ---------------------------------------------------------------- radio waves
// Superformula wave shells (after Sadowski's "Radiator"): each emission is an
// organic lobed shell, displaced in the vertex shader and banded in the
// fragment shader so wavefronts appear to travel outward through the shell.
const WAVE_VERT = `
uniform float uTime;
uniform float uSeed;
uniform float uAmp;
varying vec3 vDir;
varying vec3 vView;
varying float vDisp;
float superformula(float ang, float m, float n1, float n2, float n3) {
  float t1 = pow(abs(cos(m * ang / 4.0)), n2);
  float t2 = pow(abs(sin(m * ang / 4.0)), n3);
  return pow(max(t1 + t2, 1e-4), -1.0 / n1);
}
void main() {
  vec3 dir = normalize(position);
  float theta = atan(dir.z, dir.x);
  float phi = acos(clamp(dir.y, -1.0, 1.0));
  float m1 = 6.0 + mod(uSeed, 4.0) * 2.0;
  float m2 = 4.0 + mod(uSeed * 7.0, 3.0) * 2.0;
  float s1 = superformula(theta + uTime * 0.22 + uSeed, m1, 3.4, 6.0, 6.0);
  float s2 = superformula(phi + uTime * 0.13, m2, 4.2, 8.0, 8.0);
  float disp = clamp((s1 * s2 - 0.72) * uAmp, -0.22, 0.45);
  vDisp = disp;
  vec3 p = dir * (1.0 + disp);
  p.y *= 0.62;
  vDir = dir;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const WAVE_FRAG = `
uniform vec3 uColor;
uniform float uTime;
uniform float uProgress;
varying vec3 vDir;
varying vec3 vView;
varying float vDisp;
void main() {
  vec3 n = normalize(vDir);
  float facing = abs(dot(normalize(vView), n));
  float fres = pow(1.0 - facing, 1.35);
  float rings = 0.5 + 0.5 * sin((1.0 - vDir.y) * 26.0 - uTime * 9.0);
  float lobes = smoothstep(-0.05, 0.28, vDisp);
  float fade = pow(1.0 - uProgress, 1.4) * smoothstep(0.0, 0.16, uProgress);
  float a = (0.16 + 0.5 * fres) * (0.45 + 0.55 * rings) * (0.5 + 0.5 * lobes) * fade;
  gl_FragColor = vec4(uColor, a * 0.72);
}
`;
const shellGeo = new THREE.SphereGeometry(1, isCoarse ? 64 : 96, isCoarse ? 32 : 48, 0, Math.PI * 2, 0, Math.PI / 2);
function makeShellMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: WAVE_VERT,
    fragmentShader: WAVE_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uAmp: { value: 0.2 },
      uProgress: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
}
// soft gaussian ground ring
const ringTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0.0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.62, 'rgba(255,255,255,0)');
  grd.addColorStop(0.72, 'rgba(255,255,255,0.08)');
  grd.addColorStop(0.82, 'rgba(255,255,255,0.05)');
  grd.addColorStop(0.88, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.93, 'rgba(255,255,255,1)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const waveGeo = new THREE.PlaneGeometry(2, 2);

const wavePool = [];
function emitWave(pos, color, radius = 26, life = 2.6, y = 0.12, strong = false) {
  let w = wavePool.find(w => !w.active);
  if (!w) {
    w = {
      mesh: new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.NormalBlending })),
      dome: new THREE.Mesh(shellGeo, makeShellMaterial()),
      active: false,
    };
    w.mesh.rotation.x = -Math.PI / 2;
    scene.add(w.mesh); scene.add(w.dome);
    wavePool.push(w);
  }
  w.active = true; w.t = 0; w.life = life; w.radius = radius;
  w.mesh.visible = true;
  w.mesh.position.set(pos.x, y, pos.z);
  w.mesh.material.color.set(color);
  w.dome.visible = true;
  w.dome.position.set(pos.x, y, pos.z);
  w.dome.material.uniforms.uColor.value.set(color);
  w.dome.material.uniforms.uSeed.value = Math.random() * 10;
  w.dome.material.uniforms.uAmp.value = strong ? 0.36 : 0.15;
  w.strong = strong;
  return w;
}
function emitBurst(pos, color, radius) {
  emitWave(pos, color, radius, 2.6, 0.12, true);
  setTimeout(() => emitWave(pos, color, radius, 2.6, 0.12, true), 300);
  setTimeout(() => emitWave(pos, color, radius, 2.6), 600);
}
function updateWaves(dt) {
  for (const w of wavePool) {
    if (!w.active) continue;
    w.t += dt;
    const k = w.t / w.life;
    if (k >= 1) { w.active = false; w.mesh.visible = false; w.dome.visible = false; continue; }
    const r = 0.6 + k * w.radius;
    w.mesh.scale.set(r, r, r);
    w.mesh.material.opacity = 0.9 * (1 - k) * (1 - k);
    const dr = 0.6 + k * w.radius * (w.strong ? 0.5 : 0.38);
    w.dome.scale.set(dr, dr, dr);
    w.dome.material.uniforms.uProgress.value = k;
    w.dome.material.uniforms.uTime.value = elapsed;
  }
}

// ---------------------------------------------------------------- packet + trail
const packet = new THREE.Group();
{
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55),
    new THREE.MeshBasicMaterial({ color: 0xd6357f })
  );
  packet.add(core);
  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85),
    new THREE.MeshBasicMaterial({ color: COLORS.pink, wireframe: true, transparent: true, opacity: 0.75 })
  );
  packet.add(shell);
  const light = new THREE.PointLight(COLORS.pink, 20, 32, 2);
  packet.add(light);
  const lbl = makeLabel('SHLB · 82 B', '#D6357F', 0.72);
  lbl.position.y = 1.7;
  packet.add(lbl);
  packet.visible = false;
  scene.add(packet);
  packet.userData = { core, shell };
}
const trail = [];
for (let i = 0; i < 70; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot, color: COLORS.pink, transparent: true, opacity: 0, depthWrite: false, blending: THREE.NormalBlending,
  }));
  s.scale.setScalar(0.9);
  s.visible = false;
  scene.add(s);
  trail.push({ s, t: 1e9 });
}
let trailIdx = 0;
const lastTrailPos = new THREE.Vector3(1e9, 1e9, 1e9);
function maybeSpawnTrail() {
  if (!packet.visible) return;
  if (packet.position.distanceTo(lastTrailPos) < 0.6) return;
  lastTrailPos.copy(packet.position);
  const p = trail[trailIdx];
  trailIdx = (trailIdx + 1) % trail.length;
  p.t = 0;
  p.s.visible = true;
  p.s.position.copy(packet.position);
}
function updateTrail(dt) {
  for (const p of trail) {
    if (!p.s.visible) continue;
    p.t += dt;
    const k = p.t / 0.9;
    if (k >= 1) { p.s.visible = false; continue; }
    p.s.material.opacity = 0.6 * (1 - k);
    p.s.scale.setScalar(0.9 * (1 - k * 0.6));
  }
}

// ---------------------------------------------------------------- Shelby lattice
const lattice = new THREE.Group();
{
  const cubeGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const edgeGeo = new THREE.EdgesGeometry(cubeGeo);
  for (let x = -2; x <= 2; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (Math.random() < 0.28) continue;
    const e = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      color: COLORS.cyan, transparent: true, opacity: 0.5,
    }));
    e.position.set(x * 2.4, y * 2.4, z * 2.4);
    lattice.add(e);
  }
  const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1),
    new THREE.MeshBasicMaterial({ color: 0x1f7e8c, wireframe: true }));
  lattice.add(heart);
  const heartGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot, color: COLORS.cyan, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.NormalBlending,
  }));
  heartGlow.scale.setScalar(9);
  lattice.add(heartGlow);
  const lbl = makeLabel('SHELBY · BLOB STORAGE ON APTOS', '#1F7E8C', 1.0, 130);
  lbl.position.y = 6.6;
  lattice.add(lbl);
  lattice.position.set(60, 52, -70);
  scene.add(lattice);
  lattice.userData.heart = heart;
}

// layered soft uplink beam
const beam = new THREE.Group();
{
  const mk = (r0, r1, alpha) => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r0, r1, 43, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.NormalBlending })
    );
    m.userData.alpha = alpha;
    beam.add(m);
    return m;
  };
  mk(0.75, 1.15, 0.05);
  mk(0.38, 0.6, 0.08);
  mk(0.09, 0.12, 0.45);
  beam.position.set(60, 9.4 + 21.5, -70);
  scene.add(beam);
}
function setBeamOpacity(k) {
  for (const m of beam.children) m.material.opacity = k * m.userData.alpha;
}

// blob (the resolved payload)
const blob = new THREE.Group();
{
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2),
    new THREE.MeshBasicMaterial({ color: COLORS.pink, transparent: true, opacity: 0.92 }));
  blob.add(m);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  blob.add(e);
  const lbl = makeLabel('BLOB · 4.2 MB', '#43303C', 0.8);
  lbl.position.y = 2.6;
  blob.add(lbl);
  const light = new THREE.PointLight(COLORS.pink, 20, 40, 2);
  blob.add(light);
  blob.visible = false;
  scene.add(blob);
}

// ---------------------------------------------------------------- timeline
const capEl = document.getElementById('caption');
const capPhase = document.getElementById('cap-phase');
const capText = document.getElementById('cap-text');
const tfill = document.getElementById('tfill');
const scrollCue = document.getElementById('scrollcue');

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lookTD = V(-2, 5.8, 26);

const PHASES = [
  {
    len: 9, tag: '01 · THE DEVICE',
    html: '<b>Lilyshark</b> turns a LILYGO <i>T-Deck</i> into a handheld LoRa analyzer — capture, decode, spectrum, evidence. Open firmware on open hardware.',
    camA: V(-13, 5.5, 46), camB: V(13, 7, 46), lookA: lookTD, lookB: lookTD,
  },
  {
    len: 10, tag: '02 · THE CONSTRAINT',
    html: 'Off-grid mesh radio is starved for airtime. Measured against Meshtastic’s own simulator: <b>R = 7.36</b> transmissions per delivered message, reach falling <b>68.6% → 25.8%</b> as nodes join.',
    camA: V(10, 42, 66), camB: V(-14, 52, 58), lookA: V(0, 0, -18), lookB: V(0, 0, -22),
  },
  {
    len: 13, tag: '03 · THE MATH',
    html: 'Try to push one <b>4.2 MB</b> photo through the mesh, and it starves. Send a <em>reference</em> instead, and the mesh barely notices.'
      + '<div class="vs">'
      + '<div class="col bad"><h4>RAW BYTES OVER MESH</h4><ul>'
      + '<li><strong>~22,000</strong> frames <span>(~200 B each)</span></li>'
      + '<li><strong>~160,000</strong> transmissions <span>(× 7.36)</span></li>'
      + '<li><strong>days</strong> of shared channel time</li>'
      + '<li>blocks every other node<span> · likely never completes</span></li>'
      + '</ul></div>'
      + '<div class="col good"><h4>SHELBY POINTER</h4><ul>'
      + '<li><strong>1</strong> frame <span>· 82 bytes</span></li>'
      + '<li><strong>~7</strong> transmissions</li>'
      + '<li><strong>&lt;1 s</strong> of air</li>'
      + '<li>photo moves over IP<span> · mesh stays free</span></li>'
      + '</ul></div></div>',
    camA: V(-14, 52, 58), camB: V(16, 40, 50), lookA: V(0, 0, -22), lookB: V(0, 0, -18),
  },
  {
    len: 10, tag: '04 · THE POINTER',
    html: 'So the mesh never carries media. The device emits an <em>82-byte Shelby pointer</em> — blob commitment · owner · size · expiry — a <b>reference, not a payload</b>.',
    camA: V(9, 5.5, 38), camB: V(-6, 7.5, 36), lookA: lookTD, lookB: lookTD,
  },
  {
    len: 14, tag: '05 · THE MESH',
    html: 'The pointer rides inside an ordinary <i>Meshtastic · MeshCore · Reticulum</i> payload. Unmodified nodes forward it untouched — a payload convention, not a new link layer.',
    followPacket: true,
  },
  {
    len: 12, tag: '06 · THE GATEWAY',
    html: 'Any node with an IP path — a phone regaining signal, a base station — resolves the pointer against <em>Shelby</em>: paid, verifiable blob storage on <i>Aptos</i>.',
    camA: V(96, 18, -30), camB: V(84, 34, -22), lookA: V(60, 24, -70), lookB: V(60, 30, -70),
  },
  {
    len: 12, tag: '07 · THE RESOLUTION',
    html: 'The photo arrives — intact, persistent, verifiable on <em>Shelby</em> — and the mesh stayed free for everyone else’s traffic. <b>~50,000× fewer bytes</b> ever touched the air.',
    camA: V(100, 42, -14), camB: V(34, 18, 10), lookA: V(60, 30, -70), lookB: V(28, 8, -18),
  },
  {
    len: 11, tag: '08 · OPEN STACK',
    html: 'Open hardware · GPL-3.0 firmware · open mesh protocols · open webapp.<br><i>github.com/maxmoneycash/lilyshark</i>',
    orbit: true,
  },
];
const TOTAL = PHASES.reduce((s, p) => s + p.len, 0);
const BOUNDS = [];
{
  let acc = 0;
  for (const p of PHASES) { BOUNDS.push({ start: acc, end: acc + p.len }); acc += p.len; }
}
const T_POINTER = BOUNDS[3].start;
const T_MESH = BOUNDS[4].start;
const T_GATE = BOUNDS[5].start;
const T_RES = BOUNDS[6].start;
const T_END = BOUNDS[7].start;

// chapter ticks on the timeline
{
  const bar = document.getElementById('timeline');
  for (const b of BOUNDS) {
    if (b.start === 0) continue;
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.left = `${(b.start / TOTAL) * 100}%`;
    bar.appendChild(tick);
  }
}

// ---------------------------------------------------------------- scroll drive
// The page scrolls; the scene scrubs. scrollspace height defines the pace.
const scrollspace = document.getElementById('scrollspace');
scrollspace.style.height = `${Math.round(TOTAL * 9)}vh`;

let targetT = 0;
let timelineT = 0;
function readScroll() {
  const max = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
  targetT = (window.scrollY / max) * (TOTAL - 0.001);
}
addEventListener('scroll', readScroll, { passive: true });
readScroll();

// auto-scroll for record mode: 1 timeline second per real second
let autoScroll = null;
function startAutoScroll() {
  const max = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
  const fromY = window.scrollY;
  const fromT = (fromY / max) * TOTAL;
  const durMs = (TOTAL - fromT) * 1000;
  const t0 = performance.now();
  cancelAutoScroll();
  autoScroll = requestAnimationFrame(function step(now) {
    const p = Math.min((now - t0) / durMs, 1);
    window.scrollTo(0, fromY + (max - fromY) * p);
    if (p < 1 && autoScroll) autoScroll = requestAnimationFrame(step);
  });
}
function cancelAutoScroll() {
  if (autoScroll) cancelAnimationFrame(autoScroll);
  autoScroll = null;
}
addEventListener('wheel', cancelAutoScroll, { passive: true });
addEventListener('touchstart', cancelAutoScroll, { passive: true });

const recbtn = document.getElementById('recbtn');
recbtn.addEventListener('click', () => {
  const on = document.body.classList.toggle('rec');
  recbtn.classList.toggle('on', on);
  if (on) {
    window.scrollTo(0, 0);
    setTimeout(startAutoScroll, 600);
  } else {
    cancelAutoScroll();
  }
});
document.getElementById('skipbtn').addEventListener('click', () => {
  const next = BOUNDS.find(b => b.start > timelineT + 0.2);
  const max = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
  const y = next ? (next.start / TOTAL) * max : 0;
  window.scrollTo({ top: y, behavior: 'smooth' });
});

// one-shot decorations fired when the timeline crosses a marker going forward
let latticeFlash = 0;
const cues = [
  { at: T_POINTER + 0.3, fn: () => { if (!feed.pointerSeen) pushFeedRow(true); emitBurst(NODES.tdeck.pos, COLORS.pink, 30); } },
  { at: T_MESH + 14 / 3, fn: () => emitBurst(NODES.r1.pos, COLORS.pink, 26) },
  { at: T_MESH + 28 / 3, fn: () => emitBurst(NODES.r2.pos, COLORS.pink, 26) },
  { at: T_GATE - 0.2, fn: () => emitBurst(NODES.gateway.pos, COLORS.pink, 26) },
  { at: T_GATE + 7.4, fn: () => { latticeFlash = 1; } },
  { at: T_RES + 5.1, fn: () => emitBurst(NODES.gateway.pos, COLORS.cyan, 34) },
];
let prevT = -1;
function fireCues() {
  for (const c of cues) {
    if (prevT < c.at && timelineT >= c.at && timelineT - c.at < 3) c.fn();
  }
  prevT = timelineT;
}

// ---------------------------------------------------------------- deterministic actors
const HOP_POINTS = ['tdeck', 'r1', 'r2', 'gateway'];
function evalPacket(t) {
  // hidden before the pointer exists and after it enters Shelby
  if (t < T_POINTER + 0.3 || t >= T_GATE + 7.4) { packet.visible = false; return; }
  packet.visible = true;
  if (t < T_MESH) {
    // hover above the device antenna
    const p = antennaTop('tdeck');
    packet.position.set(p.x, p.y + 1.2 + Math.sin(elapsed * 1.8) * 0.25, p.z);
  } else if (t < T_GATE) {
    // three hops across the phase, each with a short hold at the node
    const u = (t - T_MESH) / (T_GATE - T_MESH) * 3;
    const seg = Math.min(Math.floor(u), 2);
    const k = THREE.MathUtils.clamp(u - seg, 0, 1);
    const hold = 0.16; // fraction of each segment spent holding at the node
    const kk = THREE.MathUtils.clamp((k - hold) / (1 - hold), 0, 1);
    const e = kk * kk * (3 - 2 * kk);
    const a = antennaTop(HOP_POINTS[seg]);
    const b = antennaTop(HOP_POINTS[seg + 1]);
    packet.position.lerpVectors(a, b, e);
    packet.position.y += Math.sin(e * Math.PI) * 7;
  } else {
    // ascend the beam into the lattice
    const u = t - T_GATE;
    const k = THREE.MathUtils.clamp((u - 1.2) / 6, 0, 1);
    const e = k * k * (3 - 2 * k);
    packet.position.lerpVectors(antennaTop('gateway'), lattice.position, e);
  }
  packet.userData.core.rotation.y = elapsed * 2.4;
  packet.userData.shell.rotation.x = elapsed * 1.1;
  maybeSpawnTrail();
}
function evalBeam(t) {
  let k = 0;
  if (t >= T_GATE) k = THREE.MathUtils.clamp((t - T_GATE) / 1.5, 0, 1);
  if (t >= T_END) k *= THREE.MathUtils.clamp(1 - (t - T_END) / 3, 0, 1);
  setBeamOpacity(k);
}
function evalBlob(t) {
  const u = t - T_RES;
  if (u <= 0 || u >= 5) { blob.visible = false; return; }
  blob.visible = true;
  const k = THREE.MathUtils.clamp(u / 5, 0, 1);
  blob.position.lerpVectors(lattice.position, antennaTop('gateway'), k * k);
  blob.rotation.y = elapsed * 1.5;
}
function evalScreen(t) {
  const resolved = t >= T_END - 1;
  if (resolved !== feed.resolved) { feed.resolved = resolved; drawScreen(); }
}

// ambient chatter — the constraint chapters flood the channel
let nextChatter = 0.5;
const AMBIENT = ['r1', 'r2', 'amb1', 'amb2', 'amb3', 'amb4', 'amb5', 'amb6', 'gateway'];
function updateAmbient(phaseIdx) {
  if (elapsed > nextChatter) {
    const flood = phaseIdx === 1 || phaseIdx === 2;
    nextChatter = elapsed + (flood ? 0.3 + Math.random() * 0.5 : 1.0 + Math.random() * 1.7);
    const n = AMBIENT[Math.random() * AMBIENT.length | 0];
    emitWave(NODES[n].pos, Math.random() < 0.2 ? COLORS.cyan : COLORS.lime, 15 + Math.random() * 11);
    if (Math.random() < 0.7) { feedClock += 0.6 + Math.random(); pushFeedRow(false); }
  }
}
function updateBeacons(t) {
  for (const b of beacons) {
    const k = 0.55 + 0.45 * Math.sin(t * 2.1 + b.phase);
    b.light.intensity = 5 + 7 * k;
    b.mat.color.set(b.base).multiplyScalar(0.55 + 0.65 * k);
  }
}

// ---------------------------------------------------------------- camera & loop
const clock = new THREE.Clock();
let elapsed = 0;
let phaseIdx = -1;

function setPhase(i) {
  phaseIdx = i;
  const p = PHASES[i];
  capPhase.textContent = p.tag;
  capText.innerHTML = p.html;
  capEl.classList.remove('show');
  requestAnimationFrame(() => requestAnimationFrame(() => capEl.classList.add('show')));
}

const camLook = new THREE.Vector3().copy(lookTD);
const drift = new THREE.Vector3();
function updateCamera(dt) {
  const p = PHASES[phaseIdx];
  const b = BOUNDS[phaseIdx];
  const k = THREE.MathUtils.clamp((timelineT - b.start) / p.len, 0, 1);
  const e = k * k * (3 - 2 * k);
  let target, look;
  const portrait = camera.aspect < 0.9;
  if (p.followPacket) {
    target = packet.position.clone().add(portrait ? V(9, 6, 11) : V(13, 8, 16));
    look = packet.position.clone();
  } else if (p.orbit) {
    const a = timelineT * 0.16;
    target = V(Math.sin(a) * 80, 30, Math.cos(a) * 80 - 10);
    look = V(0, 4, -6);
  } else {
    target = p.camA.clone().lerp(p.camB, e);
    look = p.lookA.clone().lerp(p.lookB, e);
  }
  // portrait screens need a little more distance to hold the same framing
  if (portrait && !p.followPacket) {
    target = look.clone().add(target.clone().sub(look).multiplyScalar(1.28));
  }
  drift.set(
    Math.sin(elapsed * 0.55) * 0.5 + Math.sin(elapsed * 1.31) * 0.18,
    Math.sin(elapsed * 0.42 + 2.1) * 0.32,
    Math.cos(elapsed * 0.61 + 0.7) * 0.4
  );
  target.add(drift);
  camera.position.lerp(target, Math.min(dt * 2.2, 1));
  camLook.lerp(look, Math.min(dt * 3.0, 1));
  camera.lookAt(camLook);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  // smooth scrub toward the scroll position
  timelineT += (targetT - timelineT) * Math.min(dt * 4.5, 1);

  let idx = 0;
  for (let i = 0; i < PHASES.length; i++) {
    if (timelineT >= BOUNDS[i].start - 0.001) idx = i;
  }
  if (idx !== phaseIdx) setPhase(idx);

  fireCues();
  evalPacket(timelineT);
  evalBeam(timelineT);
  evalBlob(timelineT);
  evalScreen(timelineT);
  updateWaves(dt);
  updateTrail(dt);
  updateAmbient(phaseIdx);
  updateBeacons(elapsed);
  updateLabels();
  if (latticeFlash > 0) {
    latticeFlash = Math.max(latticeFlash - dt * 0.8, 0);
    lattice.userData.heart.scale.setScalar(1 + latticeFlash * 1.6);
  }
  for (const c of clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > 340) c.position.x = -340; }
  lattice.rotation.y += dt * 0.12;
  lattice.userData.heart.rotation.x += dt * 0.4;
  updateCamera(dt);

  tfill.style.width = `${(timelineT / TOTAL) * 100}%`;
  if (scrollCue) scrollCue.style.opacity = timelineT < 1.5 ? 1 : 0;
  composer.render();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  readScroll();
});

// seed the device feed so the screen is alive on load
for (let i = 0; i < 7; i++) { feedClock += 0.8 + Math.random(); pushFeedRow(false); }
setPhase(0);
animate();

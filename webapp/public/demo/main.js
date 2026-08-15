// Lilyshark Field Demo — a scripted 3D scene showing the Shelby off-grid
// pointer flow: T-Deck capture node → LoRa mesh → gateway → Shelby on Aptos.
// Self-contained: three.js is vendored, no network requests.

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from './vendor/geometries/RoundedBoxGeometry.js';

const COLORS = {
  bg: 0x06080b,
  pink: 0xf05aa6,
  lime: 0x66f05a,
  cyan: 0x71d8df,
  amber: 0xf0b429,
  paper: 0xf0f4ef,
  body: 0x14181d,
  grid1: 0x1b2532,
  grid2: 0x0f151d,
};

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);
scene.fog = new THREE.FogExp2(COLORS.bg, 0.0040);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1200);
camera.position.set(-8, 4, 38);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.72, 0.55, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 6;
controls.maxDistance = 260;

let userControl = false;
let lastInteract = -1e9;
renderer.domElement.addEventListener('pointerdown', () => { userControl = true; lastInteract = clockNow(); });
renderer.domElement.addEventListener('wheel', () => { userControl = true; lastInteract = clockNow(); }, { passive: true });

// ---------------------------------------------------------------- lights
scene.add(new THREE.AmbientLight(0x4a5866, 2.55));
const key = new THREE.DirectionalLight(0x9fb4c8, 1.8);
key.position.set(-60, 90, 40);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -130; key.shadow.camera.right = 130;
key.shadow.camera.top = 130; key.shadow.camera.bottom = -130;
key.shadow.camera.far = 320;
key.shadow.bias = -0.0004;
scene.add(key);
const pinkFill = new THREE.PointLight(COLORS.pink, 50, 90, 1.9);
pinkFill.position.set(0, 14, 22);
scene.add(pinkFill);

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

// ---------------------------------------------------------------- terrain
function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  const flat = THREE.MathUtils.smoothstep(r, 78, 190); // keep the node field flat
  const h =
    6.0 * Math.sin(x * 0.020 + 1.7) * Math.cos(z * 0.017 + 0.4) +
    3.2 * Math.sin(x * 0.043 + 3.1) * Math.sin(z * 0.050 + 1.2) +
    1.6 * Math.cos(x * 0.090 + 0.8) * Math.cos(z * 0.080 + 2.2);
  return Math.max(h, -1.5) * flat;
}
{
  const geo = new THREE.PlaneGeometry(720, 720, 110, 110);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(0x11181f), cHigh = new THREE.Color(0x2a3a4c);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y - 0.12);
    const c = cLow.clone().lerp(cHigh, THREE.MathUtils.clamp(y / 9 + 0.15, 0, 1));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.05, flatShading: true,
  }));
  terrain.receiveShadow = true;
  scene.add(terrain);
}
// distant mountain silhouettes
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x121a24, roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.sin(i * 7.3) * 0.14;
    const r = 300 + ((i * 37) % 120);
    const h = 34 + ((i * 53) % 62);
    const m = new THREE.Mesh(new THREE.ConeGeometry(26 + ((i * 29) % 34), h, 5), mat);
    m.position.set(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r);
    m.rotation.y = i * 1.3;
    scene.add(m);
  }
}
// grid over the flat field only
const grid = new THREE.GridHelper(230, 46, COLORS.grid1, COLORS.grid2);
grid.material.transparent = true;
grid.material.opacity = 0.5;
grid.position.y = 0.02;
scene.add(grid);

// stars + moon
{
  const n = 1400, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 420 + Math.random() * 280;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(1 - Math.random() * 0.8);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) + 8;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x9db4c4, size: 1.15, sizeAttenuation: false, transparent: true, opacity: 0.55,
  })));
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(22, 48),
    new THREE.MeshBasicMaterial({ color: 0xf2b8d4, transparent: true, opacity: 0.85, fog: false })
  );
  moon.position.set(-260, 190, -420);
  moon.lookAt(0, 0, 0);
  scene.add(moon);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot, color: 0xf05aa6, transparent: true, opacity: 0.16, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  glow.scale.setScalar(110);
  glow.position.copy(moon.position);
  scene.add(glow);
}

// ---------------------------------------------------------------- helpers
function makeLabel(text, colorCss, scale = 1) {
  const pad = 18, fs = 34;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w; c.height = fs + pad * 1.6;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(6,8,11,0.78)';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(240,244,239,0.25)';
  g.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
  g.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
  g.fillStyle = colorCss;
  g.textBaseline = 'middle';
  g.fillText(text, pad, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95 }));
  sp.scale.set((c.width / 46) * scale, (c.height / 46) * scale, 1);
  return sp;
}


// ---------------------------------------------------------------- mesh nodes
const beacons = [];
function makeRelayNode(label, labelColor, tall = 1) {
  const grp = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x28313c, roughness: 0.45, metalness: 0.65 });
  const H = 7.4 * tall;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.22, H, 8), metal);
  pole.position.y = H / 2;
  pole.castShadow = true;
  grp.add(pole);
  // crossbars
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5 - i * 0.35, 0.09, 0.09), metal);
    bar.position.y = H - 0.9 - i * 0.75;
    bar.castShadow = true;
    grp.add(bar);
  }
  // base pad + equipment box
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 0.32, 24), metal);
  base.position.y = 0.16;
  base.castShadow = true;
  grp.add(base);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.5), new THREE.MeshStandardMaterial({ color: 0x1a2129, roughness: 0.7, metalness: 0.3 }));
  box.position.set(1.15, 0.3, 0.3);
  box.castShadow = true;
  grp.add(box);
  // guy wires
  const wireMat = new THREE.LineBasicMaterial({ color: 0x2c3846, transparent: true, opacity: 0.6 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, H - 1.1, 0),
      new THREE.Vector3(Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6),
    ]);
    grp.add(new THREE.Line(g, wireMat));
  }
  // beacon
  const beaconMat = new THREE.MeshBasicMaterial({ color: labelColor });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 16), beaconMat);
  tip.position.y = H + 0.2;
  grp.add(tip);
  const halo = new THREE.PointLight(labelColor, 16, 30, 2);
  halo.position.y = H + 0.2;
  grp.add(halo);
  beacons.push({ mat: beaconMat, light: halo, base: labelColor, phase: Math.random() * Math.PI * 2 });
  const lbl = makeLabel(label, '#F0F4EF', 0.78);
  lbl.position.y = H + 2.1;
  grp.add(lbl);
  grp.userData.h = H;
  return grp;
}

const NODES = {
  tdeck:   { pos: new THREE.Vector3(-2, 0, 26) },
  r1:      { pos: new THREE.Vector3(-30, 0, -8),  label: 'RELAY 1F4C · MESHTASTIC', color: COLORS.lime, tall: 1.05 },
  r2:      { pos: new THREE.Vector3(18, 0, -30),  label: 'RELAY A9E2 · MESHCORE',   color: COLORS.lime, tall: 0.95 },
  gateway: { pos: new THREE.Vector3(60, 0, -70),  label: 'GATEWAY · IP UPLINK',     color: COLORS.cyan, tall: 1.25 },
  amb1:    { pos: new THREE.Vector3(-58, 0, -46), label: 'NODE 77D0 · RNODE',       color: COLORS.lime, tall: 0.9 },
  amb2:    { pos: new THREE.Vector3(44, 0, 14),   label: 'NODE C3B8 · MESHTASTIC',  color: COLORS.lime, tall: 1.0 },
  amb3:    { pos: new THREE.Vector3(-18, 0, -66), label: 'NODE 04AF · MESHCORE',    color: COLORS.lime, tall: 0.85 },
  amb4:    { pos: new THREE.Vector3(-72, 0, 10),  label: 'NODE 3E91 · MESHTASTIC',  color: COLORS.lime, tall: 0.9 },
  amb5:    { pos: new THREE.Vector3(76, 0, -22),  label: 'NODE B44A · RNODE',       color: COLORS.lime, tall: 0.8 },
  amb6:    { pos: new THREE.Vector3(6, 0, -95),   label: 'NODE 9D07 · MESHTASTIC',  color: COLORS.lime, tall: 1.1 },
};
for (const k of Object.keys(NODES)) {
  if (k === 'tdeck') continue;
  const n = NODES[k];
  n.group = makeRelayNode(n.label, n.color, n.tall);
  n.group.position.copy(n.pos);
  scene.add(n.group);
}
const antennaTop = (k) => k === 'tdeck'
  ? NODES.tdeck.pos.clone().add(new THREE.Vector3(-3.9, 9.2, 0))
  : NODES[k].pos.clone().add(new THREE.Vector3(0, NODES[k].group.userData.h + 0.2, 0));

// ---------------------------------------------------------------- T-Deck
// Stylized LILYGO T-Deck: landscape screen above a thumb keyboard, trackball,
// stub antenna. The screen is a live canvas running a fake Lilyshark feed.
const screenCanvas = document.createElement('canvas');
screenCanvas.width = 640; screenCanvas.height = 288;
const sctx = screenCanvas.getContext('2d');
const screenTex = new THREE.CanvasTexture(screenCanvas);
screenTex.colorSpace = THREE.SRGBColorSpace;
screenTex.anisotropy = 8;

const feed = { rows: [], resolved: false, pointerSeen: false };
const PROTOS = ['MTSTC', 'MSHCR', 'RNODE'];
function randHex(n) { let s = ''; for (let i = 0; i < n; i++) s += '0123456789ABCDEF'[Math.random() * 16 | 0]; return s; }
function pushFeedRow(shelby = false) {
  feed.rows.push({
    t: new Date(clockNow() * 1000 + 1755250000000).toISOString().slice(14, 22),
    proto: shelby ? 'MTSTC' : PROTOS[Math.random() * 3 | 0],
    src: '!' + randHex(4), dst: shelby ? '^all ' : (Math.random() < 0.4 ? '^all ' : '!' + randHex(4)),
    type: shelby ? 'SHLB PTR' : ['TEXT', 'POS', 'NODEINFO', 'TELEM', 'ACK', 'ROUTE'][Math.random() * 6 | 0],
    snr: (Math.random() * 14 - 4).toFixed(1),
    shelby,
  });
  if (shelby) feed.pointerSeen = true;
  if (feed.rows.length > 9) feed.rows.shift();
  drawScreen();
}
function drawResolvedPhoto(x, y, w, h) {
  // tiny synthetic landscape "photo"
  const sky = sctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, '#1b2f4a'); sky.addColorStop(0.62, '#7a4a6e'); sky.addColorStop(1, '#f05aa6');
  sctx.fillStyle = sky; sctx.fillRect(x, y, w, h);
  sctx.fillStyle = '#f2b8d4';
  sctx.beginPath(); sctx.arc(x + w * 0.72, y + h * 0.38, 7, 0, Math.PI * 2); sctx.fill();
  sctx.fillStyle = '#0b1016';
  sctx.beginPath();
  sctx.moveTo(x, y + h);
  sctx.lineTo(x + w * 0.3, y + h * 0.45); sctx.lineTo(x + w * 0.52, y + h);
  sctx.closePath(); sctx.fill();
  sctx.beginPath();
  sctx.moveTo(x + w * 0.4, y + h);
  sctx.lineTo(x + w * 0.72, y + h * 0.58); sctx.lineTo(x + w, y + h);
  sctx.closePath(); sctx.fill();
  sctx.strokeStyle = '#66F05A'; sctx.lineWidth = 2;
  sctx.strokeRect(x, y, w, h);
}
function drawScreen() {
  const w = screenCanvas.width, h = screenCanvas.height;
  sctx.fillStyle = '#04070a'; sctx.fillRect(0, 0, w, h);
  sctx.fillStyle = '#F05AA6'; sctx.fillRect(0, 0, w, 30);
  sctx.fillStyle = '#04070a'; sctx.font = '600 19px ui-monospace, Menlo, monospace';
  sctx.fillText('LILYSHARK α  ·  1 TRAFFIC', 10, 21);
  sctx.textAlign = 'right';
  sctx.fillText('906.875MHz SF11', w - 10, 21);
  sctx.textAlign = 'left';
  sctx.fillStyle = '#71D8DF'; sctx.font = '15px ui-monospace, Menlo, monospace';
  sctx.fillText('TIME      PROTO  SRC    DST    TYPE      SNR', 10, 50);
  sctx.strokeStyle = 'rgba(240,244,239,0.25)';
  sctx.beginPath(); sctx.moveTo(0, 58); sctx.lineTo(w, 58); sctx.stroke();
  sctx.font = '16px ui-monospace, Menlo, monospace';
  feed.rows.forEach((r, i) => {
    const y = 78 + i * 22;
    if (r.shelby) { sctx.fillStyle = 'rgba(240,90,166,0.22)'; sctx.fillRect(0, y - 15, w, 20); }
    sctx.fillStyle = r.shelby ? '#F05AA6' : '#66F05A';
    sctx.fillText(`${r.t}  ${r.proto}  ${r.src}  ${r.dst}  ${r.type.padEnd(8)}  ${r.snr}`, 10, y);
  });
  if (feed.resolved) {
    sctx.fillStyle = 'rgba(4,7,10,0.92)'; sctx.fillRect(50, 84, w - 100, 120);
    sctx.strokeStyle = '#66F05A'; sctx.lineWidth = 2; sctx.strokeRect(50, 84, w - 100, 120);
    drawResolvedPhoto(66, 100, 118, 88);
    sctx.fillStyle = '#66F05A'; sctx.font = '600 21px ui-monospace, Menlo, monospace';
    sctx.fillText('SHELBY POINTER', 202, 124);
    sctx.fillText('RESOLVED ✓', 202, 150);
    sctx.font = '15px ui-monospace, Menlo, monospace'; sctx.fillStyle = '#F0F4EF';
    sctx.fillText('blob 4.2 MB · owner 0x9c…e1', 202, 178);
    sctx.lineWidth = 1;
  }
  screenTex.needsUpdate = true;
}
drawScreen();

const tdeck = new THREE.Group();
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS.body, roughness: 0.38, metalness: 0.35 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(9, 5.8, 1.0, 4, 0.3), bodyMat);
  body.castShadow = true;
  tdeck.add(body);
  // screen bezel + screen
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(8.35, 4.0, 0.06), new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.25, metalness: 0.4 }));
  bezel.position.set(0, 0.82, 0.5);
  tdeck.add(bezel);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(7.9, 3.55),
    new THREE.MeshBasicMaterial({ map: screenTex })
  );
  screen.position.set(0, 0.82, 0.54);
  tdeck.add(screen);
  // keyboard
  const keyGeo = new RoundedBoxGeometry(0.6, 0.38, 0.16, 2, 0.06);
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x232b35, roughness: 0.7, metalness: 0.2 });
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 10; c++) {
      const kbtn = new THREE.Mesh(keyGeo, keyMat);
      kbtn.position.set(-3.6 + c * 0.8, -1.55 - r * 0.52, 0.52);
      tdeck.add(kbtn);
    }
  }
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0x39434f, roughness: 0.25, metalness: 0.6 })
  );
  ball.position.set(3.9, -1.2, 0.52);
  tdeck.add(ball);
  // power LED
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: COLORS.lime }));
  led.position.set(4.1, 0.9, 0.52);
  tdeck.add(led);
  // antenna with collar
  const antMat = new THREE.MeshStandardMaterial({ color: 0x0d1013, roughness: 0.85 });
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 12), antMat);
  collar.position.set(-3.9, 3.1, 0);
  tdeck.add(collar);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 2.6, 8), antMat);
  ant.position.set(-3.9, 4.5, 0);
  ant.castShadow = true;
  tdeck.add(ant);
  const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 12),
    new THREE.MeshBasicMaterial({ color: COLORS.pink }));
  antTip.position.set(-3.9, 5.8, 0);
  tdeck.add(antTip);
  const lbl = makeLabel('LILYSHARK · LILYGO T-DECK', '#F05AA6', 0.82);
  lbl.position.set(0, 6.9, 0);
  tdeck.add(lbl);

  tdeck.position.copy(NODES.tdeck.pos).add(new THREE.Vector3(0, 3.4, 0));
  tdeck.rotation.x = -0.16;
  tdeck.rotation.y = 0.10;
  scene.add(tdeck);
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
  vec3 n = normalize((vec4(vDir, 0.0)).xyz);
  float facing = abs(dot(normalize(vView), normalize(n)));
  float fres = pow(1.0 - facing, 1.35);
  float rings = 0.5 + 0.5 * sin((1.0 - vDir.y) * 26.0 - uTime * 9.0);
  float lobes = smoothstep(-0.05, 0.28, vDisp);
  float fade = pow(1.0 - uProgress, 1.4) * smoothstep(0.0, 0.16, uProgress);
  float a = (0.16 + 0.5 * fres) * (0.45 + 0.55 * rings) * (0.5 + 0.5 * lobes) * fade;
  gl_FragColor = vec4(uColor, a * 0.33);
}
`;
const shellGeo = new THREE.SphereGeometry(1, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2);
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
    blending: THREE.AdditiveBlending,
  });
}

const wavePool = [];
const waveGeo = new THREE.RingGeometry(0.96, 1, 72);
function emitWave(pos, color, radius = 26, life = 2.6, y = 0.12, strong = false) {
  let w = wavePool.find(w => !w.active);
  if (!w) {
    w = {
      mesh: new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false })),
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
    w.mesh.material.opacity = 0.8 * (1 - k) * (1 - k);
    if (w.dome.visible) {
      const dr = 0.6 + k * w.radius * (w.strong ? 0.5 : 0.38);
      w.dome.scale.set(dr, dr, dr);
      w.dome.material.uniforms.uProgress.value = k;
      w.dome.material.uniforms.uTime.value = elapsed;
    }
  }
}

// ---------------------------------------------------------------- packet + trail
const packet = new THREE.Group();
{
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55),
    new THREE.MeshBasicMaterial({ color: 0xff7cc0 })
  );
  packet.add(core);
  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85),
    new THREE.MeshBasicMaterial({ color: COLORS.pink, wireframe: true, transparent: true, opacity: 0.55 })
  );
  packet.add(shell);
  const light = new THREE.PointLight(COLORS.pink, 42, 32, 2);
  packet.add(light);
  const lbl = makeLabel('SHLB · 82 B', '#F05AA6', 0.8);
  lbl.position.y = 1.7;
  packet.add(lbl);
  packet.visible = false;
  scene.add(packet);
  packet.userData = { core, shell };
}
const trail = [];
for (let i = 0; i < 70; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot, color: COLORS.pink, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(0.9);
  s.visible = false;
  scene.add(s);
  trail.push({ s, t: 1e9 });
}
let trailIdx = 0, trailAcc = 0;
function spawnTrail(dt) {
  trailAcc += dt;
  if (trailAcc < 0.035) return;
  trailAcc = 0;
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
    p.s.material.opacity = 0.55 * (1 - k);
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
    new THREE.MeshBasicMaterial({ color: 0xa8f0f5, wireframe: true }));
  lattice.add(heart);
  const heartGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot, color: COLORS.cyan, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  heartGlow.scale.setScalar(9);
  lattice.add(heartGlow);
  const lbl = makeLabel('SHELBY · BLOB STORAGE ON APTOS', '#71D8DF', 1.15);
  lbl.position.y = 6.6;
  lattice.add(lbl);
  lattice.position.set(60, 52, -70);
  scene.add(lattice);
  lattice.userData.heart = heart;
}

// uplink beam
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.35, 0.62, 43, 16, 1, true),
  new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
);
beam.position.set(60, 9.4 + 21.5, -70);
scene.add(beam);

// blob (the resolved payload)
const blob = new THREE.Group();
{
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2),
    new THREE.MeshBasicMaterial({ color: COLORS.pink, transparent: true, opacity: 0.92 }));
  blob.add(m);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  blob.add(e);
  const lbl = makeLabel('BLOB · 4.2 MB', '#F0F4EF', 0.9);
  lbl.position.y = 2.6;
  blob.add(lbl);
  const light = new THREE.PointLight(COLORS.pink, 46, 40, 2);
  blob.add(light);
  blob.visible = false;
  scene.add(blob);
}

// ---------------------------------------------------------------- timeline
const capEl = document.getElementById('caption');
const capPhase = document.getElementById('cap-phase');
const capText = document.getElementById('cap-text');
const tfill = document.getElementById('tfill');

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lookTD = V(-2, 4.4, 26);

const PHASES = [
  {
    len: 9, tag: '01 · THE DEVICE',
    html: '<b>Lilyshark</b> turns a LILYGO <i>T-Deck</i> into a handheld LoRa analyzer — capture, decode, spectrum, evidence. Open firmware on open hardware.',
    camA: V(-13, 5, 44), camB: V(13, 6.5, 44), lookA: lookTD, lookB: lookTD,
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
    camA: V(8, 5, 36), camB: V(-6, 7, 34), lookA: lookTD, lookB: lookTD,
    onEnter() { pushFeedRow(true); emitBurst(NODES.tdeck.pos, COLORS.pink, 30); startPacket(); },
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
    onEnter() { uplink.active = true; uplink.t = 0; },
  },
  {
    len: 12, tag: '07 · THE RESOLUTION',
    html: 'The photo arrives — intact, persistent, verifiable on <em>Shelby</em> — and the mesh stayed free for everyone else’s traffic. <b>~50,000× fewer bytes</b> ever touched the air.',
    camA: V(100, 42, -14), camB: V(34, 18, 10), lookA: V(60, 30, -70), lookB: V(28, 8, -18),
    onEnter() { resolveBlob.active = true; resolveBlob.t = 0; },
  },
  {
    len: 11, tag: '08 · OPEN STACK',
    html: 'Open hardware · GPL-3.0 firmware · open mesh protocols · open webapp.<br><i>github.com/maxmoneycash/lilyshark</i>',
    orbit: true,
    onEnter() { feed.resolved = true; drawScreen(); },
  },
];
const TOTAL = PHASES.reduce((s, p) => s + p.len, 0);

// chapter ticks on the timeline
{
  const bar = document.getElementById('timeline');
  let acc = 0;
  for (const p of PHASES) {
    if (acc > 0) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.left = `${(acc / TOTAL) * 100}%`;
      bar.appendChild(tick);
    }
    acc += p.len;
  }
}

// packet flight across the mesh (phase 05, but state machine is global)
const HOPS = ['tdeck', 'r1', 'r2', 'gateway'];
const flight = { active: false, seg: 0, t: 0, segLen: 4.2 };
function startPacket() {
  flight.active = true; flight.seg = 0; flight.t = 0;
  packet.visible = true;
  packet.position.copy(antennaTop('tdeck'));
}
function updateFlight(dt) {
  if (!flight.active) return;
  flight.t += dt;
  const k = Math.min(flight.t / flight.segLen, 1);
  const a = antennaTop(HOPS[flight.seg]);
  const b = antennaTop(HOPS[flight.seg + 1]);
  const e = k * k * (3 - 2 * k); // smoothstep
  packet.position.lerpVectors(a, b, e);
  packet.position.y += Math.sin(e * Math.PI) * 7;
  packet.userData.core.rotation.y += dt * 2.4;
  packet.userData.shell.rotation.x += dt * 1.1;
  if (k > 0 && k < 1) spawnTrail(dt);
  if (k >= 1) {
    emitBurst(NODES[HOPS[flight.seg + 1]].pos, COLORS.pink, 26);
    flight.seg += 1; flight.t = -0.9; // hold at node briefly
    if (flight.seg >= HOPS.length - 1) { flight.active = false; }
  }
}

// gateway → Shelby ascent
const uplink = { active: false, t: 0, dur: 6 };
function updateUplink(dt) {
  if (!uplink.active) return;
  uplink.t += dt;
  beam.material.opacity = Math.min(uplink.t / 1.5, 1) * 0.11;
  const k = Math.min(Math.max((uplink.t - 1.2) / uplink.dur, 0), 1);
  const a = antennaTop('gateway'), b = lattice.position.clone();
  packet.position.lerpVectors(a, b, k * k * (3 - 2 * k));
  if (k > 0 && k < 1) spawnTrail(dt);
  if (k >= 1 && packet.visible) {
    packet.visible = false;
    uplink.flash = 1;
  }
  if (uplink.flash > 0) {
    uplink.flash = Math.max(uplink.flash - dt * 0.8, 0);
    lattice.userData.heart.scale.setScalar(1 + uplink.flash * 1.6);
  }
}

// Shelby → gateway blob descent
const resolveBlob = { active: false, t: 0, dur: 5 };
function updateBlob(dt) {
  if (!resolveBlob.active) return;
  resolveBlob.t += dt;
  const k = Math.min(resolveBlob.t / resolveBlob.dur, 1);
  blob.visible = k < 1;
  const a = lattice.position.clone(), b = antennaTop('gateway');
  blob.position.lerpVectors(a, b, k * k);
  blob.rotation.y += dt * 1.5;
  if (k >= 1 && !resolveBlob.done) {
    resolveBlob.done = true;
    emitBurst(NODES.gateway.pos, COLORS.cyan, 34);
  }
}

// ambient chatter — phase 1 floods to show congestion
let nextChatter = 2;
const AMBIENT = ['r1', 'r2', 'amb1', 'amb2', 'amb3', 'amb4', 'amb5', 'amb6', 'gateway'];
function updateAmbient(t, dt, phaseIdx) {
  if (phaseIdx < 1) return;
  if (t > nextChatter) {
    const flood = phaseIdx === 1;
    nextChatter = t + (flood ? 0.3 + Math.random() * 0.5 : 1.0 + Math.random() * 1.7);
    const n = AMBIENT[Math.random() * AMBIENT.length | 0];
    emitWave(NODES[n].pos, Math.random() < 0.2 ? COLORS.cyan : COLORS.lime, 15 + Math.random() * 11);
    if (Math.random() < 0.7) pushFeedRow(false);
  }
}

// beacon blink
function updateBeacons(t) {
  for (const b of beacons) {
    const k = 0.55 + 0.45 * Math.sin(t * 2.1 + b.phase);
    b.light.intensity = 10 + 14 * k;
    b.mat.color.set(b.base).multiplyScalar(0.55 + 0.65 * k);
  }
}

// ---------------------------------------------------------------- clock & loop
const clock = new THREE.Clock();
let elapsed = 0;
function clockNow() { return elapsed; }

let phaseIdx = -1;
let phaseStart = 0;
let timelineT = 0;

function resetCycle() {
  timelineT = 0; phaseIdx = -1;
  flight.active = false; packet.visible = false;
  uplink.active = false; uplink.flash = 0; beam.material.opacity = 0;
  resolveBlob.active = false; resolveBlob.done = false; blob.visible = false;
  feed.resolved = false; feed.pointerSeen = false;
  feed.rows.length = 0;
  for (let i = 0; i < 7; i++) pushFeedRow(false);
  lattice.userData.heart.scale.setScalar(1);
  drawScreen();
}

function setPhase(i) {
  phaseIdx = i;
  const p = PHASES[i];
  phaseStart = timelineT;
  capPhase.textContent = p.tag;
  capText.innerHTML = p.html;
  capEl.classList.remove('show');
  requestAnimationFrame(() => requestAnimationFrame(() => capEl.classList.add('show')));
  if (p.onEnter) p.onEnter();
}

document.getElementById('skipbtn').addEventListener('click', () => {
  let acc = 0;
  for (let i = 0; i <= phaseIdx; i++) acc += PHASES[i].len;
  if (phaseIdx >= PHASES.length - 1) { resetCycle(); return; }
  timelineT = acc;
});

const recbtn = document.getElementById('recbtn');
recbtn.addEventListener('click', () => {
  const on = document.body.classList.toggle('rec');
  recbtn.classList.toggle('on', on);
  resetCycle();
});

const tmpLook = new THREE.Vector3();
const drift = new THREE.Vector3();
function updateCamera(dt) {
  if (userControl) {
    if (elapsed - lastInteract > 6) userControl = false;
    controls.update();
    return;
  }
  const p = PHASES[phaseIdx];
  const k = Math.min((timelineT - phaseStart) / p.len, 1);
  const e = k * k * (3 - 2 * k);
  let target, look;
  if (p.followPacket) {
    target = packet.position.clone().add(V(13, 8, 16));
    look = packet.position;
  } else if (p.orbit) {
    const a = timelineT * 0.16;
    target = V(Math.sin(a) * 80, 30, Math.cos(a) * 80 - 10);
    look = V(0, 4, -6);
  } else {
    target = p.camA.clone().lerp(p.camB, e);
    tmpLook.copy(p.lookA).lerp(p.lookB, e);
    look = tmpLook;
  }
  // handheld drift
  drift.set(
    Math.sin(elapsed * 0.55) * 0.5 + Math.sin(elapsed * 1.31) * 0.18,
    Math.sin(elapsed * 0.42 + 2.1) * 0.32,
    Math.cos(elapsed * 0.61 + 0.7) * 0.4
  );
  target = target.clone().add(drift);
  camera.position.lerp(target, Math.min(dt * 1.6, 1));
  controls.target.lerp(look, Math.min(dt * 2.2, 1));
  controls.update();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  timelineT += dt;

  if (timelineT >= TOTAL) resetCycle();
  let acc = 0, idx = 0;
  for (let i = 0; i < PHASES.length; i++) {
    if (timelineT < acc + PHASES[i].len) { idx = i; break; }
    acc += PHASES[i].len;
  }
  if (idx !== phaseIdx) { phaseStart = acc; setPhase(idx); }

  updateWaves(dt);
  updateFlight(dt);
  updateUplink(dt);
  updateBlob(dt);
  updateTrail(dt);
  updateAmbient(timelineT, dt, phaseIdx);
  updateBeacons(elapsed);
  lattice.rotation.y += dt * 0.12;
  lattice.userData.heart.rotation.x += dt * 0.4;
  updateCamera(dt);

  tfill.style.width = `${(timelineT / TOTAL) * 100}%`;
  composer.render();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

resetCycle();
animate();

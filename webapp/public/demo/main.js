// Lilyshark Field Demo — a scripted 3D scene showing the Shelby off-grid
// pointer flow: T-Deck capture node → LoRa mesh → gateway → Shelby on Aptos.
// Self-contained: three.js is vendored, no network requests.

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const COLORS = {
  bg: 0x07090c,
  pink: 0xf05aa6,
  lime: 0x66f05a,
  cyan: 0x71d8df,
  amber: 0xf0b429,
  paper: 0xf0f4ef,
  body: 0x14181d,
  grid1: 0x1a2430,
  grid2: 0x10161d,
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

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);
scene.fog = new THREE.FogExp2(COLORS.bg, 0.0052);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 900);
camera.position.set(-8, 4, 38);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 6;
controls.maxDistance = 220;

let userControl = false;
let lastInteract = -1e9;
renderer.domElement.addEventListener('pointerdown', () => { userControl = true; lastInteract = clockNow(); });
renderer.domElement.addEventListener('wheel', () => { userControl = true; lastInteract = clockNow(); }, { passive: true });

// ---------------------------------------------------------------- lights
scene.add(new THREE.AmbientLight(0x3a4450, 1.4));
const key = new THREE.DirectionalLight(0x9fb4c8, 1.1);
key.position.set(-40, 60, 30);
scene.add(key);
const pinkFill = new THREE.PointLight(COLORS.pink, 60, 90, 1.8);
pinkFill.position.set(0, 14, 20);
scene.add(pinkFill);

// ---------------------------------------------------------------- ground
const grid = new THREE.GridHelper(500, 100, COLORS.grid1, COLORS.grid2);
grid.material.transparent = true;
grid.material.opacity = 0.55;
scene.add(grid);

const groundGlow = new THREE.Mesh(
  new THREE.CircleGeometry(240, 64),
  new THREE.MeshBasicMaterial({ color: 0x0a0e13 })
);
groundGlow.rotation.x = -Math.PI / 2;
groundGlow.position.y = -0.05;
scene.add(groundGlow);

// stars
{
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 320 + Math.random() * 220;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(1 - Math.random() * 0.85); // bias above horizon
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) + 4;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x8fa8b8, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.5,
  })));
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
  g.fillStyle = 'rgba(7,9,12,0.72)';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(240,244,239,0.22)';
  g.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
  g.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
  g.fillStyle = colorCss;
  g.textBaseline = 'middle';
  g.fillText(text, pad, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set((c.width / 44) * scale, (c.height / 44) * scale, 1);
  return sp;
}

// ---------------------------------------------------------------- mesh nodes
function makeRelayNode(label, labelColor) {
  const grp = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x232b34, roughness: 0.6, metalness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 6.2, 8), poleMat);
  pole.position.y = 3.1;
  grp.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 0.35, 24), poleMat);
  base.position.y = 0.18;
  grp.add(base);
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 16),
    new THREE.MeshBasicMaterial({ color: labelColor })
  );
  tip.position.y = 6.5;
  grp.add(tip);
  const halo = new THREE.PointLight(labelColor, 14, 26, 2);
  halo.position.y = 6.5;
  grp.add(halo);
  const lbl = makeLabel(label, '#F0F4EF', 0.9);
  lbl.position.y = 8.4;
  grp.add(lbl);
  grp.userData.tip = tip;
  return grp;
}

const NODES = {
  tdeck:   { pos: new THREE.Vector3(-2, 0, 26) },
  r1:      { pos: new THREE.Vector3(-30, 0, -8),  label: 'RELAY 1F4C · MESHTASTIC', color: COLORS.lime },
  r2:      { pos: new THREE.Vector3(18, 0, -30),  label: 'RELAY A9E2 · MESHCORE',   color: COLORS.lime },
  gateway: { pos: new THREE.Vector3(60, 0, -70),  label: 'GATEWAY · IP UPLINK',     color: COLORS.cyan },
  amb1:    { pos: new THREE.Vector3(-58, 0, -46), label: 'NODE 77D0 · RNODE',       color: COLORS.lime },
  amb2:    { pos: new THREE.Vector3(44, 0, 14),   label: 'NODE C3B8 · MESHTASTIC',  color: COLORS.lime },
  amb3:    { pos: new THREE.Vector3(-18, 0, -66), label: 'NODE 04AF · MESHCORE',    color: COLORS.lime },
};
for (const k of Object.keys(NODES)) {
  if (k === 'tdeck') continue;
  const n = NODES[k];
  n.group = makeRelayNode(n.label, n.color);
  n.group.position.copy(n.pos);
  scene.add(n.group);
}
const antennaTop = (k) => NODES[k].pos.clone().add(new THREE.Vector3(0, k === 'tdeck' ? 7.4 : 6.5, 0));

// ---------------------------------------------------------------- T-Deck
// Stylized LILYGO T-Deck: landscape screen above a thumb keyboard, trackball,
// stub antenna. The screen is a live canvas running a fake Lilyshark feed.
const screenCanvas = document.createElement('canvas');
screenCanvas.width = 640; screenCanvas.height = 288;
const sctx = screenCanvas.getContext('2d');
const screenTex = new THREE.CanvasTexture(screenCanvas);
screenTex.colorSpace = THREE.SRGBColorSpace;

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
function drawScreen() {
  const w = screenCanvas.width, h = screenCanvas.height;
  sctx.fillStyle = '#05080a'; sctx.fillRect(0, 0, w, h);
  // header
  sctx.fillStyle = '#F05AA6'; sctx.fillRect(0, 0, w, 30);
  sctx.fillStyle = '#05080a'; sctx.font = '600 19px ui-monospace, Menlo, monospace';
  sctx.fillText('LILYSHARK α  ·  1 TRAFFIC', 10, 21);
  sctx.textAlign = 'right';
  sctx.fillText('906.875MHz SF11', w - 10, 21);
  sctx.textAlign = 'left';
  // column header
  sctx.fillStyle = '#71D8DF'; sctx.font = '15px ui-monospace, Menlo, monospace';
  sctx.fillText('TIME      PROTO  SRC    DST    TYPE      SNR', 10, 50);
  sctx.strokeStyle = 'rgba(240,244,239,0.25)';
  sctx.beginPath(); sctx.moveTo(0, 58); sctx.lineTo(w, 58); sctx.stroke();
  // rows
  sctx.font = '16px ui-monospace, Menlo, monospace';
  feed.rows.forEach((r, i) => {
    const y = 78 + i * 22;
    if (r.shelby) { sctx.fillStyle = 'rgba(240,90,166,0.22)'; sctx.fillRect(0, y - 15, w, 20); }
    sctx.fillStyle = r.shelby ? '#F05AA6' : '#66F05A';
    sctx.fillText(`${r.t}  ${r.proto}  ${r.src}  ${r.dst}  ${r.type.padEnd(8)}  ${r.snr}`, 10, y);
  });
  if (feed.resolved) {
    sctx.fillStyle = 'rgba(5,8,10,0.88)'; sctx.fillRect(60, 92, w - 120, 104);
    sctx.strokeStyle = '#66F05A'; sctx.lineWidth = 2; sctx.strokeRect(60, 92, w - 120, 104);
    sctx.fillStyle = '#66F05A'; sctx.font = '600 22px ui-monospace, Menlo, monospace';
    sctx.textAlign = 'center';
    sctx.fillText('SHELBY POINTER RESOLVED ✓', w / 2, 134);
    sctx.font = '16px ui-monospace, Menlo, monospace'; sctx.fillStyle = '#F0F4EF';
    sctx.fillText('blob 4.2 MB · owner 0x9c…e1 · via gateway', w / 2, 168);
    sctx.textAlign = 'left'; sctx.lineWidth = 1;
  }
  screenTex.needsUpdate = true;
}
drawScreen();

const tdeck = new THREE.Group();
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS.body, roughness: 0.45, metalness: 0.25 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(9, 5.8, 0.9), bodyMat);
  tdeck.add(body);
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: 0x2c3540 })
  );
  tdeck.add(edge);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(7.9, 3.55),
    new THREE.MeshBasicMaterial({ map: screenTex })
  );
  screen.position.set(0, 0.82, 0.46);
  tdeck.add(screen);
  // keyboard
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.8 });
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 10; c++) {
      const kbtn = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.38, 0.14), keyMat);
      kbtn.position.set(-3.6 + c * 0.8, -1.55 - r * 0.52, 0.5);
      tdeck.add(kbtn);
    }
  }
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x39434f, roughness: 0.3, metalness: 0.5 })
  );
  ball.position.set(3.9, -1.2, 0.5);
  tdeck.add(ball);
  // antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 2.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x0d1013, roughness: 0.9 }));
  ant.position.set(-3.9, 4.2, 0);
  tdeck.add(ant);
  const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12),
    new THREE.MeshBasicMaterial({ color: COLORS.pink }));
  antTip.position.set(-3.9, 5.5, 0);
  tdeck.add(antTip);
  const lbl = makeLabel('LILYSHARK · LILYGO T-DECK', '#F05AA6', 1.0);
  lbl.position.set(0, 7.6, 0);
  tdeck.add(lbl);

  tdeck.position.copy(NODES.tdeck.pos).add(new THREE.Vector3(0, 3.4, 0));
  tdeck.rotation.x = -0.16;
  tdeck.rotation.y = 0.10;
  scene.add(tdeck);
}

// ---------------------------------------------------------------- radio waves
const wavePool = [];
const waveGeo = new THREE.RingGeometry(0.96, 1, 72);
function emitWave(pos, color, radius = 26, life = 2.6, y = 0.12) {
  let w = wavePool.find(w => !w.active);
  if (!w) {
    w = { mesh: new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false })), active: false };
    w.mesh.rotation.x = -Math.PI / 2;
    scene.add(w.mesh);
    wavePool.push(w);
  }
  w.active = true; w.t = 0; w.life = life; w.radius = radius;
  w.mesh.visible = true;
  w.mesh.position.set(pos.x, y, pos.z);
  w.mesh.material.color.set(color);
  return w;
}
function emitBurst(pos, color, radius) {
  emitWave(pos, color, radius, 2.6);
  setTimeout(() => emitWave(pos, color, radius, 2.6), 300);
  setTimeout(() => emitWave(pos, color, radius, 2.6), 600);
}
function updateWaves(dt) {
  for (const w of wavePool) {
    if (!w.active) continue;
    w.t += dt;
    const k = w.t / w.life;
    if (k >= 1) { w.active = false; w.mesh.visible = false; continue; }
    const r = 0.6 + k * w.radius;
    w.mesh.scale.set(r, r, r);
    w.mesh.material.opacity = 0.85 * (1 - k) * (1 - k);
  }
}

// ---------------------------------------------------------------- packet
const packet = new THREE.Group();
{
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55),
    new THREE.MeshBasicMaterial({ color: COLORS.pink })
  );
  packet.add(core);
  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85),
    new THREE.MeshBasicMaterial({ color: COLORS.pink, wireframe: true, transparent: true, opacity: 0.5 })
  );
  packet.add(shell);
  const light = new THREE.PointLight(COLORS.pink, 40, 30, 2);
  packet.add(light);
  const lbl = makeLabel('SHLB · 82 B', '#F05AA6', 0.8);
  lbl.position.y = 1.7;
  packet.add(lbl);
  packet.visible = false;
  scene.add(packet);
  packet.userData = { core, shell };
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
  const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1),
    new THREE.MeshBasicMaterial({ color: COLORS.cyan, wireframe: true }));
  lattice.add(heart);
  const lbl = makeLabel('SHELBY · BLOB STORAGE ON APTOS', '#71D8DF', 1.15);
  lbl.position.y = 6.4;
  lattice.add(lbl);
  lattice.position.set(60, 52, -70);
  scene.add(lattice);
  lattice.userData.heart = heart;
}

// uplink beam
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.5, 0.9, 45, 16, 1, true),
  new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
);
beam.position.set(60, 6.5 + 22.5, -70);
scene.add(beam);

// blob (the resolved payload)
const blob = new THREE.Group();
{
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2),
    new THREE.MeshBasicMaterial({ color: COLORS.pink, transparent: true, opacity: 0.92 }));
  blob.add(m);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  blob.add(e);
  const lbl = makeLabel('BLOB · 4.2 MB', '#F0F4EF', 0.9);
  lbl.position.y = 2.6;
  blob.add(lbl);
  const light = new THREE.PointLight(COLORS.pink, 50, 40, 2);
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
    camA: V(-12, 4.5, 40), camB: V(12, 6, 41), lookA: lookTD, lookB: lookTD,
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
    html: 'The photo arrives — intact, persistent, verifiable on <em>Shelby</em> — and the mesh stayed free for everyone else\u2019s traffic. <b>~50,000\u00d7 fewer bytes</b> ever touched the air.',
    camA: V(84, 30, -24), camB: V(30, 16, 8), lookA: V(60, 26, -70), lookB: V(30, 8, -20),
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

// packet flight across the mesh (phase 04, but state machine is global)
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
  beam.material.opacity = Math.min(uplink.t / 1.5, 1) * 0.16;
  const k = Math.min(Math.max((uplink.t - 1.2) / uplink.dur, 0), 1);
  const a = antennaTop('gateway'), b = lattice.position.clone();
  packet.position.lerpVectors(a, b, k * k * (3 - 2 * k));
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

// ambient chatter
let nextChatter = 2;
const AMBIENT = ['r1', 'r2', 'amb1', 'amb2', 'amb3', 'gateway'];
function updateAmbient(t, dt, phaseIdx) {
  if (phaseIdx < 1) return;
  if (t > nextChatter) {
    nextChatter = t + 0.9 + Math.random() * 1.6;
    const n = AMBIENT[Math.random() * AMBIENT.length | 0];
    emitWave(NODES[n].pos, Math.random() < 0.2 ? COLORS.cyan : COLORS.lime, 16 + Math.random() * 10);
    if (Math.random() < 0.7) pushFeedRow(false);
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
  // fast-forward: run the state the skipped phases would have set
  timelineT = acc;
});

const recbtn = document.getElementById('recbtn');
recbtn.addEventListener('click', () => {
  const on = document.body.classList.toggle('rec');
  recbtn.classList.toggle('on', on);
  resetCycle();
});

const tmpLook = new THREE.Vector3();
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
    target = packet.position.clone().add(V(15, 9, 17));
    look = packet.position;
  } else if (p.orbit) {
    const a = timelineT * 0.16;
    target = V(Math.sin(a) * 78, 30, Math.cos(a) * 78 - 10);
    look = V(0, 4, -6);
  } else {
    target = p.camA.clone().lerp(p.camB, e);
    tmpLook.copy(p.lookA).lerp(p.lookB, e);
    look = tmpLook;
  }
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
  // find current phase
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
  updateAmbient(timelineT, dt, phaseIdx);
  lattice.rotation.y += dt * 0.12;
  lattice.userData.heart.rotation.x += dt * 0.4;
  updateCamera(dt);

  tfill.style.width = `${(timelineT / TOTAL) * 100}%`;
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

resetCycle();
animate();

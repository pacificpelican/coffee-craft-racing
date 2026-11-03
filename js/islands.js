// Level 3 scenery: a chain of pine islands linked by bridges, starting in a tiny Norwegian village and ending in the town's streets.
// Islands are ellipses; the sea is a plane, the ground a heightfield, and bridge decks are generated wherever the road leaves land.
import * as THREE from '../vendor/three.module.min.js';
import { mat, makeAnimal } from './actors.js';
import { mulberry, clamp } from './util.js';
import { buildCenterline, attachQueries, addGates, addStands, bannerTexture, DS } from './track.js';

const CELL = 10, HB = 48, PAD = 150;
const TOWN_Z = -216; // the town's own ground plane begins here; the heightfield stops short of it
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function smoothY(P, win, passes) {
  for (let k = 0; k < passes; k++) {
    const ys = P.map((p) => p.y);
    for (let i = 0; i < P.length; i++) {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(P.length - 1, i + win); j++) { sum += ys[j]; n++; }
      P[i].y = sum / n;
    }
  }
}

function roadTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#3a3d3c'; g.fillRect(0, 0, 128, 128);
  const rnd = mulberry(7); for (let i = 0; i < 500; i++) { g.fillStyle = rnd() < 0.5 ? '#444847' : '#303332'; g.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
  g.fillStyle = '#e9e0c8'; g.fillRect(4, 0, 3, 128); g.fillRect(121, 0, 3, 128);
  g.fillStyle = '#e3b93c'; for (let y = 0; y < 128; y += 32) g.fillRect(62, y, 4, 18);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function norwayFlag() {
  const c = document.createElement('canvas'); c.width = 176; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#ba0c2f'; g.fillRect(0, 0, 176, 128);
  g.fillStyle = '#fff'; g.fillRect(44, 0, 36, 128); g.fillRect(0, 46, 176, 36);
  g.fillStyle = '#00205b'; g.fillRect(53, 0, 18, 128); g.fillRect(0, 55, 176, 18);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// A boxy, friendly troll: long nose, mossy skin, orange mop of hair.
function makeTroll(skin = '#7f8f6a') {
  const g = new THREE.Group();
  const box = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); g.add(m); return m; };
  box(1.5, 1.7, 1.0, skin, 0, 2.0, 0); box(1.6, 0.8, 1.1, '#6a4a30', 0, 1.15, 0);
  for (const x of [-0.45, 0.45]) box(0.55, 1.0, 0.6, skin, x, 0.5, 0);
  const head = box(1.1, 0.95, 1.0, skin, 0, 3.4, 0.1);
  box(0.3, 0.35, 0.8, '#8a9c74', 0, 3.3, 0.8); box(0.12, 0.3, 0.12, '#c9a8a0', 0, 3.15, 1.2);
  for (const x of [-0.25, 0.25]) { box(0.18, 0.18, 0.08, '#fff6dc', x, 3.55, 0.62); box(0.08, 0.08, 0.06, '#1f2320', x, 3.55, 0.66); }
  for (const x of [-0.7, 0.7]) box(0.14, 0.5, 0.4, skin, x, 3.55, 0.1).rotation.z = x * 0.8;
  box(1.2, 0.3, 1.1, '#d9772b', 0, 4.0, 0.05); box(0.4, 0.4, 0.4, '#d9772b', -0.3, 4.3, 0); box(0.35, 0.5, 0.35, '#c4631f', 0.3, 4.3, 0.1);
  const arms = [];
  for (const s of [-1, 1]) { const arm = new THREE.Group(); arm.position.set(s * 0.95, 2.7, 0); const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 0.4), mat(skin)); a.position.y = -0.7; arm.add(a); g.add(arm); arms.push(arm); }
  g.userData.arms = arms; g.userData.head = head;
  return g;
}

export function buildIslands(scene, level) {
  const P = buildCenterline(level.waypoints); const length = P[P.length - 1].s;
  const isl = level.islands; // [cx, cz, rx, rz]
  const rnd = mulberry(9090);

  // ---- island shapes: land height from distance to each island's centre, with soft hills
  const landRaw = (x, z) => {
    let best = -3;
    for (const [cx, cz, rx, rz] of isl) {
      const f = 1 - Math.hypot((x - cx) / rx, (z - cz) / rz); if (f <= 0) continue;
      const n = Math.sin(x * 0.021 + z * 0.013) * 0.5 + Math.sin(x * 0.047 - z * 0.037) * 0.3 + Math.sin(x * 0.09 + z * 0.083) * 0.2;
      best = Math.max(best, -2.6 + 8.4 * smooth(0, 0.5, f) + n * 2.6 * smooth(0.15, 0.6, f));
    }
    return best;
  };
  const inTown = (p) => Math.abs(p.x) <= 130 && p.z > -126 && p.z < 128;
  for (const p of P) { p.bridge = p.z < TOWN_Z + 6 && landRaw(p.x, p.z) < 0.3; }
  smoothY(P, 6, 2);
  const villS = level.village; // [from s, to s]
  for (const p of P) {
    p.town = inTown(p); p.vil = p.s >= villS[0] && p.s <= villS[1];
    p.hw = p.town ? 5.5 : 6.2; p.fire = p.z > -128;
  }
  const track = { P, length, level, half: (p) => p.hw, wallMargin: (p) => (p.town ? 0.9 : 0.5), stands: [], wildlife: [], update() {} };
  const group = new THREE.Group(); scene.add(group); track.group = group;
  attachQueries(track);
  const hw = (p) => p.hw;

  // deer cross on the islands only, never on a bridge or inside the village
  const nearBridge = (s, d) => { for (let k = -d; k <= d; k += DS) { const q = track.at(s + k); if (q.bridge) return true; } return false; };
  const landOk = (s) => { const p = track.at(s); return !p.bridge && !p.vil && !p.town && p.z < -240 && !nearBridge(s, 45); };
  const deer = []; for (let s = villS[1] + 80; s < length - 60; s += 10) if (landOk(s) && (!deer.length || s - deer[deer.length - 1] > 150)) deer.push(s);
  level.hazards = { ...(level.hazards || {}), deer };
  const gapAt = (s) => deer.some((d) => Math.abs(s - d) < 24);

  // ---- nearest-road lookup
  const hash = new Map();
  for (let i = 0; i < P.length; i += 2) { const k = Math.floor(P[i].x / HB) + ',' + Math.floor(P[i].z / HB); (hash.get(k) || hash.set(k, []).get(k)).push(P[i]); }
  const near = (x, z, maxD) => {
    const bx = Math.floor(x / HB), bz = Math.floor(z / HB); let best = null, bd = Infinity;
    for (let r = 1; r <= Math.ceil(maxD / HB) + 1; r++) {
      for (let a = bx - r; a <= bx + r; a++) for (let b = bz - r; b <= bz + r; b++) {
        if (Math.max(Math.abs(a - bx), Math.abs(b - bz)) !== r && r > 1) continue;
        const list = hash.get(a + ',' + b); if (!list) continue;
        for (const p of list) { const d = (x - p.x) ** 2 + (z - p.z) ** 2; if (d < bd) { bd = d; best = p; } }
      }
      if (best && Math.sqrt(bd) <= r * HB) break;
    }
    if (!best || Math.sqrt(bd) > maxD) return null;
    return { p: best, d: Math.sqrt(bd) };
  };
  const heightOf = (x, z) => {
    let h = landRaw(x, z);
    if (h > 0) h *= smooth(TOWN_Z - 4, TOWN_Z - 70, z); // settle to the town's level at its north edge
    const info = near(x, z, 45);
    if (info && !info.p.bridge) {
      const { p, d } = info, flat = p.vil ? p.hw + 22 : p.hw + 5;
      h += (p.y - 0.45 - h) * (1 - smooth(flat, flat + 18, d));
    }
    return z > TOWN_Z - 6 ? Math.min(h, -0.03) : h;
  };

  // ---- ground heightfield
  let minX = Infinity, maxX = -Infinity, minZ = Infinity;
  for (const [cx, cz, rx, rz] of isl) { minX = Math.min(minX, cx - rx); maxX = Math.max(maxX, cx + rx); minZ = Math.min(minZ, cz - rz); }
  minX -= PAD; maxX += PAD; minZ -= PAD;
  const gx0 = Math.floor(minX / CELL), gz0 = Math.floor(minZ / CELL);
  const NX = Math.ceil((maxX - minX) / CELL) + 1, NZ = Math.ceil((TOWN_Z - minZ) / CELL) + 1;
  const H = new Float32Array(NX * NZ), pos = new Float32Array(NX * NZ * 3), colr = new Float32Array(NX * NZ * 3);
  const stops = [[-3, '#7d7a5a'], [-0.2, '#b9aa7c'], [0.8, '#c8b98a'], [1.8, '#6f8a4a'], [5, '#557a3c'], [10, '#486a38']].map(([h, c]) => [h, new THREE.Color(c)]);
  const tmp = new THREE.Color();
  for (let gz = 0; gz < NZ; gz++) for (let gx = 0; gx < NX; gx++) {
    const x = (gx0 + gx) * CELL, z = (gz0 + gz) * CELL, k = gz * NX + gx, h = heightOf(x, z); H[k] = h; pos.set([x, h, z], k * 3);
    let i = 0; while (i < stops.length - 2 && h > stops[i + 1][0]) i++;
    tmp.copy(stops[i][1]).lerp(stops[i + 1][1], clamp((h - stops[i][0]) / (stops[i + 1][0] - stops[i][0]), 0, 1)).multiplyScalar(0.9 + 0.2 * (Math.sin(x * 0.19 + z * 0.13) * 0.5 + 0.5));
    colr.set([tmp.r, tmp.g, tmp.b], k * 3);
  }
  const idx = [];
  for (let gz = 0; gz < NZ - 1; gz++) for (let gx = 0; gx < NX - 1; gx++) { const a = gz * NX + gx, b = a + 1, c = a + NX, d = c + 1; idx.push(a, c, b, b, c, d); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(colr, 3)); tg.setIndex(idx); tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })); terrain.frustumCulled = false; group.add(terrain);
  track.groundAt = (x, z) => {
    if (z > TOWN_Z) return 0;
    const fx = x / CELL - gx0, fz = z / CELL - gz0, gx = Math.floor(fx), gz = Math.floor(fz);
    if (gx < 0 || gz < 0 || gx >= NX - 1 || gz >= NZ - 1) return null;
    const a = H[gz * NX + gx], b = H[gz * NX + gx + 1], c = H[(gz + 1) * NX + gx], d = H[(gz + 1) * NX + gx + 1];
    const u = fx - gx, v = fz - gz; return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };

  // ---- the sea
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: '#3d7f96', transparent: true, opacity: 0.92 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.25, TOWN_Z - 1990); group.add(sea);

  // ---- road ribbons (skipping the streets, which the town already paves)
  const makeRibbon = (i0, i1) => {
    const n = i1 - i0 + 1, rp = new Float32Array(n * 6), uv = new Float32Array(n * 4), ri = [];
    for (let k = 0; k < n; k++) {
      const p = P[i0 + k];
      rp.set([p.x - p.nx * p.hw, p.y + 0.05, p.z - p.nz * p.hw, p.x + p.nx * p.hw, p.y + 0.05, p.z + p.nz * p.hw], k * 6);
      uv.set([0, p.s / 16, 1, p.s / 16], k * 4);
      if (k < n - 1) { const a = k * 2; ri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(rp, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(ri); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: roadTexture(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.frustumCulled = false; group.add(m);
  };
  const firstTown = P.findIndex((p) => p.town), lastTown = P.length - 1 - [...P].reverse().findIndex((p) => p.town);
  makeRibbon(0, Math.max(1, firstTown)); makeRibbon(Math.min(P.length - 2, lastTown), P.length - 1);

  // ---- guardrails, except in the village and the town
  const railPos = [], railIdx = [], posts = [];
  for (const side of [-1, 1]) {
    const base = railPos.length / 3;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], l = side * (p.hw + 1.0), on = !p.vil && !p.town && p.z < 128 + 1 && !(p.z > -126 && p.z < 128) && !gapAt(p.s);
      railPos.push(p.x + p.nx * l, p.y + 0.5, p.z + p.nz * l, p.x + p.nx * l, p.y + 1.0, p.z + p.nz * l);
      if (i < P.length - 1 && on && !gapAt(P[i + 1].s) && !P[i + 1].vil) { const a = base + i * 2; railIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      if (i % 4 === 0 && on) posts.push([p.x + p.nx * l, p.y, p.z + p.nz * l]);
    }
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3)); rg.setIndex(railIdx); rg.computeVertexNormals();
  const rail = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: '#b5bab6', side: THREE.DoubleSide })); rail.frustumCulled = false; group.add(rail);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), mat('#7d827e'), posts.length);
  posts.forEach(([x, y, z], i) => { m4.makeTranslation(x, y + 0.55, z); postMesh.setMatrixAt(i, m4); });
  postMesh.computeBoundingSphere(); postMesh.frustumCulled = false; group.add(postMesh);

  // ---- bridge decks and piers wherever the road crosses water
  const deckI = [], pierI = [];
  P.forEach((p, i) => { for (let k = -3; k <= 3; k++) if (P[clamp(i + k, 0, P.length - 1)].bridge) { deckI.push(i); if (p.bridge && i % 7 === 0) pierI.push(i); break; } });
  const deck = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat('#8a7a64'), deckI.length);
  deckI.forEach((i, n) => { const p = P[i]; q.setFromAxisAngle(Y, p.hd); sc.set(p.hw * 2 + 1.6, 1.1, DS + 0.3); ps.set(p.x, p.y - 0.55, p.z); m4.compose(ps, q, sc); deck.setMatrixAt(n, m4); });
  deck.computeBoundingSphere(); deck.frustumCulled = false; group.add(deck);
  const piers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat('#6e6a62'), pierI.length);
  pierI.forEach((i, n) => { const p = P[i], top = p.y - 1.1, bot = -4; q.setFromAxisAngle(Y, p.hd); sc.set(p.hw * 1.5, top - bot, 2.4); ps.set(p.x, (top + bot) / 2, p.z); m4.compose(ps, q, sc); piers.setMatrixAt(n, m4); });
  piers.computeBoundingSphere(); piers.frustumCulled = false; group.add(piers);

  // ---- pines (two kinds), scattered on the islands and around the finish
  const scatter = (count, pick, accept) => {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 50; tries++) {
      const p = pick(), side = rnd() < 0.5 ? -1 : 1, lat = side * (p.hw + 7 + Math.pow(rnd(), 1.5) * 95);
      const x = p.x + p.nx * lat + (rnd() - 0.5) * 6, z = p.z + p.nz * lat + (rnd() - 0.5) * 6;
      const g = track.groundAt(x, z); if (g === null || !accept(x, z, g, p)) continue;
      const info = near(x, z, 60); if (info && info.d < info.p.hw + 6) continue;
      out.push([x, g, z]);
    }
    return out;
  };
  const islandPick = () => { for (;;) { const p = P[Math.floor(rnd() * P.length)]; if (!p.bridge && !p.town && p.z < -230 && p.s > villS[1] - 40) return p; } };
  const tailStart = P.findIndex((p, i) => i > lastTown - 5 && p.z > 134);
  const tailPick = () => P[tailStart + Math.floor(rnd() * (P.length - tailStart))];
  const treePts = [
    ...scatter(1500, islandPick, (x, z, g) => g > 1.4),
    ...scatter(110, () => { for (;;) { const p = P[Math.floor(rnd() * P.length)]; if (p.vil || p.s < 80) return p; } }, (x, z, g, p) => g > 1.2 && Math.abs((x - p.x) * p.nx + (z - p.z) * p.nz) > p.hw + 28),
    ...scatter(360, tailPick, (x, z) => z > 134 && z < 197 && Math.abs(x) < 204),
  ];
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 2.2, 5); trunk.translate(0, 1.1, 0);
  const wood = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: '#5a4430', flatShading: true }), treePts.length);
  const kinds = [new THREE.ConeGeometry(2.6, 9, 6), new THREE.ConeGeometry(1.8, 13, 5)]; kinds.forEach((g) => g.translate(0, 6.5, 0));
  const half = [treePts.filter((_, i) => i % 2 === 0), treePts.filter((_, i) => i % 2 === 1)];
  half.forEach((pts, k) => {
    const f = new THREE.InstancedMesh(kinds[k], new THREE.MeshLambertMaterial({ flatShading: true }), pts.length);
    pts.forEach(([x, y, z], i) => {
      const s = 0.7 + rnd() * 1.2; q.setFromAxisAngle(Y, rnd() * 6); sc.set(s, s * (0.9 + rnd() * 0.4), s); ps.set(x, y - 0.3, z); m4.compose(ps, q, sc);
      f.setMatrixAt(i, m4); f.setColorAt(i, col.setHSL(k ? 0.36 + rnd() * 0.03 : 0.31 + rnd() * 0.04, 0.35 + rnd() * 0.15, 0.15 + rnd() * 0.1));
      wood.setMatrixAt(k ? i + half[0].length : i, m4);
    });
    f.computeBoundingSphere(); f.frustumCulled = false; group.add(f);
  });
  wood.computeBoundingSphere(); wood.frustumCulled = false; group.add(wood);

  // forest floor behind the finish
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(410, 70), new THREE.MeshLambertMaterial({ color: '#4d6a3a', polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.01, 165); group.add(floor);

  // ---- the village: wooden houses, flag poles, trolls
  const flagTex = norwayFlag(), flags = [];
  const box = (w, h, d, c, x, y, z, parent = group) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); parent.add(m); return m; };
  const wallCols = ['#a33a2c', '#d9b44a', '#f0ead8', '#b5573c', '#7a8f9c'], roofCols = ['#3a2c28', '#5d7a3a', '#4a3a2a', '#5a3a2a'];
  for (let s = villS[0] + 14; s < villS[1]; s += 22) for (const side of [-1, 1]) {
    if (rnd() < 0.15) continue;
    const p = track.at(s + (rnd() - 0.5) * 6), w = 6 + rnd() * 3, d = 6 + rnd() * 2.5, h = 3.4 + rnd() * 1.2, g = new THREE.Group();
    box(w, h, d, wallCols[Math.floor(rnd() * wallCols.length)], 0, h / 2, 0, g);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 2.4, 4), mat(roofCols[Math.floor(rnd() * roofCols.length)])); roof.rotation.y = Math.PI / 4; roof.scale.set(w * 0.78, 1, d * 0.78); roof.position.y = h + 1.2; g.add(roof);
    box(1.2, 2.2, 0.15, '#4a3020', side * w / 2, 1.1, 0, g).rotation.y = Math.PI / 2; box(0.15, 0.9, 1.0, '#e8dcc0', side * w / 2 + 0.05 * side, 2.2, 2, g);
    box(0.8, 1.6, 0.8, '#6a4a3a', -w * 0.25, h + 2.2, d * 0.2, g);
    const lat = side * (p.hw + 10 + rnd() * 5);
    g.position.set(p.x + p.nx * lat, p.y - 0.45, p.z + p.nz * lat); g.rotation.y = p.hd; group.add(g);
  }
  for (let s = villS[0]; s <= villS[1]; s += 28) for (const side of [-1, 1]) {
    const p = track.at(s + (side > 0 ? 0 : 14)), lat = side * (p.hw + 2.8), gx = p.x + p.nx * lat, gz = p.z + p.nz * lat;
    box(0.18, 8, 0.18, '#e8e4d8', gx, p.y + 3.5, gz);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2), new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide })); f.geometry.translate(1.4, 0, 0); f.position.set(gx, p.y + 6.8, gz); group.add(f);
    flags.push({ mesh: f, ph: s * 0.3 + side, base: p.hd + Math.PI / 2 });
  }
  const trolls = (level.trolls || []).map(([s, side], i) => {
    const m = makeTroll(['#7f8f6a', '#8c9a74', '#76866a', '#899272'][i % 4]); m.scale.setScalar(0.9 + (i % 3) * 0.12); group.add(m);
    return { mesh: m, s, side, ph: i * 1.9 };
  });

  // ---- raccoons on the islands
  for (let s = villS[1] + 60, i = 0; s < length - 120 && i < 12; s += 190 + rnd() * 80) {
    if (!landOk(s)) continue;
    const m = makeAnimal('raccoon'); m.scale.setScalar(0.95); group.add(m);
    track.wildlife.push({ mesh: m, s, side: i % 2 ? -1 : 1, phase: i * 1.73 }); i++;
  }

  // ---- fire barrels along both sides of the town route to the finish
  const fireI = []; for (let i = 0; i < P.length; i += 3) if (P[i].fire && P[i].s < length - 6) fireI.push(i);
  const barrelPts = []; for (const i of fireI) for (const side of [-1, 1]) { const p = P[i], l = side * (p.hw + 0.35); barrelPts.push([p.x + p.nx * l, p.y, p.z + p.nz * l, i * 0.7 + side]); }
  const barrels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.38, 1.0, 10), mat('#3a3f40'), barrelPts.length);
  const flameA = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1.4, 7), new THREE.MeshBasicMaterial({ color: '#ff7a1a' }), barrelPts.length);
  const flameB = new THREE.InstancedMesh(new THREE.ConeGeometry(0.3, 1.0, 6), new THREE.MeshBasicMaterial({ color: '#ffd24a' }), barrelPts.length);
  const glow = new THREE.InstancedMesh(new THREE.ConeGeometry(0.85, 1.9, 8), new THREE.MeshBasicMaterial({ color: '#ff5a10', transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }), barrelPts.length);
  barrelPts.forEach(([x, y, z], i) => { m4.makeTranslation(x, y + 0.5, z); barrels.setMatrixAt(i, m4); });
  barrels.computeBoundingSphere(); barrels.frustumCulled = flameA.frustumCulled = flameB.frustumCulled = glow.frustumCulled = false; group.add(barrels, flameA, flameB, glow);
  const flicker = (T) => {
    barrelPts.forEach(([x, y, z, ph], i) => {
      const a = 0.85 + Math.sin(T * 11 + ph * 3) * 0.2 + Math.sin(T * 17 + ph) * 0.1, b = 0.8 + Math.sin(T * 13 + ph * 2) * 0.25;
      q.setFromAxisAngle(Y, T * 2 + ph);
      sc.set(1, a, 1); ps.set(x, y + 1.0 + a * 0.7, z); m4.compose(ps, q, sc); flameA.setMatrixAt(i, m4);
      sc.set(1, b, 1); ps.set(x, y + 0.95 + b * 0.5, z); m4.compose(ps, q, sc); flameB.setMatrixAt(i, m4);
      sc.set(1, a * 0.95, 1); ps.set(x, y + 1.0 + a * 0.95, z); m4.compose(ps, q, sc); glow.setMatrixAt(i, m4);
    });
    flameA.instanceMatrix.needsUpdate = flameB.instanceMatrix.needsUpdate = glow.instanceMatrix.needsUpdate = true;
  };

  track.time = 0;
  track.update = (dt) => {
    const T = track.time += dt;
    for (const a of track.wildlife) {
      const p = track.at(a.s + Math.sin(T * 0.32 + a.phase) * 5), lat = a.side * (p.hw + 6.5 + Math.sin(T * 0.55 + a.phase) * 1.2);
      const x = p.x + p.nx * lat, z = p.z + p.nz * lat;
      a.mesh.position.set(x, track.groundAt(x, z) ?? p.y, z); a.mesh.rotation.y = p.hd + Math.sin(T * 0.4 + a.phase) * 0.22;
    }
    for (const t of trolls) {
      const wob = Math.sin(T * 0.25 + t.ph), p = track.at(t.s + wob * 10), lat = t.side * (p.hw + 4 + Math.sin(T * 0.4 + t.ph) * 1.2);
      t.mesh.position.set(p.x + p.nx * lat, p.y - 0.45 + Math.abs(Math.sin(T * 3 + t.ph)) * 0.08, p.z + p.nz * lat);
      t.mesh.rotation.y = p.hd + (Math.cos(T * 0.25 + t.ph) > 0 ? 0 : Math.PI);
      t.mesh.userData.arms.forEach((a, k) => { a.rotation.x = Math.sin(T * 3 + t.ph + k * Math.PI) * 0.5; });
    }
    for (const f of flags) f.mesh.rotation.y = f.base + Math.sin(T * 2 + f.ph) * 0.25;
    flicker(T);
  };
  track.update(0);

  addGates(track, group, hw);
  addStands(track, group, hw, (p) => (p.vil ? 7 : 6.5));
  for (const st of track.stands) {
    if (!st.sign) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1, 0.2), new THREE.MeshBasicMaterial({ map: bannerTexture(st.sign, '#a33a2c') })); m.position.set(0, 5.6, 0.3); st.mesh.add(m);
  }

  track.remove = () => { scene.remove(group); group.traverse((o) => { o.geometry?.dispose?.(); }); };
  return track;
}

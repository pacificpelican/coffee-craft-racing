// Level 2 scenery: a descending alpine pass, an interstate through boulder country, then the highway bridge above town.
// The road carries real heights (P[i].y); the ground is a heightfield generated around it.
import * as THREE from '../vendor/three.module.min.js';
import { mat, makeAnimal } from './actors.js';
import { mulberry, clamp } from './util.js';
import { buildCenterline, attachQueries, addGates, addStands, bannerTexture, DS } from './track.js';

const BRIDGE_X = 150; // the town's own bridge deck spans x = -150..150
const TOWN = { x0: -212, x1: 212, z0: -222, z1: 202 }; // covered by the town's ground plane
const CELL = 10, REACH = 150, HB = 48;

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

function roadTexture(kind) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#3a3d3c'; g.fillRect(0, 0, 128, 128);
  const rnd = mulberry(kind === 'highway' ? 11 : 7); for (let i = 0; i < 500; i++) { g.fillStyle = rnd() < 0.5 ? '#444847' : '#303332'; g.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
  g.fillStyle = '#e9e0c8'; g.fillRect(4, 0, 3, 128); g.fillRect(121, 0, 3, 128);
  if (kind === 'highway') for (const x of [31, 63, 95]) { g.fillStyle = '#f2efe4'; g.fillRect(x, 0, 3, 56); } else { g.fillStyle = '#e3b93c'; g.fillRect(60, 0, 3, 128); g.fillRect(66, 0, 3, 128); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildHighland(scene, level) {
  const P = buildCenterline(level.waypoints); const length = P[P.length - 1].s;
  smoothY(P, 15, 2);
  const nearWp = (wp) => { const w = level.waypoints[wp]; let bi = 0, bd = Infinity; P.forEach((p, i) => { const d = Math.hypot(p.x - w[0], p.z - w[1]); if (d < bd) { bd = d; bi = i; } }); return P[bi].s; };
  const highwayS = nearWp(level.highwayWp);
  const [alpineHw, highwayHw] = level.widths;
  for (const p of P) {
    p.hw = alpineHw + (highwayHw - alpineHw) * clamp((p.s - (highwayS - 80)) / 160, 0, 1);
    p.v = length - p.s < level.viaductFromEnd;
  }
  const track = { P, length, level, highwayS, half: (p) => p.hw, wallMargin: () => 0.5, stands: [], wildlife: [], dispose: [], update() {} };
  const group = new THREE.Group(); scene.add(group); track.group = group;
  attachQueries(track);
  const hw = (p) => p.hw;
  const rnd = mulberry(4242);

  // ---- nearest-road lookup on a coarse hash, used to shape the ground and place scenery
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
    return { p: best, d: Math.sqrt(bd), lat: (x - best.x) * best.nx + (z - best.z) * best.nz };
  };

  // ---- ground heightfield
  const heightOf = (x, z, info) => {
    const { p, d, lat } = info; const y0 = p.v ? 0 : p.y;
    const edge = Math.max(0, d - (p.hw + 9));
    const tilt = Math.sin(p.s * 0.0016 + 0.9), slopeK = 0.1 + 0.75 * clamp(y0 / 110, 0, 1);
    let h = y0 + (lat < 0 ? -1 : 1) * tilt * edge * slopeK;
    const n = Math.sin(x * 0.011 + z * 0.007) * 0.5 + Math.sin(x * 0.027 - z * 0.019) * 0.3 + Math.sin(x * 0.061 + z * 0.053) * 0.2;
    h += n * (1.5 + y0 * 0.09) * clamp(edge / 25, 0, 1);
    if (!p.v) h -= 0.45 * (1 - clamp((d - (p.hw + 3)) / 11, 0, 1));
    return Math.max(h, -6);
  };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const gx0 = Math.floor((minX - REACH) / CELL), gz0 = Math.floor((minZ - REACH) / CELL);
  const NX = Math.ceil((maxX - minX + 2 * REACH) / CELL) + 1, NZ = Math.ceil((maxZ - minZ + 2 * REACH) / CELL) + 1;
  const H = new Float32Array(NX * NZ).fill(NaN);
  const pos = new Float32Array(NX * NZ * 3), colr = new Float32Array(NX * NZ * 3);
  const stops = [[-6, '#7c7a4c'], [15, '#8a8658'], [40, '#5f7a45'], [80, '#586c46'], [112, '#85877f'], [135, '#e2e8ea']].map(([h, c]) => [h, new THREE.Color(c)]);
  const tmp = new THREE.Color();
  const heightColor = (h, x, z) => {
    let i = 0; while (i < stops.length - 2 && h > stops[i + 1][0]) i++;
    tmp.copy(stops[i][1]).lerp(stops[i + 1][1], clamp((h - stops[i][0]) / (stops[i + 1][0] - stops[i][0]), 0, 1));
    return tmp.multiplyScalar(0.9 + 0.2 * (Math.sin(x * 0.19 + z * 0.13) * 0.5 + 0.5));
  };
  for (let gz = 0; gz < NZ; gz++) for (let gx = 0; gx < NX; gx++) {
    const x = (gx0 + gx) * CELL, z = (gz0 + gz) * CELL, k = gz * NX + gx;
    if (x > TOWN.x0 && x < TOWN.x1 && z > TOWN.z0 && z < TOWN.z1) continue;
    const info = near(x, z, REACH); if (!info) continue;
    const h = heightOf(x, z, info); H[k] = h; pos.set([x, h, z], k * 3);
    const c = heightColor(h, x, z); colr.set([c.r, c.g, c.b], k * 3);
  }
  const idx = [];
  for (let gz = 0; gz < NZ - 1; gz++) for (let gx = 0; gx < NX - 1; gx++) {
    const a = gz * NX + gx, b = a + 1, c = a + NX, d = c + 1;
    if (Number.isNaN(H[a] + H[b] + H[c] + H[d])) continue;
    idx.push(a, c, b, b, c, d);
  }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(colr, 3)); tg.setIndex(idx); tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })); terrain.frustumCulled = false; group.add(terrain);
  track.groundAt = (x, z) => {
    const fx = x / CELL - gx0, fz = z / CELL - gz0, gx = Math.floor(fx), gz = Math.floor(fz);
    if (gx < 0 || gz < 0 || gx >= NX - 1 || gz >= NZ - 1) return null;
    const a = H[gz * NX + gx], b = H[gz * NX + gx + 1], c = H[(gz + 1) * NX + gx], d = H[(gz + 1) * NX + gx + 1];
    if (Number.isNaN(a + b + c + d)) return null;
    const u = fx - gx, v = fz - gz; return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };

  // ---- road ribbons (an alpine two-lane road, then a four-lane interstate)
  const makeRibbon = (i0, i1, tex) => {
    const n = i1 - i0 + 1, rp = new Float32Array(n * 6), uv = new Float32Array(n * 4), ri = [];
    for (let k = 0; k < n; k++) {
      const p = P[i0 + k];
      rp.set([p.x - p.nx * p.hw, p.y + 0.04, p.z - p.nz * p.hw, p.x + p.nx * p.hw, p.y + 0.04, p.z + p.nz * p.hw], k * 6);
      uv.set([0, p.s / 16, 1, p.s / 16], k * 4);
      if (k < n - 1) { const a = k * 2; ri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(rp, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(ri); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })); m.frustumCulled = false; group.add(m);
  };
  const split = Math.round(highwayS / DS);
  makeRibbon(0, split, roadTexture('alpine')); makeRibbon(split, P.length - 1, roadTexture('highway'));

  // ---- guardrails (with gaps where deer cross)
  const gapAt = (s) => (level.hazards?.deer || []).some((d) => Math.abs(s - d) < 24);
  const railPos = [], railIdx = [];
  const railMat = new THREE.MeshLambertMaterial({ color: '#b5bab6', side: THREE.DoubleSide });
  const posts = [];
  for (const side of [-1, 1]) {
    const base = railPos.length / 3;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], l = side * (p.hw + 1.0);
      railPos.push(p.x + p.nx * l, p.y + 0.5, p.z + p.nz * l, p.x + p.nx * l, p.y + 1.0, p.z + p.nz * l);
      if (i < P.length - 1 && !gapAt(p.s) && !gapAt(P[i + 1].s)) { const a = base + i * 2; railIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      if (i % 4 === 0 && !gapAt(p.s)) posts.push([p.x + p.nx * l, p.y, p.z + p.nz * l]);
    }
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3)); rg.setIndex(railIdx); rg.computeVertexNormals();
  const rail = new THREE.Mesh(rg, railMat); rail.frustumCulled = false; group.add(rail);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), mat('#7d827e'), posts.length);
  posts.forEach(([x, y, z], i) => { m4.makeTranslation(x, y + 0.55, z); postMesh.setMatrixAt(i, m4); });
  postMesh.computeBoundingSphere(); postMesh.frustumCulled = false; group.add(postMesh);

  // ---- bridge approach: the town's deck only spans x = -150..150, so continue it out to where the embankment begins
  const viaduct = P.filter((p) => p.v && p.x > BRIDGE_X);
  if (viaduct.length) {
    const xEnd = Math.max(...viaduct.map((p) => p.x)) + 6, z = viaduct[0].z, len = xEnd - BRIDGE_X, cx = (xEnd + BRIDGE_X) / 2;
    const deckBox = (w, h, d, c, x, y, zz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, zz); group.add(m); return m; };
    deckBox(len, 1.6, 24, '#6a6e6c', cx, 11, z); deckBox(len, 0.5, 23, '#2f3234', cx, 11.9, z);
    deckBox(len, 0.9, 0.5, '#8a8f8c', cx, 12.2, z - 11.8); deckBox(len, 0.9, 0.5, '#8a8f8c', cx, 12.2, z + 11.8);
    for (let x = BRIDGE_X + 28; x < xEnd; x += 28) deckBox(2.4, 11, 2.4, '#7a7e7a', x, 5.5, z);
  }

  // ---- trees, boulders and rocks scattered by terrain height
  const place = (count, accept) => {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 40; tries++) {
      const i = Math.floor(rnd() * P.length), p = P[i], side = rnd() < 0.5 ? -1 : 1;
      const lat = side * (p.hw + 8 + Math.pow(rnd(), 1.6) * 100), x = p.x + p.nx * lat + (rnd() - 0.5) * 6, z = p.z + p.nz * lat + (rnd() - 0.5) * 6;
      const g = track.groundAt(x, z); if (g === null) continue;
      const info = near(x, z, 60); if (!info || info.d < info.p.hw + 7) continue;
      if (accept(g, p, rnd)) out.push([x, g, z]);
    }
    return out;
  };
  const cone = new THREE.ConeGeometry(2.6, 9, 6); cone.translate(0, 6.5, 0);
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 2.2, 5); trunk.translate(0, 1.1, 0);
  const treePts = place(1300, (g, p, r) => g < 112 && r() < (p.s < highwayS ? clamp((112 - g) / 70, 0.08, 0.9) : 0.07));
  const foliage = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ flatShading: true }), treePts.length);
  const wood = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: '#5a4430', flatShading: true }), treePts.length);
  treePts.forEach(([x, y, z], i) => {
    const s = (0.7 + rnd() * 1.2) * (y > 85 ? 0.7 : 1);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6); sc.set(s, s * (0.9 + rnd() * 0.4), s); ps.set(x, y - 0.3, z); m4.compose(ps, q, sc);
    foliage.setMatrixAt(i, m4); wood.setMatrixAt(i, m4); foliage.setColorAt(i, col.setHSL(0.31 + rnd() * 0.04, 0.35 + rnd() * 0.15, 0.17 + rnd() * 0.1));
  });
  foliage.computeBoundingSphere(); wood.computeBoundingSphere(); foliage.frustumCulled = wood.frustumCulled = false; group.add(foliage, wood);

  const rockPts = [...place(260, (g, p) => p.s < highwayS), ...place(520, (g, p) => p.s >= highwayS)];
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), rockPts.length);
  rockPts.forEach(([x, y, z], i) => {
    const big = rnd() < 0.12, s = big ? 3 + rnd() * 3.5 : 0.8 + rnd() * 1.8;
    q.setFromEuler(new THREE.Euler(rnd() * 0.5, rnd() * 6, rnd() * 0.5)); sc.set(s * (1 + rnd() * 0.4), s * (0.55 + rnd() * 0.3), s * (1 + rnd() * 0.4)); ps.set(x, y + s * 0.15, z); m4.compose(ps, q, sc);
    rocks.setMatrixAt(i, m4); rocks.setColorAt(i, col.setHSL(0.09 + rnd() * 0.04, 0.12 + rnd() * 0.12, 0.38 + rnd() * 0.18));
  });
  rocks.computeBoundingSphere(); rocks.frustumCulled = false; group.add(rocks);

  // ---- overhead interstate signs
  (level.signs || []).forEach(([s, text]) => {
    const p = track.at(s), w = p.hw + 2.2, g = new THREE.Group();
    for (const side of [-1, 1]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), mat('#6f7472')); pole.position.set(side * w, 4, 0); g.add(pole); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.5, 0.5, 0.5), mat('#6f7472')); beam.position.set(0, 8, 0); g.add(beam);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 1.5, w * 1.5 / 5.33, 0.25), new THREE.MeshBasicMaterial({ map: bannerTexture(text, '#1f6b3a') })); sign.position.set(0, 9.9, 0); g.add(sign);
    g.position.set(p.x, p.y, p.z); g.rotation.y = Math.atan2(-p.nz, p.nx); group.add(g);
  });

  // Raccoons wander the shoulders beyond the guardrail
  [300, 640, 1000, 1330, 1850, 2250, 2900, 3500].forEach((s, i) => {
    const m = makeAnimal('raccoon'); m.scale.setScalar(0.95); group.add(m);
    track.wildlife.push({ mesh: m, s, side: i % 2 ? -1 : 1, phase: i * 1.73 });
  });
  track.time = 0;
  track.update = (dt) => {
    track.time += dt;
    for (const a of track.wildlife) {
      const p = track.at(a.s + Math.sin(track.time * 0.32 + a.phase) * 5);
      const lat = a.side * (p.hw + 6.5 + Math.sin(track.time * 0.55 + a.phase) * 1.2);
      const x = p.x + p.nx * lat, z = p.z + p.nz * lat;
      a.mesh.position.set(x, track.groundAt(x, z) ?? p.y, z);
      a.mesh.rotation.y = p.hd + Math.sin(track.time * 0.4 + a.phase) * 0.22;
    }
  };
  track.update(0);

  addGates(track, group, hw);
  addStands(track, group, hw, () => 6.5);

  track.remove = () => { scene.remove(group); group.traverse((o) => { o.geometry?.dispose?.(); }); };
  return track;
}

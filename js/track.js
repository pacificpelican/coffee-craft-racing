// Race track: a smooth centre line sampled every few units, plus the road ribbon, forest, trees, stands and gates.
import * as THREE from '../vendor/three.module.min.js';
import { mat } from './actors.js';
import { makeHuman, makeAnimal } from './actors.js';
import { mulberry } from './util.js';
import { PIER } from './pier.js';

const DS = 3;
export const FOREST_Z = 135; // south of this the course is the town's own streets

export function halfWidth(z) { return z > 140 ? 7 : z < 126 ? 5.5 : 5.5 + 1.5 * ((z - 126) / 14); }

// Build samples from [x, z, cornerRadius] waypoints, rounding corners with quadratic curves.
// Waypoints may carry a fourth value: the road height at that point (0 when omitted).
export function buildCenterline(wps) {
  const raw = [];
  const seg = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, l]; };
  const yOf = (w) => w[3] || 0;
  raw.push([wps[0][0], wps[0][1], yOf(wps[0])]);
  for (let i = 1; i < wps.length - 1; i++) {
    const [x, z, r] = wps[i]; const [dx0, dz0, l0] = seg(wps[i - 1], wps[i]); const [dx1, dz1, l1] = seg(wps[i], wps[i + 1]);
    const turn = Math.acos(Math.max(-1, Math.min(1, dx0 * dx1 + dz0 * dz1)));
    if (!r || turn < 0.01) { raw.push([x, z, yOf(wps[i])]); continue; }
    const t = Math.min(r * Math.tan(turn / 2), l0 * 0.45, l1 * 0.45);
    const ax = x - dx0 * t, az = z - dz0 * t, bx = x + dx1 * t, bz = z + dz1 * t;
    const ya = yOf(wps[i]) - (yOf(wps[i]) - yOf(wps[i - 1])) * (t / l0), yb = yOf(wps[i]) + (yOf(wps[i + 1]) - yOf(wps[i])) * (t / l1);
    for (let k = 0; k <= 16; k++) { const u = k / 16, v = 1 - u; raw.push([v * v * ax + 2 * u * v * x + u * u * bx, v * v * az + 2 * u * v * z + u * u * bz, ya + (yb - ya) * u]); }
  }
  raw.push([wps[wps.length - 1][0], wps[wps.length - 1][1], yOf(wps[wps.length - 1])]);
  const cum = [0]; for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = cum[cum.length - 1]; const n = Math.floor(total / DS); const P = []; let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = i * DS; while (j < raw.length - 2 && cum[j + 1] < s) j++;
    const u = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    P.push({ x: raw[j][0] + (raw[j + 1][0] - raw[j][0]) * u, z: raw[j][1] + (raw[j + 1][1] - raw[j][1]) * u, y: raw[j][2] + (raw[j + 1][2] - raw[j][2]) * u, s });
  }
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    P[i].tx = (b.x - a.x) / l; P[i].tz = (b.z - a.z) / l; P[i].nx = -P[i].tz; P[i].nz = P[i].tx; P[i].hd = Math.atan2(P[i].tx, P[i].tz);
  }
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 2)], b = P[Math.min(P.length - 1, i + 2)];
    let d = b.hd - a.hd; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    P[i].k = Math.abs(d) / (b.s - a.s || 1);
  }
  return P;
}

export { DS };

// Position/curvature queries shared by every course (needs track.P).
export function attachQueries(track) {
  const P = track.P;
  track.at = (s) => P[Math.max(0, Math.min(P.length - 1, Math.round(s / DS)))];
  // linearly interpolated point on the centre line at distance s
  track.sample = (s) => {
    const f = Math.max(0, Math.min(P.length - 1.001, s / DS)), i = Math.floor(f), u = f - i, a = P[i], b = P[i + 1];
    const tx = a.tx + (b.tx - a.tx) * u, tz = a.tz + (b.tz - a.tz) * u, l = Math.hypot(tx, tz) || 1;
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, y: a.y + (b.y - a.y) * u, tx: tx / l, tz: tz / l, nx: -tz / l, nz: tx / l, hd: Math.atan2(tx, tz), hw: a.hw === undefined ? undefined : a.hw + (b.hw - a.hw) * u };
  };
  track.yAt = (s) => track.sample(s).y;
  // nearest centre-line position (windowed around a hint index for speed and to avoid jumping legs)
  track.nearest = (x, z, hint = -1) => {
    let lo = 0, hi = P.length - 1; if (hint >= 0) { lo = Math.max(0, hint - 40); hi = Math.min(P.length - 1, hint + 40); }
    let bi = lo, bd = Infinity;
    for (let i = lo; i <= hi; i++) { const dx = x - P[i].x, dz = z - P[i].z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
    const p = P[bi]; const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
    return { i: bi, s: p.s + along, lat: (x - p.x) * p.nx + (z - p.z) * p.nz, p };
  };
  track.curvAhead = (i, dist) => { let k = 0; const n = Math.ceil(dist / DS); for (let j = i; j < Math.min(P.length, i + n); j++) k = Math.max(k, P[j].k); return k; };
}

// Start/finish banner texture; a white background draws the chequered finish pattern.
export function bannerTexture(text, bg) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  if (bg === '#fff') { g.fillStyle = '#111'; for (let y = 0; y < 96; y += 24) for (let x = (y / 24) % 2 * 24; x < 512; x += 48) g.fillRect(x, y, 24, 24); }
  g.fillStyle = bg === '#fff' ? '#d9772b' : '#fff6dc'; g.font = 'bold 48px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeStyle = '#111'; g.lineWidth = 6;
  if (text) { g.strokeText(text, 256, 50); g.fillText(text, 256, 50); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// hw(p) is the road half-width at sample p; y comes from the sample so gates sit on elevated roads too.
export function addGates(track, group, hw) {
  const { length } = track, at = track.at;
  const gate = (s, text, bg) => {
    const p = at(s), w = hw(p) + 1.2; const g = new THREE.Group();
    for (const side of [-1, 1]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), mat('#2b2f2a')); pole.position.set(side * w, 3.5, 0); g.add(pole); }
    const b = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.5, 1.8, 0.3), new THREE.MeshBasicMaterial({ map: bannerTexture(text, bg) })); b.position.set(0, 6.6, 0); g.add(b);
    // rotate so the local +x axis (the poles) lies along the track normal
    g.position.set(p.x, p.y, p.z); g.rotation.y = Math.atan2(-p.nz, p.nx); group.add(g);
    return g;
  };
  gate(8, 'START', '#d9772b'); gate(length - 30, 'FINISH', '#fff');
  track.finishS = length - 30; track.startS = 8;
}

// Roadside coffee stands. standOffset(p) is how far past the road edge the stand sits; p.y raises it on elevated roads.
export function addStands(track, group, hw, standOffset) {
  for (const d of track.level.stands || []) {
    const s = d.s ?? track.length - d.fromEnd; const p = track.at(s); const half = hw(p);
    const lat = d.side * (half + standOffset(p)); const g = new THREE.Group();
    const cabin = d.kind === 'cabin';
    const body = d.kind === 'drivethru' ? '#8a5a3c' : cabin ? '#7a5a3c' : '#e8dcc0';
    const box = (w, hh, d2, c, x, y, z2) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d2), mat(c)); m.position.set(x, y, z2); g.add(m); };
    box(6, 3.2, 2, body, 0, 1.8, -0.8); box(6, 1.1, 0.5, '#8a5a3c', 0, 0.75, 1.3);
    if (cabin) { const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.9, 4), mat('#4a3a2a')); roof.rotation.y = Math.PI / 4; roof.scale.set(1.35, 1, 0.7); roof.position.set(0, 4.55, -0.8); g.add(roof); }
    const awn = new THREE.Mesh(new THREE.BoxGeometry(7, 0.25, 2.4), mat('#c2332a')); awn.position.set(0, 3.5, 1.1); awn.rotation.x = 0.12; g.add(awn);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1, 0.2), new THREE.MeshBasicMaterial({ map: bannerTexture('COFFEE', '#2b2f2a') })); sign.position.set(0, 4.3, 0.3); g.add(sign);
    const bar = makeHuman({ shirt: '#c2332a', pants: '#2b2f2a', skin: '#d9a67a', hair: '#4a3020' }); bar.position.set(-1.2, 0.2, 0.55); g.add(bar);
    if (!cabin) for (const wx of [-2, 2]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 10), mat('#1f2320')); wh.rotation.z = Math.PI / 2; wh.position.set(wx * 1.2 + (wx > 0 ? 0.4 : -0.4), 0.5, -0.8); g.add(wh); }
    g.position.set(p.x + p.nx * lat, p.y, p.z + p.nz * lat); g.rotation.y = Math.atan2(-d.side * p.nx, -d.side * p.nz); group.add(g);
    track.stands.push({ ...d, s, x: g.position.x, z: g.position.z, mesh: g });
  }
}

export function buildTrack(scene, level) {
  const P = buildCenterline(level.waypoints); const length = P[P.length - 1].s;
  const track = { P, length, level, half: (p) => halfWidth(p.z), wallMargin: (p) => (p.z > 140 ? 4 : 0.9), stands: [], wildlife: [], dispose: [] };
  const group = new THREE.Group(); scene.add(group); track.group = group;
  attachQueries(track);
  const at = track.at;

  // forest ground and the road ribbon
  const forestEnd = P.findIndex((p) => p.z < FOREST_Z);
  const green = new THREE.Mesh(new THREE.PlaneGeometry(2400, 4700), new THREE.MeshLambertMaterial({ color: '#4d6b3b' }));
  green.rotation.x = -Math.PI / 2; green.position.set(60, 0.0, 160 + 2350); group.add(green);
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#3a3d3c'; g.fillRect(0, 0, 128, 128);
    const rnd = mulberry(7); for (let i = 0; i < 500; i++) { g.fillStyle = rnd() < 0.5 ? '#444847' : '#303332'; g.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
    g.fillStyle = '#e9e0c8'; g.fillRect(4, 0, 3, 128); g.fillRect(121, 0, 3, 128);
    g.fillStyle = '#e3b93c'; g.fillRect(62, 8, 4, 48);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const n = forestEnd < 0 ? P.length : forestEnd + 4; const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
  for (let i = 0; i < n; i++) {
    const p = P[i], w = halfWidth(p.z);
    pos.set([p.x - p.nx * w, 0.03, p.z - p.nz * w, p.x + p.nx * w, 0.03, p.z + p.nz * w], i * 6);
    uv.set([0, p.s / 16, 1, p.s / 16], i * 4);
    if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); rg.setIndex(idx); rg.computeVertexNormals();
  const ribbon = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })); ribbon.frustumCulled = false; group.add(ribbon);

  const bannerTex = bannerTexture;
  const dinerS = Math.min(2520, Math.max(850, length * 0.48));
  const dinerPath = at(dinerS), dinerSide = 1;
  const dinerX = dinerPath.x + dinerPath.nx * (halfWidth(dinerPath.z) + 21);
  const dinerZ = dinerPath.z + dinerPath.nz * (halfWidth(dinerPath.z) + 21);

  // Ponds beside the road in the first half of the course; trees keep clear of them.
  const ponds = [];
  [[420, -1, 13], [1150, 1, 17], [1800, -1, 15], [2230, 1, 12]].forEach(([s, side, r]) => {
    if (s > length * 0.55) return;
    const p = at(s);
    let off = halfWidth(p.z) + r + 12, px, pz, clear = false;
    for (let tries = 0; tries < 8 && !clear; tries++, off += 6) {
      px = p.x + p.nx * side * off; pz = p.z + p.nz * side * off; clear = true;
      for (let j = 0; j < P.length; j += 2) if (Math.abs(P[j].x - px) < r + 30 && Math.abs(P[j].z - pz) < r + 30 && Math.hypot(P[j].x - px, P[j].z - pz) < r + halfWidth(P[j].z) + 8) { clear = false; break; }
    }
    ponds.push({ x: px, z: pz, r, sx: 1.25, side });
  });
  const waterMat = new THREE.MeshLambertMaterial({ color: '#3f7f95' }), mudMat = new THREE.MeshLambertMaterial({ color: '#6b5d43' });
  for (const pd of ponds) {
    const mud = new THREE.Mesh(new THREE.CircleGeometry(pd.r * 1.12, 28), mudMat), water = new THREE.Mesh(new THREE.CircleGeometry(pd.r, 28), waterMat);
    for (const [m, y, k] of [[mud, 0.04, 1.12], [water, 0.07, 1]]) { m.rotation.x = -Math.PI / 2; m.position.set(pd.x, y, pd.z); m.scale.set(pd.sx, 1, 1); group.add(m); }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + pd.r, rr = pd.r * 1.12 + 0.4;
      const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6, 4), mat('#8a7a3c')); reed.position.set(pd.x + Math.cos(a) * rr * pd.sx, 0.8, pd.z + Math.sin(a) * rr); group.add(reed);
    }
  }
  track.ponds = ponds;

  // conifers: instanced in chunks so far-away stands of trees are culled
  const rnd = mulberry(1234); const CHUNK = 300; const cone = new THREE.ConeGeometry(2.6, 9, 6); cone.translate(0, 6.5, 0);
  const broadCone = new THREE.ConeGeometry(3.5, 7.5, 7); broadCone.translate(0, 5.5, 0);
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 2.2, 5); trunk.translate(0, 1.1, 0);
  const fm = new THREE.MeshLambertMaterial({ flatShading: true }), tm = new THREE.MeshLambertMaterial({ color: '#5a4430', flatShading: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  const treeEnd = forestEnd < 0 ? P.length : forestEnd - 8;
  for (let c0 = 0; c0 * CHUNK / DS < treeEnd; c0++) {
    const items = [];
    for (let i = Math.floor(c0 * CHUNK / DS); i < Math.min(treeEnd, (c0 + 1) * CHUNK / DS); i += 2) {
      const p = P[i];
      for (const side of [-1, 1]) {
        const k = rnd() < 0.15 ? 2 : 1;
        for (let t = 0; t < k; t++) {
          const lat = side * (halfWidth(p.z) + 7 + rnd() * (t ? 40 : 18)); const x = p.x + p.nx * lat + (rnd() - 0.5) * 3, z = p.z + p.nz * lat + (rnd() - 0.5) * 3;
          const dinerClearing = Math.abs(p.s - dinerS) < 140 && side === dinerSide && Math.abs(lat) < 56;
          let ok = !dinerClearing && ponds.every((pd) => Math.hypot((x - pd.x) / pd.sx, z - pd.z) > pd.r * 1.12 + 3) && Math.hypot(x - dinerX, z - dinerZ) > 30;
          for (let j = Math.max(0, i - 90); ok && j < Math.min(P.length, i + 90); j += 3) { if (Math.abs(P[j].x - x) < 14 && Math.abs(P[j].z - z) < 14 && Math.hypot(P[j].x - x, P[j].z - z) < halfWidth(P[j].z) + 6) { ok = false; break; } }
          if (ok) items.push([x, z, 0.8 + rnd() * 1.1, rnd(), rnd() < 0.32]);
        }
      }
    }
    if (!items.length) continue;
    const makeTreeBatch = (batch, geometry) => {
      if (!batch.length) return null;
      const foliage = new THREE.InstancedMesh(geometry, fm, batch.length), wood = new THREE.InstancedMesh(trunk, tm, batch.length);
      batch.forEach(([x, z, s, r], i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6); sc.set(s, s * (0.9 + r * 0.4), s); ps.set(x, 0, z); m4.compose(ps, q, sc);
        foliage.setMatrixAt(i, m4); wood.setMatrixAt(i, m4);
        foliage.setColorAt(i, col.setHSL(0.31 + r * 0.04, 0.4 + r * 0.15, 0.2 + r * 0.1));
      });
      foliage.computeBoundingSphere(); wood.computeBoundingSphere(); group.add(foliage, wood);
      return foliage;
    };
    const broad = items.filter((item) => item[4]), classic = items.filter((item) => !item[4]);
    makeTreeBatch(classic, cone); makeTreeBatch(broad, broadCone);
  }

  // A few curious raccoons wander among the trees, well clear of the road.
  const wildlifeS = [520, 960, 1260, 2250, 2770, 3800].filter((s) => s < (forestEnd < 0 ? length : P[Math.max(0, forestEnd - 8)].s));
  wildlifeS.forEach((s, i) => {
    const p = at(s), side = i % 2 ? -1 : 1, animal = makeAnimal('raccoon');
    animal.scale.setScalar(0.95); group.add(animal);
    track.wildlife.push({ mesh: animal, s, side, phase: i * 1.73 });
  });
  // Pelicans: a pair wades at each pond, a few circle overhead, and pigeons peck about the woods.
  const waders = [], flyers = [], hoppers = [];
  ponds.forEach((pd, i) => {
    for (let k = 0; k < 2; k++) {
      const bird = makeAnimal('pelican'); bird.scale.setScalar(1.3); bird.userData.wings.forEach((w) => { w.rotation.z = 0; w.visible = false; });
      group.add(bird); waders.push({ mesh: bird, pd, a: i * 2 + k * 3.1, w: 0.08 + k * 0.03 });
    }
    const f = makeAnimal('pelican'); f.scale.setScalar(2); group.add(f);
    flyers.push({ mesh: f, cx: pd.x, cz: pd.z, r: 35 + i * 6, y: 20 + i * 2, w: (i % 2 ? -1 : 1) * 0.22, a: i * 1.9 });
  });
  [700, 1500, 2050].forEach((s, i) => {
    if (s > length * 0.55) return;
    const p = at(s), f = makeAnimal('pelican'); f.scale.setScalar(2); group.add(f);
    flyers.push({ mesh: f, cx: p.x, cz: p.z, r: 55, y: 24 + i * 3, w: 0.18, a: i * 2.3 });
  });
  [260, 800, 1350, 1950].forEach((s, i) => {
    if (s > length * 0.55) return;
    const p = at(s), side = i % 2 ? 1 : -1, bird = makeAnimal(i % 2 ? 'gull' : 'pigeon'); bird.scale.setScalar(1.4); group.add(bird);
    hoppers.push({ mesh: bird, s, side, phase: i * 2.1 });
  });
  track.update = (dt) => {
    track.time = (track.time || 0) + dt;
    const T = track.time;
    for (const b of waders) {
      b.a += b.w * dt; const pd = b.pd, rr = pd.r * 1.2;
      b.mesh.position.set(pd.x + Math.cos(b.a) * rr * pd.sx, 0.05, pd.z + Math.sin(b.a) * rr);
      b.mesh.rotation.y = Math.atan2(-Math.sin(b.a) * pd.sx * Math.sign(b.w), Math.cos(b.a) * Math.sign(b.w));
    }
    for (const f of flyers) {
      f.a += f.w * dt;
      f.mesh.position.set(f.cx + Math.cos(f.a) * f.r, f.y + Math.sin(T * 0.7 + f.a) * 1.2, f.cz + Math.sin(f.a) * f.r);
      f.mesh.rotation.y = Math.atan2(-Math.sin(f.a) * Math.sign(f.w), Math.cos(f.a) * Math.sign(f.w));
      const flap = Math.sin(T * 5 + f.a * 3) * 0.45;
      f.mesh.userData.wings.forEach((w, k) => { w.rotation.z = (k ? -1 : 1) * flap; });
    }
    for (const h of hoppers) {
      const p = at(h.s + Math.sin(T * 0.4 + h.phase) * 4), lat = h.side * (halfWidth(p.z) + 6 + Math.sin(T * 0.6 + h.phase));
      h.mesh.position.set(p.x + p.nx * lat, Math.max(0, Math.sin(T * 7 + h.phase)) * 0.08, p.z + p.nz * lat);
      h.mesh.rotation.y = p.hd + Math.sin(T * 0.5 + h.phase) * 0.8;
    }
    for (const a of track.wildlife) {
      const p = at(a.s + Math.sin(track.time * 0.32 + a.phase) * 5);
      const lat = a.side * (halfWidth(p.z) + 8.5 + Math.sin(track.time * 0.55 + a.phase) * 1.2);
      a.mesh.position.set(p.x + p.nx * lat, 0, p.z + p.nz * lat);
      a.mesh.rotation.y = p.hd + Math.sin(track.time * 0.4 + a.phase) * 0.22;
    }
  };
  track.update(0);

  // A weather-beaten diner gives the long forest highway a recognizable landmark.
  const diner = new THREE.Group();
  diner.position.set(dinerX, 0, dinerZ);
  diner.rotation.y = Math.atan2(-dinerSide * dinerPath.nx, -dinerSide * dinerPath.nz);
  const dinerBox = (w, h, d, color, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); m.position.set(x, y, z); diner.add(m); };
  dinerBox(13, 3.8, 8, '#8a7863', 0, 1.9, 0);
  dinerBox(13.8, 0.5, 8.8, '#3f4540', 0, 4.05, 0);
  dinerBox(11, 0.35, 0.2, '#a63e2b', 0, 4.5, 3.95);
  const dinerSign = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.2), new THREE.MeshBasicMaterial({ map: bannerTex('CLOSED · DINER', '#3a3028'), side: THREE.DoubleSide }));
  dinerSign.position.set(0, 5.3, 4.05); diner.add(dinerSign);
  dinerBox(3.4, 2.2, 0.16, '#363532', -3.2, 2.2, 4.08);
  dinerBox(3.4, 2.2, 0.16, '#363532', 3.2, 2.2, 4.08);
  for (const x of [-4.1, -3.15, -2.2, 2.2, 3.15, 4.1]) dinerBox(0.14, 2.5, 0.2, '#5a4b3b', x, 2.2, 4.18);
  dinerBox(1.7, 1.1, 1.2, '#8a8f8c', -8.2, 0.55, 1);
  dinerBox(1.7, 1.1, 1.2, '#8a8f8c', 8.2, 0.55, 1);
  group.add(diner);

  // Candle-like route markers keep the course legible once it reaches town.
  const candleBase = new THREE.CylinderGeometry(0.28, 0.38, 0.45, 8);
  const candleWax = new THREE.CylinderGeometry(0.16, 0.18, 0.72, 8);
  const candleFlame = new THREE.ConeGeometry(0.13, 0.38, 6);
  const stoneMat = mat('#62645c'), waxMat = mat('#f3e5c4'), flameMat = new THREE.MeshBasicMaterial({ color: '#ffb347' });
  const candles = [];
  const townStart = forestEnd < 0 ? 0 : forestEnd + 12;
  for (let i = townStart;   i < P.length - 6; i += 9) {
    const p = P[i], w = halfWidth(p.z) + 3;
    for (const side of [-1, 1]) {
        const cx = p.x + p.nx * side * w, cz = p.z + p.nz * side * w;
        const onPier = cx < PIER.x0 && cx > PIER.x1 && cz > PIER.z0 && cz < PIER.z1;
        candles.push([cx, cz, onPier ? PIER.deck : 0]);
      }
    }
  const candleBases = new THREE.InstancedMesh(candleBase, stoneMat, candles.length);
  const candleWaxes = new THREE.InstancedMesh(candleWax, waxMat, candles.length);
  const candleFlames = new THREE.InstancedMesh(candleFlame, flameMat, candles.length);
  candles.forEach(([x, z, y], i) => {
    m4.makeTranslation(x, y + 0.225, z); candleBases.setMatrixAt(i, m4);
    m4.makeTranslation(x, y + 0.55, z); candleWaxes.setMatrixAt(i, m4);
    m4.makeTranslation(x, y + 1.1, z); candleFlames.setMatrixAt(i, m4);
  });
  candleBases.computeBoundingSphere(); candleWaxes.computeBoundingSphere(); candleFlames.computeBoundingSphere();
  group.add(candleBases, candleWaxes, candleFlames);

  addGates(track, group, (p) => halfWidth(p.z));
  addStands(track, group, (p) => halfWidth(p.z), (p) => (p.z > 140 ? 6.5 : 4.5));

  track.remove = () => { scene.remove(group); group.traverse((o) => { o.geometry?.dispose?.(); }); };
  return track;
}

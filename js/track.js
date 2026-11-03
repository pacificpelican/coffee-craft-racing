// Race track: a smooth centre line sampled every few units, plus the road ribbon, forest, trees, stands and gates.
import * as THREE from '../vendor/three.module.min.js';
import { mat } from './actors.js';
import { makeHuman } from './actors.js';
import { mulberry } from './util.js';

const DS = 3;
export const FOREST_Z = 135; // south of this the course is the town's own streets

export function halfWidth(z) { return z > 140 ? 7 : z < 126 ? 5.5 : 5.5 + 1.5 * ((z - 126) / 14); }

// Build samples from [x, z, cornerRadius] waypoints, rounding corners with quadratic curves.
export function buildCenterline(wps) {
  const raw = [];
  const seg = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, l]; };
  raw.push([wps[0][0], wps[0][1]]);
  for (let i = 1; i < wps.length - 1; i++) {
    const [x, z, r] = wps[i]; const [dx0, dz0, l0] = seg(wps[i - 1], wps[i]); const [dx1, dz1, l1] = seg(wps[i], wps[i + 1]);
    const turn = Math.acos(Math.max(-1, Math.min(1, dx0 * dx1 + dz0 * dz1)));
    if (!r || turn < 0.01) { raw.push([x, z]); continue; }
    const t = Math.min(r * Math.tan(turn / 2), l0 * 0.45, l1 * 0.45);
    const ax = x - dx0 * t, az = z - dz0 * t, bx = x + dx1 * t, bz = z + dz1 * t;
    for (let k = 0; k <= 16; k++) { const u = k / 16, v = 1 - u; raw.push([v * v * ax + 2 * u * v * x + u * u * bx, v * v * az + 2 * u * v * z + u * u * bz]); }
  }
  raw.push([wps[wps.length - 1][0], wps[wps.length - 1][1]]);
  const cum = [0]; for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = cum[cum.length - 1]; const n = Math.floor(total / DS); const P = []; let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = i * DS; while (j < raw.length - 2 && cum[j + 1] < s) j++;
    const u = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    P.push({ x: raw[j][0] + (raw[j + 1][0] - raw[j][0]) * u, z: raw[j][1] + (raw[j + 1][1] - raw[j][1]) * u, s });
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

export function buildTrack(scene, level) {
  const P = buildCenterline(level.waypoints); const length = P[P.length - 1].s;
  const track = { P, length, level, half: halfWidth, stands: [], dispose: [] };
  const group = new THREE.Group(); scene.add(group); track.group = group;
  const at = (s) => P[Math.max(0, Math.min(P.length - 1, Math.round(s / DS)))];
  track.at = at;

  // nearest centre-line position (windowed around a hint index for speed and to avoid jumping legs)
  track.nearest = (x, z, hint = -1) => {
    let lo = 0, hi = P.length - 1; if (hint >= 0) { lo = Math.max(0, hint - 40); hi = Math.min(P.length - 1, hint + 40); }
    let bi = lo, bd = Infinity;
    for (let i = lo; i <= hi; i++) { const dx = x - P[i].x, dz = z - P[i].z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
    const p = P[bi]; const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
    return { i: bi, s: p.s + along, lat: (x - p.x) * p.nx + (z - p.z) * p.nz, p };
  };
  track.curvAhead = (i, dist) => { let k = 0; const n = Math.ceil(dist / DS); for (let j = i; j < Math.min(P.length, i + n); j++) k = Math.max(k, P[j].k); return k; };

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

  // conifers: instanced in chunks so far-away stands of trees are culled
  const rnd = mulberry(1234); const CHUNK = 300; const cone = new THREE.ConeGeometry(2.6, 9, 6); cone.translate(0, 6.5, 0); const trunk = new THREE.CylinderGeometry(0.35, 0.5, 2.2, 5); trunk.translate(0, 1.1, 0);
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
          let ok = true; for (let j = Math.max(0, i - 90); j < Math.min(P.length, i + 90); j += 3) { if (Math.abs(P[j].x - x) < 14 && Math.abs(P[j].z - z) < 14 && Math.hypot(P[j].x - x, P[j].z - z) < halfWidth(P[j].z) + 6) { ok = false; break; } }
          if (ok) items.push([x, z, 0.8 + rnd() * 1.1, rnd()]);
        }
      }
    }
    if (!items.length) continue;
    const fo = new THREE.InstancedMesh(cone, fm, items.length), tr = new THREE.InstancedMesh(trunk, tm, items.length);
    items.forEach(([x, z, s, r], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6); sc.set(s, s * (0.9 + r * 0.4), s); ps.set(x, 0, z); m4.compose(ps, q, sc); fo.setMatrixAt(i, m4); tr.setMatrixAt(i, m4);
      fo.setColorAt(i, col.setHSL(0.31 + r * 0.04, 0.4 + r * 0.15, 0.2 + r * 0.1));
    });
    fo.computeBoundingSphere(); tr.computeBoundingSphere(); group.add(fo, tr);
  }

  // gates
  const bannerTex = (text, bg) => { const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 512, 96); if (bg === '#fff') { g.fillStyle = '#111'; for (let y = 0; y < 96; y += 24) for (let x = (y / 24) % 2 * 24; x < 512; x += 48) g.fillRect(x, y, 24, 24); } g.fillStyle = bg === '#fff' ? '#d9772b' : '#fff6dc'; g.font = 'bold 48px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeStyle = '#111'; g.lineWidth = 6; if (text) { g.strokeText(text, 256, 50); g.fillText(text, 256, 50); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const gate = (s, text, bg) => {
    const p = at(s), w = halfWidth(p.z) + 1.2; const g = new THREE.Group();
    for (const side of [-1, 1]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), mat('#2b2f2a')); pole.position.set(side * w, 3.5, 0); g.add(pole); }
    const b = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.5, 1.8, 0.3), new THREE.MeshBasicMaterial({ map: bannerTex(text, bg) })); b.position.set(0, 6.6, 0); g.add(b);
    // rotate so the local +x axis (the poles) lies along the track normal
    g.position.set(p.x, 0, p.z); g.rotation.y = Math.atan2(-p.nz, p.nx); group.add(g);
    return g;
  };
  gate(8, 'START', '#d9772b'); gate(length - 30, 'FINISH', '#fff');
  track.finishS = length - 30; track.startS = 8;

  // roadside coffee stands
  for (const d of level.stands || []) {
    const s = length - d.fromEnd; const p = at(s); const half = halfWidth(p.z);
    const lat = d.side * (half + (p.z > 140 ? 6.5 : 4.5)); const g = new THREE.Group();
    const body = d.kind === 'drivethru' ? '#8a5a3c' : '#e8dcc0';
    const box = (w, hh, d2, c, x, y, z2) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d2), mat(c)); m.position.set(x, y, z2); g.add(m); };
    box(6, 3.2, 2, body, 0, 1.8, -0.8); box(6, 1.1, 0.5, '#8a5a3c', 0, 0.75, 1.3);
    const awn = new THREE.Mesh(new THREE.BoxGeometry(7, 0.25, 2.4), mat('#c2332a')); awn.position.set(0, 3.5, 1.1); awn.rotation.x = 0.12; g.add(awn);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1, 0.2), new THREE.MeshBasicMaterial({ map: bannerTex('COFFEE', '#2b2f2a') })); sign.position.set(0, 4.3, 0.3); g.add(sign);
    const bar = makeHuman({ shirt: '#c2332a', pants: '#2b2f2a', skin: '#d9a67a', hair: '#4a3020' }); bar.position.set(-1.2, 0.2, 0.55); g.add(bar);
    for (const wx of [-2, 2]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 10), mat('#1f2320')); wh.rotation.z = Math.PI / 2; wh.position.set(wx * 1.2 + (wx > 0 ? 0.4 : -0.4), 0.5, -0.8); g.add(wh); }
    g.position.set(p.x + p.nx * lat, 0, p.z + p.nz * lat); g.rotation.y = Math.atan2(-d.side * p.nx, -d.side * p.nz); group.add(g);
    track.stands.push({ ...d, s, x: g.position.x, z: g.position.z, mesh: g });
  }

  track.remove = () => { scene.remove(group); group.traverse((o) => { o.geometry?.dispose?.(); }); };
  return track;
}

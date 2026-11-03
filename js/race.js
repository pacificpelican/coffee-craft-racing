// Racing core: arcade car physics shared by the player and the robo-taxi opponent, AI driving, race flow and chase camera.
import * as THREE from '../vendor/three.module.min.js';
import { clamp, angDiff } from './util.js';
import { carById, makeCar } from './cars.js';
import { makeRoboCar } from './rideshare.js';

export const STRATA = [0, 150, 400, 800]; // points needed for each AI skill stratum
export const SKILL = { normal: [0.74, 0.8, 0.86, 0.92], challenging: [0.92, 0.98, 1.04, 1.1] };
export const strataOf = (points) => STRATA.reduce((n, t, i) => (points >= t ? i : n), 0);
const ROBO = { top: 46, accel: 18, steer: 1.0, grip: 6.5, off: 0.5, mass: 1.2, r: 1.6 };
const BOOST_TIME = 5;

function newCar(x, z, h) { return { x, z, h, vx: 0, vz: 0, i: -1, s: 0, lat: 0, hit: 0, boost: 0, done: false, steer: 0, speed: 0 }; }

function stepCar(c, d, thr, steer, dt, track) {
  const sn = Math.sin(c.h), cs = Math.cos(c.h);
  let vf = c.vx * sn + c.vz * cs, vl = c.vx * cs - c.vz * sn;
  const nr = track.nearest(c.x, c.z, c.i); c.i = nr.i; c.s = nr.s; c.lat = nr.lat;
  const half = track.half(nr.p.z), off = Math.abs(nr.lat) > half;
  const boosting = c.boost > 0; if (boosting) c.boost -= dt;
  const top = d.top * (off ? d.off : 1) * (boosting ? 1.28 : 1), acc = d.accel * (boosting ? 1.7 : 1);
  if (thr > 0) vf += acc * thr * Math.max(0, 1 - vf / top) * dt;
  else if (thr < 0) { if (vf > 0.5) vf = Math.max(0, vf - 34 * -thr * dt); else vf = Math.max(-10, vf + acc * thr * 0.6 * dt); }
  else vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.2 * dt);
  if (vf > top) vf -= (vf - top) * 1.6 * dt;
  vf -= vf * 0.1 * dt;
  let grip = d.grip; if (d.rwd && thr > 0.5 && Math.abs(steer) > 0.2 && vf > 12) grip *= 0.5;
  vl *= Math.exp(-grip * dt);
  c.vx = sn * vf + cs * vl; c.vz = cs * vf - sn * vl;
  c.h += steer * 1.9 * d.steer * clamp(vf / 6, -1, 1) / (1 + Math.abs(vf) / 55) * dt;
  c.x += c.vx * dt; c.z += c.vz * dt;
  // walls: a tree line in the forest, kerbs and buildings in town
  const n2 = track.nearest(c.x, c.z, c.i); const wall = half + (nr.p.z > 140 ? 4 : 0.9);
  if (Math.abs(n2.lat) > wall) {
    const sg = Math.sign(n2.lat), ex = Math.abs(n2.lat) - wall;
    c.x -= sg * ex * n2.p.nx; c.z -= sg * ex * n2.p.nz;
    const vn = (c.vx * n2.p.nx + c.vz * n2.p.nz) * sg;
    if (vn > 0) { c.vx -= sg * n2.p.nx * vn * 1.35; c.vz -= sg * n2.p.nz * vn * 1.35; c.vx *= 0.97; c.vz *= 0.97; c.hit = Math.max(c.hit, vn); }
  }
  const end = track.length - 4;
  if (n2.s > end) { const p = track.at(end); c.x = p.x + p.nx * n2.lat; c.z = p.z + p.nz * n2.lat; c.vx *= 0.5; c.vz *= 0.5; }
  c.speed = Math.max(0, vf);
}

export function createRace(scene, track, cb = {}) {
  const R = { track, phase: 'idle', t: 0, count: 0, result: null, boosts: 0, camera: null };
  let pm = null, am = null, flash = null, camH = 0, camReady = false;
  const P = { c: null, def: null }, A = { c: null, def: ROBO, skill: 0.74, base: 0.74, lane: -2.6 };

  R.setup = ({ carId, difficulty, points, boosts }) => {
    for (const m of [pm, am]) if (m) scene.remove(m);
    R.def = carById(carId); P.def = R.def; R.difficulty = difficulty; R.strata = strataOf(points);
    A.base = SKILL[difficulty][R.strata]; A.skill = A.base;
    const p0 = track.at(track.startS - 4);
    const place = (lat) => newCar(p0.x + p0.nx * lat, p0.z + p0.nz * lat, p0.hd);
    P.c = place(2.6); A.c = place(-2.6);
    pm = makeCar(carId); scene.add(pm);
    flash = new THREE.MeshBasicMaterial({ color: '#7fe9ff' }); am = makeRoboCar(Math.floor(Math.random() * 3), flash).g; scene.add(am);
    R.boosts = boosts || 0; R.phase = 'grid'; R.t = 0; R.result = null; camReady = false; R.sync(); R.poseCamera(R.camera, 1);
  };
  R.sync = () => {
    for (const [m, c] of [[pm, P.c], [am, A.c]]) {
      if (!m || !c) continue;
      m.position.set(c.x, 0.04, c.z); m.rotation.y = c.h; m.rotation.z = clamp(c.steer * c.speed * 0.0016, -0.07, 0.07);
    }
  };
  R.start = () => { R.phase = 'count'; R.count = 3.2; };
  R.player = () => P.c; R.ai = () => A.c;
  R.progress = () => ({ p: clamp(P.c.s / track.finishS, 0, 1), a: clamp(A.c.s / track.finishS, 0, 1) });
  R.position = () => (R.result ? R.result.pos : P.c.s >= A.c.s ? 1 : 2);
  R.boost = () => { if (R.phase !== 'go' || R.boosts <= 0 || P.c.boost > 0) return false; R.boosts--; P.c.boost = BOOST_TIME; return true; };
  R.nearStand = () => (P.c ? track.stands.find((s) => Math.hypot(s.x - P.c.x, s.z - P.c.z) < 18) || null : null);

  function ai(dt) {
    const c = A.c, vf = c.speed || 0;
    if (c.done || R.phase === 'done') { stepCar(c, A.def, -0.7, 0, dt, track); return; }
    if (R.difficulty === 'normal') { const gap = c.s - P.c.s; A.skill = A.base * (gap > 140 ? 0.88 : gap > 60 ? 0.95 : gap < -60 ? 1.06 : 1); } else A.skill = A.base;
    const L = 9 + vf * 0.55, t = track.at(c.s + L), tx = t.x + t.nx * A.lane * 0.5, tz = t.z + t.nz * A.lane * 0.5;
    const steer = clamp(angDiff(c.h, Math.atan2(tx - c.x, tz - c.z)) * 2.4, -1, 1); c.steer = steer;
    const k = track.curvAhead(c.i, vf * 1.6 + 12), vmax = k > 1e-4 ? Math.sqrt((24 * A.skill) / k) : 999;
    const vt = Math.min(A.def.top * A.skill, vmax);
    stepCar(c, A.def, clamp((vt - vf) * 0.35, -1, 1), steer, dt, track);
    if (c.s >= track.finishS) { c.done = true; A.finishT = R.t; }
  }

  function collideCars() {
    const a = P.c, b = A.c, rr = P.def.r + ROBO.r; let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz);
    if (d >= rr || d < 1e-4) return; dx /= d; dz /= d;
    const ov = rr - d, ma = P.def.mass, mb = ROBO.mass, w = ma + mb;
    a.x -= dx * ov * mb / w; a.z -= dz * ov * mb / w; b.x += dx * ov * ma / w; b.z += dz * ov * ma / w;
    const rv = (b.vx - a.vx) * dx + (b.vz - a.vz) * dz;
    if (rv < 0) { const j = -1.25 * rv / (1 / ma + 1 / mb); a.vx -= dx * j / ma; a.vz -= dz * j / ma; b.vx += dx * j / mb; b.vz += dz * j / mb; if (-rv > 4) cb.bump?.(-rv); }
  }

  R.update = (dt, inp) => {
    if (R.phase === 'idle' || R.phase === 'grid') return;
    const c = P.c;
    if (R.phase === 'count') {
      const prev = Math.ceil(R.count); R.count -= dt; const now = Math.ceil(R.count);
      if (now !== prev && now > 0) cb.count?.(now);
      stepCar(c, P.def, 0, 0, dt, track); stepCar(A.c, A.def, 0, 0, dt, track);
      if (R.count <= 0) { R.phase = 'go'; R.t = 0; cb.count?.(0); }
    } else {
      R.t += dt;
      if (R.phase === 'go') { c.steer = inp.steer; stepCar(c, P.def, inp.thr, inp.steer, dt, track); }
      else { c.steer = 0; stepCar(c, P.def, -0.6, 0, dt, track); }
      ai(dt); collideCars();
      if (R.phase === 'go' && c.s >= track.finishS) {
        const aiWon = A.c.done;
        R.phase = 'done'; R.result = { pos: aiWon ? 2 : 1, time: R.t, aiTime: aiWon ? A.finishT : null };
        cb.finish?.(R.result);
      }
      if (c.hit > 6) cb.crash?.(c.hit);
      c.hit = 0; A.c.hit = 0;
    }
    R.sync();
  };

  R.poseCamera = (camera, dt, zoom = 1) => {
    R.camera = camera; const c = P.c; if (!camera || !c) return;
    if (!camReady) { camH = c.h; camReady = true; }
    camH += angDiff(camH, c.h) * Math.min(1, dt * 4.5);
    const back = 9.5 * zoom, sp = c.speed || 0;
    camera.position.set(c.x - Math.sin(camH) * back, 4.3 * zoom + 0.4, c.z - Math.cos(camH) * back);
    camera.lookAt(c.x + Math.sin(c.h) * 6, 1.6, c.z + Math.cos(c.h) * 6);
    const fov = 52 + Math.min(18, sp * 0.3) + (c.boost > 0 ? 6 : 0); if (Math.abs(camera.fov - fov) > 0.2) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  };
  R.dispose = () => { for (const m of [pm, am]) if (m) scene.remove(m); pm = am = null; };
  return R;
}

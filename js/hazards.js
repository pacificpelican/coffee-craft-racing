// Moving hazards for the highway levels: slower traffic in the lanes and deer that wander across the mountain road.
// Everything is described as circles (obstacles) so the player and the robo-taxi can bump into and steer around them.
import * as THREE from '../vendor/three.module.min.js';
import { makeCar } from './cars.js';
import { makeAnimal } from './actors.js';
import { mulberry, clamp } from './util.js';

const KINDS = ['round', 'round', 'cross', 'cross', 'pickup', 'pickup', 'cuv', 'bus'];
const PAINT = ['#e3b93c', '#6f8f4e', '#4f7a96', '#d9772b', '#8a8f8c', '#c9c0a0', '#7a5a3c', '#a63e2b', '#e8e4d8', '#3a5a7a'];
const CIRCLES = { bus: { r: 1.5, at: [-3.3, 0, 3.3] }, pickup: { r: 1.25, at: [-1.5, 1.5] }, default: { r: 1.25, at: [-1.4, 1.4] } };
const DEER_R = 1.0, DEER_SPEED = 6;

export function createHazards(scene, track) {
  const cfg = track.level.hazards || {};
  const H = { obstacles: [], cars: [], deer: [] };
  const group = new THREE.Group(); scene.add(group);
  const hwAt = (p) => (p.hw === undefined ? 7 : p.hw);

  H.reset = (seed = Math.floor(Math.random() * 1e9)) => {
    group.clear(); H.cars = []; H.deer = [];
    const rnd = mulberry(seed);
    for (const sec of cfg.traffic || []) {
      let placed = 0;
      for (let tries = 0; placed < sec.count && tries < sec.count * 25; tries++) {
        const s = sec.from + rnd() * (sec.to - sec.from), lf = sec.lanes[Math.floor(rnd() * sec.lanes.length)];
        if (H.cars.some((o) => Math.abs(o.s - s) < (o.lf === lf ? 70 : 28))) continue;
        const kind = KINDS[Math.floor(rnd() * KINDS.length)], mesh = makeCar(kind, PAINT[Math.floor(rnd() * PAINT.length)]);
        mesh.rotation.order = 'YXZ'; group.add(mesh);
        const v0 = sec.speed[0] + rnd() * (sec.speed[1] - sec.speed[0]);
        H.cars.push({ kind, mesh, s, lf, v0, v: v0, lat: 0, x: 0, z: 0, circ: CIRCLES[kind] || CIRCLES.default });
        placed++;
      }
    }
    for (const ds of cfg.deer || []) {
      const mesh = makeAnimal('deer'); mesh.scale.setScalar(1.15); group.add(mesh);
      H.deer.push({ mesh, s: ds, side: rnd() < 0.5 ? -1 : 1, active: rnd() < 0.75, state: 'wait', lat: 0, dir: 0, x: 0, z: 0, vx: 0, vz: 0 });
    }
    H.update(0, []);
  };

  H.update = (dt, cars) => {
    const obs = H.obstacles; obs.length = 0;
    for (const o of H.cars) {
      let target = o.v0;
      for (const c of cars) { const ds = c.s - o.s; if (ds > 0 && ds < 16 && Math.abs(c.lat - o.lat) < 2.6) target = Math.min(target, Math.max(0, c.speed * 0.9)); }
      o.v += clamp(target - o.v, -14 * dt, 6 * dt);
      o.s = Math.min(track.length - 20, o.s + o.v * dt);
      const p = track.sample(o.s), p2 = track.sample(o.s + 3);
      o.lat = o.lf * hwAt(p); o.x = p.x + p.nx * o.lat; o.z = p.z + p.nz * o.lat;
      o.mesh.position.set(o.x, p.y + 0.04, o.z); o.mesh.rotation.y = p.hd; o.mesh.rotation.x = -Math.atan2(p2.y - p.y, 3);
      for (const k of o.circ.at) obs.push({ x: o.x + p.tx * k, z: o.z + p.tz * k, r: o.circ.r, vx: p.tx * o.v, vz: p.tz * o.v, s: o.s + k, lat: o.lat });
    }
    const lead = cars[0];
    for (const d of H.deer) {
      const p = track.sample(d.s), hw = hwAt(p), edge = hw + 3.5;
      if (d.state === 'wait') {
        d.lat = d.side * edge;
        if (d.active && lead && lead.s > d.s - 170 && lead.s < d.s - 25) { d.state = 'cross'; d.dir = -d.side; }
      } else if (d.state === 'cross') {
        d.lat += d.dir * DEER_SPEED * dt;
        if (Math.abs(d.lat) >= edge && Math.sign(d.lat) === d.dir) { d.lat = d.dir * edge; d.state = 'done'; }
      }
      const moving = d.state === 'cross', lv = moving ? d.dir * DEER_SPEED : 0;
      d.x = p.x + p.nx * d.lat; d.z = p.z + p.nz * d.lat; d.vx = p.nx * lv; d.vz = p.nz * lv;
      const face = moving ? Math.atan2(d.vx, d.vz) : Math.atan2(-p.nx * Math.sign(d.lat || 1), -p.nz * Math.sign(d.lat || 1));
      d.mesh.position.set(d.x, p.y - 0.3 + (moving ? Math.abs(Math.sin(performance.now() * 0.012)) * 0.12 : 0), d.z); d.mesh.rotation.y = face;
      obs.push({ x: d.x, z: d.z, r: DEER_R, vx: d.vx, vz: d.vz, s: d.s, lat: d.lat });
    }
  };

  // Push a car out of any obstacle it overlaps and bounce it off. The car is modelled as two circles (nose and tail).
  H.resolve = (c, def, cb) => {
    const sn = Math.sin(c.h), cs = Math.cos(c.h), off = def.r * 0.7, rc = def.r * 0.85;
    for (const sg of [-1, 1]) {
      for (const o of H.obstacles) {
        const dx = c.x + sn * off * sg - o.x, dz = c.z + cs * off * sg - o.z, rr = rc + o.r;
        if (Math.abs(dx) >= rr || Math.abs(dz) >= rr) continue;
        const d = Math.hypot(dx, dz); if (d >= rr || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d, push = rr - d;
        c.x += nx * push; c.z += nz * push;
        const rv = (c.vx - o.vx) * nx + (c.vz - o.vz) * nz;
        if (rv < 0) { c.vx -= 1.3 * rv * nx; c.vz -= 1.3 * rv * nz; c.hit = Math.max(c.hit, -rv); if (-rv > 4) cb?.bump?.(-rv); }
      }
    }
  };

  H.dispose = () => { scene.remove(group); group.clear(); };
  return H;
}

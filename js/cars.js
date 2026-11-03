// The garage: every drivable car, its handling numbers and its low-poly model.
// Models face +z (heading 0), matching the traffic vehicles they were drawn from.
import * as THREE from '../vendor/three.module.min.js';
import { mat } from './actors.js';

const box = (w, h, d, color, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); m.position.set(x, y, z); return m; };
const wheel = (r, w, x, y, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 10), mat('#1f2320')); m.rotation.z = Math.PI / 2; m.position.set(x, y, z); return m; };
const caps = (r, len, color, sx, sy) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 12), mat(color)); m.rotation.x = Math.PI / 2; m.scale.set(sx, 1, sy); return m; };
const shade = (hex, f) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); };

const builders = {
  round(color) {
    const g = new THREE.Group();
    const b = caps(1.0, 2.0, color, 1, 0.62); b.position.y = 0.75; g.add(b);
    const cab = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), mat('#cfe0e4')); cab.scale.set(0.95, 0.65, 1.2); cab.position.set(0, 1.3, -0.1); g.add(cab);
    for (const x of [-0.95, 0.95]) for (const z of [-1.3, 1.3]) g.add(wheel(0.38, 0.28, x, 0.38, z));
    g.add(box(1.3, 0.14, 0.05, '#f2e6a8', 0, 0.8, 2.0));
    return g;
  },
  cross(color) {
    const g = new THREE.Group();
    g.add(box(2.0, 0.95, 4.2, color, 0, 0.95, 0));
    g.add(box(1.84, 0.8, 2.9, color, 0, 1.8, -0.35));
    g.add(box(1.88, 0.55, 2.6, '#2f3b40', 0, 1.85, -0.35));
    g.add(box(1.9, 0.1, 2.95, shade(color, 0.82), 0, 2.25, -0.35));
    g.add(box(1.5, 0.08, 2.2, '#2b2f2a', 0, 2.34, -0.35));
    for (const x of [-0.98, 0.98]) for (const z of [-1.35, 1.35]) g.add(wheel(0.42, 0.28, x, 0.42, z));
    g.add(box(1.6, 0.16, 0.05, '#f2e6a8', 0, 1.05, 2.12), box(1.2, 0.3, 0.05, '#2b2f2a', 0, 0.7, 2.12), box(1.6, 0.14, 0.05, '#b33a2a', 0, 1.1, -2.12));
    return g;
  },
  pickup(color) {
    const g = new THREE.Group();
    g.add(box(2.0, 0.85, 4.6, color, 0, 0.9, 0), box(1.9, 0.9, 1.7, color, 0, 1.78, 0.8), box(1.94, 0.55, 1.45, '#2f3b40', 0, 1.85, 0.82), box(1.7, 0.5, 1.9, '#2f3234', 0, 1.4, -1.4));
    for (const x of [-0.98, 0.98]) g.add(box(0.06, 0.4, 2.0, color, x * 0.9, 1.5, -1.4));
    for (const x of [-1, 1]) for (const z of [-1.4, 1.45]) g.add(wheel(0.46, 0.3, x, 0.46, z));
    g.add(box(1.6, 0.16, 0.05, '#f2e6a8', 0, 1.0, 2.32), box(1.2, 0.3, 0.05, '#2b2f2a', 0, 0.7, 2.32));
    return g;
  },
  // Blocky crossover with a glass moonroof panel and roof rails.
  cuv(color) {
    const g = new THREE.Group();
    g.add(box(2.05, 1.0, 4.3, color, 0, 0.98, 0));
    g.add(box(1.9, 0.9, 3.1, color, 0, 1.88, -0.3));
    g.add(box(1.94, 0.6, 2.8, '#24343a', 0, 1.92, -0.3));
    g.add(box(1.96, 0.1, 3.15, shade(color, 0.86), 0, 2.37, -0.3));
    const roofGlass = box(1.3, 0.05, 1.3, '#9fd3e6', 0, 2.44, -0.1); roofGlass.material = new THREE.MeshLambertMaterial({ color: '#9fd3e6', emissive: '#2a5a6a', flatShading: true });
    g.add(roofGlass);
    for (const x of [-0.8, 0.8]) g.add(box(0.07, 0.07, 2.6, '#2b2f2a', x, 2.5, -0.3));
    for (const x of [-1.0, 1.0]) for (const z of [-1.4, 1.4]) g.add(wheel(0.44, 0.3, x, 0.44, z));
    g.add(box(1.7, 0.16, 0.05, '#f2e6a8', 0, 1.1, 2.17), box(1.2, 0.3, 0.05, '#2b2f2a', 0, 0.72, 2.17), box(1.7, 0.14, 0.05, '#b33a2a', 0, 1.15, -2.17));
    return g;
  },
  bus(color) {
    const g = new THREE.Group();
    const b = caps(1.35, 6.4, color, 1, 0.95); b.position.y = 1.75; g.add(b);
    g.add(box(2.72, 0.7, 9.2, '#2f3b40', 0, 2.15, 0), box(2.74, 0.25, 9.4, '#6f8f4e', 0, 1.4, 0));
    for (const x of [-1.25, 1.25]) for (const z of [-3.2, 3.2]) g.add(wheel(0.55, 0.35, x, 0.55, z));
    return g;
  },
  // Rear-wheel-drive sports car designed for this game: low wedge, big rear tyres, wing.
  sport(color) {
    const g = new THREE.Group();
    g.add(box(1.95, 0.5, 4.5, color, 0, 0.62, 0));
    g.add(box(1.7, 0.32, 1.6, color, 0, 0.95, 1.45));
    g.add(box(1.5, 0.5, 1.9, '#1d2c33', 0, 1.1, -0.25));
    g.add(box(1.45, 0.08, 1.4, shade(color, 0.8), 0, 1.38, -0.3));
    g.add(box(1.9, 0.07, 0.55, '#2b2f2a', 0, 1.25, -2.1), box(0.1, 0.4, 0.3, '#2b2f2a', -0.7, 1.0, -2.0), box(0.1, 0.4, 0.3, '#2b2f2a', 0.7, 1.0, -2.0));
    for (const x of [-0.98, 0.98]) { g.add(wheel(0.36, 0.26, x, 0.36, 1.4)); g.add(wheel(0.42, 0.4, x, 0.42, -1.4)); }
    g.add(box(1.5, 0.1, 0.05, '#f2e6a8', 0, 0.72, 2.27), box(1.5, 0.1, 0.05, '#c2332a', 0, 0.78, -2.27));
    g.add(box(0.5, 0.05, 4.4, '#f4f0e0', 0, 0.9, 0));
    return g;
  },
};

// top: max speed (units/s); accel: units/s^2; steer: turn-rate multiplier; grip: sideways-slide damping (lower slides more); off: off-road speed factor; mass: ramming weight; r: collision radius.
export const CARS = [
  { id: 'round', name: 'Roundabout', blurb: 'Round, friendly and forgiving. A fine first car.', color: '#d9772b', top: 40, accel: 16, steer: 1.0, grip: 6.5, off: 0.55, mass: 1, r: 1.5, unlock: 0 },
  { id: 'cross', name: 'Boxy Crossover', blurb: 'Sturdy and balanced, with a roof rack for nothing in particular.', color: '#4f7a96', top: 42, accel: 15, steer: 0.95, grip: 6.0, off: 0.58, mass: 1.2, r: 1.55, unlock: 0 },
  { id: 'pickup', name: 'Hauler Pickup', blurb: 'Slower, but it shrugs off gravel and grass.', color: '#6f8f4e', top: 39, accel: 15, steer: 0.9, grip: 6.0, off: 0.8, mass: 1.5, r: 1.6, unlock: 0 },
  { id: 'cuv', name: 'Skyview CUV', blurb: 'Blocky crossover with a big moonroof. Quicker and grippier.', color: '#3f9a9a', top: 46, accel: 18, steer: 1.0, grip: 6.5, off: 0.6, mass: 1.3, r: 1.6, unlock: 100 },
  { id: 'bus', name: 'City Bus', blurb: 'Heavy, wide and unstoppable in a shoving match. Turns like a bus.', color: '#e3b93c', top: 37, accel: 10, steer: 0.62, grip: 4.8, off: 0.5, mass: 4, r: 2.3, unlock: 300 },
  { id: 'sport', name: 'Redwood RS', blurb: 'Rear-wheel-drive sports car. Fast, twitchy, and the tail wants to come around.', color: '#c2332a', top: 56, accel: 24, steer: 1.1, grip: 3.6, off: 0.5, mass: 1, r: 1.5, rwd: true, unlock: 600 },
];

export const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];
export const makeCar = (id) => builders[carById(id).id](carById(id).color);

import * as THREE from 'three';
import { ITEM_COLORS } from '../data/themes.js';
import { box, cyl, sphere, torus, mergeParts, ensureColorAttr } from '../world/props.js';
import { bayHeadroom, nearestBay } from '../world/generator.js';
import * as TX from '../render/textures.js';
import { RNG } from '../core/rng.js';

export const ITEM_STATE = {
  FREE: 0,        // lying on the floor, fair game
  KID: 1,         // in a kid's hands
  CARRIED: 2,     // in the player's arms
  FLYING: 3,      // gravity-gun'd or bookerang'd
  RETURNING: 4,   // homing into a shelf bay
  DEAD: 5,
};

const GRAVITY = -22;
const MAX_ITEMS = 600;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Everything that can leave a shelf. One instanced mesh for the items, one for
 * the "come get me" sparkles, and a fixed pool so a tornado can never allocate
 * mid-frame.
 */
export class ItemSystem {
  constructor(scene, mats, theme, layout) {
    this.scene = scene;
    this.mats = mats;
    this.theme = theme;
    this.layout = layout;
    // Gameplay-affecting item scatter must come from the run seed. Cosmetic
    // particles may use Math.random(), but where an item lands changes the run.
    this.rng = new RNG(`${layout.seed}-items`);

    // Cemetery patrols never create loose inventory. Keep one compatibility
    // slot so shared UI and lifecycle code remain simple without allocating or
    // scanning the full 600-item library pool every frame.
    this.capacity = theme.id === 'cemetery' ? 1 : MAX_ITEMS;
    this.items = [];
    for (let i = 0; i < this.capacity; i++) {
      this.items.push({
        id: i, active: false, state: ITEM_STATE.DEAD,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        rx: 0, ry: 0, rz: 0, spin: 0,
        color: 'crimson', hazard: null,
        visualKind: 'book', restHeight: 0.03,
        holder: null, targetBay: null, age: 0, grounded: false,
        scale: 1, homeBay: null, flashT: 0, returnArc: null, returnReserved: false,
        trainingPowerTarget: false, trainingSourceBay: null, trainingSourceDisplaced: false,
      });
    }
    this.freeList = this.items.map((it) => it.id).reverse();

    // One fixed instancing pool per silhouette keeps draw calls bounded while
    // allowing a banana, mushroom, VHS case, and record sleeve to genuinely
    // look different. Grocery has the widest set at ten pools; no mesh is ever
    // allocated in the simulation loop.
    this.visuals = new Map();
    for (const kind of looseItemKindsForTheme(theme)) {
      const geo = buildLooseItemGeometry(theme, kind);
      geo.computeBoundingBox();
      const mesh = new THREE.InstancedMesh(geo, mats.item, this.capacity);
      mesh.name = `loose-items-${kind}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3);
      mesh.count = 0;
      scene.add(mesh);
      this.visuals.set(kind, {
        kind, geo, mesh,
        restHeight: Math.max(0.012, -(geo.boundingBox?.min.y ?? -0.025) + 0.006),
      });
    }
    const primary = this.visuals.values().next().value;
    // Kept as compatibility aliases for diagnostics that inspect the primary
    // pool. Rendering and disposal iterate all visual pools below.
    this.mesh = primary.mesh;
    this.geo = primary.geo;

    // Ground markers so a book on a dark floor is still findable.
    const markGeo = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);
    ensureColorAttr(markGeo);
    this.markMat = new THREE.MeshBasicMaterial({
      map: TX.radialAlpha({ power: 2.2 }),
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true, toneMapped: false,
      opacity: 0.9,
    });
    this.marks = new THREE.InstancedMesh(markGeo, this.markMat, this.capacity);
    this.marks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3);
    this.marks.frustumCulled = false;
    this.marks.count = 0;
    this.marks.renderOrder = 2;
    scene.add(this.marks);
    this.markGeo = markGeo;

    this.time = 0;
    this.onGrounded = null;
    this.onShelved = null;
  }

  get looseCount() {
    let n = 0;
    for (const it of this.items) if (it.active && (it.state === ITEM_STATE.FREE || it.state === ITEM_STATE.KID)) n++;
    return n;
  }

  get floorCount() {
    let n = 0;
    for (const it of this.items) if (it.active && it.state === ITEM_STATE.FREE) n++;
    return n;
  }

  spawn(x, y, z, color, opts = {}) {
    const id = this.freeList.pop();
    if (id === undefined) return null;
    const it = this.items[id];
    it.active = true;
    it.state = opts.state ?? ITEM_STATE.FREE;
    it.x = x; it.y = y; it.z = z;
    it.vx = opts.vx ?? 0; it.vy = opts.vy ?? 0; it.vz = opts.vz ?? 0;
    it.rx = this.rng.range(0, 6.28); it.ry = this.rng.range(0, 6.28); it.rz = this.rng.range(0, 6.28);
    it.spin = this.rng.range(-4.5, 4.5);
    it.color = color;
    it.hazard = opts.hazard ?? null;
    it.visualKind = resolveLooseItemKind(this.theme, it.hazard, it.id);
    it.restHeight = this.visuals?.get(it.visualKind)?.restHeight ?? (this.theme?.itemSize?.w ?? 0.05) * 0.6;
    it.holder = null;
    it.targetBay = null;
    it.returnArc = null;
    it.returnReserved = false;
    it.trainingPowerTarget = false;
    it.trainingSourceBay = null;
    it.trainingSourceDisplaced = false;
    it.homeBay = opts.homeBay ?? null;
    it.age = 0;
    it.grounded = false;
    it.scale = opts.scale ?? 1;
    it.flashT = 0.6;
    return it;
  }

  release(it) {
    if (!it.active) return;
    this._releaseReturnReservation(it);
    it.active = false;
    it.state = ITEM_STATE.DEAD;
    it.holder = null;
    it.targetBay = null;
    it.returnArc = null;
    it.trainingPowerTarget = false;
    it.trainingSourceBay = null;
    it.trainingSourceDisplaced = false;
    this.freeList.push(it.id);
  }

  _releaseReturnReservation(it) {
    if (!it.returnReserved || !it.targetBay) return;
    it.targetBay.reserved = Math.max(0, (it.targetBay.reserved || 0) - 1);
    it.returnReserved = false;
  }

  /** Knock `count` items off a bay, popping them into the aisle. */
  knockOff(bay, count, opts = {}) {
    const out = [];
    const run = bay.run;
    for (let i = 0; i < count; i++) {
      if (bay.filled <= 0) break;
      if (!this.freeList.length) break;   // pool exhausted; leave it on the shelf
      bay.filled--;
      const h = 0.4 + this.rng.next() * (run.height - 0.7);
      const spread = this.rng.range(-0.4, 0.4);
      const px = bay.wx + bay.nx * 0.15 + -bay.nz * spread;
      const pz = bay.wz + bay.nz * 0.15 + bay.nx * spread;
      const force = opts.force ?? 1;
      const it = this.spawn(px, h, pz, bay.color, {
        vx: bay.nx * this.rng.range(1.4, 3.6) * force + this.rng.range(-0.5, 0.5) * force,
        vy: 1.2 + this.rng.next() * 2.4 * force,
        vz: bay.nz * this.rng.range(1.4, 3.6) * force + this.rng.range(-0.5, 0.5) * force,
        hazard: opts.hazard ?? null,
        homeBay: bay,
      });
      if (it) out.push(it);
    }
    return out;
  }

  update(dt, ctx) {
    this.time += dt;
    const { collision } = ctx;

    for (const it of this.items) {
      if (!it.active) continue;
      it.age += dt;
      if (it.flashT > 0) it.flashT -= dt;

      switch (it.state) {
        case ITEM_STATE.FREE: {
          if (!it.grounded) {
            it.vy += GRAVITY * dt;
            it.x += it.vx * dt;
            it.y += it.vy * dt;
            it.z += it.vz * dt;
            it.rx += it.spin * dt;
            it.rz += it.spin * 0.7 * dt;

            if (collision.isBlocked(it.x, it.z) && it.y < 2.4) {
              // Bounce back out of the shelf it just hit.
              it.vx *= -0.45; it.vz *= -0.45;
              it.x += it.vx * dt * 2; it.z += it.vz * dt * 2;
            }
            const rest = it.restHeight;
            if (it.y <= rest) {
              it.y = rest;
              if (Math.abs(it.vy) > 2.2) {
                it.vy *= -0.32;
                it.vx *= 0.6; it.vz *= 0.6;
                it.spin *= 0.5;
              } else {
                it.vy = 0; it.vx *= 0.2; it.vz *= 0.2;
                it.grounded = true;
                // Settle flat with a random yaw.
                it.rx = 0; it.rz = 0; it.ry = this.rng.range(0, 6.28);
                this.onGrounded?.(it);
              }
            }
          } else {
            // Nudge items out of walls if a disaster shoved them in.
            if (collision.isBlocked(it.x, it.z)) {
              const res = collision.resolve(it.x, it.z, 0.22, _res);
              it.x = res.x; it.z = res.z;
            }
          }
          break;
        }

        case ITEM_STATE.FLYING: {
          // Homing pull toward whoever grabbed it.
          const t = it.holder;
          if (!t) { it.state = ITEM_STATE.FREE; it.grounded = false; break; }
          const tx = t.x, ty = (t.carryY ?? 1.0), tz = t.z;
          const dx = tx - it.x, dy = ty - it.y, dz = tz - it.z;
          const d = Math.hypot(dx, dy, dz);
          const pull = 26 + it.age * 30;
          it.vx += (dx / d) * pull * dt;
          it.vy += (dy / d) * pull * dt;
          it.vz += (dz / d) * pull * dt;
          it.vx *= 0.93; it.vy *= 0.93; it.vz *= 0.93;
          it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
          it.rx += 14 * dt; it.ry += 9 * dt;
          if (d < 0.55) {
            it.state = ITEM_STATE.CARRIED;
            it.holder = t;
            t.onItemArrived?.(it);
          }
          break;
        }

        case ITEM_STATE.RETURNING: {
          const bay = it.targetBay;
          if (!bay) { it.state = ITEM_STATE.FREE; it.grounded = false; break; }
          const ty = bay.run.height * 0.55;
          const tx = bay.wx + bay.nx * 0.12;
          const tz = bay.wz + bay.nz * 0.12;

          // Bookerang returns travel on a visible quadratic arc. This is still
          // the real item entity—not a decorative duplicate—so the throw reads
          // clearly and completes through the normal shelving callback.
          if (it.returnArc) {
            const a = it.returnArc;
            a.t = Math.min(1, a.t + dt / a.duration);
            const u = 1 - a.t;
            it.x = u * u * a.sx + 2 * u * a.t * a.cx + a.t * a.t * tx;
            it.y = u * u * a.sy + 2 * u * a.t * a.cy + a.t * a.t * ty;
            it.z = u * u * a.sz + 2 * u * a.t * a.cz + a.t * a.t * tz;
            it.ry += 28 * dt;
            it.rz += 12 * dt;
            if (a.t >= 1) this._finishReturn(it, bay);
            break;
          }
          const dx = tx - it.x, dy = ty - it.y, dz = tz - it.z;
          const d = Math.hypot(dx, dy, dz) || 1e-4;
          const speed = 9 + it.age * 22;
          it.x += (dx / d) * Math.min(speed * dt, d);
          it.y += (dy / d) * Math.min(speed * dt, d);
          it.z += (dz / d) * Math.min(speed * dt, d);
          it.rx += 12 * dt; it.ry += 16 * dt;
          if (d < 0.35) this._finishReturn(it, bay);
          break;
        }

        case ITEM_STATE.KID:
        case ITEM_STATE.CARRIED:
          // Position is written by the holder each frame.
          break;
      }
    }
  }

  /** Send an item home to a specific bay. */
  returnTo(it, bay, opts = {}) {
    if (!it?.active || !bay) return false;
    this._releaseReturnReservation(it);
    if (bay.filled + (bay.reserved || 0) >= bayHeadroom(bay)) return false;
    bay.reserved = (bay.reserved || 0) + 1;
    it.returnReserved = true;
    const sx = it.x, sy = it.y, sz = it.z;
    it.state = ITEM_STATE.RETURNING;
    it.targetBay = bay;
    it.age = 0;
    it.holder = null;
    if (opts.arc) {
      const tx = bay.wx + bay.nx * 0.12;
      const tz = bay.wz + bay.nz * 0.12;
      const dx = tx - sx, dz = tz - sz;
      const d = Math.hypot(dx, dz);
      const side = opts.side ?? (it.id % 2 ? 1 : -1);
      it.returnArc = {
        sx, sy, sz,
        cx: (sx + tx) * 0.5 - (dz / (d || 1)) * Math.min(4, d * 0.22) * side,
        cy: Math.max(sy, bay.run.height * 0.55) + Math.min(5, 1.8 + d * 0.11),
        cz: (sz + tz) * 0.5 + (dx / (d || 1)) * Math.min(4, d * 0.22) * side,
        duration: opts.duration ?? Math.max(0.55, Math.min(1.25, d / 18)),
        t: 0,
      };
    } else {
      it.returnArc = null;
    }
    return true;
  }

  _finishReturn(it, bay) {
    this._releaseReturnReservation(it);
    if (bay.filled >= bayHeadroom(bay)) {
      const reroute = nearestBay(this.layout, it.x, it.z, it.color, 140);
      if (reroute && this.returnTo(it, reroute)) return;
      // Never award or destroy an item that did not actually reach a shelf.
      it.state = ITEM_STATE.FREE;
      it.targetBay = null;
      it.returnArc = null;
      it.grounded = false;
      it.vy = 1.2;
      return;
    }
    bay.filled++;
    if (it.trainingPowerTarget) it.trainingSourceDisplaced = false;
    this.onShelved?.(it, bay);
    this.release(it);
  }

  render(camera) {
    const marks = this.marks;
    for (const visual of this.visuals.values()) visual.mesh.count = 0;
    marks.count = 0;
    const t = this.time;

    for (const it of this.items) {
      if (!it.active) continue;
      const visual = this.visuals.get(it.visualKind) || this.visuals.values().next().value;
      const mesh = visual.mesh;
      const i = mesh.count++;
      _q.setFromEuler(_e.set(it.rx, it.ry, it.rz));
      const bob = it.state === ITEM_STATE.FREE && it.grounded ? 0 : 0;
      const sc = it.scale * (it.flashT > 0 ? 1 + it.flashT * 0.5 : 1);
      _m.compose(_v.set(it.x, it.y + bob, it.z), _q, _s.set(sc, sc, sc));
      mesh.setMatrixAt(i, _m);

      // Shelf-match color remains authoritative for normal items. Grocery
      // hazards may declare their conventional color; the ground marker still
      // shows the filing color inherited from the source bay.
      const displayColor = displayItemColor(it);
      const base = ITEM_COLORS[displayColor]?.hex ?? 0x888888;
      _c.setHex(base);
      if (it.hazard) _c.lerp(_white, 0.25 + Math.sin(t * 8) * 0.15);
      else if (it.flashT > 0) _c.lerp(_white, it.flashT);
      mesh.instanceColor.setXYZ(i, _c.r, _c.g, _c.b);

      if (it.state === ITEM_STATE.FREE && it.grounded) {
        const j = marks.count++;
        const pulse = 0.75 + Math.sin(t * 3.4 + it.id) * 0.25;
        _q.identity();
        _m.compose(_v.set(it.x, 0.02, it.z), _q, _s.set(pulse, 1, pulse));
        marks.setMatrixAt(j, _m);
        _c.set(ITEM_COLORS[it.color]?.ui ?? '#fff').multiplyScalar(0.55 * pulse);
        marks.instanceColor.setXYZ(j, _c.r, _c.g, _c.b);
      }
    }

    for (const visual of this.visuals.values()) {
      visual.mesh.instanceMatrix.needsUpdate = true;
      visual.mesh.instanceColor.needsUpdate = true;
    }
    marks.instanceMatrix.needsUpdate = true;
    marks.instanceColor.needsUpdate = true;
  }

  /** Nearest free floor item to a point, optionally color-filtered. */
  nearestFree(x, z, radius, color = null) {
    let best = null, bestD = radius * radius;
    for (const it of this.items) {
      if (!it.active || it.state !== ITEM_STATE.FREE) continue;
      if (color && it.color !== color) continue;
      const d = (it.x - x) ** 2 + (it.z - z) ** 2;
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  forEachInRadius(x, z, radius, fn) {
    const r2 = radius * radius;
    for (const it of this.items) {
      if (!it.active) continue;
      const d = (it.x - x) ** 2 + (it.z - z) ** 2;
      if (d <= r2) fn(it, Math.sqrt(d));
    }
  }

  clearAll() {
    for (const it of this.items) if (it.active) this.release(it);
  }

  dispose() {
    for (const visual of this.visuals.values()) {
      this.scene.remove(visual.mesh);
      visual.mesh.dispose();
      visual.geo.dispose();
    }
    this.visuals.clear();
    this.scene.remove(this.marks);
    this.marks.dispose();
    this.markGeo.dispose(); this.markMat.dispose();
  }
}

const _e = new THREE.Euler();
const _white = new THREE.Color(1, 1, 1);
const _res = { x: 0, z: 0, hit: null };

export const LOOSE_ITEM_KINDS = Object.freeze({
  cemetery: ['book'],
  library: ['book'],
  videostore: ['vhs', 'popcorn'],
  recordstore: ['record'],
  grocery: ['can', 'cereal', 'apple', 'bottle', 'banana', 'mushroom', 'pepper', 'melon', 'egg', 'soda'],
});

export function looseItemKindsForTheme(theme) {
  return LOOSE_ITEM_KINDS[theme?.id] || ['book'];
}

export function resolveLooseItemKind(theme, hazard, itemId = 0) {
  if (hazard?.id && looseItemKindsForTheme(theme).includes(hazard.id)) return hazard.id;
  if (theme?.id === 'videostore') return hazard?.id === 'popcorn' ? 'popcorn' : 'vhs';
  if (theme?.id === 'recordstore') return 'record';
  if (theme?.id === 'grocery') {
    const everyday = ['can', 'cereal', 'apple', 'bottle'];
    return everyday[Math.abs(itemId) % everyday.length];
  }
  return 'book';
}

export function displayItemColor(item) {
  return item?.hazard?.color || item?.color || 'slate';
}

/** Build a top-down-readable silhouette for a branch item or grocery hazard. */
export function buildLooseItemGeometry(theme, kind = resolveLooseItemKind(theme, null, 0)) {
  const size = theme.itemSize;
  let geometry;
  switch (kind) {
    case 'vhs': geometry = buildLooseVhs(); break;
    case 'record': geometry = buildLooseRecord(); break;
    case 'popcorn': geometry = buildLoosePopcorn(); break;
    case 'can': geometry = buildLooseCan(); break;
    case 'cereal': geometry = buildLooseCereal(); break;
    case 'apple': geometry = buildLooseApple(); break;
    case 'bottle': geometry = buildLooseBottle(); break;
    case 'banana': geometry = buildLooseBanana(); break;
    case 'mushroom': geometry = buildLooseMushroom(); break;
    case 'pepper': geometry = buildLoosePepper(); break;
    case 'melon': geometry = buildLooseMelon(); break;
    case 'egg': geometry = buildLooseEggCarton(); break;
    case 'soda': geometry = buildLooseSoda(); break;
    default: geometry = buildLooseBook(size); break;
  }
  geometry.name = `loose-item-${kind}`;
  geometry.userData.itemKind = kind;
  return geometry;
}

/** Covers on the broad faces and a raised spine along one long edge. */
function buildLooseBook(size) {
  const w = Math.max(size.w * 3.2, 0.16);
  const th = Math.max(size.w * 1.1, 0.045);
  const h = size.h * 0.95;
  const g = new THREE.BoxGeometry(w, th, h);
  const uv = g.attributes.uv;
  const TILE = 1 / 12;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      let u = uv.getX(i), v = uv.getY(i);
      if (f === 2 || f === 3) {
        // Covers: one decorated spine tile stretched over the whole face.
        u = u * TILE + TILE * 3;
        v = v * 0.8;
      } else {
        u = u * TILE * 0.6 + TILE * 8;
        v = 0.89 + v * 0.09;
      }
      uv.setXY(i, u, v);
    }
  }
  uv.needsUpdate = true;

  // Raised spine along one long edge.
  const spine = box(w * 0.06, th * 1.08, h * 0.99, -w / 2, 0, 0);
  const merged = mergeParts([g, spine]);
  return merged;
}

function buildLooseVhs() {
  const parts = [
    box(0.24, 0.062, 0.36, 0, 0, 0, 0, 0, 0, 0.018),
    box(0.18, 0.018, 0.17, 0, 0.039, 0.035, 0, 0, 0, 0.012),
    cyl(0.052, 0.052, 0.014, 16, -0.064, 0.052, 0.03),
    cyl(0.052, 0.052, 0.014, 16, 0.064, 0.052, 0.03),
    box(0.026, 0.014, 0.22, 0, 0.051, -0.04, 0, 0, 0, 0.007),
  ];
  return mergeParts(parts);
}

function buildLooseRecord() {
  return mergeParts([
    box(0.36, 0.038, 0.36, -0.02, 0, 0, 0, 0, 0, 0.01),
    cyl(0.145, 0.145, 0.018, 28, 0.075, 0.03, 0),
    torus(0.145, 0.012, 6, 28, 0.075, 0.043, 0, Math.PI / 2),
    cyl(0.025, 0.025, 0.024, 12, 0.075, 0.045, 0),
  ]);
}

function buildLoosePopcorn() {
  const parts = [cyl(0.12, 0.085, 0.24, 10, 0, 0.12, 0)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(sphere(0.055, 8, 6, Math.cos(a) * 0.08, 0.27 + (i % 2) * 0.025, Math.sin(a) * 0.08));
  }
  return mergeParts(parts);
}

function buildLooseCan() {
  return mergeParts([
    cyl(0.095, 0.095, 0.24, 14, 0, 0.12, 0),
    torus(0.08, 0.012, 5, 14, 0, 0.244, 0, Math.PI / 2),
  ]);
}

function buildLooseCereal() {
  return mergeParts([
    box(0.22, 0.31, 0.105, 0, 0.155, 0, 0, 0, 0, 0.015),
    box(0.19, 0.045, 0.11, 0, 0.32, 0, 0, 0, 0, 0.012),
  ]);
}

function buildLooseApple() {
  const fruit = new THREE.SphereGeometry(0.14, 12, 9);
  fruit.scale(1, 0.9, 1);
  fruit.translate(0, 0.13, 0);
  return mergeParts([
    fruit,
    cyl(0.016, 0.022, 0.09, 7, 0, 0.285, 0, 0, 0, 0.18),
    box(0.09, 0.018, 0.045, 0.045, 0.29, 0, 0, 0.25, 0.25, 0.012),
  ]);
}

function buildLooseBottle() {
  return mergeParts([
    cyl(0.095, 0.105, 0.21, 12, 0, 0.105, 0),
    cyl(0.055, 0.085, 0.11, 12, 0, 0.265, 0),
    cyl(0.058, 0.058, 0.045, 12, 0, 0.343, 0),
  ]);
}

function buildLooseBanana() {
  const curve = new THREE.TorusGeometry(0.18, 0.048, 7, 20, Math.PI * 1.22);
  curve.rotateX(Math.PI / 2);
  curve.rotateY(-0.34);
  curve.translate(0, 0.065, -0.015);
  return mergeParts([
    curve,
    cyl(0.025, 0.035, 0.09, 7, -0.165, 0.065, -0.095, 0, 0, -0.55),
    cyl(0.018, 0.028, 0.08, 7, 0.165, 0.065, -0.095, 0, 0, 0.55),
  ]);
}

function buildLooseMushroom() {
  const cap = new THREE.SphereGeometry(0.17, 14, 9);
  cap.scale(1, 0.48, 1);
  cap.translate(0, 0.25, 0);
  return mergeParts([
    cyl(0.06, 0.085, 0.2, 10, 0, 0.1, 0),
    cap,
    sphere(0.028, 7, 5, -0.07, 0.29, 0.085),
    sphere(0.022, 7, 5, 0.065, 0.3, 0.1),
  ]);
}

function buildLoosePepper() {
  const body = new THREE.CylinderGeometry(0.025, 0.095, 0.29, 11);
  body.rotateZ(0.28);
  body.translate(0, 0.155, 0);
  return mergeParts([
    body,
    cyl(0.018, 0.032, 0.09, 7, -0.045, 0.34, 0, 0, 0, -0.35),
  ]);
}

function buildLooseMelon() {
  const melon = new THREE.SphereGeometry(0.18, 16, 10);
  melon.scale(1.25, 0.86, 1);
  melon.translate(0, 0.155, 0);
  return mergeParts([
    melon,
    torus(0.16, 0.012, 5, 20, 0, 0.165, 0, Math.PI / 2),
  ]);
}

function buildLooseEggCarton() {
  const parts = [
    box(0.4, 0.07, 0.22, 0, 0.055, 0, 0, 0, 0, 0.03),
    box(0.4, 0.035, 0.22, 0, 0.16, -0.07, -0.45, 0, 0, 0.025),
  ];
  for (let row = 0; row < 2; row++) for (let i = 0; i < 3; i++) {
    const egg = new THREE.SphereGeometry(0.06, 8, 6);
    egg.scale(0.82, 1.15, 0.82);
    egg.translate(-0.13 + i * 0.13, 0.135, -0.055 + row * 0.11);
    parts.push(egg);
  }
  return mergeParts(parts);
}

function buildLooseSoda() {
  return mergeParts([
    cyl(0.09, 0.09, 0.255, 16, 0, 0.128, 0),
    torus(0.078, 0.01, 5, 16, 0, 0.26, 0, Math.PI / 2),
    torus(0.078, 0.01, 5, 16, 0, 0.006, 0, Math.PI / 2),
    box(0.045, 0.012, 0.018, 0, 0.273, 0, 0, 0.15, 0, 0.006),
  ]);
}

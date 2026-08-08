import * as THREE from 'three';
import { ITEM_COLORS } from '../data/themes.js';
import { box, mergeParts, ensureColorAttr } from '../world/props.js';
import { bayHeadroom } from '../world/generator.js';
import * as TX from '../render/textures.js';

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

    this.items = [];
    for (let i = 0; i < MAX_ITEMS; i++) {
      this.items.push({
        id: i, active: false, state: ITEM_STATE.DEAD,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        rx: 0, ry: 0, rz: 0, spin: 0,
        color: 'crimson', hazard: null,
        holder: null, targetBay: null, age: 0, grounded: false,
        scale: 1, homeBay: null, flashT: 0,
      });
    }
    this.freeList = this.items.map((it) => it.id).reverse();

    const s = theme.itemSize;
    const geo = buildLooseItemGeometry(s);
    this.mesh = new THREE.InstancedMesh(geo, mats.item, MAX_ITEMS);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ITEMS * 3).fill(1), 3);
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.geo = geo;

    // Ground markers so a book on a dark floor is still findable.
    const markGeo = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);
    ensureColorAttr(markGeo);
    this.markMat = new THREE.MeshBasicMaterial({
      map: TX.radialAlpha({ power: 2.2 }),
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true, toneMapped: false,
      opacity: 0.9,
    });
    this.marks = new THREE.InstancedMesh(markGeo, this.markMat, MAX_ITEMS);
    this.marks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ITEMS * 3).fill(1), 3);
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
    it.rx = Math.random() * 6.28; it.ry = Math.random() * 6.28; it.rz = Math.random() * 6.28;
    it.spin = (Math.random() - 0.5) * 9;
    it.color = color;
    it.hazard = opts.hazard ?? null;
    it.holder = null;
    it.targetBay = null;
    it.homeBay = opts.homeBay ?? null;
    it.age = 0;
    it.grounded = false;
    it.scale = opts.scale ?? 1;
    it.flashT = 0.6;
    return it;
  }

  release(it) {
    if (!it.active) return;
    it.active = false;
    it.state = ITEM_STATE.DEAD;
    it.holder = null;
    it.targetBay = null;
    this.freeList.push(it.id);
  }

  /** Knock `count` items off a bay, popping them into the aisle. */
  knockOff(bay, count, opts = {}) {
    const out = [];
    const run = bay.run;
    for (let i = 0; i < count; i++) {
      if (bay.filled <= 0) break;
      if (!this.freeList.length) break;   // pool exhausted; leave it on the shelf
      bay.filled--;
      const h = 0.4 + Math.random() * (run.height - 0.7);
      const spread = (Math.random() - 0.5) * 0.8;
      const px = bay.wx + bay.nx * 0.15 + -bay.nz * spread;
      const pz = bay.wz + bay.nz * 0.15 + bay.nx * spread;
      const force = opts.force ?? 1;
      const it = this.spawn(px, h, pz, bay.color, {
        vx: bay.nx * (1.4 + Math.random() * 2.2) * force + (Math.random() - 0.5) * force,
        vy: 1.2 + Math.random() * 2.4 * force,
        vz: bay.nz * (1.4 + Math.random() * 2.2) * force + (Math.random() - 0.5) * force,
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
            const rest = this.theme.itemSize.w * 0.6;
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
                it.rx = 0; it.rz = 0; it.ry = Math.random() * 6.28;
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
          const dx = tx - it.x, dy = ty - it.y, dz = tz - it.z;
          const d = Math.hypot(dx, dy, dz) || 1e-4;
          const speed = 9 + it.age * 22;
          it.x += (dx / d) * Math.min(speed * dt, d);
          it.y += (dy / d) * Math.min(speed * dt, d);
          it.z += (dz / d) * Math.min(speed * dt, d);
          it.rx += 12 * dt; it.ry += 16 * dt;
          if (d < 0.35) {
            if (bay.filled < bayHeadroom(bay)) bay.filled++;
            this.onShelved?.(it, bay);
            this.release(it);
          }
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
  returnTo(it, bay) {
    it.state = ITEM_STATE.RETURNING;
    it.targetBay = bay;
    it.age = 0;
    it.holder = null;
  }

  render(camera) {
    const mesh = this.mesh;
    const marks = this.marks;
    mesh.count = 0;
    marks.count = 0;
    const t = this.time;

    for (const it of this.items) {
      if (!it.active) continue;
      const i = mesh.count++;
      _q.setFromEuler(_e.set(it.rx, it.ry, it.rz));
      const bob = it.state === ITEM_STATE.FREE && it.grounded ? 0 : 0;
      const sc = it.scale * (it.flashT > 0 ? 1 + it.flashT * 0.5 : 1);
      _m.compose(_v.set(it.x, it.y + bob, it.z), _q, _s.set(sc, sc, sc));
      mesh.setMatrixAt(i, _m);

      const base = ITEM_COLORS[it.color]?.hex ?? 0x888888;
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

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    marks.instanceMatrix.needsUpdate = true;
    marks.instanceColor.needsUpdate = true;
  }

  /** Nearest free floor item to a point, optionally colour-filtered. */
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
    this.scene.remove(this.mesh, this.marks);
    this.mesh.dispose(); this.marks.dispose();
    this.geo.dispose(); this.markGeo.dispose(); this.markMat.dispose();
  }
}

const _e = new THREE.Euler();
const _white = new THREE.Color(1, 1, 1);
const _res = { x: 0, z: 0, hit: null };

/**
 * A single volume: covers on the broad faces (mapped into the decorated spine
 * region of the shared texture) and cut paper on the edges.
 */
function buildLooseItemGeometry(size) {
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

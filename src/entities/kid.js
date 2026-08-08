import * as THREE from 'three';
import { CrowdBatch } from './character.js';
import { ITEM_STATE } from '../systems/items.js';
import { queryBays } from '../world/generator.js';
import { angleLerp } from './player.js';
import { ITEM_COLORS } from '../data/themes.js';

const STATE = {
  SEEK: 0,     // heading for a shelf to ransack
  RANSACK: 1,  // pulling things off it
  CARRY: 2,    // running away with the loot
  DUMP: 3,     // dropping it somewhere inconvenient
  FLEE: 4,     // you got too close
  LEAVE: 5,    // calmed; heading for the exit
  IDLE: 6,
};

// Spawns are always inside this ring around the player — far enough to feel
// like they wandered in, close enough that you can always reach the mess.
const SPAWN_MIN = 11;
const SPAWN_MAX = 26;
const DESPAWN = 52;

export const KID_TYPES = {
  curious: {
    id: 'curious', name: 'Curious Reader', speed: 2.5, grab: 1, weight: 40,
    height: 1.12, shirt: [0x4d86c6, 0x63b06a, 0xd4a03a], hp: 1, dumpRange: [3, 6],
  },
  chatty: {
    id: 'chatty', name: 'Chatty Pair', speed: 2.8, grab: 2, weight: 26,
    height: 1.2, shirt: [0xc65c5c, 0x9a5cc6, 0x4dbfb3], hp: 1, dumpRange: [4, 8], pair: true,
  },
  sprinter: {
    id: 'sprinter', name: 'Hide-and-Seeker', speed: 4.4, grab: 1, weight: 18,
    height: 1.08, shirt: [0xe07a2b, 0x2bb3e0, 0xe0d02b], hp: 1, dumpRange: [6, 11],
  },
  hoarder: {
    id: 'hoarder', name: 'Snack Smuggler', speed: 2.2, grab: 4, weight: 12,
    height: 1.28, shirt: [0x7a6b3a, 0x6b4a7a, 0x3a6b5a], hp: 2, dumpRange: [3, 7], messy: true,
  },
  toddler: {
    id: 'toddler', name: 'Tornado Toddler', speed: 3.4, grab: 3, weight: 10,
    height: 0.92, shirt: [0xff9ec4, 0xa0e86a, 0xffd76a], hp: 1, dumpRange: [2, 5], chaotic: true,
  },
};

const TYPE_LIST = Object.values(KID_TYPES);
const HAIR_STYLES = ['short', 'spiky', 'pigtails', 'long', 'bald'];

let _idSeq = 0;

class Kid {
  constructor(mgr) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.id = _idSeq++;
    this.active = false;
  }

  spawn(x, z, type, rng) {
    this.active = true;
    this.type = type;
    this.x = x; this.z = z;
    this.vx = 0; this.vz = 0;
    this.yaw = rng.range(0, Math.PI * 2);
    this.state = STATE.SEEK;
    this.stateT = 0;
    this.phase = rng.range(0, 6.28);
    this.speedMul = rng.range(0.9, 1.12);
    this.heldItem = null;
    this.targetBay = null;
    this.dumpTarget = null;
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.grabsLeft = type.grab;
    this.startleCount = 0;
    this.startleT = 0;
    this.radius = 0.28 * (type.height / 1.15);
    this.laughTimer = rng.range(2, 8);
    this.browseTime = rng.range(2.5, 5.5);
    this.hairIndex = rng.int(0, HAIR_STYLES.length - 1);
    this.colors = {
      skin: rng.pick([0xf0c39a, 0xe0a878, 0xc78a5c, 0x8d5a38, 0x6b402a]),
      shirt: rng.pick(type.shirt),
      pants: rng.pick([0x39415a, 0x5a3949, 0x2f4a3a, 0x6a5a3a]),
      hair: rng.pick([0x2a1a10, 0x5a3418, 0x8a5a28, 0xc09040, 0x1a1a1a, 0xa03a20]),
      eye: 0x14161c,
      shoe: rng.pick([0xd0d0d0, 0x22232a, 0xd04a3a]),
    };
    this.batchIndex = type.height > 1.22 ? 1 : 0;
    this.anim = { phase: 0, speed: 0, lean: 0, armMode: 'swing', headYaw: 0, headPitch: 0, flail: 0, crouch: 0, hurt: 0, celebrate: 0 };
    this.bumpCooldown = 0;
  }

  get height() { return this.type.height; }

  startle(duration = 2) {
    this.state = STATE.FLEE;
    this.stateT = 0;
    this.fleeT = duration;
    this.path = null;
    this.startleCount++;
    this.game.audio.play('laugh', {
      pan: this.game._panFor(this.x, this.z),
      rate: 1.15 + Math.random() * 0.3, volume: 0.35,
    });
    if (this.startleCount >= 3 && !this.heldItem) this._calm();
  }

  _calm() {
    this.state = STATE.LEAVE;
    this.stateT = 0;
    this.path = null;
    this.game.run.kidsCalmed++;
    this.game.progression.addXP(28);
    this.game.fx.burst(this.x, this.height * 0.9, this.z, 16, { speed: 2.4, color: [0xbfe6ff, 0xffffff], life: 0.8, size: 0.16, grav: -1 });
    this.game.hud.popup(this.x, this.height + 0.5, this.z, 'calmed +28', '#8fd4ff');
  }

  surrenderItem() {
    const it = this.heldItem;
    if (!it) return null;
    this.heldItem = null;
    it.holder = null;
    return it;
  }

  dropItem() {
    const it = this.surrenderItem();
    if (!it) return;
    it.state = ITEM_STATE.FREE;
    it.grounded = false;
    it.y = this.height * 0.9;
    it.vx = (Math.random() - 0.5) * 3;
    it.vy = 1.6 + Math.random() * 1.6;
    it.vz = (Math.random() - 0.5) * 3;
    this.game.audio.play('laugh', { pan: this.game._panFor(this.x, this.z), volume: 0.4 });
  }

  update(dt, rng) {
    const g = this.game;
    const p = g.player;
    this.stateT += dt;
    this.repathTimer -= dt;
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);

    const dxP = p.x - this.x, dzP = p.z - this.z;
    const distP = Math.hypot(dxP, dzP);

    // The player's presence is genuinely scary if you're holding contraband.
    const repel = this.mgr.repelRadius + (this.heldItem ? 0.8 : 0);
    if (distP < repel && this.state !== STATE.FLEE && this.state !== STATE.LEAVE) {
      this.startle(1.6);
    }

    // Despawn if the run has carried us far away.
    if (distP > DESPAWN) { this.mgr.despawn(this); return; }

    let targetX = this.x, targetZ = this.z;
    let desiredSpeed = 0;

    switch (this.state) {
      case STATE.SEEK: {
        if (!this.targetBay || this.targetBay.filled <= 0) this._pickBay(rng);
        if (!this.targetBay) { this.state = STATE.IDLE; this.stateT = 0; break; }
        const b = this.targetBay;
        const tx = b.wx + b.nx * 0.9, tz = b.wz + b.nz * 0.9;
        const d = Math.hypot(tx - this.x, tz - this.z);
        if (d < 1.0) {
          this.state = STATE.RANSACK;
          this.stateT = 0;
          this.path = null;
        } else {
          this._follow(dt, tx, tz);
          targetX = this._steerX; targetZ = this._steerZ;
          desiredSpeed = this.type.speed * this.speedMul;
        }
        break;
      }

      case STATE.RANSACK: {
        this.anim.armMode = 'reach';
        const b = this.targetBay;
        if (!b || b.filled <= 0) { this.targetBay = null; this.state = STATE.SEEK; break; }
        // Face the shelf while working.
        this.yaw = angleLerp(this.yaw, Math.atan2(b.wx - this.x, b.wz - this.z), 1 - Math.exp(-dt * 8));
        if (this.stateT > 0.55) {
          const pull = Math.min(this.type.chaotic ? rng.int(2, 4) : rng.int(1, 2), b.filled);
          const dropped = g.items.knockOff(b, pull, { hazard: this.mgr.rollHazard(rng) });
          g.level.refreshBay(b);
          g.audio.play('bookfall', { pan: g._panFor(this.x, this.z), volume: 0.7 });
          g.camera.addTrauma(Math.min(0.1, 0.02 * pull));

          // Sometimes they run off with one — that's the chase, and it's the
          // main source of books stranded far from a matching shelf, so it
          // stays a minority of raids until late in the shift.
          if (dropped.length && rng.bool(0.3 + g.run.elapsed / 60 * 0.011)) {
            const it = dropped[dropped.length - 1];
            it.state = ITEM_STATE.KID;
            it.holder = this;
            it.grounded = false;
            this.heldItem = it;
            this.state = STATE.CARRY;
            const range = this.type.dumpRange;
            this.dumpTarget = this.mgr.findDumpSpot(this.x, this.z, rng.range(range[0], range[1]), rng);
          } else {
            this.state = STATE.SEEK;
            this.targetBay = null;
          }
          this.grabsLeft--;
          this.stateT = 0;
          this.browseTime = rng.range(2.5, 5.5);
          if (this.grabsLeft <= 0 && !this.heldItem) { this.state = STATE.LEAVE; this.path = null; }
          else if (this.state === STATE.SEEK) { this.state = STATE.IDLE; }
        }
        break;
      }

      case STATE.CARRY: {
        this.anim.armMode = 'overhead';
        if (!this.heldItem) { this.state = STATE.SEEK; this.targetBay = null; break; }
        if (!this.dumpTarget) this.dumpTarget = this.mgr.findDumpSpot(this.x, this.z, 8, rng);
        const d = Math.hypot(this.dumpTarget.x - this.x, this.dumpTarget.z - this.z);
        if (d < 1.0 || this.stateT > 14) {
          this.dropItem();
          // A visit is worth a fixed number of grabs; once they're spent the
          // kid wanders off. Without this they ransack the building forever.
          this.state = this.grabsLeft > 0 ? STATE.IDLE : STATE.LEAVE;
          this.targetBay = null;
          this.path = null;
          this.stateT = 0;
        } else {
          this._follow(dt, this.dumpTarget.x, this.dumpTarget.z);
          targetX = this._steerX; targetZ = this._steerZ;
          desiredSpeed = this.type.speed * this.speedMul * 1.12;
        }
        break;
      }

      case STATE.FLEE: {
        this.fleeT -= dt;
        this.anim.armMode = this.heldItem ? 'overhead' : 'panic';
        const away = Math.atan2(this.x - p.x, this.z - p.z);
        targetX = this.x + Math.sin(away) * 4;
        targetZ = this.z + Math.cos(away) * 4;
        this._steerX = targetX; this._steerZ = targetZ;
        desiredSpeed = this.type.speed * this.speedMul * 1.5;
        if (this.fleeT <= 0) {
          this.state = this.heldItem ? STATE.CARRY : STATE.SEEK;
          this.stateT = 0;
          this.path = null;
        }
        break;
      }

      case STATE.LEAVE: {
        this.anim.armMode = 'swing';
        if (!this.leaveTarget) {
          const a = Math.atan2(this.x - p.x, this.z - p.z) + (rng.next() - 0.5);
          this.leaveTarget = { x: this.x + Math.sin(a) * 40, z: this.z + Math.cos(a) * 40 };
        }
        this._follow(dt, this.leaveTarget.x, this.leaveTarget.z);
        targetX = this._steerX; targetZ = this._steerZ;
        desiredSpeed = this.type.speed * this.speedMul * 1.25;
        if (distP > 34) { this.mgr.despawn(this); return; }
        break;
      }

      case STATE.IDLE: {
        // Browsing beat between raids — this is what keeps the mess at a rate
        // a librarian can actually chase.
        this.anim.armMode = 'swing';
        this.anim.headYaw = Math.sin(this.stateT * 1.6) * 0.5;
        if (this.stateT > this.browseTime) { this.state = STATE.SEEK; this.stateT = 0; }
        break;
      }

      default: {
        this.anim.armMode = 'swing';
        if (this.stateT > 1.2) { this.state = STATE.SEEK; this.stateT = 0; }
        break;
      }
    }

    // --- movement
    if (this.mgr.auraSlow && distP < 6) desiredSpeed *= 1 - this.mgr.auraSlow;
    if (g.run.slowField) desiredSpeed *= g.run.slowField;

    if (desiredSpeed > 0) {
      const dx = this._steerX - this.x, dz = this._steerZ - this.z;
      const len = Math.hypot(dx, dz) || 1;
      const tvx = (dx / len) * desiredSpeed;
      const tvz = (dz / len) * desiredSpeed;
      this.vx += (tvx - this.vx) * (1 - Math.exp(-dt * 9));
      this.vz += (tvz - this.vz) * (1 - Math.exp(-dt * 9));
    } else {
      this.vx *= Math.exp(-dt * 6);
      this.vz *= Math.exp(-dt * 6);
    }

    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    g.collision.resolve(nx, nz, this.radius, _res);
    if (Math.abs(_res.x - nx) > 1e-4) this.vx *= -0.15;
    if (Math.abs(_res.z - nz) > 1e-4) this.vz *= -0.15;
    this.x = _res.x; this.z = _res.z;

    const spd = Math.hypot(this.vx, this.vz);
    if (spd > 0.4 && this.state !== STATE.RANSACK) {
      this.yaw = angleLerp(this.yaw, Math.atan2(this.vx, this.vz), 1 - Math.exp(-dt * 11));
    }

    // --- bump damage. Health is attrition pressure, not the fail state — the
    // chaos meter is what you actually lose to, so bumps stay survivable.
    const canBump = this.state !== STATE.FLEE && this.state !== STATE.LEAVE;
    if (canBump && distP < this.radius + p.radius + 0.15 && this.bumpCooldown <= 0) {
      this.bumpCooldown = 2.2;
      if (p.damage(this.type.chaotic ? 5 : 3, 'kid')) {
        g.audio.play('thud', { pan: g._panFor(this.x, this.z), volume: 0.6 });
        const a = Math.atan2(p.x - this.x, p.z - this.z);
        p.vx += Math.sin(a) * 5;
        p.vz += Math.cos(a) * 5;
      }
    }

    // --- animation
    this.phase += spd * dt * (2.9 / this.type.height);
    this.anim.phase = this.phase;
    this.anim.speed = spd;
    this.anim.lean = Math.min(1, spd / 4);
    this.anim.reach = this.state === STATE.RANSACK ? 1 : 0;
    if (this.state === STATE.RANSACK) this.anim.armMode = 'reach';

    // --- cackling
    this.laughTimer -= dt;
    if (this.laughTimer <= 0) {
      this.laughTimer = 6 + Math.random() * 12;
      if (distP < 22 && (this.state === STATE.CARRY || this.state === STATE.FLEE)) {
        g.audio.play('laugh', { pan: g._panFor(this.x, this.z), volume: 0.25, rate: 1 + Math.random() * 0.4 });
      }
    }

    // --- held item rides overhead, easy to spot and easy to snatch
    if (this.heldItem) {
      const it = this.heldItem;
      it.x = this.x;
      it.y = this.height * 1.28 + Math.sin(this.phase * 2) * 0.05;
      it.z = this.z;
      it.rx = 0.2;
      it.ry = this.yaw + Math.sin(this.phase) * 0.2;
      it.rz = Math.sin(this.phase * 2) * 0.15;
    }
  }

  _pickBay(rng) {
    const g = this.game;
    // Only ransack shelves near the player, so the mess is always reachable.
    const bays = queryBays(g.layout, g.player.x, g.player.z, this.mgr.ransackRadius);
    if (!bays.length) { this.targetBay = null; return; }
    for (let i = 0; i < 8; i++) {
      const b = bays[rng.int(0, bays.length - 1)];
      if (b.filled <= 0) continue;
      const d = Math.hypot(b.wx - this.x, b.wz - this.z);
      if (d > 34) continue;
      this.targetBay = b;
      this.path = null;
      return;
    }
    this.targetBay = null;
  }

  _follow(dt, tx, tz) {
    const g = this.game;
    // Straight line whenever we can see the target; only pay for A* otherwise.
    if (g.collision.lineOfSight(this.x, this.z, tx, tz, 0.8)) {
      this._steerX = tx; this._steerZ = tz;
      this.path = null;
      return;
    }
    if ((!this.path || this.repathTimer <= 0) && this.mgr.pathBudget > 0) {
      this.mgr.pathBudget--;
      this.repathTimer = 0.7 + Math.random() * 0.6;
      this.path = g.pathfinder.find(this.x, this.z, tx, tz);
      this.pathIndex = 0;
    }
    if (this.path && this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      if (Math.hypot(wp.x - this.x, wp.z - this.z) < 0.9) this.pathIndex++;
      const next = this.path[Math.min(this.pathIndex, this.path.length - 1)];
      this._steerX = next.x; this._steerZ = next.z;
    } else {
      this._steerX = tx; this._steerZ = tz;
    }
  }
}

const _res = { x: 0, z: 0, hit: null };

/** Spawns, updates and draws the crowd. */
export class KidManager {
  constructor(game) {
    this.game = game;
    this.rng = game.rng.fork(1337);
    this.pool = [];
    this.active = [];
    this.maxKids = 6;
    this.spawnTimer = 3;
    this.spawnInterval = 7;
    this.repelRadius = 1.8;
    this.auraSlow = 0;
    this.ransackRadius = 24;
    this.pathBudget = 0;

    // Two batches: little kids and bigger kids, so silhouettes differ.
    this.batches = [
      new CrowdBatch(game.render.scene, game.mats, { height: 1.1, capacity: 40, hairStyles: HAIR_STYLES }),
      new CrowdBatch(game.render.scene, game.mats, { height: 1.3, capacity: 24, hairStyles: HAIR_STYLES }),
    ];

    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      game.mats.shadowBlob,
      64,
    );
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 1;
    game.render.scene.add(this.shadows);
  }

  get count() { return this.active.length; }

  rollHazard(rng) {
    const hazards = this.game.theme.hazards;
    if (!hazards?.length) return null;
    for (const h of hazards) if (rng.bool(h.chance)) return h;
    return null;
  }

  findDumpSpot(x, z, distance, rng) {
    for (let i = 0; i < 10; i++) {
      const a = rng.range(0, Math.PI * 2);
      const tx = x + Math.cos(a) * distance;
      const tz = z + Math.sin(a) * distance;
      if (!this.game.collision.isBlocked(tx, tz)) return { x: tx, z: tz };
    }
    return { x, z };
  }

  spawnOne(typeOverride = null) {
    if (this.active.length >= this.maxKids) return null;
    const g = this.game;
    const rng = this.rng;
    const p = g.player;

    let sx = 0, sz = 0, ok = false;
    for (let i = 0; i < 24; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(SPAWN_MIN, SPAWN_MAX);
      sx = p.x + Math.cos(a) * d;
      sz = p.z + Math.sin(a) * d;
      if (sx < 4 || sz < 4 || sx > g.layout.width - 4 || sz > g.layout.depth - 4) continue;
      if (g.collision.isBlocked(sx, sz)) continue;
      // Prefer somewhere the player can't currently see, so they "arrive".
      if (i < 14 && g.collision.lineOfSight(p.x, p.z, sx, sz, 1.2)) continue;
      ok = true;
      break;
    }
    if (!ok) return null;

    const type = typeOverride || rng.weighted(
      TYPE_LIST.filter((t) => this._typeUnlocked(t)).map((t) => ({ w: t.weight, v: t })),
    ).v;

    let kid = this.pool.pop();
    if (!kid) kid = new Kid(this);
    kid.spawn(sx, sz, type, rng);
    this.active.push(kid);
    g.events.emit('kidSpawn', { kid });
    return kid;
  }

  _typeUnlocked(t) {
    const m = this.game.run.elapsed / 60;
    if (t.id === 'chatty') return m >= 1.5;
    if (t.id === 'sprinter') return m >= 4;
    if (t.id === 'hoarder') return m >= 7;
    if (t.id === 'toddler') return m >= 10;
    return true;
  }

  despawn(kid) {
    if (kid.heldItem) kid.dropItem();
    kid.active = false;
    const i = this.active.indexOf(kid);
    if (i >= 0) this.active.splice(i, 1);
    this.pool.push(kid);
  }

  clear() {
    while (this.active.length) this.despawn(this.active[0]);
  }

  update(dt) {
    // A small per-frame path budget keeps A* off the frame-time critical path.
    this.pathBudget = 3;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const k = this.active[i];
      k.update(dt, this.rng);
    }

    this._render();
  }

  _render() {
    for (const b of this.batches) b.begin();
    let sc = 0;
    const _m = _tmpM, _q = _tmpQ, _v = _tmpV, _s = _tmpS;
    for (const k of this.active) {
      const batch = this.batches[k.batchIndex] || this.batches[0];
      batch.push(k.x, 0, k.z, k.yaw, k.anim, k.colors, k.type.height / (k.batchIndex ? 1.3 : 1.1), k.hairIndex);
      if (sc < 64) {
        _q.identity();
        const s = 0.9 * k.type.height;
        _m.compose(_v.set(k.x, 0.012, k.z), _q, _s.set(s, 1, s));
        this.shadows.setMatrixAt(sc++, _m);
      }
    }
    for (const b of this.batches) b.end();
    this.shadows.count = sc;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const b of this.batches) b.dispose();
    this.game.render.scene.remove(this.shadows);
    this.shadows.geometry.dispose();
    this.shadows.dispose();
  }
}

const _tmpM = new THREE.Matrix4();
const _tmpQ = new THREE.Quaternion();
const _tmpV = new THREE.Vector3();
const _tmpS = new THREE.Vector3();

export { STATE as KID_STATE };

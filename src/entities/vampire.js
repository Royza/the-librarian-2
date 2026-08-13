import { CrowdBatch } from './character.js';

const _resolved = { x: 0, z: 0, hit: null };

export const MASTER_VAMPIRE_TYPE = Object.freeze({
  id: 'masterVampire', name: 'Master Vampire', icon: '🧛', color: 0x9f2638,
});

export function pointInMeleeArc(originX, originZ, yaw, targetX, targetZ, range, arc) {
  const dx = targetX - originX;
  const dz = targetZ - originZ;
  const distance = Math.hypot(dx, dz);
  if (distance > range || distance < 0.001) return distance <= range;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const dot = (dx * fx + dz * fz) / distance;
  return dot >= Math.cos(arc / 2);
}

export class VampireManager {
  constructor(game) {
    this.game = game;
    this.rng = game.rng.fork(606);
    this.active = [];
    this.maxKids = 5; // compatibility with generic telemetry/debug consumers
    this.spawnInterval = 8;
    this.ransackRadius = 0;
    this.batch = new CrowdBatch(game.render.scene, game.mats, {
      height: 1.76, chunk: 0.97, capacity: 40,
      style: { hair: 'short', sleeves: 'long', eyeDetail: true },
      hairStyles: ['short', 'messy', 'long'],
    });
  }

  get count() { return this.active.length; }
  get activityPressure() {
    return this.active.reduce((sum, vampire) => sum + (vampire.rising > 0 ? 0.35 : vampire.master ? 2 : vampire.elite ? 1.25 : 0.85), 0);
  }

  spawnOne(options = {}) {
    if (this.active.length >= this.maxKids && !options.master) return null;
    const p = this.game.player;
    const candidates = (this.game.layout.vampireSpawns || []).filter((s) => {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      return d > 10 && d < 58;
    });
    const spawn = this.rng.pick(candidates.length ? candidates : this.game.layout.vampireSpawns);
    if (!spawn) return null;
    const master = !!options.master;
    const elite = master || options.elite || this.rng.bool(Math.min(0.3, 0.08 + this.game.run.elapsed / 1800));
    const vampire = {
      x: spawn.x + this.rng.range(-0.6, 0.6), z: spawn.z + this.rng.range(-0.6, 0.6),
      vx: 0, vz: 0, yaw: this.rng.range(0, Math.PI * 2), phase: this.rng.range(0, 20),
      hp: master ? 260 : elite ? this.rng.range(72, 90) : this.rng.range(42, 58),
      maxHp: 0, speed: master ? 3.85 : elite ? this.rng.range(3.2, 3.7) : this.rng.range(2.5, 3.15),
      damage: master ? 16 : elite ? 13 : 8, attackTimer: this.rng.range(0.4, 1.0),
      hurt: 0, rising: master ? 1.8 : 1.15, elite, master, hair: this.rng.int(0, 2),
      type: master ? MASTER_VAMPIRE_TYPE : null,
      path: null, pathIndex: 0, stuckTime: 0, repathTimer: this.rng.range(0.4, 0.9),
      colors: this._colors(elite), alive: true,
    };
    vampire.maxHp = vampire.hp;
    this.active.push(vampire);
    this.game.fx?.ring?.(vampire.x, 0.04, vampire.z, { r0: 0.2, r1: 2.2, dur: 0.75, color: 0x6b93ad });
    this.game.events?.emit?.('vampireSpawn', { vampire });
    if (master) this.game.events?.emit?.('bossSpawn', { type: MASTER_VAMPIRE_TYPE, vampire });
    return vampire;
  }

  spawnMaster() {
    if (this.active.some((v) => v.master)) return null;
    return this.spawnOne({ master: true });
  }

  _colors(elite) {
    const shirts = elite ? [0x571d27, 0x33213f] : [0x252b34, 0x34302d, 0x293529, 0x3b2630];
    return {
      skin: this.rng.pick([0xd0c7bf, 0xb9b5b2, 0xd7cec7]),
      shirt: this.rng.pick(shirts), pants: this.rng.pick([0x171a20, 0x24252a, 0x202832]),
      hair: this.rng.pick([0x171310, 0x3b291d, 0x59402c]), eye: elite ? 0xff3548 : 0xe9e5dc,
      shoe: 0x151515,
    };
  }

  update(dt) {
    const p = this.game.player;
    this.batch.begin();
    for (let i = this.active.length - 1; i >= 0; i--) {
      const v = this.active[i];
      v.attackTimer -= dt;
      v.hurt = Math.max(0, v.hurt - dt * 5);
      v.rising = Math.max(0, v.rising - dt);
      v.repathTimer -= dt;
      if (v.path && v.pathIndex < v.path.length) {
        const waypoint = v.path[v.pathIndex];
        if (Math.hypot(waypoint.x - v.x, waypoint.z - v.z) < 0.8) v.pathIndex++;
        // Finish the simplified route before returning to direct pursuit.
        // Clearing it merely because the nav-cell ray looks open can strand a
        // circle agent on the same monument corner and churn new A* searches.
        if (v.pathIndex >= v.path.length) v.path = null;
      }
      const waypoint = v.path?.[v.pathIndex];
      const targetX = waypoint?.x ?? p.x, targetZ = waypoint?.z ?? p.z;
      const dx = targetX - v.x, dz = targetZ - v.z;
      const dist = Math.hypot(dx, dz) || 1;
      const playerDist = Math.hypot(p.x - v.x, p.z - v.z);
      let move = 0;
      if (v.rising <= 0 && playerDist > 1.2) {
        move = v.speed;
        v.vx += (dx / dist * move - v.vx) * (1 - Math.exp(-dt * 8));
        v.vz += (dz / dist * move - v.vz) * (1 - Math.exp(-dt * 8));
        const oldX = v.x, oldZ = v.z;
        this.game.collision.resolve(v.x + v.vx * dt, v.z + v.vz * dt, v.master ? 0.4 : 0.34, _resolved);
        v.x = _resolved.x; v.z = _resolved.z;
        v.yaw = Math.atan2(dx, dz);
        const moved = Math.hypot(v.x - oldX, v.z - oldZ);
        v.stuckTime = moved < v.speed * dt * 0.22 ? v.stuckTime + dt : Math.max(0, v.stuckTime - dt * 2);
        if (v.stuckTime > 0.32 && v.repathTimer <= 0) {
          v.path = this.game.pathfinder.find(v.x, v.z, p.x, p.z, 1800);
          v.pathIndex = v.path?.length > 1 ? 1 : 0;
          v.repathTimer = this.rng.range(1.5, 2.4);
          v.stuckTime = 0;
        }
      } else {
        v.vx *= Math.exp(-dt * 10); v.vz *= Math.exp(-dt * 10);
      }
      if (v.rising <= 0 && playerDist < 1.45 && v.attackTimer <= 0) {
        v.attackTimer = v.master ? 0.95 : v.elite ? 1.15 : 1.45;
        p.damage(v.damage * (p.stats.vampireMitigation ?? 1), 'vampire');
        this.game.audio?.play?.('thud', { volume: 0.55, rate: v.elite ? 0.8 : 1 });
      }
      v.phase += move * dt * 2.1;
      const y = -Math.min(1.25, v.rising * 1.1);
      this.batch.push(v.x, y, v.z, v.yaw, {
        phase: v.phase, speed: move, lean: Math.min(0.45, move / 8), armMode: playerDist < 1.8 ? 'reach' : 'swing',
        headYaw: 0, headPitch: 0, flail: 0, crouch: v.rising > 0 ? 0.45 : 0,
        hurt: v.hurt, celebrate: 0,
      }, v.colors, v.master ? 1.2 : v.elite ? 1.08 : 1, v.hair);
    }
    this.batch.end();
  }

  strike({ x, z, yaw, range, arc, damage, knockback = 0, criticalChance = 0 }) {
    let hits = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const v = this.active[i];
      if (v.rising > 0.72 || !pointInMeleeArc(x, z, yaw, v.x, v.z, range + 0.5, arc)) continue;
      const critical = this.rng.next() < criticalChance;
      const dealt = damage * (critical ? 2 : 1);
      v.hp -= dealt;
      v.hurt = 1;
      const dx = v.x - x, dz = v.z - z, len = Math.hypot(dx, dz) || 1;
      v.x += dx / len * knockback; v.z += dz / len * knockback;
      this.game.fx?.burst?.(v.x, 1.0, v.z, 12, { speed: 3.5, color: critical ? [0xffffff, 0xffd37c] : [0xdce9ff, 0x758da8], life: 0.55, size: 0.12, grav: -2 });
      this.game.hud?.popup?.(v.x, 2, v.z, critical ? `CRITICAL ${Math.round(dealt)}` : `-${Math.round(dealt)}`, critical ? '#ffd77a' : '#d8e7ff');
      hits++;
      if (v.hp <= 0) this._slay(i, v);
    }
    return hits;
  }

  _slay(index, vampire) {
    this.active.splice(index, 1);
    this.game.run.vampiresSlain++;
    this.game.run.kidsCalmed = this.game.run.vampiresSlain; // legacy score/telemetry alias
    this.game.run.combo++;
    this.game.run.comboTimer = 3.2;
    this.game.run.bestCombo = Math.max(this.game.run.bestCombo, this.game.run.combo);
    this.game.run.chaos = Math.max(0, this.game.run.chaos - (vampire.master ? 15 : vampire.elite ? 6 : 4));
    this.game.progression.addXP(vampire.master ? 260 : vampire.elite ? 75 : 42);
    if (vampire.master) this.game.run.supernaturalEventsResolved++;
    this.game.fx?.burst?.(vampire.x, 1.0, vampire.z, vampire.master ? 60 : vampire.elite ? 38 : 26, { speed: 5, color: [0x737b85, 0xc2cad2, 0x34383e], life: 1.0, size: 0.2, grav: -1.5 });
    this.game.audio?.play?.('vampireDust', { volume: vampire.master ? 0.85 : 0.5, rate: vampire.elite ? 0.72 : 1.15 });
    if (vampire.master) this.game.hud?.banner?.('MASTER VAMPIRE DUSTED', '+260 XP · Hellmouth Activity sharply reduced', { ms: 3200 });
    this.game.events?.emit?.('vampireSlain', { vampire });
  }

  dispose() {
    this.active.length = 0;
    this.batch.dispose();
  }
}

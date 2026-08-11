import * as THREE from 'three';
import { SoloCharacter } from './character.js';
import { makeShadowBlob, angleLerp } from './player.js';
import { ITEM_STATE } from '../systems/items.js';
import { queryBays } from '../world/generator.js';
import { ITEM_COLORS } from '../data/themes.js';
import { formatKeyCode, gamepadLabelFor } from '../core/input.js';

// ---------------------------------------------------------------------------
// Bosses. Each one attacks the loop from a different angle: the Bully makes you
// chase, the Karen makes you work to a shopping list, the Sick Kid makes you
// stop shelving entirely and mop, and the Chaperone floods the floor.
// ---------------------------------------------------------------------------

export const BOSS_TYPES = {
  bully: {
    id: 'bully', name: 'Braden the Bully', title: 'catch him',
    icon: '😈', hp: 100, minMinute: 3, patience: 105,
    blurb: 'He has your date stamp and he is NOT giving it back.',
    color: 0xd94f3d,
  },
  karen: {
    id: 'karen', name: 'A Karen', title: 'satisfy the complaint',
    icon: '💇‍♀️', hp: 140, minMinute: 6, patience: 85,
    blurb: 'She would like to speak to whoever is in charge of the alphabet.',
    color: 0xd9a13d,
  },
  sickKid: {
    id: 'sickKid', name: 'Poorly Percy', title: 'clean it up',
    icon: '🤢', hp: 70, minMinute: 8, rare: true, patience: 80,
    blurb: 'His mom said he was “fine this morning”.',
    color: 0x6fbf4a,
  },
  chaperone: {
    id: 'chaperone', name: 'Field Trip Chaperone', title: 'survive the trip',
    icon: '🎒', hp: 180, minMinute: 12, patience: 95,
    blurb: 'Twenty-eight children. One clipboard. No plan.',
    color: 0x4f7fd9,
  },
};

const _res = { x: 0, z: 0, hit: null };

/** The Bully stays just below an unupgraded librarian's 5 m/s walk speed. */
export function bullyRunSpeed(elapsed = 0) {
  return 4.4 + Math.min(0.6, Math.max(0, elapsed) / (15 * 60) * 0.6);
}

class Boss {
  constructor(mgr, type) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.type = type;
    this.hp = type.hp;
    this.maxHp = type.hp;
    this.alive = true;
    this.t = 0;
    this.phase = 0;
    this.vx = 0; this.vz = 0;
    this.yaw = 0;
    this.radius = 0.42;
    this.anim = { phase: 0, speed: 0, lean: 0, armMode: 'swing', headYaw: 0, headPitch: 0, flail: 0, crouch: 0, hurt: 0, celebrate: 0 };
    this.actionT = 0;
    this.contactT = 0;
    this.chaosPressure = 0;
    this.state = 'intro';
    this.introT = 1.4;
    // If you can't deal with them in time they storm off on their own. An
    // undefeated boss must never become permanent, unwinnable pressure.
    this.patience = type.patience ?? 95;

    const g = this.game;
    const spec = BOSS_SPECS[type.id];
    this.model = new SoloCharacter(g.render.scene, g.mats, spec.model);
    this.shadow = makeShadowBlob(g.render.scene, g.mats, 1.9);
    this.height = spec.model.height;
    this.spec = spec;
    spec.init?.(this);

    // Spawn on the far side of a spawn ring, always reachable.
    const rng = mgr.rng;
    for (let i = 0; i < 30; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(10, 18);
      const x = g.player.x + Math.cos(a) * d;
      const z = g.player.z + Math.sin(a) * d;
      if (g.collision.isBlocked(x, z)) continue;
      if (x < 5 || z < 5 || x > g.layout.width - 5 || z > g.layout.depth - 5) continue;
      this.x = x; this.z = z;
      break;
    }
    if (this.x === undefined) { this.x = g.player.x + 8; this.z = g.player.z; }
  }

  damage(amount, source) {
    if (!this.alive || this.state === 'intro') return false;
    this.hp = Math.max(0, this.hp - amount);
    this.anim.hurt = 1;
    this.game.fx.burst(this.x, this.height * 0.9, this.z, 10, {
      speed: 3, color: [0xffffff, this.type.color], life: 0.4, size: 0.16, grav: -3,
    });
    this.game.hud.popup(this.x, this.height + 0.6, this.z, `-${Math.round(amount)}`, '#ffffff');
    if (this.hp <= 0) this.defeat();
    return true;
  }

  defeat() {
    if (!this.alive) return;
    this.alive = false;
    const g = this.game;
    g.run.bossesBeaten++;
    g.camera.addTrauma(0.5);
    g.audio.play('powerup');
    g.audio.play('boom', { volume: 0.5 });
    g.fx.ring(this.x, 0.1, this.z, { r0: 1, r1: 16, dur: 1.0, color: this.type.color });
    g.fx.burst(this.x, 1.4, this.z, 90, { speed: 8, color: [this.type.color, 0xffffff, 0xffd98a], life: 1.6, size: 0.26, grav: -5 });
    g.progression.addXP(180);
    g.run.chaos = Math.max(0, g.run.chaos - 12);
    g.hud.banner(`${this.type.name.toUpperCase()} DEFEATED`, '+180 XP  ·  chaos eased');
    this.spec.onDefeat?.(this);
  }

  /** Time ran out: they leave under their own steam, and you get nothing. */
  giveUp() {
    if (!this.alive) return;
    this.alive = false;
    const g = this.game;
    g.hud.banner(`${this.type.name.toUpperCase()} STORMS OFF`, 'No XP. Faster next time.');
    g.audio.play('error', { volume: 0.7 });
    g.fx.burst(this.x, 1.2, this.z, 30, { speed: 4, color: [this.type.color, 0x888888], life: 1.0, size: 0.2 });
    this.spec.onDefeat?.(this);
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.anim.hurt = Math.max(0, this.anim.hurt - dt * 2.5);

    if (this.state === 'intro') {
      this.introT -= dt;
      this.anim.armMode = 'panic';
      this.anim.speed = 0;
      if (this.introT <= 0) this.state = 'active';
      this._present(dt);
      return;
    }

    this.patience -= dt;
    if (this.patience <= 0) { this.giveUp(); return; }
    if (this.patience < 12 && Math.floor(this.patience) !== this._lastTick) {
      this._lastTick = Math.floor(this.patience);
      this.game.hud.toast(`${this.type.name} is leaving in ${this._lastTick}s`);
    }

    this.spec.update(this, dt);

    // Shared movement integration.
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    g.collision.resolve(nx, nz, this.radius, _res);
    if (Math.abs(_res.x - nx) > 1e-4) this.vx *= -0.2;
    if (Math.abs(_res.z - nz) > 1e-4) this.vz *= -0.2;
    this.x = _res.x; this.z = _res.z;

    const spd = Math.hypot(this.vx, this.vz);
    if (spd > 0.35) this.yaw = angleLerp(this.yaw, Math.atan2(this.vx, this.vz), 1 - Math.exp(-dt * 9));
    this.phase = (this.phase || 0) + spd * dt * 2.4;
    this.anim.phase = this.phase;
    this.anim.speed = spd;
    this.anim.lean = Math.min(1, spd / 5);

    this._present(dt);
  }

  moveToward(tx, tz, speed, dt, avoid = false) {
    const g = this.game;
    let sx = tx, sz = tz;
    if (avoid && !g.collision.lineOfSight(this.x, this.z, tx, tz, 1.0)) {
      if (!this._path || (this._repath = (this._repath ?? 0) - dt) <= 0) {
        this._repath = 0.6;
        this._path = g.pathfinder.find(this.x, this.z, tx, tz);
        this._pathI = 0;
      }
      if (this._path && this._pathI < this._path.length) {
        const wp = this._path[this._pathI];
        if (Math.hypot(wp.x - this.x, wp.z - this.z) < 1.1) this._pathI++;
        const n = this._path[Math.min(this._pathI, this._path.length - 1)];
        sx = n.x; sz = n.z;
      }
    }
    const dx = sx - this.x, dz = sz - this.z;
    const len = Math.hypot(dx, dz) || 1;
    const tvx = (dx / len) * speed, tvz = (dz / len) * speed;
    this.vx += (tvx - this.vx) * (1 - Math.exp(-dt * 7));
    this.vz += (tvz - this.vz) * (1 - Math.exp(-dt * 7));
  }

  _present(dt) {
    const scale = this.spec.scale ?? 1;
    this.model.pose(this.x, 0, this.z, this.yaw, this.anim, scale);
    this.shadow.position.set(this.x, 0.014, this.z);
    const s = 1.9 * scale;
    this.shadow.scale.set(s, 1, s);
  }

  dispose() {
    this.model.dispose();
    this.shadow.parent?.remove(this.shadow);
    this.spec.dispose?.(this);
  }
}

// --- Per-boss behavior -----------------------------------------------------

export function applyKarenCompliance(b, bay) {
  if (!b.alive || bay.color !== b.demandColor) return false;
  // Intro invulnerability must not consume the visible quota. An in-flight
  // powered return can otherwise make the card say 0 LEFT while Karen still
  // has health and expects an invisible extra filing.
  if (!b.damage(b.maxHp / b.demandTotal + 1, 'compliance')) return false;
  b.demandLeft--;
  b.game.hud.toast(`“Finally.” ${Math.max(0, b.demandLeft)} to go`);
  return true;
}

export function mopControlLabel(input) {
  return input?.usingGamepad
    ? gamepadLabelFor('mop')
    : formatKeyCode(input?.bindingFor?.('mop'));
}

const BOSS_SPECS = {
  bully: {
    scale: 1,
    model: {
      height: 1.42, chunk: 1.15,
      style: { hair: 'spiky', hat: 'cap' },
      colors: { skin: 0xe8b48c, shirt: 0xd94f3d, pants: 0x2b3040, hair: 0x2a1a10, shoe: 0xe8e8e8 },
    },
    init(b) { b.dodgeT = 0; b.trailT = 0; },
    update(b, dt) {
      const g = b.game;
      const p = g.player;
      const dx = b.x - p.x, dz = b.z - p.z;
      const dist = Math.hypot(dx, dz);

      // Always sprinting away, but he stays on a leash so the chase is winnable.
      let tx, tz;
      const away = Math.atan2(dx, dz);
      if (dist > 22) {
        tx = p.x; tz = p.z;                          // loop back if he's too far
        b.anim.armMode = 'swing';
      } else {
        b.dodgeT -= dt;
        if (b.dodgeT <= 0) { b.dodgeT = b.mgr.rng.range(0.9, 1.7); b.dodgeA = b.mgr.rng.range(-0.75, 0.75); }
        const a = away + b.dodgeA * (1 - Math.min(1, dist / 12));
        tx = b.x + Math.sin(a) * 8;
        tz = b.z + Math.cos(a) * 8;
        b.anim.armMode = 'panic';
      }
      const speed = bullyRunSpeed(g.run.elapsed);
      b.moveToward(tx, tz, speed, dt, dist > 22);

      // Every shelf he brushes past loses its top row.
      b.trailT -= dt;
      if (b.trailT <= 0) {
        b.trailT = 3.4;
        const bays = queryBays(g.layout, b.x, b.z, 2.6);
        let n = 0;
        for (const bay of bays) {
          if (bay.filled <= 0) continue;
          g.items.knockOff(bay, 2, { force: 1.3 });
          g.level.refreshBay(bay);
          if (++n >= 1) break;
        }
        if (n) {
          g.audio.play('bookfall', { pan: g._panFor(b.x, b.z), volume: 0.6 });
          g.camera.addTrauma(0.05);
        }
      }

      // Catching him is the whole fight: stay in contact to wear him down.
      if (dist < 2.1) {
        b.contactT += dt;
        b.damage(46 * dt, 'chase');
        if (Math.random() < dt * 6) {
          g.fx.burst(b.x, b.height * 0.8, b.z, 3, { speed: 2, color: 0xffd98a, life: 0.4, size: 0.14 });
        }
      } else {
        b.contactT = 0;
      }
      b.chaosPressure = 0.14;
    },
    onDefeat(b) {
      // He drops everything he's been hoarding.
      const g = b.game;
      for (let i = 0; i < 10; i++) {
        const a = b.mgr.rng.range(0, Math.PI * 2);
        g.items.spawn(b.x, 1.4, b.z, g.theme.colors[i % g.theme.colors.length], {
          vx: Math.cos(a) * 4, vy: b.mgr.rng.range(4, 7), vz: Math.sin(a) * 4,
        });
      }
    },
  },

  karen: {
    scale: 1,
    model: {
      height: 1.7, chunk: 1.05,
      style: { hair: 'bun', glasses: false, cardigan: true },
      colors: { skin: 0xf0c8a8, shirt: 0xd9a13d, pants: 0x3a3a44, hair: 0xd8b878, shoe: 0x2a2a30 },
    },
    init(b) {
      const g = b.game;
      b.demandColor = g.rng.pick(g.theme.colors);
      b.demandTotal = 8;
      b.demandLeft = b.demandTotal;
      b.shoutT = 0;
      b.unsub = g.events.on('shelved', ({ bay }) => {
        applyKarenCompliance(b, bay);
      });
    },
    dispose(b) { b.unsub?.(); },
    update(b, dt) {
      const g = b.game;
      const p = g.player;
      const dist = Math.hypot(p.x - b.x, p.z - b.z);

      // She follows you everywhere, at exactly conversational distance.
      const want = 2.6;
      if (dist > want + 0.6) b.moveToward(p.x, p.z, 3.4, dt, true);
      else { b.vx *= Math.exp(-dt * 5); b.vz *= Math.exp(-dt * 5); }
      b.yaw = angleLerp(b.yaw, Math.atan2(p.x - b.x, p.z - b.z), 1 - Math.exp(-dt * 6));
      b.anim.armMode = 'panic';
      b.anim.headYaw = Math.sin(b.t * 6) * 0.25;

      // Proximity is the punishment: chaos climbs and you move like treacle.
      const near = dist < 6;
      b.chaosPressure = near ? 0.42 : 0.16;
      const normalMoveSpeed = p.stats.baseMoveSpeed * (1 + 0.08 * (g.progression.levels.comfyShoes || 0));
      p.stats.moveSpeed = normalMoveSpeed * (near ? 0.82 : 1);

      b.shoutT -= dt;
      if (b.shoutT <= 0) {
        b.shoutT = 2.4;
        g.audio.play('karen', { pan: g._panFor(b.x, b.z), volume: 0.5 });
        g.fx.ring(b.x, 0.06, b.z, { r0: 0.5, r1: 6, dur: 0.7, color: 0xffcf6a });
        g.hud.popup(b.x, b.height + 0.7, b.z, KAREN_LINES[(Math.random() * KAREN_LINES.length) | 0], '#ffcf6a');
      }
    },
    onDefeat(b) {
      b.game.player.stats.moveSpeed = b.game.player.stats.baseMoveSpeed *
        (1 + 0.08 * (b.game.progression.levels.comfyShoes || 0));
    },
  },

  sickKid: {
    scale: 1,
    model: {
      height: 1.16, chunk: 0.95,
      style: { hair: 'short' },
      colors: { skin: 0xc9d8a8, shirt: 0x6fbf4a, pants: 0x4a5a3a, hair: 0x8a6a3a, shoe: 0x3a3a3a },
    },
    init(b) {
      b.vomitT = 3.5;
      b.wanderT = 0;
      b.puddles = [];
    },
    dispose(b) {
      for (const p of b.puddles) b.game.disasters.removeMess(p);
      b.puddles.length = 0;
    },
    update(b, dt) {
      const g = b.game;
      const p = g.player;

      b.wanderT -= dt;
      if (b.wanderT <= 0) {
        b.wanderT = b.mgr.rng.range(2, 4);
        const a = b.mgr.rng.range(0, Math.PI * 2);
        b.wanderTarget = { x: b.x + Math.cos(a) * 8, z: b.z + Math.sin(a) * 8 };
      }
      if (b.wanderTarget) b.moveToward(b.wanderTarget.x, b.wanderTarget.z, 1.9, dt, false);
      b.anim.armMode = 'carry';
      b.anim.crouch = 0.25 + Math.sin(b.t * 2) * 0.1;

      b.vomitT -= dt;
      if (b.vomitT <= 0) {
        b.vomitT = b.mgr.rng.range(7, 12);
        b.anim.hurt = 1;
        const mess = g.disasters.addMess(b.x + Math.sin(b.yaw) * 0.6, b.z + Math.cos(b.yaw) * 0.6, {
          kind: 'vomit', size: 2.4, color: 0x88b03a, timer: 26,
        });
        b.puddles.push(mess);
        g.audio.play('splat', { pan: g._panFor(b.x, b.z), volume: 0.8 });
        g.fx.burst(b.x + Math.sin(b.yaw) * 0.6, 0.7, b.z + Math.cos(b.yaw) * 0.6, 26, {
          speed: 2.6, color: [0x88b03a, 0xb8d06a], life: 0.9, size: 0.2, grav: -9,
        });
        g.hud.toast(`Percy has been sick. Mop it! [${mopControlLabel(g.input)}]`);
        g.camera.addTrauma(0.12);
      }

      // He calms down as his messes get cleaned up.
      const outstanding = b.puddles.filter((m) => m.alive).length;
      b.chaosPressure = 0.12 + outstanding * 0.3;
      const cleaned = b.puddles.length - outstanding;
      const wantHp = b.maxHp * (1 - cleaned / 4);
      if (b.hp > wantHp) b.damage(b.hp - wantHp, 'mop');

      // Standing next to him also settles him — a hand on the shoulder.
      if (Math.hypot(p.x - b.x, p.z - b.z) < 2.0) b.damage(9 * dt, 'comfort');
    },
  },

  chaperone: {
    scale: 1,
    model: {
      height: 1.78, chunk: 1.1,
      style: { hair: 'short', glasses: true, apron: true },
      colors: { skin: 0xd8a878, shirt: 0x4f7fd9, pants: 0x8a7a5a, hair: 0x3a2a1a, shoe: 0x5a4a3a },
    },
    init(b) { b.whistleT = 2; b.brood = 0; },
    update(b, dt) {
      const g = b.game;
      const p = g.player;
      const dist = Math.hypot(p.x - b.x, p.z - b.z);

      // She marches between shelves, blowing the whistle to unleash the class.
      if (!b.marchTarget || Math.hypot(b.marchTarget.x - b.x, b.marchTarget.z - b.z) < 2) {
        const bays = queryBays(g.layout, p.x, p.z, 22);
        const bay = bays.length ? b.mgr.rng.pick(bays) : null;
        b.marchTarget = bay ? { x: bay.wx + bay.nx * 1.2, z: bay.wz + bay.nz * 1.2 } : { x: p.x, z: p.z };
      }
      b.moveToward(b.marchTarget.x, b.marchTarget.z, 2.6, dt, true);
      b.anim.armMode = 'carry';

      b.whistleT -= dt;
      if (b.whistleT <= 0) {
        b.whistleT = 9.0;
        g.audio.play('alarm', { pan: g._panFor(b.x, b.z), volume: 0.6 });
        g.fx.ring(b.x, 0.07, b.z, { r0: 0.6, r1: 12, dur: 0.9, color: 0x9fc4ff });
        // The class descends on nearby shelves all at once.
        const bays = queryBays(g.layout, b.x, b.z, 9);
        let n = 0;
        for (const bay of bays) {
          if (bay.filled <= 0) continue;
          g.items.knockOff(bay, 2, { force: 1.1 });
          g.level.refreshBay(bay);
          if (++n >= 3) break;
        }
        g.kids.spawnOne();
        g.hud.toast('“Everyone pick ONE book!”');
      }

      if (dist < 2.2) b.damage(30 * dt, 'confront');
      b.chaosPressure = 0.34;
    },
  },
};

const KAREN_LINES = [
  'This is UNACCEPTABLE',
  'Do you KNOW who I am',
  'I pay TAXES',
  'Where is your MANAGER',
  'In MY day…',
  'I’ll be leaving a REVIEW',
  'Is this alphabetical??',
];

/** Owns the active bosses, their intro banners, and the health bars. */
export class BossManager {
  constructor(game) {
    this.game = game;
    this.rng = game.rng.fork(99);
    this.active = [];
    this.defeated = new Set();
  }

  get chaosPressure() {
    let s = 0;
    for (const b of this.active) if (b.alive) s += b.chaosPressure || 0;
    return s;
  }

  available(minute) {
    return Object.values(BOSS_TYPES).filter((t) => minute >= t.minMinute);
  }

  spawn(typeId) {
    const type = BOSS_TYPES[typeId];
    if (!type) return null;
    if (this.active.some((b) => b.alive && b.type.id === typeId)) return null;
    const boss = new Boss(this, type);
    this.active.push(boss);
    const g = this.game;
    g.audio.play('bossHorn');
    g.camera.addTrauma(0.35);
    g.hud.bossBanner(type);
    g.events.emit('bossSpawn', { type });
    return boss;
  }

  /** Powers deal damage to whatever boss is closest to the effect. */
  damageNear(x, z, radius, amount, source) {
    for (const b of this.active) {
      if (!b.alive) continue;
      if (Math.hypot(b.x - x, b.z - z) <= radius) b.damage(amount, source);
    }
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      // Defeated bosses linger visually, but their behavior (especially
      // Karen's proximity slow) must stop on the exact defeat frame.
      if (b.alive) b.update(dt);
      if (!b.alive) {
        // Let the death effects breathe for a beat before removing.
        b.deadT = (b.deadT ?? 0) + dt;
        b.model.setVisible(b.deadT < 0.15);
        if (b.deadT > 1.2) {
          b.dispose();
          this.active.splice(i, 1);
          this.defeated.add(b.type.id);
        }
      }
    }
  }

  clear() {
    for (const b of this.active) b.dispose();
    this.active.length = 0;
  }

  dispose() { this.clear(); }
}

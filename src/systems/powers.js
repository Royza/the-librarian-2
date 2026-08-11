import * as THREE from 'three';
import { ITEM_STATE } from './items.js';
import { ITEM_COLORS } from '../data/themes.js';
import { nearestBay, queryBays, bayAccepts } from '../world/generator.js';

const _aim = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

/**
 * The librarian's arsenal. Each power is data-driven off its level so upgrades
 * only have to bump a number.
 */
export class PowerSystem {
  constructor(game) {
    this.game = game;
    this.levels = { gravityGun: 0, bookerang: 0, colorPulse: 0, quietPlease: 0 };
    this.cooldowns = { gravityGun: 0, bookerang: 0, colorPulse: 0, quietPlease: 0 };

    this.beam = game.fx.createBeam(0x8fd4ff, 0.16);
    this.beamTimer = 0;
    this.beamDir = new THREE.Vector2(0, 1);

    this.aimPoint = new THREE.Vector3();
    this.quietActive = 0;
    this.sortField = null;
    this.sortFieldTick = 0;
  }

  setLevel(id, level) {
    this.levels[id] = level;
    if (id === 'quietPlease') this.cooldowns.quietPlease = this.stat('quietPlease', 'cooldown');
  }

  has(id) { return this.levels[id] > 0; }

  /** Derived numbers for a power at its current level. */
  stat(id, key) {
    const l = this.levels[id];
    switch (id) {
      case 'gravityGun':
        if (key === 'range') return 9 + l * 3;
        if (key === 'cooldown') return Math.max(1.2, 6.5 * Math.pow(0.82, l - 1));
        if (key === 'targets') return 2 + l;
        if (key === 'width') return 2.0 + l * 0.35;
        break;
      case 'bookerang':
        if (key === 'range') return 12 + l * 4.5;
        if (key === 'cooldown') return Math.max(1.0, 5.0 * Math.pow(0.85, l - 1));
        if (key === 'count') return 1 + l;
        break;
      case 'colorPulse':
        if (key === 'radius') return 9 + l * 4;
        if (key === 'cooldown') return Math.max(4, 16 * Math.pow(0.86, l - 1));
        if (key === 'colors') return Math.min(4, 1 + Math.floor(l / 2));
        break;
      case 'quietPlease':
        if (key === 'cooldown') return 60 - l * 8;
        if (key === 'duration') return 3 + l;
        break;
    }
    return 0;
  }

  ready(id) { return this.has(id) && this.cooldowns[id] <= 0; }
  cooldownFraction(id) {
    if (!this.has(id)) return 0;
    const max = this.stat(id, 'cooldown');
    return 1 - Math.min(1, this.cooldowns[id] / max);
  }

  update(dt, input) {
    const g = this.game;
    for (const k of Object.keys(this.cooldowns)) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }

    // Aim: mouse on the ground plane, or the right stick, or facing.
    const p = g.player;
    if (input.usingGamepad) {
      const a = input.aimVector();
      if (Math.hypot(a.x, a.y) > 0.2) {
        g.camera.inputToWorld(a.x, a.y, _aim);
        this.aimPoint.set(p.x + _aim.x * 6, 0.9, p.z + _aim.z * 6);
      } else {
        this.aimPoint.set(p.x + Math.sin(p.yaw) * 6, 0.9, p.z + Math.cos(p.yaw) * 6);
      }
    } else {
      g.camera.screenToGround(input.mouse.ndcX, input.mouse.ndcY, this.aimPoint, 0.9);
    }
    const trainingTarget = g.run.tutorialPowerTarget;
    if (trainingTarget?.id === 'gravityGun' && trainingTarget.item?.active) {
      this.aimPoint.set(trainingTarget.item.x, trainingTarget.item.y, trainingTarget.item.z);
    }

    if (input.wasPressed('gravityGun')) this.fireGravityGun();
    if (input.wasPressed('bookerang')) this.fireBookerang();
    if (input.wasPressed('colorPulse')) this.fireColorPulse();

    this._updateBeam(dt);
    this._updateQuietPlease(dt);
    this._updateSortField(dt);
  }

  // --- Dewey Decimal Beam ---------------------------------------------------

  fireGravityGun() {
    const g = this.game;
    if (!this.ready('gravityGun')) {
      if (this.has('gravityGun')) g.audio.play('error', { volume: 0.4 });
      return;
    }
    const p = g.player;
    if (p.isFull) { g.audio.play('error', { volume: 0.4 }); g.hud.toast('Arms full!'); return; }

    const dx = this.aimPoint.x - p.x, dz = this.aimPoint.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len, nz = dz / len;
    const range = this.stat('gravityGun', 'range');
    const halfWidth = this.stat('gravityGun', 'width') / 2;
    let budget = Math.min(this.stat('gravityGun', 'targets'), p.stats.carrySlots - p.carried.length);

    const grabbed = [];
    for (const it of g.items.items) {
      if (budget <= 0) break;
      if (!it.active || it.state !== ITEM_STATE.FREE) continue;
      const rx = it.x - p.x, rz = it.z - p.z;
      const along = rx * nx + rz * nz;
      if (along < 0 || along > range) continue;
      const across = Math.abs(-rx * nz + rz * nx);
      if (across > halfWidth + along * 0.06) continue;
      grabbed.push(it);
      budget--;
    }

    // Also yank books out of the hands of any kid caught in the beam.
    for (const kid of g.kids.active) {
      if (budget <= 0) break;
      if (!kid.heldItem) continue;
      const rx = kid.x - p.x, rz = kid.z - p.z;
      const along = rx * nx + rz * nz;
      if (along < 0 || along > range) continue;
      const across = Math.abs(-rx * nz + rz * nx);
      if (across > halfWidth + along * 0.06) continue;
      const it = kid.surrenderItem();
      if (it) { grabbed.push(it); budget--; kid.startle(1.4); }
    }

    for (const it of grabbed) {
      it.state = ITEM_STATE.FLYING;
      it.holder = p;
      it.age = 0;
      it.vy = 2.5;
      g.fx.sparkle(it.x, it.y + 0.2, it.z, ITEM_COLORS[it.color]?.hex ?? 0xffffff, 6);
    }

    // Higher-level beam builds preserve a filing chain while the pulled books
    // are in flight, turning beam → shelf into a deliberate combo setup.
    if (this.levels.gravityGun >= 3 && grabbed.length) {
      g.run.comboTimer = Math.max(g.run.comboTimer, (g.progression.comboTime ?? 3.2) + 1.5);
    }

    this.cooldowns.gravityGun = this.stat('gravityGun', 'cooldown');
    this.beamTimer = 0.42;
    this.beamDir.set(nx, nz);
    this.beamRange = range;

    g.audio.play('beam', { volume: 0.9 });
    g.audio.play('zap', { volume: 0.5 });
    g.camera.addTrauma(0.1);
    g.fx.burst(p.x + nx, 1.0, p.z + nz, 14, { speed: 3, color: [0x8fd4ff, 0xffffff], life: 0.4, size: 0.16, grav: 0, up: 0.4 });
    if (!grabbed.length) g.hud.toast('Nothing in the beam');
    g.events.emit('power', { id: 'gravityGun', hits: grabbed.length });
  }

  _updateBeam(dt) {
    if (this.beamTimer <= 0) { this.game.fx.hideBeam(this.beam); return; }
    this.beamTimer -= dt;
    const p = this.game.player;
    const k = Math.max(0, this.beamTimer / 0.42);
    _from.set(p.x + this.beamDir.x * 0.4, 1.05, p.z + this.beamDir.y * 0.4);
    _to.set(
      p.x + this.beamDir.x * this.beamRange * (0.4 + k * 0.6),
      0.75,
      p.z + this.beamDir.y * this.beamRange * (0.4 + k * 0.6),
    );
    this.game.fx.setBeam(this.beam, _from, _to, k);
  }

  // --- Bookerang ------------------------------------------------------------

  fireBookerang() {
    const g = this.game;
    if (!this.ready('bookerang')) {
      if (this.has('bookerang')) g.audio.play('error', { volume: 0.4 });
      return;
    }
    const p = g.player;
    if (!p.carried.length) { g.hud.toast('Nothing to throw'); g.audio.play('error', { volume: 0.4 }); return; }

    const range = this.stat('bookerang', 'range');
    const count = Math.min(this.stat('bookerang', 'count'), p.carried.length);
    let thrown = 0;

    for (let i = p.carried.length - 1; i >= 0 && thrown < count; i--) {
      const it = p.carried[i];
      const bay = nearestBay(g.layout, p.x, p.z, it.color, range);
      if (!bay) continue;
      const d = Math.hypot(bay.wx - p.x, bay.wz - p.z);
      if (d > range) continue;
      if (!g.items.returnTo(it, bay, { arc: true, side: thrown % 2 ? 1 : -1 })) continue;
      p.carried.splice(i, 1);
      it.y = 1.2;
      it.spin = 26;
      thrown++;
      g.fx.sparkle(p.x, 1.2, p.z, ITEM_COLORS[it.color]?.hex ?? 0xffffff, 6);
    }

    if (!thrown) {
      g.hud.toast('No matching shelf in range');
      g.audio.play('error', { volume: 0.4 });
      return;
    }

    this.cooldowns.bookerang = this.stat('bookerang', 'cooldown');
    g.audio.play('whoosh', { volume: 0.8 });
    g.camera.addTrauma(0.06);
    g.events.emit('power', { id: 'bookerang', hits: thrown });
  }

  // --- Chromatic Shush ------------------------------------------------------

  fireColorPulse() {
    const g = this.game;
    if (!this.ready('colorPulse')) {
      if (this.has('colorPulse')) g.audio.play('error', { volume: 0.4 });
      return;
    }
    const p = g.player;
    const radius = this.stat('colorPulse', 'radius');
    const colorCount = this.stat('colorPulse', 'colors');

    // Target the colors that are causing the most trouble nearby.
    const tally = new Map();
    g.items.forEachInRadius(p.x, p.z, radius, (it) => {
      if (it.state !== ITEM_STATE.FREE && it.state !== ITEM_STATE.KID && it.state !== ITEM_STATE.CARRIED) return;
      tally.set(it.color, (tally.get(it.color) || 0) + 1);
    });
    if (!tally.size) {
      g.hud.toast('Nothing to shush');
      g.audio.play('error', { volume: 0.4 });
      return;
    }
    const colors = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, colorCount).map((e) => e[0]);
    const colorSet = new Set(colors);

    let sent = 0;
    const send = (it) => {
      const bay = nearestBay(g.layout, it.x, it.z, it.color, 140);
      if (!bay) return false;
      it.holder = null;
      if (!g.items.returnTo(it, bay)) return false;
      it.spin = 20;
      sent++;
      return true;
    };

    // Floor items first, then whatever the kids are running off with, then
    // whatever's in your own arms.
    for (const it of g.items.items) {
      if (!it.active || !colorSet.has(it.color)) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d > radius) continue;
      if (it.state === ITEM_STATE.FREE) send(it);
    }
    for (const kid of g.kids.active) {
      if (!kid.heldItem || !colorSet.has(kid.heldItem.color)) continue;
      if (Math.hypot(kid.x - p.x, kid.z - p.z) > radius) continue;
      const it = kid.surrenderItem();
      if (it && send(it)) {
        kid.startle(1.8);
      } else if (it) {
        it.state = ITEM_STATE.FREE;
        it.grounded = false;
        it.y = kid.height * 0.9;
        it.vy = 1.2;
      }
    }
    for (let i = p.carried.length - 1; i >= 0; i--) {
      const it = p.carried[i];
      if (!colorSet.has(it.color)) continue;
      if (send(it)) p.carried.splice(i, 1);
    }

    this.cooldowns.colorPulse = this.stat('colorPulse', 'cooldown');

    for (let i = 0; i < colors.length; i++) {
      const hex = ITEM_COLORS[colors[i]]?.hex ?? 0xffffff;
      g.fx.ring(p.x, 0.08 + i * 0.02, p.z, { r0: 0.8, r1: radius, dur: 0.75 + i * 0.1, color: hex });
      g.fx.burst(p.x, 1.1, p.z, 30, { speed: 7, color: hex, life: 0.9, size: 0.22, grav: -2 });
    }
    g.camera.addTrauma(0.3);
    g.render.shockwave(new THREE.Vector3(p.x, 1, p.z), { amplitude: 0.03, maxRadius: 1.4, speed: 3.4 });
    g.audio.play('powerup', { volume: 1 });
    g.audio.play('boom', { volume: 0.35 });
    g.hud.toast(`Shushed ${sent} ${colors.map((c) => ITEM_COLORS[c].name).join(' + ')}`);

    // At level four the shockwave leaves a short-lived sorting zone. Stray
    // items entering it are filed one at a time, creating a real build
    // transformation instead of another percentage increase. Install it
    // before the event so the synchronous tutorial boundary can clear every
    // practice-only transient before scored service begins.
    if (this.levels.colorPulse >= 4) {
      this.sortField = { x: p.x, z: p.z, radius: radius * 0.55, t: 4 + this.levels.colorPulse * 0.75 };
      this.sortFieldTick = 0;
    }
    g.events.emit('power', { id: 'colorPulse', hits: sent });
  }

  _updateSortField(dt) {
    const f = this.sortField;
    if (!f) return;
    const g = this.game;
    f.t -= dt;
    this.sortFieldTick -= dt;
    if (f.t <= 0) { this.sortField = null; return; }
    if (this.sortFieldTick > 0) return;
    this.sortFieldTick = 0.28;
    let candidate = null;
    g.items.forEachInRadius(f.x, f.z, f.radius, (it) => {
      if (!candidate && it.state === ITEM_STATE.FREE) candidate = it;
    });
    if (!candidate) return;
    const bay = nearestBay(g.layout, candidate.x, candidate.z, candidate.color, 140);
    if (!bay) return;
    if (!g.items.returnTo(candidate, bay, { arc: true })) return;
    g.fx.ring(f.x, 0.05, f.z, { r0: f.radius * 0.72, r1: f.radius, dur: 0.3, color: ITEM_COLORS[candidate.color]?.hex ?? 0xffffff });
  }

  // --- QUIET PLEASE ---------------------------------------------------------

  _updateQuietPlease(dt) {
    if (!this.has('quietPlease')) return;
    const g = this.game;
    if (this.quietActive > 0) {
      this.quietActive -= dt;
      g.run.chaosFrozen = this.quietActive > 0;
      if (this.quietActive <= 0) g.run.chaosFrozen = false;
      return;
    }
    if (this.cooldowns.quietPlease <= 0) {
      this.cooldowns.quietPlease = this.stat('quietPlease', 'cooldown');
      this.quietActive = this.stat('quietPlease', 'duration');
      g.run.chaosFrozen = true;
      const p = g.player;
      g.fx.ring(p.x, 0.1, p.z, { r0: 1, r1: 16, dur: 1.0, color: 0xbfe6ff });
      g.audio.play('whoosh', { volume: 0.6 });
      g.hud.banner('SHHHHH', 'Chaos is holding its breath.');
      for (const kid of g.kids.active) {
        if (Math.hypot(kid.x - p.x, kid.z - p.z) < 14) kid.startle(2.5);
      }
    }
  }

  dispose() {
    this.game.fx?.hideBeam(this.beam);
  }
}

import * as THREE from 'three';
import { queryBays } from '../world/generator.js';
import { ITEM_STATE } from './items.js';
import { CHAOS_BALANCE } from './chaos.js';
import { box, cyl, sphere, mergeParts, ensureColorAttr } from '../world/props.js';
import * as TX from '../render/textures.js';

// ---------------------------------------------------------------------------
// Natural (and unnatural) disasters, plus the mess/mop system they feed.
//
// Every disaster runs telegraph → active → recover, scaled by the player's
// Fire Drill / Insurance mitigation so investment actually shows.
// ---------------------------------------------------------------------------

export const DISASTERS = {
  earthquake: {
    id: 'earthquake', name: 'EARTHQUAKE', icon: '🌋',
    warning: 'The stacks are shaking.', minMinute: 2, weight: 30, duration: 11,
    recoverySeconds: CHAOS_BALANCE.postDisasterReprieveSeconds,
  },
  tornado: {
    id: 'tornado', name: 'TORNADO', icon: '🌪️',
    warning: 'Something is spinning in the east wing.', minMinute: 5, weight: 24, duration: 20,
    recoverySeconds: CHAOS_BALANCE.postDisasterReprieveSeconds,
  },
  volcano: {
    id: 'volcano', name: 'VOLCANO', icon: '🌋',
    warning: 'That was NOT there this morning.', minMinute: 9, weight: 16, duration: 26,
    recoverySeconds: CHAOS_BALANCE.postDisasterReprieveSeconds,
  },
  aliens: {
    id: 'aliens', name: 'ALIEN INVASION', icon: '🛸',
    warning: 'Unidentified shelving object detected.', minMinute: 12, weight: 14, duration: 30,
  },
};

const _res = { x: 0, z: 0, hit: null };

export function earthquakeBooksPerPulse(intensity = 1, mitigation = 1) {
  const k = Math.max(0, Math.min(1, intensity));
  return Math.max(1, Math.round((5 + 5 * k) * Math.max(0, mitigation)));
}

export function tornadoBooksPerPulse(mitigation = 1) {
  return Math.max(1, Math.round(6 * Math.max(0, mitigation)));
}

export class DisasterManager {
  constructor(game) {
    this.game = game;
    this.rng = game.rng.fork(4242);
    this.active = [];
    this.messes = [];
    this.mopSpeed = 1;
    this.autoClean = false;
    this.mitigation = 1;
    this.durationScale = 1;
    this.mopProgress = 0;
    this.currentMess = null;
    this._built = {};
    // Gameplay-delayed effects live on simulation time. A browser timeout can
    // fire through pause, drafts, or even after a different run has started.
    this._pendingImpacts = [];
  }

  get messCount() { return this.messes.filter((m) => m.alive).length; }
  get isActive() { return this.active.length > 0; }
  get activeNames() { return this.active.map((d) => d.def.name); }

  // --- messes ---------------------------------------------------------------

  addMess(x, z, { kind = 'spill', size = 2.2, color = 0x88b03a, timer = 25 } = {}) {
    const g = this.game;
    const decal = g.fx.addDecal(x, z, { size, color, life: Infinity });
    const mess = {
      kind, x, z, size, alive: true, timer, maxTimer: timer,
      progress: 0, decal, punished: false,
    };
    this.messes.push(mess);
    g.events.emit('mess', { mess });
    return mess;
  }

  removeMess(mess) {
    if (!mess) return;
    mess.alive = false;
    this.game.fx.removeDecal(mess.decal);
    const i = this.messes.indexOf(mess);
    if (i >= 0) this.messes.splice(i, 1);
  }

  _updateMesses(dt) {
    const g = this.game;
    const p = g.player;
    this.currentMess = null;

    for (let i = this.messes.length - 1; i >= 0; i--) {
      const m = this.messes[i];
      if (!m.alive) { this.messes.splice(i, 1); continue; }
      m.timer -= dt;

      const d = Math.hypot(p.x - m.x, p.z - m.z);
      const inRange = d < m.size * 0.65 + 0.6;
      if (inRange && !this.currentMess) this.currentMess = m;

      // Mopping: hold R (or just stand in it, if you bought the keys).
      const mopping = inRange && (g.input.isDown('mop') || this.autoClean);
      if (mopping) {
        m.progress += dt * this.mopSpeed * (g.input.isDown('mop') ? 0.55 : 0.2);
        if (Math.random() < dt * 20) {
          g.fx.emit(m.x + (Math.random() - 0.5) * m.size, 0.1, m.z + (Math.random() - 0.5) * m.size, {
            vy: 1.5 + Math.random(), life: 0.5, size: 0.12, color: 0xbfe6ff, grav: -2,
          });
        }
        if (Math.random() < dt * 4) g.audio.play('mop', { volume: 0.3 });
        m.decal.size = m.size * (1 - m.progress * 0.75);
        if (m.progress >= 1) {
          this.removeMess(m);
          g.progression.addXP(45);
          g.run.chaos = Math.max(0, g.run.chaos - 2.2);
          g.audio.play('shelve', { rate: 1.3 });
          g.fx.ring(m.x, 0.05, m.z, { r0: 0.4, r1: m.size * 1.4, dur: 0.5, color: 0xbfe6ff });
          g.hud.popup(m.x, 1.2, m.z, 'spotless +45', '#8fe6c0');
          continue;
        }
      }

      // Let it fester and the chaos rate really bites.
      if (m.timer <= 0 && !m.punished) {
        m.punished = true;
        g.addChaos(8);
        g.camera.addTrauma(0.25);
        g.audio.play('alarm', { volume: 0.7 });
        g.hud.banner('IT SOAKED IN', 'That is going to smell for weeks.');
        m.decal.color.setHex(0x5a6a20);
      }
    }
  }

  // --- disasters ------------------------------------------------------------

  available(minute) {
    return Object.values(DISASTERS).filter((d) => minute >= d.minMinute);
  }

  trigger(id) {
    const def = DISASTERS[id];
    if (!def) return null;
    if (this.active.some((d) => d.def.id === id)) return null;
    const g = this.game;
    const inst = {
      def, t: 0, phase: 'warn', warnT: 2.6,
      duration: def.duration * this.durationScale,
      data: {},
    };
    this.active.push(inst);
    g.hud.disasterWarning(def);
    g.audio.play('alarm', { volume: 0.9 });
    g.camera.addTrauma(0.2);
    g.events.emit('disasterStart', { def });
    return inst;
  }

  update(dt) {
    this._updateChaosRecovery(dt);
    this._updateMesses(dt);
    this._updatePendingImpacts(dt);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const inst = this.active[i];
      if (inst.phase === 'warn') {
        inst.warnT -= dt;
        if (inst.warnT <= 0) {
          inst.phase = 'active';
          inst.t = 0;
          this[`_start_${inst.def.id}`]?.(inst);
        }
        continue;
      }
      inst.t += dt;
      this[`_update_${inst.def.id}`]?.(inst, dt);
      if (inst.t >= inst.duration) {
        this[`_end_${inst.def.id}`]?.(inst);
        this.active.splice(i, 1);
        this.game.run.disastersSurvived++;
        this.game.progression.addXP(140);
        this._beginChaosRecovery(inst.def);
        const recovery = inst.def.recoverySeconds
          ? `CHAOS PAUSED ${inst.def.recoverySeconds}s  ·  clean it up`
          : 'now clean it up';
        this.game.hud.banner(`${inst.def.name} OVER`, `+140 XP  ·  ${recovery}`);
        this.game.events.emit('disasterEnd', { def: inst.def });
      }
    }
  }

  _beginChaosRecovery(def) {
    const seconds = def?.recoverySeconds || 0;
    const g = this.game;
    if (!seconds || !g.run) return false;
    const floor = g.items?.floorCount || 0;
    g.run.disasterRecoveryRemaining = Math.max(seconds, g.run.disasterRecoveryRemaining || 0);
    g.run.disasterRecoveryStartFloor = floor;
    g.run.disasterRecoveryEndFloor = floor;
    g.run.disasterRecoverySource = def.id;
    g.events?.emit?.('disasterRecoveryStart', { def, seconds, floor });
    return true;
  }

  _updateChaosRecovery(dt) {
    const g = this.game;
    const r = g.run;
    if (!r || !(r.disasterRecoveryRemaining > 0)) return false;
    r.disasterRecoveryRemaining = Math.max(0, r.disasterRecoveryRemaining - Math.max(0, dt));
    if (r.disasterRecoveryRemaining > 0) return false;

    const floor = g.items?.floorCount || 0;
    r.disasterRecoveryEndFloor = floor;
    g.hud?.banner?.(
      'CHAOS RESUMES',
      floor > 0
        ? `${floor} loose item${floor === 1 ? '' : 's'} are still feeding the meter.`
        : 'The floor is clear. Keep it that way.',
    );
    g.events?.emit?.('disasterRecoveryEnd', { floor, source: r.disasterRecoverySource });
    return true;
  }

  _updatePendingImpacts(dt) {
    for (let i = this._pendingImpacts.length - 1; i >= 0; i--) {
      const impact = this._pendingImpacts[i];
      impact.time -= dt;
      if (impact.time > 0) continue;
      this._pendingImpacts.splice(i, 1);
      this._lavaImpact(impact.x, impact.z);
    }
  }

  // --- EARTHQUAKE -----------------------------------------------------------

  _start_earthquake(inst) {
    const g = this.game;
    g.audio.play('quake', { volume: 1 });
    g.hud.banner('EARTHQUAKE', 'Hold on to something. Preferably a book.');
    inst.data.pulse = 0;
  }

  _update_earthquake(inst, dt) {
    const g = this.game;
    const k = 1 - inst.t / inst.duration;
    g.camera.addTrauma(0.055 * k * this.mitigation);

    inst.data.pulse -= dt;
    if (inst.data.pulse <= 0) {
      inst.data.pulse = 0.7;
      // Shake books out of every shelf near the player — the whole building is
      // moving, but only the reachable mess matters.
      const bays = queryBays(g.layout, g.player.x, g.player.z, 26);
      const n = earthquakeBooksPerPulse(k, this.mitigation);
      this._knockBooksFromBays(bays, n, { force: 1.65, perBay: 2 });
      g.audio.play('bookfall', { volume: 0.55, rate: 0.7 + Math.random() * 0.5 });
      // Ceiling dust.
      for (let i = 0; i < 14; i++) {
        g.fx.emit(
          g.player.x + (Math.random() - 0.5) * 30,
          g.layout.ceilingHeight - Math.random() * 2,
          g.player.z + (Math.random() - 0.5) * 30,
          { vy: -1.5, life: 2.4, size: 0.14, color: 0xd8c8a8, grav: -1.4, drag: 0.99 },
        );
      }
      if (Math.random() < 0.35) {
        g.render.shockwave(new THREE.Vector3(g.player.x, 1, g.player.z), { amplitude: 0.02, maxRadius: 1.2, speed: 3 });
      }
    }
  }

  _end_earthquake() { }

  // --- TORNADO --------------------------------------------------------------

  _start_tornado(inst) {
    const g = this.game;
    const a = this.rng.range(0, Math.PI * 2);
    inst.data.x = g.player.x + Math.cos(a) * 22;
    inst.data.z = g.player.z + Math.sin(a) * 22;
    inst.data.angle = a + Math.PI;
    inst.data.radius = 6.5 * this.mitigation;
    inst.data.spin = 0;
    inst.data.mesh = this._buildTornado();
    g.render.scene.add(inst.data.mesh);
    g.hud.banner('TORNADO', 'It appears to be browsing.');
    g.audio.play('whoosh', { volume: 1 });
  }

  _buildTornado() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcfc4ae, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const g = new THREE.CylinderGeometry(1.2 + t * 5.5, 0.5 + t * 4.4, 2.4, 20, 1, true);
      const m = new THREE.Mesh(g, mat.clone());
      m.position.y = 1.2 + i * 2.1;
      m.material.opacity = 0.3 - t * 0.14;
      m.userData.spin = (1 + i * 0.35) * (i % 2 ? -1 : 1);
      group.add(m);
    }
    group.userData.mat = mat;
    return group;
  }

  _update_tornado(inst, dt) {
    const g = this.game;
    const d = inst.data;
    d.spin += dt * 4;

    // Drift with a lazy wander, but bias toward the player so it stays relevant.
    d.angle += Math.sin(inst.t * 0.35) * dt * 0.9;
    const toP = Math.atan2(g.player.x - d.x, g.player.z - d.z);
    const bias = Math.hypot(g.player.x - d.x, g.player.z - d.z) > 26 ? 0.9 : 0.12;
    d.angle = d.angle * (1 - bias * dt * 2) + toP * bias * dt * 2;
    const spd = 3.6;
    const nx = d.x + Math.sin(d.angle) * spd * dt;
    const nz = d.z + Math.cos(d.angle) * spd * dt;
    d.x = Math.max(6, Math.min(g.layout.width - 6, nx));
    d.z = Math.max(6, Math.min(g.layout.depth - 6, nz));

    d.mesh.position.set(d.x, 0, d.z);
    for (const c of d.mesh.children) c.rotation.y = d.spin * c.userData.spin;

    // Rip books off everything it touches.
    if (!(inst._bt = (inst._bt ?? 0) - dt) || inst._bt <= 0) {
      inst._bt = 0.75;
      const bays = queryBays(g.layout, d.x, d.z, d.radius);
      const n = this._knockBooksFromBays(bays, tornadoBooksPerPulse(this.mitigation), {
        force: 2.35,
        perBay: 2,
      });
      if (n) g.audio.play('bookfall', { pan: g._panFor(d.x, d.z), volume: 0.5 });
    }

    // Swirl loose items around the eye, then spit them out.
    g.items.forEachInRadius(d.x, d.z, d.radius * 1.6, (it, dist) => {
      if (it.state !== ITEM_STATE.FREE) return;
      const ang = Math.atan2(it.z - d.z, it.x - d.x);
      const tang = ang + Math.PI * 0.5;
      const pull = (1 - dist / (d.radius * 1.6)) * 26;
      it.grounded = false;
      it.vx += (Math.cos(tang) * 1.5 - Math.cos(ang) * 0.55) * pull * dt;
      it.vz += (Math.sin(tang) * 1.5 - Math.sin(ang) * 0.55) * pull * dt;
      it.vy += pull * 0.5 * dt;
      it.spin = 22;
    });

    // Debris + the pull on the player.
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * d.radius;
      g.fx.emit(d.x + Math.cos(a) * rr, Math.random() * 8, d.z + Math.sin(a) * rr, {
        vx: -Math.sin(a) * 8, vy: 3 + Math.random() * 4, vz: Math.cos(a) * 8,
        life: 1.2, size: 0.2, color: 0xd8ccb4, grav: -2, drag: 0.99,
      });
    }

    const pd = Math.hypot(g.player.x - d.x, g.player.z - d.z);
    if (pd < d.radius * 1.7) {
      const ang = Math.atan2(g.player.z - d.z, g.player.x - d.x);
      const tang = ang + Math.PI * 0.5;
      const pull = (1 - pd / (d.radius * 1.7)) * 12 * this.mitigation;
      g.player.vx += (Math.cos(tang) * 1.2 - Math.cos(ang) * 0.7) * pull * dt;
      g.player.vz += (Math.sin(tang) * 1.2 - Math.sin(ang) * 0.7) * pull * dt;
      g.camera.addTrauma(0.02);
      if (pd < d.radius * 0.55 && this.rng.bool(Math.min(1, dt * 2))) {
        g.player.damage(6 * this.mitigation, 'tornado');
        g.player.dropAll();
      }
    }
  }

  _end_tornado(inst) {
    const g = this.game;
    g.render.scene.remove(inst.data.mesh);
    inst.data.mesh.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }

  /** Remove a fixed budget from distinct nearby shelf faces. */
  _knockBooksFromBays(bays, budget, { force = 1, perBay = 2 } = {}) {
    const g = this.game;
    const pool = bays.filter((bay) => bay.filled > 0);
    let dropped = 0;
    while (dropped < budget && pool.length) {
      const index = this.rng.int(0, pool.length - 1);
      const [bay] = pool.splice(index, 1);
      const count = Math.min(perBay, budget - dropped, bay.filled);
      const items = g.items.knockOff(bay, count, { force });
      if (!items.length) continue;
      dropped += items.length;
      g.level.refreshBay(bay);
    }
    return dropped;
  }

  // --- VOLCANO --------------------------------------------------------------

  _start_volcano(inst) {
    const g = this.game;
    // Erupt somewhere open and reachable, never inside a bookcase.
    let x = g.player.x, z = g.player.z;
    for (let i = 0; i < 40; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const dd = this.rng.range(9, 20);
      const cx = g.player.x + Math.cos(a) * dd;
      const cz = g.player.z + Math.sin(a) * dd;
      if (!g.collision.isBlocked(cx, cz)) { x = cx; z = cz; break; }
    }
    inst.data.x = x; inst.data.z = z;
    inst.data.grow = 0;
    inst.data.mesh = this._buildVolcano();
    inst.data.mesh.position.set(x, 0, z);
    inst.data.mesh.scale.setScalar(0.01);
    g.render.scene.add(inst.data.mesh);
    inst.data.light = new THREE.PointLight(0xff5a1e, 0, 22, 2);
    inst.data.light.position.set(x, 2.5, z);
    g.render.scene.add(inst.data.light);
    inst.data.pool = g.fx.addDecal(x, z, { size: 6, color: 0xff5522, life: Infinity });
    inst.data.bombT = 1.6;

    g.hud.banner('VOLCANO', 'In the middle of the reading room. Naturally.');
    g.audio.play('boom', { volume: 1 });
    g.camera.addTrauma(0.6);
    g.render.shockwave(new THREE.Vector3(x, 1, z), { amplitude: 0.06, maxRadius: 1.6, speed: 2.2 });
  }

  _buildVolcano() {
    if (this._built.volcano) return this._built.volcano.clone(true);
    const rock = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.94, metalness: 0 });
    const lava = new THREE.MeshBasicMaterial({ color: 0xff6a22, toneMapped: false });
    const group = new THREE.Group();
    const coneGeo = new THREE.CylinderGeometry(1.5, 4.2, 4.2, 20, 3);
    const pos = coneGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const n = Math.sin(pos.getX(i) * 3.1) * Math.cos(pos.getZ(i) * 2.7) * 0.28;
      pos.setX(i, pos.getX(i) * (1 + n * 0.3));
      pos.setZ(i, pos.getZ(i) * (1 + n * 0.3));
    }
    coneGeo.computeVertexNormals();
    coneGeo.translate(0, 2.1, 0);
    const cone = new THREE.Mesh(coneGeo, rock);
    cone.castShadow = true;
    cone.receiveShadow = true;
    group.add(cone);
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.3, 20), lava);
    crater.position.y = 4.15;
    group.add(crater);
    this._built.volcano = group;
    return group.clone(true);
  }

  _update_volcano(inst, dt) {
    const g = this.game;
    const d = inst.data;
    d.grow = Math.min(1, d.grow + dt * 0.7);
    const fade = inst.t > inst.duration - 3 ? Math.max(0, (inst.duration - inst.t) / 3) : 1;
    d.mesh.scale.setScalar(d.grow * (0.35 + fade * 0.65));
    d.light.intensity = (28 + Math.sin(inst.t * 9) * 10) * d.grow * fade;
    d.pool.size = 6 * d.grow * fade;

    // Constant ember fountain from the crater.
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      g.fx.emit(d.x + Math.cos(a) * 0.7, 4.3 * d.grow, d.z + Math.sin(a) * 0.7, {
        vx: Math.cos(a) * 2, vy: 6 + Math.random() * 6, vz: Math.sin(a) * 2,
        life: 1.6, size: 0.22, color: Math.random() < 0.5 ? 0xff8a2a : 0xffd06a, grav: -9, drag: 0.99,
      });
    }

    // Lava bombs: telegraphed rings, then an impact that empties nearby shelves.
    d.bombT -= dt;
    if (d.bombT <= 0 && fade > 0.5) {
      d.bombT = 2.4 / this.mitigation;
      const a = this.rng.range(0, Math.PI * 2);
      const rr = this.rng.range(6, 20);
      const tx = d.x + Math.cos(a) * rr;
      const tz = d.z + Math.sin(a) * rr;
      g.fx.ring(tx, 0.06, tz, { r0: 0.3, r1: 3.2, dur: 1.1, color: 0xff5a2a });
      this._pendingImpacts.push({ x: tx, z: tz, time: 1 });
    }

    // Standing in the lava pool is exactly as bad as it looks.
    const pd = Math.hypot(g.player.x - d.x, g.player.z - d.z);
    if (pd < d.pool.size * 0.55) {
      if (this.rng.bool(Math.min(1, dt * 3))) g.player.damage(7 * this.mitigation, 'lava');
      g.camera.addTrauma(0.03);
    }
    g.render.setLensDistortion(Math.sin(inst.t * 2) * 0.012 * fade, Math.cos(inst.t * 1.7) * 0.012 * fade);
  }

  _lavaImpact(x, z) {
    const g = this.game;
    if (!g.items || (g.state !== 'playing' && g.state !== 'levelup')) return;
    g.fx.burst(x, 0.4, z, 40, { speed: 7, color: [0xff6a22, 0xffd06a, 0x2a2320], life: 1.2, size: 0.24, grav: -12 });
    g.fx.ring(x, 0.07, z, { r0: 0.4, r1: 6, dur: 0.6, color: 0xff8a3a });
    g.audio.play('boom', { pan: g._panFor(x, z), volume: 0.55 });
    g.camera.addTrauma(0.22);
    const bays = queryBays(g.layout, x, z, 5.5);
    let n = 0;
    for (const bay of bays) {
      if (bay.filled <= 0) continue;
      g.items.knockOff(bay, 2, { force: 1.8 });
      g.level.refreshBay(bay);
      if (++n >= 2) break;
    }
    const scorch = g.fx.addDecal(x, z, { size: 3.4, color: 0x1a1210, life: 14 });
    if (Math.hypot(g.player.x - x, g.player.z - z) < 3) {
      g.player.damage(14 * this.mitigation, 'lava bomb');
    }
  }

  _end_volcano(inst) {
    const g = this.game;
    g.render.scene.remove(inst.data.mesh, inst.data.light);
    inst.data.mesh.traverse((o) => { o.geometry?.dispose(); });
    g.fx.removeDecal(inst.data.pool);
    g.render.setLensDistortion(0, 0);
  }

  // --- ALIEN INVASION -------------------------------------------------------

  _start_aliens(inst) {
    const g = this.game;
    inst.data.x = g.player.x + 16;
    inst.data.z = g.player.z + 4;
    inst.data.y = Math.min(g.layout.ceilingHeight - 2.4, 7.5);
    inst.data.mesh = this._buildUFO();
    g.render.scene.add(inst.data.mesh);
    inst.data.light = new THREE.PointLight(0x66ffcc, 26, 26, 2);
    g.render.scene.add(inst.data.light);
    inst.data.beam = g.fx.createBeam(0x8fffdc, 1.3);
    inst.data.hp = 100;
    inst.data.targetBay = null;
    inst.data.beamT = 0;
    g.hud.banner('ALIEN INVASION', 'They are taking the sci-fi section. Obviously.');
    g.audio.play('alien', { volume: 1 });
  }

  _buildUFO() {
    const group = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0x9aa6b0, roughness: 0.22, metalness: 1, envMapIntensity: 2 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x66ffcc, toneMapped: false });
    const dome = new THREE.MeshPhysicalMaterial({
      color: 0x8fffdc, roughness: 0.05, metalness: 0, transmission: 0.85,
      thickness: 0.4, transparent: true, opacity: 0.55, envMapIntensity: 2,
    });
    const saucer = mergeParts([
      cyl(2.6, 3.4, 0.5, 28, 0, 0, 0),
      cyl(3.4, 2.2, 0.55, 28, 0, -0.5, 0),
      cyl(1.5, 1.8, 0.3, 24, 0, 0.35, 0),
    ]);
    const m = new THREE.Mesh(saucer, hull);
    m.castShadow = true;
    group.add(m);
    const d = new THREE.Mesh(new THREE.SphereGeometry(1.35, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), dome);
    d.position.y = 0.45;
    group.add(d);
    const lights = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      lights.push(sphere(0.16, 10, 8, Math.cos(a) * 3.0, -0.3, Math.sin(a) * 3.0));
    }
    group.add(new THREE.Mesh(ensureColorAttr(mergeParts(lights)), glow));
    // A tiny pilot, visible through the dome.
    const pilot = mergeParts([
      sphere(0.42, 14, 10, 0, 0.75, 0),
      cyl(0.22, 0.3, 0.5, 10, 0, 0.35, 0),
      cyl(0.05, 0.05, 0.35, 6, -0.18, 1.15, 0),
      cyl(0.05, 0.05, 0.35, 6, 0.18, 1.15, 0),
    ]);
    const pm = new THREE.Mesh(pilot, new THREE.MeshStandardMaterial({ color: 0x7ad9a0, roughness: 0.6 }));
    pm.position.y = 0.1;
    group.add(pm);
    group.userData.pilot = pm;
    return group;
  }

  _update_aliens(inst, dt) {
    const g = this.game;
    const d = inst.data;

    // Hover toward whichever shelf it fancies next.
    if (!d.targetBay || d.targetBay.filled <= 0 || d.beamT <= 0) {
      const bays = queryBays(g.layout, g.player.x, g.player.z, 24).filter((b) => b.filled > 0);
      d.targetBay = bays.length ? this.rng.pick(bays) : null;
      d.beamT = 3.5;
    }
    const tx = d.targetBay ? d.targetBay.wx + d.targetBay.nx * 1.6 : g.player.x;
    const tz = d.targetBay ? d.targetBay.wz + d.targetBay.nz * 1.6 : g.player.z;
    d.x += (tx - d.x) * (1 - Math.exp(-dt * 1.3));
    d.z += (tz - d.z) * (1 - Math.exp(-dt * 1.3));
    const hoverY = d.y + Math.sin(inst.t * 1.4) * 0.28;

    d.mesh.position.set(d.x, hoverY, d.z);
    d.mesh.rotation.y += dt * 0.55;
    d.mesh.rotation.z = Math.sin(inst.t * 0.9) * 0.06;
    d.light.position.set(d.x, hoverY - 1, d.z);
    d.light.intensity = 22 + Math.sin(inst.t * 8) * 8;

    d.beamT -= dt;
    if (d.targetBay) {
      const bay = d.targetBay;
      g.fx.setBeam(inst.data.beam,
        { x: d.x, y: hoverY - 0.6, z: d.z },
        { x: bay.wx, y: bay.run.height * 0.5, z: bay.wz }, 1);
      if (!(inst._at = (inst._at ?? 0) - dt) || inst._at <= 0) {
        inst._at = 1.25;
        if (bay.filled > 0) {
          const taken = g.items.knockOff(bay, 2, { force: 0.4 });
          g.level.refreshBay(bay);
          // Abducted books float up, then get dropped somewhere ridiculous.
          for (const it of taken) {
            it.vy = this.rng.range(7, 10);
            it.vx = (d.x - it.x) * 1.2;
            it.vz = (d.z - it.z) * 1.2;
            it.spin = 18;
          }
          g.audio.play('alien', { pan: g._panFor(d.x, d.z), volume: 0.35 });
        }
      }
    } else {
      g.fx.hideBeam(inst.data.beam);
    }

    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      g.fx.emit(d.x + Math.cos(a) * 3, hoverY - 0.4, d.z + Math.sin(a) * 3, {
        vy: -1.5, life: 0.7, size: 0.16, color: 0x8fffdc, grav: 0.5, drag: 0.94,
      });
    }
  }

  _end_aliens(inst, { silent = false } = {}) {
    const g = this.game;
    g.render.scene.remove(inst.data.mesh, inst.data.light);
    inst.data.mesh.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    g.fx.hideBeam(inst.data.beam);
    if (!silent) g.hud.toast('The saucer leaves. It did not check anything out.');
  }

  clear() {
    this._pendingImpacts.length = 0;
    for (const inst of this.active) {
      // Warning-phase disasters have no meshes, decals, lights, or beams yet.
      if (inst.phase === 'active') this[`_end_${inst.def.id}`]?.(inst, { silent: true });
    }
    this.active.length = 0;
    for (const m of [...this.messes]) this.removeMess(m);
  }

  dispose() { this.clear(); }
}

import * as THREE from 'three';
import { SoloCharacter } from './character.js';
import { ITEM_STATE } from '../systems/items.js';
import { nearestBay, queryBays, bayAccepts } from '../world/generator.js';
import { getCharacter } from '../data/characters.js';

const RADIUS = 0.36;
const _res = { x: 0, z: 0, hit: null };
const _dir = new THREE.Vector3();

/**
 * The Librarian. Movement, stamina, the auto-vacuum pickup that the whole game
 * loop hangs off, and the arm-load of books you're desperately trying to file.
 */
export class Player {
  constructor(game, x, z) {
    this.game = game;
    this.x = x; this.z = z;
    this.vx = 0; this.vz = 0;
    this.yaw = 0;
    this.radius = RADIUS;

    this.stats = {
      moveSpeed: 5.0,
      sprintMul: 1.5,
      pickupRadius: 2.2,
      returnRadius: 2.4,
      carrySlots: 6,
      maxStamina: 100,
      staminaRegen: 14,
      staminaDrain: 18,
      maxHealth: 100,
      regen: 1.6,             // HP/s, once you've been left alone for a moment
      regenDelay: 5,
      chaosDampening: 0,
      xpMultiplier: 1,
      pickupSpeed: 1,
      dashCooldown: 2.2,
      dashDistance: 5.4,
      magnetStrength: 1,
    };

    this.health = this.stats.maxHealth;
    this.stamina = this.stats.maxStamina;
    this.carried = [];
    this.upgradeLevels = {};

    this.sinceHurt = 99;
    this.dashTimer = 0;
    this.dashActive = 0;
    this.invuln = 0;
    this.hurtFlash = 0;

    // Status effects: slipping on a banana, mushroom growth, chilli dash, …
    this.effects = new Map();
    this.scaleMul = 1;

    this.phase = 0;
    this.anim = { phase: 0, speed: 0, lean: 0, armMode: 'swing', headYaw: 0, headPitch: 0, flail: 0, crouch: 0, hurt: 0, celebrate: 0 };

    this.character = getCharacter(game.characterId);
    this.model = new SoloCharacter(game.render.scene, game.mats, {
      height: this.character.height,
      chunk: this.character.chunk,
      style: this.character.style,
      colors: this.character.colors,
      matMap: this.character.matMap,
    });

    this.shadow = makeShadowBlob(game.render.scene, game.mats, 1.5);

    this.stepTimer = 0;
    this.lastShelveTime = -10;
    this.stats.baseMoveSpeed = this.stats.moveSpeed;
  }

  get carryY() { return 1.05 * this.scaleMul; }
  get isFull() { return this.carried.length >= this.stats.carrySlots; }

  addEffect(id, duration, data = {}) {
    this.effects.set(id, { t: duration, max: duration, ...data });
    this.game.events.emit('effect', { id, duration });
  }

  hasEffect(id) { return this.effects.has(id); }

  damage(amount, source) {
    if (this.invuln > 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.invuln = 0.7;
    this.hurtFlash = 1;
    this.sinceHurt = 0;
    this.game.camera.addTrauma(0.28);
    this.game.events.emit('playerHurt', { amount, source });
    return true;
  }

  heal(amount) {
    this.health = Math.min(this.stats.maxHealth, this.health + amount);
  }

  update(dt, input) {
    const game = this.game;

    // --- status effects
    for (const [id, e] of this.effects) {
      e.t -= dt;
      if (e.t <= 0) {
        this.effects.delete(id);
        this.game.events.emit('effectEnd', { id });
      }
    }
    const slipping = this.effects.get('slip');
    const grown = this.effects.get('grow');
    const spicy = this.effects.get('spicy');
    const heavy = this.effects.get('heavy');

    const wantScale = grown ? 1.55 : 1;
    this.scaleMul += (wantScale - this.scaleMul) * (1 - Math.exp(-dt * 7));

    // --- input → world direction
    const mv = input.moveVector();
    game.camera.inputToWorld(mv.x, mv.y, _dir);
    const inputLen = Math.hypot(_dir.x, _dir.z);

    const sprinting = input.isDown('sprint') && this.stamina > 1 && inputLen > 0.1 && !heavy;
    if (sprinting) this.stamina = Math.max(0, this.stamina - this.stats.staminaDrain * dt);
    else this.stamina = Math.min(this.stats.maxStamina, this.stamina + this.stats.staminaRegen * dt);

    let speed = this.stats.moveSpeed * (sprinting ? this.stats.sprintMul : 1);
    if (grown) speed *= 0.86;
    if (heavy) speed *= 0.58;
    if (spicy) speed *= 1.35;

    // --- dash
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    if (input.wasPressed('dash') && this.dashTimer <= 0 && inputLen > 0.05) {
      this.dashTimer = this.stats.dashCooldown;
      this.dashActive = 0.22;
      this.invuln = Math.max(this.invuln, 0.3);
      game.fx.dashBurst(this.x, 0.4, this.z, this.yaw);
      game.audio.play('dash');
    }
    if (this.dashActive > 0) {
      this.dashActive -= dt;
      speed = this.stats.dashDistance / 0.22;
    }

    // --- slipping: you keep your momentum and lose your steering
    let ax = _dir.x, az = _dir.z;
    if (slipping) {
      const s = Math.min(1, slipping.t / slipping.max);
      ax *= (1 - s * 0.9);
      az *= (1 - s * 0.9);
    }

    const targetVX = ax * speed;
    const targetVZ = az * speed;
    const accel = slipping ? 2.2 : (this.dashActive > 0 ? 40 : 22);
    this.vx += (targetVX - this.vx) * (1 - Math.exp(-dt * accel));
    this.vz += (targetVZ - this.vz) * (1 - Math.exp(-dt * accel));

    // --- move + collide
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    const r = RADIUS * this.scaleMul;
    game.collision.resolve(nx, nz, r, _res);
    const blockedX = Math.abs(_res.x - nx) > 1e-4;
    const blockedZ = Math.abs(_res.z - nz) > 1e-4;
    this.x = _res.x; this.z = _res.z;
    if (blockedX) this.vx *= 0.25;
    if (blockedZ) this.vz *= 0.25;

    const moveLen = Math.hypot(this.vx, this.vz);

    // --- facing
    if (moveLen > 0.35) {
      const want = Math.atan2(this.vx, this.vz);
      this.yaw = angleLerp(this.yaw, want, 1 - Math.exp(-dt * 13));
    }

    // --- animation
    this.phase += moveLen * dt * 2.35 / this.scaleMul;
    this.anim.phase = this.phase;
    this.anim.speed = moveLen;
    this.anim.lean = Math.min(1, moveLen / 7) * (sprinting ? 1 : 0.6);
    this.anim.armMode = this.carried.length > 0 ? 'carry' : 'swing';
    this.anim.hurt = this.hurtFlash * 0.5;
    this.anim.flail = slipping ? 1 : 0;
    this.anim.crouch = 0;

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.6);
    this.invuln = Math.max(0, this.invuln - dt);

    // Slow regeneration between scrapes. Without it a long run dies by a
    // thousand toddlers regardless of how well the shelves are going.
    this.sinceHurt += dt;
    if (this.sinceHurt > this.stats.regenDelay && this.health < this.stats.maxHealth) {
      this.health = Math.min(this.stats.maxHealth, this.health + this.stats.regen * dt);
    }

    // --- footsteps
    this.stepTimer -= moveLen * dt;
    if (this.stepTimer <= 0 && moveLen > 0.8) {
      this.stepTimer = 1.5;
      game.audio.play('step', { volume: 0.16 + moveLen * 0.02, rate: 0.9 + Math.random() * 0.25 });
    }

    // --- the core loop: vacuum items in, file them out
    this._vacuum(dt);
    this._autoShelve(dt);
    this._positionCarried();

    // --- present
    const y = 0;
    this.model.pose(this.x, y, this.z, this.yaw, this.anim, this.scaleMul);
    this.shadow.position.set(this.x, 0.015, this.z);
    const sc = (1.5 + moveLen * 0.02) * this.scaleMul;
    this.shadow.scale.set(sc, 1, sc);
    this.shadow.material.opacity = 0.4;
  }

  _vacuum(dt) {
    const game = this.game;
    if (this.isFull) return;
    const R = this.stats.pickupRadius * this.scaleMul;
    game.items.forEachInRadius(this.x, this.z, R, (it) => {
      if (it.state !== ITEM_STATE.FREE || !it.grounded) return;
      if (this.isFull) return;
      it.state = ITEM_STATE.FLYING;
      it.holder = this;
      it.age = 0;
      it.vy = 3.2;
      game.audio.play('pickup', { rate: 0.92 + Math.random() * 0.2, volume: 0.35 });
    });
  }

  onItemArrived(it) {
    if (this.carried.length >= this.stats.carrySlots) {
      it.state = ITEM_STATE.FREE;
      it.grounded = false;
      it.vy = 1.5;
      it.holder = null;
      return;
    }
    it.state = ITEM_STATE.CARRIED;
    it.holder = this;
    this.carried.push(it);
    this.game.onItemPickedUp(it);
    this._applyHazardOnPickup(it);
  }

  _applyHazardOnPickup(it) {
    if (!it.hazard) return;
    const h = it.hazard;
    if (h.effect === 'grow') { this.addEffect('grow', 12); this.game.audio.play('powerup'); }
    if (h.effect === 'dash') { this.addEffect('spicy', 8); this.game.audio.play('powerup'); }
    if (h.effect === 'heavy') this.addEffect('heavy', 6);
    if (h.effect === 'fizz') { this.game.fx.fizz(this.x, 1.2, this.z); this.game.camera.addTrauma(0.12); }
  }

  _autoShelve(dt) {
    if (!this.carried.length) return;
    const game = this.game;
    const R = this.stats.returnRadius * this.scaleMul;
    const bays = queryBays(game.layout, this.x, this.z, R);
    if (!bays.length) return;

    for (let i = this.carried.length - 1; i >= 0; i--) {
      const it = this.carried[i];
      let target = null, bestD = Infinity;
      for (const b of bays) {
        if (!bayAccepts(b, it.color)) continue;
        const d = (b.wx - this.x) ** 2 + (b.wz - this.z) ** 2;
        if (d < bestD) { bestD = d; target = b; }
      }
      if (!target) continue;
      this.carried.splice(i, 1);
      game.items.returnTo(it, target);
      this.lastShelveTime = game.clock;
    }
  }

  _positionCarried() {
    // Stack the load in front of the chest, leaning as the pile grows.
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const s = this.scaleMul;
    for (let i = 0; i < this.carried.length; i++) {
      const it = this.carried[i];
      const lift = 0.78 * s + i * 0.055 * s;
      const wob = Math.sin(this.phase * 2 + i) * 0.012;
      it.x = this.x + fx * 0.32 * s + wob;
      it.y = lift;
      it.z = this.z + fz * 0.32 * s;
      it.rx = Math.PI / 2 * 0 + 0;
      it.ry = this.yaw + (i % 2 ? 0.08 : -0.08);
      it.rz = 0;
    }
  }

  /** Nearest bay that will accept a colour we're holding — used by the HUD arrow. */
  guidanceTarget() {
    if (!this.carried.length) return null;
    const colors = new Set(this.carried.map((c) => c.color));
    let best = null, bestD = Infinity;
    for (const c of colors) {
      const b = nearestBay(this.game.layout, this.x, this.z, c, 140);
      if (!b) continue;
      const d = (b.wx - this.x) ** 2 + (b.wz - this.z) ** 2;
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  applyUpgrade(id, level, def) {
    this.upgradeLevels[id] = level;
    def.apply?.(this, level);
  }

  dropAll() {
    for (const it of this.carried) {
      it.state = ITEM_STATE.FREE;
      it.grounded = false;
      it.holder = null;
      it.vx = (Math.random() - 0.5) * 3;
      it.vy = 2 + Math.random() * 2;
      it.vz = (Math.random() - 0.5) * 3;
    }
    this.carried.length = 0;
  }

  dispose() {
    this.model.dispose();
    this.shadow.parent?.remove(this.shadow);
  }
}

export function makeShadowBlob(scene, mats, size = 1) {
  const g = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mats.shadowBlob.clone());
  m.renderOrder = 1;
  scene.add(m);
  return m;
}

export function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

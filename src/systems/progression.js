import { UPGRADES, SIGNATURE_POWER_IDS, draftUpgrades } from '../data/upgrades.js';
import { RNG } from '../core/rng.js';

export const XP_BASE = 180;
export const XP_GROWTH = 1.5;

/** XP needed to advance from the supplied run level. */
export function xpRequiredForLevel(level = 1) {
  return Math.floor(XP_BASE * Math.pow(XP_GROWTH, Math.max(0, level - 1)));
}

/** XP, levels, the level-up draft, and the small drip-feed rewards. */
export class Progression {
  constructor(game) {
    this.game = game;
    this.level = 1;
    this.xp = 0;
    this.xpToNext = xpRequiredForLevel(this.level);
    this.levels = {};             // upgradeId -> level
    this.startingGrants = {};     // from meta perks
    this.rng = new RNG(game.seed + '-draft');

    this.draftCount = 3;
    this.rerolls = 0;
    this.rerollsLeft = 0;
    this.secondWind = false;
    this.secondWindUsed = false;
    this.headStart = 0;
    this.cardMultiplier = 1;

    this.teaEvery = 0;
    this._teaCounter = 0;
    this.comboBonus = 1;
    this.comboTime = 3.2;
    this.laminatedBlockedWave = -1;
    this.tutorialPowerOffered = false;

    this.pendingLevels = 0;
    this.currentOffer = null;
  }

  /** Called by meta perks before the run starts. */
  grantStarting(id, level) {
    this.startingGrants[id] = Math.max(this.startingGrants[id] || 0, level);
  }

  /** Apply meta grants and head-start picks once the run is fully built. */
  begin() {
    this.rerollsLeft = this.rerolls;
    for (const [id, lvl] of Object.entries(this.startingGrants)) {
      for (let i = 1; i <= lvl; i++) this._take(UPGRADES[id]);
    }
    for (let i = 0; i < this.headStart; i++) {
      const options = draftUpgrades(this.rng, this.levels, 1, new Set(), this.level, this.game.theme.id);
      if (options[0]) this._take(options[0]);
      this.level++;
      this.xpToNext = xpRequiredForLevel(this.level);
    }
  }

  addXP(amount) {
    const mult = this.game.player?.stats.xpMultiplier ?? 1;
    const gained = amount * mult * (this.comboBonus ?? 1);
    this.xp += gained;
    this.game.run.xpEarned += gained;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = xpRequiredForLevel(this.level);
      this.pendingLevels++;
    }
    if (this.pendingLevels > 0 && !this.currentOffer) this._openDraft();
  }

  onShelved() {
    if (!this.teaEvery) return;
    if (++this._teaCounter >= this.teaEvery) {
      this._teaCounter = 0;
      this.game.player.heal(6);
      this.game.hud.popup(this.game.player.x, 2.0, this.game.player.z, '+6 ♥', '#6de08a');
    }
  }

  /**
   * Laminated Badge defines a wave as a fixed 60-second window from run start.
   * The timestamp-derived index means the shield resets reliably even if a
   * level-up pauses or slows the simulation between waves.
   */
  consumeLaminatedShield() {
    if ((this.levels.laminator || 0) < 1) return false;
    const wave = Math.floor((this.game.run?.elapsed || 0) / 60);
    if (wave === this.laminatedBlockedWave) return false;
    this.laminatedBlockedWave = wave;
    return true;
  }

  _ensureTutorialPower(options) {
    if (!this.game.run?.tutorialActive || this.tutorialPowerOffered || !options.length) return options;
    this.tutorialPowerOffered = true;
    if (options.some((def) => SIGNATURE_POWER_IDS.includes(def.id))) return options;

    const offered = new Set(options.map((def) => def.id));
    const powers = Object.values(UPGRADES).filter((def) => (
      SIGNATURE_POWER_IDS.includes(def.id)
      && (this.levels[def.id] || 0) < def.maxLevel
      && ((this.levels[def.id] || 0) > 0 || this.level >= (def.minDraftLevel || 1))
      && !offered.has(def.id)
    ));
    if (!powers.length) return options;
    const replacement = this.rng.pick(powers);
    return [...options.slice(0, -1), replacement];
  }

  /** Present the next draft. Returns false when there is nothing left to offer. */
  _openDraft() {
    // Every upgrade maxed out is a real end-state, not a bug — convert the
    // remaining levels into health so the run never stalls on an empty screen.
    while (this.pendingLevels > 0) {
      const options = this._ensureTutorialPower(draftUpgrades(
        this.rng,
        this.levels,
        this.draftCount,
        new Set(),
        this.level,
        this.game.theme.id,
      ));
      if (options.length) {
        this.currentOffer = options;
        this.game.state = 'levelup';
        this.game.input.enabled = false;
        this.game.audio.play('levelup');
        this.game.menus.showLevelUp(options, this.level, this.rerollsLeft);
        return true;
      }
      this.pendingLevels--;
      this.game.player.heal(25);
      this.game.hud.popup(this.game.player.x, 2.0, this.game.player.z, 'MASTERED +25 ♥', '#6de08a');
    }
    this._resume();
    return false;
  }

  _resume() {
    this.currentOffer = null;
    if (this.game.state !== 'levelup') return;
    this.game.state = 'playing';
    this.game.input.enabled = true;
    this.game.menus.hideAll();
  }

  reroll() {
    if (this.game.state !== 'levelup' || this.rerollsLeft <= 0 || !this.currentOffer) return false;
    this.rerollsLeft--;
    const exclude = new Set(this.currentOffer.map((o) => o.id));
    let options = draftUpgrades(this.rng, this.levels, this.draftCount, exclude, this.level, this.game.theme.id);
    if (!options.length) options = draftUpgrades(
      this.rng,
      this.levels,
      this.draftCount,
      new Set(),
      this.level,
      this.game.theme.id,
    );
    this.currentOffer = options;
    this.game.audio.play('ui');
    this.game.menus.showLevelUp(options, this.level, this.rerollsLeft);
    return true;
  }

  choose(id) {
    if (this.game.state !== 'levelup' || !this.currentOffer?.some((option) => option.id === id)) return false;
    const def = UPGRADES[id];
    if (!def) return false;
    this._take(def);
    this.currentOffer = null;
    this.pendingLevels--;
    this.game.audio.play('powerup');
    this.game.fx.ring(this.game.player.x, 0.1, this.game.player.z, { r0: 0.5, r1: 7, dur: 0.8, color: 0xffd98a });
    this.game.fx.burst(this.game.player.x, 1.2, this.game.player.z, 40, { speed: 5, color: [0xffd98a, 0xffffff, 0xffb45c], life: 1.1, size: 0.2, grav: -3 });

    if (this.pendingLevels > 0) this._openDraft();
    else this._resume();
    return true;
  }

  cancelDraft() {
    this.currentOffer = null;
    this.pendingLevels = 0;
  }

  _take(def) {
    if (!def) return;
    const next = (this.levels[def.id] || 0) + 1;
    this.levels[def.id] = next;
    this.game.player.applyUpgrade(def.id, next, def);
    this.game.events.emit('upgrade', { id: def.id, level: next, def });
  }

  update(dt) {
    // Second Wind: catch a run-ending chaos spike once.
    const r = this.game.run;
    if (this.secondWind && !this.secondWindUsed && r.chaos >= r.maxChaos) {
      this.secondWindUsed = true;
      r.chaos = r.maxChaos * 0.6;
      this.game.player.heal(40);
      this.game.camera.addTrauma(0.8);
      this.game.fx.ring(this.game.player.x, 0.1, this.game.player.z, { r0: 1, r1: 22, dur: 1.2, color: 0xff7ac0 });
      this.game.audio.play('powerup');
      this.game.hud.banner('SECOND WIND', 'You are not done here.');
    }
  }

  get progress() { return this.xp / this.xpToNext; }
}

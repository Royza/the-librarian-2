import assert from 'node:assert/strict';
import test from 'node:test';

import { SaveData } from '../src/core/save.js';
import { META } from '../src/data/meta.js';
import { UPGRADES } from '../src/data/upgrades.js';
import { Player, derivePlayerStats } from '../src/entities/player.js';
import { Game } from '../src/game.js';
import { Progression } from '../src/systems/progression.js';
import { PowerSystem } from '../src/systems/powers.js';

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
}

test('permanent, run, and character bonuses compose regardless of source', () => {
  const stats = derivePlayerStats(
    {
      tenure: 2,
      goodShoes: 2,
      sturdySpine: 2,
      espresso: 2,
      longReach: 2,
      unionRep: 3,
      overtime: 4,
      insurance: 2,
      janitorial: 2,
    },
    {
      backpack: 3,
      comfyShoes: 2,
      longArms: 2,
      shelfSense: 2,
      zenFocus: 4,
      readingGlasses: 3,
      fitness: 2,
      laminator: 2,
      fireDrill: 2,
      janitor: 2,
    },
    { pickupRadius: 0.35, returnRadius: 0.2, carrySlots: -1, moveSpeedMul: 0.97 },
  );

  assert.equal(stats.carrySlots, 15);
  closeTo(stats.pickupRadius, 4.25, 'pickup radius');
  closeTo(stats.returnRadius, 4.9, 'return radius');
  assert.equal(stats.chaosDampening, 32);
  closeTo(stats.xpMultiplier, 1.62, 'XP multiplier');
  closeTo(stats.disasterMitigation, 0.532, 'disaster mitigation');
  closeTo(stats.disasterDurationScale, 0.7, 'disaster duration');
  closeTo(stats.mopSpeed, 2, 'mop speed');
  assert.equal(stats.maxHealth, 190);
  assert.equal(stats.maxStamina, 190);
  closeTo(stats.baseMoveSpeed, 5 * 1.08 * 0.97, 'character-adjusted base speed');
  closeTo(stats.moveSpeed, 5 * 1.08 * 0.97 * 1.16, 'composed movement speed');
});

test('refreshDerivedStats mirrors composable disaster values without erasing resources', () => {
  const fake = {
    metaLevels: { insurance: 1, janitorial: 2 },
    upgradeLevels: { fireDrill: 2, janitor: 2 },
    character: { bonuses: {} },
    stats: derivePlayerStats(),
    health: 75,
    stamina: 60,
    game: { disasters: {} },
  };

  Player.prototype.refreshDerivedStats.call(fake);
  closeTo(fake.game.disasters.mitigation, 0.85 * 0.76, 'mirrored mitigation');
  closeTo(fake.game.disasters.durationScale, 0.7, 'mirrored duration');
  closeTo(fake.game.disasters.mopSpeed, 2, 'mirrored mop speed');
  assert.equal(fake.health, 75);
  assert.equal(fake.stamina, 60);
});

test('Overtime applies its Library Card payout multiplier', () => {
  globalThis.localStorage = new MemoryStorage();
  const save = new SaveData();
  const cards = save.addLifetime(400, 100, 'library', false, 1.4);
  assert.equal(cards, 14);
  assert.equal(save.cards, 14);
  assert.equal(save.lastCardsEarned, 14);
});

test('meta levels derive together and starting licenses apply when progression begins', () => {
  globalThis.localStorage = new MemoryStorage();
  const save = new SaveData();
  save.data.meta = { tenure: 2, longReach: 2, overtime: 3, beamLicense: 2 };

  const powerLevels = {};
  const game = {
    seed: 'meta-start-test',
    run: { elapsed: 0, xpEarned: 0 },
    disasters: {},
    powers: { setLevel: (id, level) => { powerLevels[id] = level; } },
    events: { emit() {} },
  };
  const progression = new Progression(game);
  game.progression = progression;
  const player = {
    game,
    character: { bonuses: {} },
    metaLevels: {},
    upgradeLevels: {},
    stats: derivePlayerStats(),
    health: 100,
    stamina: 100,
    setMetaLevels: Player.prototype.setMetaLevels,
    refreshDerivedStats: Player.prototype.refreshDerivedStats,
    applyUpgrade: Player.prototype.applyUpgrade,
  };
  game.player = player;

  save.applyMeta(player, progression);
  assert.equal(player.stats.carrySlots, 10);
  closeTo(player.stats.pickupRadius, 2.8, 'meta pickup radius');
  closeTo(player.stats.xpMultiplier, 1.24, 'meta XP multiplier');
  assert.equal(progression.cardMultiplier, 1.24);

  progression.begin();
  assert.equal(progression.levels.gravityGun, 2);
  assert.equal(powerLevels.gravityGun, 2);
});

test('legacy saves migrate tutorial, accessibility, binding, and daily structures', () => {
  const legacy = {
    lifetimeXP: 100,
    settings: { music: 0.2 },
    meta: { overtime: 2, beamLicence: 2, boomerangLicence: 1, colourTheory: 3 },
  };
  globalThis.localStorage = new MemoryStorage({ 'librarian2.save.v1': JSON.stringify(legacy) });
  const save = new SaveData();

  assert.equal(save.settings.music, 0.2);
  assert.equal(save.settings.tutorials, true);
  assert.equal(save.settings.colorLabels, false);
  assert.equal(save.settings.reducedMotion, false);
  assert.equal(save.settings.invertCameraY, true);
  assert.equal(save.settings.textScale, 1);
  assert.deepEqual(save.settings.keyBindings, {});
  assert.equal(save.shouldShowIntroTutorial(), true);
  assert.equal(save.metaLevel('beamLicense'), 2);
  assert.equal(save.metaLevel('boomerangLicense'), 1);
  assert.equal(save.metaLevel('colorTheory'), 3);
  assert.equal(save.data.meta.beamLicence, undefined);
  assert.equal(save.data.meta.boomerangLicence, undefined);
  assert.equal(save.data.meta.colourTheory, undefined);

  save.beginIntroTutorial();
  assert.equal(save.shouldShowIntroTutorial(), false);
  save.markTutorialSeen('karen');
  assert.equal(save.hasSeenTutorial('karen'), true);
  save.resetTutorials();
  assert.equal(save.shouldShowIntroTutorial(), true);
  assert.equal(save.hasSeenTutorial('karen'), false);

  const first = save.recordDaily('2026-08-07', 'library', 1200, false);
  const second = save.recordDaily('2026-08-07', 'library', 900, true);
  assert.equal(first.score, 1200);
  assert.equal(second.score, 1200);
  assert.equal(second.won, true);
  assert.equal(second.attempts, 2);
});

test('a corrupted local save falls back to a complete fresh profile', () => {
  globalThis.localStorage = new MemoryStorage({ 'librarian2.save.v1': '{not valid json' });
  const save = new SaveData();
  assert.equal(save.data.runs, 0);
  assert.equal(save.data.wins, 0);
  assert.deepEqual(save.data.meta, {});
  assert.equal(save.settings.tutorials, true);
  assert.equal(save.settings.invertCameraY, true);
  assert.deepEqual(save.settings.keyBindings, {});
  assert.deepEqual(save.data.dailyBests, {});
});

test('standard vertical camera drag persists and reset restores the inverted default', () => {
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  const save = new SaveData();

  save.setSetting('invertCameraY', false);
  assert.equal(new SaveData().settings.invertCameraY, false);

  save.reset();
  assert.equal(save.settings.invertCameraY, true);
  assert.equal(new SaveData().settings.invertCameraY, true);
});

test('existing profiles adopt the inverted default once without erasing later choices', () => {
  const storage = new MemoryStorage({
    'librarian2.save.v1': JSON.stringify({
      lifetimeXP: 68000,
      settings: { invertCameraY: false, music: 0.2 },
    }),
  });
  globalThis.localStorage = storage;

  const migrated = new SaveData();
  assert.equal(migrated.settings.invertCameraY, true);
  assert.equal(migrated.settings.music, 0.2, 'unrelated settings survive the migration');
  assert.equal(migrated.data.settingsRevision, 2);

  migrated.setSetting('invertCameraY', false);
  const reloaded = new SaveData();
  assert.equal(reloaded.settings.invertCameraY, false, 'a post-migration choice remains explicit');
  assert.equal(reloaded.data.settingsRevision, 2);
});

test('branches unlock through either lifetime XP or wins and report the nearer route', () => {
  globalThis.localStorage = new MemoryStorage();
  const save = new SaveData();
  assert.deepEqual(save.unlockedThemes(), ['cemetery', 'library']);
  assert.equal(save.nextUnlock().remainingText, '1 more win');

  save.data.wins = 1;
  assert.equal(save.isThemeUnlocked('videostore'), true);
  assert.equal(save.nextUnlock().remainingText, '2 more wins');

  save.data.wins = 0;
  save.data.lifetimeXP = 33000;
  assert.equal(save.isThemeUnlocked('recordstore'), false);
  assert.equal(save.nextUnlock().theme.id, 'recordstore');
  assert.equal(save.nextUnlock().route, 'xp');
  save.data.lifetimeXP = 34000;
  assert.equal(save.isThemeUnlocked('recordstore'), true);
});

test('Laminated Badge blocks exactly the first damaging hit in each 60-second wave', () => {
  const game = { seed: 'badge-test', run: { elapsed: 12 } };
  const progression = new Progression(game);
  game.progression = progression;
  progression.levels.laminator = 1;

  const events = [];
  const player = {
    x: 4,
    z: 6,
    invuln: 0,
    health: 100,
    hurtFlash: 0,
    sinceHurt: 99,
    carried: [],
    game: {
      progression,
      audio: { play() {} },
      fx: { ring() {} },
      hud: { popup() {} },
      camera: { addTrauma() {} },
      events: { emit: (...args) => events.push(args) },
    },
    _breakFragile() {},
  };

  assert.equal(Player.prototype.damage.call(player, 10, 'kid'), false);
  assert.equal(player.health, 100);
  player.invuln = 0;
  assert.equal(Player.prototype.damage.call(player, 10, 'kid'), true);
  assert.equal(player.health, 90);
  game.run.elapsed = 60;
  player.invuln = 0;
  assert.equal(Player.prototype.damage.call(player, 10, 'tornado'), false);
  assert.equal(player.health, 90);
  assert.equal(events.filter(([name]) => name === 'damageBlocked').length, 2);
});

test('Overdue Fines controls the real shelving combo timer', () => {
  const calls = { xp: [] };
  const context = {
    run: { shelved: 0, combo: 0, comboTimer: 0, bestCombo: 0, chaos: 10 },
    progression: {
      comboTime: 4.8,
      addXP: (amount) => calls.xp.push(amount),
      onShelved() {},
    },
    audio: { play() {} },
    fx: { sparkle() {} },
    level: { refreshBay() {} },
    hud: { popup() {} },
    events: { emit() {} },
    branchMechanics: null,
    telemetry: null,
    _panFor: () => 0,
  };
  const bay = { wx: 2, wz: 3, nx: 1, nz: 0, run: { height: 2 } };
  Game.prototype.onItemShelved.call(context, { color: 'crimson' }, bay);
  assert.equal(context.run.comboTimer, 4.8);
  assert.deepEqual(calls.xp, [11]);
});

test('the first tutorial draft always contains a signature power', () => {
  const game = { seed: 'tutorial-draft', run: { tutorialActive: true } };
  const progression = new Progression(game);
  const passiveOffer = [UPGRADES.longArms, UPGRADES.zenFocus, UPGRADES.fitness];
  const offer = progression._ensureTutorialPower(passiveOffer);
  assert.equal(offer.length, 3);
  assert.ok(offer.some((upgrade) => upgrade.kind === 'power'));
  assert.equal(progression._ensureTutorialPower(passiveOffer), passiveOffer);
});

test('tutorial power guarantee cannot be satisfied by the passive Backpack', () => {
  const game = { seed: 'tutorial-with-license', run: { tutorialActive: true } };
  const progression = new Progression(game);
  progression.levels.gravityGun = 2;
  const offer = progression._ensureTutorialPower([UPGRADES.backpack, UPGRADES.longArms, UPGRADES.fitness]);
  assert.equal(UPGRADES.backpack.kind, 'passive');
  assert.ok(offer.some((upgrade) => ['gravityGun', 'bookerang', 'colorPulse'].includes(upgrade.id)));
});

test('upgrade copy describes the implemented combo shield and payout behavior', () => {
  assert.match(UPGRADES.laminator.desc(1), /60-second shift wave/);
  assert.match(UPGRADES.overdueFines.desc(2), /0\.8 s longer/);
  assert.match(META.overtime.desc(3), /Library Card payouts/);
  assert.match(UPGRADES.gravityGun.desc(3), /1\.5 s longer/);
  assert.match(UPGRADES.colorPulse.desc(1), /every nearby book/);
  assert.match(UPGRADES.colorPulse.desc(4), /auto-files stray books/);
  assert.match(UPGRADES.cartography.desc(2), /\+28 m/);
  assert.match(UPGRADES.cartography.desc(2), /Core objective markers remain visible for everyone/);
});

test('upgrade copy announces transformations at the level they activate', () => {
  const power = { levels: { colorPulse: 2 } };
  assert.equal(PowerSystem.prototype.stat.call(power, 'colorPulse', 'colors'), 2);
  assert.match(UPGRADES.colorPulse.desc(2), /2 colors/);
  assert.match(UPGRADES.colorPulse.desc(4), /cooldown −14%/);
  assert.match(UPGRADES.bookerang.desc(2), /cooldown −15%/);

  const game = { kids: {}, progression: { levels: {} } };
  UPGRADES.kidWhisperer.apply({ game }, 1);
  assert.equal(game.kids.repelRadius, 2.4);
  assert.match(UPGRADES.kidWhisperer.desc(1), /2\.4 m/);
});

test('a terminal run rejects stale draft choices and rerolls', () => {
  const game = { state: 'victory', seed: 'terminal-draft' };
  const progression = new Progression(game);
  progression.currentOffer = [UPGRADES.longArms];
  progression.rerollsLeft = 1;
  assert.equal(progression.choose('longArms'), false);
  assert.equal(progression.reroll(), false);
  assert.deepEqual(progression.levels, {});
  progression.cancelDraft();
  assert.equal(progression.currentOffer, null);
  assert.equal(progression.pendingLevels, 0);
});

test('fragile groceries become a cleanable mess on impact', () => {
  const item = { hazard: { effect: 'fragile' } };
  const calls = { released: [], messes: [], events: [] };
  const player = {
    x: 8,
    z: 9,
    carried: [item],
    fragileCooldown: 0,
    game: {
      items: { release: (it) => calls.released.push(it) },
      disasters: { addMess: (...args) => calls.messes.push(args) },
      audio: { play() {} },
      fx: { burst() {} },
      hud: { popup() {} },
      events: { emit: (...args) => calls.events.push(args) },
    },
  };

  assert.equal(Player.prototype._breakFragile.call(player, 'dash'), true);
  assert.equal(player.carried.length, 0);
  assert.deepEqual(calls.released, [item]);
  assert.equal(calls.messes[0][2].kind, 'brokenEgg');
  assert.equal(calls.events[0][0], 'fragileBroken');
});

test('slip hazards activate the steering-loss effect on pickup', () => {
  const calls = { effects: [], audio: [] };
  const player = {
    game: { audio: { play: (...args) => calls.audio.push(args) } },
    addEffect: (...args) => calls.effects.push(args),
  };
  Player.prototype._applyHazardOnPickup.call(player, { hazard: { effect: 'slip' } });
  assert.deepEqual(calls.effects, [['slip', 5]]);
  assert.equal(calls.audio[0][0], 'whoosh');
});

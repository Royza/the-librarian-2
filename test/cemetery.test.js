import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CHARACTER, getCharacter } from '../src/data/characters.js';
import { CEMETERY_UPGRADE_IDS, draftUpgrades } from '../src/data/upgrades.js';
import { THEMES } from '../src/data/themes.js';
import { RNG } from '../src/core/rng.js';
import { pointInMeleeArc } from '../src/entities/vampire.js';
import { derivePlayerStats } from '../src/entities/player.js';
import { META, metaPresentation } from '../src/data/meta.js';
import { generateLayout } from '../src/world/generator.js';
import { cemeteryPressureRate } from '../src/systems/chaos.js';

test('the default vertical slice is Buffy in a generated outdoor cemetery', () => {
  assert.equal(DEFAULT_CHARACTER, 'buffy');
  assert.equal(getCharacter().id, 'buffy');
  const layout = generateLayout('cemetery-vertical-slice', THEMES.cemetery);
  assert.equal(layout.outdoor, true);
  assert.equal(layout.shelfRuns.length, 0);
  assert.ok(layout.vampireSpawns.length >= 20);
  assert.ok(layout.paths.length >= 3);
  for (const kind of ['mausoleum', 'crypt', 'obelisk', 'stoneAngel', 'gnarledTree', 'cemeteryGate']) {
    assert.ok(layout.props.some((prop) => prop.kind === kind), `cemetery is missing ${kind}`);
  }
});

test('cemetery drafts contain only coherent Slayer upgrades', () => {
  const offers = draftUpgrades(new RNG('slayer-draft'), {}, 8, new Set(), 2, 'cemetery');
  assert.equal(offers.length, 8);
  assert.ok(offers.every((offer) => CEMETERY_UPGRADE_IDS.includes(offer.id)));
  assert.equal(new Set(offers.map((offer) => offer.id)).size, offers.length);
});

test('melee arcs are forgiving in front and reject threats behind Buffy', () => {
  assert.equal(pointInMeleeArc(0, 0, 0, 0.8, 2.1, 2.3, Math.PI * 0.72), true);
  assert.equal(pointInMeleeArc(0, 0, 0, -0.8, 2.1, 2.3, Math.PI * 0.72), true);
  assert.equal(pointInMeleeArc(0, 0, 0, 0, -1, 2.3, Math.PI * 0.72), false);
  assert.equal(pointInMeleeArc(0, 0, 0, 0, 3.2, 2.3, Math.PI), false);
});

test('permanent progression presents and applies as Slayer training in cemetery mode', () => {
  assert.equal(metaPresentation(META.tenure, 'cemetery').name, "Slayer's Arsenal");
  assert.equal(metaPresentation(META.beamLicense, 'cemetery').name, 'Sharpened Stakes');
  const stats = derivePlayerStats(
    { tenure: 2, longReach: 2, insurance: 2, janitorial: 2 },
    {},
    {},
    'cemetery',
  );
  assert.ok(stats.stakeDamage > 34);
  assert.equal(stats.attackRange, 2.49);
  assert.equal(stats.vampireMitigation, 0.8);
  assert.ok(stats.staminaRegen > 14);
});

test('cemetery licenses grant Slayer upgrades instead of librarian powers', () => {
  const grants = [];
  const player = { game: { theme: { id: 'cemetery' } } };
  const progression = { grantStarting: (id, level) => grants.push([id, level]) };
  META.beamLicense.apply(player, 2, progression);
  META.boomerangLicense.apply(player, 1, progression);
  META.colorTheory.apply(player, 3, progression);
  assert.deepEqual(grants, [['stakeDamage', 2], ['wideArc', 1], ['criticalStake', 3]]);
});

test('Hellmouth pressure punishes passivity but rewards a steady patrol', () => {
  const duration = 15 * 60;
  let passive = 0;
  let steady = 0;
  for (let elapsed = 0; elapsed < duration; elapsed++) {
    // A deliberately conservative late-patrol load: eighteen normal vampires.
    const rate = cemeteryPressureRate({ elapsed, duration, activity: 18 * 0.85 });
    passive += rate;
    steady += rate;
    if (elapsed > 0 && elapsed % 20 === 0) steady = Math.max(0, steady - 4);
  }
  assert.ok(passive > 100, 'ignoring a full cemetery must end the patrol');
  assert.ok(steady < 100, 'three normal dustings per minute must be sustainable');
});

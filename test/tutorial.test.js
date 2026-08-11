import assert from 'node:assert/strict';
import test from 'node:test';

import { TutorialSystem } from '../src/systems/tutorial.js';
import { UPGRADES } from '../src/data/upgrades.js';

function fakeElement() {
  const nodes = new Map();
  return {
    hidden: false,
    attrs: new Map(),
    classList: { values: new Set(), add(v) { this.values.add(v); }, remove(v) { this.values.delete(v); } },
    style: { setProperty() {} },
    setAttribute(name, value) { this.attrs.set(name, value); },
    querySelector(sel) {
      if (!nodes.has(sel)) nodes.set(sel, { textContent: '' });
      return nodes.get(sel);
    },
  };
}

function makeGame() {
  const seen = new Set();
  const calls = { begin: 0, xp: [], banners: [] };
  const bay = { wx: 4, wz: 0, nx: 1, nz: 0, filled: 5, color: 'crimson' };
  const item = { active: true, state: 0, color: 'crimson', x: 5.25, y: 0.3, z: 0, vx: 0, vy: 0, vz: 0 };
  const game = {
    state: 'playing',
    theme: { id: 'library', colors: ['crimson'], itemNoun: 'book', itemNounPlural: 'books' },
    run: { tutorialActive: false, pickedUp: 0, shelved: 0 },
    player: { x: 0, z: 0, vx: 0, vz: 0, carried: [], dashActive: 0 },
    camera: { yaw: 0 },
    collision: { isBlocked: () => false },
    pathfinder: { find: () => [{ x: 5.25, z: 0 }] },
    layout: { bayIndexCell: 10, bayIndex: new Map([['0,0', [bay]]]) },
    items: {
      knockOff: () => { bay.filled--; item.active = true; return [item]; },
      spawn: () => item,
      release: (it) => { it.active = false; },
    },
    level: { refreshBay() {} },
    hud: { banner: (...args) => calls.banners.push(args) },
    input: {
      usingGamepad: false,
      sprinting: false,
      powerPressed: false,
      bindingFor: (id) => ({ sprint: 'ShiftLeft', dash: 'Space', gravityGun: 'KeyQ' })[id] || 'KeyF',
      isDown: (id) => id === 'sprint' && game.input.sprinting,
      wasPressed: (id) => id === 'gravityGun' && game.input.powerPressed,
    },
    progression: {
      currentOffer: null, xp: 0, xpToNext: 120,
      addXP: (amount) => calls.xp.push(amount),
    },
    save: {
      tutorialsEnabled: true,
      shouldShowIntroTutorial: () => calls.begin === 0,
      beginIntroTutorial: () => { calls.begin++; },
      hasSeenTutorial: (id) => seen.has(id),
      markTutorialSeen: (id) => seen.add(id),
    },
  };
  return { game, calls, item };
}

test('first-run tutorial creates one announced reachable item and advances only through player actions', () => {
  const { game, calls, item } = makeGame();
  const tutorial = new TutorialSystem(game, fakeElement());
  tutorial.onEvent('runStart');
  assert.equal(game.run.tutorialActive, true);
  assert.equal(tutorial.step, 'move');
  assert.equal(calls.begin, 1);

  game.player.x = 3;
  tutorial.update(0.016);
  assert.equal(tutorial.step, 'pickup');
  assert.equal(tutorial.practiceItem, item);
  assert.match(calls.banners.at(-1)[0], /PRACTICE BOOK/);

  game.run.pickedUp = 1;
  game.player.carried.push(item);
  tutorial.update(0.016);
  assert.equal(tutorial.step, 'shelve');

  game.run.shelved = 1;
  tutorial.update(0.016);
  assert.equal(tutorial.step, 'mobility');
  game.player.vx = 3;
  game.input.sprinting = true;
  game.player.dashActive = 0.1;
  tutorial.update(0.016);
  assert.equal(tutorial.step, 'upgrade');
  tutorial.update(0.5);
  assert.ok(calls.xp[0] >= 120);

  tutorial.onEvent('upgrade', { id: 'gravityGun', def: UPGRADES.gravityGun });
  assert.equal(tutorial.step, 'power');
  tutorial.onEvent('power', { id: 'gravityGun', hits: 1 });
  assert.equal(game.run.tutorialActive, false);
  assert.equal(tutorial.activeIntro, false);
  assert.equal(game.run.pickedUp, 0);
  assert.equal(game.run.shelved, 0);
  assert.equal(game.run.bestCombo, 0);
  assert.equal(game.run.xpEarned, 0);
});

test('the consumed first-run tutorial does not restart on the next run', () => {
  const { game, calls } = makeGame();
  const tutorial = new TutorialSystem(game, fakeElement());
  tutorial.onEvent('runStart');
  assert.equal(calls.begin, 1);
  tutorial.onEvent('runEnd');
  tutorial.onEvent('runStart');
  assert.equal(calls.begin, 1);
  assert.equal(tutorial.activeIntro, false);
  assert.equal(game.run.tutorialActive, false);
});

test('a delayed first-time guide is persisted only once it is actually shown', () => {
  const { game } = makeGame();
  game.save.shouldShowIntroTutorial = () => false;
  const tutorial = new TutorialSystem(game, fakeElement());
  tutorial.onEvent('runStart');
  assert.equal(game.save.hasSeenTutorial('branch:library'), false);

  tutorial.onEvent('runEnd');
  assert.equal(game.save.hasSeenTutorial('branch:library'), false);
  tutorial.onEvent('runStart');
  tutorial.update(3.3);
  assert.equal(game.save.hasSeenTutorial('branch:library'), true);
});

test('an event brief queued behind another notice is not lost on run end', () => {
  const { game } = makeGame();
  game.save.shouldShowIntroTutorial = () => false;
  const tutorial = new TutorialSystem(game, fakeElement());
  tutorial.onEvent('runStart');
  tutorial.onEvent('mess');
  assert.equal(game.save.hasSeenTutorial('event:mess'), false);
  tutorial.onEvent('runEnd');
  assert.equal(game.save.hasSeenTutorial('event:mess'), false);
});

test('tutorial live regions write only when mobility or Karen state changes', () => {
  const { game } = makeGame();
  const element = fakeElement();
  const tutorial = new TutorialSystem(game, element);
  let writes = 0;
  tutorial._show = () => { writes++; };

  tutorial._showMobility();
  tutorial._showMobility();
  assert.equal(writes, 1);
  tutorial.didSprint = true;
  tutorial._showMobility();
  assert.equal(writes, 2);

  game.bosses = { active: [{
    alive: true, type: { id: 'karen' }, demandColor: 'crimson', demandLeft: 8, demandTotal: 8,
  }] };
  tutorial._refreshKarenNotice();
  tutorial._refreshKarenNotice();
  assert.equal(writes, 3);
  game.bosses.active[0].demandLeft = 7;
  tutorial._refreshKarenNotice();
  assert.equal(writes, 4);
});

test('hidden tutorial cards leave the accessibility tree until shown', () => {
  const { game } = makeGame();
  const element = fakeElement();
  const tutorial = new TutorialSystem(game, element);
  assert.equal(element.hidden, true);
  assert.equal(element.attrs.get('aria-hidden'), 'true');
  tutorial._show({ eyebrow: 'FIRST', title: 'MOVE', body: 'Move now.' });
  assert.equal(element.hidden, false);
  assert.equal(element.attrs.get('aria-hidden'), 'false');
  tutorial._hide();
  assert.equal(element.hidden, true);
  assert.equal(element.attrs.get('aria-hidden'), 'true');
});

test('pause and draft overlays freeze tutorial delays', () => {
  const { game, calls } = makeGame();
  const tutorial = new TutorialSystem(game, fakeElement());
  tutorial.onEvent('runStart');
  tutorial.step = 'upgrade';
  tutorial._stepDelay = 0.45;

  game.state = 'paused';
  tutorial.update(2);
  assert.equal(tutorial._stepDelay, 0.45);
  assert.deepEqual(calls.xp, []);

  game.state = 'levelup';
  tutorial.update(2);
  assert.equal(tutorial._stepDelay, 0.45);
  assert.deepEqual(calls.xp, []);

  game.state = 'playing';
  tutorial.update(0.5);
  assert.ok(calls.xp[0] >= 120);
});

test('a first-ever daily shift keeps guided training for a fair regular run', () => {
  const { game, calls } = makeGame();
  game.run.isDaily = true;
  const tutorial = new TutorialSystem(game, fakeElement());
  tutorial.onEvent('runStart');
  assert.equal(tutorial.activeIntro, false);
  assert.equal(game.run.tutorialActive, false);
  assert.equal(calls.begin, 0);
  assert.equal(tutorial.notice?.title, 'DAILY SHIFT · STANDARD START');
});

for (const id of ['gravityGun', 'bookerang', 'colorPulse']) {
  test(`${id} training completes only after a successful power effect`, () => {
    const { game } = makeGame();
    const tutorial = new TutorialSystem(game, fakeElement());
    tutorial.onEvent('runStart');
    tutorial.step = 'upgrade';
    tutorial.onEvent('upgrade', { id, def: UPGRADES[id] });
    assert.equal(tutorial.step, 'power');
    assert.ok(tutorial.powerTarget?.item);
    tutorial.onEvent('power', { id, hits: 0 });
    assert.equal(tutorial.activeIntro, true);
    tutorial.onEvent('power', { id, hits: 1 });
    assert.equal(tutorial.activeIntro, false);
    assert.equal(game.run.tutorialActive, false);
    assert.equal(tutorial.powerTarget, null);
  });
}

test('controller power training names the real button and highlights its HUD tile', () => {
  const { game } = makeGame();
  const element = fakeElement();
  game.input.usingGamepad = true;
  const tutorial = new TutorialSystem(game, element);
  tutorial.onEvent('runStart');
  tutorial.step = 'upgrade';
  tutorial.onEvent('upgrade', { id: 'bookerang', def: UPGRADES.bookerang });

  assert.equal(tutorial.powerAction, 'bookerang');
  assert.match(element.querySelector('.tutorial-key').textContent, /Y \/ RB/);
  assert.match(element.querySelector('.tutorial-key').textContent, /HIGHLIGHTED BELOW/);
});

test('controller clean-up event briefs name the real mop button', () => {
  const { game } = makeGame();
  game.input.usingGamepad = true;
  game.save.shouldShowIntroTutorial = () => false;
  const tutorial = new TutorialSystem(game, fakeElement());
  tutorial.onEvent('runStart');
  tutorial.onEvent('mess');

  const mess = tutorial.notice?.id === 'mess'
    ? tutorial.notice
    : tutorial.noticeQueue.find((notice) => notice.id === 'mess');
  assert.ok(mess);
  assert.match(mess.body, /hold B/i);
});

test('level-four Shush training cannot leak its sorting field into scored play', () => {
  const { game } = makeGame();
  game.powers = {
    levels: { quietPlease: 1 },
    cooldowns: { colorPulse: 9, quietPlease: 0 },
    sortField: { x: 1, z: 2, radius: 8, t: 7 },
    sortFieldTick: 0.28,
    beamTimer: 0.42,
    quietActive: 2,
    stat: (id, key) => id === 'quietPlease' && key === 'cooldown' ? 52 : 0,
  };
  game.run.chaosFrozen = true;
  const tutorial = new TutorialSystem(game, fakeElement());
  tutorial.onEvent('runStart');
  tutorial.step = 'upgrade';
  tutorial.onEvent('upgrade', { id: 'colorPulse', def: UPGRADES.colorPulse });
  tutorial.onEvent('power', { id: 'colorPulse', hits: 1 });

  assert.equal(game.powers.sortField, null);
  assert.equal(game.powers.sortFieldTick, 0);
  assert.equal(game.powers.beamTimer, 0);
  assert.equal(game.powers.cooldowns.colorPulse, 0);
  assert.equal(game.powers.cooldowns.quietPlease, 52);
  assert.equal(game.run.chaosFrozen, false);
});

for (const step of ['move', 'pickup', 'shelve', 'mobility', 'upgrade', 'power']) {
  test(`abandoning during ${step} training clears all practice rewards`, () => {
    const { game } = makeGame();
    const tutorial = new TutorialSystem(game, fakeElement());
    tutorial.onEvent('runStart');
    tutorial.step = step;
    game.run.pickedUp = 2;
    game.run.shelved = 1;
    game.run.combo = 1;
    game.run.bestCombo = 1;
    game.run.xpEarned = 150;
    game.progression.xp = 30;
    assert.equal(tutorial.prepareRunEnd(), true);
    assert.equal(game.run.tutorialActive, false);
    assert.equal(game.run.pickedUp, 0);
    assert.equal(game.run.shelved, 0);
    assert.equal(game.run.xpEarned, 0);
    assert.equal(game.progression.xp, 0);
  });
}

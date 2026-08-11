import assert from 'node:assert/strict';
import test from 'node:test';

import { dailyId, dailySeed, dailySeedForDay } from '../src/core/daily.js';

test('daily identity is stable across the same UTC day', () => {
  const early = new Date('2026-08-07T00:00:00.000Z');
  const late = new Date('2026-08-07T23:59:59.999Z');
  assert.equal(dailyId(early), '2026-08-07');
  assert.equal(dailyId(early), dailyId(late));
  assert.equal(dailySeed('library', early), 'daily:2026-08-07:library');
});

test('daily identity rolls over at UTC midnight and includes the branch', () => {
  const before = new Date('2026-08-07T23:59:59.999Z');
  const after = new Date('2026-08-08T00:00:00.000Z');
  assert.notEqual(dailySeed('library', before), dailySeed('library', after));
  assert.notEqual(dailySeed('library', after), dailySeed('grocery', after));
});

test('daily identity rejects invalid dates', () => {
  assert.throws(() => dailyId(new Date('nope')), TypeError);
  assert.throws(() => dailySeedForDay('library', 'August 7'), TypeError);
});

test('a captured daily day can be replayed after UTC rollover', () => {
  assert.equal(dailySeedForDay('grocery', '2026-08-07'), 'daily:2026-08-07:grocery');
});

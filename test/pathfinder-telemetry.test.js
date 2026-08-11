import assert from 'node:assert/strict';
import test from 'node:test';

import { PathFinder } from '../src/world/collision.js';

test('pathfinder exposes per-run request and failure counters for playtests', () => {
  const layout = {
    navW: 4,
    navD: 4,
    navCell: 1,
    nav: new Uint8Array(16),
  };
  const finder = new PathFinder(layout);
  assert.ok(finder.find(0.5, 0.5, 3.5, 3.5));
  assert.equal(finder.findCount, 1);
  assert.equal(finder.failureCount, 0);
  assert.equal(finder.find(0.5, 0.5, 3.5, 3.5, 0), null);
  assert.equal(finder.findCount, 2);
  assert.equal(finder.failureCount, 1);
});

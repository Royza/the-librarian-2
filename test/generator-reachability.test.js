import assert from 'node:assert/strict';
import test from 'node:test';

import { THEMES } from '../src/data/themes.js';
import { CollisionWorld } from '../src/world/collision.js';
import { ARCHETYPES, generateLayout } from '../src/world/generator.js';

const SEEDS_PER_THEME = Number(process.env.GENERATOR_TEST_SEEDS ?? 48);
assert.ok(Number.isInteger(SEEDS_PER_THEME) && SEEDS_PER_THEME > 0, 'GENERATOR_TEST_SEEDS must be a positive integer');
const BAY_APPROACH_DISTANCE = 0.9;
const BASE_RETURN_RADIUS = 2.4;
const APPROACH_BODY_RADIUS = 0.36;

function spawnComponent(layout) {
  const { nav, navCell, navW, navD, spawn } = layout;
  const reachable = new Uint8Array(nav.length);
  const queue = new Int32Array(nav.length);
  const sx = Math.floor(spawn.x / navCell);
  const sz = Math.floor(spawn.z / navCell);
  const start = sz * navW + sx;

  assert.equal(nav[start], 0, `spawn (${spawn.x.toFixed(2)}, ${spawn.z.toFixed(2)}) is blocked`);

  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  reachable[start] = 1;

  while (head < tail) {
    const current = queue[head++];
    const x = current % navW;
    const z = (current / navW) | 0;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= navW || nz >= navD) continue;

        const next = nz * navW + nx;
        if (nav[next] || reachable[next]) continue;
        // Match PathFinder: agents cannot cut diagonally through shelf ends.
        if (dx && dz && (nav[z * navW + nx] || nav[nz * navW + x])) continue;

        reachable[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  return reachable;
}

function hasReachableCellNear(layout, reachable, x, z, radius) {
  const { navCell, navW, navD } = layout;
  const minX = Math.max(0, Math.floor((x - radius) / navCell));
  const maxX = Math.min(navW - 1, Math.floor((x + radius) / navCell));
  const minZ = Math.max(0, Math.floor((z - radius) / navCell));
  const maxZ = Math.min(navD - 1, Math.floor((z + radius) / navCell));
  const radiusSq = radius * radius;

  for (let gz = minZ; gz <= maxZ; gz++) {
    for (let gx = minX; gx <= maxX; gx++) {
      if (!reachable[gz * navW + gx]) continue;
      const wx = (gx + 0.5) * navCell;
      const wz = (gz + 0.5) * navCell;
      if ((wx - x) ** 2 + (wz - z) ** 2 <= radiusSq) return true;
    }
  }
  return false;
}

function hasReachableBayInteraction(layout, reachable, bay) {
  const { navCell, navW, navD } = layout;
  const radius = BASE_RETURN_RADIUS;
  const minX = Math.max(0, Math.floor((bay.wx - radius) / navCell));
  const maxX = Math.min(navW - 1, Math.floor((bay.wx + radius) / navCell));
  const minZ = Math.max(0, Math.floor((bay.wz - radius) / navCell));
  const maxZ = Math.min(navD - 1, Math.floor((bay.wz + radius) / navCell));

  for (let gz = minZ; gz <= maxZ; gz++) {
    for (let gx = minX; gx <= maxX; gx++) {
      if (!reachable[gz * navW + gx]) continue;
      const wx = (gx + 0.5) * navCell;
      const wz = (gz + 0.5) * navCell;
      const dx = wx - bay.wx;
      const dz = wz - bay.wz;
      if (dx * dx + dz * dz > radius * radius) continue;
      // Do not count a cell on the other side of the shelf as an interaction
      // position for this face.
      if (dx * bay.nx + dz * bay.nz > 0.05) return true;
    }
  }
  return false;
}

function zoneReachableFraction(layout, reachable, zone) {
  const { nav, navCell, navW, navD } = layout;
  const minX = Math.max(0, Math.ceil(zone.rect.x / navCell - 0.5));
  const maxX = Math.min(navW - 1, Math.floor(zone.rect.x2 / navCell - 0.5));
  const minZ = Math.max(0, Math.ceil(zone.rect.z / navCell - 0.5));
  const maxZ = Math.min(navD - 1, Math.floor(zone.rect.z2 / navCell - 0.5));
  let walkable = 0;
  let connected = 0;

  for (let gz = minZ; gz <= maxZ; gz++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const index = gz * navW + gx;
      if (nav[index]) continue;
      walkable++;
      if (reachable[index]) connected++;
    }
  }

  return walkable ? connected / walkable : 0;
}

for (const theme of Object.values(THEMES)) {
  test(`${theme.id}: generated districts and shelf bays stay reachable`, () => {
    for (let index = 0; index < SEEDS_PER_THEME; index++) {
      const seed = `reachability-${theme.id}-${index}`;
      const layout = generateLayout(seed, theme);
      const reachable = spawnComponent(layout);
      const collision = new CollisionWorld(layout);

      for (const zone of layout.zones) {
        const fraction = zoneReachableFraction(layout, reachable, zone);
        assert.ok(
          fraction >= 0.9,
          `${seed}: ${zone.name} (${zone.type}) has only ${(fraction * 100).toFixed(1)}% spawn-reachable floor`,
        );

        if (zone.type === ARCHETYPES.ATRIUM || zone.type === ARCHETYPES.ROTUNDA) {
          assert.ok(
            hasReachableCellNear(layout, reachable, zone.rect.cx, zone.rect.cz, 4),
            `${seed}: ${zone.name} (${zone.type}) center is unreachable`,
          );
          assert.ok(
            zone.entrances.length >= 2,
            `${seed}: ${zone.name} (${zone.type}) has fewer than two usable entrances`,
          );
          for (const entrance of zone.entrances) {
            assert.ok(
              hasReachableCellNear(layout, reachable, entrance.x, entrance.z, 1.5),
              `${seed}: ${zone.name} (${zone.type}) has a blocked entrance`,
            );
          }
        }
      }

      for (const landmark of layout.landmarks) {
        assert.ok(
          hasReachableCellNear(layout, reachable, landmark.x, landmark.z, 4),
          `${seed}: ${landmark.name} landmark (${landmark.kind}) is unreachable`,
        );
      }

      for (const bay of layout.allBays) {
        const approachX = bay.wx + bay.nx * BAY_APPROACH_DISTANCE;
        const approachZ = bay.wz + bay.nz * BAY_APPROACH_DISTANCE;
        assert.ok(
          hasReachableBayInteraction(layout, reachable, bay),
          `${seed}: bay ${bay.globalIndex} (${bay.run.style}, zone ${bay.run.zoneId}) has no reachable interaction position`,
        );

        const resolved = {};
        collision.resolve(approachX, approachZ, APPROACH_BODY_RADIUS, resolved);
        assert.ok(
          Math.hypot(resolved.x - approachX, resolved.z - approachZ) < 1e-6,
          `${seed}: bay ${bay.globalIndex} (${bay.run.style}, zone ${bay.run.zoneId}) approach overlaps ${resolved.hit?.kind ?? 'a collider'}`,
        );
      }
    }
  });
}

test('a known adversarial seed deterministically retries before returning a blocked shelf', () => {
  const seed = 'identity-adversarial-library-454';
  const first = generateLayout(seed, THEMES.library);
  const replay = generateLayout(seed, THEMES.library);
  assert.equal(first.generationAttempt, 1);
  assert.equal(replay.generationAttempt, 1);
  assert.deepEqual(
    replay.allBays.slice(0, 12).map((bay) => [bay.wx, bay.wz, bay.nx, bay.nz]),
    first.allBays.slice(0, 12).map((bay) => [bay.wx, bay.wz, bay.nx, bay.nz]),
  );

  const reachable = spawnComponent(first);
  const collision = new CollisionWorld(first);
  for (const bay of first.allBays) {
    assert.equal(hasReachableBayInteraction(first, reachable, bay), true);
    const approachX = bay.wx + bay.nx * BAY_APPROACH_DISTANCE;
    const approachZ = bay.wz + bay.nz * BAY_APPROACH_DISTANCE;
    const resolved = {};
    collision.resolve(approachX, approachZ, APPROACH_BODY_RADIUS, resolved);
    assert.ok(Math.hypot(resolved.x - approachX, resolved.z - approachZ) < 1e-6);
  }
});

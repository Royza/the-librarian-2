import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { THEMES } from '../src/data/themes.js';
import {
  ItemSystem,
  LOOSE_ITEM_KINDS,
  buildLooseItemGeometry,
  displayItemColor,
  looseItemKindsForTheme,
  resolveLooseItemKind,
} from '../src/systems/items.js';
import { SHELF_STYLES } from '../src/data/shelfStyles.js';
import { buildCarcassGeometry, buildShelfItemRowGeometry } from '../src/world/level.js';
import { generateLayout } from '../src/world/generator.js';

const EXPECTED = {
  library: { counter: 'desk', sign: 'librarysign', shelf: 'bound-books' },
  videostore: { counter: 'videocounter', sign: 'moviesign', shelf: 'vhs-cases' },
  recordstore: { counter: 'recordcounter', sign: 'recordsign', shelf: 'record-sleeves' },
  grocery: { counter: 'checkoutcounter', sign: 'marketsign', shelf: 'packaged-groceries' },
};

function bounds(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox.getSize(new THREE.Vector3());
}

test('every branch declares and generates a distinct opening identity', () => {
  const architectures = new Set();
  const perimeters = new Set();
  const ceilings = new Set();
  const shelfContents = new Set();

  for (const [id, theme] of Object.entries(THEMES)) {
    const expected = EXPECTED[id];
    const layout = generateLayout(`branch-identity-${id}`, theme);
    architectures.add(layout.identity.architecture);
    perimeters.add(layout.identity.perimeter);
    ceilings.add(layout.identity.ceiling);
    shelfContents.add(layout.identity.shelfContents);

    assert.equal(layout.identity.counter, expected.counter);
    assert.equal(layout.identity.sign, expected.sign);
    assert.equal(layout.identity.shelfContents, expected.shelf);
    assert.ok(layout.props.some((prop) => prop.kind === expected.counter), `${id} is missing its central counter`);
    assert.ok(layout.props.some((prop) => prop.kind === expected.sign), `${id} is missing opening signage`);
    assert.equal(layout.props.some((prop) => prop.kind === 'stack'), false, `${id} still generates an inert floor stack`);

    const central = layout.landmarks.find((landmark) => landmark.central);
    assert.equal(central?.kind, expected.counter);
    assert.equal(central?.name, theme.worldIdentity.counter.name);
    assert.equal(layout.identity.boulevardName, theme.worldIdentity.boulevardName);
  }

  assert.equal(architectures.size, 4);
  assert.equal(perimeters.size, 4);
  assert.equal(ceilings.size, 4);
  assert.equal(shelfContents.size, 4);
});

test('retail district names do not announce library room types', () => {
  const libraryOnly = /Reading Room|Study Cubbies|Children’s Wing|Story Corner|Exhibit Hall|Deep Stacks|Great Hall/;
  for (const theme of [THEMES.videostore, THEMES.recordstore, THEMES.grocery]) {
    const layout = generateLayout(`retail-zone-names-${theme.id}`, theme);
    for (const zone of layout.zones) assert.doesNotMatch(zone.name, libraryOnly);
  }
});

test('loose-item kind selection is deterministic and every declared pool has valid geometry', () => {
  assert.deepEqual(looseItemKindsForTheme(undefined), ['book']);
  assert.equal(resolveLooseItemKind(undefined, null, 42), 'book');
  assert.deepEqual([0, 1, 2, 3, 4].map((id) => resolveLooseItemKind(THEMES.grocery, null, id)), ['can', 'cereal', 'apple', 'bottle', 'can']);
  assert.equal(displayItemColor({ visualKind: 'apple', color: 'cobalt', hazard: null }), 'cobalt');
  assert.equal(displayItemColor({ color: 'forest', hazard: { id: 'banana', color: 'amber' } }), 'amber');
  for (const theme of Object.values(THEMES)) {
    const kinds = looseItemKindsForTheme(theme);
    assert.deepEqual(kinds, LOOSE_ITEM_KINDS[theme.id]);
    assert.deepEqual(theme.worldIdentity.looseItems, kinds);
    for (const id of [0, 1, 2, 17, 599]) {
      assert.equal(resolveLooseItemKind(theme, null, id), resolveLooseItemKind(theme, null, id));
    }
    for (const hazard of theme.hazards) {
      assert.ok(kinds.includes(hazard.id), `${theme.id} has no visual pool for ${hazard.id}`);
      assert.equal(resolveLooseItemKind(theme, hazard, 12), hazard.id);
    }

    const signatures = new Set();
    for (const kind of kinds) {
      const geometry = buildLooseItemGeometry(theme, kind);
      const size = bounds(geometry);
      assert.equal(geometry.name, `loose-item-${kind}`);
      assert.equal(geometry.userData.itemKind, kind);
      assert.ok(geometry.attributes.position.count > 0);
      assert.ok(size.x > 0.03 && size.y > 0.02 && size.z > 0.03);
      signatures.add(`${geometry.attributes.position.count}:${size.x.toFixed(3)}:${size.y.toFixed(3)}:${size.z.toFixed(3)}`);
      geometry.dispose();
    }
    assert.equal(signatures.size, kinds.length, `${theme.id} reuses an indistinguishable loose silhouette`);
  }
});

test('VHS, record, banana, and mushroom silhouettes read differently from above', () => {
  const vhs = buildLooseItemGeometry(THEMES.videostore, 'vhs');
  const record = buildLooseItemGeometry(THEMES.recordstore, 'record');
  const banana = buildLooseItemGeometry(THEMES.grocery, 'banana');
  const mushroom = buildLooseItemGeometry(THEMES.grocery, 'mushroom');
  const vb = bounds(vhs), rb = bounds(record), bb = bounds(banana), mb = bounds(mushroom);

  assert.ok(vb.z / vb.x > 1.35, 'VHS case should be a long rectangle');
  assert.ok(Math.abs(rb.x - rb.z) / Math.max(rb.x, rb.z) < 0.2, 'record sleeve should be square');
  assert.ok(bb.x > 0.4 && bb.z > 0.38 && bb.y < 0.14, 'banana should have a broad, low curve');
  assert.ok(mb.y >= mb.x * 0.9, 'mushroom needs a visible stem and cap');

  for (const geometry of [vhs, record, banana, mushroom]) geometry.dispose();
});

test('shelf carcasses and stocked rows have branch-specific geometry', () => {
  const rowNames = new Set();
  const carcassSignatures = new Set();
  for (const theme of Object.values(THEMES)) {
    const row = buildShelfItemRowGeometry(theme, 0.88, 0.34, 0.2, 0.15);
    rowNames.add(row.name);
    assert.equal(row.userData.itemKind, theme.id === 'library' ? 'book' : theme.id === 'videostore' ? 'vhs' : theme.id === 'recordstore' ? 'record' : 'grocery');

    const carcass = buildCarcassGeometry(SHELF_STYLES.tall, theme);
    const size = bounds(carcass);
    carcassSignatures.add(`${carcass.attributes.position.count}:${size.x.toFixed(3)}:${size.y.toFixed(3)}:${size.z.toFixed(3)}`);
    row.dispose();
    carcass.dispose();
  }
  assert.equal(rowNames.size, 4);
  assert.equal(carcassSignatures.size, 4);
});

test('disposing item visuals releases every fixed pool', () => {
  const calls = [];
  const makeDisposable = (name) => ({ name, dispose: () => calls.push(`dispose:${name}`) });
  const system = Object.create(ItemSystem.prototype);
  const meshes = ['banana', 'mushroom', 'soda'].map((name) => makeDisposable(`mesh:${name}`));
  const geometries = ['banana', 'mushroom', 'soda'].map((name) => makeDisposable(`geo:${name}`));
  system.visuals = new Map(meshes.map((mesh, index) => [mesh.name, { mesh, geo: geometries[index] }]));
  system.marks = makeDisposable('marks');
  system.markGeo = makeDisposable('markGeo');
  system.markMat = makeDisposable('markMat');
  system.scene = { remove: (object) => calls.push(`remove:${object.name}`) };

  system.dispose();

  for (const mesh of meshes) {
    assert.ok(calls.includes(`remove:${mesh.name}`));
    assert.ok(calls.includes(`dispose:${mesh.name}`));
  }
  for (const geometry of geometries) assert.ok(calls.includes(`dispose:${geometry.name}`));
  assert.equal(system.visuals.size, 0);
  assert.ok(calls.includes('dispose:marks'));
  assert.ok(calls.includes('dispose:markGeo'));
  assert.ok(calls.includes('dispose:markMat'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHARACTERS } from '../src/data/characters.js';
import { SoloCharacter, buildBodyGeometry, proportions } from '../src/entities/character.js';

const WOLFE_PARTS = [
  'innerShirt', 'collar', 'buttons',
  'irises', 'pupils', 'eyeGlints', 'brows',
  'beard', 'beardAccent', 'hat', 'hatLogo',
];

test('Wolfe data keeps the high-signal reference features', () => {
  const wolfe = CHARACTERS.wolfe;

  assert.equal(wolfe.style.face, 'broad');
  assert.equal(wolfe.style.eyeDetail, true);
  assert.equal(wolfe.style.brows, 'thick');
  assert.equal(wolfe.style.beard, 'saltPepper');
  assert.equal(wolfe.style.hat, 'flatCap');
  assert.equal(wolfe.style.hatLogo, 'geometric');
  assert.equal(wolfe.style.overshirt, true);
  assert.equal(wolfe.matMap.torso, 'charcoalFlannel');
  assert.equal(wolfe.colors.hat, 0x101216);
  assert.equal(wolfe.colors.badge, 0xf4f1e8);
  assert.equal(wolfe.colors.eye, 0x8da8b4);
  assert.notEqual(wolfe.colors.beard, wolfe.colors.beardAccent);
});

test('Wolfe geometry builds every layered likeness feature', () => {
  const wolfe = CHARACTERS.wolfe;
  const geo = buildBodyGeometry(proportions(wolfe.height, wolfe.chunk), wolfe.style);

  for (const part of WOLFE_PARTS) {
    assert.ok(geo[part]?.getAttribute('position')?.count > 0, `${part} geometry should exist`);
    geo[part].computeBoundingBox();
    assert.ok(geo[part].boundingBox, `${part} should have bounds`);
  }

  assert.ok(geo.hatLogo.boundingBox.max.z > geo.brows.boundingBox.max.z,
    'cap logo should sit visibly in front of the face details');

  for (const part of Object.values(geo)) part?.dispose?.();
});

test('Wolfe likeness meshes attach to the head and torso pose chains', () => {
  const wolfe = CHARACTERS.wolfe;
  const scene = new THREE.Scene();
  const mats = Object.fromEntries([
    'cloth', 'skin', 'rubber', 'hair', 'metal', 'charcoalFlannel',
  ].map((key) => [key, new THREE.MeshBasicMaterial()]));
  const model = new SoloCharacter(scene, mats, wolfe);

  for (const part of WOLFE_PARTS) assert.ok(model.meshes[part], `${part} mesh should attach`);

  model.pose(2, 0, -3, 0.4, { phase: 0.7, speed: 1.1, headYaw: -0.2 });
  for (const part of WOLFE_PARTS) {
    assert.ok(model.meshes[part].matrix.elements.every(Number.isFinite), `${part} pose must stay finite`);
  }

  model.dispose();
  for (const material of Object.values(mats)) material.dispose();
});

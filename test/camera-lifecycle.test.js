import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ChaseCamera, deriveCameraContainment } from '../src/core/camera.js';
import { THEMES } from '../src/data/themes.js';
import { generateLayout } from '../src/world/generator.js';

test('a new run hard-resets chase lag, zoom, look-ahead, trauma, and FOV', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  const chase = new ChaseCamera(camera);
  chase.smoothed.set(140, 4, -90);
  chase._lookAhead.set(8, 0, -6);
  chase._initialised = true;
  chase.trauma = 1;
  chase.distance = 23;
  chase.targetDistance = 23;
  chase.fovBoost = 12;
  camera.fov = 68;

  chase.reset({ x: 3, z: 7 });

  assert.deepEqual(chase.smoothed.toArray(), [3, chase.height, 7]);
  assert.deepEqual(chase._lookAhead.toArray(), [0, 0, 0]);
  assert.equal(chase.trauma, 0);
  assert.equal(chase.distance, 16);
  assert.equal(chase.targetDistance, 16);
  assert.equal(camera.fov, chase.fovBase);
  assert.ok(camera.position.distanceTo(chase.smoothed) > 15.9);
  assert.ok(camera.position.distanceTo(chase.smoothed) < 16.1);
});

test('left-drag orbit changes both axes and clamps to playable pitch limits', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  const chase = new ChaseCamera(camera);
  const startYaw = chase.yaw;
  const startPitch = chase.pitch;

  chase.orbit(40, -24);
  assert.ok(chase.yaw < startYaw, 'dragging right should orbit horizontally');
  assert.ok(chase.pitch > startPitch, 'dragging upward should lift the viewpoint');

  chase.orbit(0, -100000);
  assert.equal(chase.pitch, chase.maxPitch);
  chase.orbit(0, 100000);
  assert.equal(chase.pitch, chase.minPitch);
});

test('inverted vertical orbit reverses only the up-and-down drag direction', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  const chase = new ChaseCamera(camera);
  const startYaw = chase.yaw;
  const startPitch = chase.pitch;

  chase.setInvertY(true);
  chase.orbit(40, -24);

  assert.equal(chase.invertY, true);
  assert.ok(chase.yaw < startYaw, 'horizontal orbit should not be inverted');
  assert.ok(chase.pitch < startPitch, 'dragging upward should lower an inverted viewpoint');

  chase.setInvertY(false);
  chase.orbit(0, -24);
  assert.ok(chase.pitch > startPitch - 1e-9, 'turning inversion off should restore the normal direction');
});

test('high orbit angles stay below low branch ceilings', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  const chase = new ChaseCamera(camera);
  chase.setCeiling(8.2);
  chase.orbit(0, -100000);
  chase.update(0, { x: 0, z: 0 }, { x: 0, z: 0 }, { snap: true });

  assert.ok(camera.position.y < 8.2 - 0.65);
  assert.ok(chase.pitch < chase.maxPitch);
});

test('orbit yaw immediately keeps movement camera-relative', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  const chase = new ChaseCamera(camera);
  const before = new THREE.Vector3();
  const after = new THREE.Vector3();

  chase.inputToWorld(0, -1, before);
  chase.orbit(80, 0);
  chase.inputToWorld(0, -1, after);

  assert.ok(before.distanceTo(after) > 0.2);
  assert.ok(Math.abs(after.length() - 1) < 1e-9);
});

test('camera containment derives only the true outer wall envelope', () => {
  const bounds = deriveCameraContainment({
    width: 100,
    depth: 80,
    walls: [
      { x: 50, z: 0.6, w: 100, d: 1.2 },
      { x: 50, z: 79.25, w: 100, d: 1.5 },
      { x: 0.7, z: 40, w: 1.4, d: 80 },
      { x: 99.2, z: 40, w: 1.6, d: 80 },
      // A long interior partition must not be mistaken for the perimeter.
      { x: 8, z: 40, w: 1, d: 72 },
    ],
  });

  assert.deepEqual(bounds, { minX: 1.4, maxX: 98.4, minZ: 1.2, maxZ: 78.5 });
});

test('all branch cameras stay inside every wall at corners, zoom, and low ceilings', () => {
  const yaws = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, -3 * Math.PI / 4];
  const nearCorner = new THREE.Vector3();

  for (const theme of Object.values(THEMES)) {
    const layout = generateLayout(`camera-containment-${theme.id}`, theme);
    const camera = new THREE.PerspectiveCamera(50, 2.4, 0.15, 400);
    const chase = new ChaseCamera(camera);
    chase.setContainment(layout);
    chase.setCeiling(theme.ceilingHeight);
    const b = chase.containment;
    assert.ok(Math.abs(b.minX - 1.2) < 1e-9, `${theme.id}: west bound is not the wall's inside face`);
    assert.ok(Math.abs(b.maxX - 170.8) < 1e-9, `${theme.id}: east bound is not the wall's inside face`);
    assert.ok(Math.abs(b.minZ - 1.2) < 1e-9, `${theme.id}: north bound is not the wall's inside face`);
    assert.ok(Math.abs(b.maxZ - 170.8) < 1e-9, `${theme.id}: south bound is not the wall's inside face`);

    const edgeAndCornerFoci = [
      { x: b.minX + 0.36, z: b.minZ + 0.36 },
      { x: b.maxX - 0.36, z: b.minZ + 0.36 },
      { x: b.maxX - 0.36, z: b.maxZ - 0.36 },
      { x: b.minX + 0.36, z: b.maxZ - 0.36 },
      { x: (b.minX + b.maxX) / 2, z: b.minZ + 0.36 },
      { x: b.maxX - 0.36, z: (b.minZ + b.maxZ) / 2 },
      { x: (b.minX + b.maxX) / 2, z: b.maxZ - 0.36 },
      { x: b.minX + 0.36, z: (b.minZ + b.maxZ) / 2 },
    ];

    for (const focus of edgeAndCornerFoci) {
      for (const yaw of yaws) {
        for (const pitch of [chase.minPitch, chase.maxPitch]) {
          chase.reset(focus, { yaw, pitch });
          chase.zoom(1000);
          assert.equal(chase.targetDistance, chase._ceilingLimit(), `${theme.id}: test did not reach maximum zoom`);
          chase.distance = chase.targetDistance;
          chase.addTrauma(1);
          chase.update(1 / 60, focus, { x: 12, z: -12 }, { snap: true });

          const radius = chase._cameraContainmentRadius();
          assert.ok(camera.position.x >= b.minX + radius - 1e-9, `${theme.id}: eye crossed west wall`);
          assert.ok(camera.position.x <= b.maxX - radius + 1e-9, `${theme.id}: eye crossed east wall`);
          assert.ok(camera.position.z >= b.minZ + radius - 1e-9, `${theme.id}: eye crossed north wall`);
          assert.ok(camera.position.z <= b.maxZ - radius + 1e-9, `${theme.id}: eye crossed south wall`);
          assert.ok(chase.target.x >= b.minX && chase.target.x <= b.maxX, `${theme.id}: look-ahead escaped X bounds`);
          assert.ok(chase.target.z >= b.minZ && chase.target.z <= b.maxZ, `${theme.id}: look-ahead escaped Z bounds`);
          assert.ok(camera.position.y <= theme.ceilingHeight - radius + 1e-9, `${theme.id}: eye crossed ceiling`);

          // Verify the actual four corners of the perspective camera's near
          // plane, rather than relying only on the conservative eye radius.
          camera.updateMatrixWorld(true);
          for (const ndcX of [-1, 1]) {
            for (const ndcY of [-1, 1]) {
              nearCorner.set(ndcX, ndcY, -1).unproject(camera);
              assert.ok(nearCorner.x >= b.minX - 1e-8 && nearCorner.x <= b.maxX + 1e-8, `${theme.id}: near-plane corner escaped X walls`);
              assert.ok(nearCorner.z >= b.minZ - 1e-8 && nearCorner.z <= b.maxZ + 1e-8, `${theme.id}: near-plane corner escaped Z walls`);
              assert.ok(nearCorner.y >= -1e-8 && nearCorner.y <= theme.ceilingHeight + 1e-8, `${theme.id}: near-plane corner escaped floor/ceiling`);
            }
          }
        }
      }
    }
  }
});

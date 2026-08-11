import assert from 'node:assert/strict';
import test from 'node:test';

import { minimapMarkerAngle, minimapPulse, trackedMarkerMetrics, worldToCompassDelta, worldToMinimapDelta } from '../src/ui/hud.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('camera-forward and camera-right movement map to up and right', () => {
  for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    const [fx, fy] = worldToMinimapDelta(forwardX, forwardZ, yaw);
    const [rx, ry] = worldToMinimapDelta(rightX, rightZ, yaw);
    close(fx, 0); close(fy, -1);
    close(rx, 1); close(ry, 0);
    close(minimapMarkerAngle(forwardX, forwardZ, yaw), 0);
    close(minimapMarkerAngle(rightX, rightZ, yaw), Math.PI / 2);
  }
});

test('minimap conversion preserves distance and applies display scale', () => {
  const [x, y] = worldToMinimapDelta(3, 4, 1.23, 2.5);
  close(Math.hypot(x, y), 12.5);
});

test('compass arrow projects camera-forward up and camera-right right', () => {
  for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const forward = worldToCompassDelta(-Math.sin(yaw), -Math.cos(yaw), yaw, 100);
    const right = worldToCompassDelta(Math.cos(yaw), -Math.sin(yaw), yaw, 100);
    close(forward.x, 0); close(forward.y, -100); close(forward.angle, -Math.PI / 2);
    close(right.x, 100); close(right.y, 0); close(right.angle, 0);
  }
});

test('accessibility text scale enlarges minimap threat labels and their safe margin together', () => {
  const normal = trackedMarkerMetrics(1);
  const large = trackedMarkerMetrics(1.3);
  assert.equal(large.fontSize, normal.fontSize * 1.3);
  assert.equal(large.labelHeight, normal.labelHeight * 1.3);
  assert.equal(large.edgeMargin, normal.edgeMargin * 1.3);
  assert.equal(trackedMarkerMetrics(5).scale, 1.3);
});

test('reduced motion freezes minimap objective rings', () => {
  assert.notEqual(minimapPulse(0, false), minimapPulse(200, false));
  assert.equal(minimapPulse(0, true), minimapPulse(200, true));
});

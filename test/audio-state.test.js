import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioEngine } from '../src/core/audio.js';

test('master-volume changes cannot bypass an active global mute', () => {
  const audio = new AudioEngine();
  audio.master = { gain: { value: 0.8 } };

  audio.mute(true);
  audio.setVolume(0.35);
  assert.equal(audio.enabled, false);
  assert.equal(audio.volume, 0.35);
  assert.equal(audio.master.gain.value, 0);

  audio.mute(false);
  assert.equal(audio.enabled, true);
  assert.equal(audio.master.gain.value, 0.35);
});

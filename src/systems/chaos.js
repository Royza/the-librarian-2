// Chaos tuning lives in a dependency-free module so the fifteen-minute curve
// can be regression-tested without constructing the renderer or a full run.

export const CHAOS_BALANCE = Object.freeze({
  pacingStart: 0.8,
  pacingEnd: 1.55,
  ambientStartPerSecond: 0.055,
  ambientEndPerSecond: 0.1,
  floorPressure: 0.025,
  floorPressureExponent: 0.68,
  heldPressureScale: 0.4,
  messPressurePerSecond: 0.14,
  pickupRelief: 0.32,
  shelveRelief: 0.95,
  shelveComboRelief: 0.035,
  shelveComboCap: 20,
  cleanFloorThreshold: 10,
  cleanFloorChaosFloor: 5,
  cleanFloorBaseReliefPerSecond: 0.25,
  cleanFloorBonusReliefPerSecond: 1.15,
  postDisasterReprieveSeconds: 60,
});

const SHIFT_SECONDS = 15 * 60;

/** Per-second Hellmouth gain before permanent dampening. */
export function cemeteryPressureRate({ elapsed = 0, duration = SHIFT_SECONDS, activity = 0 } = {}) {
  const t = clamp01(elapsed / Math.max(1, duration));
  return 0.035 + t * 0.055 + Math.max(0, activity) * 0.012;
}

/**
 * A deliberately smooth full-shift curve. Smoothstep has a flat derivative at
 * both ends, avoiding the old minute-five coefficient spike. The larger range
 * is intentional: the opening remains readable while the closing third can
 * still threaten a well-equipped profile with full Chaos dampening.
 */
export function chaosPacingMultiplier(elapsed = 0) {
  const t = clamp01(elapsed / SHIFT_SECONDS);
  const smooth = t * t * (3 - 2 * t);
  return CHAOS_BALANCE.pacingStart
    + smooth * (CHAOS_BALANCE.pacingEnd - CHAOS_BALANCE.pacingStart);
}

/** Current per-second pressure before character dampening. */
export function chaosPressureRate({
  elapsed = 0,
  floor = 0,
  held = 0,
  messes = 0,
  bossPressure = 0,
} = {}) {
  const t = clamp01(elapsed / SHIFT_SECONDS);
  // Ambient pressure makes the meter visibly alive from the opening minute,
  // then adds urgency even when a late-run power build clears quickly.
  const ambient = CHAOS_BALANCE.ambientStartPerSecond
    + t * (CHAOS_BALANCE.ambientEndPerSecond - CHAOS_BALANCE.ambientStartPerSecond);
  // Sub-linear clutter pressure keeps a major disaster serious without making
  // a large pile exponentially harder to recover from. This is deliberately
  // about 2.5x the old floor term: ordinary cleanup now has to keep pace rather
  // than permanently erasing the meter.
  const clutter = (
    Math.pow(Math.max(0, floor), CHAOS_BALANCE.floorPressureExponent)
    + Math.pow(Math.max(0, held), CHAOS_BALANCE.floorPressureExponent)
      * CHAOS_BALANCE.heldPressureScale
  ) * CHAOS_BALANCE.floorPressure;
  const incident = Math.max(0, messes) * CHAOS_BALANCE.messPressurePerSecond
    + Math.max(0, bossPressure);
  return (ambient + clutter + incident) * chaosPacingMultiplier(elapsed);
}

export function shelveChaosRelief(combo = 0) {
  return CHAOS_BALANCE.shelveRelief
    + Math.min(Math.max(0, combo), CHAOS_BALANCE.shelveComboCap) * CHAOS_BALANCE.shelveComboRelief;
}

/** Passive recovery once the player has reduced the room to light clutter. */
export function cleanFloorReliefRate(floor = 0, messes = 0) {
  if (messes > 0 || floor >= CHAOS_BALANCE.cleanFloorThreshold) return 0;
  const clean = 1 - Math.max(0, floor) / CHAOS_BALANCE.cleanFloorThreshold;
  return CHAOS_BALANCE.cleanFloorBaseReliefPerSecond
    + CHAOS_BALANCE.cleanFloorBonusReliefPerSecond * clean;
}

export function isDisasterRecoveryActive(run) {
  return (run?.disasterRecoveryRemaining || 0) > 0;
}

/** Quiet Please and disaster recovery are independent, overlapping pauses. */
export function isChaosPaused(run) {
  return !!run?.chaosFrozen || isDisasterRecoveryActive(run);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

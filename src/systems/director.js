import { BOSS_TYPES } from '../entities/bosses.js';
import { DISASTERS } from '../systems/disasters.js';

// The pacing brain. Decides how many children exist, when a boss walks in, and
// when the building decides to have a volcano. Everything scales off elapsed
// minutes so a run has a readable shape: calm → busy → chaos → boss → breather.

// Each kid pulls roughly two or three items off a shelf and then wanders out,
// so the spawn interval — not the population cap — is what sets how fast the
// floor fills. These numbers target about 16 items/min at the start rising to
// about 36 by the closing minutes, against a player whose clear rate roughly
// triples once the signature powers come online.
const BEATS = [
  { at: 0.0, maxKids: 4, interval: 11.0, ransack: 22 },
  { at: 1.5, maxKids: 5, interval: 9.5, ransack: 24 },
  { at: 3.0, maxKids: 7, interval: 8.2, ransack: 26 },
  { at: 5.0, maxKids: 8, interval: 7.2, ransack: 27 },
  { at: 7.0, maxKids: 10, interval: 6.3, ransack: 28 },
  { at: 9.0, maxKids: 11, interval: 5.5, ransack: 29 },
  { at: 11.0, maxKids: 13, interval: 4.8, ransack: 30 },
  { at: 13.0, maxKids: 15, interval: 4.2, ransack: 31 },
];

export class Director {
  constructor(game) {
    this.game = game;
    this.rng = game.rng.fork(7);
    this.spawnTimer = 4;
    // The first eligible headline is the earthquake at 2:00. Schedule it just
    // after that threshold instead of firing an empty 1:35 event and then
    // accidentally waiting another two minutes.
    this.eventTimer = 125;
    this.beatIndex = -1;
    this.usedBosses = new Set();
    this.usedDisasters = new Set();
    this.lastEventKind = null;
    this.postponed = 0;
    this.introIncidentFired = false;
    this.headlineCount = 0;
    game.progression.begin();
  }

  update(dt) {
    const g = this.game;
    const minute = g.run.elapsed / 60;

    // The first-run guided shift owns the opening beat. Do not let normal kids
    // or disasters interrupt before the player has learned the core loop.
    if (g.run.tutorialActive) return;

    // --- difficulty beat
    let beat = BEATS[0];
    for (let i = 0; i < BEATS.length; i++) if (minute >= BEATS[i].at) beat = BEATS[i];
    const idx = BEATS.indexOf(beat);
    if (idx !== this.beatIndex) {
      this.beatIndex = idx;
      g.kids.maxKids = beat.maxKids;
      g.kids.spawnInterval = beat.interval;
      g.kids.ransackRadius = beat.ransack;
      if (idx > 0) g.hud.toast(`The library is filling up… (${beat.maxKids} kids)`);
    }

    // How buried is the player right now? Everything below eases off when the
    // floor is already a disaster, so a bad minute is recoverable instead of
    // being the start of an unwinnable spiral.
    const floor = g.items.floorCount;
    const swamped = floor > 55 ? 1 : floor > 32 ? 0.5 : 0;

    // A small authored beat bridges the tutorial and the first disaster. It
    // creates visible work without inventing unexplained self-falling items.
    if (!this.introIncidentFired && g.run.elapsed >= 75) {
      this.introIncidentFired = true;
      const arrivals = swamped ? 1 : 2;
      // The normal trickle commonly fills the opening cap before 1:15. The
      // authored rush briefly raises that cap so the beat cannot disappear.
      g.kids.maxKids = Math.max(g.kids.maxKids, g.kids.count + arrivals);
      for (let i = 0; i < arrivals; i++) g.kids.spawnOne();
      g.hud.banner(
        'AFTER-SCHOOL RUSH',
        arrivals === 1
          ? 'One late arrival slips in while the floor is busy.'
          : 'A small group has arrived. Keep the first mess under control.',
        { ms: 2300 },
      );
    }

    // --- kid trickle
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = g.kids.spawnInterval * this.rng.range(0.7, 1.3) * (1 + swamped * 0.7);
      const deficit = g.kids.maxKids - g.kids.count;
      const n = deficit > 6 && !swamped ? 2 : 1;
      for (let i = 0; i < n; i++) g.kids.spawnOne();
    }

    // --- headline events
    this.eventTimer -= dt;
    if (this.eventTimer <= 0 && g.run.elapsed > 60) {
      if (swamped >= 1 && this.postponed < 3) {
        // Don't kick someone who's already down — wait for a lull.
        this.postponed++;
        this.eventTimer = 25;
      } else {
        this.postponed = 0;
        const fired = this._fireEvent(minute);
        // If no event is eligible, retry soon. A successful event gets a real
        // breather whose length contracts over the shift.
        if (fired) {
          this.headlineCount++;
          // After the introductory quake, bring the Bully in during the
          // authored 3–4 minute window. Later recoveries use the full curve.
          this.eventTimer = this.headlineCount === 1
            ? this.rng.range(70, 95)
            : Math.max(50, 135 - minute * 4) * this.rng.range(0.85, 1.15);
        } else {
          this.eventTimer = 10;
        }
      }
    }
  }

  _fireEvent(minute) {
    const g = this.game;
    const bosses = Object.values(BOSS_TYPES).filter((t) => minute >= t.minMinute && !g.bosses.active.some((b) => b.alive && b.type.id === t.id));
    const disasters = Object.values(DISASTERS).filter((d) => minute >= d.minMinute && !g.disasters.active.some((a) => a.def.id === d.id));

    // Alternate flavors so you never get three tornadoes in a row.
    const preferBoss = this.lastEventKind !== 'boss' && bosses.length > 0;
    const preferDisaster = this.lastEventKind !== 'disaster' && disasters.length > 0;

    let kind;
    if (preferBoss && preferDisaster) kind = this.rng.bool(0.55) ? 'boss' : 'disaster';
    else if (preferBoss) kind = 'boss';
    else if (preferDisaster) kind = 'disaster';
    else if (bosses.length) kind = 'boss';
    else if (disasters.length) kind = 'disaster';
    else return false;

    if (kind === 'boss') {
      // Weight toward bosses you haven't met yet; sick kid stays rare.
      const pool = bosses.map((t) => ({
        w: (this.usedBosses.has(t.id) ? 1 : 3) * (t.rare ? 0.35 : 1),
        v: t,
      }));
      const pick = this.rng.weighted(pool).v;
      this.usedBosses.add(pick.id);
      g.bosses.spawn(pick.id);
    } else {
      const pool = disasters.map((d) => ({ w: (this.usedDisasters.has(d.id) ? 1 : 2.5) * d.weight, v: d }));
      const pick = this.rng.weighted(pool).v;
      this.usedDisasters.add(pick.id);
      g.disasters.trigger(pick.id);
    }
    this.lastEventKind = kind;
    return true;
  }
}

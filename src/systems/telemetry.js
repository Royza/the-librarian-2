const KEY = 'librarian2.playtests.v1';

/**
 * Local-only playtest evidence. Nothing is transmitted; a compact history is
 * retained so human sessions can replace guesses and bot-only balance calls.
 */
export class RunTelemetry {
  constructor(game) {
    this.game = game;
    this.nextSample = 0;
    this.samples = [];
    this.first = {};
    this.pathFailures = 0;
    this.damageTaken = 0;
    this.fullCarrySeconds = 0;
    this.upgradeChoices = [];
    this.pathFailureBaseline = game.pathfinder?.failureCount || 0;
    this.lastPlayer = { x: game.player.x, z: game.player.z };
    this.distance = 0;
    this.unsubs = [
      game.events.on('shelved', () => this.mark('shelved')),
      game.events.on('upgrade', ({ id, level } = {}) => {
        this.mark('upgrade');
        const elapsed = game.run.elapsed;
        this.upgradeChoices.push({ id, level, t: +elapsed.toFixed(1) });
      }),
      game.events.on('power', () => this.mark('power')),
      game.events.on('bossSpawn', () => this.mark('boss')),
      game.events.on('disasterStart', () => this.mark('disaster')),
      game.events.on('playerHurt', ({ amount } = {}) => {
        this.damageTaken += Math.max(0, Number(amount) || 0);
      }),
    ];
  }

  mark(name) {
    const elapsed = this.game.run.elapsed;
    if (this.first[name] === undefined) this.first[name] = +elapsed.toFixed(1);
  }

  update(dt = 0) {
    const g = this.game;
    const dx = g.player.x - this.lastPlayer.x;
    const dz = g.player.z - this.lastPlayer.z;
    this.distance += Math.hypot(dx, dz);
    this.lastPlayer.x = g.player.x;
    this.lastPlayer.z = g.player.z;
    if (g.player.carried.length >= g.player.stats.carrySlots) this.fullCarrySeconds += dt;
    if (g.run.pickedUp > 0) this.mark('pickup');
    const elapsed = g.run.elapsed;
    if (elapsed < this.nextSample) return;
    this.nextSample = elapsed + 10;
    this.samples.push({
      t: Math.round(elapsed),
      chaos: +g.run.chaos.toFixed(1),
      floor: g.items.floorCount,
      carried: g.player.carried.length,
      kids: g.kids.count,
      level: g.progression.level,
      bosses: g.bosses.active.filter((b) => b.alive).map((b) => b.type.id),
      disasters: g.disasters.active.map((d) => d.def.id),
    });
  }

  resetAfterTraining() {
    const g = this.game;
    this.nextSample = 0;
    this.samples.length = 0;
    this.first = {};
    this.damageTaken = 0;
    this.fullCarrySeconds = 0;
    this.distance = 0;
    this.lastPlayer.x = g.player.x;
    this.lastPlayer.z = g.player.z;
    this.pathFailureBaseline = g.pathfinder?.failureCount || 0;
  }

  finish(reason, won) {
    const g = this.game;
    const summary = {
      at: new Date().toISOString(),
      seed: String(g.seed),
      theme: g.theme.id,
      character: g.characterId,
      daily: !!g.run.isDaily,
      won: !!won,
      reason,
      elapsed: +g.run.elapsed.toFixed(1),
      trainingSeconds: +(g.run.trainingElapsed || 0).toFixed(1),
      score: g.run.score,
      shelved: g.run.shelved,
      peakChaos: +g.run.peakChaos.toFixed(1),
      level: g.progression.level,
      bestCombo: g.run.bestCombo,
      bossesBeaten: g.run.bossesBeaten,
      disastersSurvived: g.run.disastersSurvived,
      damageTaken: +this.damageTaken.toFixed(1),
      fullCarrySeconds: +this.fullCarrySeconds.toFixed(1),
      filesPerMinute: g.run.elapsed > 0 ? +(g.run.shelved / (g.run.elapsed / 60)).toFixed(1) : 0,
      pathFailures: Math.max(0, (g.pathfinder?.failureCount ?? this.pathFailures) - this.pathFailureBaseline),
      upgradeChoices: this.upgradeChoices,
      distance: Math.round(this.distance),
      metresPerFile: g.run.shelved ? +(this.distance / g.run.shelved).toFixed(1) : null,
      first: this.first,
      samples: this.samples,
    };
    g.run.telemetry = summary;
    try {
      const history = getPlaytestHistory();
      history.unshift(summary);
      localStorage.setItem(KEY, JSON.stringify(history.slice(0, 20)));
    } catch { /* local telemetry must never break a run */ }
    return summary;
  }

  dispose() { for (const off of this.unsubs) off(); this.unsubs.length = 0; }
}

export function getPlaytestHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((run) => run && typeof run === 'object' && !Array.isArray(run))
      : [];
  }
  catch { return []; }
}

export function clearPlaytestHistory() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

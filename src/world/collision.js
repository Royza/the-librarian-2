// Circle-vs-oriented-box collision with a uniform spatial hash, plus grid A*
// for the crowd. The layout hands us static OBBs; nothing here allocates during
// gameplay.

const CELL = 4;

export class CollisionWorld {
  constructor(layout) {
    this.layout = layout;
    this.cell = CELL;
    this.grid = new Map();
    for (const c of layout.colliders) this._insert(c);
  }

  _insert(c) {
    const ext = Math.hypot(c.hw, c.hd);
    const x0 = Math.floor((c.x - ext) / CELL), x1 = Math.floor((c.x + ext) / CELL);
    const z0 = Math.floor((c.z - ext) / CELL), z1 = Math.floor((c.z + ext) / CELL);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const k = gx * 73856093 ^ gz * 19349663;
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(c);
      }
    }
  }

  /** Colliders potentially overlapping a circle. */
  near(x, z, r, out = []) {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const arr = this.grid.get(gx * 73856093 ^ gz * 19349663);
        if (!arr) continue;
        for (const c of arr) if (!out.includes(c)) out.push(c);
      }
    }
    return out;
  }

  /**
   * Push a circle out of every solid it overlaps. Returns the corrected
   * position plus whatever it hit (used for slip/impact feedback).
   */
  resolve(x, z, r, out) {
    const list = this.near(x, z, r, this._scratch || (this._scratch = []));
    let hit = null;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of list) {
        const dx = x - c.x, dz = z - c.z;
        const cos = Math.cos(-c.angle), sin = Math.sin(-c.angle);
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const cx = Math.max(-c.hw, Math.min(c.hw, lx));
        const cz = Math.max(-c.hd, Math.min(c.hd, lz));
        let ox = lx - cx, oz = lz - cz;
        let d = Math.hypot(ox, oz);
        if (d >= r) continue;

        if (d < 1e-5) {
          // Deep inside: eject along the shallowest axis.
          const px = c.hw - Math.abs(lx);
          const pz = c.hd - Math.abs(lz);
          if (px < pz) { ox = Math.sign(lx) || 1; oz = 0; d = 1; }
          else { ox = 0; oz = Math.sign(lz) || 1; d = 1; }
        }
        const push = (r - d) / d;
        const nlx = lx + ox * push;
        const nlz = lz + oz * push;
        const rcos = Math.cos(c.angle), rsin = Math.sin(c.angle);
        x = c.x + nlx * rcos - nlz * rsin;
        z = c.z + nlx * rsin + nlz * rcos;
        moved = true;
        hit = c;
      }
      if (!moved) break;
    }
    out.x = x; out.z = z; out.hit = hit;
    return out;
  }

  /** True if a straight line between two points is unobstructed. */
  lineOfSight(x0, z0, x1, z1, step = 0.6) {
    const dx = x1 - x0, dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.isBlocked(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }

  isBlocked(x, z) {
    const L = this.layout;
    const gx = Math.floor(x / L.navCell);
    const gz = Math.floor(z / L.navCell);
    if (gx < 0 || gz < 0 || gx >= L.navW || gz >= L.navD) return true;
    return L.nav[gz * L.navW + gx] === 1;
  }
}

// --- Grid A* ----------------------------------------------------------------

export class PathFinder {
  constructor(layout) {
    this.L = layout;
    const n = layout.navW * layout.navD;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.state = new Uint8Array(n);
    this.stamp = new Uint32Array(n);
    this.epoch = 0;
    this.open = [];
    this.budget = 0;
    // Local playtest diagnostics; reset with each generated run.
    this.findCount = 0;
    this.failureCount = 0;
  }

  /** Nearest walkable cell to a world point (agents can start inside a shelf). */
  _snap(x, z) {
    const L = this.L;
    let gx = Math.max(0, Math.min(L.navW - 1, Math.floor(x / L.navCell)));
    let gz = Math.max(0, Math.min(L.navD - 1, Math.floor(z / L.navCell)));
    if (L.nav[gz * L.navW + gx] === 0) return gz * L.navW + gx;
    for (let r = 1; r <= 4; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = gx + dx, nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= L.navW || nz >= L.navD) continue;
          if (L.nav[nz * L.navW + nx] === 0) return nz * L.navW + nx;
        }
      }
    }
    return -1;
  }

  /**
   * A* between two world points. Returns an array of {x,z} waypoints, already
   * string-pulled so agents cut corners naturally.
   */
  find(sx, sz, tx, tz, maxNodes = 2600) {
    this.findCount++;
    const L = this.L;
    const start = this._snap(sx, sz);
    const goal = this._snap(tx, tz);
    if (start < 0 || goal < 0) { this.failureCount++; return null; }
    if (start === goal) return [{ x: tx, z: tz }];

    this.epoch++;
    const { g, f, parent, state, stamp, epoch } = this;
    const W = L.navW, D = L.navD, cell = L.navCell;
    const gxOf = (i) => i % W, gzOf = (i) => (i / W) | 0;
    const gx1 = gxOf(goal), gz1 = gzOf(goal);
    const h = (i) => {
      const dx = Math.abs(gxOf(i) - gx1), dz = Math.abs(gzOf(i) - gz1);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };

    const open = this.open;
    open.length = 0;
    g[start] = 0; f[start] = h(start); parent[start] = -1;
    stamp[start] = epoch; state[start] = 1;
    open.push(start);

    let expanded = 0;
    let found = -1;

    while (open.length) {
      // Linear-scan pop. The open set stays tiny for library-scale paths.
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();

      if (cur === goal) { found = cur; break; }
      state[cur] = 2;
      if (++expanded > maxNodes) break;

      const cx = gxOf(cur), cz = gzOf(cur);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
          const ni = nz * W + nx;
          if (L.nav[ni]) continue;
          // No cutting diagonal corners through a shelf end.
          if (dx && dz && (L.nav[cz * W + nx] || L.nav[nz * W + cx])) continue;
          const step = (dx && dz) ? Math.SQRT2 : 1;
          const ng = g[cur] + step;
          if (stamp[ni] !== epoch) {
            stamp[ni] = epoch; state[ni] = 0; g[ni] = Infinity;
          }
          if (state[ni] === 2) continue;
          if (ng < g[ni]) {
            g[ni] = ng;
            f[ni] = ng + h(ni) * 1.08;   // slight weight: faster, near-optimal
            parent[ni] = cur;
            if (state[ni] !== 1) { state[ni] = 1; open.push(ni); }
          }
        }
      }
    }

    if (found < 0) { this.failureCount++; return null; }

    const raw = [];
    let n = found;
    while (n !== -1) {
      raw.push({ x: (gxOf(n) + 0.5) * cell, z: (gzOf(n) + 0.5) * cell });
      n = parent[n];
    }
    raw.reverse();
    raw[raw.length - 1] = { x: tx, z: tz };
    return simplify(raw, this);
  }
}

function simplify(path, pf) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    for (; j > i + 1; j--) {
      if (clearLine(pf, path[i], path[j])) break;
    }
    out.push(path[j]);
    i = j;
  }
  return out;
}

function clearLine(pf, a, b) {
  const L = pf.L;
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.ceil(dist / (L.navCell * 0.5));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const gx = Math.floor(x / L.navCell), gz = Math.floor(z / L.navCell);
    if (gx < 0 || gz < 0 || gx >= L.navW || gz >= L.navD) return false;
    if (L.nav[gz * L.navW + gx]) return false;
  }
  return true;
}

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as BGU from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Furniture kit. Every prop is assembled from primitives in local space with
// its origin on the floor, then merged per-material so each kind can be drawn
// as one or two InstancedMeshes no matter how many of them the layout places.

export function box(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, round = 0) {
  const g = round > 0
    ? new RoundedBoxGeometry(w, h, d, 2, Math.min(round, Math.min(w, h, d) * 0.49))
    : new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

export function cyl(rt, rb, h, seg, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

export function sphere(r, wseg, hseg, x = 0, y = 0, z = 0) {
  const g = new THREE.SphereGeometry(r, wseg, hseg);
  g.translate(x, y, z);
  return g;
}

export function torus(r, tube, rseg, tseg, x = 0, y = 0, z = 0, rx = 0) {
  const g = new THREE.TorusGeometry(r, tube, rseg, tseg);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

/**
 * Materials that read `instanceColor` must declare `vertexColors`, which in
 * turn requires a `color` attribute on the geometry — without one WebGL feeds
 * the shader black. This guarantees a white default.
 */
export function ensureColorAttr(geo) {
  if (!geo.attributes.color) {
    const n = geo.attributes.position.count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }
  return geo;
}

/** Merge a list of geometries, guaranteeing a white vertex-colour attribute. */
export function mergeParts(geos) {
  if (!geos.length) return null;
  const cleaned = geos.map((g) => {
    const gg = g.index ? g.toNonIndexed() : g;
    if (g.index) g.dispose();
    for (const key of Object.keys(gg.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv' && key !== 'color') {
        gg.deleteAttribute(key);
      }
    }
    if (!gg.attributes.uv) {
      const n = gg.attributes.position.count;
      gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (!gg.attributes.color) {
      const n = gg.attributes.position.count;
      const c = new Float32Array(n * 3).fill(1);
      gg.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    return gg;
  });
  const merged = BGU.mergeGeometries(cleaned, false);
  for (const g of cleaned) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// --- Prop definitions -------------------------------------------------------
// Each returns { <materialKey>: [geometry, ...] }.

const BUILDERS = {
  table() {
    const legs = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      legs.push(box(0.09, 0.72, 0.09, sx * 1.32, 0.36, sz * 0.6, 0, 0, 0, 0.015));
      legs.push(box(0.13, 0.1, 0.13, sx * 1.32, 0.05, sz * 0.6));
    }
    return {
      darkWood: [
        box(3.0, 0.07, 1.4, 0, 0.755, 0, 0, 0, 0, 0.012),
        box(2.86, 0.05, 1.26, 0, 0.7, 0),
        ...legs,
        box(2.6, 0.07, 0.06, 0, 0.6, 0.6),
        box(2.6, 0.07, 0.06, 0, 0.6, -0.6),
      ],
      brass: [box(3.02, 0.012, 1.42, 0, 0.792, 0)],
    };
  },

  chair() {
    const legs = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      legs.push(box(0.05, 0.45, 0.05, sx * 0.2, 0.225, sz * 0.2));
    }
    return {
      darkWood: [
        box(0.48, 0.055, 0.46, 0, 0.475, 0, 0, 0, 0, 0.02),
        ...legs,
        box(0.46, 0.55, 0.055, 0, 0.78, -0.21, -0.06, 0, 0, 0.02),
        box(0.06, 0.35, 0.05, -0.2, 0.66, -0.2),
        box(0.06, 0.35, 0.05, 0.2, 0.66, -0.2),
      ],
    };
  },

  armchair() {
    return {
      leather: [
        box(0.9, 0.42, 0.86, 0, 0.34, 0, 0, 0, 0, 0.1),
        box(0.9, 0.72, 0.24, 0, 0.7, -0.34, -0.08, 0, 0, 0.09),
        box(0.2, 0.34, 0.8, -0.36, 0.66, 0.02, 0, 0, 0, 0.08),
        box(0.2, 0.34, 0.8, 0.36, 0.66, 0.02, 0, 0, 0, 0.08),
        box(0.72, 0.16, 0.7, 0, 0.6, 0.02, 0, 0, 0, 0.07),
      ],
      darkWood: [
        box(0.08, 0.16, 0.08, -0.36, 0.08, 0.34),
        box(0.08, 0.16, 0.08, 0.36, 0.08, 0.34),
        box(0.08, 0.16, 0.08, -0.36, 0.08, -0.34),
        box(0.08, 0.16, 0.08, 0.36, 0.08, -0.34),
      ],
    };
  },

  cart() {
    const parts = { metal: [], item: [], rubber: [] };
    parts.metal.push(
      box(0.9, 0.04, 0.5, 0, 0.28, 0),
      box(0.9, 0.04, 0.5, 0, 0.62, 0),
      box(0.9, 0.04, 0.5, 0, 0.9, 0),
      box(0.04, 0.92, 0.04, -0.43, 0.48, -0.23),
      box(0.04, 0.92, 0.04, 0.43, 0.48, -0.23),
      box(0.04, 0.92, 0.04, -0.43, 0.48, 0.23),
      box(0.04, 0.92, 0.04, 0.43, 0.48, 0.23),
      cyl(0.02, 0.02, 0.5, 8, 0, 1.0, 0, 0, 0, Math.PI / 2),
    );
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.rubber.push(cyl(0.06, 0.06, 0.04, 10, sx * 0.36, 0.06, sz * 0.19, 0, 0, Math.PI / 2));
    }
    // A few books riding along
    for (let i = 0; i < 7; i++) {
      parts.item.push(box(0.05, 0.22, 0.16, -0.32 + i * 0.06, 0.41, 0, 0, 0, i === 6 ? 0.4 : 0));
    }
    return parts;
  },

  stool() {
    return {
      darkWood: [
        box(0.42, 0.05, 0.34, 0, 0.42, 0, 0, 0, 0, 0.015),
        box(0.42, 0.05, 0.34, 0, 0.21, 0.06, 0, 0, 0, 0.015),
        box(0.05, 0.44, 0.05, -0.17, 0.22, -0.13),
        box(0.05, 0.44, 0.05, 0.17, 0.22, -0.13),
        box(0.05, 0.22, 0.05, -0.17, 0.11, 0.13),
        box(0.05, 0.22, 0.05, 0.17, 0.11, 0.13),
      ],
    };
  },

  stack() {
    const items = [];
    let y = 0;
    const n = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const h = 0.05;
      items.push(box(0.19, h, 0.26, (Math.random() - 0.5) * 0.05, y + h / 2, (Math.random() - 0.5) * 0.05, 0, Math.random() * 0.4 - 0.2, 0));
      y += h;
    }
    return { item: items };
  },

  beanbag() {
    return {
      fabric: [
        sphere(0.46, 14, 10, 0, 0.36, 0),
        box(0.9, 0.28, 0.9, 0, 0.14, 0, 0, 0, 0, 0.13),
      ],
    };
  },

  carrel() {
    return {
      darkWood: [
        box(1.5, 0.06, 0.75, 0, 0.74, 0, 0, 0, 0, 0.01),
        box(0.06, 0.74, 0.72, -0.72, 0.37, 0),
        box(0.06, 0.74, 0.72, 0.72, 0.37, 0),
        box(1.5, 0.62, 0.05, 0, 1.05, -0.36),
        box(0.05, 0.62, 0.36, -0.72, 1.05, -0.19),
        box(0.05, 0.62, 0.36, 0.72, 1.05, -0.19),
        box(1.4, 0.05, 0.2, 0, 1.12, -0.28),
      ],
    };
  },

  vitrine() {
    return {
      darkWood: [
        box(2.2, 0.75, 1.0, 0, 0.375, 0, 0, 0, 0, 0.02),
        box(2.3, 0.06, 1.1, 0, 0.78, 0, 0, 0, 0, 0.01),
      ],
      brass: [
        box(0.04, 0.5, 0.04, -1.08, 1.06, -0.48),
        box(0.04, 0.5, 0.04, 1.08, 1.06, -0.48),
        box(0.04, 0.5, 0.04, -1.08, 1.06, 0.48),
        box(0.04, 0.5, 0.04, 1.08, 1.06, 0.48),
        box(2.2, 0.04, 1.0, 0, 1.32, 0),
      ],
      glass: [box(2.16, 0.48, 0.96, 0, 1.06, 0)],
      item: [
        box(0.06, 0.28, 0.2, -0.5, 0.94, 0, 0, 0.3, 0),
        box(0.06, 0.26, 0.19, 0.4, 0.93, 0.1, 0, -0.4, 0),
      ],
    };
  },

  puppettheatre() {
    return {
      darkWood: [
        box(2.4, 2.0, 0.16, 0, 1.0, 0, 0, 0, 0, 0.03),
        box(2.6, 0.14, 0.3, 0, 2.02, 0, 0, 0, 0, 0.04),
        box(0.2, 2.0, 0.3, -1.2, 1.0, 0),
        box(0.2, 2.0, 0.3, 1.2, 1.0, 0),
      ],
      fabric: [
        box(0.55, 0.8, 0.05, -0.52, 1.35, 0.1),
        box(0.55, 0.8, 0.05, 0.52, 1.35, 0.1),
        box(1.9, 0.2, 0.06, 0, 1.85, 0.1),
      ],
    };
  },

  windowseat() {
    return {
      darkWood: [box(2.6, 0.42, 0.9, 0, 0.21, 0, 0, 0, 0, 0.03)],
      fabric: [
        box(2.5, 0.16, 0.84, 0, 0.5, 0, 0, 0, 0, 0.07),
        box(0.5, 0.5, 0.18, -0.9, 0.72, -0.3, 0, 0, 0.1, 0.09),
        box(0.5, 0.5, 0.18, 0.85, 0.72, -0.3, 0, 0, -0.14, 0.09),
      ],
    };
  },

  desk() {
    // Panelled front, so the landmark reads as joinery rather than a slab.
    const panels = [];
    for (let i = -2; i <= 2; i++) {
      panels.push(box(0.78, 0.62, 0.06, i * 0.9, 0.56, 1.03, 0, 0, 0, 0.02));
    }
    return {
      darkWood: [
        box(4.8, 1.05, 2.0, 0, 0.525, 0, 0, 0, 0, 0.03),
        box(5.06, 0.1, 2.26, 0, 1.1, 0, 0, 0, 0, 0.02),
        box(5.0, 0.14, 0.16, 0, 0.16, 1.05),
        ...panels,
      ],
      brass: [
        // Just a nosing strip and two lamp stems — enough to catch the light.
        box(5.06, 0.025, 0.05, 0, 1.16, 1.12),
        cyl(0.04, 0.05, 0.42, 10, -1.8, 1.36, -0.6),
        cyl(0.04, 0.05, 0.42, 10, 1.8, 1.36, -0.6),
        cyl(0.16, 0.09, 0.16, 12, -1.8, 1.62, -0.6),
        cyl(0.16, 0.09, 0.16, 12, 1.8, 1.62, -0.6),
      ],
      item: [
        box(0.06, 0.26, 0.19, -0.8, 1.28, 0.2),
        box(0.06, 0.26, 0.19, -0.72, 1.28, 0.2),
        box(0.22, 0.06, 0.3, 0.9, 1.18, 0.1, 0, 0.2, 0),
        box(0.2, 0.05, 0.28, 0.86, 1.23, 0.06, 0, -0.15, 0),
      ],
    };
  },

  globe() {
    return {
      brass: [
        cyl(0.34, 0.44, 0.08, 20, 0, 0.04, 0),
        cyl(0.07, 0.07, 0.5, 12, 0, 0.3, 0),
        torus(0.62, 0.03, 8, 32, 0, 1.05, 0, 0.3),
      ],
      marble: [cyl(0.5, 0.5, 0.1, 24, 0, 0.6, 0)],
      cloth: [sphere(0.58, 28, 20, 0, 1.05, 0)],
    };
  },

  statue() {
    return {
      marble: [
        box(1.4, 0.24, 1.4, 0, 0.12, 0, 0, 0, 0, 0.03),
        box(1.15, 0.9, 1.15, 0, 0.68, 0, 0, 0, 0, 0.04),
        box(1.3, 0.14, 1.3, 0, 1.2, 0, 0, 0, 0, 0.03),
        // Figure
        cyl(0.22, 0.3, 1.15, 14, 0, 1.85, 0),
        sphere(0.19, 16, 12, 0, 2.55, 0),
        cyl(0.09, 0.07, 0.75, 10, -0.3, 1.95, 0.1, 0, 0, 0.42),
        cyl(0.09, 0.07, 0.75, 10, 0.3, 1.95, -0.05, 0, 0, -0.3),
        box(0.24, 0.32, 0.08, 0.42, 2.24, -0.16, 0.2, 0, -0.3),
      ],
    };
  },

  fountain() {
    return {
      marble: [
        cyl(2.0, 2.15, 0.5, 28, 0, 0.25, 0),
        cyl(1.75, 1.75, 0.12, 28, 0, 0.46, 0),
        cyl(0.28, 0.4, 1.0, 16, 0, 0.95, 0),
        cyl(0.85, 0.85, 0.12, 22, 0, 1.5, 0),
        cyl(0.12, 0.2, 0.5, 12, 0, 1.78, 0),
      ],
      glass: [
        cyl(1.72, 1.72, 0.26, 28, 0, 0.42, 0),
        cyl(0.8, 0.8, 0.08, 22, 0, 1.5, 0),
      ],
    };
  },

  cardcatalog() {
    const drawers = [];
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 5; c++) {
        drawers.push(box(0.24, 0.17, 0.06, (c - 2) * 0.26, 0.2 + r * 0.19, 0.33, 0, 0, 0, 0.01));
      }
    }
    return {
      darkWood: [
        box(1.4, 1.32, 0.66, 0, 0.66, 0, 0, 0, 0, 0.02),
        box(1.52, 0.08, 0.76, 0, 1.36, 0, 0, 0, 0, 0.015),
        ...drawers,
      ],
      brass: drawers.map((_, i) => box(0.07, 0.03, 0.03, ((i % 5) - 2) * 0.26, 0.2 + Math.floor(i / 5) * 0.19, 0.37)),
    };
  },
};

const _cache = new Map();

/** Merged, material-keyed geometry for a prop kind. Cached across levels. */
export function buildProp(kind) {
  if (_cache.has(kind)) return _cache.get(kind);
  const builder = BUILDERS[kind] || BUILDERS.stool;
  const raw = builder();
  const out = {};
  for (const [matKey, geos] of Object.entries(raw)) {
    const merged = mergeParts(geos);
    if (merged) out[matKey] = merged;
  }
  _cache.set(kind, out);
  return out;
}

export const PROP_KINDS = Object.keys(BUILDERS);

export function disposePropCache() {
  for (const parts of _cache.values()) for (const g of Object.values(parts)) g.dispose();
  _cache.clear();
}

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

/** Merge a list of geometries, guaranteeing a white vertex-color attribute. */
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

  // Rental-store trolley: the shelves carry broad VHS cases rather than the
  // narrow upright book spines used by the library cart.
  videocart() {
    const parts = { metal: [], item: [], rubber: [] };
    parts.metal.push(
      box(0.95, 0.05, 0.58, 0, 0.28, 0),
      box(0.95, 0.05, 0.58, 0, 0.72, 0),
      box(0.05, 0.9, 0.05, -0.44, 0.48, -0.25),
      box(0.05, 0.9, 0.05, 0.44, 0.48, -0.25),
      box(0.05, 0.9, 0.05, -0.44, 0.48, 0.25),
      box(0.05, 0.9, 0.05, 0.44, 0.48, 0.25),
      cyl(0.025, 0.025, 0.58, 8, 0, 1.0, 0, 0, 0, Math.PI / 2),
    );
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 5; i++) {
        parts.item.push(box(0.14, 0.25, 0.045, -0.34 + i * 0.17, 0.43 + row * 0.43, 0, 0, 0, (i - 2) * 0.025, 0.012));
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.rubber.push(cyl(0.065, 0.065, 0.045, 10, sx * 0.37, 0.065, sz * 0.21, 0, 0, Math.PI / 2));
    }
    return parts;
  },

  shoppingcart() {
    const basket = [];
    basket.push(
      box(0.95, 0.045, 0.55, 0, 0.24, 0),
      box(0.95, 0.045, 0.55, 0, 0.72, 0),
      box(0.045, 0.52, 0.55, -0.46, 0.49, 0),
      box(0.045, 0.52, 0.55, 0.46, 0.49, 0),
      box(0.95, 0.52, 0.045, 0, 0.49, -0.255),
      box(0.95, 0.52, 0.045, 0, 0.49, 0.255),
      box(0.05, 0.74, 0.05, -0.43, 0.42, -0.24, 0, 0, -0.2),
      box(0.05, 0.74, 0.05, 0.43, 0.42, -0.24, 0, 0, -0.2),
      cyl(0.025, 0.025, 1.05, 8, 0, 0.94, -0.33, 0, 0, Math.PI / 2),
    );
    const wheels = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      wheels.push(cyl(0.07, 0.07, 0.045, 10, sx * 0.36, 0.07, sz * 0.21, 0, 0, Math.PI / 2));
    }
    return { metal: basket, rubber: wheels };
  },

  vhsdropbox() {
    return {
      darkWood: [box(0.72, 1.12, 0.62, 0, 0.56, 0, 0, 0, 0, 0.05)],
      item: [
        box(0.68, 0.34, 0.035, 0, 0.88, 0.325, 0, 0, 0, 0.02),
        box(0.44, 0.08, 0.055, 0, 0.56, 0.34, 0, 0, 0, 0.015),
      ],
      metal: [box(0.48, 0.04, 0.08, 0, 0.55, 0.37)],
    };
  },

  recordbin() {
    const sleeves = [];
    for (let i = 0; i < 7; i++) {
      sleeves.push(box(0.025, 0.34, 0.34, -0.27 + i * 0.09, 0.79 + (i % 2) * 0.025, 0, 0, 0, (i - 3) * 0.025, 0.008));
    }
    return {
      darkWood: [
        box(1.08, 0.64, 0.82, 0, 0.32, 0, 0, 0, 0, 0.035),
        box(1.16, 0.09, 0.9, 0, 0.68, 0),
        box(0.08, 0.75, 0.82, -0.5, 0.7, 0),
        box(0.08, 0.75, 0.82, 0.5, 0.7, 0),
      ],
      item: sleeves,
    };
  },

  producecrate() {
    const produce = [];
    for (let x = -2; x <= 2; x++) for (let z = -1; z <= 1; z++) {
      produce.push(sphere(0.095, 9, 7, x * 0.16, 0.58 + ((x + z + 5) % 2) * 0.05, z * 0.17));
    }
    return {
      darkWood: [
        box(1.0, 0.08, 0.75, 0, 0.1, 0),
        box(1.0, 0.42, 0.06, 0, 0.3, -0.35),
        box(1.0, 0.42, 0.06, 0, 0.3, 0.35),
        box(0.06, 0.42, 0.75, -0.47, 0.3, 0),
        box(0.06, 0.42, 0.75, 0.47, 0.3, 0),
      ],
      item: produce,
    };
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

  puppettheater() {
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

  videocounter() {
    return {
      darkWood: [
        box(5.0, 1.05, 1.9, 0, 0.525, 0, 0, 0, 0, 0.05),
        box(5.18, 0.1, 2.08, 0, 1.08, 0, 0, 0, 0, 0.025),
      ],
      item: [
        box(4.7, 0.34, 0.045, 0, 0.65, 0.975, 0, 0, 0, 0.025),
        box(0.78, 0.52, 0.42, -1.55, 1.38, -0.32, 0, 0, 0, 0.035),
      ],
      glass: [box(0.62, 0.36, 0.025, -1.55, 1.4, -0.095, -0.08, 0, 0, 0.02)],
      metal: [
        box(1.05, 0.1, 0.6, 1.3, 1.18, 0),
        box(0.62, 0.05, 0.38, 1.28, 1.28, 0),
        cyl(0.11, 0.11, 0.035, 16, 1.08, 1.33, 0, 0, 0, Math.PI / 2),
        cyl(0.11, 0.11, 0.035, 16, 1.48, 1.33, 0, 0, 0, Math.PI / 2),
      ],
      lampGlow: [box(4.55, 0.035, 0.04, 0, 0.96, 1.01)],
    };
  },

  recordcounter() {
    return {
      darkWood: [
        box(4.9, 1.0, 1.9, 0, 0.5, 0, 0, 0, 0, 0.045),
        box(5.08, 0.11, 2.06, 0, 1.06, 0, 0, 0, 0, 0.025),
        box(4.55, 0.52, 0.06, 0, 0.58, 0.98, 0, 0, 0, 0.02),
      ],
      brass: [
        box(4.6, 0.035, 0.035, 0, 0.9, 1.02),
        cyl(0.42, 0.42, 0.035, 28, -1.2, 1.145, 0),
        cyl(0.055, 0.055, 0.06, 14, -1.2, 1.19, 0),
      ],
      metal: [
        box(1.05, 0.09, 0.72, 1.15, 1.15, 0),
        cyl(0.38, 0.38, 0.025, 28, 1.15, 1.22, 0),
        box(0.05, 0.05, 0.48, 1.48, 1.25, -0.04, 0, 0.25, 0),
      ],
      item: [
        box(0.035, 0.36, 0.36, -0.25, 1.29, 0.02, 0, 0, -0.1, 0.008),
        box(0.035, 0.36, 0.36, -0.18, 1.29, 0.02, 0, 0, 0.08, 0.008),
      ],
    };
  },

  checkoutcounter() {
    return {
      metal: [
        box(5.3, 0.88, 1.72, 0, 0.44, 0, 0, 0, 0, 0.055),
        box(5.48, 0.1, 1.9, 0, 0.93, 0, 0, 0, 0, 0.025),
        box(0.18, 0.62, 0.18, 1.72, 1.25, -0.42),
        box(0.76, 0.52, 0.18, 1.72, 1.55, -0.42, -0.12, 0, 0, 0.035),
      ],
      rubber: [box(2.8, 0.06, 1.18, -0.68, 1.02, 0, 0, 0, 0, 0.025)],
      item: [
        box(1.0, 0.32, 0.045, 1.72, 1.56, -0.31, -0.12, 0, 0, 0.02),
        box(1.1, 0.32, 0.04, -1.83, 0.58, 0.88, 0, 0, 0, 0.02),
      ],
      lampGlow: [box(0.52, 0.04, 0.04, 1.72, 1.58, -0.27)],
    };
  },

  previewstation() {
    return {
      metal: [
        box(1.3, 1.25, 0.48, 0, 0.625, -0.08, 0, 0, 0, 0.04),
        box(1.45, 0.08, 0.66, 0, 1.29, -0.02, 0, 0, 0, 0.02),
      ],
      item: [box(1.05, 0.65, 0.05, 0, 0.88, 0.19, -0.05, 0, 0, 0.04)],
      glass: [box(0.86, 0.46, 0.025, 0, 0.9, 0.225, -0.05, 0, 0, 0.03)],
      rubber: [
        cyl(0.12, 0.12, 0.05, 14, -0.38, 0.38, 0.22, Math.PI / 2),
        cyl(0.12, 0.12, 0.05, 14, 0.38, 0.38, 0.22, Math.PI / 2),
      ],
      lampGlow: [box(0.88, 0.025, 0.025, 0, 1.21, 0.235)],
    };
  },

  moviedisplay() {
    const cases = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      cases.push(box(0.25, 0.36, 0.035, (c - 2) * 0.3, 0.55 + r * 0.48, 0.28, 0, 0, (c - 2) * 0.015, 0.012));
    }
    return {
      metal: [
        box(1.8, 2.05, 0.52, 0, 1.025, 0, 0, 0, 0, 0.04),
        box(2.0, 0.12, 0.72, 0, 0.06, 0, 0, 0, 0, 0.025),
      ],
      item: cases,
      lampGlow: [box(1.7, 0.055, 0.045, 0, 1.94, 0.31)],
    };
  },

  listeningstation() {
    return {
      darkWood: [
        box(1.3, 1.12, 0.58, 0, 0.56, 0, 0, 0, 0, 0.04),
        box(1.42, 0.08, 0.72, 0, 1.16, 0, 0, 0, 0, 0.018),
      ],
      metal: [
        cyl(0.43, 0.43, 0.025, 24, 0, 1.225, 0),
        cyl(0.055, 0.055, 0.06, 12, 0, 1.27, 0),
        torus(0.3, 0.045, 8, 20, -0.4, 1.52, 0, Math.PI / 2),
        box(0.06, 0.32, 0.06, -0.68, 1.45, 0),
      ],
      item: [box(0.42, 0.42, 0.028, 0.4, 1.43, -0.03, -0.08, 0, 0, 0.008)],
    };
  },

  turntabledisplay() {
    return {
      darkWood: [
        box(2.2, 0.9, 1.5, 0, 0.45, 0, 0, 0, 0, 0.06),
        box(2.36, 0.1, 1.66, 0, 0.96, 0, 0, 0, 0, 0.025),
      ],
      metal: [
        cyl(0.62, 0.62, 0.03, 32, 0, 1.04, 0),
        cyl(0.07, 0.07, 0.07, 14, 0, 1.085, 0),
        box(0.05, 0.05, 0.65, 0.55, 1.1, -0.12, 0, 0.35, 0),
      ],
      brass: [torus(0.64, 0.025, 8, 32, 0, 1.07, 0)],
    };
  },

  speakerstack() {
    return {
      darkWood: [box(0.72, 1.42, 0.62, 0, 0.71, 0, 0, 0, 0, 0.05)],
      rubber: [
        cyl(0.24, 0.24, 0.06, 22, 0, 0.47, 0.32, Math.PI / 2),
        cyl(0.18, 0.18, 0.06, 20, 0, 0.98, 0.32, Math.PI / 2),
        cyl(0.07, 0.07, 0.06, 14, 0, 1.24, 0.32, Math.PI / 2),
      ],
      brass: [
        torus(0.24, 0.025, 8, 22, 0, 0.47, 0.355, Math.PI / 2),
        torus(0.18, 0.02, 8, 20, 0, 0.98, 0.355, Math.PI / 2),
      ],
    };
  },

  produceisland() {
    const fruit = [];
    for (let x = -4; x <= 4; x++) for (let z = -2; z <= 2; z++) {
      if ((x + z) % 2) fruit.push(sphere(0.105, 9, 7, x * 0.22, 1.06 + ((x * z + 9) % 3) * 0.035, z * 0.23));
    }
    return {
      metal: [
        box(2.35, 0.78, 1.55, 0, 0.39, 0, 0, 0, 0, 0.07),
        box(2.55, 0.12, 1.75, 0, 0.84, 0, 0, 0, 0, 0.03),
        box(2.35, 0.16, 1.55, 0, 0.98, 0, 0, 0, 0, 0.03),
      ],
      item: fruit,
    };
  },

  bakerydisplay() {
    const loaves = [];
    for (let i = 0; i < 6; i++) loaves.push(box(0.42, 0.16, 0.25, -0.82 + (i % 3) * 0.82, 1.04 + Math.floor(i / 3) * 0.32, 0.12, 0, 0, 0, 0.08));
    return {
      metal: [
        box(2.4, 0.75, 1.1, 0, 0.375, 0, 0, 0, 0, 0.04),
        box(2.5, 0.08, 1.18, 0, 0.8, 0, 0, 0, 0, 0.02),
      ],
      glass: [box(2.32, 0.72, 0.95, 0, 1.18, 0)],
      item: loaves,
      lampGlow: [box(2.25, 0.035, 0.04, 0, 1.52, 0.51)],
    };
  },

  freezercase() {
    return {
      metal: [
        box(1.42, 1.42, 0.72, 0, 0.71, 0, 0, 0, 0, 0.045),
        box(1.5, 0.1, 0.82, 0, 1.47, 0, 0, 0, 0, 0.02),
      ],
      glass: [box(1.24, 0.98, 0.035, 0, 0.91, 0.38, 0, 0, 0, 0.025)],
      item: [
        box(0.32, 0.28, 0.18, -0.42, 0.55, 0.28, 0, 0, -0.08, 0.025),
        box(0.28, 0.42, 0.16, 0.02, 0.62, 0.28, 0, 0, 0.05, 0.025),
        cyl(0.14, 0.14, 0.42, 12, 0.43, 0.62, 0.28),
      ],
      lampGlow: [box(1.18, 0.035, 0.035, 0, 1.36, 0.405)],
    };
  },

  librarysign() {
    return {
      darkWood: [
        box(2.5, 0.72, 0.16, 0, 3.22, 0, 0, 0, 0, 0.045),
        box(0.06, 2.2, 0.06, -1.05, 4.65, 0),
        box(0.06, 2.2, 0.06, 1.05, 4.65, 0),
      ],
      brass: [
        box(2.62, 0.045, 0.2, 0, 3.56, 0),
        box(2.62, 0.045, 0.2, 0, 2.88, 0),
      ],
      pages: [
        box(0.72, 0.08, 0.05, -0.36, 3.2, 0.11, 0, 0, -0.15, 0.02),
        box(0.72, 0.08, 0.05, 0.36, 3.2, 0.11, 0, 0, 0.15, 0.02),
      ],
    };
  },

  moviesign() {
    const bulbs = [];
    for (let i = -5; i <= 5; i++) {
      bulbs.push(sphere(0.045, 7, 5, i * 0.2, 2.86, 0.14));
      bulbs.push(sphere(0.045, 7, 5, i * 0.2, 3.58, 0.14));
    }
    return {
      item: [box(2.55, 0.86, 0.17, 0, 3.22, 0, 0, 0, 0, 0.055)],
      metal: [
        box(0.055, 2.2, 0.055, -1.0, 4.72, 0),
        box(0.055, 2.2, 0.055, 1.0, 4.72, 0),
        box(0.12, 0.48, 0.055, -0.2, 3.22, 0.12, 0, 0, -0.45),
        box(0.12, 0.48, 0.055, 0.2, 3.22, 0.12, 0, 0, 0.45),
      ],
      lampGlow: bulbs,
    };
  },

  recordsign() {
    return {
      darkWood: [
        box(2.5, 0.84, 0.15, 0, 3.22, 0, 0, 0, 0, 0.055),
        box(0.055, 2.15, 0.055, -1.0, 4.7, 0),
        box(0.055, 2.15, 0.055, 1.0, 4.7, 0),
      ],
      rubber: [cyl(0.31, 0.31, 0.055, 28, 0, 3.22, 0.11, Math.PI / 2)],
      brass: [
        torus(0.31, 0.025, 8, 28, 0, 3.22, 0.145, Math.PI / 2),
        cyl(0.06, 0.06, 0.065, 14, 0, 3.22, 0.15, Math.PI / 2),
      ],
    };
  },

  marketsign() {
    return {
      item: [box(2.8, 0.76, 0.16, 0, 3.22, 0, 0, 0, 0, 0.055)],
      metal: [
        box(0.055, 2.25, 0.055, -1.1, 4.72, 0),
        box(0.055, 2.25, 0.055, 1.1, 4.72, 0),
        box(0.62, 0.08, 0.08, 0, 3.08, 0.13, 0, 0, -0.18),
        box(0.05, 0.34, 0.05, -0.27, 3.28, 0.13, 0, 0, -0.18),
        box(0.05, 0.34, 0.05, 0.27, 3.11, 0.13, 0, 0, -0.18),
      ],
      lampGlow: [
        sphere(0.16, 10, 8, -0.34, 3.34, 0.13),
        sphere(0.16, 10, 8, 0, 3.38, 0.13),
        sphere(0.16, 10, 8, 0.34, 3.34, 0.13),
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

  headstone() {
    return { marble: [
      box(0.72, 0.82, 0.22, 0, 0.43, 0, 0, 0, 0, 0.05),
      cyl(0.36, 0.36, 0.22, 14, 0, 0.84, 0, Math.PI / 2),
      box(0.88, 0.12, 0.42, 0, 0.06, 0, 0, 0, 0, 0.03),
    ] };
  },

  crossMarker() {
    return { marble: [
      box(0.22, 1.35, 0.2, 0, 0.68, 0, 0, 0, 0, 0.025),
      box(0.8, 0.2, 0.2, 0, 0.96, 0, 0, 0, 0, 0.025),
      box(0.82, 0.1, 0.4, 0, 0.05, 0),
    ] };
  },

  graveSlab() {
    return { marble: [
      box(0.92, 0.18, 1.8, 0, 0.09, 0, -0.03, 0, 0, 0.05),
      box(0.48, 0.55, 0.18, 0, 0.38, -0.72, -0.05, 0, 0, 0.04),
    ] };
  },

  obelisk() {
    return { marble: [
      box(1.35, 0.3, 1.35, 0, 0.15, 0),
      box(1.0, 0.38, 1.0, 0, 0.49, 0),
      cyl(0.34, 0.58, 3.2, 4, 0, 2.24, 0, 0, Math.PI / 4),
      cyl(0, 0.34, 0.85, 4, 0, 4.26, 0, 0, Math.PI / 4),
    ] };
  },

  mausoleum() {
    const columns = [];
    for (const x of [-2.4, -1.55, 1.55, 2.4]) columns.push(cyl(0.22, 0.27, 2.6, 12, x, 1.5, 2.0));
    return {
      marble: [
        box(6.2, 3.4, 4.8, 0, 1.7, 0, 0, 0, 0, 0.08),
        box(6.8, 0.28, 5.35, 0, 0.14, 0),
        box(6.7, 0.3, 5.2, 0, 3.45, 0),
        ...columns,
        box(5.7, 0.36, 0.4, 0, 3.78, 2.16),
      ],
      metal: [
        box(1.45, 2.55, 0.12, 0, 1.42, 2.43, 0, 0, 0, 0.03),
        box(0.08, 2.2, 0.14, 0, 1.5, 2.51),
        box(0.7, 0.08, 0.14, 0, 1.58, 2.51),
      ],
    };
  },

  crypt() {
    return {
      marble: [
        box(5.4, 2.6, 4.2, 0, 1.3, 0, 0, 0, 0, 0.08),
        box(6.0, 0.3, 4.8, 0, 0.15, 0),
        box(5.8, 0.32, 4.6, 0, 2.72, 0),
        cyl(0, 3.1, 1.25, 4, 0, 3.45, 0, 0, Math.PI / 4),
      ],
      metal: [box(1.35, 2.05, 0.1, 0, 1.15, 2.13, 0, 0, 0, 0.03)],
    };
  },

  stoneAngel() {
    return { marble: [
      box(1.25, 0.28, 1.0, 0, 0.14, 0),
      cyl(0.3, 0.42, 1.5, 12, 0, 1.0, 0),
      sphere(0.28, 12, 9, 0, 1.95, 0),
      box(0.16, 1.55, 0.7, -0.52, 1.55, -0.05, 0.18, 0, -0.42, 0.08),
      box(0.16, 1.55, 0.7, 0.52, 1.55, -0.05, 0.18, 0, 0.42, 0.08),
    ] };
  },

  gnarledTree() {
    return {
      darkWood: [
        cyl(0.48, 0.72, 4.8, 9, 0, 2.4, 0, 0.08, 0, -0.08),
        cyl(0.22, 0.42, 3.4, 8, -0.8, 4.35, 0, 0, 0, -0.55),
        cyl(0.18, 0.36, 3.1, 8, 0.85, 4.2, 0.1, 0, 0, 0.62),
        cyl(0.12, 0.25, 2.2, 7, -1.55, 5.35, 0, 0, 0, -0.9),
      ],
      fabric: [
        sphere(1.35, 11, 8, -1.15, 5.7, 0),
        sphere(1.55, 11, 8, 0.65, 5.75, -0.2),
        sphere(1.15, 10, 7, 1.7, 5.25, 0.3),
      ],
    };
  },

  shrub() {
    return { fabric: [
      sphere(0.55, 10, 7, -0.32, 0.42, 0),
      sphere(0.65, 10, 7, 0.2, 0.48, 0.1),
      sphere(0.42, 9, 6, 0.55, 0.34, -0.12),
    ] };
  },

  cemeteryLamp() {
    return {
      metal: [
        cyl(0.09, 0.13, 3.0, 10, 0, 1.5, 0),
        box(0.7, 0.08, 0.7, 0, 3.02, 0),
        box(0.55, 0.62, 0.55, 0, 3.34, 0, 0, 0, 0, 0.04),
        cyl(0, 0.42, 0.35, 4, 0, 3.82, 0, 0, Math.PI / 4),
      ],
      lampGlow: [sphere(0.22, 10, 8, 0, 3.36, 0)],
    };
  },

  cemeteryGate() {
    const bars = [];
    for (let i = -7; i <= 7; i++) bars.push(box(0.07, 2.5 + (7 - Math.abs(i)) * 0.09, 0.08, i * 0.34, 1.45, 0));
    return {
      marble: [
        box(1.0, 3.8, 1.0, -3.3, 1.9, 0), box(1.0, 3.8, 1.0, 3.3, 1.9, 0),
        box(1.25, 0.28, 1.25, -3.3, 3.94, 0), box(1.25, 0.28, 1.25, 3.3, 3.94, 0),
      ],
      metal: [
        ...bars,
        box(5.1, 0.1, 0.1, 0, 0.55, 0), box(5.1, 0.1, 0.1, 0, 2.5, 0),
        new THREE.TorusGeometry(2.55, 0.07, 6, 26, Math.PI).rotateZ(Math.PI).translate(0, 2.45, 0),
      ],
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

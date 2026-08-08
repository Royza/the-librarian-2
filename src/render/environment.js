import * as THREE from 'three';

// A hand-built "cornell box" of emissive panels, baked into an environment map
// via PMREM. This is what gives every PBR surface in the library its soft,
// believable ambient response — warm bounce from the wood and lamps below,
// cool sky spilling in from the clerestory windows above.

function panel(scene, { w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, color, intensity }) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  scene.add(m);
  return m;
}

export function buildEnvironment(renderer, palette = {}) {
  const {
    sky = '#8fb4de',        // cool window light
    warm = '#ffb469',       // pendant lamps
    bounce = '#8a5f38',     // wood floor bounce
    ceiling = '#c9b79a',
    ambient = '#2a2118',
    skyStrength = 2.6,
    warmStrength = 3.2,
  } = palette;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ambient);

  // Shell — a big inverted box establishes the base ambient tone.
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(24, 14, 24),
    new THREE.MeshStandardMaterial({ side: THREE.BackSide, color: new THREE.Color(ambient), roughness: 1 })
  );
  scene.add(shell);

  // Ceiling wash
  panel(scene, { w: 20, h: 0.2, d: 20, x: 0, y: 6.6, z: 0, color: ceiling, intensity: 0.55 });
  // Floor bounce
  panel(scene, { w: 22, h: 0.2, d: 22, x: 0, y: -6.6, z: 0, color: bounce, intensity: 0.45 });

  // Clerestory windows: tall cool slabs high on two opposing walls.
  for (const sx of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      panel(scene, {
        w: 0.2, h: 6, d: 3.4, x: sx * 11, y: 2.4, z: i * 6.5,
        color: sky, intensity: skyStrength,
      });
    }
  }
  // A softer, larger cool fill from one end (the reading-hall arch).
  panel(scene, { w: 9, h: 5.5, d: 0.2, x: 0, y: 2.0, z: -11, color: sky, intensity: skyStrength * 0.55 });

  // Pendant lamps: a ring of warm point-ish emitters at working height.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    panel(scene, {
      w: 1.6, h: 0.5, d: 1.6,
      x: Math.cos(a) * 7.2, y: 1.6, z: Math.sin(a) * 7.2,
      color: warm, intensity: warmStrength,
    });
  }
  // Low warm rim so characters' undersides don't go dead black.
  panel(scene, { w: 16, h: 0.3, d: 16, x: 0, y: -3.4, z: 0, color: warm, intensity: 0.35 });

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();

  // Free the scratch scene
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });

  // Return the render target, not just the texture — the caller owns disposal.
  return rt;
}

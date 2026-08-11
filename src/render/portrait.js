import * as THREE from 'three';
import { SoloCharacter } from '../entities/character.js';
import { buildMaterials } from './materials.js';
import { buildEnvironment } from './environment.js';
import { THEMES } from '../data/themes.js';

// Character-select portraits. Rather than ship illustrations that could drift
// from the rig, each card renders the real in-game model in its own tiny
// scene. One shared renderer and material set serve every card.

let shared = null;

function getShared() {
  if (shared) return shared;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = false;

  const envTarget = buildEnvironment(renderer, THEMES.library.envPalette);
  const scene = new THREE.Scene();
  scene.environment = envTarget.texture;

  // Three-point-ish rig: warm key, cool fill, rim from behind.
  const key = new THREE.DirectionalLight(0xffe6c0, 2.6);
  key.position.set(2.2, 3.4, 3.2);
  const fill = new THREE.DirectionalLight(0x9fc4ff, 1.0);
  fill.position.set(-3, 1.4, 2);
  const rim = new THREE.DirectionalLight(0xffd9a0, 2.2);
  rim.position.set(-1.4, 2.4, -3.2);
  scene.add(key, fill, rim, new THREE.HemisphereLight(0xbcd4f0, 0x2a2118, 0.7));

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 40);

  shared = {
    renderer, scene, camera, envTarget,
    mats: buildMaterials(THEMES.library),
    models: new Map(),
  };
  return shared;
}

/** Render `character` into `canvas` (a still — no per-frame cost afterwards). */
export function renderPortrait(canvas, character) {
  const S = getShared();

  let model = S.models.get(character.id);
  if (!model) {
    model = new SoloCharacter(S.scene, S.mats, {
      height: character.height,
      chunk: character.chunk,
      style: character.style,
      colors: character.colors,
      matMap: character.matMap,
    });
    S.models.set(character.id, model);
  }

  // Only the subject of this portrait is visible.
  for (const [id, m] of S.models) m.setVisible(id === character.id);

  // A relaxed, nearly frontal stance keeps facial likeness readable even in
  // the compact select cards; the slight turn still gives the rig depth.
  model.pose(0, 0, 0, 0.22, {
    phase: 0.9, speed: 0.9, lean: 0.08, armMode: 'swing',
    headYaw: -0.12, headPitch: 0.04, flail: 0, crouch: 0, hurt: 0, celebrate: 0,
  }, 1);

  const w = Math.max(1, canvas.clientWidth || 220);
  const h = Math.max(1, canvas.clientHeight || 260);
  S.renderer.setSize(w, h, false);
  S.camera.aspect = w / h;

  // Fill the stage instead of leaving the model thumbnail-sized. The complete
  // silhouette remains visible, while Wolfe's eyes, cap mark, beard layers,
  // and plaid now survive at normal laptop resolution.
  const height = character.height;
  S.camera.position.set(height * 0.22, height * 0.66, height * 2.5);
  S.camera.lookAt(0, height * 0.54, 0);
  S.camera.updateProjectionMatrix();

  S.renderer.render(S.scene, S.camera);

  const ctx = canvas.getContext('2d');
  canvas.width = S.renderer.domElement.width;
  canvas.height = S.renderer.domElement.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(S.renderer.domElement, 0, 0);
}

export function disposePortraits() {
  if (!shared) return;
  for (const m of shared.models.values()) m.dispose();
  shared.envTarget.dispose();
  shared.renderer.dispose();
  shared = null;
}

import * as THREE from 'three';
import * as TX from './textures.js';

// Shared material library, rebuilt per level so every theme can re-skin the
// whole building. Everything is PBR and lit by the baked environment probe.

export function buildMaterials(theme) {
  const f = theme.floor;
  const floorTex = f.kind === 'wood'
    ? TX.woodFloor({ base: f.base, dark: f.dark, light: f.light })
    : f.kind === 'lino'
      ? TX.marble({ base: f.base, vein: f.dark, accent: f.light })
      : TX.rug({ field: f.base, border: f.dark, motif: f.light, cream: '#e6d7b8' });

  const floorRepeat = (theme.floorRepeat ?? 42);
  for (const t of Object.values(floorTex)) {
    if (t?.isTexture) { t.repeat.set(floorRepeat, floorRepeat); t.anisotropy = 16; }
  }

  const accent = TX.marble(theme.accentFloor);
  for (const t of Object.values(accent)) if (t?.isTexture) t.repeat.set(6, 6);

  const wood = TX.shelfWood(theme.shelfWood);
  const wallTex = TX.plaster({ base: theme.wall });
  for (const t of Object.values(wallTex)) if (t?.isTexture) t.repeat.set(10, 4);

  const spines = TX.bookSpines({ size: 512, tiles: 12 });

  const mats = {
    floor: new THREE.MeshStandardMaterial({
      map: floorTex.map,
      roughnessMap: floorTex.roughnessMap || null,
      normalMap: floorTex.normalMap || null,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: f.kind === 'lino' ? 0.5 : 0.78,
      metalness: 0.0,
      envMapIntensity: 0.6,
    }),

    accentFloor: new THREE.MeshStandardMaterial({
      map: accent.map,
      roughnessMap: accent.roughnessMap || null,
      roughness: 0.34,
      metalness: 0.02,
      envMapIntensity: 1.0,
    }),

    wood: new THREE.MeshStandardMaterial({
      map: wood.map,
      normalMap: wood.normalMap || null,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.55,
      metalness: 0.0,
      envMapIntensity: 0.9,
      vertexColors: true,
    }),

    darkWood: new THREE.MeshStandardMaterial({
      map: wood.map,
      normalMap: wood.normalMap || null,
      color: 0x9a8a7a,
      roughness: 0.48,
      metalness: 0.0,
      envMapIntensity: 1.0,
      vertexColors: true,
    }),

    // Item spines. Grayscale detail texture tinted by per-instance colour.
    item: new THREE.MeshStandardMaterial({
      map: spines.map,
      roughnessMap: spines.roughnessMap || null,
      normalMap: spines.normalMap || null,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.72,
      metalness: 0.0,
      envMapIntensity: 0.85,
      vertexColors: true,
    }),

    pages: new THREE.MeshStandardMaterial({
      map: TX.pageEdge().map,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.7,
    }),

    wall: new THREE.MeshStandardMaterial({
      map: wallTex.map,
      normalMap: wallTex.normalMap || null,
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.8,
      side: THREE.DoubleSide,
    }),

    ceiling: new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.wall).multiplyScalar(0.82),
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.55,
      side: THREE.DoubleSide,
    }),

    metal: new THREE.MeshStandardMaterial({
      color: 0x2b2f33, roughness: 0.35, metalness: 0.92, envMapIntensity: 1.6, vertexColors: true,
    }),

    brass: new THREE.MeshStandardMaterial({
      color: 0xa8863a, roughness: 0.42, metalness: 0.9, envMapIntensity: 1.0,
    }),

    fabric: new THREE.MeshStandardMaterial({
      color: 0x8a2b34, roughness: 0.93, metalness: 0.0, envMapIntensity: 0.65, vertexColors: true,
    }),

    leather: new THREE.MeshStandardMaterial({
      color: 0x53301c, roughness: 0.6, metalness: 0.0, envMapIntensity: 0.9, vertexColors: true,
    }),

    glass: new THREE.MeshPhysicalMaterial({
      color: 0xdfe9f2, roughness: 0.05, metalness: 0.0, transmission: 0.92,
      thickness: 0.05, ior: 1.45, transparent: true, opacity: 0.35,
      envMapIntensity: 2.0, side: THREE.DoubleSide,
    }),

    marble: new THREE.MeshStandardMaterial({
      map: accent.map, roughnessMap: accent.roughnessMap || null,
      color: 0xd8cfbe, roughness: 0.42, metalness: 0.02, envMapIntensity: 0.9,
    }),

    lampGlow: new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.lampColor).multiplyScalar(3.2),
      toneMapped: false,
      vertexColors: true,
    }),

    // Lamp hardware reads better as warm brass than cold steel.
    brassLamp: new THREE.MeshStandardMaterial({
      color: 0x8a6a30, roughness: 0.38, metalness: 0.85, envMapIntensity: 1.1, vertexColors: true,
    }),

    // A soft additive shell around each bulb so fixtures read as light sources
    // from the game's high camera, where you can't see into the shade.
    lampHalo: new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.lampColor),
      transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.BackSide, toneMapped: false, vertexColors: true,
    }),

    windowPane: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xdcecff).multiplyScalar(5.5),
      toneMapped: false,
    }),

    shaft: new THREE.MeshBasicMaterial({
      color: 0xffe6bd,
      transparent: true,
      opacity: 0.11,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),

    glowStrip: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      toneMapped: false,
    }),

    rug: new THREE.MeshStandardMaterial({
      map: TX.rug().map,
      roughness: 0.98, metalness: 0.0, envMapIntensity: 0.6,
      transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),

    shadowBlob: new THREE.MeshBasicMaterial({
      map: TX.radialAlpha({ power: 1.6 }),
      color: 0x000000, transparent: true, opacity: 0.42,
      depthWrite: false, blending: THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),

    // Flannel carries its colour in the weave, so meshes using it stay white.
    flannel: (() => {
      const t = TX.plaid().map.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2.4, 2.4);
      return new THREE.MeshStandardMaterial({
        map: t, roughness: 0.94, metalness: 0, envMapIntensity: 0.6, vertexColors: true,
      });
    })(),

    skin: new THREE.MeshStandardMaterial({ color: 0xe8b48c, roughness: 0.62, metalness: 0, envMapIntensity: 0.9, vertexColors: true }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x445577, roughness: 0.88, metalness: 0, envMapIntensity: 0.75, vertexColors: true }),
    hair: new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.55, metalness: 0, envMapIntensity: 1.0, vertexColors: true }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.75, metalness: 0, envMapIntensity: 0.6, vertexColors: true }),
  };

  return mats;
}

export function disposeMaterials(mats) {
  for (const m of Object.values(mats)) m?.dispose?.();
}

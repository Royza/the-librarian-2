import * as THREE from 'three';
import {
  EffectComposer, EffectPass, RenderPass, NormalPass, DepthDownsamplingPass,
  SSAOEffect, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
  ChromaticAberrationEffect, NoiseEffect, SMAAEffect, BrightnessContrastEffect,
  HueSaturationEffect, ShockWaveEffect, DepthOfFieldEffect, LensDistortionEffect,
  BlendFunction, KernelSize, Resolution,
} from 'postprocessing';
import { buildEnvironment } from './environment.js';

export const QUALITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  ULTRA: 'ultra',
};

const PRESETS = {
  low: { pixelRatio: 0.75, shadowMap: 1024, ssao: false, bloom: true, dof: false, msaa: 0, shadows: true, motes: 300 },
  medium: { pixelRatio: 1.0, shadowMap: 2048, ssao: true, bloom: true, dof: false, msaa: 0, shadows: true, motes: 700 },
  high: { pixelRatio: 1.0, shadowMap: 3072, ssao: true, bloom: true, dof: true, msaa: 2, shadows: true, motes: 1400 },
  ultra: { pixelRatio: 1.35, shadowMap: 4096, ssao: true, bloom: true, dof: true, msaa: 4, shadows: true, motes: 2400 },
};

export function autoDetectQuality() {
  const dpr = window.devicePixelRatio || 1;
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) return QUALITY.LOW;
  if (cores >= 10 && mem >= 8 && dpr >= 2) return QUALITY.ULTRA;
  if (cores >= 8 && mem >= 8) return QUALITY.HIGH;
  if (cores >= 4) return QUALITY.MEDIUM;
  return QUALITY.LOW;
}

export class RenderSystem {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping happens in post so bloom operates on linear HDR values.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    // We reset per frame in the game loop so the debug overlay can read totals
    // across every pass rather than just the last one.
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.15, 400);
    this.camera.position.set(0, 14, 14);

    this.envTarget = buildEnvironment(this.renderer);
    this.envMap = this.envTarget.texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 1.0;

    this.quality = null;
    this.effects = {};
    this.composer = null;
    this._shockTimers = [];
    this.reducedMotion = false;

    this.setQuality(autoDetectQuality());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get preset() { return PRESETS[this.quality]; }

  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    const p = PRESETS[q];
    this.renderer.shadowMap.enabled = p.shadows;
    this._buildComposer();
    this.resize();
    // Existing shadow-casting lights need their map size rebuilt.
    this.scene.traverse((o) => {
      if (o.isLight && o.shadow) {
        o.shadow.mapSize.set(p.shadowMap, p.shadowMap);
        o.shadow.map?.dispose();
        o.shadow.map = null;
      }
    });
  }

  _buildComposer() {
    this.composer?.dispose();
    const p = this.preset;

    const composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: p.msaa,
    });
    this.composer = composer;

    const renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(renderPass);

    const fx = {};

    if (p.ssao) {
      const normalPass = new NormalPass(this.scene, this.camera);
      const depthDownsample = new DepthDownsamplingPass({
        normalBuffer: normalPass.texture,
        resolutionScale: 0.5,
      });
      composer.addPass(normalPass);
      composer.addPass(depthDownsample);

      fx.ssao = new SSAOEffect(this.camera, normalPass.texture, {
        blendFunction: BlendFunction.MULTIPLY,
        distanceScaling: true,
        depthAwareUpsampling: true,
        normalDepthBuffer: depthDownsample.texture,
        samples: this.quality === QUALITY.ULTRA ? 24 : 14,
        rings: 5,
        luminanceInfluence: 0.65,
        radius: 0.09,
        intensity: 2.4,
        bias: 0.028,
        fade: 0.02,
        resolutionScale: this.quality === QUALITY.ULTRA ? 1.0 : 0.5,
        color: new THREE.Color(0x0a0704),
        worldDistanceThreshold: 22,
        worldDistanceFalloff: 6,
        worldProximityThreshold: 0.5,
        worldProximityFalloff: 0.2,
      });
      composer.addPass(new EffectPass(this.camera, fx.ssao));
      this._normalPass = normalPass;
    }

    if (p.dof) {
      // Focus rides with the player (see setFocusDistance) and the range is
      // wide, so the aisle you're working stays crisp and only the far reaches
      // of the stacks soften. This is a game, not a photograph.
      fx.dof = new DepthOfFieldEffect(this.camera, {
        focusDistance: 16,
        focusRange: 26,
        bokehScale: 2.6,
      });
      fx.dof.blendMode.opacity.value = 0.7;
    }

    fx.bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: 0.72,
      luminanceSmoothing: 0.34,
      intensity: 1.45,
      radius: 0.72,
      levels: 8,
      kernelSize: KernelSize.MEDIUM,
    });

    fx.shock = new ShockWaveEffect(this.camera, new THREE.Vector3(0, 0, 0), {
      speed: 2.2, maxRadius: 1.0, waveSize: 0.24, amplitude: 0.0,
    });

    fx.lens = new LensDistortionEffect({
      distortion: new THREE.Vector2(0, 0),
      principalPoint: new THREE.Vector2(0, 0),
      focalLength: new THREE.Vector2(1, 1),
      skew: 0,
    });

    fx.tone = new ToneMappingEffect({
      mode: ToneMappingMode.AGX,
      resolution: 256,
      whitePoint: 6.0,
      middleGray: 0.44,
      minLuminance: 0.008,
      averageLuminance: 1.0,
      adaptationRate: 1.2,
    });

    fx.grade = new HueSaturationEffect({ hue: 0.0, saturation: 0.14 });
    fx.contrast = new BrightnessContrastEffect({ brightness: 0.015, contrast: 0.12 });

    fx.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });

    fx.chroma = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0.00035, 0.00035),
      radialModulation: true,
      modulationOffset: 0.35,
    });

    fx.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
    fx.noise.blendMode.opacity.value = 0.055;

    fx.smaa = new SMAAEffect();

    // Convolution effects (DoF, chromatic aberration, SMAA) each need their own
    // pass — postprocessing refuses to merge two of them into one shader.
    if (fx.dof) composer.addPass(new EffectPass(this.camera, fx.dof));
    composer.addPass(new EffectPass(
      this.camera,
      fx.shock, fx.lens, fx.bloom, fx.tone, fx.grade, fx.contrast, fx.vignette, fx.noise,
    ));
    composer.addPass(new EffectPass(this.camera, fx.chroma));
    composer.addPass(new EffectPass(this.camera, fx.smaa));

    this.effects = fx;
    this._applyMotionPreference();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const p = this.preset;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Punch a screen-space shockwave from a world position (quakes, boss slams). */
  shockwave(position, { amplitude = 0.045, speed = 2.6, maxRadius = 1.2, waveSize = 0.22 } = {}) {
    if (this.reducedMotion) return;
    const s = this.effects.shock;
    if (!s) return;
    s.position.copy(position);
    s.speed = speed;
    s.maxRadius = maxRadius;
    s.waveSize = waveSize;
    s.amplitude = amplitude;
    s.explode();
  }

  /** Keep the focal plane on the hero so gameplay never goes soft. */
  setFocusDistance(meters) {
    const dof = this.effects.dof;
    if (!dof) return;
    const coc = dof.cocMaterial;
    coc.focusDistance = meters;
    coc.focusRange = Math.max(16, meters * 1.6);
  }

  /** Temporary lens warp — used by the volcano and alien tractor beam. */
  setLensDistortion(x, y) {
    this.effects.lens?.distortion.set(
      this.reducedMotion ? 0 : x,
      this.reducedMotion ? 0 : y,
    );
  }

  setReducedMotion(enabled) {
    this.reducedMotion = !!enabled;
    this._applyMotionPreference();
  }

  _applyMotionPreference() {
    const fx = this.effects;
    if (!fx?.chroma) return;
    if (this.reducedMotion) {
      fx.shock.amplitude = 0;
      fx.lens?.distortion.set(0, 0);
      fx.chroma.offset.set(0, 0);
      if (fx.dof) fx.dof.blendMode.opacity.value = 0;
    } else if (fx.dof) {
      fx.dof.blendMode.opacity.value = 0.7;
    }
  }

  setChaosGrade(chaos01) {
    const fx = this.effects;
    if (!fx.vignette) return;
    fx.vignette.darkness = 0.62 + chaos01 * 0.75;
    fx.vignette.offset = 0.28 - chaos01 * 0.12;
    fx.grade.saturation = 0.14 - chaos01 * 0.24;
    fx.grade.hue = -chaos01 * 0.06;
    const chroma = this.reducedMotion ? 0 : 0.00035 + chaos01 * 0.0022;
    fx.chroma.offset.set(chroma, chroma);
    fx.contrast.contrast = 0.12 + chaos01 * 0.16;
  }

  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer?.dispose();
    this.envTarget?.dispose();
    this.renderer.dispose();
  }
}

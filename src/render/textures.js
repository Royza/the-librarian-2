import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural texture forge.
//
// The whole game ships with zero image assets: every surface is painted into a
// 2D canvas at boot and uploaded as a texture. That keeps the repo tiny and
// lets each run re-tint the library without shipping variants.
//
// Every generator returns { map, roughnessMap?, normalMap? } already configured
// for tiling + correct color space.
// ---------------------------------------------------------------------------

const cache = new Map();

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(cv, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Build a tangent-space normal map by Sobel-differencing a grayscale height canvas. */
export function heightToNormal(heightCanvas, strength = 2.0) {
  const s = heightCanvas.width;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, s, s).data;
  const out = canvas(s);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(s, s);
  const at = (x, y) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * s + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function noiseOverlay(ctx, size, amount, scale = 1) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount * 255 * scale;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// --- Hardwood parquet / plank floor ----------------------------------------
export function woodFloor({ size = 1024, plankW = 128, plankH = 1024, base = '#6b4526', dark = '#3d2413', light = '#8f6136' } = {}) {
  const key = `wood-${base}-${dark}-${plankW}`;
  if (cache.has(key)) return cache.get(key);

  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  const h = canvas(size);
  const hctx = h.getContext('2d');
  const rough = canvas(size);
  const rctx = rough.getContext('2d');

  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, size, size);
  rctx.fillStyle = '#4a4a4a'; rctx.fillRect(0, 0, size, size);

  const cols = Math.ceil(size / plankW);
  const rows = Math.ceil(size / plankH);

  for (let cx = 0; cx < cols; cx++) {
    // Stagger plank seams per column so the tile doesn't read as a grid.
    const offset = (cx % 2) * (plankH * 0.37);
    for (let cy = -1; cy <= rows; cy++) {
      const x = cx * plankW;
      const y = cy * plankH + offset;
      const w = plankW, ph = plankH;

      // Per-plank tone
      const tone = 0.82 + Math.random() * 0.36;
      const g = ctx.createLinearGradient(x, y, x + w, y);
      const mix = (c, t) => {
        const n = parseInt(c.slice(1), 16);
        const r = Math.min(255, ((n >> 16) & 255) * t);
        const gg = Math.min(255, ((n >> 8) & 255) * t);
        const b = Math.min(255, (n & 255) * t);
        return `rgb(${r | 0},${gg | 0},${b | 0})`;
      };
      g.addColorStop(0, mix(dark, tone));
      g.addColorStop(0.15, mix(base, tone));
      g.addColorStop(0.55, mix(light, tone * 0.98));
      g.addColorStop(0.85, mix(base, tone));
      g.addColorStop(1, mix(dark, tone));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, ph);

      // Grain: long wavering strokes along the plank
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, ph); ctx.clip();
      const grains = 42;
      for (let i = 0; i < grains; i++) {
        const gx = x + Math.random() * w;
        const amp = 1 + Math.random() * 3.5;
        const freq = 0.004 + Math.random() * 0.01;
        const phase = Math.random() * Math.PI * 2;
        ctx.strokeStyle = `rgba(30,16,6,${0.03 + Math.random() * 0.12})`;
        ctx.lineWidth = 0.6 + Math.random() * 2.2;
        ctx.beginPath();
        for (let yy = y; yy <= y + ph; yy += 6) {
          const xx = gx + Math.sin(yy * freq + phase) * amp;
          if (yy === y) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();

        hctx.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.1})`;
        hctx.lineWidth = ctx.lineWidth;
        hctx.beginPath();
        for (let yy = y; yy <= y + ph; yy += 6) {
          const xx = gx + Math.sin(yy * freq + phase) * amp;
          if (yy === y) hctx.moveTo(xx, yy); else hctx.lineTo(xx, yy);
        }
        hctx.stroke();
      }

      // Occasional knot
      if (Math.random() < 0.28) {
        const kx = x + w * (0.25 + Math.random() * 0.5);
        const ky = y + ph * Math.random();
        for (let r = 14; r > 0; r -= 1.6) {
          ctx.strokeStyle = `rgba(28,14,4,${0.06 + (14 - r) * 0.016})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(kx, ky, r * 0.55, r, Math.random() * 0.4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();

      // Seam shadow (dark groove between planks) — drives the normal map
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x, y, 2, ph);
      ctx.fillRect(x, y, w, 2);
      hctx.fillStyle = 'rgba(0,0,0,0.9)';
      hctx.fillRect(x, y, 2.5, ph);
      hctx.fillRect(x, y, w, 2.5);

      // Varnish sheen varies per plank -> roughness breakup
      rctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.22})`;
      rctx.fillRect(x, y, w, ph);
    }
  }

  // Scuffs & wear patches
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 20 + Math.random() * 130;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,240,220,${0.02 + Math.random() * 0.05})`);
    g.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    const rg = rctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(255,255,255,${0.15 + Math.random() * 0.3})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    rctx.fillStyle = rg;
    rctx.beginPath(); rctx.arc(x, y, r, 0, Math.PI * 2); rctx.fill();
  }

  noiseOverlay(ctx, size, 0.035);

  const result = {
    map: toTexture(cv, { srgb: true }),
    roughnessMap: toTexture(rough),
    normalMap: toTexture(heightToNormal(h, 1.6)),
  };
  cache.set(key, result);
  return result;
}

// --- Polished marble (rotundas, grand halls) --------------------------------
export function marble({ size = 1024, base = '#e8e2d6', vein = '#8a7f6d', accent = '#b8a98d' } = {}) {
  const key = `marble-${base}-${vein}`;
  if (cache.has(key)) return cache.get(key);

  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);

  // Layered vein networks; each pass is finer and fainter.
  for (let pass = 0; pass < 3; pass++) {
    const count = 8 + pass * 10;
    for (let i = 0; i < count; i++) {
      let x = Math.random() * size;
      let y = Math.random() * size;
      let a = Math.random() * Math.PI * 2;
      ctx.strokeStyle = pass === 0
        ? `rgba(90,80,66,${0.10 + Math.random() * 0.12})`
        : `rgba(120,110,94,${0.05 + Math.random() * 0.08})`;
      ctx.lineWidth = (4 - pass) * (0.5 + Math.random());
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      const steps = 60 + Math.random() * 120;
      for (let s = 0; s < steps; s++) {
        a += (Math.random() - 0.5) * 0.55;
        x += Math.cos(a) * 6;
        y += Math.sin(a) * 6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // Soft cloudy mineral blotches
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 60 + Math.random() * 200;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `${accent}22`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  noiseOverlay(ctx, size, 0.02);

  const rough = canvas(size);
  const rctx = rough.getContext('2d');
  rctx.fillStyle = '#22';
  rctx.fillStyle = 'rgb(30,30,30)';
  rctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 40 + Math.random() * 180;
    const g = rctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.06 + Math.random() * 0.18})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    rctx.fillStyle = g;
    rctx.beginPath(); rctx.arc(x, y, r, 0, Math.PI * 2); rctx.fill();
  }

  const result = { map: toTexture(cv, { srgb: true }), roughnessMap: toTexture(rough) };
  cache.set(key, result);
  return result;
}

// --- Persian-style rug -------------------------------------------------------
export function rug({ size = 512, field = '#7a1f22', border = '#1d3355', motif = '#d9b45b', cream = '#e6d7b8' } = {}) {
  const key = `rug-${field}-${border}`;
  if (cache.has(key)) return cache.get(key);

  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = field; ctx.fillRect(0, 0, size, size);

  const inset = size * 0.06;
  ctx.strokeStyle = border; ctx.lineWidth = size * 0.075;
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.strokeStyle = motif; ctx.lineWidth = size * 0.012;
  ctx.strokeRect(inset * 1.9, inset * 1.9, size - inset * 3.8, size - inset * 3.8);
  ctx.strokeRect(inset * 0.55, inset * 0.55, size - inset * 1.1, size - inset * 1.1);

  // Repeating diamond medallions in the border band
  const drawDiamond = (x, y, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.62, y);
    ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.62, y);
    ctx.closePath(); ctx.fill();
  };
  const bandR = size * 0.028;
  const step = size * 0.1;
  for (let t = inset * 1.4; t < size - inset * 1.4; t += step) {
    drawDiamond(t, inset * 1.4, bandR, motif);
    drawDiamond(t, size - inset * 1.4, bandR, motif);
    drawDiamond(inset * 1.4, t, bandR, motif);
    drawDiamond(size - inset * 1.4, t, bandR, motif);
  }

  // Central medallion
  const cx = size / 2, cy = size / 2;
  drawDiamond(cx, cy, size * 0.26, border);
  drawDiamond(cx, cy, size * 0.2, motif);
  drawDiamond(cx, cy, size * 0.13, cream);
  drawDiamond(cx, cy, size * 0.07, field);

  // Scattered floral knots
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = Math.random() < 0.5 ? `${motif}66` : `${cream}44`;
    ctx.beginPath(); ctx.arc(x, y, 1 + Math.random() * 2.4, 0, Math.PI * 2); ctx.fill();
  }

  noiseOverlay(ctx, size, 0.06);
  const result = { map: toTexture(cv, { srgb: true, repeat: 1 }) };
  cache.set(key, result);
  return result;
}

// --- Bookshelf hardwood ------------------------------------------------------
export function shelfWood({ size = 512, base = '#4a2d18', light = '#6b4526', dark = '#2a180c' } = {}) {
  const key = `shelfwood-${base}`;
  if (cache.has(key)) return cache.get(key);

  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  const h = canvas(size);
  const hctx = h.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, size, size);

  // Cathedral grain arches — the signature of quarter-sawn oak.
  for (let i = 0; i < 26; i++) {
    const cx = Math.random() * size;
    const width = 20 + Math.random() * 90;
    const alpha = 0.05 + Math.random() * 0.14;
    ctx.strokeStyle = `rgba(20,10,3,${alpha})`;
    hctx.strokeStyle = `rgba(0,0,0,${alpha * 0.6})`;
    for (let k = 0; k < 6; k++) {
      const w = width * (1 - k * 0.13);
      ctx.lineWidth = hctx.lineWidth = 0.8 + Math.random() * 1.6;
      ctx.beginPath(); hctx.beginPath();
      for (let y = 0; y <= size; y += 5) {
        const t = y / size;
        const x = cx + Math.sin(t * Math.PI * 1.4 + k * 0.3) * w * 0.5 + Math.sin(y * 0.05) * 3;
        if (y === 0) { ctx.moveTo(x, y); hctx.moveTo(x, y); }
        else { ctx.lineTo(x, y); hctx.lineTo(x, y); }
      }
      ctx.stroke(); hctx.stroke();
    }
  }
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * size;
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '110,70,40' : '20,10,3'},${0.02 + Math.random() * 0.07})`;
    ctx.lineWidth = 0.5 + Math.random();
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (Math.random() - 0.5) * 12, size); ctx.stroke();
  }
  noiseOverlay(ctx, size, 0.03);

  const result = {
    map: toTexture(cv, { srgb: true }),
    normalMap: toTexture(heightToNormal(h, 1.0)),
  };
  cache.set(key, result);
  return result;
}

// --- Book spine detail (grayscale; tinted per-instance) -----------------------
// One texture, tiled across a strip of spines. Bands, foil rules and title
// blocks read as typography at a distance without any real glyphs.
export function bookSpines({ size = 512, tiles = 8 } = {}) {
  const key = `spines-${tiles}`;
  if (cache.has(key)) return cache.get(key);

  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  const h = canvas(size);
  const hctx = h.getContext('2d');
  const rough = canvas(size);
  const rctx = rough.getContext('2d');

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#7a7a7a'; hctx.fillRect(0, 0, size, size);
  rctx.fillStyle = 'rgb(150,150,150)'; rctx.fillRect(0, 0, size, size);

  const tw = size / tiles;
  for (let i = 0; i < tiles; i++) {
    const x = i * tw;
    const w = tw;

    // Base shade per spine so a wall of one color still varies.
    const shade = 0.72 + Math.random() * 0.4;
    ctx.fillStyle = `rgba(255,255,255,1)`;
    ctx.fillRect(x, 0, w, size);
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 1 - shade) * 0.6})`;
    ctx.fillRect(x, 0, w, size);

    // Cylindrical shading across the spine face
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.8, 'rgba(0,0,0,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, w, size);

    const hg = hctx.createLinearGradient(x, 0, x + w, 0);
    hg.addColorStop(0, 'rgb(30,30,30)');
    hg.addColorStop(0.5, 'rgb(190,190,190)');
    hg.addColorStop(1, 'rgb(30,30,30)');
    hctx.fillStyle = hg; hctx.fillRect(x, 0, w, size);

    // Head/tail caps
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x, 0, w, size * 0.018);
    ctx.fillRect(x, size * 0.982, w, size * 0.018);

    // Foil rules + title panel
    const foil = () => { ctx.fillStyle = 'rgba(255,240,190,0.9)'; };
    const bandY = size * (0.16 + Math.random() * 0.1);
    foil(); ctx.fillRect(x + w * 0.14, bandY, w * 0.72, Math.max(1, size * 0.006));
    foil(); ctx.fillRect(x + w * 0.14, bandY + size * 0.02, w * 0.72, Math.max(1, size * 0.004));

    const panelY = size * (0.3 + Math.random() * 0.14);
    const panelH = size * (0.14 + Math.random() * 0.12);
    if (Math.random() < 0.72) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x + w * 0.16, panelY, w * 0.68, panelH);
      ctx.strokeStyle = 'rgba(255,238,180,0.75)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + w * 0.16, panelY, w * 0.68, panelH);
      // "Text" — vertical tick rows read as a title turned on its side
      const rows = 2 + Math.floor(Math.random() * 3);
      for (let r = 0; r < rows; r++) {
        const ty = panelY + panelH * ((r + 0.7) / (rows + 0.5));
        ctx.fillStyle = 'rgba(255,240,200,0.8)';
        const tw2 = w * (0.28 + Math.random() * 0.34);
        ctx.fillRect(x + w * 0.5 - tw2 / 2, ty, tw2, Math.max(1, size * 0.0055));
      }
    }

    const lowY = size * (0.74 + Math.random() * 0.1);
    foil(); ctx.fillRect(x + w * 0.14, lowY, w * 0.72, Math.max(1, size * 0.005));
    if (Math.random() < 0.5) {
      ctx.fillStyle = 'rgba(255,240,200,0.6)';
      ctx.fillRect(x + w * 0.36, lowY + size * 0.03, w * 0.28, Math.max(1, size * 0.02));
    }

    // Cloth weave for matte volumes, gloss for the dust-jacketed ones
    const glossy = Math.random() < 0.35;
    rctx.fillStyle = glossy ? 'rgb(60,60,60)' : 'rgb(185,185,185)';
    rctx.fillRect(x, 0, w, size);
    if (!glossy) {
      for (let k = 0; k < 160; k++) {
        rctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`;
        rctx.fillRect(x + Math.random() * w, Math.random() * size, 1.5, 1.5);
      }
    }

    // Shelf wear along the top edge
    ctx.fillStyle = `rgba(210,190,150,${0.05 + Math.random() * 0.12})`;
    ctx.fillRect(x, 0, w, size * 0.05);
  }

  noiseOverlay(ctx, size, 0.05);

  // Top 15% of the canvas becomes a page-edge band. Item-row geometry maps its
  // top and end faces into that strip, so a shelf reads as spines from the
  // front and cut paper from above — all from one texture, one draw call.
  const bandH = size * 0.15;
  const pg = ctx.createLinearGradient(0, 0, 0, bandH);
  pg.addColorStop(0, '#d8ccb2');
  pg.addColorStop(0.5, '#efe6d2');
  pg.addColorStop(1, '#c9bda2');
  ctx.fillStyle = pg;
  ctx.fillRect(0, 0, size, bandH);
  for (let x = 0; x < size; x += 2) {
    ctx.fillStyle = `rgba(120,105,80,${0.05 + Math.random() * 0.2})`;
    ctx.fillRect(x, 0, 1, bandH);
  }
  for (let i = 0; i < tiles; i++) {
    ctx.fillStyle = 'rgba(60,45,25,0.35)';
    ctx.fillRect(i * tw, 0, 1.5, bandH);
  }
  rctx.fillStyle = 'rgb(225,225,225)';
  rctx.fillRect(0, 0, size, bandH);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, bandH);

  const result = {
    map: toTexture(cv, { srgb: true, repeat: 1 }),
    roughnessMap: toTexture(rough),
    normalMap: toTexture(heightToNormal(h, 2.4)),
  };
  cache.set(key, result);
  return result;
}

// --- Flannel / buffalo plaid --------------------------------------------------
// Woven the way real tartan is: translucent bands laid down in both directions,
// so the overlaps darken on their own and the crossings come out right.
export function plaid({ size = 256, base = '#9e2b28', band = '#1c1013', accent = '#e8d9b8' } = {}) {
  const key = `plaid-${base}-${band}`;
  if (cache.has(key)) return cache.get(key);

  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const unit = size / 4;
  // [offset within the repeat, width, opacity]
  const bands = [
    [0.0, 0.42, 0.62],
    [0.5, 0.2, 0.34],
    [0.72, 0.08, 0.2],
  ];

  for (const axis of ['x', 'y']) {
    for (let rep = 0; rep < 4; rep++) {
      for (const [off, w, alpha] of bands) {
        const p = (rep + off) * unit;
        const width = w * unit;
        ctx.fillStyle = hexToRgba(band, alpha);
        if (axis === 'x') ctx.fillRect(p, 0, width, size);
        else ctx.fillRect(0, p, size, width);
      }
    }
  }

  // Fine cream over-check, the detail that makes it read as flannel not stripes.
  ctx.lineWidth = Math.max(1, size / 200);
  for (let rep = 0; rep < 4; rep++) {
    const p = (rep + 0.62) * unit;
    ctx.strokeStyle = hexToRgba(accent, 0.5);
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }

  // Brushed-cotton fuzz.
  for (let i = 0; i < size * 12; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  noiseOverlay(ctx, size, 0.05);

  const result = { map: toTexture(cv, { srgb: true, repeat: 1 }) };
  cache.set(key, result);
  return result;
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// --- Paper page block (top/fore edges of a book) ------------------------------
export function pageEdge({ size = 256 } = {}) {
  if (cache.has('pages')) return cache.get('pages');
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#efe6d2'; ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = `rgba(120,105,80,${0.06 + Math.random() * 0.16})`;
    ctx.fillRect(0, y, size, 1);
  }
  // Age foxing
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 3 + Math.random() * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(170,140,90,0.20)');
    g.addColorStop(1, 'rgba(170,140,90,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const result = { map: toTexture(cv, { srgb: true }) };
  cache.set('pages', result);
  return result;
}

// --- Plaster / painted wall --------------------------------------------------
export function plaster({ size = 512, base = '#cbbfa8' } = {}) {
  const key = `plaster-${base}`;
  if (cache.has(key)) return cache.get(key);
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  const h = canvas(size);
  const hctx = h.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 4 + Math.random() * 34;
    const a = 0.02 + Math.random() * 0.05;
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(60,45,25,${a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    hctx.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a * 2})` : `rgba(0,0,0,${a * 2})`;
    hctx.beginPath(); hctx.arc(x, y, r, 0, Math.PI * 2); hctx.fill();
  }
  noiseOverlay(ctx, size, 0.03);
  const result = {
    map: toTexture(cv, { srgb: true }),
    normalMap: toTexture(heightToNormal(h, 0.6)),
  };
  cache.set(key, result);
  return result;
}

// --- Radial soft blob (contact shadows, glow decals, puddles) -----------------
export function radialAlpha({ size = 128, power = 2, inner = 1 } = {}) {
  const key = `radial-${power}-${inner}`;
  if (cache.has(key)) return cache.get(key);
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(1, Math.hypot(x - c, y - c) / c);
      const a = Math.pow(1 - d, power) * inner;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.max(0, Math.min(255, a * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

// --- Dust mote / spark sprite ------------------------------------------------
export function moteSprite({ size = 64 } = {}) {
  if (cache.has('mote')) return cache.get('mote');
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,246,225,0.65)');
  g.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set('mote', t);
  return t;
}

// --- Generic grunge/leak overlay for walls & floors --------------------------
export function grime({ size = 512 } = {}) {
  if (cache.has('grime')) return cache.get('grime');
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 20 + Math.random() * 150;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(20,14,6,${0.03 + Math.random() * 0.08})`);
    g.addColorStop(1, 'rgba(20,14,6,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = toTexture(cv, { srgb: true });
  cache.set('grime', t);
  return t;
}

export function disposeTextureCache() {
  for (const v of cache.values()) {
    if (v?.isTexture) v.dispose();
    else if (v) for (const k of Object.keys(v)) v[k]?.dispose?.();
  }
  cache.clear();
}

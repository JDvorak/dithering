const DESC_DIM = 7;

function buildTileSystem(options = {}) {
  const rot4 = clampInt(options.tileRotationSteps4 | 0 || 12, 4, 32);
  const rot8 = clampInt(options.tileRotationSteps8 | 0 || 16, 4, 32);
  const lienRepairPasses = clampInt(options.tileLienRepairPasses | 0 || 1, 0, 3);
  const coarse = buildScaleTiles(8, rot8, lienRepairPasses);
  const fine = buildScaleTiles(4, rot4, lienRepairPasses);
  const fineByFamily = buildFamilyIndex(fine.family, fine.count);
  const coarseFamilyNames = coarse.familyNames;
  const fineFamilyNames = fine.familyNames;
  const familyTransfer = buildFamilyTransfer(coarseFamilyNames, fineFamilyNames);
  return {
    coarse,
    fine,
    fineByFamily,
    familyTransfer
  };
}

function buildScaleTiles(size, rotationSteps, lienRepairPasses) {
  const bases = buildBasePatterns(size);
  const tiles = [];
  const familyNames = [];
  const familyMap = new Map();
  const dedupe = new Set();

  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    let familyId = familyMap.get(base.family);
    if (familyId === undefined) {
      familyId = familyNames.length;
      familyMap.set(base.family, familyId);
      familyNames.push(base.family);
    }
    for (let r = 0; r < rotationSteps; r++) {
      const angle = (r / rotationSteps) * Math.PI * 2;
      const value = rotateTilePeriodic(base.value, size, angle);
      if (lienRepairPasses > 0) {
        repairTileLienSort(value, size, angle, lienRepairPasses);
      }
      const signature = tileSignature(value);
      const dedupeKey = `${familyId}:${signature}`;
      if (dedupe.has(dedupeKey)) continue;
      dedupe.add(dedupeKey);
      const key = blurTile(value, size);
      const descriptor = computeDescriptor(key, size);
      const orientation = computeTileOrientation(key, size);
      const masks = buildEdgeMasks(value, size);
      tiles.push({
        value,
        key,
        descriptor,
        familyId,
        rot: r,
        angle,
        masks,
        ink: 1 - descriptor[0],
        orientation,
        name: `${base.family}/${base.name}/a${Math.round((angle * 180) / Math.PI)}`
      });
    }
  }

  const count = tiles.length;
  const area = size * size;
  const values = new Uint8Array(count * area);
  const keys = new Float32Array(count * area);
  const desc = new Float32Array(count * DESC_DIM);
  const family = new Int16Array(count);
  const ink = new Float32Array(count);
  const topMask = new Uint16Array(count);
  const rightMask = new Uint16Array(count);
  const bottomMask = new Uint16Array(count);
  const leftMask = new Uint16Array(count);
  const dirX = new Float32Array(count);
  const dirY = new Float32Array(count);
  const directionality = new Float32Array(count);
  const adirectionality = new Float32Array(count);
  const names = new Array(count);

  for (let i = 0; i < count; i++) {
    const tile = tiles[i];
    values.set(tile.value, i * area);
    keys.set(tile.key, i * area);
    desc.set(tile.descriptor, i * DESC_DIM);
    family[i] = tile.familyId;
    ink[i] = tile.ink;
    topMask[i] = tile.masks.top;
    rightMask[i] = tile.masks.right;
    bottomMask[i] = tile.masks.bottom;
    leftMask[i] = tile.masks.left;
    dirX[i] = tile.orientation.dirX;
    dirY[i] = tile.orientation.dirY;
    directionality[i] = tile.orientation.directionality;
    adirectionality[i] = tile.orientation.adirectionality;
    names[i] = tile.name;
  }

  return {
    size,
    area,
    count,
    values,
    keys,
    desc,
    family,
    familyNames,
    ink,
    topMask,
    rightMask,
    bottomMask,
    leftMask,
    meta: {
      name: names,
      directionX: dirX,
      directionY: dirY,
      directionality,
      adirectionality
    }
  };
}

function buildBasePatterns(size) {
  const out = [];
  const periods = size === 8 ? [2, 3, 4, 6, 8] : [2, 4];

  register(out, 'flat', 'white', size, () => 1);
  register(out, 'flat', 'black', size, () => 0);

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    register(out, 'stripes', `h-p${p}`, size, (x, y) => ((y % p) < ((p + 1) >> 1) ? 1 : 0));
    register(out, 'stripes', `v-p${p}`, size, (x, y) => ((x % p) < ((p + 1) >> 1) ? 1 : 0));
    register(out, 'stripes', `d1-p${p}`, size, (x, y) => (((x + y) % p) < ((p + 1) >> 1) ? 1 : 0));
    register(out, 'stripes', `d2-p${p}`, size, (x, y) => (((x - y + size * 8) % p) < ((p + 1) >> 1) ? 1 : 0));
    register(out, 'checker', `checker-p${p}`, size, (x, y) => ((((x / p) | 0) + ((y / p) | 0)) & 1 ? 0 : 1));
    register(out, 'dots', `dots-p${p}`, size, (x, y) => ((x % p === 0 && y % p === 0) ? 0 : 1));
    register(out, 'brick', `brick-p${p}`, size, (x, y) => {
      const row = (y / p) | 0;
      const shift = (row & 1) * ((p + 1) >> 1);
      return (((x + shift) % p) === 0 ? 0 : 1);
    });
    register(out, 'cross', `cross-p${p}`, size, (x, y) => ((x % p === 0 || y % p === 0) ? 0 : 1));
  }

  register(out, 'herring', 'herring-a', size, (x, y) => (((x + ((y & 1) << 1)) % 4) < 2 ? 1 : 0));
  register(out, 'weave', 'weave-a', size, (x, y) => ((((x & 3) < 2) === ((y & 3) < 2)) ? 1 : 0));
  register(out, 'steps', 'steps-a', size, (x, y) => (((x + (y >> 1)) & 1) ? 0 : 1));
  register(out, 'zigzag', 'zigzag-a', size, (x, y) => (((x & 1) === ((y >> 1) & 1) ? 1 : 0)));

  if (size === 8) {
    register(out, 'rings', 'rings-1', size, (x, y, s) => {
      const cx = (s - 1) * 0.5;
      const cy = (s - 1) * 0.5;
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      return ((Math.floor(r) & 1) ? 0 : 1);
    });
    register(out, 'spokes', 'spokes-8', size, (x, y, s) => {
      const cx = (s - 1) * 0.5;
      const cy = (s - 1) * 0.5;
      const a = Math.atan2(y - cy, x - cx);
      const bucket = ((a + Math.PI) / (Math.PI / 4)) | 0;
      return (bucket & 1) ? 1 : 0;
    });
    register(out, 'wave', 'wave-x', size, (x, y, s) => {
      const yy = y + Math.sin((x / s) * Math.PI * 2) * 1.5;
      return (((yy | 0) & 1) ? 0 : 1);
    });
  }

  return dedupePatterns(out, size);
}

function register(out, family, name, size, fn) {
  const value = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      value[y * size + x] = fn(x, y, size) ? 1 : 0;
    }
  }
  out.push({ family, name, value });
}

function dedupePatterns(patterns, size) {
  const seen = new Set();
  const out = [];
  const area = size * size;
  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    let key = '';
    for (let j = 0; j < area; j++) key += p.value[j] ? '1' : '0';
    const full = `${p.family}:${key}`;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push(p);
  }
  return out;
}

function rotateTile(tile, size, rot) {
  if ((rot & 3) === 0) return Uint8Array.from(tile);
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = y * size + x;
      let dx = x;
      let dy = y;
      if ((rot & 3) === 1) {
        dx = size - 1 - y;
        dy = x;
      } else if ((rot & 3) === 2) {
        dx = size - 1 - x;
        dy = size - 1 - y;
      } else {
        dx = y;
        dy = size - 1 - x;
      }
      out[dy * size + dx] = tile[src];
    }
  }
  return out;
}

function rotateTilePeriodic(tile, size, angle) {
  const out = new Uint8Array(size * size);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cx = (size - 1) * 0.5;
  const cy = (size - 1) * 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = c * dx + s * dy + cx;
      const sy = -s * dx + c * dy + cy;
      const sample = sampleTileWrapBilinear(tile, size, sx, sy);
      out[y * size + x] = sample >= 0.5 ? 1 : 0;
    }
  }
  return out;
}

function sampleTileWrapBilinear(tile, size, x, y) {
  const x0 = wrap(Math.floor(x), size);
  const y0 = wrap(Math.floor(y), size);
  const x1 = wrap(x0 + 1, size);
  const y1 = wrap(y0 + 1, size);
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const a = tile[y0 * size + x0];
  const b = tile[y0 * size + x1];
  const c = tile[y1 * size + x0];
  const d = tile[y1 * size + x1];
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

function repairTileLienSort(tile, size, angle, passes) {
  const dir = computeTileOrientation(tile, size);
  if (dir.directionality < 0.3) return;
  const lineX = -dir.dirY;
  const lineY = dir.dirX;
  const alongX = quantizedStep(lineX);
  const alongY = quantizedStep(lineY);
  const crossX = quantizedStep(dir.dirX);
  const crossY = quantizedStep(dir.dirY);
  const scratch = new Uint8Array(tile.length);

  for (let pass = 0; pass < passes; pass++) {
    scratch.set(tile);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        const v = tile[idx];
        const a0 = getWrap(tile, size, x - alongX, y - alongY);
        const a1 = getWrap(tile, size, x + alongX, y + alongY);
        const c0 = getWrap(tile, size, x - crossX, y - crossY);
        const c1 = getWrap(tile, size, x + crossX, y + crossY);

        if (v === 1 && a0 === 0 && a1 === 0 && (c0 + c1) >= 1) {
          scratch[idx] = 0;
        } else if (v === 0 && a0 === 1 && a1 === 1 && (c0 + c1) <= 1) {
          scratch[idx] = 1;
        }
      }
    }
    tile.set(scratch);
  }
  void angle;
}

function blurTile(tile, size) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let n = 0;
      for (let ky = -1; ky <= 1; ky++) {
        const sy = wrap(y + ky, size);
        for (let kx = -1; kx <= 1; kx++) {
          const sx = wrap(x + kx, size);
          sum += tile[sy * size + sx];
          n += 1;
        }
      }
      out[y * size + x] = sum / n;
    }
  }
  return out;
}

function computeDescriptor(tile, size) {
  const area = size * size;
  let mean = 0;
  for (let i = 0; i < area; i++) mean += tile[i];
  mean /= area;

  let variance = 0;
  let gx = 0;
  let gy = 0;
  let edge = 0;
  let span = 0;

  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const v = tile[idx];
      const dx = tile[y * size + wrap(x + 1, size)] - tile[y * size + wrap(x - 1, size)];
      const dy = tile[wrap(y + 1, size) * size + x] - tile[wrap(y - 1, size) * size + x];
      variance += (v - mean) * (v - mean);
      gx += dx;
      gy += dy;
      edge += Math.abs(dx) + Math.abs(dy);
      if (x > 0) {
        if (tile[y * size + x] === tile[y * size + x - 1]) run += 1;
        else {
          span += run;
          run = 1;
        }
      }
    }
    span += run;
  }
  variance /= area;
  gx /= area;
  gy /= area;
  edge /= area;
  span = span / (size * size);

  const dir = Math.atan2(gy, gx) / Math.PI;
  const anis = Math.abs(gx) + Math.abs(gy);
  return new Float32Array([mean, variance, edge, dir, anis, span, mean * (1 - mean)]);
}

function computeTileOrientation(tile, size) {
  let jxx = 0;
  let jxy = 0;
  let jyy = 0;
  const area = size * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = tile[y * size + wrap(x + 1, size)] - tile[y * size + wrap(x - 1, size)];
      const dy = tile[wrap(y + 1, size) * size + x] - tile[wrap(y - 1, size) * size + x];
      jxx += dx * dx;
      jxy += dx * dy;
      jyy += dy * dy;
    }
  }
  jxx /= area;
  jxy /= area;
  jyy /= area;

  const trace = jxx + jyy;
  const detTerm = Math.max(0, trace * trace - 4 * (jxx * jyy - jxy * jxy));
  const root = Math.sqrt(detTerm);
  const l1 = 0.5 * (trace + root);
  const l2 = 0.5 * (trace - root);
  const directionality = trace > 1e-8 ? (l1 - l2) / (trace + 1e-8) : 0;
  const adirectionality = 1 - directionality;

  let vx = 1;
  let vy = 0;
  if (Math.abs(jxy) > 1e-6 || Math.abs(l1 - jxx) > 1e-6) {
    vx = jxy;
    vy = l1 - jxx;
  }
  const norm = Math.hypot(vx, vy) || 1;

  return {
    dirX: vx / norm,
    dirY: vy / norm,
    directionality,
    adirectionality
  };
}

function tileSignature(tile) {
  let out = '';
  for (let i = 0; i < tile.length; i++) out += tile[i] ? '1' : '0';
  return out;
}

function getWrap(tile, size, x, y) {
  return tile[wrap(y, size) * size + wrap(x, size)];
}

function quantizedStep(v) {
  if (v > 0.33) return 1;
  if (v < -0.33) return -1;
  return 0;
}

function clampInt(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function buildEdgeMasks(tile, size) {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  for (let i = 0; i < size; i++) {
    if (tile[i]) top |= (1 << i);
    if (tile[(size - 1) * size + i]) bottom |= (1 << i);
    if (tile[i * size + (size - 1)]) right |= (1 << i);
    if (tile[i * size]) left |= (1 << i);
  }
  return { top, right, bottom, left };
}

function buildFamilyIndex(family, tileCount) {
  const byFamily = new Map();
  for (let i = 0; i < tileCount; i++) {
    const id = family[i];
    let list = byFamily.get(id);
    if (!list) {
      list = [];
      byFamily.set(id, list);
    }
    list.push(i);
  }
  return byFamily;
}

function buildFamilyTransfer(coarseFamilyNames, fineFamilyNames) {
  const transfer = new Int16Array(coarseFamilyNames.length);
  for (let i = 0; i < coarseFamilyNames.length; i++) {
    const name = coarseFamilyNames[i];
    let match = 0;
    for (let j = 0; j < fineFamilyNames.length; j++) {
      if (fineFamilyNames[j] === name) {
        match = j;
        break;
      }
    }
    transfer[i] = match;
  }
  return transfer;
}

function wrap(value, size) {
  let out = value % size;
  if (out < 0) out += size;
  return out;
}

module.exports = {
  DESC_DIM,
  buildTileSystem,
  __private: {
    computeTileOrientation,
    buildScaleTiles
  }
};

const fs = require('fs');
const path = require('path');
const { createRng, clamp01 } = require('./math');

// Cache for progressive masks since they're deterministic
const maskCache = new Map();

function loadPrecomputedMask(size, seed, candidates) {
  const filename = path.join(__dirname, `mask-${seed}-${candidates}.bin`);
  try {
    const buffer = fs.readFileSync(filename);
    return new Float32Array(buffer.buffer, buffer.byteOffset, size * size);
  } catch (e) {
    return null;
  }
}

function createProgressiveMask(size, seed, candidates) {
  const cacheKey = `${size}-${seed}-${candidates}`;
  if (maskCache.has(cacheKey)) {
    return maskCache.get(cacheKey);
  }
  
  // Try to load precomputed mask from disk
  const precomputed = loadPrecomputedMask(size, seed, candidates);
  if (precomputed) {
    maskCache.set(cacheKey, precomputed);
    return precomputed;
  }
  
  const count = size * size;
  const rng = createRng(seed);
  const available = new Uint32Array(count);
  const xs = new Int16Array(count);
  const ys = new Int16Array(count);
  const values = new Float32Array(count);
  let availableCount = count;
  let pointCount = 0;

  for (let i = 0; i < count; i++) available[i] = i;

  for (let rank = 0; rank < count; rank++) {
    let bestAvailableIndex = 0;
    let bestIndex = available[0];
    let bestScore = -1;
    const trialCount = Math.min(candidates, availableCount);

    for (let trial = 0; trial < trialCount; trial++) {
      const availableIndex = Math.floor(rng() * availableCount);
      const index = available[availableIndex];
      const x = index % size;
      const y = (index / size) | 0;
      let nearest = Infinity;
      for (let i = 0; i < pointCount; i++) {
        const dxRaw = Math.abs(x - xs[i]);
        const dyRaw = Math.abs(y - ys[i]);
        const dx = Math.min(dxRaw, size - dxRaw);
        const dy = Math.min(dyRaw, size - dyRaw);
        const distance = dx * dx + dy * dy;
        if (distance < nearest) nearest = distance;
      }
      const score = pointCount === 0 ? rng() : nearest + rng() * 1e-3;
      if (score > bestScore) {
        bestScore = score;
        bestAvailableIndex = availableIndex;
        bestIndex = index;
      }
    }

    values[bestIndex] = rank / (count - 1);
    xs[pointCount] = bestIndex % size;
    ys[pointCount] = (bestIndex / size) | 0;
    pointCount += 1;
    available[bestAvailableIndex] = available[availableCount - 1];
    availableCount -= 1;
  }

  maskCache.set(cacheKey, values);
  return values;
}

function sampleMask(mask, size, x, y) {
  const wrappedX = mod(x, size);
  const wrappedY = mod(y, size);
  const x0 = Math.floor(wrappedX);
  const y0 = Math.floor(wrappedY);
  const x1 = (x0 + 1) % size;
  const y1 = (y0 + 1) % size;
  const fx = wrappedX - x0;
  const fy = wrappedY - y0;
  const a = mask[y0 * size + x0];
  const b = mask[y0 * size + x1];
  const c = mask[y1 * size + x0];
  const d = mask[y1 * size + x1];
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

function sampleParkerThreshold(u, v, parkerMask, parkerMaskAlt, parkerSize, parkerPeriod) {
  const sx = u / parkerPeriod;
  const sy = v / parkerPeriod;
  const primary = sampleMask(parkerMask, parkerSize, sx, sy);
  const secondary = sampleMask(parkerMaskAlt, parkerSize, sx * 1.61803398875 + 19.73, sy * 1.32471795724 - 11.41);
  return clamp01(primary * 0.72 + secondary * 0.28);
}

function mod(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

module.exports = {
  createProgressiveMask,
  sampleParkerThreshold
};

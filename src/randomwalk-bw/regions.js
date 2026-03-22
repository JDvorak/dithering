const { clampInt, clamp01, createRng, smoothstep } = require('./math');

function computeRandomWalkField(luma, grad, coarseLab, width, height, config) {
  const n = width * height;
  const stride = Math.max(4, config.seedStride | 0);
  const steps = Math.max(6, config.steps | 0);
  const particles = Math.max(6, config.particles | 0);
  const sigma2 = config.labSigma * config.labSigma;
  const gradPenalty = config.gradPenalty;
  const seeds = [];
  const seedX = [];
  const seedY = [];
  const offsetX = Math.floor(stride / 2);
  const offsetY = Math.floor(stride / 2);
  for (let y = offsetY; y < height; y += stride) seedY.push(y);
  for (let x = offsetX; x < width; x += stride) seedX.push(x);
  if (seedX.length === 0) seedX.push(0);
  if (seedY.length === 0) seedY.push(0);
  const seedGridWidth = seedX.length;

  for (let gy = 0; gy < seedY.length; gy++) {
    const y = seedY[gy];
    for (let gx = 0; gx < seedX.length; gx++) {
      const x = seedX[gx];
      seeds.push(y * width + x);
    }
  }

  const bestScore = new Float32Array(n);
  const labels = new Int32Array(n);
  bestScore.fill(-1);
  labels.fill(-1);

  const rng = createRng(99173);
  const visitMark = new Int32Array(n);
  const visitCount = new Uint16Array(n);
  const touched = new Int32Array(particles * (steps + 1) + 1);
  let stamp = 1;

  for (let s = 0; s < seeds.length; s++) {
    const seed = seeds[s];
    let touchedCount = 0;
    const currentStamp = stamp++;
    visitMark[seed] = currentStamp;
    visitCount[seed] = 1;
    touched[touchedCount++] = seed;

    for (let p = 0; p < particles; p++) {
      let current = seed;
      for (let step = 0; step < steps; step++) {
        const x = current % width;
        const y = (current / width) | 0;
        let n0 = -1;
        let n1 = -1;
        let n2 = -1;
        let n3 = -1;
        let w0 = 0;
        let w1 = 0;
        let w2 = 0;
        let w3 = 0;
        let weightSum = 0;

        if (x > 0) {
          n0 = current - 1;
          w0 = transitionWeight(current, n0, luma, grad, coarseLab, sigma2, gradPenalty);
          weightSum += w0;
        }
        if (x + 1 < width) {
          n1 = current + 1;
          w1 = transitionWeight(current, n1, luma, grad, coarseLab, sigma2, gradPenalty);
          weightSum += w1;
        }
        if (y > 0) {
          n2 = current - width;
          w2 = transitionWeight(current, n2, luma, grad, coarseLab, sigma2, gradPenalty);
          weightSum += w2;
        }
        if (y + 1 < height) {
          n3 = current + width;
          w3 = transitionWeight(current, n3, luma, grad, coarseLab, sigma2, gradPenalty);
          weightSum += w3;
        }

        if (weightSum <= 1e-8) break;

        let pick = rng() * weightSum;
        let next = n0 >= 0 ? n0 : (n1 >= 0 ? n1 : (n2 >= 0 ? n2 : n3));
        if (n0 >= 0) {
          pick -= w0;
          if (pick <= 0) next = n0;
        }
        if (pick > 0 && n1 >= 0) {
          pick -= w1;
          if (pick <= 0) next = n1;
        }
        if (pick > 0 && n2 >= 0) {
          pick -= w2;
          if (pick <= 0) next = n2;
        }
        if (pick > 0 && n3 >= 0) {
          next = n3;
        }

        current = next;
        if (visitMark[current] !== currentStamp) {
          visitMark[current] = currentStamp;
          visitCount[current] = 1;
          touched[touchedCount++] = current;
        } else if (visitCount[current] < 65535) {
          visitCount[current] += 1;
        }
      }
    }

    const norm = particles * (steps + 1);
    for (let t = 0; t < touchedCount; t++) {
      const idx = touched[t];
      const score = visitCount[idx] / norm;
      if (score > bestScore[idx]) {
        bestScore[idx] = score;
        labels[idx] = s;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) continue;
    const x = i % width;
    const y = (i / width) | 0;
    labels[i] = nearestSeedIndex(x, y, seedX, seedY, seedGridWidth, stride, offsetX, offsetY);
  }

  smoothLabels(labels, width, height);
  const segmentCount = remapLabels(labels);
  const segmentSizes = countSegmentSizes(labels, segmentCount);
  return { labels, segmentCount, strength: bestScore, segmentSizes };
}

function computeRandomWalkRegions(luma, grad, coarseLab, width, height, options) {
  return computeRandomWalkField(luma, grad, coarseLab, width, height, {
    steps: options.randomWalkSteps,
    particles: options.randomWalkParticles,
    seedStride: options.randomWalkSeedStride,
    labSigma: options.randomWalkLabSigma,
    gradPenalty: options.randomWalkGradPenalty
  });
}

function computeEntropyFromLabels(luma, labels, segmentCount) {
  const bins = 16;
  const maxEntropy = Math.log2(bins);
  const counts = new Uint32Array(segmentCount);
  const histograms = new Uint32Array(segmentCount * bins);
  const entropy = new Float32Array(labels.length);
  const entropyBySegment = new Float32Array(segmentCount);

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] < 0 ? 0 : labels[i];
    const bin = clampInt((luma[i] * bins) | 0, 0, bins - 1);
    counts[label] += 1;
    histograms[label * bins + bin] += 1;
  }

  for (let segment = 0; segment < segmentCount; segment++) {
    const total = counts[segment];
    if (total === 0) continue;
    let h = 0;
    const offset = segment * bins;
    for (let bin = 0; bin < bins; bin++) {
      const count = histograms[offset + bin];
      if (count === 0) continue;
      const p = count / total;
      h -= p * Math.log2(p);
    }
    entropyBySegment[segment] = h / maxEntropy;
  }

  for (let i = 0; i < labels.length; i++) {
    entropy[i] = entropyBySegment[labels[i] < 0 ? 0 : labels[i]];
  }

  return entropy;
}

function smoothLabels(labels, width, height) {
  const n = width * height;
  const nextLabels = new Int32Array(n);
  nextLabels.set(labels);
  
  for (let y = 1; y < height - 1; y++) {
    const rowBase = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowBase + x;
      const a = labels[idx - 1];
      const b = labels[idx + 1];
      const c = labels[idx - width];
      const d = labels[idx + width];
      const self = labels[idx];
      
      // Count votes for each unique label
      let bestLabel = self;
      let bestCount = 1;
      
      // Check each neighbor
      const neighbors = [a, b, c, d];
      for (let i = 0; i < 4; i++) {
        const label = neighbors[i];
        if (label === self) continue;
        
        let count = 1;
        for (let j = i + 1; j < 4; j++) {
          if (neighbors[j] === label) count++;
        }
        
        if (count > bestCount) {
          bestCount = count;
          bestLabel = label;
        }
      }
      
      nextLabels[idx] = bestLabel;
    }
  }
  
  labels.set(nextLabels);
}

function transitionWeight(current, next, luma, grad, coarseLab, sigma2, gradPenalty) {
  const dl = coarseLab.l[current] - coarseLab.l[next];
  const da = coarseLab.a[current] - coarseLab.a[next];
  const db = coarseLab.b[current] - coarseLab.b[next];
  const dLab2 = dl * dl + da * da + db * db;
  const dLum = Math.abs(luma[current] - luma[next]);
  const edgeCost = gradPenalty * (0.5 * grad[next] + 0.5 * dLum);
  return Math.exp(-dLab2 / Math.max(1e-5, sigma2) - edgeCost);
}

function nearestSeedIndex(x, y, seedX, seedY, seedGridWidth, stride, offsetX, offsetY) {
  const gx = (x - offsetX) / stride;
  const gy = (y - offsetY) / stride;
  const x0 = clampInt(Math.floor(gx), 0, seedX.length - 1);
  const y0 = clampInt(Math.floor(gy), 0, seedY.length - 1);
  const x1 = clampInt(x0 + 1, 0, seedX.length - 1);
  const y1 = clampInt(y0 + 1, 0, seedY.length - 1);

  let bestGX = x0;
  let bestGY = y0;
  let bestDist = Infinity;

  const candidatesX = x0 === x1 ? [x0] : [x0, x1];
  const candidatesY = y0 === y1 ? [y0] : [y0, y1];
  for (let yi = 0; yi < candidatesY.length; yi++) {
    const sy = seedY[candidatesY[yi]];
    const dy = y - sy;
    for (let xi = 0; xi < candidatesX.length; xi++) {
      const sx = seedX[candidatesX[xi]];
      const dx = x - sx;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestGX = candidatesX[xi];
        bestGY = candidatesY[yi];
      }
    }
  }

  return bestGY * seedGridWidth + bestGX;
}

function countSegmentSizes(labels, segmentCount) {
  const sizes = new Uint32Array(segmentCount);
  for (let i = 0; i < labels.length; i++) {
    sizes[labels[i]] += 1;
  }
  return sizes;
}

function blendMultiscaleEntropy(shortField, shortEntropy, longField, longEntropy, grad, width, height, options) {
  const n = width * height;
  const rawMask = new Float32Array(n);
  const blendMask = new Float32Array(n);
  const nextMask = new Float32Array(n);
  const entropy = new Float32Array(n);
  let maxShortStrength = 1e-6;
  let maxEntropyDiff = 1e-6;
  let maxShortSize = 1;

  for (let i = 0; i < n; i++) {
    if (shortField.strength[i] > maxShortStrength) maxShortStrength = shortField.strength[i];
    const diff = Math.abs(shortEntropy[i] - longEntropy[i]);
    if (diff > maxEntropyDiff) maxEntropyDiff = diff;
  }
  for (let i = 0; i < shortField.segmentSizes.length; i++) {
    if (shortField.segmentSizes[i] > maxShortSize) maxShortSize = shortField.segmentSizes[i];
  }

  for (let i = 0; i < n; i++) {
    const disagreement = shortField.labels[i] === longField.labels[i] ? 0 : 1;
    const strength = clamp01(shortField.strength[i] / maxShortStrength);
    const size = shortField.segmentSizes[shortField.labels[i]] || 1;
    const smallness = 1 - Math.sqrt(size / maxShortSize);
    const edge = smoothstep(options.edgeLow, options.edgeHigh, grad[i]);
    const entropyDiff = Math.abs(shortEntropy[i] - longEntropy[i]) / maxEntropyDiff;
    rawMask[i] = clamp01(
      0.32 * disagreement +
      0.24 * strength +
      0.22 * smallness +
      0.14 * edge +
      0.18 * entropyDiff
    );
    blendMask[i] = rawMask[i];
  }

  const alpha = options.poissonAlpha;
  
  // Pre-compute edge weights to avoid repeated Math.exp() calls
  const leftWeight = new Float32Array(n);
  const rightWeight = new Float32Array(n);
  const upWeight = new Float32Array(n);
  const downWeight = new Float32Array(n);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (x > 0) leftWeight[idx] = Math.exp(-6 * Math.max(grad[idx], grad[idx - 1]));
      if (x + 1 < width) rightWeight[idx] = Math.exp(-6 * Math.max(grad[idx], grad[idx + 1]));
      if (y > 0) upWeight[idx] = Math.exp(-6 * Math.max(grad[idx], grad[idx - width]));
      if (y + 1 < height) downWeight[idx] = Math.exp(-6 * Math.max(grad[idx], grad[idx + width]));
    }
  }
  
  // Poisson blending with early termination
  const convergenceThreshold = 1e-4;
  let prevDiff = Infinity;
  
  for (let iter = 0; iter < options.poissonIterations; iter++) {
    let maxDiff = 0;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        let sum = rawMask[idx];
        let weightSum = 1;
        
        if (x > 0) {
          const w = leftWeight[idx];
          sum += alpha * w * blendMask[idx - 1];
          weightSum += alpha * w;
        }
        if (x + 1 < width) {
          const w = rightWeight[idx];
          sum += alpha * w * blendMask[idx + 1];
          weightSum += alpha * w;
        }
        if (y > 0) {
          const w = upWeight[idx];
          sum += alpha * w * blendMask[idx - width];
          weightSum += alpha * w;
        }
        if (y + 1 < height) {
          const w = downWeight[idx];
          sum += alpha * w * blendMask[idx + width];
          weightSum += alpha * w;
        }
        
        const newVal = sum / weightSum;
        const diff = Math.abs(newVal - blendMask[idx]);
        if (diff > maxDiff) maxDiff = diff;
        nextMask[idx] = newVal;
      }
    }
    
    blendMask.set(nextMask);
    
    // Early termination if converged
    if (maxDiff < convergenceThreshold) break;
    if (Math.abs(prevDiff - maxDiff) < convergenceThreshold * 0.1) break;
    prevDiff = maxDiff;
  }

  for (let i = 0; i < n; i++) {
    entropy[i] = longEntropy[i] + (shortEntropy[i] - longEntropy[i]) * blendMask[i];
  }

  return { entropy, blendMask, rawMask };
}

function remapLabels(labels) {
  const remap = new Map();
  let nextId = 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!remap.has(label)) {
      remap.set(label, nextId++);
    }
    labels[i] = remap.get(label);
  }
  return nextId;
}

module.exports = {
  computeRandomWalkField,
  computeRandomWalkRegions,
  computeEntropyFromLabels,
  blendMultiscaleEntropy
};

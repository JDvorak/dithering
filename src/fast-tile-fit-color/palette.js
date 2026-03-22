const { labDistanceSq, labToRgb } = require('./color');

function solvePaletteAndRamps(labImage, width, height, options) {
  const count = width * height;
  const samples = [];
  const stride = Math.max(1, options.paletteSampleStride | 0);
  for (let i = 0; i < count; i += stride) {
    samples.push({ l: labImage.l[i], a: labImage.a[i], b: labImage.b[i], w: 1 });
  }
  const k = Math.max(4, options.paletteSize | 0);
  const centers = kmeansLab(samples, k, Math.max(3, options.paletteIterations | 0));
  centers.sort((x, y) => x.l - y.l);

  const palette = new Array(centers.length);
  for (let i = 0; i < centers.length; i++) {
    const rgb = labToRgb(centers[i]);
    palette[i] = {
      index: i,
      labL: centers[i].l,
      labA: centers[i].a,
      labB: centers[i].b,
      r: rgb.r,
      g: rgb.g,
      b: rgb.b
    };
  }

  const labels = new Int16Array(count);
  const counts = new Uint32Array(palette.length);
  for (let i = 0; i < count; i++) {
    const id = nearestPalette(palette, labImage.l[i], labImage.a[i], labImage.b[i]);
    labels[i] = id;
    counts[id] += 1;
  }

  const adjacency = new Float32Array(palette.length * palette.length);
  buildPaletteAdjacency(adjacency, labels, width, height, palette.length);
  const ramps = buildRamps(palette, adjacency, counts, options);

  return { palette, labels, counts, adjacency, ramps };
}

function buildRamps(palette, adjacency, counts, options) {
  const n = palette.length;
  const used = new Uint8Array(n);
  const ramps = [];
  const maxRamps = Math.max(1, options.maxRamps | 0 || 6);
  const edgeThreshold = Math.max(0.01, options.rampEdgeThreshold || 0.08);

  for (let seed = 0; seed < n && ramps.length < maxRamps; seed++) {
    if (used[seed]) continue;
    if (counts[seed] < 4) continue;
    const ramp = [seed];
    used[seed] = 1;

    let right = seed;
    while (right + 1 < n) {
      const w = adjacency[right * n + (right + 1)];
      if (w < edgeThreshold) break;
      right += 1;
      if (used[right]) break;
      ramp.push(right);
      used[right] = 1;
    }

    let left = seed;
    while (left - 1 >= 0) {
      const w = adjacency[(left - 1) * n + left];
      if (w < edgeThreshold) break;
      left -= 1;
      if (used[left]) break;
      ramp.unshift(left);
      used[left] = 1;
    }

    if (ramp.length >= 2) ramps.push(ramp);
  }

  if (ramps.length === 0) {
    ramps.push(Array.from({ length: n }, (_, i) => i));
  }
  return ramps;
}

function buildPaletteAdjacency(adjacency, labels, width, height, n) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const a = labels[i];
      if (x + 1 < width) {
        const b = labels[i + 1];
        adjacency[a * n + b] += 1;
        adjacency[b * n + a] += 1;
      }
      if (y + 1 < height) {
        const b = labels[i + width];
        adjacency[a * n + b] += 1;
        adjacency[b * n + a] += 1;
      }
    }
  }

  let max = 0;
  for (let i = 0; i < adjacency.length; i++) if (adjacency[i] > max) max = adjacency[i];
  if (max <= 1e-8) return;
  const inv = 1 / max;
  for (let i = 0; i < adjacency.length; i++) adjacency[i] *= inv;
}

function kmeansLab(samples, k, iterations) {
  const count = Math.max(1, Math.min(k, samples.length));
  const centers = [samples[0]];
  while (centers.length < count) {
    let best = 0;
    let bestDist = -1;
    for (let i = 0; i < samples.length; i++) {
      let near = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = labDistanceSq(samples[i].l, samples[i].a, samples[i].b, centers[c].l, centers[c].a, centers[c].b);
        if (d < near) near = d;
      }
      if (near > bestDist) {
        bestDist = near;
        best = i;
      }
    }
    centers.push(samples[best]);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const sumL = new Float32Array(count);
    const sumA = new Float32Array(count);
    const sumB = new Float32Array(count);
    const sumW = new Float32Array(count);
    for (let i = 0; i < samples.length; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < count; c++) {
        const d = labDistanceSq(samples[i].l, samples[i].a, samples[i].b, centers[c].l, centers[c].a, centers[c].b);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      sumL[best] += samples[i].l;
      sumA[best] += samples[i].a;
      sumB[best] += samples[i].b;
      sumW[best] += 1;
    }
    for (let c = 0; c < count; c++) {
      if (sumW[c] <= 0) continue;
      const inv = 1 / sumW[c];
      centers[c] = { l: sumL[c] * inv, a: sumA[c] * inv, b: sumB[c] * inv };
    }
  }

  while (centers.length < k) centers.push({ ...centers[centers.length - 1] });
  return centers;
}

function nearestPalette(palette, l, a, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = labDistanceSq(l, a, b, palette[i].labL, palette[i].labA, palette[i].labB);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

module.exports = {
  solvePaletteAndRamps,
  nearestPalette
};

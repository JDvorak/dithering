const { extractLuminance, computeGradients } = require('../randomwalk-bw/image');
const { runFastTileFit } = require('../fast-tile-fit/pipeline');
const { DEFAULTS: FAST_TILE_FIT_DEFAULTS } = require('../fast-tile-fit/options');
const { estimateShadowFreeImage } = require('./shadow');
const { solvePaletteAndRamps, nearestPalette } = require('./palette');
const { labDistanceSq, computeLabImage } = require('./color');
const { buildVectorSimplification, overlaySimplifiedLines } = require('./vector-simplify');

function runFastTileFitColor(imageData, options) {
  const width = imageData.width;
  const height = imageData.height;
  const count = width * height;
  const luma = extractLuminance(imageData.data, count);

  // Draw edges only mode: just return Canny edges as black on white
  if (options.drawEdgesOnly) {
    const inputLab = computeLabImage(imageData.data, width, height);
    const shadow = estimateShadowFreeImage(imageData.data, inputLab, luma, width, height, options);
    const vector = buildVectorSimplification(imageData.data, shadow.shadowFreeRgba, luma, width, height, options);

    const rgba = new Uint8ClampedArray(count * 4);
    // Fill with white background
    for (let i = 0; i < count; i++) {
      const idx = i * 4;
      rgba[idx] = 255;
      rgba[idx + 1] = 255;
      rgba[idx + 2] = 255;
      rgba[idx + 3] = 255;
    }

    // Draw black edges
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const e = vector.edges[idx];
        if (e > 0) {
          const o = idx * 4;
          rgba[o] = 0;
          rgba[o + 1] = 0;
          rgba[o + 2] = 0;
          rgba[o + 3] = 255;
        }
      }
    }

    return {
      width,
      height,
      rgba,
      metadata: {
        blocks4: 0,
        paletteSize: 0,
        ramps: 0,
        whiteBalance: shadow.whiteBalance,
        samePairBlocks: 0,
        structureBlocks4: 0,
        structureTiles4: 0,
        structureBinaryKind: 'edges-only',
        lineGuideMean: 0,
        vectorEdgeMean: meanFloat(vector.edges)
      }
    };
  }

  const inputLab = computeLabImage(imageData.data, width, height);

  const shadow = estimateShadowFreeImage(imageData.data, inputLab, luma, width, height, options);
  const vector = buildVectorSimplification(imageData.data, shadow.shadowFreeRgba, luma, width, height, options);
  const warpedOriginalLab = computeLabImage(vector.warpedOriginalRgba, width, height);
  const warpedShadowLab = computeLabImage(vector.warpedShadowRgba, width, height);
  const paletteState = solvePaletteAndRamps(shadow.shadowFreeLab, width, height, options);
  const structure = buildStructureBinary(vector.warpedOriginalRgba, vector.warpedShadowRgba, width, height, options);
  const fitLab = blendLabImages(warpedShadowLab, warpedOriginalLab, options.detailLabBlend);
  const warpedLuma = extractLuminance(vector.warpedOriginalRgba, count);
  const gradients = computeGradients(warpedLuma, width, height);

  const blocksX = Math.ceil(width / options.blockSize);
  const blocksY = Math.ceil(height / options.blockSize);
  const blockCount = blocksX * blocksY;
  const colorLow = new Int16Array(blockCount);
  const colorHigh = new Int16Array(blockCount);
  const lineGuide = buildLineGuide(structure.tiledBinary, gradients.grad, width, height, options.blockSize, blocksX, blocksY);
  let samePairBlocks = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const bi = by * blocksX + bx;
      const pair = chooseColorPairForBlock(
        bx,
        by,
        blocksX,
        width,
        height,
        options.blockSize,
        structure.tiledBinary,
        fitLab,
        paletteState,
        colorLow,
        colorHigh,
        lineGuide,
        options
      );
      colorLow[bi] = pair.low;
      colorHigh[bi] = pair.high;
      if (pair.low === pair.high) samePairBlocks += 1;
    }
  }

  let rgba = renderColorBlocksFromBinary(
    width,
    height,
    options.blockSize,
    blocksX,
    blocksY,
    structure.tiledBinary,
    colorLow,
    colorHigh,
    paletteState.palette
  );
  rgba = overlaySimplifiedLines(rgba, vector.edges, vector.gx, vector.gy, width, height, options.lineOverlayStrength, options.lineOverlayDarken, options.debugLineColor);

  return {
    width,
    height,
    rgba,
    metadata: {
      blocks4: blockCount,
      paletteSize: paletteState.palette.length,
      ramps: paletteState.ramps.length,
      whiteBalance: shadow.whiteBalance,
      samePairBlocks,
      structureBlocks4: structure.metadata.blocks4,
      structureTiles4: structure.metadata.tileCount4,
      structureBinaryKind: 'tile',
      lineGuideMean: meanFloat(lineGuide),
      vectorEdgeMean: meanFloat(vector.edges)
    }
  };
}

function chooseColorPairForBlock(
  bx,
  by,
  blocksX,
  width,
  height,
  size,
  structureBinary,
  labImage,
  paletteState,
  colorLow,
  colorHigh,
  lineGuide,
  options
) {
  const bi = by * blocksX + bx;
  let sumL0 = 0;
  let sumA0 = 0;
  let sumB0 = 0;
  let n0 = 0;
  let sumL1 = 0;
  let sumA1 = 0;
  let sumB1 = 0;
  let n1 = 0;

  for (let y = 0; y < size; y++) {
    const yy = by * size + y;
    if (yy >= height) break;
    for (let x = 0; x < size; x++) {
      const xx = bx * size + x;
      if (xx >= width) break;
      const idx = yy * width + xx;
      const bit = structureBinary[idx];
      if (bit === 0) {
        sumL0 += labImage.l[idx];
        sumA0 += labImage.a[idx];
        sumB0 += labImage.b[idx];
        n0 += 1;
      } else {
        sumL1 += labImage.l[idx];
        sumA1 += labImage.a[idx];
        sumB1 += labImage.b[idx];
        n1 += 1;
      }
    }
  }

  const invTotal = 1 / Math.max(1, n0 + n1);
  const midL = (sumL0 + sumL1) * invTotal;
  const midA = (sumA0 + sumA1) * invTotal;
  const midB = (sumB0 + sumB1) * invTotal;
  if (n0 <= 0 || n1 <= 0) {
    const id = nearestPalette(paletteState.palette, midL, midA, midB);
    return { low: id, high: id };
  }

  const m0 = { l: sumL0 / n0, a: sumA0 / n0, b: sumB0 / n0 };
  const m1 = { l: sumL1 / n1, a: sumA1 / n1, b: sumB1 / n1 };
  const cands0 = nearestKPalette(paletteState.palette, m0, 6);
  const cands1 = nearestKPalette(paletteState.palette, m1, 6);
  const candsMid = nearestKPalette(paletteState.palette, { l: midL, a: midA, b: midB }, 1);
  const candsNeighbor = neighborPairCandidates(bx, by, bi, blocksX, colorLow, colorHigh);
  const list0 = mergeUnique(cands0, candsMid);
  const list1 = mergeUnique(mergeUnique(cands1, candsMid), candsNeighbor);
  const localContrast = Math.abs(m1.l - m0.l);
  const lineStrength = lineGuide[bi];
  const sameContrastThreshold = options.sameColorContrastThreshold * (1 - 0.8 * lineStrength);
  const allowSame = localContrast <= sameContrastThreshold;
  const slack = options.lineConstraintSlack * lineStrength;
  const shareNeighborPenalty = options.shareNeighborWeight * (1 - slack);
  const sameRampPenalty = options.sameRampWeight * (1 - 0.7 * slack);
  const pairReusePenalty = options.pairReuseWeight * (1 - slack);
  const w0 = n0 * invTotal;
  const w1 = n1 * invTotal;
  const dLabL = m1.l - m0.l;
  const dLabA = m1.a - m0.a;
  const dLabB = m1.b - m0.b;
  const contrastRamp = smooth01(sameContrastThreshold, sameContrastThreshold + 3.5, localContrast);
  const minSepTarget = options.minPairSeparation * contrastRamp + options.lineMinSeparationBoost * lineStrength;

  let bestLow = cands0[0];
  let bestHigh = cands1[0];
  let bestScore = Infinity;

  for (let i = 0; i < list0.length; i++) {
    for (let j = 0; j < list1.length; j++) {
      const low = list0[i];
      const high = list1[j];
      if (low === high && !allowSame) continue;
      const p0 = paletteState.palette[low];
      const p1 = paletteState.palette[high];

      let score = exactLabErrorBlock(bx, by, width, height, size, structureBinary, labImage, p0, p1);

      if (by > 0) {
        const t = bi - blocksX;
        if (!sharesColor(low, high, colorLow[t], colorHigh[t])) score += shareNeighborPenalty * 12;
      }
      if (bx > 0) {
        const l = bi - 1;
        if (!sharesColor(low, high, colorLow[l], colorHigh[l])) score += shareNeighborPenalty * 12;
      }
      if (!sharesRamp(low, high, paletteState.ramps)) score += sameRampPenalty * 10;

      const pairContrast = Math.abs(p1.labL - p0.labL);
      const targetContrast = Math.max(0, localContrast * (0.7 + options.lineContrastBoost * lineStrength));
      if (pairContrast < targetContrast) {
        const missing = targetContrast - pairContrast;
        score += options.detailContrastWeight * missing * missing * 0.02;
      }

      const blendL = w0 * p0.labL + w1 * p1.labL;
      const blendA = w0 * p0.labA + w1 * p1.labA;
      const blendB = w0 * p0.labB + w1 * p1.labB;
      score += options.pairBlendWeight * 0.03 * labDistanceSq(midL, midA, midB, blendL, blendA, blendB);

      const pairDL = p1.labL - p0.labL;
      const pairDA = p1.labA - p0.labA;
      const pairDB = p1.labB - p0.labB;
      const vecDiff = sqr(pairDL - dLabL) + sqr(pairDA - dLabA) + sqr(pairDB - dLabB);
      score += options.pairContrastVectorWeight * 0.01 * vecDiff;

      const sep = Math.sqrt(Math.max(0, pairDL * pairDL + pairDA * pairDA + pairDB * pairDB));
      if (sep < minSepTarget) {
        const missSep = minSepTarget - sep;
        score += options.minPairSeparationWeight * missSep * missSep;
      }

      if (localContrast <= options.pairReuseContrastGate) {
        if (bx > 0) {
          const li = bi - 1;
          if (low !== colorLow[li] || high !== colorHigh[li]) score += pairReusePenalty;
        }
        if (by > 0) {
          const ti = bi - blocksX;
          if (low !== colorLow[ti] || high !== colorHigh[ti]) score += pairReusePenalty;
        }
      }

      if (score < bestScore) {
        bestScore = score;
        bestLow = low;
        bestHigh = high;
      }
    }
  }

  if (!Number.isFinite(bestScore)) {
    const distinct = pickDistinctPair(paletteState.palette, cands0[0], cands1[0]);
    bestLow = distinct.low;
    bestHigh = distinct.high;
  }
  return { low: bestLow, high: bestHigh };
}

function renderColorBlocksFromBinary(width, height, size, blocksX, blocksY, structureBinary, colorLow, colorHigh, palette) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const bi = by * blocksX + bx;
      const low = palette[colorLow[bi]];
      const high = palette[colorHigh[bi]];
      for (let y = 0; y < size; y++) {
        const yy = by * size + y;
        if (yy >= height) break;
        for (let x = 0; x < size; x++) {
          const xx = bx * size + x;
          if (xx >= width) break;
          const idx = yy * width + xx;
          const c = structureBinary[idx] ? high : low;
          const outIdx = idx * 4;
          out[outIdx] = Math.round(c.r * 255);
          out[outIdx + 1] = Math.round(c.g * 255);
          out[outIdx + 2] = Math.round(c.b * 255);
          out[outIdx + 3] = 255;
        }
      }
    }
  }
  return out;
}

function sharesColor(a0, a1, b0, b1) {
  return a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1;
}

function sharesRamp(a, b, ramps) {
  for (let i = 0; i < ramps.length; i++) {
    const r = ramps[i];
    let hasA = false;
    let hasB = false;
    for (let j = 0; j < r.length; j++) {
      if (r[j] === a) hasA = true;
      if (r[j] === b) hasB = true;
    }
    if (hasA && hasB) return true;
  }
  return false;
}

function exactLabErrorBlock(bx, by, width, height, size, structureBinary, labImage, lowColor, highColor) {
  let err = 0;
  for (let y = 0; y < size; y++) {
    const yy = by * size + y;
    if (yy >= height) break;
    for (let x = 0; x < size; x++) {
      const xx = bx * size + x;
      if (xx >= width) break;
      const idx = yy * width + xx;
      const c = structureBinary[idx] ? highColor : lowColor;
      err += labDistanceSq(labImage.l[idx], labImage.a[idx], labImage.b[idx], c.labL, c.labA, c.labB);
    }
  }
  return err;
}

function nearestKPalette(palette, lab, k) {
  const list = [];
  for (let i = 0; i < palette.length; i++) {
    const d = labDistanceSq(lab.l, lab.a, lab.b, palette[i].labL, palette[i].labA, palette[i].labB);
    list.push({ i, d });
  }
  list.sort((a, b) => a.d - b.d);
  return list.slice(0, Math.min(k, list.length)).map((v) => v.i);
}

function neighborPairCandidates(bx, by, bi, blocksX, colorLow, colorHigh) {
  const out = [];
  if (bx > 0) {
    const li = bi - 1;
    out.push(colorLow[li], colorHigh[li]);
  }
  if (by > 0) {
    const ti = bi - blocksX;
    out.push(colorLow[ti], colorHigh[ti]);
  }
  return out;
}

function mergeUnique(a, b) {
  const seen = new Uint8Array(256);
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (seen[v]) continue;
    seen[v] = 1;
    out.push(v);
  }
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (seen[v]) continue;
    seen[v] = 1;
    out.push(v);
  }
  return out;
}

function pickDistinctPair(palette, a, b) {
  if (a !== b) return { low: a, high: b };
  let best = a;
  let bestDist = -1;
  for (let i = 0; i < palette.length; i++) {
    if (i === a) continue;
    const d = labDistanceSq(palette[a].labL, palette[a].labA, palette[a].labB, palette[i].labL, palette[i].labA, palette[i].labB);
    if (d > bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return { low: a, high: best };
}

function sqr(v) {
  return v * v;
}

function smooth01(edge0, edge1, x) {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / Math.max(1e-8, edge1 - edge0);
  return t * t * (3 - 2 * t);
}

function buildLineGuide(structureBinary, grad, width, height, size, blocksX, blocksY) {
  const out = new Float32Array(blocksX * blocksY);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const bi = by * blocksX + bx;
      let edge = 0;
      let ink = 0;
      let transitions = 0;
      let n = 0;
      for (let y = 0; y < size; y++) {
        const yy = by * size + y;
        if (yy >= height) break;
        for (let x = 0; x < size; x++) {
          const xx = bx * size + x;
          if (xx >= width) break;
          const idx = yy * width + xx;
          const v = structureBinary[idx];
          edge += grad[idx];
          ink += v;
          n += 1;
          if (x + 1 < size && xx + 1 < width) {
            const r = structureBinary[idx + 1];
            if (r !== v) transitions += 1;
          }
          if (y + 1 < size && yy + 1 < height) {
            const d = structureBinary[idx + width];
            if (d !== v) transitions += 1;
          }
        }
      }
      const invN = 1 / Math.max(1, n);
      const edgeMean = edge * invN;
      const inkRatio = ink * invN;
      const densityMid = 1 - Math.abs(inkRatio - 0.5) * 2;
      const transNorm = transitions / Math.max(1, 2 * n);
      const line = clamp01((edgeMean - 0.03) / 0.2) * clamp01(densityMid) * clamp01(transNorm * 3.2);
      out[bi] = line;
    }
  }
  return out;
}

function meanFloat(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / Math.max(1, arr.length);
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function buildStructureBinary(originalRgba, shadowFreeRgba, width, height, options) {
  const structureInput = blendRgba(shadowFreeRgba, originalRgba, options.structureOriginalBlend);
  const structureOptions = buildStructureOptions(options);
  const result = runFastTileFit(
    {
      width,
      height,
      data: structureInput
    },
    structureOptions
  );
  return {
    binary: result.binary,
    tiledBinary: result.tiledBinary || result.binary,
    metadata: result.metadata
  };
}

function buildStructureOptions(options) {
  return {
    ...FAST_TILE_FIT_DEFAULTS,
    seed: options.seed,
    prefitParkerStrength: 0,
    fineGuideBlend: 0,
    tileRotationSteps4: options.structureTileRotation4,
    tileRotationSteps8: options.structureTileRotation8,
    tileLienRepairPasses: options.structureLienRepairPasses,
    fineIterations: options.structureFineIterations,
    continuityPasses: options.structureContinuityPasses,
    phasePasses: options.structurePhasePasses,
    phaseDiv: options.phaseDiv,
    tuftePasses: 0,
    tufteStrength: 0,
    lienSortPasses: 1
  };
}

function blendRgba(base, detail, detailBlend) {
  const blend = clamp(detailBlend, 0, 1);
  if (blend <= 1e-6) return base;
  if (blend >= 1 - 1e-6) return detail;
  const out = new Uint8ClampedArray(base.length);
  const keep = 1 - blend;
  for (let i = 0; i < base.length; i += 4) {
    out[i] = Math.round(base[i] * keep + detail[i] * blend);
    out[i + 1] = Math.round(base[i + 1] * keep + detail[i + 1] * blend);
    out[i + 2] = Math.round(base[i + 2] * keep + detail[i + 2] * blend);
    out[i + 3] = 255;
  }
  return out;
}

function blendLabImages(baseLab, detailLab, detailBlend) {
  const blend = clamp(detailBlend, 0, 1);
  if (blend <= 1e-6) return baseLab;
  if (blend >= 1 - 1e-6) return detailLab;
  const n = baseLab.l.length;
  const outL = new Float32Array(n);
  const outA = new Float32Array(n);
  const outB = new Float32Array(n);
  const keep = 1 - blend;
  for (let i = 0; i < n; i++) {
    outL[i] = baseLab.l[i] * keep + detailLab.l[i] * blend;
    outA[i] = baseLab.a[i] * keep + detailLab.a[i] * blend;
    outB[i] = baseLab.b[i] * keep + detailLab.b[i] * blend;
  }
  return { l: outL, a: outA, b: outB };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

module.exports = {
  runFastTileFitColor
};

const { extractLuminance, computeGradients, boxBlur } = require('../randomwalk-bw/image');
const { clamp01, createRng } = require('../randomwalk-bw/math');
const { createProgressiveMask, sampleParkerThreshold } = require('../randomwalk-bw/masks');
const { buildTileSystem, DESC_DIM } = require('./tiles');

const POPCOUNT_8 = buildPopcount8();

function runFastTileFit(imageData, options) {
  const width = imageData.width;
  const height = imageData.height;
  const count = width * height;
  const luma = extractLuminance(imageData.data, count);
  const fitLuma = buildParkerPrefitTarget(luma, width, height, options);
  const analysis = analyzeEnergyLandscape(fitLuma, width, height, options);
  const gradients = analysis.gradients;

  const tileSystem = buildTileSystem(options);
  const coarseGuide = boxBlur(fitLuma, width, height, options.coarseBlurRadius);
  const coarseKey = boxBlur(coarseGuide, width, height, options.keyBlurRadius);

  const rng = createRng(options.seed);
  const coarseMatch = fitScale({
    image: coarseGuide,
    keyImage: coarseKey,
    analysis,
    width,
    height,
    tileSet: tileSystem.coarse,
    iterations: options.coarseIterations,
    parentFamilies: null,
    options,
    rng
  });

  const coarseRecon = renderScale(coarseMatch.assignment, tileSystem.coarse, width, height, coarseMatch.phaseX, coarseMatch.phaseY);
  const fineInput = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    fineInput[i] = clamp01(fitLuma[i] * (1 - options.fineGuideBlend) + coarseRecon[i] * options.fineGuideBlend);
  }
  const fineKey = boxBlur(fineInput, width, height, options.keyBlurRadius);

  const parentFamilies = buildParentFamilies(
    coarseMatch.assignment,
    coarseMatch.blocksX,
    coarseMatch.blocksY,
    tileSystem.coarse,
    tileSystem.familyTransfer,
    width,
    height,
    tileSystem.fine.size
  );

  const fineMatch = fitScale({
    image: fineInput,
    keyImage: fineKey,
    analysis,
    width,
    height,
    tileSet: tileSystem.fine,
    iterations: options.fineIterations,
    parentFamilies,
    options,
    rng,
    familyIndex: tileSystem.fineByFamily
  });

  const tiledBinary = renderScaleBinary(fineMatch.assignment, tileSystem.fine, width, height, fineMatch.phaseX, fineMatch.phaseY);
  if (options.momentumClosePasses > 0) {
    applyMomentumLineClosure(tiledBinary, gradients.gx, gradients.gy, analysis.cannyEdges, width, height, options);
  }
  const binary = Uint8Array.from(tiledBinary);

  if (options.lienSortPasses > 0) {
    applyLienSortCleanup(binary, gradients.gx, gradients.gy, width, height, options.lienSortPasses);
  }

  if (options.tuftePasses > 0 && options.tufteStrength > 0) {
    applyTufteInkPass(binary, luma, gradients.grad, width, height, options, rng);
  }

  return {
    width,
    height,
    binary,
    tiledBinary,
    structure: {
      assignment: fineMatch.assignment,
      phaseX: fineMatch.phaseX,
      phaseY: fineMatch.phaseY,
      blocksX: fineMatch.blocksX,
      blocksY: fineMatch.blocksY,
      blockSize: tileSystem.fine.size
    },
    metadata: {
      tileCount4: tileSystem.fine.count,
      tileCount8: tileSystem.coarse.count,
      blocks4: fineMatch.assignment.length,
      blocks8: coarseMatch.assignment.length,
      phaseDiv: options.phaseDiv,
      tileMetadata4: exportTileMetadata(tileSystem.fine),
      tileMetadata8: exportTileMetadata(tileSystem.coarse)
    }
  };
}

function fitScale(params) {
  const {
    image,
    keyImage,
    analysis,
    width,
    height,
    tileSet,
    iterations,
    parentFamilies,
    options,
    familyIndex
  } = params;
  const size = tileSet.size;
  const blocksX = Math.ceil(width / size);
  const blocksY = Math.ceil(height / size);
  const blockCount = blocksX * blocksY;

  const blockDesc = new Float32Array(blockCount * DESC_DIM);
  const blockPatch = new Float32Array(blockCount * tileSet.area);
  const blockValuePatch = new Float32Array(blockCount * tileSet.area);
  const blockGradPatch = new Float32Array(blockCount * tileSet.area);
  const blockBins = new Int32Array(blockCount * 2);
  const blockDirX = new Float32Array(blockCount);
  const blockDirY = new Float32Array(blockCount);
  const blockDirectionalStrength = new Float32Array(blockCount);
  const blockAdirectionality = new Float32Array(blockCount);
  const blockEdgeStrength = new Float32Array(blockCount);
  const boundaryLeft = new Float32Array(blockCount);
  const boundaryTop = new Float32Array(blockCount);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const bi = by * blocksX + bx;
      sampleBlockPatch(blockPatch, bi, keyImage, width, height, bx, by, size);
      sampleBlockPatch(blockValuePatch, bi, image, width, height, bx, by, size);
      sampleBlockPatch(blockGradPatch, bi, analysis.energy, width, height, bx, by, size);
      computeBlockDescriptor(
        blockDesc,
        bi,
        blockPatch,
        tileSet.area,
        size,
        analysis,
        width,
        height,
        bx,
        by,
        blockDirX,
        blockDirY,
        blockDirectionalStrength,
        blockAdirectionality,
        blockEdgeStrength
      );
      blockBins[bi * 2] = quantize(blockDesc[bi * DESC_DIM], 10);
      blockBins[bi * 2 + 1] = quantize((blockDesc[bi * DESC_DIM + 3] + 1) * 0.5, 8);
    }
  }

  buildBoundaryEdgeStrengthMaps(boundaryLeft, boundaryTop, analysis.edgeForCoherence, width, height, blocksX, blocksY, size);

  const tileRanks = buildProjectionRanks(tileSet.desc, tileSet.count, options.swdProjections);
  const blockRanks = buildProjectionRanks(blockDesc, blockCount, options.swdProjections);

  const buckets = buildTileBuckets(tileSet, 10, 8);
  const candidateOffsets = new Int32Array(blockCount + 1);
  const candidateList = [];
  const distList = [];
  const toneList = [];

  for (let bi = 0; bi < blockCount; bi++) {
    candidateOffsets[bi] = candidateList.length;
    const candidates = gatherCandidates(
      bi,
      blockBins,
      buckets,
      tileSet,
      options.searchCandidates,
      parentFamilies,
      familyIndex
    );
    for (let i = 0; i < candidates.length; i++) {
      const tile = candidates[i];
      candidateList.push(tile);
      const dist = computeDistanceTerms(
        bi,
        tile,
        blockDesc,
        blockPatch,
        blockValuePatch,
        blockGradPatch,
        tileSet,
        options
      );
      distList.push(dist.total);
      toneList.push(dist.tone);
    }
  }
  candidateOffsets[blockCount] = candidateList.length;

  const candidatesFlat = Int32Array.from(candidateList);
  const baseDistFlat = Float32Array.from(distList);
  const toneDistFlat = Float32Array.from(toneList);
  const assignment = new Int32Array(blockCount);
  assignment.fill(0);

  const minDistByTile = new Float32Array(tileSet.count);
  const minDistByBlock = new Float32Array(blockCount);
  const minToneByBlock = new Float32Array(blockCount);

  minDistByTile.fill(Infinity);
  minDistByBlock.fill(Infinity);
  minToneByBlock.fill(Infinity);
  for (let bi = 0; bi < blockCount; bi++) {
    const start = candidateOffsets[bi];
    const end = candidateOffsets[bi + 1];
    for (let ci = start; ci < end; ci++) {
      const tile = candidatesFlat[ci];
      const d = baseDistFlat[ci];
      if (d < minDistByTile[tile]) minDistByTile[tile] = d;
      if (d < minDistByBlock[bi]) minDistByBlock[bi] = d;
      if (toneDistFlat[ci] < minToneByBlock[bi]) minToneByBlock[bi] = toneDistFlat[ci];
    }
  }

  for (let iter = 0; iter < iterations; iter++) {

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const bi = by * blocksX + bx;
        const start = candidateOffsets[bi];
        const end = candidateOffsets[bi + 1];
        let bestTile = assignment[bi];
        let bestScore = Infinity;
        const bRankOff = bi * options.swdProjections;

        for (let ci = start; ci < end; ci++) {
          const tile = candidatesFlat[ci];
          const score = evaluateTileScore(
            tile,
            bi,
            bx,
            by,
            baseDistFlat[ci],
            toneDistFlat[ci],
            minDistByTile,
            minDistByBlock,
            minToneByBlock,
            tileRanks.rank,
            blockRanks.rank,
            tileSet,
            assignment,
            boundaryLeft,
            boundaryTop,
            blockDirX,
            blockDirY,
            blockDirectionalStrength,
            blockAdirectionality,
            blockEdgeStrength,
            parentFamilies,
            options,
            bRankOff,
            blocksX
          );
          if (score < bestScore) {
            bestScore = score;
            bestTile = tile;
          }
        }
        assignment[bi] = bestTile;
      }
    }
  }

  if (options.continuityPasses > 0) {
    refineContinuity(
      assignment,
      blocksX,
      blocksY,
      candidateOffsets,
      candidatesFlat,
      baseDistFlat,
      toneDistFlat,
      minDistByTile,
      minDistByBlock,
      minToneByBlock,
      tileRanks.rank,
      blockRanks.rank,
      tileSet,
      boundaryLeft,
      boundaryTop,
      blockDirX,
      blockDirY,
      blockDirectionalStrength,
      blockAdirectionality,
      blockEdgeStrength,
      parentFamilies,
      options
    );
  }

  const phase = refinePhaseOffsets(
    assignment,
    blocksX,
    blocksY,
    blockPatch,
    blockValuePatch,
    tileSet,
    options
  );

  return { assignment, blocksX, blocksY, phaseX: phase.phaseX, phaseY: phase.phaseY };
}

function refineContinuity(
  assignment,
  blocksX,
  blocksY,
  candidateOffsets,
  candidatesFlat,
  baseDistFlat,
  toneDistFlat,
  minDistByTile,
  minDistByBlock,
  minToneByBlock,
  tileRanks,
  blockRanks,
  tileSet,
  boundaryLeft,
  boundaryTop,
  blockDirX,
  blockDirY,
  blockDirectionalStrength,
  blockAdirectionality,
  blockEdgeStrength,
  parentFamilies,
  options
) {
  const keep = Math.max(2, options.continuityCandidates | 0);
  for (let pass = 0; pass < options.continuityPasses; pass++) {
    for (let parity = 0; parity < 2; parity++) {
      for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
          if (((bx + by) & 1) !== parity) continue;
          const bi = by * blocksX + bx;
          const start = candidateOffsets[bi];
          const end = candidateOffsets[bi + 1];
          if (end <= start) continue;

          const candidateCount = Math.min(keep, end - start);
          const bestLocal = new Int32Array(candidateCount);
          const bestLocalDist = new Float32Array(candidateCount);
          const bestLocalTone = new Float32Array(candidateCount);
          bestLocal.fill(-1);
          bestLocalDist.fill(Infinity);
          bestLocalTone.fill(Infinity);

          for (let ci = start; ci < end; ci++) {
            const d = baseDistFlat[ci];
            let insert = -1;
            for (let k = 0; k < candidateCount; k++) {
              if (d < bestLocalDist[k]) {
                insert = k;
                break;
              }
            }
            if (insert < 0) continue;
            for (let k = candidateCount - 1; k > insert; k--) {
              bestLocalDist[k] = bestLocalDist[k - 1];
              bestLocalTone[k] = bestLocalTone[k - 1];
              bestLocal[k] = bestLocal[k - 1];
            }
            bestLocalDist[insert] = d;
            bestLocalTone[insert] = toneDistFlat[ci];
            bestLocal[insert] = candidatesFlat[ci];
          }

          let bestTile = assignment[bi];
          let bestScore = Infinity;
          const bRankOff = bi * options.swdProjections;
          for (let k = 0; k < candidateCount; k++) {
            const tile = bestLocal[k];
            if (tile < 0) continue;
            const score = evaluateTileScore(
              tile,
              bi,
              bx,
              by,
              bestLocalDist[k],
              bestLocalTone[k],
              minDistByTile,
              minDistByBlock,
              minToneByBlock,
              tileRanks,
              blockRanks,
              tileSet,
              assignment,
              boundaryLeft,
              boundaryTop,
              blockDirX,
              blockDirY,
              blockDirectionalStrength,
              blockAdirectionality,
              blockEdgeStrength,
              parentFamilies,
              options,
              bRankOff,
              blocksX
            );
            if (score < bestScore) {
              bestScore = score;
              bestTile = tile;
            }
          }
          assignment[bi] = bestTile;
        }
      }
    }
  }
}

function evaluateTileScore(
  tile,
  bi,
  bx,
  by,
  rawDistance,
  toneDistance,
  minDistByTile,
  minDistByBlock,
  minToneByBlock,
  tileRanks,
  blockRanks,
  tileSet,
  assignment,
  boundaryLeft,
  boundaryTop,
  blockDirX,
  blockDirY,
  blockDirectionalStrength,
  blockAdirectionality,
  blockEdgeStrength,
  parentFamilies,
  options,
  bRankOff,
  blocksX
) {
  const localNorm = rawDistance / (options.completenessAlpha + (minDistByBlock[bi] + 1e-6));
  const globalNorm = rawDistance / (options.completenessAlpha + (minDistByTile[tile] + 1e-6));
  const normalized = (1 - options.completenessGlobalBlend) * localNorm + options.completenessGlobalBlend * globalNorm;
  const swdPenalty = projectionPenalty(tileRanks, blockRanks, tile, bRankOff, options.swdProjections);
  let score = normalized + options.swdWeight * swdPenalty + options.inkPenalty * tileSet.ink[tile];
  score += orientationPenalty(
    tile,
    bi,
    tileSet,
    blockDirX,
    blockDirY,
    blockDirectionalStrength,
    blockAdirectionality,
    blockEdgeStrength,
    options
  );
  const toneNormalized = toneDistance / (0.02 + minToneByBlock[bi]);
  score += coherencePenalty(assignment, bx, by, blocksX, tile, tileSet, boundaryLeft, boundaryTop, toneNormalized, options);
  if (parentFamilies) {
    const parentFamily = parentFamilies[bi];
    if (parentFamily >= 0 && tileSet.family[tile] !== parentFamily) score += options.parentFamilyWeight;
  }
  return score;
}

function gatherCandidates(bi, blockBins, buckets, tileSet, limit, parentFamilies, familyIndex) {
  const densityBin = blockBins[bi * 2];
  const dirBin = blockBins[bi * 2 + 1];
  const candidates = [];
  const seen = new Uint8Array(tileSet.count);

  for (let dd = -1; dd <= 1; dd++) {
    for (let dr = -1; dr <= 1; dr++) {
      const b0 = clampInt(densityBin + dd, 0, buckets.densityBins - 1);
      const b1 = clampInt(dirBin + dr, 0, buckets.directionBins - 1);
      const list = buckets.map.get((b0 << 8) | b1);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (seen[t]) continue;
        seen[t] = 1;
        candidates.push(t);
      }
    }
  }

  if (parentFamilies && familyIndex) {
    const fam = parentFamilies[bi];
    if (fam >= 0) {
      const familyTiles = familyIndex.get(fam);
      if (familyTiles) {
        for (let i = 0; i < familyTiles.length; i++) {
          const t = familyTiles[i];
          if (seen[t]) continue;
          seen[t] = 1;
          candidates.unshift(t);
        }
      }
    }
  }

  if (candidates.length === 0) {
    for (let t = 0; t < tileSet.count; t++) candidates.push(t);
  }
  return diversifyCandidates(candidates, tileSet.family, limit);
}

function diversifyCandidates(candidates, familyByTile, limit) {
  if (candidates.length <= limit) return candidates;
  const out = [];
  const familySeen = new Set();
  for (let i = 0; i < candidates.length && out.length < limit; i++) {
    const t = candidates[i];
    const f = familyByTile[t];
    if (familySeen.has(f)) continue;
    familySeen.add(f);
    out.push(t);
  }
  for (let i = 0; i < candidates.length && out.length < limit; i++) {
    const t = candidates[i];
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function buildTileBuckets(tileSet, densityBins, directionBins) {
  const map = new Map();
  for (let t = 0; t < tileSet.count; t++) {
    const d = quantize(tileSet.desc[t * DESC_DIM], densityBins);
    const dir = quantize((tileSet.desc[t * DESC_DIM + 3] + 1) * 0.5, directionBins);
    const key = (d << 8) | dir;
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(t);
  }
  return { map, densityBins, directionBins };
}

function buildProjectionRanks(desc, count, projections) {
  const rank = new Float32Array(count * projections);
  const vectors = makeProjectionVectors(projections, DESC_DIM);
  const idx = new Int32Array(count);
  const values = new Float32Array(count);

  for (let p = 0; p < projections; p++) {
    const pv = p * DESC_DIM;
    for (let i = 0; i < count; i++) {
      idx[i] = i;
      const off = i * DESC_DIM;
      let v = 0;
      for (let d = 0; d < DESC_DIM; d++) v += desc[off + d] * vectors[pv + d];
      values[i] = v;
    }
    idx.sort((a, b) => values[a] - values[b]);
    const denom = Math.max(1, count - 1);
    for (let r = 0; r < count; r++) {
      rank[idx[r] * projections + p] = r / denom;
    }
  }
  return { rank, vectors };
}

function computeDistanceTerms(blockIndex, tile, blockDesc, blockPatch, blockValuePatch, blockGradPatch, tileSet, options) {
  const bo = blockIndex * DESC_DIM;
  const to = tile * DESC_DIM;
  let dDesc = 0;
  for (let i = 0; i < DESC_DIM; i++) {
    const delta = blockDesc[bo + i] - tileSet.desc[to + i];
    dDesc += delta * delta;
  }

  const bp = blockIndex * tileSet.area;
  const tp = tile * tileSet.area;
  let dPatch = 0;
  let dValue = 0;
  let dValueEdge = 0;
  for (let i = 0; i < tileSet.area; i++) {
    const dk = blockPatch[bp + i] - tileSet.keys[tp + i];
    dPatch += dk * dk;
    const dv = blockValuePatch[bp + i] - tileSet.values[tp + i];
    dValue += dv * dv;
    dValueEdge += blockGradPatch[bp + i] * Math.abs(dv);
  }
  dPatch /= tileSet.area;
  dValue /= tileSet.area;
  dValueEdge /= tileSet.area;
  const tone = options.valueWeight * dValue + options.valueEdgeWeight * dValueEdge;
  return {
    total: options.descriptorWeight * dDesc + options.patchWeight * dPatch + tone,
    tone
  };
}

function orientationPenalty(
  tile,
  blockIndex,
  tileSet,
  blockDirX,
  blockDirY,
  blockDirectionalStrength,
  blockAdirectionality,
  blockEdgeStrength,
  options
) {
  const tileDirectionality = tileSet.meta.directionality[tile];
  const tileAdirectionality = tileSet.meta.adirectionality[tile];
  const regionStrength = blockDirectionalStrength[blockIndex];
  const regionAdir = blockAdirectionality[blockIndex];
  const tx = tileSet.meta.directionX[tile];
  const ty = tileSet.meta.directionY[tile];
  const gx = blockDirX[blockIndex];
  const gy = blockDirY[blockIndex];
  const tangentX = -gy;
  const tangentY = gx;
  const tangentAlign = Math.abs(tx * tangentX + ty * tangentY);
  const crossAlign = Math.abs(tx * gx + ty * gy);

  const alongPenalty = (1 - tangentAlign) * tileDirectionality * regionStrength;
  const crossingPenalty = crossAlign * tileDirectionality * regionStrength * blockEdgeStrength[blockIndex];
  const adirectionalPenalty = Math.max(0, tileDirectionality - regionAdir) * regionAdir;
  const adirectionalReward = tileAdirectionality * regionAdir;
  return (
    options.orientationAlongWeight * alongPenalty +
    options.noCrossEdgeWeight * crossingPenalty +
    options.adirectionalWeight * adirectionalPenalty -
    0.1 * adirectionalReward
  );
}

function coherencePenalty(assignment, bx, by, blocksX, tile, tileSet, boundaryLeft, boundaryTop, toneMismatch, options) {
  let penalty = 0;
  const bi = by * blocksX + bx;
  const toneGate = 1 - smooth01(options.coherenceToneLow, options.coherenceToneHigh, toneMismatch);
  if (toneGate <= 1e-5) return 0;
  if (bx > 0) {
    const leftTile = assignment[bi - 1];
    if (leftTile !== tile) {
      const boundaryEdge = boundaryLeft[bi];
      const gate = toneGate * (1 - smooth01(options.coherenceEdgeLow, options.coherenceEdgeHigh, boundaryEdge));
      if (gate > 1e-5) {
        if (tileSet.family[leftTile] !== tileSet.family[tile]) penalty += gate * options.familyLockWeight;
        const mismatch = POPCOUNT_8[tileSet.leftMask[tile] ^ tileSet.rightMask[leftTile]] / tileSet.size;
        penalty += gate * mismatch * options.edgeWeight;
      }
    }
  }
  if (by > 0) {
    const topTile = assignment[bi - blocksX];
    if (topTile !== tile) {
      const boundaryEdge = boundaryTop[bi];
      const gate = toneGate * (1 - smooth01(options.coherenceEdgeLow, options.coherenceEdgeHigh, boundaryEdge));
      if (gate > 1e-5) {
        if (tileSet.family[topTile] !== tileSet.family[tile]) penalty += gate * options.familyLockWeight;
        const mismatch = POPCOUNT_8[tileSet.topMask[tile] ^ tileSet.bottomMask[topTile]] / tileSet.size;
        penalty += gate * mismatch * options.edgeWeight;
      }
    }
  }
  return penalty * options.coherenceWeight;
}

function buildBoundaryEdgeStrengthMaps(outLeft, outTop, energy, width, height, blocksX, blocksY, blockSize) {
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const bi = by * blocksX + bx;
      outLeft[bi] = boundaryEdgeSample(energy, width, height, bx, by, -1, 0, blockSize);
      outTop[bi] = boundaryEdgeSample(energy, width, height, bx, by, 0, -1, blockSize);
    }
  }
}

function boundaryEdgeSample(energy, width, height, bx, by, dx, dy, blockSize) {
  const x0 = bx * blockSize;
  const y0 = by * blockSize;
  const x1 = Math.min(width, x0 + blockSize);
  const y1 = Math.min(height, y0 + blockSize);

  let sum = 0;
  let n = 0;

  if (dx !== 0) {
    const x = dx < 0 ? x0 : x1 - 1;
    if (x < 0 || x >= width) return 0;
    for (let y = y0; y < y1; y++) {
      sum += energy[y * width + x];
      n += 1;
    }
  } else {
    const y = dy < 0 ? y0 : y1 - 1;
    if (y < 0 || y >= height) return 0;
    for (let x = x0; x < x1; x++) {
      sum += energy[y * width + x];
      n += 1;
    }
  }

  return n > 0 ? sum / n : 0;
}

function projectionPenalty(tileRanks, blockRanks, tile, blockRankOffset, projections) {
  let sum = 0;
  const tOff = tile * projections;
  for (let p = 0; p < projections; p++) {
    sum += Math.abs(tileRanks[tOff + p] - blockRanks[blockRankOffset + p]);
  }
  return sum / projections;
}

function refinePhaseOffsets(assignment, blocksX, blocksY, blockKeyPatch, blockValuePatch, tileSet, options) {
  const blockCount = assignment.length;
  const phaseX = new Int16Array(blockCount);
  const phaseY = new Int16Array(blockCount);
  if (options.phasePasses <= 0) return { phaseX, phaseY };

  const candidates = buildPhaseCandidates(tileSet.size, options.phaseDiv);
  for (let pass = 0; pass < options.phasePasses; pass++) {
    for (let parity = 0; parity < 2; parity++) {
      for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
          if (((bx + by) & 1) !== parity) continue;
          const bi = by * blocksX + bx;
          const tile = assignment[bi];
          let bestPX = phaseX[bi];
          let bestPY = phaseY[bi];
          let bestScore = Infinity;
          for (let i = 0; i < candidates.length; i++) {
            const px = candidates[i].x;
            const py = candidates[i].y;
            const score = phaseScore(
              bi,
              bx,
              by,
              tile,
              px,
              py,
              assignment,
              phaseX,
              phaseY,
              blockKeyPatch,
              blockValuePatch,
              tileSet,
              blocksX,
              options
            );
            if (score < bestScore) {
              bestScore = score;
              bestPX = px;
              bestPY = py;
            }
          }
          phaseX[bi] = bestPX;
          phaseY[bi] = bestPY;
        }
      }
    }
  }
  return { phaseX, phaseY };
}

function phaseScore(
  blockIndex,
  bx,
  by,
  tile,
  phaseX,
  phaseY,
  assignment,
  phaseXArr,
  phaseYArr,
  blockKeyPatch,
  blockValuePatch,
  tileSet,
  blocksX,
  options
) {
  const size = tileSet.size;
  const area = tileSet.area;
  const bo = blockIndex * area;
  const to = tile * area;
  let keyError = 0;
  let valueError = 0;
  for (let y = 0; y < size; y++) {
    const sy = (y + phaseY) & (size - 1);
    for (let x = 0; x < size; x++) {
      const sx = (x + phaseX) & (size - 1);
      const si = sy * size + sx;
      const bi = y * size + x;
      const dk = blockKeyPatch[bo + bi] - tileSet.keys[to + si];
      const dv = blockValuePatch[bo + bi] - tileSet.values[to + si];
      keyError += dk * dk;
      valueError += dv * dv;
    }
  }
  keyError /= area;
  valueError /= area;

  let seam = 0;
  if (bx > 0) {
    const li = blockIndex - 1;
    seam += seamMismatch(
      tileSet,
      tile,
      phaseX,
      phaseY,
      assignment[li],
      phaseXArr[li],
      phaseYArr[li],
      'left'
    );
  }
  if (by > 0) {
    const ti = blockIndex - blocksX;
    seam += seamMismatch(
      tileSet,
      tile,
      phaseX,
      phaseY,
      assignment[ti],
      phaseXArr[ti],
      phaseYArr[ti],
      'top'
    );
  }

  return options.phaseKeyWeight * keyError + options.phaseValueWeight * valueError + options.phaseSeamWeight * seam;
}

function seamMismatch(tileSet, tileA, pxA, pyA, tileB, pxB, pyB, dir) {
  const size = tileSet.size;
  const area = tileSet.area;
  const aOff = tileA * area;
  const bOff = tileB * area;
  let mismatch = 0;

  if (dir === 'left') {
    for (let y = 0; y < size; y++) {
      const ay = (y + pyA) & (size - 1);
      const by = (y + pyB) & (size - 1);
      const aIdx = ay * size + ((0 + pxA) & (size - 1));
      const bIdx = by * size + ((size - 1 + pxB) & (size - 1));
      if (tileSet.values[aOff + aIdx] !== tileSet.values[bOff + bIdx]) mismatch += 1;
    }
  } else {
    for (let x = 0; x < size; x++) {
      const ax = (x + pxA) & (size - 1);
      const bx = (x + pxB) & (size - 1);
      const aIdx = ((0 + pyA) & (size - 1)) * size + ax;
      const bIdx = ((size - 1 + pyB) & (size - 1)) * size + bx;
      if (tileSet.values[aOff + aIdx] !== tileSet.values[bOff + bIdx]) mismatch += 1;
    }
  }
  return mismatch / size;
}

function buildPhaseCandidates(size, div) {
  const step = Math.max(1, Math.round(size / Math.max(1, div)));
  const out = [];
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      out.push({ x, y });
    }
  }
  if (out.length === 0 || (out[0].x !== 0 || out[0].y !== 0)) out.unshift({ x: 0, y: 0 });
  return out;
}

function renderScale(assignment, tileSet, width, height, phaseX, phaseY) {
  const out = new Float32Array(width * height);
  const size = tileSet.size;
  const blocksX = Math.ceil(width / size);
  const blocksY = Math.ceil(height / size);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const bi = by * blocksX + bx;
      const tile = assignment[bi];
      const to = tile * tileSet.area;
      const px = phaseX ? phaseX[bi] : 0;
      const py = phaseY ? phaseY[bi] : 0;
      for (let y = 0; y < size; y++) {
        const yy = by * size + y;
        if (yy >= height) break;
        const sy = (y + py) & (size - 1);
        for (let x = 0; x < size; x++) {
          const xx = bx * size + x;
          if (xx >= width) break;
          const sx = (x + px) & (size - 1);
          out[yy * width + xx] = tileSet.values[to + sy * size + sx];
        }
      }
    }
  }
  return out;
}

function renderScaleBinary(assignment, tileSet, width, height, phaseX, phaseY) {
  const out = new Uint8Array(width * height);
  const size = tileSet.size;
  const blocksX = Math.ceil(width / size);
  const blocksY = Math.ceil(height / size);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const bi = by * blocksX + bx;
      const tile = assignment[bi];
      const to = tile * tileSet.area;
      const px = phaseX ? phaseX[bi] : 0;
      const py = phaseY ? phaseY[bi] : 0;
      for (let y = 0; y < size; y++) {
        const yy = by * size + y;
        if (yy >= height) break;
        const sy = (y + py) & (size - 1);
        for (let x = 0; x < size; x++) {
          const xx = bx * size + x;
          if (xx >= width) break;
          const sx = (x + px) & (size - 1);
          out[yy * width + xx] = tileSet.values[to + sy * size + sx];
        }
      }
    }
  }
  return out;
}

function buildParentFamilies(coarseAssign, coarseBlocksX, coarseBlocksY, coarseTileSet, transfer, width, height, fineSize) {
  const fineBlocksX = Math.ceil(width / fineSize);
  const fineBlocksY = Math.ceil(height / fineSize);
  const out = new Int16Array(fineBlocksX * fineBlocksY);
  out.fill(-1);
  for (let fy = 0; fy < fineBlocksY; fy++) {
    for (let fx = 0; fx < fineBlocksX; fx++) {
      const cx = clampInt((fx * fineSize) >> 3, 0, coarseBlocksX - 1);
      const cy = clampInt((fy * fineSize) >> 3, 0, coarseBlocksY - 1);
      const cIndex = cy * coarseBlocksX + cx;
      const coarseTile = coarseAssign[cIndex];
      const coarseFamily = coarseTileSet.family[coarseTile];
      out[fy * fineBlocksX + fx] = transfer[coarseFamily];
    }
  }
  return out;
}

function sampleBlockPatch(out, blockIndex, image, width, height, bx, by, size) {
  const off = blockIndex * size * size;
  for (let y = 0; y < size; y++) {
    const yy = clampInt(by * size + y, 0, height - 1);
    for (let x = 0; x < size; x++) {
      const xx = clampInt(bx * size + x, 0, width - 1);
      out[off + y * size + x] = image[yy * width + xx];
    }
  }
}

function computeBlockDescriptor(
  out,
  blockIndex,
  patches,
  area,
  size,
  analysis,
  width,
  height,
  bx,
  by,
  blockDirX,
  blockDirY,
  blockDirectionalStrength,
  blockAdirectionality,
  blockEdgeStrength
) {
  const off = blockIndex * area;
  let mean = 0;
  for (let i = 0; i < area; i++) mean += patches[off + i];
  mean /= area;
  let variance = 0;
  for (let i = 0; i < area; i++) {
    const d = patches[off + i] - mean;
    variance += d * d;
  }
  variance /= area;

  let vx = 0;
  let vy = 0;
  let vWeight = 0;
  let edge = 0;
  let canny = 0;
  for (let y = 0; y < size; y++) {
    const yy = clampInt(by * size + y, 0, height - 1);
    for (let x = 0; x < size; x++) {
      const xx = clampInt(bx * size + x, 0, width - 1);
      const idx = yy * width + xx;
      const strength = analysis.directionStrength[idx];
      vx += analysis.directionX[idx] * strength;
      vy += analysis.directionY[idx] * strength;
      vWeight += strength;
      edge += analysis.energy[idx];
      canny += analysis.cannyEdges[idx];
    }
  }
  edge = (edge / area) * 0.6 + (canny / area) * 0.4;
  const vn = Math.hypot(vx, vy) || 1;
  const dirX = vx / vn;
  const dirY = vy / vn;
  const directionalStrength = clamp01(vWeight / area);
  const dir = Math.atan2(dirY, dirX) / Math.PI;
  const anis = directionalStrength;
  blockDirX[blockIndex] = dirX;
  blockDirY[blockIndex] = dirY;
  blockDirectionalStrength[blockIndex] = directionalStrength;
  blockAdirectionality[blockIndex] = 1 - directionalStrength;
  blockEdgeStrength[blockIndex] = edge;

  let spans = 0;
  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      const a = patches[off + y * size + x] > 0.5;
      const b = patches[off + y * size + x - 1] > 0.5;
      if (a === b) run += 1;
      else {
        spans += run;
        run = 1;
      }
    }
    spans += run;
  }
  spans /= (size * size);

  const o = blockIndex * DESC_DIM;
  out[o] = mean;
  out[o + 1] = variance;
  out[o + 2] = edge;
  out[o + 3] = dir;
  out[o + 4] = anis;
  out[o + 5] = spans;
  out[o + 6] = mean * (1 - mean);
}

function analyzeEnergyLandscape(luma, width, height, options) {
  const gradients0 = computeGradients(luma, width, height);
  const blur1 = boxBlur(luma, width, height, 1);
  const blur2 = boxBlur(luma, width, height, 2);
  const gradients1 = computeGradients(blur1, width, height);
  const gradients2 = computeGradients(blur2, width, height);
  const canny = computeCannyEdges(blur1, width, height, options.cannyLowThreshold, options.cannyHighThreshold);

  const count = width * height;
  const energy = new Float32Array(count);
  const edgeForCoherence = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const contrast = Math.abs(luma[i] - blur2[i]);
    energy[i] = clamp01(0.44 * gradients0.grad[i] + 0.24 * gradients1.grad[i] + 0.1 * gradients2.grad[i] + 0.08 * contrast + 0.14 * canny.edges[i]);
    edgeForCoherence[i] = Math.max(energy[i], canny.edges[i]);
  }

  if (options.energyDiffusionPasses > 0) {
    diffuseEnergy(energy, width, height, options.energyDiffusionPasses);
  }

  const direction = computeDirectionFieldFromTensor(gradients0, gradients1, gradients2, energy, width, height);
  if (options.directionSmoothRadius > 0) {
    smoothDirectionField(direction, width, height, options.directionSmoothRadius);
  }

  return {
    gradients: gradients0,
    energy,
    cannyEdges: canny.edges,
    edgeForCoherence,
    directionX: direction.x,
    directionY: direction.y,
    directionStrength: direction.strength,
    adirectionality: direction.adirectionality
  };
}

function computeCannyEdges(luma, width, height, lowThreshold, highThreshold) {
  const g = computeGradients(luma, width, height);
  const nms = nonMaxSuppression(g.gx, g.gy, g.grad, width, height);
  const edges = hysteresisThreshold(nms, width, height, lowThreshold, highThreshold);
  return { edges, gx: g.gx, gy: g.gy };
}

function nonMaxSuppression(gx, gy, grad, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const g = grad[idx];
      if (g <= 1e-8) continue;
      const angle = (Math.atan2(gy[idx], gx[idx]) * 180) / Math.PI;
      const dir = quantizedDirection4(angle);
      let g0 = 0;
      let g1 = 0;
      if (dir === 0) {
        g0 = grad[idx - 1];
        g1 = grad[idx + 1];
      } else if (dir === 1) {
        g0 = grad[idx - width + 1];
        g1 = grad[idx + width - 1];
      } else if (dir === 2) {
        g0 = grad[idx - width];
        g1 = grad[idx + width];
      } else {
        g0 = grad[idx - width - 1];
        g1 = grad[idx + width + 1];
      }
      if (g >= g0 && g >= g1) out[idx] = g;
    }
  }
  return out;
}

function hysteresisThreshold(nms, width, height, lowThreshold, highThreshold) {
  const count = width * height;
  const out = new Float32Array(count);
  const state = new Uint8Array(count);
  const queue = new Int32Array(count);
  let q0 = 0;
  let q1 = 0;

  for (let i = 0; i < count; i++) {
    if (nms[i] >= highThreshold) {
      state[i] = 2;
      out[i] = nms[i];
      queue[q1++] = i;
    } else if (nms[i] >= lowThreshold) {
      state[i] = 1;
    }
  }

  while (q0 < q1) {
    const idx = queue[q0++];
    const y = (idx / width) | 0;
    const x = idx - y * width;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const ni = yy * width + xx;
        if (state[ni] !== 1) continue;
        state[ni] = 2;
        out[ni] = nms[ni];
        queue[q1++] = ni;
      }
    }
  }

  let max = 0;
  for (let i = 0; i < count; i++) if (out[i] > max) max = out[i];
  if (max > 1e-8) {
    const inv = 1 / max;
    for (let i = 0; i < count; i++) out[i] *= inv;
  }
  return out;
}

function quantizedDirection4(angleDegrees) {
  let a = angleDegrees;
  while (a < 0) a += 180;
  while (a >= 180) a -= 180;
  if (a < 22.5 || a >= 157.5) return 0;
  if (a < 67.5) return 1;
  if (a < 112.5) return 2;
  return 3;
}

function computeDirectionFieldFromTensor(gradients0, gradients1, gradients2, energy, width, height) {
  const count = width * height;
  const jxx = new Float32Array(count);
  const jxy = new Float32Array(count);
  const jyy = new Float32Array(count);
  const directionX = new Float32Array(count);
  const directionY = new Float32Array(count);
  const strength = new Float32Array(count);
  const adirectionality = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const gx = gradients0.gx[i] * 0.6 + gradients1.gx[i] * 0.3 + gradients2.gx[i] * 0.1;
    const gy = gradients0.gy[i] * 0.6 + gradients1.gy[i] * 0.3 + gradients2.gy[i] * 0.1;
    jxx[i] = gx * gx;
    jxy[i] = gx * gy;
    jyy[i] = gy * gy;
  }

  const sjxx = boxBlur(jxx, width, height, 1);
  const sjxy = boxBlur(jxy, width, height, 1);
  const sjyy = boxBlur(jyy, width, height, 1);

  for (let i = 0; i < count; i++) {
    const a = sjxx[i];
    const b = sjxy[i];
    const c = sjyy[i];
    const trace = a + c;
    const disc = Math.max(0, (a - c) * (a - c) + 4 * b * b);
    const root = Math.sqrt(disc);
    const l1 = 0.5 * (trace + root);
    const l2 = 0.5 * (trace - root);

    const anis = trace > 1e-8 ? (l1 - l2) / (trace + 1e-8) : 0;

    let vx = 1;
    let vy = 0;
    if (Math.abs(b) > 1e-8 || Math.abs(l1 - a) > 1e-8) {
      vx = b;
      vy = l1 - a;
    }
    const norm = Math.hypot(vx, vy) || 1;
    directionX[i] = vx / norm;
    directionY[i] = vy / norm;
    const s = clamp01(anis * (0.3 + 0.7 * energy[i]));
    strength[i] = s;
    adirectionality[i] = 1 - s;
  }

  return { x: directionX, y: directionY, strength, adirectionality };
}

function diffuseEnergy(energy, width, height, passes) {
  const scratch = new Float32Array(energy.length);
  for (let pass = 0; pass < passes; pass++) {
    scratch.set(energy);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const center = energy[idx];
        const n0 = energy[idx - 1];
        const n1 = energy[idx + 1];
        const n2 = energy[idx - width];
        const n3 = energy[idx + width];
        const neighborMean = (n0 + n1 + n2 + n3) * 0.25;
        const delta = (neighborMean - center) * 0.35;
        scratch[idx] = clamp01(center + delta);
      }
    }
    energy.set(scratch);
  }
}

function computeDirectionFieldFromEnergy(luma, energy, width, height, options) {
  const count = width * height;
  const directionX = new Float32Array(count);
  const directionY = new Float32Array(count);
  const strength = new Float32Array(count);
  const adirectionality = new Float32Array(count);

  const prev = new Float32Array(width);
  const curr = new Float32Array(width);
  const jump = new Int8Array(count);

  for (let x = 0; x < width; x++) prev[x] = energy[x];
  for (let y = 1; y < height; y++) {
    const row = y * width;
    const prevRow = (y - 1) * width;
    for (let x = 0; x < width; x++) {
      let best = Infinity;
      let second = Infinity;
      let bestK = 0;
      for (let k = -1; k <= 1; k++) {
        const px = clampInt(x + k, 0, width - 1);
        const cu = forwardCost(luma, width, height, y, x, k);
        const dirCost = options.dpDirectionPenalty * (k === 0 ? 0 : 1.4142);
        const fwdCost = options.dpForwardPenalty * cu;
        const candidate = prev[px] + dirCost + fwdCost;
        if (candidate < best) {
          second = best;
          best = candidate;
          bestK = k;
        } else if (candidate < second) {
          second = candidate;
        }
      }
      curr[x] = energy[row + x] + best;
      jump[row + x] = bestK;
      const rawConf = clamp01((second - best) / (Math.abs(best) + 0.25));
      const conf = rawConf * clamp01(energy[row + x] * 2.5);
      const vx = bestK;
      const vy = 1;
      const n = Math.hypot(vx, vy) || 1;
      directionX[row + x] = vx / n;
      directionY[row + x] = vy / n;
      const s = clamp01(energy[row + x] * 0.65 + conf * 0.35);
      strength[row + x] = s;
      adirectionality[row + x] = 1 - s;
    }
    prev.set(curr);
  }

  if (height > 1) {
    for (let x = 0; x < width; x++) {
      directionX[x] = directionX[width + x] || 0;
      directionY[x] = directionY[width + x] || 1;
      strength[x] = strength[width + x] || 0;
      adirectionality[x] = 1 - strength[x];
    }
  } else {
    for (let x = 0; x < width; x++) {
      directionX[x] = 0;
      directionY[x] = 1;
      strength[x] = 0;
      adirectionality[x] = 1;
    }
  }

  return { x: directionX, y: directionY, strength, adirectionality, jump };
}

function forwardCost(luma, width, height, y, x, k) {
  const up = clampInt(y - 1, 0, height - 1);
  const left = clampInt(x - 1, 0, width - 1);
  const right = clampInt(x + 1, 0, width - 1);
  const centerCost = Math.abs(luma[up * width + right] - luma[up * width + left]);
  if (k < 0) {
    return centerCost + Math.abs(luma[up * width + x] - luma[y * width + left]);
  }
  if (k > 0) {
    return centerCost + Math.abs(luma[up * width + x] - luma[y * width + right]);
  }
  return centerCost;
}

function smoothDirectionField(direction, width, height, radius) {
  const count = width * height;
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const sw = new Float32Array(count);
  const area = (radius * 2 + 1) * (radius * 2 + 1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let vx = 0;
      let vy = 0;
      let wsum = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const yy = clampInt(y + ky, 0, height - 1);
        for (let kx = -radius; kx <= radius; kx++) {
          const xx = clampInt(x + kx, 0, width - 1);
          const idx = yy * width + xx;
          const w = direction.strength[idx];
          vx += direction.x[idx] * w;
          vy += direction.y[idx] * w;
          wsum += w;
        }
      }
      const idx = y * width + x;
      const n = Math.hypot(vx, vy) || 1;
      sx[idx] = vx / n;
      sy[idx] = vy / n;
      sw[idx] = clamp01((wsum / area) * 0.85 + direction.strength[idx] * 0.15);
    }
  }

  direction.x.set(sx);
  direction.y.set(sy);
  direction.strength.set(sw);
  for (let i = 0; i < count; i++) direction.adirectionality[i] = 1 - sw[i];
}

function applyLienSortCleanup(binary, gx, gy, width, height, passes) {
  const scratch = new Uint8Array(binary.length);
  for (let pass = 0; pass < passes; pass++) {
    scratch.set(binary);
    
    // Phase 1: Remove extra pixels (those with both horizontal and vertical neighbors)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (binary[idx] !== 1) continue;
        
        const hasHoriz = binary[idx - 1] === 1 || binary[idx + 1] === 1;
        const hasVert = binary[idx - width] === 1 || binary[idx + width] === 1;
        
        // Extra pixel: has both horizontal and vertical neighbors
        if (hasHoriz && hasVert) {
          // Check if removing would disconnect
          const n = countNeighbors(binary, width, height, x, y, 1);
          if (n > 2) {
            // Prefer gradient direction for removal
            const ax = Math.abs(gx[idx]);
            const ay = Math.abs(gy[idx]);
            // Remove if gradient suggests thickness perpendicular to edge
            if ((ax > ay && hasVert) || (ay >= ax && hasHoriz)) {
              scratch[idx] = 0;
            }
          }
        }
      }
    }
    binary.set(scratch);
    
    // Phase 2: Slope order enforcement and pattern regularization
    // Process horizontal runs
    for (let y = 1; y < height - 1; y++) {
      let runStart = -1;
      let prevRunLen = 0;
      
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const isInk = binary[idx] === 1;
        const isConnected = isInk && (binary[idx - width] === 1 || binary[idx + width] === 1);
        
        if (isConnected) {
          if (runStart < 0) runStart = x;
        } else if (runStart >= 0) {
          // End of run
          const runLen = x - runStart;
          
          // Check for repeating pattern violations
          if (prevRunLen > 0 && runLen > 0) {
            const expected = getNextPatternValue(prevRunLen);
            if (Math.abs(runLen - expected) > 1) {
              // Try to adjust to match pattern
              const midX = runStart + Math.floor(runLen / 2);
              if (runLen > expected && midX < width - 1) {
                // Remove middle pixel if safe
                if (canRemovePixel(binary, scratch, width, height, midX, y)) {
                  scratch[midX + y * width] = 0;
                }
              } else if (runLen < expected && midX < width - 1) {
                // Add pixel if gradient suggests it
                const midIdx = midX + y * width;
                const grad = Math.hypot(gx[midIdx], gy[midIdx]);
                if (grad > 0.1 && binary[midIdx] === 0) {
                  scratch[midIdx] = 1;
                }
              }
            }
          }
          
          prevRunLen = runLen;
          runStart = -1;
        }
      }
    }
    
    // Phase 3: Remove isolated pixels (blips)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (binary[idx] === 1) {
          const n = countNeighbors(binary, width, height, x, y, 1);
          if (n === 0) scratch[idx] = 0;
        }
      }
    }
    
    binary.set(scratch);
  }
}

function countNeighbors(binary, width, height, x, y, value) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
        if (binary[ny * width + nx] === value) count++;
      }
    }
  }
  return count;
}

function canRemovePixel(binary, scratch, width, height, x, y) {
  const idx = y * width + x;
  if (binary[idx] !== 1) return false;
  
  // Count 4-connected neighbors
  let neighbors = 0;
  if (binary[idx - 1] === 1) neighbors++;
  if (binary[idx + 1] === 1) neighbors++;
  if (binary[idx - width] === 1) neighbors++;
  if (binary[idx + width] === 1) neighbors++;
  
  // Can remove if more than 2 neighbors (won't disconnect)
  return neighbors > 2;
}

function getNextPatternValue(prev) {
  // Common pixel art patterns: {1,1,2}, {1,2,1,2}, {1,1,1,2}
  // For now, prefer repeating small values
  const patterns = [1, 1, 2, 1, 2, 2, 1, 1, 1, 2];
  const idx = patterns.indexOf(prev);
  if (idx >= 0 && idx < patterns.length - 1) {
    return patterns[idx + 1];
  }
  return prev;
}

function applyMomentumLineClosure(binary, gx, gy, cannyEdges, width, height, options) {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];
  const scratch = new Uint8Array(binary.length);
  const edgeGate = options.momentumEdgeGate;
  const alignWeight = options.momentumAlignWeight;
  const threshold = options.momentumScoreThreshold;
  const allowGap2 = options.momentumGap > 1;

  for (let pass = 0; pass < options.momentumClosePasses; pass++) {
    scratch.set(binary);
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const idx = y * width + x;
        const edge = cannyEdges[idx];
        if (edge < edgeGate) continue;
        const gradMag = Math.hypot(gx[idx], gy[idx]);
        if (gradMag < 1e-8) continue;
        const center = binary[idx];
        let bestColor = center;
        let bestScore = 0;

        for (let d = 0; d < dirs.length; d++) {
          const dx = dirs[d][0];
          const dy = dirs[d][1];
          const dirNorm = 1 / Math.hypot(dx, dy);
          const dirX = dx * dirNorm;
          const dirY = dy * dirNorm;
          const tanX = -gy[idx] / gradMag;
          const tanY = gx[idx] / gradMag;
          const align = Math.abs(tanX * dirX + tanY * dirY);

          for (let target = 0; target <= 1; target++) {
            if (target === center) continue;
            const sN1 = sampleBinary(binary, width, height, x - dx, y - dy);
            const sP1 = sampleBinary(binary, width, height, x + dx, y + dy);
            if (sN1 === target && sP1 === target) {
              const sN2 = sampleBinary(binary, width, height, x - 2 * dx, y - 2 * dy);
              const sP2 = sampleBinary(binary, width, height, x + 2 * dx, y + 2 * dy);
              const perp = perpendicularCount(binary, width, height, x, y, dx, dy, target);
              const support = 2 + (sN2 === target ? 1 : 0) + (sP2 === target ? 1 : 0) - 0.85 * perp;
              const score = support + alignWeight * align + 1.15 * edge;
              if (score > bestScore) {
                bestScore = score;
                bestColor = target;
              }
            }

            if (allowGap2) {
              const sN2 = sampleBinary(binary, width, height, x - 2 * dx, y - 2 * dy);
              const sP2 = sampleBinary(binary, width, height, x + 2 * dx, y + 2 * dy);
              if (sN2 === target && sP2 === target) {
                const sN1b = sampleBinary(binary, width, height, x - dx, y - dy);
                const sP1b = sampleBinary(binary, width, height, x + dx, y + dy);
                const miss = (sN1b !== target ? 1 : 0) + (sP1b !== target ? 1 : 0);
                if (miss >= 1) {
                  const perp = perpendicularCount(binary, width, height, x, y, dx, dy, target);
                  const support = 1.7 + (sN1b === target ? 0.7 : 0) + (sP1b === target ? 0.7 : 0) - 0.8 * perp;
                  const score = support + alignWeight * align + 0.9 * edge;
                  if (score > bestScore) {
                    bestScore = score;
                    bestColor = target;
                  }
                }
              }
            }
          }
        }

        if (bestColor !== center && bestScore >= threshold) {
          scratch[idx] = bestColor;
        }
      }
    }
    binary.set(scratch);
  }
}

function sampleBinary(binary, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return -1;
  return binary[y * width + x];
}

function perpendicularCount(binary, width, height, x, y, dx, dy, target) {
  const px = -dy;
  const py = dx;
  let count = 0;
  if (sampleBinary(binary, width, height, x + px, y + py) === target) count += 1;
  if (sampleBinary(binary, width, height, x - px, y - py) === target) count += 1;
  return count;
}

function applyTufteInkPass(binary, luma, grad, width, height, options, rng) {
  const parker = createProgressiveMask(options.parkerMaskSize, 7331, options.parkerCandidates);
  const parkerAlt = createProgressiveMask(options.parkerMaskSize, 1879, options.parkerCandidates + 2);

  for (let pass = 0; pass < options.tuftePasses; pass++) {
    const tone = toFloat(binary);
    const smoothTone = boxBlur(tone, width, height, 1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const err = smoothTone[idx] - luma[idx];
        const edgeKeep = grad[idx];
        const darkFlat = luma[idx] < options.tufteDarkLuma && edgeKeep < options.tufteDarkGrad;
        const p = sampleParkerThreshold(x, y, parker, parkerAlt, options.parkerMaskSize, options.parkerPeriod);
        if (binary[idx] === 0) {
          let forceWhite = (-err) * options.tufteStrength - edgeKeep * 0.25;
          if (darkFlat) forceWhite *= options.tufteDarkWhiteSuppress;
          const whiteThreshold = (darkFlat ? 0.2 : 0.0) + p * 0.22 + rng() * 0.05;
          if (forceWhite > whiteThreshold) binary[idx] = 1;
        } else {
          let allowDark = err * (options.tufteStrength * 0.65);
          if (darkFlat) allowDark += 0.08;
          if (allowDark > 0.15 + p * 0.3 + rng() * 0.08) binary[idx] = 0;
        }
      }
    }
  }
}

function buildParkerPrefitTarget(luma, width, height, options) {
  const strength = options.prefitParkerStrength;
  if (strength <= 1e-6) return luma;
  const out = new Float32Array(luma.length);
  const size = options.parkerMaskSize;
  const period = options.prefitParkerPeriod;
  const maskA = createProgressiveMask(size, 4919, options.parkerCandidates);
  const maskB = createProgressiveMask(size, 9029, options.parkerCandidates + 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = sampleParkerThreshold(x, y, maskA, maskB, size, period);
      const parkerBinary = luma[i] >= t ? 1 : 0;
      out[i] = clamp01(luma[i] * (1 - strength) + parkerBinary * strength);
    }
  }
  return out;
}

function toFloat(binary) {
  const out = new Float32Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary[i] ? 1 : 0;
  return out;
}

function makeProjectionVectors(projections, dim) {
  const out = new Float32Array(projections * dim);
  for (let p = 0; p < projections; p++) {
    let sum = 0;
    for (let d = 0; d < dim; d++) {
      const v = Math.sin((p + 1) * (d + 3) * 12.9898) + Math.cos((p + 5) * (d + 1) * 4.1414);
      out[p * dim + d] = v;
      sum += v * v;
    }
    const norm = 1 / Math.sqrt(Math.max(1e-8, sum));
    for (let d = 0; d < dim; d++) out[p * dim + d] *= norm;
  }
  return out;
}

function quantize(value, bins) {
  const v = clamp01(value);
  const q = (v * bins) | 0;
  return q >= bins ? bins - 1 : q;
}

function smooth01(edge0, edge1, x) {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / Math.max(1e-8, edge1 - edge0);
  return t * t * (3 - 2 * t);
}

function exportTileMetadata(tileSet) {
  const out = new Array(tileSet.count);
  for (let i = 0; i < tileSet.count; i++) {
    out[i] = {
      index: i,
      name: tileSet.meta.name[i],
      family: tileSet.familyNames[tileSet.family[i]],
      directionX: Number(tileSet.meta.directionX[i].toFixed(6)),
      directionY: Number(tileSet.meta.directionY[i].toFixed(6)),
      directionality: Number(tileSet.meta.directionality[i].toFixed(6)),
      adirectionality: Number(tileSet.meta.adirectionality[i].toFixed(6)),
      ink: Number(tileSet.ink[i].toFixed(6))
    };
  }
  return out;
}

function buildPopcount8() {
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let v = i;
    let c = 0;
    while (v) {
      c += v & 1;
      v >>= 1;
    }
    out[i] = c;
  }
  return out;
}

function clampInt(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

module.exports = {
  runFastTileFit,
  __private: {
    analyzeEnergyLandscape,
    orientationPenalty,
    coherencePenalty,
    forwardCost,
    computeDirectionFieldFromEnergy
  }
};

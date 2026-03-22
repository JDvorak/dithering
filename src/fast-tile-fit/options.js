const DEFAULTS = {
  seed: 9137,
  keyBlurRadius: 1,
  coarseBlurRadius: 2,
  prefitParkerStrength: 0,
  prefitParkerPeriod: 1,
  tileRotationSteps4: 12,
  tileRotationSteps8: 16,
  tileLienRepairPasses: 1,
  fineGuideBlend: 0.35,
  searchCandidates: 20,
  coarseIterations: 2,
  fineIterations: 2,
  continuityPasses: 1,
  continuityCandidates: 8,
  phaseDiv: 4,
  phasePasses: 1,
  phaseKeyWeight: 0.55,
  phaseValueWeight: 1.0,
  phaseSeamWeight: 0.35,
  completenessAlpha: 0.04,
  completenessGlobalBlend: 0.2,
  descriptorWeight: 1.0,
  patchWeight: 0.75,
  valueWeight: 0.55,
  valueEdgeWeight: 0.45,
  swdWeight: 0.22,
  swdProjections: 8,
  coherenceWeight: 0.22,
  coherenceEdgeLow: 0.06,
  coherenceEdgeHigh: 0.24,
  coherenceToneLow: 1.05,
  coherenceToneHigh: 1.6,
  edgeWeight: 0.4,
  familyLockWeight: 0.3,
  parentFamilyWeight: 0.55,
  orientationAlongWeight: 1.0,
  adirectionalWeight: 0.35,
  noCrossEdgeWeight: 1.1,
  momentumClosePasses: 1,
  momentumGap: 1,
  momentumEdgeGate: 0.035,
  momentumAlignWeight: 0.9,
  momentumScoreThreshold: 2.7,
  cannyLowThreshold: 0.08,
  cannyHighThreshold: 0.2,
  inkPenalty: 0.12,
  tufteStrength: 0.5,
  tuftePasses: 2,
  tufteDarkLuma: 0.32,
  tufteDarkGrad: 0.12,
  tufteDarkWhiteSuppress: 0.28,
  lienSortPasses: 1,
  energyDiffusionPasses: 2,
  dpDirectionPenalty: 0.16,
  dpForwardPenalty: 0.35,
  directionSmoothRadius: 1,
  parkerMaskSize: 64,
  parkerCandidates: 16,
  parkerPeriod: 1
};

function parseFastTileFitOptions(args) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--seed=')) options.seed = parseInt(arg.slice(7), 10);
    else if (arg.startsWith('--key-blur=')) options.keyBlurRadius = parseInt(arg.slice(11), 10);
    else if (arg.startsWith('--coarse-blur=')) options.coarseBlurRadius = parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--prefit-parker=')) options.prefitParkerStrength = parseFloat(arg.slice(16));
    else if (arg.startsWith('--prefit-period=')) options.prefitParkerPeriod = parseFloat(arg.slice(16));
    else if (arg.startsWith('--tile-rot4=')) options.tileRotationSteps4 = parseInt(arg.slice(12), 10);
    else if (arg.startsWith('--tile-rot8=')) options.tileRotationSteps8 = parseInt(arg.slice(12), 10);
    else if (arg.startsWith('--tile-lien-repair=')) options.tileLienRepairPasses = parseInt(arg.slice(19), 10);
    else if (arg.startsWith('--fine-guide=')) options.fineGuideBlend = parseFloat(arg.slice(13));
    else if (arg.startsWith('--search=')) options.searchCandidates = parseInt(arg.slice(9), 10);
    else if (arg.startsWith('--coarse-iter=')) options.coarseIterations = parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--fine-iter=')) options.fineIterations = parseInt(arg.slice(12), 10);
    else if (arg.startsWith('--continuity=')) options.continuityPasses = parseInt(arg.slice(13), 10);
    else if (arg.startsWith('--continuity-candidates=')) options.continuityCandidates = parseInt(arg.slice(24), 10);
    else if (arg.startsWith('--phase-div=')) options.phaseDiv = parseInt(arg.slice(12), 10);
    else if (arg.startsWith('--phase-passes=')) options.phasePasses = parseInt(arg.slice(15), 10);
    else if (arg.startsWith('--phase-key-w=')) options.phaseKeyWeight = parseFloat(arg.slice(14));
    else if (arg.startsWith('--phase-value-w=')) options.phaseValueWeight = parseFloat(arg.slice(16));
    else if (arg.startsWith('--phase-seam-w=')) options.phaseSeamWeight = parseFloat(arg.slice(15));
    else if (arg.startsWith('--alpha=')) options.completenessAlpha = parseFloat(arg.slice(8));
    else if (arg.startsWith('--alpha-global=')) options.completenessGlobalBlend = parseFloat(arg.slice(15));
    else if (arg.startsWith('--descriptor-w=')) options.descriptorWeight = parseFloat(arg.slice(15));
    else if (arg.startsWith('--patch-w=')) options.patchWeight = parseFloat(arg.slice(10));
    else if (arg.startsWith('--value-w=')) options.valueWeight = parseFloat(arg.slice(10));
    else if (arg.startsWith('--value-edge-w=')) options.valueEdgeWeight = parseFloat(arg.slice(15));
    else if (arg.startsWith('--swd-w=')) options.swdWeight = parseFloat(arg.slice(8));
    else if (arg.startsWith('--swd-proj=')) options.swdProjections = parseInt(arg.slice(11), 10);
    else if (arg.startsWith('--coherence=')) options.coherenceWeight = parseFloat(arg.slice(12));
    else if (arg.startsWith('--coherence-edge-low=')) options.coherenceEdgeLow = parseFloat(arg.slice(21));
    else if (arg.startsWith('--coherence-edge-high=')) options.coherenceEdgeHigh = parseFloat(arg.slice(22));
    else if (arg.startsWith('--coherence-tone-low=')) options.coherenceToneLow = parseFloat(arg.slice(21));
    else if (arg.startsWith('--coherence-tone-high=')) options.coherenceToneHigh = parseFloat(arg.slice(22));
    else if (arg.startsWith('--edge=')) options.edgeWeight = parseFloat(arg.slice(7));
    else if (arg.startsWith('--family=')) options.familyLockWeight = parseFloat(arg.slice(9));
    else if (arg.startsWith('--parent-family=')) options.parentFamilyWeight = parseFloat(arg.slice(16));
    else if (arg.startsWith('--orient=')) options.orientationAlongWeight = parseFloat(arg.slice(9));
    else if (arg.startsWith('--adirectional=')) options.adirectionalWeight = parseFloat(arg.slice(15));
    else if (arg.startsWith('--no-cross=')) options.noCrossEdgeWeight = parseFloat(arg.slice(11));
    else if (arg.startsWith('--momentum-close=')) options.momentumClosePasses = parseInt(arg.slice(17), 10);
    else if (arg.startsWith('--momentum-gap=')) options.momentumGap = parseInt(arg.slice(15), 10);
    else if (arg.startsWith('--momentum-edge=')) options.momentumEdgeGate = parseFloat(arg.slice(16));
    else if (arg.startsWith('--momentum-align=')) options.momentumAlignWeight = parseFloat(arg.slice(17));
    else if (arg.startsWith('--momentum-threshold=')) options.momentumScoreThreshold = parseFloat(arg.slice(21));
    else if (arg.startsWith('--canny-low=')) options.cannyLowThreshold = parseFloat(arg.slice(12));
    else if (arg.startsWith('--canny-high=')) options.cannyHighThreshold = parseFloat(arg.slice(13));
    else if (arg.startsWith('--ink=')) options.inkPenalty = parseFloat(arg.slice(6));
    else if (arg.startsWith('--tufte=')) options.tufteStrength = parseFloat(arg.slice(8));
    else if (arg.startsWith('--tufte-passes=')) options.tuftePasses = parseInt(arg.slice(15), 10);
    else if (arg.startsWith('--tufte-dark-luma=')) options.tufteDarkLuma = parseFloat(arg.slice(18));
    else if (arg.startsWith('--tufte-dark-grad=')) options.tufteDarkGrad = parseFloat(arg.slice(18));
    else if (arg.startsWith('--tufte-dark-suppress=')) options.tufteDarkWhiteSuppress = parseFloat(arg.slice(23));
    else if (arg.startsWith('--liensort-passes=')) options.lienSortPasses = parseInt(arg.slice(17), 10);
    else if (arg.startsWith('--energy-diffuse=')) options.energyDiffusionPasses = parseInt(arg.slice(17), 10);
    else if (arg.startsWith('--dp-dir=')) options.dpDirectionPenalty = parseFloat(arg.slice(9));
    else if (arg.startsWith('--dp-forward=')) options.dpForwardPenalty = parseFloat(arg.slice(13));
    else if (arg.startsWith('--dir-smooth=')) options.directionSmoothRadius = parseInt(arg.slice(13), 10);
    else if (arg.startsWith('--parker-size=')) options.parkerMaskSize = parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--parker-candidates=')) options.parkerCandidates = parseInt(arg.slice(20), 10);
    else if (arg.startsWith('--parker-period=')) options.parkerPeriod = parseFloat(arg.slice(16));
  }
  return sanitize(options);
}

function sanitize(options) {
  const out = { ...options };
  out.seed = finiteInt(out.seed, DEFAULTS.seed);
  out.keyBlurRadius = clampInt(finiteInt(out.keyBlurRadius, DEFAULTS.keyBlurRadius), 0, 4);
  out.coarseBlurRadius = clampInt(finiteInt(out.coarseBlurRadius, DEFAULTS.coarseBlurRadius), 0, 6);
  out.prefitParkerStrength = clamp(finiteNumber(out.prefitParkerStrength, DEFAULTS.prefitParkerStrength), 0, 1);
  out.prefitParkerPeriod = clamp(finiteNumber(out.prefitParkerPeriod, DEFAULTS.prefitParkerPeriod), 0.5, 4);
  out.tileRotationSteps4 = clampInt(finiteInt(out.tileRotationSteps4, DEFAULTS.tileRotationSteps4), 4, 32);
  out.tileRotationSteps8 = clampInt(finiteInt(out.tileRotationSteps8, DEFAULTS.tileRotationSteps8), 4, 32);
  out.tileLienRepairPasses = clampInt(finiteInt(out.tileLienRepairPasses, DEFAULTS.tileLienRepairPasses), 0, 3);
  out.fineGuideBlend = clamp01(finiteNumber(out.fineGuideBlend, DEFAULTS.fineGuideBlend));
  out.searchCandidates = clampInt(finiteInt(out.searchCandidates, DEFAULTS.searchCandidates), 6, 64);
  out.coarseIterations = clampInt(finiteInt(out.coarseIterations, DEFAULTS.coarseIterations), 1, 6);
  out.fineIterations = clampInt(finiteInt(out.fineIterations, DEFAULTS.fineIterations), 1, 6);
  out.continuityPasses = clampInt(finiteInt(out.continuityPasses, DEFAULTS.continuityPasses), 0, 6);
  out.continuityCandidates = clampInt(finiteInt(out.continuityCandidates, DEFAULTS.continuityCandidates), 2, 24);
  out.phaseDiv = clampInt(finiteInt(out.phaseDiv, DEFAULTS.phaseDiv), 1, 8);
  out.phasePasses = clampInt(finiteInt(out.phasePasses, DEFAULTS.phasePasses), 0, 6);
  out.phaseKeyWeight = clamp(finiteNumber(out.phaseKeyWeight, DEFAULTS.phaseKeyWeight), 0, 3);
  out.phaseValueWeight = clamp(finiteNumber(out.phaseValueWeight, DEFAULTS.phaseValueWeight), 0, 3);
  out.phaseSeamWeight = clamp(finiteNumber(out.phaseSeamWeight, DEFAULTS.phaseSeamWeight), 0, 3);
  out.completenessAlpha = clamp(finiteNumber(out.completenessAlpha, DEFAULTS.completenessAlpha), 0.0001, 0.5);
  out.completenessGlobalBlend = clamp(finiteNumber(out.completenessGlobalBlend, DEFAULTS.completenessGlobalBlend), 0, 1);
  out.descriptorWeight = clamp(finiteNumber(out.descriptorWeight, DEFAULTS.descriptorWeight), 0, 3);
  out.patchWeight = clamp(finiteNumber(out.patchWeight, DEFAULTS.patchWeight), 0, 3);
  out.valueWeight = clamp(finiteNumber(out.valueWeight, DEFAULTS.valueWeight), 0, 3);
  out.valueEdgeWeight = clamp(finiteNumber(out.valueEdgeWeight, DEFAULTS.valueEdgeWeight), 0, 3);
  out.swdWeight = clamp(finiteNumber(out.swdWeight, DEFAULTS.swdWeight), 0, 2);
  out.swdProjections = clampInt(finiteInt(out.swdProjections, DEFAULTS.swdProjections), 1, 16);
  out.coherenceWeight = clamp(finiteNumber(out.coherenceWeight, DEFAULTS.coherenceWeight), 0, 2);
  out.coherenceEdgeLow = clamp(finiteNumber(out.coherenceEdgeLow, DEFAULTS.coherenceEdgeLow), 0, 1);
  out.coherenceEdgeHigh = clamp(finiteNumber(out.coherenceEdgeHigh, DEFAULTS.coherenceEdgeHigh), 0, 1);
  if (out.coherenceEdgeHigh < out.coherenceEdgeLow) {
    const mid = 0.5 * (out.coherenceEdgeLow + out.coherenceEdgeHigh);
    out.coherenceEdgeLow = mid;
    out.coherenceEdgeHigh = mid;
  }
  out.coherenceToneLow = clamp(finiteNumber(out.coherenceToneLow, DEFAULTS.coherenceToneLow), 0, 4);
  out.coherenceToneHigh = clamp(finiteNumber(out.coherenceToneHigh, DEFAULTS.coherenceToneHigh), 0, 4);
  if (out.coherenceToneHigh < out.coherenceToneLow) {
    const midTone = 0.5 * (out.coherenceToneLow + out.coherenceToneHigh);
    out.coherenceToneLow = midTone;
    out.coherenceToneHigh = midTone;
  }
  out.edgeWeight = clamp(finiteNumber(out.edgeWeight, DEFAULTS.edgeWeight), 0, 2);
  out.familyLockWeight = clamp(finiteNumber(out.familyLockWeight, DEFAULTS.familyLockWeight), 0, 2);
  out.parentFamilyWeight = clamp(finiteNumber(out.parentFamilyWeight, DEFAULTS.parentFamilyWeight), 0, 2);
  out.orientationAlongWeight = clamp(finiteNumber(out.orientationAlongWeight, DEFAULTS.orientationAlongWeight), 0, 2);
  out.adirectionalWeight = clamp(finiteNumber(out.adirectionalWeight, DEFAULTS.adirectionalWeight), 0, 2);
  out.noCrossEdgeWeight = clamp(finiteNumber(out.noCrossEdgeWeight, DEFAULTS.noCrossEdgeWeight), 0, 3);
  out.momentumClosePasses = clampInt(finiteInt(out.momentumClosePasses, DEFAULTS.momentumClosePasses), 0, 6);
  out.momentumGap = clampInt(finiteInt(out.momentumGap, DEFAULTS.momentumGap), 1, 2);
  out.momentumEdgeGate = clamp(finiteNumber(out.momentumEdgeGate, DEFAULTS.momentumEdgeGate), 0, 1);
  out.momentumAlignWeight = clamp(finiteNumber(out.momentumAlignWeight, DEFAULTS.momentumAlignWeight), 0, 4);
  out.momentumScoreThreshold = clamp(finiteNumber(out.momentumScoreThreshold, DEFAULTS.momentumScoreThreshold), 0.5, 8);
  out.cannyLowThreshold = clamp(finiteNumber(out.cannyLowThreshold, DEFAULTS.cannyLowThreshold), 0.001, 1);
  out.cannyHighThreshold = clamp(finiteNumber(out.cannyHighThreshold, DEFAULTS.cannyHighThreshold), 0.001, 1);
  if (out.cannyHighThreshold < out.cannyLowThreshold) {
    const t = out.cannyLowThreshold;
    out.cannyLowThreshold = out.cannyHighThreshold;
    out.cannyHighThreshold = t;
  }
  out.inkPenalty = clamp(finiteNumber(out.inkPenalty, DEFAULTS.inkPenalty), 0, 1.5);
  out.tufteStrength = clamp(finiteNumber(out.tufteStrength, DEFAULTS.tufteStrength), 0, 1.5);
  out.tuftePasses = clampInt(finiteInt(out.tuftePasses, DEFAULTS.tuftePasses), 0, 6);
  out.tufteDarkLuma = clamp(finiteNumber(out.tufteDarkLuma, DEFAULTS.tufteDarkLuma), 0, 1);
  out.tufteDarkGrad = clamp(finiteNumber(out.tufteDarkGrad, DEFAULTS.tufteDarkGrad), 0, 1);
  out.tufteDarkWhiteSuppress = clamp(finiteNumber(out.tufteDarkWhiteSuppress, DEFAULTS.tufteDarkWhiteSuppress), 0, 1);
  out.lienSortPasses = clampInt(finiteInt(out.lienSortPasses, DEFAULTS.lienSortPasses), 0, 4);
  out.energyDiffusionPasses = clampInt(finiteInt(out.energyDiffusionPasses, DEFAULTS.energyDiffusionPasses), 0, 6);
  out.dpDirectionPenalty = clamp(finiteNumber(out.dpDirectionPenalty, DEFAULTS.dpDirectionPenalty), 0, 1.5);
  out.dpForwardPenalty = clamp(finiteNumber(out.dpForwardPenalty, DEFAULTS.dpForwardPenalty), 0, 1.5);
  out.directionSmoothRadius = clampInt(finiteInt(out.directionSmoothRadius, DEFAULTS.directionSmoothRadius), 0, 4);
  out.parkerMaskSize = clampInt(finiteInt(out.parkerMaskSize, DEFAULTS.parkerMaskSize), 16, 128);
  out.parkerCandidates = clampInt(finiteInt(out.parkerCandidates, DEFAULTS.parkerCandidates), 4, 48);
  out.parkerPeriod = clamp(finiteNumber(out.parkerPeriod, DEFAULTS.parkerPeriod), 0.5, 4);
  return out;
}

function printFastTileFitOptions() {
  console.log('Options:');
  console.log('  --seed=<n>                deterministic seed (default: 9137)');
  console.log('  --prefit-parker=<f>       parker prefit blend strength (default: 0)');
  console.log('  --prefit-period=<f>       parker prefit period (default: 1)');
  console.log('  --search=<n>              candidate tiles per block (default: 20)');
  console.log('  --tile-rot4=<n>           precomputed 4x4 rotation angles (default: 12)');
  console.log('  --tile-rot8=<n>           precomputed 8x8 rotation angles (default: 16)');
  console.log('  --tile-lien-repair=<n>    liensort-style tile repair passes (default: 1)');
  console.log('  --coarse-iter=<n>         8x8 fitting iterations (default: 2)');
  console.log('  --fine-iter=<n>           4x4 fitting iterations (default: 2)');
  console.log('  --continuity=<n>          checkerboard continuity refinement passes (default: 1)');
  console.log('  --continuity-candidates=<n> candidates tested in continuity pass (default: 8)');
  console.log('  --phase-div=<n>           periodic phase step divisor (default: 4)');
  console.log('  --phase-passes=<n>        checkerboard phase refinement passes (default: 1)');
  console.log('  --phase-key-w=<f>         phase fit key weight (default: 0.55)');
  console.log('  --phase-value-w=<f>       phase fit value weight (default: 1.0)');
  console.log('  --phase-seam-w=<f>        phase seam weight (default: 0.35)');
  console.log('  --alpha=<f>               completeness alpha (default: 0.04)');
  console.log('  --alpha-global=<f>        global completeness blend (default: 0.2)');
  console.log('  --value-w=<f>             sharp value-tile match weight (default: 0.55)');
  console.log('  --value-edge-w=<f>        gradient-weighted value error weight (default: 0.45)');
  console.log('  --swd-w=<f>               SWD rank penalty weight (default: 0.22)');
  console.log('  --swd-proj=<n>            SWD random projections (default: 8)');
  console.log('  --orient=<f>              directional alignment weight (default: 1.0)');
  console.log('  --adirectional=<f>        weak-direction adirectional preference (default: 0.35)');
  console.log('  --coherence-edge-low=<f>  edge gate low threshold (default: 0.06)');
  console.log('  --coherence-edge-high=<f> edge gate high threshold (default: 0.24)');
  console.log('  --coherence-tone-low=<f>  tone-mismatch gate low (default: 1.05)');
  console.log('  --coherence-tone-high=<f> tone-mismatch gate high (default: 1.6)');
  console.log('  --no-cross=<f>            penalty for directional tiles crossing strong edges (default: 1.1)');
  console.log('  --momentum-close=<n>      line-momentum bridge passes for tiny gaps (default: 1)');
  console.log('  --momentum-gap=<n>        max line gap to close (1 or 2, default: 1)');
  console.log('  --momentum-edge=<f>       minimum gradient gate for momentum closure (default: 0.035)');
  console.log('  --momentum-align=<f>      edge-tangent alignment weight for closure (default: 0.9)');
  console.log('  --momentum-threshold=<f>  closure score threshold (default: 2.7)');
  console.log('  --canny-low=<f>           canny low threshold (default: 0.08)');
  console.log('  --canny-high=<f>          canny high threshold (default: 0.2)');
  console.log('  --energy-diffuse=<n>      energy diffusion passes (default: 2)');
  console.log('  --dp-dir=<f>              DP directional jump penalty (default: 0.16)');
  console.log('  --dp-forward=<f>          DP forward-energy penalty (default: 0.35)');
  console.log('  --dir-smooth=<n>          direction-field blur radius (default: 1)');
  console.log('  --ink=<f>                 Tufte ink penalty (default: 0.12)');
  console.log('  --tufte=<f>               ink minimization pass strength (default: 0.5)');
  console.log('  --tufte-dark-luma=<f>     dark-zone luma threshold (default: 0.32)');
  console.log('  --tufte-dark-grad=<f>     dark-zone gradient threshold (default: 0.12)');
  console.log('  --tufte-dark-suppress=<f> dark-zone white-flip suppressor (default: 0.28)');
  console.log('  --liensort-passes=<n>     slope-order cleanup passes (default: 1)');
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function finiteInt(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return value | 0;
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampInt(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

module.exports = {
  DEFAULTS,
  parseFastTileFitOptions,
  printFastTileFitOptions
};

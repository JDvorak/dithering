const DEFAULTS = {
  seed: 9137,
  paletteSize: 12,
  paletteIterations: 8,
  paletteSampleStride: 2,
  maxRamps: 6,
  rampEdgeThreshold: 0.08,
  shadowBlurRadius: 24,
  shadowLowQuantile: 0.08,
  shadowHighQuantile: 0.92,
  shadowRelightStrength: 0.85,
  shadowGamma: 1,
  grayChromaThreshold: 8,
  grayBalanceStrength: 0.5,
  blockSize: 4,
  phaseDiv: 4,
  detailLabBlend: 1,
  detailContrastWeight: 0.22,
  structureOriginalBlend: 0.82,
  structureTileRotation4: 20,
  structureTileRotation8: 24,
  structureLienRepairPasses: 2,
  structureFineIterations: 3,
  structureContinuityPasses: 2,
  structurePhasePasses: 2,
  vectorCannyLow: 0.08,
  vectorCannyHigh: 0.22,
  vectorGapPasses: 2,
  contrastBoost: 0,
  severabilityEnabled: false,
  severabilityWeight: 0.5,
  severabilityWindow: 3,
  vectorBandRadius: 5,
  vectorShiftStrength: 0.35,
  bezierFitEnabled: false,
  bezierMinChainLength: 8,
  bezierMaxChainLength: 200,
  bezierMaxError: 2.0,
  bezierMaxSegments: 4,
  bezierSamplingRate: 0.02,
  scaleSpaceEnabled: false,
  coarseScaleFactor: 4,
  chainLinkingEnabled: false,
  chainLinkMaxDist: 15,
  chainLinkMinAlign: 0.7,
  chainLinkMaxAngle: 0.785,
  longRangeCompletionEnabled: false,
  longRangeMaxGap: 50,
  longRangeCollinearDist: 100,
  longRangeCollinearThreshold: 2.0,
  longRangeMinAlign: 0.85,
  frameSmoothPasses: 2,
  gridAlignmentEnabled: false,
  gridScale: 8,
  lineOverlayStrength: 0.72,
  lineOverlayDarken: 0.18,
  debugLineColor: null,
  drawEdgesOnly: false,
  sameColorContrastThreshold: 1.6,
  minPairSeparation: 2,
  minPairSeparationWeight: 0.18,
  pairBlendWeight: 0,
  pairContrastVectorWeight: 0.09,
  pairReuseWeight: 0.38,
  pairReuseContrastGate: 1.35,
  lineConstraintSlack: 0.65,
  lineContrastBoost: 0.45,
  lineMinSeparationBoost: 2.5,
  shareNeighborWeight: 0.28,
  sameRampWeight: 0.18,
  skyWhiteBias: 0.24,
  skyGradThreshold: 0.08,
  skyLumaThreshold: 0.72
};

function parseFastTileFitColorOptions(args) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--seed=')) out.seed = parseInt(arg.slice(7), 10);
    else if (arg.startsWith('--palette=')) out.paletteSize = parseInt(arg.slice(10), 10);
    else if (arg.startsWith('--palette-iters=')) out.paletteIterations = parseInt(arg.slice(16), 10);
    else if (arg.startsWith('--sample-stride=')) out.paletteSampleStride = parseInt(arg.slice(16), 10);
    else if (arg.startsWith('--max-ramps=')) out.maxRamps = parseInt(arg.slice(12), 10);
    else if (arg.startsWith('--ramp-edge=')) out.rampEdgeThreshold = parseFloat(arg.slice(12));
    else if (arg.startsWith('--shadow-blur=')) out.shadowBlurRadius = parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--shadow-low=')) out.shadowLowQuantile = parseFloat(arg.slice(13));
    else if (arg.startsWith('--shadow-high=')) out.shadowHighQuantile = parseFloat(arg.slice(14));
    else if (arg.startsWith('--shadow-relight=')) out.shadowRelightStrength = parseFloat(arg.slice(16));
    else if (arg.startsWith('--shadow-gamma=')) out.shadowGamma = parseFloat(arg.slice(15));
    else if (arg.startsWith('--gray-chroma=')) out.grayChromaThreshold = parseFloat(arg.slice(14));
    else if (arg.startsWith('--gray-balance=')) out.grayBalanceStrength = parseFloat(arg.slice(15));
    else if (arg.startsWith('--phase-div=')) out.phaseDiv = parseInt(arg.slice(12), 10);
    else if (arg.startsWith('--detail-lab=')) out.detailLabBlend = parseFloat(arg.slice(13));
    else if (arg.startsWith('--detail-contrast=')) out.detailContrastWeight = parseFloat(arg.slice(18));
    else if (arg.startsWith('--structure-original=')) out.structureOriginalBlend = parseFloat(arg.slice(21));
    else if (arg.startsWith('--structure-rot4=')) out.structureTileRotation4 = parseInt(arg.slice(17), 10);
    else if (arg.startsWith('--structure-rot8=')) out.structureTileRotation8 = parseInt(arg.slice(17), 10);
    else if (arg.startsWith('--structure-lien=')) out.structureLienRepairPasses = parseInt(arg.slice(17), 10);
    else if (arg.startsWith('--structure-fine=')) out.structureFineIterations = parseInt(arg.slice(17), 10);
    else if (arg.startsWith('--structure-continuity=')) out.structureContinuityPasses = parseInt(arg.slice(23), 10);
    else if (arg.startsWith('--structure-phase=')) out.structurePhasePasses = parseInt(arg.slice(18), 10);
    else if (arg.startsWith('--vector-canny-low=')) out.vectorCannyLow = parseFloat(arg.slice(18));
    else if (arg.startsWith('--vector-canny-high=')) out.vectorCannyHigh = parseFloat(arg.slice(19));
    else if (arg.startsWith('--vector-gap-passes=')) out.vectorGapPasses = parseInt(arg.slice(20), 10);
    else if (arg.startsWith('--contrast-boost=')) out.contrastBoost = parseFloat(arg.slice(17));
    else if (arg.startsWith('--severability')) out.severabilityEnabled = true;
    else if (arg.startsWith('--severability-weight=')) out.severabilityWeight = parseFloat(arg.slice(21));
    else if (arg.startsWith('--severability-window=')) out.severabilityWindow = parseInt(arg.slice(21), 10);
    else if (arg.startsWith('--vector-band=')) out.vectorBandRadius = parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--vector-shift=')) out.vectorShiftStrength = parseFloat(arg.slice(15));
    else if (arg.startsWith('--bezier-fit')) out.bezierFitEnabled = true;
    else if (arg.startsWith('--bezier-min-chain=')) out.bezierMinChainLength = parseInt(arg.slice(19), 10);
    else if (arg.startsWith('--bezier-max-chain=')) out.bezierMaxChainLength = parseInt(arg.slice(19), 10);
    else if (arg.startsWith('--bezier-max-error=')) out.bezierMaxError = parseFloat(arg.slice(19));
    else if (arg.startsWith('--bezier-max-seg=')) out.bezierMaxSegments = parseInt(arg.slice(17), 10);
    else if (arg.startsWith('--bezier-sample=')) out.bezierSamplingRate = parseFloat(arg.slice(16));
    else if (arg.startsWith('--scale-space')) out.scaleSpaceEnabled = true;
    else if (arg.startsWith('--coarse-factor=')) out.coarseScaleFactor = parseInt(arg.slice(16), 10);
    else if (arg.startsWith('--link-chains')) out.chainLinkingEnabled = true;
    else if (arg.startsWith('--link-max-dist=')) out.chainLinkMaxDist = parseInt(arg.slice(16), 10);
    else if (arg.startsWith('--link-min-align=')) out.chainLinkMinAlign = parseFloat(arg.slice(16));
    else if (arg.startsWith('--link-max-angle=')) out.chainLinkMaxAngle = parseFloat(arg.slice(17));
    else if (arg.startsWith('--long-range')) out.longRangeCompletionEnabled = true;
    else if (arg.startsWith('--long-range-max-gap=')) out.longRangeMaxGap = parseInt(arg.slice(21), 10);
    else if (arg.startsWith('--long-range-col-dist=')) out.longRangeCollinearDist = parseInt(arg.slice(22), 10);
    else if (arg.startsWith('--long-range-col-thresh=')) out.longRangeCollinearThreshold = parseFloat(arg.slice(24));
    else if (arg.startsWith('--long-range-min-align=')) out.longRangeMinAlign = parseFloat(arg.slice(23));
    else if (arg.startsWith('--frame-smooth=')) out.frameSmoothPasses = parseInt(arg.slice(15), 10);
    else if (arg.startsWith('--grid-align')) out.gridAlignmentEnabled = true;
    else if (arg.startsWith('--grid-scale=')) out.gridScale = parseInt(arg.slice(13), 10);
    else if (arg.startsWith('--line-overlay=')) out.lineOverlayStrength = parseFloat(arg.slice(15));
    else if (arg.startsWith('--line-darken=')) out.lineOverlayDarken = parseFloat(arg.slice(14));
    else if (arg.startsWith('--debug-line-color=')) out.debugLineColor = arg.slice(19);
    else if (arg.startsWith('--draw-edges-only')) out.drawEdgesOnly = true;
    else if (arg.startsWith('--same-color-contrast=')) out.sameColorContrastThreshold = parseFloat(arg.slice(22));
    else if (arg.startsWith('--min-pair-sep=')) out.minPairSeparation = parseFloat(arg.slice(15));
    else if (arg.startsWith('--min-pair-sep-w=')) out.minPairSeparationWeight = parseFloat(arg.slice(17));
    else if (arg.startsWith('--pair-blend-w=')) out.pairBlendWeight = parseFloat(arg.slice(15));
    else if (arg.startsWith('--pair-contrast-v-w=')) out.pairContrastVectorWeight = parseFloat(arg.slice(20));
    else if (arg.startsWith('--pair-reuse=')) out.pairReuseWeight = parseFloat(arg.slice(13));
    else if (arg.startsWith('--pair-reuse-gate=')) out.pairReuseContrastGate = parseFloat(arg.slice(18));
    else if (arg.startsWith('--line-slack=')) out.lineConstraintSlack = parseFloat(arg.slice(13));
    else if (arg.startsWith('--line-contrast=')) out.lineContrastBoost = parseFloat(arg.slice(16));
    else if (arg.startsWith('--line-sep=')) out.lineMinSeparationBoost = parseFloat(arg.slice(11));
    else if (arg.startsWith('--share-neighbor=')) out.shareNeighborWeight = parseFloat(arg.slice(17));
    else if (arg.startsWith('--same-ramp=')) out.sameRampWeight = parseFloat(arg.slice(12));
    else if (arg.startsWith('--sky-bias=')) out.skyWhiteBias = parseFloat(arg.slice(11));
    else if (arg.startsWith('--sky-grad=')) out.skyGradThreshold = parseFloat(arg.slice(11));
    else if (arg.startsWith('--sky-luma=')) out.skyLumaThreshold = parseFloat(arg.slice(11));
  }
  return sanitize(out);
}

function sanitize(options) {
  const out = { ...options };
  out.seed = finiteInt(out.seed, DEFAULTS.seed);
  out.paletteSize = clampInt(finiteInt(out.paletteSize, DEFAULTS.paletteSize), 4, 32);
  out.paletteIterations = clampInt(finiteInt(out.paletteIterations, DEFAULTS.paletteIterations), 2, 24);
  out.paletteSampleStride = clampInt(finiteInt(out.paletteSampleStride, DEFAULTS.paletteSampleStride), 1, 8);
  out.maxRamps = clampInt(finiteInt(out.maxRamps, DEFAULTS.maxRamps), 1, 16);
  out.rampEdgeThreshold = clamp(finiteNumber(out.rampEdgeThreshold, DEFAULTS.rampEdgeThreshold), 0, 1);
  out.shadowBlurRadius = clampInt(finiteInt(out.shadowBlurRadius, DEFAULTS.shadowBlurRadius), 2, 64);
  out.shadowLowQuantile = clamp(finiteNumber(out.shadowLowQuantile, DEFAULTS.shadowLowQuantile), 0, 0.5);
  out.shadowHighQuantile = clamp(finiteNumber(out.shadowHighQuantile, DEFAULTS.shadowHighQuantile), 0.5, 1);
  if (out.shadowHighQuantile < out.shadowLowQuantile) out.shadowHighQuantile = out.shadowLowQuantile;
  out.shadowRelightStrength = clamp(finiteNumber(out.shadowRelightStrength, DEFAULTS.shadowRelightStrength), 0, 1.5);
  out.shadowGamma = clamp(finiteNumber(out.shadowGamma, DEFAULTS.shadowGamma), 0.2, 3);
  out.grayChromaThreshold = clamp(finiteNumber(out.grayChromaThreshold, DEFAULTS.grayChromaThreshold), 1, 32);
  out.grayBalanceStrength = clamp(finiteNumber(out.grayBalanceStrength, DEFAULTS.grayBalanceStrength), 0, 1.5);
  out.blockSize = 4;
  out.phaseDiv = clampInt(finiteInt(out.phaseDiv, DEFAULTS.phaseDiv), 1, 8);
  out.detailLabBlend = clamp(finiteNumber(out.detailLabBlend, DEFAULTS.detailLabBlend), 0, 1);
  out.detailContrastWeight = clamp(finiteNumber(out.detailContrastWeight, DEFAULTS.detailContrastWeight), 0, 3);
  out.structureOriginalBlend = clamp(finiteNumber(out.structureOriginalBlend, DEFAULTS.structureOriginalBlend), 0, 1);
  out.structureTileRotation4 = clampInt(finiteInt(out.structureTileRotation4, DEFAULTS.structureTileRotation4), 8, 32);
  out.structureTileRotation8 = clampInt(finiteInt(out.structureTileRotation8, DEFAULTS.structureTileRotation8), 8, 32);
  out.structureLienRepairPasses = clampInt(finiteInt(out.structureLienRepairPasses, DEFAULTS.structureLienRepairPasses), 0, 3);
  out.structureFineIterations = clampInt(finiteInt(out.structureFineIterations, DEFAULTS.structureFineIterations), 1, 6);
  out.structureContinuityPasses = clampInt(finiteInt(out.structureContinuityPasses, DEFAULTS.structureContinuityPasses), 0, 6);
  out.structurePhasePasses = clampInt(finiteInt(out.structurePhasePasses, DEFAULTS.structurePhasePasses), 0, 6);
  out.vectorCannyLow = clamp(finiteNumber(out.vectorCannyLow, DEFAULTS.vectorCannyLow), 0.001, 1);
  out.vectorCannyHigh = clamp(finiteNumber(out.vectorCannyHigh, DEFAULTS.vectorCannyHigh), 0.001, 1);
  if (out.vectorCannyHigh < out.vectorCannyLow) {
    const t = out.vectorCannyLow;
    out.vectorCannyLow = out.vectorCannyHigh;
    out.vectorCannyHigh = t;
  }
  out.vectorGapPasses = clampInt(finiteInt(out.vectorGapPasses, DEFAULTS.vectorGapPasses), 0, 8);
  out.contrastBoost = clamp(finiteNumber(out.contrastBoost, DEFAULTS.contrastBoost), 0, 1);
  out.severabilityEnabled = !!out.severabilityEnabled;
  out.severabilityWeight = clamp(finiteNumber(out.severabilityWeight, DEFAULTS.severabilityWeight), 0, 1);
  out.severabilityWindow = clampInt(finiteInt(out.severabilityWindow, DEFAULTS.severabilityWindow), 3, 7);
  out.vectorBandRadius = clampInt(finiteInt(out.vectorBandRadius, DEFAULTS.vectorBandRadius), 1, 16);
  out.vectorShiftStrength = clamp(finiteNumber(out.vectorShiftStrength, DEFAULTS.vectorShiftStrength), 0, 1.5);
  out.bezierFitEnabled = !!out.bezierFitEnabled;
  out.bezierMinChainLength = clampInt(finiteInt(out.bezierMinChainLength, DEFAULTS.bezierMinChainLength), 4, 32);
  out.bezierMaxChainLength = clampInt(finiteInt(out.bezierMaxChainLength, DEFAULTS.bezierMaxChainLength), 16, 500);
  out.bezierMaxError = clamp(finiteNumber(out.bezierMaxError, DEFAULTS.bezierMaxError), 0.5, 10);
  out.bezierMaxSegments = clampInt(finiteInt(out.bezierMaxSegments, DEFAULTS.bezierMaxSegments), 1, 8);
  out.bezierSamplingRate = clamp(finiteNumber(out.bezierSamplingRate, DEFAULTS.bezierSamplingRate), 0.005, 0.1);
  out.scaleSpaceEnabled = !!out.scaleSpaceEnabled;
  out.coarseScaleFactor = clampInt(finiteInt(out.coarseScaleFactor, DEFAULTS.coarseScaleFactor), 2, 8);
  out.chainLinkingEnabled = !!out.chainLinkingEnabled;
  out.chainLinkMaxDist = clampInt(finiteInt(out.chainLinkMaxDist, DEFAULTS.chainLinkMaxDist), 5, 50);
  out.chainLinkMinAlign = clamp(finiteNumber(out.chainLinkMinAlign, DEFAULTS.chainLinkMinAlign), 0.3, 0.95);
  out.chainLinkMaxAngle = clamp(finiteNumber(out.chainLinkMaxAngle, DEFAULTS.chainLinkMaxAngle), 0.1, 1.57);
  out.longRangeCompletionEnabled = !!out.longRangeCompletionEnabled;
  out.longRangeMaxGap = clampInt(finiteInt(out.longRangeMaxGap, DEFAULTS.longRangeMaxGap), 20, 150);
  out.longRangeCollinearDist = clampInt(finiteInt(out.longRangeCollinearDist, DEFAULTS.longRangeCollinearDist), 50, 200);
  out.longRangeCollinearThreshold = clamp(finiteNumber(out.longRangeCollinearThreshold, DEFAULTS.longRangeCollinearThreshold), 0.5, 10);
  out.longRangeMinAlign = clamp(finiteNumber(out.longRangeMinAlign, DEFAULTS.longRangeMinAlign), 0.6, 0.98);
  out.frameSmoothPasses = clampInt(finiteInt(out.frameSmoothPasses, DEFAULTS.frameSmoothPasses), 0, 6);
  out.gridAlignmentEnabled = !!out.gridAlignmentEnabled;
  out.gridScale = clampInt(finiteInt(out.gridScale, DEFAULTS.gridScale), 4, 16);
  out.lineOverlayStrength = clamp(finiteNumber(out.lineOverlayStrength, DEFAULTS.lineOverlayStrength), 0, 1.5);
  out.lineOverlayDarken = clamp(finiteNumber(out.lineOverlayDarken, DEFAULTS.lineOverlayDarken), 0, 0.9);
  if (out.debugLineColor !== null && out.debugLineColor !== 'black') out.debugLineColor = null;
  out.drawEdgesOnly = !!out.drawEdgesOnly;
  out.sameColorContrastThreshold = clamp(finiteNumber(out.sameColorContrastThreshold, DEFAULTS.sameColorContrastThreshold), 0, 8);
  out.minPairSeparation = clamp(finiteNumber(out.minPairSeparation, DEFAULTS.minPairSeparation), 0, 40);
  out.minPairSeparationWeight = clamp(finiteNumber(out.minPairSeparationWeight, DEFAULTS.minPairSeparationWeight), 0, 4);
  out.pairBlendWeight = clamp(finiteNumber(out.pairBlendWeight, DEFAULTS.pairBlendWeight), 0, 3);
  out.pairContrastVectorWeight = clamp(finiteNumber(out.pairContrastVectorWeight, DEFAULTS.pairContrastVectorWeight), 0, 3);
  out.pairReuseWeight = clamp(finiteNumber(out.pairReuseWeight, DEFAULTS.pairReuseWeight), 0, 3);
  out.pairReuseContrastGate = clamp(finiteNumber(out.pairReuseContrastGate, DEFAULTS.pairReuseContrastGate), 0, 8);
  out.lineConstraintSlack = clamp(finiteNumber(out.lineConstraintSlack, DEFAULTS.lineConstraintSlack), 0, 1);
  out.lineContrastBoost = clamp(finiteNumber(out.lineContrastBoost, DEFAULTS.lineContrastBoost), 0, 2);
  out.lineMinSeparationBoost = clamp(finiteNumber(out.lineMinSeparationBoost, DEFAULTS.lineMinSeparationBoost), 0, 12);
  out.shareNeighborWeight = clamp(finiteNumber(out.shareNeighborWeight, DEFAULTS.shareNeighborWeight), 0, 2);
  out.sameRampWeight = clamp(finiteNumber(out.sameRampWeight, DEFAULTS.sameRampWeight), 0, 2);
  out.skyWhiteBias = clamp(finiteNumber(out.skyWhiteBias, DEFAULTS.skyWhiteBias), 0, 1.5);
  out.skyGradThreshold = clamp(finiteNumber(out.skyGradThreshold, DEFAULTS.skyGradThreshold), 0.001, 1);
  out.skyLumaThreshold = clamp(finiteNumber(out.skyLumaThreshold, DEFAULTS.skyLumaThreshold), 0, 1);
  return out;
}

function printFastTileFitColorOptions() {
  console.log('Options:');
  console.log('  --palette=<n>             target palette size (default: 12)');
  console.log('  --palette-iters=<n>       kmeans iterations (default: 8)');
  console.log('  --sample-stride=<n>       palette sampling stride (default: 2)');
  console.log('  --shadow-relight=<f>      shadow relight strength (default: 0.85)');
  console.log('  --gray-balance=<f>        semantic gray-balance strength (default: 0.5)');
  console.log('  --detail-lab=<f>          blend original color for pair fitting (default: 1.0)');
  console.log('  --detail-contrast=<f>     preserve local light/dark separation in pairs (default: 0.22)');
  console.log('  --structure-original=<f>  keep original image in structure-map input (default: 0.82)');
  console.log('  --structure-rot4=<n>      4x4 tile rotation steps in structure map (default: 20)');
  console.log('  --structure-rot8=<n>      8x8 tile rotation steps in structure map (default: 24)');
  console.log('  --structure-lien=<n>      liensort repair passes in structure map (default: 2)');
  console.log('  --structure-fine=<n>      fast-bw fine iterations for structure map (default: 3)');
  console.log('  --structure-continuity=<n> fast-bw continuity passes (default: 2)');
  console.log('  --structure-phase=<n>     fast-bw phase refinement passes (default: 2)');
  console.log('  --vector-canny-low=<f>    canny low threshold for simplification (default: 0.08)');
  console.log('  --vector-canny-high=<f>   canny high threshold for simplification (default: 0.22)');
  console.log('  --vector-gap-passes=<n>   canny edge gap-closing passes (default: 2)');
  console.log('  --contrast-boost=<f>      contrast enhancement strength 0-1 (default: 0)');
  console.log('  --severability            enable severability analysis for edge detection');
  console.log('  --severability-weight=<f> severability weighting factor 0-1 (default: 0.5)');
  console.log('  --severability-window=<n> severability analysis window size (default: 3)');
  console.log('  --vector-band=<n>         bend radius around simplified edges (default: 5)');
  console.log('  --vector-shift=<f>        bend strength toward simplified edges (default: 0.35)');
  console.log('  --bezier-fit              enable bezier curve fitting for edges');
  console.log('  --bezier-min-chain=<n>    min pixels per bezier chain (default: 8)');
  console.log('  --bezier-max-chain=<n>    max pixels per bezier chain (default: 200)');
  console.log('  --bezier-max-error=<f>    max fitting error threshold (default: 2.0)');
  console.log('  --bezier-max-seg=<n>      max bezier segments per chain (default: 4)');
  console.log('  --bezier-sample=<f>       sampling rate for rendering bezier (default: 0.02)');
  console.log('  --scale-space             enable multi-scale edge analysis');
  console.log('  --coarse-factor=<n>       coarse scale factor for scale-space (default: 4)');
  console.log('  --link-chains             enable chain linking using scale-space guidance');
  console.log('  --link-max-dist=<n>       max distance to link chains (default: 15)');
  console.log('  --link-min-align=<f>      min tangent alignment to link (default: 0.7)');
  console.log('  --link-max-angle=<f>      max angle diff to link in radians (default: 0.785)');
  console.log('  --long-range              enable long-range gap completion (collinear inference)');
  console.log('  --long-range-max-gap=<n>  max gap distance to complete (default: 50)');
  console.log('  --long-range-col-dist=<n> max search distance for collinear lines (default: 100)');
  console.log('  --long-range-col-thresh=<f> collinearity threshold in pixels (default: 2.0)');
  console.log('  --long-range-min-align=<f> min alignment for long-range links (default: 0.85)');
  console.log('  --frame-smooth=<n>        frame field smoothing passes (default: 2)');
  console.log('  --grid-align              enable grid alignment of strokes');
  console.log('  --grid-scale=<n>          grid cell size for alignment (default: 8)');
  console.log('  --line-overlay=<f>        final clean-line overlay strength (default: 0.72)');
  console.log('  --line-darken=<f>         line color darkening factor (default: 0.18)');
  console.log('  --debug-line-color=black  draw debug lines in black (default: null)');
  console.log('  --draw-edges-only         output only Canny edges, skip color processing');
  console.log('  --same-color-contrast=<f> allow same pair only below this contrast (default: 1.6)');
  console.log('  --min-pair-sep=<f>        baseline LAB separation between pair colors (default: 2)');
  console.log('  --pair-blend-w=<f>        pair blend-to-block fit weight (default: 0.0)');
  console.log('  --pair-contrast-v-w=<f>   pair LAB contrast-vector fit weight (default: 0.09)');
  console.log('  --pair-reuse=<f>          prefer reusing neighbor pair in smooth zones (default: 0.38)');
  console.log('  --line-slack=<f>          relax palette/topology constraints on line blocks (default: 0.65)');
  console.log('  --line-contrast=<f>       increase pair contrast preference on line blocks (default: 0.45)');
  console.log('  --line-sep=<f>            extra LAB pair separation target on line blocks (default: 2.5)');
  console.log('  --phase-div=<n>           tile phase step divisor (default: 4)');
  console.log('  --share-neighbor=<f>      neighbor shared-color pressure (default: 0.28)');
  console.log('  --same-ramp=<f>           same-ramp color pair pressure (default: 0.18)');
  console.log('  --sky-bias=<f>            low-ink sky whitening bias (default: 0.24)');
}

function finiteNumber(v, fb) {
  return Number.isFinite(v) ? v : fb;
}

function finiteInt(v, fb) {
  if (!Number.isFinite(v)) return fb;
  return v | 0;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampInt(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

module.exports = {
  DEFAULTS,
  parseFastTileFitColorOptions,
  printFastTileFitColorOptions
};

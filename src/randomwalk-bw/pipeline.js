const { clamp01, smoothstep } = require('./math');
const { extractLuminance, computeGradients, boxBlur } = require('./image');
const { computeContourFlow, solveCurvedCoordinates } = require('./flow');
const { createProgressiveMask, sampleParkerThreshold } = require('./masks');

function runRandomwalkBw(imageData, options = {}) {
  // Merge with defaults
  const opts = {
    parkerPeriod: 1,
    parkerMaskSize: 64,
    maskCandidates: 12,
    bendStrength: 0.7,
    frequencyWarp: 0.35,
    coordinateIterations: 40,
    coordinateAnchor: 0.08,
    entropyFrequencyStrength: 0.45,
    entropyDensityStrength: 0.18,
    fineBendBoost: 0.55,
    fineFrequencyBoost: 0.2,
    fineAnchorRelax: 0.5,
    fineThresholdBoost: 0.06,
    orientationRadius: 3,
    edgeLow: 0.08,
    edgeHigh: 0.32,
    ...options
  };
  
  const width = imageData.width;
  const height = imageData.height;
  const count = width * height;
  const rgba = imageData.data;

  const luma = extractLuminance(rgba, count);
  const gradients = computeGradients(luma, width, height);

  // Use gradient-based entropy for regional complexity
  const regional = computeGradientBasedEntropy(gradients.grad, width, height);
  const fineField = { 
    entropy: boxBlur(regional.entropy, width, height, 2), 
    labels: new Int32Array(count) 
  };

  const flow = computeContourFlow(gradients.gx, gradients.gy, width, height, opts.orientationRadius);
  const curved = solveCurvedCoordinates(
    flow,
    gradients.grad,
    regional.entropy,
    fineField.entropy,
    width,
    height,
    opts,
    smoothstep,
    clamp01,
    clamp,
    opts.coordinateAnchor
  );

  const parkerMask = createProgressiveMask(opts.parkerMaskSize, 7331, opts.maskCandidates + 2);
  const parkerMaskAlt = createProgressiveMask(opts.parkerMaskSize, 1879, opts.maskCandidates + 4);
  const binary = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const threshold = clamp01(
      sampleParkerThreshold(curved.u[i], curved.v[i], parkerMask, parkerMaskAlt, opts.parkerMaskSize, opts.parkerPeriod) +
      opts.entropyDensityStrength * (regional.entropy[i] - 0.5) - opts.fineThresholdBoost * fineField.entropy[i]
    );
    binary[i] = luma[i] >= threshold ? 1 : 0;
  }

  return {
    width,
    height,
    binary,
    luma,
    grad: gradients.grad,
    gx: gradients.gx,
    gy: gradients.gy,
    entropy: regional.entropy,
    labels: regional.labels,
    fineMask: fineField.entropy
  };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function computeGradientBasedEntropy(grad, width, height) {
  const count = width * height;
  const entropy = new Float32Array(count);
  const labels = new Int32Array(count);
  
  // Compute local entropy from gradient magnitude
  // Higher gradient = higher entropy (more complex region)
  for (let i = 0; i < count; i++) {
    const g = grad[i];
    // Map gradient to 0-1 with some baseline entropy
    entropy[i] = Math.min(1.0, g * 2.5 + 0.15);
    labels[i] = 0;
  }
  
  // Apply light smoothing
  return { entropy: boxBlur(entropy, width, height, 1), labels };
}

module.exports = {
  runRandomwalkBw
};
const { clamp01, smoothstep } = require('./math');
const { extractLuminance, computeGradients, boxBlur, computeCoarseLab } = require('./image');
const { rgbToLab } = require('./color');
const { computeContourFlow, solveCurvedCoordinates } = require('./flow');
const { createProgressiveMask, sampleParkerThreshold } = require('./masks');

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function runRandomwalkBw(imageData, options = {}) {
  const width = imageData.width;
  const height = imageData.height;
  const count = width * height;
  const rgba = imageData.data;

  const luma = extractLuminance(rgba, count);
  const gradients = computeGradients(luma, width, height);

  // Simplified: Use gradient-based entropy instead of random walk
  // This creates a simple local complexity measure without the expensive RW computation
  const regional = computeSimpleRegional(gradients.grad, width, height);
  const fineField = { entropy: boxBlur(regional.entropy, width, height, 2), labels: new Int32Array(count) };

  const flow = computeContourFlow(gradients.gx, gradients.gy, width, height, options.orientationRadius);
  const curved = solveCurvedCoordinates(
    flow,
    gradients.grad,
    regional.entropy,
    fineField.entropy,
    width,
    height,
    options,
    smoothstep,
    clamp01,
    clamp,
    options.coordinateAnchor
  );

  const parkerMask = createProgressiveMask(options.parkerMaskSize, 7331, options.maskCandidates + 2);
  const parkerMaskAlt = createProgressiveMask(options.parkerMaskSize, 1879, options.maskCandidates + 4);
  const binary = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const threshold = clamp01(
      sampleParkerThreshold(curved.u[i], curved.v[i], parkerMask, parkerMaskAlt, options.parkerMaskSize, options.parkerPeriod) +
      options.entropyDensityStrength * (regional.entropy[i] - 0.5) - options.fineThresholdBoost * fineField.entropy[i]
    );
    binary[i] = luma[i] >= threshold ? 1 : 0;
  }

  return {
    width,
    height,
    binary,
    luma,
    grad: gradients.grad,
    entropy: regional.entropy,
    labels: regional.labels,
    fineMask: fineField.entropy,
    u: curved.u,
    v: curved.v
  };
}

function computeSimpleRegional(grad, width, height) {
  const count = width * height;
  const entropy = new Float32Array(count);
  const labels = new Int32Array(count);
  
  // Simple gradient-based entropy: high gradient = high entropy
  // This approximates the multiscale entropy without random walks
  for (let i = 0; i < count; i++) {
    // Smooth the gradient and map to 0-1 range
    const g = grad[i];
    entropy[i] = Math.min(1, g * 2 + 0.1); // Scale and add baseline
    labels[i] = 0; // Single region for simplicity
  }
  
  // Apply light blur for smoothness
  return { entropy: boxBlur(entropy, width, height, 1), labels };
}

module.exports = {
  runRandomwalkBw
};
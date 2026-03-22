const { boxBlur } = require('./image');
const { poissonDiskSample } = require('./sampling');
const { createRng } = require('./math');

/**
 * Pure stroke-based rendering
 * Every pixel is the start point of a semi-transparent stroke pulled along gradients
 * No compositing with original - creates image purely from strokes
 */
function renderPureStrokes(luma, gx, gy, grad, width, height, options = {}) {
  const {
    strokeLength = 4,
    strokeOpacity = 0.15,
    minGradient = 0.02,
    flowFieldSmooth = 2,
    decayRate = 2.0,
    sampleRadius = 3.0,  // Poisson disk radius - higher = sparser strokes
    seed = 12345
  } = options;
  
  const count = width * height;
  
  // Create tangent field (perpendicular to gradient) for contour-following strokes
  // Tangent direction is perpendicular to gradient: (-gy, gx)
  let flowX = new Float32Array(count);
  let flowY = new Float32Array(count);
  
  for (let i = 0; i < count; i++) {
    // Tangent is perpendicular to gradient
    flowX[i] = -gy[i];
    flowY[i] = gx[i];
  }
  
  // Smooth the tangent field for more coherent flow
  if (flowFieldSmooth > 0) {
    flowX = boxBlur(flowX, width, height, flowFieldSmooth);
    flowY = boxBlur(flowY, width, height, flowFieldSmooth);
  }
  
  // Accumulation buffer for stroke rendering
  const accum = new Float32Array(count).fill(0);
  const weight = new Float32Array(count).fill(0);
  
  // Generate Poisson disk samples for stroke origins
  const rng = createRng(seed);
  const sampleIndices = poissonDiskSample(width, height, sampleRadius, null, rng);
  
  // Process sampled pixels as stroke origins
  for (let s = 0; s < sampleIndices.length; s++) {
    const i = sampleIndices[s];
    const x = i % width;
    const y = (i / width) | 0;
    
    // Get flow direction at this point
    const fx = flowX[i];
    const fy = flowY[i];
    const g = grad[i];
    
    // For low gradient areas, just place a small dot
    if (g < minGradient) {
      accum[i] += luma[i] * strokeOpacity;
      weight[i] += strokeOpacity;
      continue;
    }
    
    // Trace stroke along tangent direction
    traceStroke(
      x, y, fx, fy, g, luma[i],
      flowX, flowY, grad, width, height, strokeLength,
      strokeOpacity, decayRate, accum, weight
    );
  }
  
  // Just use accumulated values, don't normalize
  // Apply gamma-like curve to preserve sketch-like quality
  for (let i = 0; i < count; i++) {
    // Non-linear mapping to preserve stroke definition
    accum[i] = Math.min(1, accum[i] * 2.5);
  }
  
  return accum;
}

/**
 * Trace a stroke from (x, y) following the flow field
 */
function traceStroke(startX, startY, startGx, startGy, startGrad, startLuma,
                     flowX, flowY, grad, width, height, maxLen, baseOpacity, decayRate,
                     accum, weight) {
  
  let x = startX;
  let y = startY;
  
  // Normalize initial direction
  let dirLen = Math.hypot(startGx, startGy) || 1;
  let dx = startGx / dirLen;
  let dy = startGy / dirLen;
  
  // Trace forward along flow
  for (let step = 0; step < maxLen; step++) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) break;
    
    const idx = iy * width + ix;
    
    // Opacity decreases along stroke - exponential decay for sketch-like fade
    const t = step / maxLen;
    const op = baseOpacity * Math.exp(-decayRate * t);
    
    // Accumulate with luminance-based intensity
    accum[idx] += startLuma * op;
    if (weight) weight[idx] += op;
    
    // Move to next point following flow field
    // Sample flow at current position
    const fx = flowX[idx];
    const fy = flowY[idx];
    
    // Normalize and step
    const flen = Math.hypot(fx, fy) || 1;
    dx = fx / flen;
    dy = fy / flen;
    
    x += dx;
    y += dy;
  }
  
  // Trace backward as well for symmetric strokes
  x = startX;
  y = startY;
  dirLen = Math.hypot(startGx, startGy) || 1;
  dx = -startGx / dirLen; // Reverse direction
  dy = -startGy / dirLen;
  
  for (let step = 0; step < maxLen; step++) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) break;
    
    const idx = iy * width + ix;
    
    // Opacity decreases along stroke - exponential decay for sketch-like fade
    const t = step / maxLen;
    const op = baseOpacity * Math.exp(-decayRate * t);
    
    accum[idx] += startLuma * op;
    if (weight) weight[idx] += op;
    
    const fx = flowX[idx];
    const fy = flowY[idx];
    const flen = Math.hypot(fx, fy) || 1;
    dx = -fx / flen; // Continue backward
    dy = -fy / flen;
    
    x += dx;
    y += dy;
  }
}

/**
 * Render strokes only from "on" pixels in a binary mask (e.g., dithered output)
 * This uses the artistic placement from dithering as stroke origins
 */
function renderStrokesFromMask(binaryMask, luma, gx, gy, grad, width, height, options = {}) {
  const {
    strokeLength = 5,
    strokeOpacity = 0.25,
    decayRate = 2.0,
    flowFieldSmooth = 2,
    sampleRate = 0.3
  } = options;
  
  const count = width * height;
  
  // Create tangent field (perpendicular to gradient)
  let flowX = new Float32Array(count);
  let flowY = new Float32Array(count);
  
  for (let i = 0; i < count; i++) {
    flowX[i] = -gy[i];
    flowY[i] = gx[i];
  }
  
  if (flowFieldSmooth > 0) {
    flowX = boxBlur(flowX, width, height, flowFieldSmooth);
    flowY = boxBlur(flowY, width, height, flowFieldSmooth);
  }
  
  // Start with white background (1.0), only draw BLACK strokes
  const canvas = new Float32Array(count).fill(1.0);
  
  // Collect all dark pixel indices
  const darkPixels = [];
  for (let i = 0; i < count; i++) {
    if (binaryMask[i] === 0) { // Dark pixel
      darkPixels.push(i);
    }
  }
  
  // Sample from dark pixels based on sampleRate
  const numSamples = Math.floor(darkPixels.length * sampleRate);
  
  // Shuffle and take first N
  for (let i = darkPixels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [darkPixels[i], darkPixels[j]] = [darkPixels[j], darkPixels[i]];
  }
  
  // Only process sampled pixels
  for (let s = 0; s < numSamples; s++) {
    const i = darkPixels[s];
    const x = i % width;
    const y = (i / width) | 0;
    
    const fx = flowX[i];
    const fy = flowY[i];
    
    // Trace BLACK stroke from this dithered pixel
    traceBlackStroke(
      x, y, fx, fy, strokeLength,
      strokeOpacity, decayRate, canvas, width, height, flowX, flowY
    );
  }
  
  return canvas;
}

/**
 * Find endpoint by following flow field for maxSteps
 * Returns {x, y, actualSteps}
 */
function traceToEndpoint(startX, startY, flowX, flowY, width, height, maxSteps) {
  let x = startX;
  let y = startY;
  
  for (let step = 0; step < maxSteps; step++) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) {
      return { x, y, steps: step };
    }
    
    const idx = iy * width + ix;
    const fx = flowX[idx];
    const fy = flowY[idx];
    
    const flen = Math.hypot(fx, fy) || 1;
    x += fx / flen;
    y += fy / flen;
  }
  
  return { x, y, steps: maxSteps };
}

/**
 * Draw a painterly brush stroke from start to end with opacity falloff
 */
function drawBrushStroke(x0, y0, x1, y1, baseOpacity, decayRate, width, height, canvas) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (dist < 1) return;
  
  // Number of steps proportional to distance
  const steps = Math.ceil(dist * 2);
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue;
    
    const idx = iy * width + ix;
    
    // Parabolic opacity profile: strongest in middle, fades at ends
    const opacity = baseOpacity * (1 - Math.abs(t - 0.5) * 2) * Math.exp(-decayRate * Math.abs(t - 0.5));
    
    canvas[idx] = Math.max(0, canvas[idx] - opacity);
  }
}

/**
 * Trace a painterly BLACK stroke that connects to an endpoint along the flow
 */
function traceBlackStroke(startX, startY, startGx, startGy, maxLen,
                          baseOpacity, decayRate, canvas, width, height, flowX, flowY) {
  
  // Find endpoint by following the tangent field
  const endpoint = traceToEndpoint(startX, startY, flowX, flowY, width, height, maxLen);
  
  // Only draw if we actually moved somewhere
  if (endpoint.steps > 2) {
    drawBrushStroke(startX, startY, endpoint.x, endpoint.y, baseOpacity, decayRate, width, height, canvas);
  }
}

/**
 * Render just the sampled points as dots (no strokes)
 * This shows the Poisson disk sampling pattern
 */
function renderSampledDots(binaryMask, luma, width, height, options = {}) {
  const {
    sampleRate = 0.3,
    dotSize = 1
  } = options;
  
  const count = width * height;
  
  // Start with white background
  const canvas = new Float32Array(count).fill(1.0);
  
  // Collect all dark pixel indices
  const darkPixels = [];
  for (let i = 0; i < count; i++) {
    if (binaryMask[i] === 0) { // Dark pixel
      darkPixels.push(i);
    }
  }
  
  // Sample from dark pixels based on sampleRate
  const numSamples = Math.floor(darkPixels.length * sampleRate);
  
  // Shuffle and take first N
  for (let i = darkPixels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [darkPixels[i], darkPixels[j]] = [darkPixels[j], darkPixels[i]];
  }
  
  // Draw dots at sampled positions
  for (let s = 0; s < numSamples; s++) {
    const i = darkPixels[s];
    const x = i % width;
    const y = (i / width) | 0;
    
    // Draw a small dot
    for (let dy = -dotSize; dy <= dotSize; dy++) {
      for (let dx = -dotSize; dx <= dotSize; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const idx = ny * width + nx;
          canvas[idx] = 0; // Black dot
        }
      }
    }
  }
  
  return canvas;
}

module.exports = {
  renderPureStrokes,
  renderStrokesFromMask,
  renderSampledDots
};
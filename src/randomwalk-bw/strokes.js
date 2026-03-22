const { boxBlur } = require('./image');

/**
 * Optimized stroke-based rendering pipeline
 * Pulls dithered pixels along gradient paths into variable-length strokes
 */
function renderStrokes(binary, luma, grad, gx, gy, width, height, options = {}) {
  const {
    maxStrokeLength = 3,
    strokeOpacity = 0.7,
    minGradient = 0.1,  // Only stroke pixels with gradient above this
    curveTension = 0.3
  } = options;
  
  const count = width * height;
  const output = new Float32Array(count);
  
  // Copy binary as base
  for (let i = 0; i < count; i++) {
    output[i] = binary[i];
  }
  
  // Process in passes for better cache locality
  // First pass: identify stroke candidates (high gradient + binary pixel)
  const candidates = [];
  for (let i = 0; i < count; i++) {
    if (binary[i] > 0 && grad[i] > minGradient) {
      candidates.push(i);
    }
  }
  
  // Second pass: render strokes for candidates
  // Process in batches to avoid long-running loop
  const batchSize = 1000;
  for (let batch = 0; batch < candidates.length; batch += batchSize) {
    const end = Math.min(batch + batchSize, candidates.length);
    for (let c = batch; c < end; c++) {
      const i = candidates[c];
      const x = i % width;
      const y = (i / width) | 0;
      
      renderStrokeAt(
        x, y, gx[i], gy[i], grad[i],
        output, width, height,
        maxStrokeLength, strokeOpacity, curveTension
      );
    }
  }
  
  return output;
}

/**
 * Render a single stroke at the given position
 */
function renderStrokeAt(x, y, gx, gy, gradMag, output, width, height, maxLen, opacity, tension) {
  // Normalize gradient
  const len = Math.hypot(gx, gy) || 1;
  const dx = gx / len;
  const dy = gy / len;
  
  // Stroke length based on gradient magnitude
  const strokeLen = Math.max(1, Math.min(maxLen, Math.floor(maxLen * gradMag)));
  
  // End point
  const endX = x + dx * strokeLen;
  const endY = y + dy * strokeLen;
  
  // Simple line rasterization (Bresenham)
  drawLine(x, y, endX, endY, output, width, height, opacity);
}

/**
 * Simple line drawing with intensity falloff
 */
function drawLine(x0, y0, x1, y1, output, width, height, baseOpacity) {
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);
  
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let steps = 0;
  const maxSteps = dx + dy;
  
  let x = x0;
  let y = y0;
  
  while (steps++ <= maxSteps) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = y * width + x;
      // Opacity decreases along stroke
      const t = steps / maxSteps;
      const op = baseOpacity * (1 - t * 0.5);
      output[idx] = Math.min(1, output[idx] + op);
    }
    
    if (x === x1 && y === y1) break;
    
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

module.exports = {
  renderStrokes
};
const { lerp } = require('./math');
const { boxBlur } = require('./image');

function computeContourFlow(gx, gy, width, height, orientationRadius) {
  const count = width * height;
  const jxx = new Float32Array(count);
  const jxy = new Float32Array(count);
  const jyy = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    jxx[i] = gx[i] * gx[i];
    jxy[i] = gx[i] * gy[i];
    jyy[i] = gy[i] * gy[i];
  }

  const sxx = boxBlur(jxx, width, height, 2);
  const sxy = boxBlur(jxy, width, height, 2);
  const syy = boxBlur(jyy, width, height, 2);
  const tx = new Float32Array(count);
  const ty = new Float32Array(count);
  const coherence = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const a = sxx[i];
    const b = sxy[i];
    const d = syy[i];
    const trace = a + d;
    const delta = Math.sqrt((a - d) * (a - d) + 4 * b * b);
    const lambda1 = 0.5 * (trace + delta);
    const lambda2 = 0.5 * (trace - delta);
    let gxDir = b;
    let gyDir = lambda1 - a;
    let len = Math.hypot(gxDir, gyDir);
    if (len < 1e-6) {
      gxDir = 1;
      gyDir = 0;
      len = 1;
    }
    gxDir /= len;
    gyDir /= len;
    tx[i] = -gyDir;
    ty[i] = gxDir;
    coherence[i] = (lambda1 - lambda2) / (lambda1 + lambda2 + 1e-6);
  }

  const stx = boxBlurWeighted(tx, coherence, width, height, orientationRadius);
  const sty = boxBlurWeighted(ty, coherence, width, height, orientationRadius);
  const tangentX = new Float32Array(count);
  const tangentY = new Float32Array(count);
  const normalX = new Float32Array(count);
  const normalY = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const len = Math.hypot(stx[i], sty[i]) || 1;
    const x = stx[i] / len;
    const y = sty[i] / len;
    tangentX[i] = x;
    tangentY[i] = y;
    normalX[i] = -y;
    normalY[i] = x;
  }

  return { coherence, tangentX, tangentY, normalX, normalY };
}

function solveCurvedCoordinates(flow, grad, entropy, fineMask, width, height, options, smoothstep, clamp01, clamp, coordinateAnchor) {
  const count = width * height;
  const u = new Float32Array(count);
  const v = new Float32Array(count);
  const targetUdx = new Float32Array(count);
  const targetUdy = new Float32Array(count);
  const targetVdx = new Float32Array(count);
  const targetVdy = new Float32Array(count);
  const anchorWeight = new Float32Array(count);

  // Initialize with grid coordinates and compute target derivatives
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const fine = fineMask ? fineMask[idx] : 0;
      const gradWeight = clamp01(0.35 * grad[idx] + 0.65 * smoothstep(options.edgeLow * 0.5, options.edgeHigh, grad[idx]));
      const baseEdge = gradWeight * lerp(0.2, 1, flow.coherence[idx]);
      const edge = clamp01(baseEdge + options.fineBendBoost * fine);
      const basisWeight = clamp01(edge * options.bendStrength);
      const entropyShift = entropy[idx] - 0.5;
      const frequency = clamp(
        1 + options.frequencyWarp * edge + (options.entropyFrequencyStrength || 0) * entropyShift + options.fineFrequencyBoost * fine,
        0.45,
        2.6
      );
      targetUdx[idx] = lerp(1, flow.tangentX[idx], basisWeight) * frequency;
      targetUdy[idx] = lerp(0, flow.tangentY[idx], basisWeight) * frequency;
      targetVdx[idx] = lerp(0, flow.normalX[idx], basisWeight) * frequency;
      targetVdy[idx] = lerp(1, flow.normalY[idx], basisWeight) * frequency;
      anchorWeight[idx] = coordinateAnchor * lerp(1, 1 - options.fineAnchorRelax, fine);
      u[idx] = x;
      v[idx] = y;
    }
  }

  // Fast approximation: Gauss-Seidel with line relaxation
  // Much faster than CG with similar visual quality
  const iterations = Math.min(options.coordinateIterations, 10);
  const omega = 1.3; // Successive over-relaxation factor (higher for faster convergence)
  
  for (let iter = 0; iter < iterations; iter++) {
    // Red-black Gauss-Seidel for better parallelization and convergence
    // Red pass
    for (let y = 0; y < height; y++) {
      for (let x = (y % 2); x < width; x += 2) {
        updateCoordinate(u, v, x, y, width, height, targetUdx, targetUdy, targetVdx, targetVdy, anchorWeight, omega);
      }
    }
    // Black pass
    for (let y = 0; y < height; y++) {
      for (let x = 1 - (y % 2); x < width; x += 2) {
        updateCoordinate(u, v, x, y, width, height, targetUdx, targetUdy, targetVdx, targetVdy, anchorWeight, omega);
      }
    }
  }

  return { u, v };
}

function updateCoordinate(u, v, x, y, width, height, targetUdx, targetUdy, targetVdx, targetVdy, anchorWeight, omega) {
  const idx = y * width + x;
  const anchor = anchorWeight[idx];
  
  // Gather neighbors with centered differences
  let uSum = 0, vSum = 0;
  let weightSum = 0;
  
  if (x > 0) {
    const left = idx - 1;
    const w = 1.0;
    // Left neighbor contributes based on target derivative between cells
    uSum += w * (u[left] + 0.5 * (targetUdx[left] + targetUdx[idx]));
    vSum += w * (v[left] + 0.5 * (targetVdx[left] + targetVdx[idx]));
    weightSum += w;
  }
  if (x + 1 < width) {
    const right = idx + 1;
    const w = 1.0;
    uSum += w * (u[right] - 0.5 * (targetUdx[idx] + targetUdx[right]));
    vSum += w * (v[right] - 0.5 * (targetVdx[idx] + targetVdx[right]));
    weightSum += w;
  }
  if (y > 0) {
    const up = idx - width;
    const w = 1.0;
    uSum += w * (u[up] + 0.5 * (targetUdy[up] + targetUdy[idx]));
    vSum += w * (v[up] + 0.5 * (targetVdy[up] + targetVdy[idx]));
    weightSum += w;
  }
  if (y + 1 < height) {
    const down = idx + width;
    const w = 1.0;
    uSum += w * (u[down] - 0.5 * (targetUdy[idx] + targetUdy[down]));
    vSum += w * (v[down] - 0.5 * (targetVdy[idx] + targetVdy[down]));
    weightSum += w;
  }
  
  // Anchor term pulls toward original grid position
  const targetU = x;
  const targetV = y;
  
  // Solve: (anchor + weightSum) * u_new = anchor * target + uSum
  const newU = (anchor * targetU + uSum) / (anchor + weightSum + 1e-10);
  const newV = (anchor * targetV + vSum) / (anchor + weightSum + 1e-10);
  
  // SOR update
  u[idx] = (1 - omega) * u[idx] + omega * newU;
  v[idx] = (1 - omega) * v[idx] + omega * newV;
}

function boxBlurWeighted(input, weight, width, height, radius) {
  if (radius <= 0) return new Float32Array(input);
  
  const temp = new Float32Array(width * height);
  const output = new Float32Array(width * height);
  const diameter = radius * 2 + 1;
  
  // Horizontal pass using sliding window
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    let sum = 0;
    let weightSum = 0;
    
    // Initialize window
    for (let kx = -radius; kx <= radius; kx++) {
      const sx = kx < 0 ? 0 : kx >= width ? width - 1 : kx;
      const idx = rowStart + sx;
      const w = weight[idx] + 1e-6;
      sum += input[idx] * w;
      weightSum += w;
    }
    temp[rowStart] = sum / weightSum;
    
    // Slide window
    for (let x = 1; x < width; x++) {
      const leftOut = x - radius - 1;
      const leftIdx = rowStart + (leftOut < 0 ? 0 : leftOut);
      const rightIn = x + radius;
      const rightIdx = rowStart + (rightIn >= width ? width - 1 : rightIn);
      
      const wLeft = weight[leftIdx] + 1e-6;
      const wRight = weight[rightIdx] + 1e-6;
      
      sum = sum - input[leftIdx] * wLeft + input[rightIdx] * wRight;
      weightSum = weightSum - wLeft + wRight;
      
      temp[rowStart + x] = sum / weightSum;
    }
  }
  
  // Vertical pass using sliding window
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let weightSum = 0;
    
    // Initialize window
    for (let ky = -radius; ky <= radius; ky++) {
      const sy = ky < 0 ? 0 : ky >= height ? height - 1 : ky;
      const idx = sy * width + x;
      const w = weight[idx] + 1e-6;
      sum += temp[idx] * w;
      weightSum += w;
    }
    output[x] = sum / weightSum;
    
    // Slide window
    for (let y = 1; y < height; y++) {
      const topOut = y - radius - 1;
      const topIdx = (topOut < 0 ? 0 : topOut) * width + x;
      const bottomIn = y + radius;
      const bottomIdx = (bottomIn >= height ? height - 1 : bottomIn) * width + x;
      
      const wTop = weight[topIdx] + 1e-6;
      const wBottom = weight[bottomIdx] + 1e-6;
      
      sum = sum - temp[topIdx] * wTop + temp[bottomIdx] * wBottom;
      weightSum = weightSum - wTop + wBottom;
      
      output[y * width + x] = sum / weightSum;
    }
  }
  
  return output;
}

module.exports = {
  computeContourFlow,
  solveCurvedCoordinates
};

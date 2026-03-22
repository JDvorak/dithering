const { clampInt, clamp01 } = require('./math');

function extractLuminance(rgba, count) {
  const luma = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = rgba[i * 4] / 255;
    const g = rgba[i * 4 + 1] / 255;
    const b = rgba[i * 4 + 2] / 255;
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return luma;
}

function computeGradients(luma, width, height) {
  const count = width * height;
  const gx = new Float32Array(count);
  const gy = new Float32Array(count);
  const grad = new Float32Array(count);
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  let maxGrad = 1e-6;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      let sx = 0;
      let sy = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sample = luma[(y + ky) * width + (x + kx)];
          const kernelIndex = (ky + 1) * 3 + (kx + 1);
          sx += sample * sobelX[kernelIndex];
          sy += sample * sobelY[kernelIndex];
        }
      }
      gx[idx] = sx;
      gy[idx] = sy;
      grad[idx] = Math.hypot(sx, sy);
      if (grad[idx] > maxGrad) maxGrad = grad[idx];
    }
  }

  const invMax = 1 / maxGrad;
  for (let i = 0; i < count; i++) {
    grad[i] *= invMax;
  }

  return { gx, gy, grad };
}

function boxBlur(input, width, height, radius) {
  if (radius <= 0) return new Float32Array(input);
  
  const temp = new Float32Array(width * height);
  const output = new Float32Array(width * height);
  const diameter = radius * 2 + 1;
  
  // Horizontal pass using sliding window
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    let sum = 0;
    
    // Initialize window
    for (let kx = -radius; kx <= radius; kx++) {
      const sx = clampInt(kx, 0, width - 1);
      sum += input[rowStart + sx];
    }
    temp[rowStart] = sum / diameter;
    
    // Slide window
    for (let x = 1; x < width; x++) {
      const leftOut = clampInt(x - radius - 1, 0, width - 1);
      const rightIn = clampInt(x + radius, 0, width - 1);
      sum = sum - input[rowStart + leftOut] + input[rowStart + rightIn];
      temp[rowStart + x] = sum / diameter;
    }
  }
  
  // Vertical pass using sliding window
  for (let x = 0; x < width; x++) {
    let sum = 0;
    
    // Initialize window
    for (let ky = -radius; ky <= radius; ky++) {
      const sy = clampInt(ky, 0, height - 1);
      sum += temp[sy * width + x];
    }
    output[x] = sum / diameter;
    
    // Slide window
    for (let y = 1; y < height; y++) {
      const topOut = clampInt(y - radius - 1, 0, height - 1);
      const bottomIn = clampInt(y + radius, 0, height - 1);
      sum = sum - temp[topOut * width + x] + temp[bottomIn * width + x];
      output[y * width + x] = sum / diameter;
    }
  }
  
  return output;
}

function computeCoarseLab(rgba, width, height, down, coarseWidth, coarseHeight, rgbToLab) {
  const coarseL = new Float32Array(coarseWidth * coarseHeight);
  const coarseA = new Float32Array(coarseWidth * coarseHeight);
  const coarseB = new Float32Array(coarseWidth * coarseHeight);
  for (let cy = 0; cy < coarseHeight; cy++) {
    const y = Math.min(height - 1, cy * down + (down >> 1));
    for (let cx = 0; cx < coarseWidth; cx++) {
      const x = Math.min(width - 1, cx * down + (down >> 1));
      const base = (y * width + x) * 4;
      const lab = rgbToLab(rgba[base] / 255, rgba[base + 1] / 255, rgba[base + 2] / 255);
      const idx = cy * coarseWidth + cx;
      coarseL[idx] = lab.l;
      coarseA[idx] = lab.a;
      coarseB[idx] = lab.b;
    }
  }
  return { l: coarseL, a: coarseA, b: coarseB };
}

function upsampleRegionEntropy(coarseEntropy, labels, width, height, down, coarseWidth, coarseHeight, boxBlurFn, lerpFn) {
  const entropy = new Float32Array(width * height);
  const fullLabels = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = (y / down) - 0.5;
    const y0 = clampInt(Math.floor(gy), 0, coarseHeight - 1);
    const y1 = clampInt(y0 + 1, 0, coarseHeight - 1);
    const fy = clamp01(gy - y0);
    for (let x = 0; x < width; x++) {
      const gx = (x / down) - 0.5;
      const x0 = clampInt(Math.floor(gx), 0, coarseWidth - 1);
      const x1 = clampInt(x0 + 1, 0, coarseWidth - 1);
      const fx = clamp01(gx - x0);
      const a = coarseEntropy[y0 * coarseWidth + x0];
      const b = coarseEntropy[y0 * coarseWidth + x1];
      const c = coarseEntropy[y1 * coarseWidth + x0];
      const d = coarseEntropy[y1 * coarseWidth + x1];
      const top = lerpFn(a, b, fx);
      const bottom = lerpFn(c, d, fx);
      const idx = y * width + x;
      entropy[idx] = lerpFn(top, bottom, fy);
      const nearestX = fx < 0.5 ? x0 : x1;
      const nearestY = fy < 0.5 ? y0 : y1;
      fullLabels[idx] = labels[nearestY * coarseWidth + nearestX];
    }
  }
  return { entropy: boxBlurFn(entropy, width, height, 1), labels: fullLabels };
}

module.exports = {
  extractLuminance,
  computeGradients,
  boxBlur,
  computeCoarseLab,
  upsampleRegionEntropy
};

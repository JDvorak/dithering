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
  let u = new Float32Array(count);
  let v = new Float32Array(count);
  let nextU = new Float32Array(count);
  let nextV = new Float32Array(count);
  const targetUdx = new Float32Array(count);
  const targetUdy = new Float32Array(count);
  const targetVdx = new Float32Array(count);
  const targetVdy = new Float32Array(count);
  const anchorWeight = new Float32Array(count);

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
        1 + options.frequencyWarp * edge + options.entropyFrequencyStrength * entropyShift + options.fineFrequencyBoost * fine,
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
      nextU[idx] = x;
      nextV[idx] = y;
    }
  }

  // Pre-compute direction derivatives for efficiency
  const udxLeft = new Float32Array(count);
  const udxRight = new Float32Array(count);
  const udyUp = new Float32Array(count);
  const udyDown = new Float32Array(count);
  const vdxLeft = new Float32Array(count);
  const vdxRight = new Float32Array(count);
  const vdyUp = new Float32Array(count);
  const vdyDown = new Float32Array(count);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (x > 0) {
        const left = idx - 1;
        udxLeft[idx] = 0.5 * (targetUdx[left] + targetUdx[idx]);
        vdxLeft[idx] = 0.5 * (targetVdx[left] + targetVdx[idx]);
      }
      if (x + 1 < width) {
        const right = idx + 1;
        udxRight[idx] = 0.5 * (targetUdx[idx] + targetUdx[right]);
        vdxRight[idx] = 0.5 * (targetVdx[idx] + targetVdx[right]);
      }
      if (y > 0) {
        const up = idx - width;
        udyUp[idx] = 0.5 * (targetUdy[up] + targetUdy[idx]);
        vdyUp[idx] = 0.5 * (targetVdy[up] + targetVdy[idx]);
      }
      if (y + 1 < height) {
        const down = idx + width;
        udyDown[idx] = 0.5 * (targetUdy[idx] + targetUdy[down]);
        vdyDown[idx] = 0.5 * (targetVdy[idx] + targetVdy[down]);
      }
    }
  }
  
  // Conjugate Gradient solver for better convergence
  // Solves: A*u = b where A is the discrete Laplacian with varying weights
  const result = solveWithCG(u, v, width, height, anchorWeight, udxLeft, udxRight, udyUp, udyDown, 
                             vdxLeft, vdxRight, vdyUp, vdyDown, options.coordinateIterations, 1e-4);

  return result;
}

function boxBlurWeighted(input, weight, width, height, radius) {
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weightSum = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const sy = y + ky < 0 ? 0 : y + ky >= height ? height - 1 : y + ky;
        for (let kx = -radius; kx <= radius; kx++) {
          const sx = x + kx < 0 ? 0 : x + kx >= width ? width - 1 : x + kx;
          const idx = sy * width + sx;
          const w = weight[idx] + 1e-6;
          sum += input[idx] * w;
          weightSum += w;
        }
      }
      output[y * width + x] = sum / weightSum;
    }
  }
  return output;
}

function solveWithCG(u, v, width, height, anchorWeight, udxLeft, udxRight, udyUp, udyDown,
                     vdxLeft, vdxRight, vdyUp, vdyDown, maxIters, tol) {
  const count = width * height;
  
  // Build right-hand side (b) for both u and v
  const bu = new Float32Array(count);
  const bv = new Float32Array(count);
  const diag = new Float32Array(count); // Diagonal preconditioner
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const anchor = anchorWeight[idx];
      
      // RHS: anchor * position + boundary terms from derivatives
      bu[idx] = anchor * x;
      bv[idx] = anchor * y;
      
      let degree = 0;
      if (x > 0) {
        bu[idx] += udxLeft[idx];
        bv[idx] += vdxLeft[idx];
        degree++;
      }
      if (x + 1 < width) {
        bu[idx] -= udxRight[idx];
        bv[idx] -= vdxRight[idx];
        degree++;
      }
      if (y > 0) {
        bu[idx] += udyUp[idx];
        bv[idx] += vdyUp[idx];
        degree++;
      }
      if (y + 1 < height) {
        bu[idx] -= udyDown[idx];
        bv[idx] -= vdyDown[idx];
        degree++;
      }
      
      // Diagonal of A is (anchor + degree)
      diag[idx] = anchor + degree;
    }
  }
  
  // Conjugate Gradient for u
  u = conjugateGradient(u, bu, diag, width, height, anchorWeight, maxIters, tol);
  
  // Conjugate Gradient for v
  v = conjugateGradient(v, bv, diag, width, height, anchorWeight, maxIters, tol);
  
  return { u, v };
}

function conjugateGradient(x, b, diag, width, height, anchorWeight, maxIters, tol) {
  const count = width * height;
  const r = new Float32Array(count); // Residual
  const z = new Float32Array(count); // Preconditioned residual
  const p = new Float32Array(count); // Search direction
  const Ap = new Float32Array(count); // A * p
  
  // Initial residual: r = b - A*x
  applyA(x, Ap, width, height, anchorWeight);
  for (let i = 0; i < count; i++) {
    r[i] = b[i] - Ap[i];
    z[i] = r[i] / (diag[i] + 1e-10); // Jacobi preconditioning
    p[i] = z[i];
  }
  
  let rzOld = dotProduct(r, z);
  const bNorm = Math.sqrt(dotProduct(b, b));
  const threshold = tol * bNorm;
  
  for (let iter = 0; iter < maxIters; iter++) {
    // Ap = A * p
    applyA(p, Ap, width, height, anchorWeight);
    
    const pAp = dotProduct(p, Ap);
    if (Math.abs(pAp) < 1e-10) break;
    
    const alpha = rzOld / pAp;
    
    // x = x + alpha * p
    // r = r - alpha * Ap
    for (let i = 0; i < count; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }
    
    // Check convergence
    const rNorm = Math.sqrt(dotProduct(r, r));
    if (rNorm < threshold) break;
    
    // z = M^-1 * r (Jacobi preconditioning)
    for (let i = 0; i < count; i++) {
      z[i] = r[i] / (diag[i] + 1e-10);
    }
    
    const rzNew = dotProduct(r, z);
    const beta = rzNew / (rzOld + 1e-10);
    rzOld = rzNew;
    
    // p = z + beta * p
    for (let i = 0; i < count; i++) {
      p[i] = z[i] + beta * p[i];
    }
  }
  
  return x;
}

function applyA(vec, result, width, height, anchorWeight) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const anchor = anchorWeight[idx];
      let sum = anchor * vec[idx];
      let degree = 0;
      
      if (x > 0) {
        sum -= vec[idx - 1];
        degree++;
      }
      if (x + 1 < width) {
        sum -= vec[idx + 1];
        degree++;
      }
      if (y > 0) {
        sum -= vec[idx - width];
        degree++;
      }
      if (y + 1 < height) {
        sum -= vec[idx + width];
        degree++;
      }
      
      result[idx] = sum + degree * vec[idx];
    }
  }
}

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

module.exports = {
  computeContourFlow,
  solveCurvedCoordinates
};

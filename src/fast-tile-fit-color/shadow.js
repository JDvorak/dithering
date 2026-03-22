const { boxBlur } = require('../randomwalk-bw/image');
const { clamp01 } = require('../randomwalk-bw/math');
const { computeLabImage } = require('./color');

function estimateShadowFreeImage(rgba, labImage, luma, width, height, options) {
  const count = width * height;
  const smooth = boxBlur(luma, width, height, Math.max(2, options.shadowBlurRadius | 0));
  const ratio = new Float32Array(count);
  for (let i = 0; i < count; i++) ratio[i] = luma[i] / Math.max(1e-4, smooth[i]);

  const qLow = quantile(ratio, clamp01(options.shadowLowQuantile));
  const qHigh = quantile(ratio, clamp01(options.shadowHighQuantile));
  const inv = 1 / Math.max(1e-4, qHigh - qLow);
  const strength = new Float32Array(count);
  const lumaFree = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const s = clamp01((qHigh - ratio[i]) * inv);
    strength[i] = Math.pow(s, Math.max(0.2, options.shadowGamma));
    const relit = luma[i] * (qHigh / Math.max(1e-4, ratio[i]));
    lumaFree[i] = clamp01(luma[i] * (1 - strength[i] * options.shadowRelightStrength) + relit * strength[i] * options.shadowRelightStrength);
  }

  const wb = estimateGrayBalance(rgba, labImage, width, height, options);
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < count; i++) {
    const base = i * 4;
    const srcR = rgba[base] / 255;
    const srcG = rgba[base + 1] / 255;
    const srcB = rgba[base + 2] / 255;
    const yl = luma[i];
    const yt = lumaFree[i];
    const scale = yt / Math.max(1e-4, yl);

    const rr = clamp01(srcR * scale * wb.r);
    const gg = clamp01(srcG * scale * wb.g);
    const bb = clamp01(srcB * scale * wb.b);
    out[base] = Math.round(rr * 255);
    out[base + 1] = Math.round(gg * 255);
    out[base + 2] = Math.round(bb * 255);
    out[base + 3] = 255;
  }

  return {
    shadowStrength: strength,
    shadowFreeRgba: out,
    shadowFreeLab: computeLabImage(out, width, height),
    shadowFreeLuma: lumaFree,
    whiteBalance: wb
  };
}

function estimateGrayBalance(rgba, labImage, width, height, options) {
  const count = width * height;
  const chromaThreshold = Math.max(2, options.grayChromaThreshold);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let n = 0;

  for (let i = 0; i < count; i++) {
    const a = labImage.a[i];
    const b = labImage.b[i];
    const chroma = Math.hypot(a, b);
    if (chroma > chromaThreshold) continue;
    const base = i * 4;
    sumR += rgba[base] / 255;
    sumG += rgba[base + 1] / 255;
    sumB += rgba[base + 2] / 255;
    n += 1;
  }

  if (n < 32) return { r: 1, g: 1, b: 1 };
  const meanR = sumR / n;
  const meanG = sumG / n;
  const meanB = sumB / n;
  const gray = (meanR + meanG + meanB) / 3;
  const strength = clamp01(options.grayBalanceStrength);
  return {
    r: clamp(1 + strength * (gray / Math.max(1e-4, meanR) - 1), 0.5, 1.8),
    g: clamp(1 + strength * (gray / Math.max(1e-4, meanG) - 1), 0.5, 1.8),
    b: clamp(1 + strength * (gray / Math.max(1e-4, meanB) - 1), 0.5, 1.8)
  };
}

function quantile(values, q) {
  const arr = Array.from(values);
  arr.sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(arr.length - 1, Math.floor((arr.length - 1) * q)));
  return arr[idx];
}

module.exports = {
  estimateShadowFreeImage
};

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

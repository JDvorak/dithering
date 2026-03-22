const { clamp01 } = require('../randomwalk-bw/math');

function rgbToLab(r, g, b) {
  const rl = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const gl = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const bl = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;

  const fx = labPivot(x / 0.95047);
  const fy = labPivot(y / 1.0);
  const fz = labPivot(z / 1.08883);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

function labToRgb(lab) {
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const x = 0.95047 * labPivotInv(fx);
  const y = 1.0 * labPivotInv(fy);
  const z = 1.08883 * labPivotInv(fz);

  let r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let g = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  let b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  r = r <= 0.0031308 ? 12.92 * r : 1.055 * Math.pow(Math.max(0, r), 1 / 2.4) - 0.055;
  g = g <= 0.0031308 ? 12.92 * g : 1.055 * Math.pow(Math.max(0, g), 1 / 2.4) - 0.055;
  b = b <= 0.0031308 ? 12.92 * b : 1.055 * Math.pow(Math.max(0, b), 1 / 2.4) - 0.055;
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

function computeLabImage(rgba, width, height) {
  const count = width * height;
  const l = new Float32Array(count);
  const a = new Float32Array(count);
  const b = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const base = i * 4;
    const lab = rgbToLab(rgba[base] / 255, rgba[base + 1] / 255, rgba[base + 2] / 255);
    l[i] = lab.l;
    a[i] = lab.a;
    b[i] = lab.b;
  }
  return { l, a, b };
}

function labDistanceSq(l1, a1, b1, l2, a2, b2) {
  const dl = l1 - l2;
  const da = a1 - a2;
  const db = b1 - b2;
  return dl * dl + da * da + db * db;
}

function labPivot(t) {
  return t > 0.008856451679035631 ? Math.cbrt(t) : 7.787037037037037 * t + 16 / 116;
}

function labPivotInv(t) {
  const t3 = t * t * t;
  return t3 > 0.008856451679035631 ? t3 : (t - 16 / 116) / 7.787037037037037;
}

module.exports = {
  rgbToLab,
  labToRgb,
  computeLabImage,
  labDistanceSq
};

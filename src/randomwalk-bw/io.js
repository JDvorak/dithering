const fs = require('fs');

let createCanvas;
let loadImage;
let ImageData;

try {
  const canvas = require('canvas');
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
  ImageData = canvas.ImageData;
} catch (error) {
  console.error('Missing dependency: `canvas`. Run `npm install`.');
  process.exit(1);
}

async function loadImageData(inputPath) {
  const image = await loadImage(inputPath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

function saveImageData(outputPath, imageData) {
  const canvas = createCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
}

function createGrayscaleImageData(binary, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < binary.length; i++) {
    const value = binary[i] ? 255 : 0;
    const base = i * 4;
    rgba[base] = value;
    rgba[base + 1] = value;
    rgba[base + 2] = value;
    rgba[base + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

function createToneImageData(tone, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < tone.length; i++) {
    const t = tone[i] < 0 ? 0 : tone[i] > 1 ? 1 : tone[i];
    const value = Math.round(t * 255);
    const base = i * 4;
    rgba[base] = value;
    rgba[base + 1] = value;
    rgba[base + 2] = value;
    rgba[base + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

function createRgbaImageData(rgba, width, height) {
  return new ImageData(rgba, width, height);
}

module.exports = {
  loadImageData,
  saveImageData,
  createGrayscaleImageData,
  createToneImageData,
  createRgbaImageData
};

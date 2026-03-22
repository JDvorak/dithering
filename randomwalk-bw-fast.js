#!/usr/bin/env node

const fs = require('fs');
const { createCanvas } = require('canvas');
const { loadImageData } = require('./src/randomwalk-bw/io');
const { runRandomwalkBw } = require('./src/randomwalk-bw/pipeline-fast');

const inputPath = process.argv[2] || 'test1.png';
const outputPath = process.argv[3] || '/tmp/test_fast.png';

console.log(`Processing ${inputPath} (fast pipeline)...`);
const startTime = Date.now();

const imageData = loadImageData(inputPath);
const result = runRandomwalkBw(imageData, {
  parkerPeriod: 1,
  parkerMaskSize: 64,
  maskCandidates: 12,
  bendStrength: 0.7,
  frequencyWarp: 0.35,
  coordinateIterations: 40,
  coordinateAnchor: 0.08,
  entropyDensityStrength: 0.18,
  fineBendBoost: 0.55,
  fineFrequencyBoost: 0.2,
  fineAnchorRelax: 0.5,
  fineThresholdBoost: 0.06,
  orientationRadius: 3,
  edgeLow: 0.08,
  edgeHigh: 0.32
});

const processTime = Date.now() - startTime;
console.log(`Processing: ${processTime}ms`);

// Save using canvas
const canvas = createCanvas(result.width, result.height);
const ctx = canvas.getContext('2d');
const imgData = ctx.createImageData(result.width, result.height);
const data = imgData.data;

for (let i = 0, j = 0; i < result.binary.length; i++, j += 4) {
  const val = result.binary[i] * 255;
  data[j] = val;
  data[j + 1] = val;
  data[j + 2] = val;
  data[j + 3] = 255;
}

ctx.putImageData(imgData, 0, 0);
fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));

const totalTime = Date.now() - startTime;
console.log(`Total: ${totalTime}ms`);
console.log(`Saved ${outputPath}`);
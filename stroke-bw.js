#!/usr/bin/env node

const { loadImageData, saveImageData } = require('./src/randomwalk-bw/io');
const { runRandomwalkBw } = require('./src/randomwalk-bw/pipeline');
const { renderStrokesFromMask, renderSampledDots } = require('./src/randomwalk-bw/strokes-pure');

const DEFAULTS = {
  strokeLength: 5,
  strokeOpacity: 0.25,
  decayRate: 2.0,
  flowSmooth: 2,
  sampleRate: 0.3,  // Only use 30% of dithered pixels
  useDots: false,   // Use dots instead of strokes
  // Dithering options
  bendStrength: 0.7,
  coordinateIterations: 40,
  coordinateAnchor: 0.08,
  entropyDensityStrength: 0.18,
  fineBendBoost: 0.55,
  fineThresholdBoost: 0.06,
  orientationRadius: 3,
  edgeLow: 0.08,
  edgeHigh: 0.32
};

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    printUsage();
    process.exit(1);
  }

  const inputPath = args[0];
  const outputPath = args[1];
  const options = parseOptions(args.slice(2));

  console.log(`Processing ${inputPath}...`);
  const imageData = await loadImageData(inputPath);
  
  const width = imageData.width;
  const height = imageData.height;
  const count = width * height;
  
  // Step 1: Run dithering to get artistic pixel placement
  console.time('dither');
  const dithered = runRandomwalkBw(imageData, {
    bendStrength: options.bendStrength,
    coordinateIterations: options.coordinateIterations,
    coordinateAnchor: options.coordinateAnchor,
    entropyDensityStrength: options.entropyDensityStrength,
    fineBendBoost: options.fineBendBoost,
    fineThresholdBoost: options.fineThresholdBoost,
    orientationRadius: options.orientationRadius,
    edgeLow: options.edgeLow,
    edgeHigh: options.edgeHigh
  });
  console.timeEnd('dither');
  
  // Step 2: Render strokes or dots from the dithered "on" pixels
  console.time(options.useDots ? 'dots' : 'strokes');
  let output;
  if (options.useDots) {
    output = renderSampledDots(
      dithered.binary,
      dithered.luma,
      width,
      height,
      { sampleRate: options.sampleRate }
    );
  } else {
    output = renderStrokesFromMask(
      dithered.binary,
      dithered.luma,
      dithered.gx,
      dithered.gy,
      dithered.grad,
      width,
      height,
      {
        strokeLength: options.strokeLength,
        strokeOpacity: options.strokeOpacity,
        decayRate: options.decayRate,
        flowFieldSmooth: options.flowSmooth,
        sampleRate: options.sampleRate
      }
    );
  }
  console.timeEnd(options.useDots ? 'dots' : 'strokes');
  
  // Convert to image
  const { createCanvas } = require('canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  
  for (let i = 0; i < count; i++) {
    const val = Math.max(0, Math.min(255, Math.round(output[i] * 255)));
    const base = i * 4;
    imgData.data[base] = val;
    imgData.data[base + 1] = val;
    imgData.data[base + 2] = val;
    imgData.data[base + 3] = 255;
  }
  
  ctx.putImageData(imgData, 0, 0);
  const fs = require('fs');
  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
  
  console.log(`Saved ${outputPath}`);
}

function parseOptions(args) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dots') options.useDots = true;
    else if (arg.startsWith('--len=')) options.strokeLength = parseInt(arg.slice(6), 10);
    else if (arg.startsWith('--opacity=')) options.strokeOpacity = parseFloat(arg.slice(10));
    else if (arg.startsWith('--decay=')) options.decayRate = parseFloat(arg.slice(8));
    else if (arg.startsWith('--flow-smooth=')) options.flowSmooth = parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--sample=')) options.sampleRate = parseFloat(arg.slice(9));
    // Dithering options
    else if (arg.startsWith('--bend=')) options.bendStrength = parseFloat(arg.slice(7));
    else if (arg.startsWith('--coord-iters=')) options.coordinateIterations = parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--coord-anchor=')) options.coordinateAnchor = parseFloat(arg.slice(15));
    else if (arg.startsWith('--entropy-dens=')) options.entropyDensityStrength = parseFloat(arg.slice(15));
    else if (arg.startsWith('--fine-bend=')) options.fineBendBoost = parseFloat(arg.slice(12));
    else if (arg.startsWith('--fine-thresh=')) options.fineThresholdBoost = parseFloat(arg.slice(14));
    else if (arg.startsWith('--orient-radius=')) options.orientationRadius = parseInt(arg.slice(16), 10);
    else if (arg.startsWith('--edge-low=')) options.edgeLow = parseFloat(arg.slice(11));
    else if (arg.startsWith('--edge-high=')) options.edgeHigh = parseFloat(arg.slice(12));
  }
  return options;
}

function printUsage() {
  console.log('Usage: node stroke-bw.js <input-image> <output-image> [options]');
  console.log('');
  console.log('Uses dithered pixels as stroke origins, then draws tangent strokes');
  console.log('');
  console.log('Stroke Options:');
  console.log('  --len=<n>          stroke length (default: 5)');
  console.log('  --opacity=<f>      stroke opacity 0-1 (default: 0.25)');
  console.log('  --decay=<f>        opacity decay rate (default: 2.0)');
  console.log('  --flow-smooth=<n>  flow field smoothing radius (default: 2)');
  console.log('  --sample=<f>       sampling rate 0-1 (default: 0.3, lower=sparser)');
  console.log('  --dots             render dots instead of strokes');
  console.log('');
  console.log('Dithering Options:');
  console.log('  --bend=<f>           contour bend strength (default: 0.7)');
  console.log('  --coord-iters=<n>    curved coordinate iterations (default: 40)');
  console.log('  --coord-anchor=<f>   curved coordinate anchor (default: 0.08)');
  console.log('  --entropy-dens=<f>   entropy threshold bias (default: 0.18)');
  console.log('  --fine-bend=<f>      short-scale bend boost (default: 0.55)');
  console.log('  --fine-thresh=<f>    threshold bias for fine lines (default: 0.06)');
  console.log('  --orient-radius=<n>  contour orientation blur radius (default: 3)');
  console.log('  --edge-low=<f>       edge low threshold (default: 0.08)');
  console.log('  --edge-high=<f>      edge high threshold (default: 0.32)');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
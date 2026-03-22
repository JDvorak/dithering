#!/usr/bin/env node

const { loadImageData, saveImageData, createGrayscaleImageData } = require('./src/randomwalk-bw/io');
const { runRandomwalkBw } = require('./src/randomwalk-bw/pipeline');
const { renderStrokes } = require('./src/randomwalk-bw/strokes');

const DEFAULTS = {
  parkerPeriod: 1,
  parkerMaskSize: 64,
  maskCandidates: 12,
  bendStrength: 0.7,
  frequencyWarp: 0.35,
  coordinateIterations: 40,
  coordinateAnchor: 0.08,
  entropyFrequencyStrength: 0.45,
  entropyDensityStrength: 0.18,
  fineBendBoost: 0.55,
  fineFrequencyBoost: 0.2,
  fineAnchorRelax: 0.5,
  fineThresholdBoost: 0.06,
  orientationRadius: 3,
  edgeLow: 0.08,
  edgeHigh: 0.32,
  // Stroke options
  strokeLength: 3,
  strokeOpacity: 0.8,
  strokeWidth: 1.0,
  enableStrokes: false
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
  
  // Run dithering pipeline
  console.time('dither');
  const dithered = runRandomwalkBw(imageData, options);
  console.timeEnd('dither');
  
  let finalOutput;
  
  if (options.enableStrokes) {
    console.time('strokes');
    // Render strokes from dithered output
    const strokeOutput = renderStrokes(
      dithered.binary,
      dithered.luma,
      dithered.grad,
      dithered.gx,
      dithered.gy,
      dithered.width,
      dithered.height,
      {
        maxStrokeLength: options.strokeLength,
        strokeOpacity: options.strokeOpacity,
        strokeWidth: options.strokeWidth
      }
    );
    console.timeEnd('strokes');
    
    // Convert to binary for output
    finalOutput = new Uint8Array(dithered.width * dithered.height);
    for (let i = 0; i < strokeOutput.length; i++) {
      finalOutput[i] = strokeOutput[i] > 0.5 ? 1 : 0;
    }
  } else {
    finalOutput = dithered.binary;
  }
  
  saveImageData(outputPath, createGrayscaleImageData(finalOutput, dithered.width, dithered.height));
  console.log(`Saved ${outputPath}`);
}

function parseOptions(args) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--bend=')) options.bendStrength = parseFloat(arg.slice(7));
    else if (arg.startsWith('--period=')) options.parkerPeriod = parseFloat(arg.slice(9));
    else if (arg.startsWith('--parker-size=')) options.parkerMaskSize = parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--candidates=')) options.maskCandidates = parseInt(arg.slice(13), 10);
    else if (arg.startsWith('--coord-iters=')) options.coordinateIterations = parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--coord-anchor=')) options.coordinateAnchor = parseFloat(arg.slice(15));
    else if (arg.startsWith('--entropy-freq=')) options.entropyFrequencyStrength = parseFloat(arg.slice(15));
    else if (arg.startsWith('--entropy-dens=')) options.entropyDensityStrength = parseFloat(arg.slice(15));
    else if (arg.startsWith('--fine-bend=')) options.fineBendBoost = parseFloat(arg.slice(12));
    else if (arg.startsWith('--fine-freq=')) options.fineFrequencyBoost = parseFloat(arg.slice(12));
    else if (arg.startsWith('--fine-anchor=')) options.fineAnchorRelax = parseFloat(arg.slice(14));
    else if (arg.startsWith('--fine-thresh=')) options.fineThresholdBoost = parseFloat(arg.slice(14));
    else if (arg.startsWith('--freq-warp=')) options.frequencyWarp = parseFloat(arg.slice(12));
    else if (arg.startsWith('--orient-radius=')) options.orientationRadius = parseInt(arg.slice(16), 10);
    else if (arg.startsWith('--edge-low=')) options.edgeLow = parseFloat(arg.slice(11));
    else if (arg.startsWith('--edge-high=')) options.edgeHigh = parseFloat(arg.slice(12));
    // Stroke options
    else if (arg === '--strokes') options.enableStrokes = true;
    else if (arg.startsWith('--stroke-len=')) options.strokeLength = parseInt(arg.slice(13), 10);
    else if (arg.startsWith('--stroke-opacity=')) options.strokeOpacity = parseFloat(arg.slice(17));
    else if (arg.startsWith('--stroke-width=')) options.strokeWidth = parseFloat(arg.slice(15));
  }
  return options;
}

function printUsage() {
  console.log('Usage: node stroke-bw.js <input-image> <output-image> [options]');
  console.log('');
  console.log('Dithering Options:');
  console.log('  --bend=<f>           contour bend strength (default: 0.7)');
  console.log('  --period=<f>         Parker coordinate scale (default: 1)');
  console.log('  --coord-iters=<n>    curved coordinate iterations (default: 40)');
  console.log('');
  console.log('Stroke Options:');
  console.log('  --strokes             enable stroke rendering');
  console.log('  --stroke-len=<n>     max stroke length in pixels (default: 3)');
  console.log('  --stroke-opacity=<f>  stroke opacity (default: 0.8)');
  console.log('  --stroke-width=<f>    stroke width (default: 1.0)');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
#!/usr/bin/env node

const { loadImageData, saveImageData, createGrayscaleImageData } = require('./src/randomwalk-bw/io');
const { runRandomwalkBw } = require('./src/randomwalk-bw/pipeline');

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
  const result = runRandomwalkBw(imageData, options);
  saveImageData(outputPath, createGrayscaleImageData(result.binary, result.width, result.height));
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
  }
  return options;
}

function printUsage() {
  console.log('Usage: node randomwalk-bw.js <input-image> <output-image> [options]');
  console.log('Options:');
  console.log('  --bend=<f>           contour bend strength (default: 0.7)');
  console.log('  --period=<f>         Parker coordinate scale (default: 1)');
  console.log('  --parker-size=<n>    Parker mask size (default: 64)');
  console.log('  --candidates=<n>     progressive mask candidate count (default: 12)');
  console.log('  --coord-iters=<n>    curved coordinate iterations (default: 40)');
  console.log('  --coord-anchor=<f>   curved coordinate anchor (default: 0.08)');
  console.log('  --entropy-freq=<f>   entropy frequency modulation (default: 0.45)');
  console.log('  --entropy-dens=<f>   entropy threshold bias (default: 0.18)');
  console.log('  --fine-bend=<f>      short-scale bend boost (default: 0.55)');
  console.log('  --fine-freq=<f>      short-scale frequency boost (default: 0.2)');
  console.log('  --fine-anchor=<f>    anchor relaxation on fine lines (default: 0.5)');
  console.log('  --fine-thresh=<f>    threshold bias for fine lines (default: 0.06)');
  console.log('  --freq-warp=<f>      contour frequency warp (default: 0.35)');
  console.log('  --orient-radius=<n>  contour orientation blur radius (default: 3)');
  console.log('  --edge-low=<f>       edge low threshold (default: 0.08)');
  console.log('  --edge-high=<f>      edge high threshold (default: 0.32)');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
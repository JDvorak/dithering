#!/usr/bin/env node

const { ImageData } = require('canvas');
const { loadImageData, saveImageData } = require('../randomwalk-bw/io');
const { parseFastTileFitColorOptions, printFastTileFitColorOptions } = require('./options');
const { runFastTileFitColor } = require('./pipeline');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    usage();
    process.exit(1);
  }
  const inputPath = args[0];
  const outputPath = args[1];
  const options = parseFastTileFitColorOptions(args.slice(2));

  console.log(`Running fast-tile-fit-color on ${inputPath}...`);
  const imageData = await loadImageData(inputPath);
  const result = runFastTileFitColor(imageData, options);
  saveImageData(outputPath, new ImageData(result.rgba, result.width, result.height));
  console.log(`Saved ${outputPath} (palette: ${result.metadata.paletteSize}, ramps: ${result.metadata.ramps}, blocks4: ${result.metadata.blocks4})`);
}

function usage() {
  console.log('Usage: node src/fast-tile-fit-color/index.js <input-image> <output-image> [options]');
  printFastTileFitColorOptions();
}

main().catch((error) => {
  console.error('Error:', error && error.stack ? error.stack : error.message);
  process.exit(1);
});

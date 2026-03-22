#!/usr/bin/env node

const { loadImageData, saveImageData, createGrayscaleImageData } = require('./src/randomwalk-bw/io');
const { runFastTileFit } = require('./src/fast-tile-fit/pipeline');
const { parseFastTileFitOptions, printFastTileFitOptions } = require('./src/fast-tile-fit/options');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    printUsage();
    process.exit(1);
  }

  const inputPath = args[0];
  const outputPath = args[1];
  const options = parseFastTileFitOptions(args.slice(2));

  console.log(`Running fast-tile-fit on ${inputPath}...`);
  const imageData = await loadImageData(inputPath);
  const result = runFastTileFit(imageData, options);
  saveImageData(outputPath, createGrayscaleImageData(result.binary, result.width, result.height));
  console.log(
    `Saved ${outputPath} (tiles4: ${result.metadata.tileCount4}, tiles8: ${result.metadata.tileCount8}, blocks4: ${result.metadata.blocks4}, blocks8: ${result.metadata.blocks8})`
  );
}

function printUsage() {
  console.log('Usage: node fast-tile-fit.js <input-image> <output-image> [options]');
  printFastTileFitOptions();
}

main().catch((error) => {
  console.error('Error:', error && error.stack ? error.stack : error.message);
  process.exit(1);
});

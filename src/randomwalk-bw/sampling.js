/**
 * Poisson disk sampling for even but irregular point distribution
 * Returns indices of sampled pixels
 */
function poissonDiskSample(width, height, minRadius, maxSamples = null, rng = Math.random) {
  const count = width * height;
  const cellSize = minRadius / Math.sqrt(2);
  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);
  
  // Grid for spatial acceleration
  const grid = new Int32Array(gridWidth * gridHeight).fill(-1);
  
  const samples = [];
  const activeList = [];
  
  // Start with random point
  const startX = Math.floor(rng() * width);
  const startY = Math.floor(rng() * height);
  const startIdx = startY * width + startX;
  
  addSample(startX, startY, startIdx, samples, activeList, grid, cellSize, gridWidth);
  
  while (activeList.length > 0 && (!maxSamples || samples.length < maxSamples)) {
    // Pick random active sample
    const activeIdx = Math.floor(rng() * activeList.length);
    const [ax, ay] = activeList[activeIdx];
    let found = false;
    
    // Try up to 30 times to find new point
    for (let i = 0; i < 30; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = minRadius + rng() * minRadius; // Between r and 2r
      const nx = ax + Math.cos(angle) * dist;
      const ny = ay + Math.sin(angle) * dist;
      
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      
      const nix = Math.floor(nx);
      const niy = Math.floor(ny);
      const nidx = niy * width + nix;
      
      if (isValidPoint(nx, ny, nidx, minRadius, grid, cellSize, gridWidth, samples, width, height)) {
        addSample(nix, niy, nidx, samples, activeList, grid, cellSize, gridWidth);
        found = true;
        break;
      }
    }
    
    if (!found) {
      // Remove from active list
      activeList.splice(activeIdx, 1);
    }
  }
  
  return samples;
}

function addSample(x, y, idx, samples, activeList, grid, cellSize, gridWidth) {
  const sampleIdx = samples.length;
  samples.push(idx);
  activeList.push([x, y]);
  
  const gx = Math.floor(x / cellSize);
  const gy = Math.floor(y / cellSize);
  grid[gy * gridWidth + gx] = sampleIdx;
}

function isValidPoint(x, y, idx, minRadius, grid, cellSize, gridWidth, samples, width, height) {
  const gx = Math.floor(x / cellSize);
  const gy = Math.floor(y / cellSize);
  
  // Check neighboring cells
  const r = Math.ceil(minRadius / cellSize);
  const minDistSq = minRadius * minRadius;
  
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = gx + dx;
      const ny = gy + dy;
      
      if (nx < 0 || nx >= gridWidth || ny < 0) continue;
      
      const neighborIdx = grid[ny * gridWidth + nx];
      if (neighborIdx >= 0) {
        const nsx = samples[neighborIdx] % width;
        const nsy = Math.floor(samples[neighborIdx] / width);
        const distSq = (x - nsx) ** 2 + (y - nsy) ** 2;
        if (distSq < minDistSq) return false;
      }
    }
  }
  
  return true;
}

module.exports = {
  poissonDiskSample
};
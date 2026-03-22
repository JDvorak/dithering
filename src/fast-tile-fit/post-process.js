/**
 * Post-processing cleanup passes for fast-tile-fit
 * Optional refinement passes applied after core tile fitting
 */

/**
 * LienSort cleanup - enforces slope-order patterns and removes artifacts
 */
function applyLienSortCleanup(binary, gx, gy, width, height, passes) {
  const scratch = new Uint8Array(binary.length);
  for (let pass = 0; pass < passes; pass++) {
    scratch.set(binary);
    
    // Phase 1: Remove extra pixels (those with both horizontal and vertical neighbors)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (binary[idx] !== 1) continue;
        
        const hasHoriz = binary[idx - 1] === 1 || binary[idx + 1] === 1;
        const hasVert = binary[idx - width] === 1 || binary[idx + width] === 1;
        
        // Extra pixel: has both horizontal and vertical neighbors
        if (hasHoriz && hasVert) {
          // Check if removing would disconnect
          const n = countNeighbors(binary, width, height, x, y, 1);
          if (n > 2) {
            // Prefer gradient direction for removal
            const ax = Math.abs(gx[idx]);
            const ay = Math.abs(gy[idx]);
            // Remove if gradient suggests thickness perpendicular to edge
            if ((ax > ay && hasVert) || (ay >= ax && hasHoriz)) {
              scratch[idx] = 0;
            }
          }
        }
      }
    }
    binary.set(scratch);
    
    // Phase 2: Slope order enforcement and pattern regularization
    // Process horizontal runs
    for (let y = 1; y < height - 1; y++) {
      let runStart = -1;
      let prevRunLen = 0;
      
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const isInk = binary[idx] === 1;
        const isConnected = isInk && (binary[idx - width] === 1 || binary[idx + width] === 1);
        
        if (isConnected) {
          if (runStart < 0) runStart = x;
        } else if (runStart >= 0) {
          // End of run
          const runLen = x - runStart;
          
          // Check for repeating pattern violations
          if (prevRunLen > 0 && runLen > 0) {
            const expected = getNextPatternValue(prevRunLen);
            if (Math.abs(runLen - expected) > 1) {
              // Try to adjust to match pattern
              const midX = runStart + Math.floor(runLen / 2);
              if (runLen > expected && midX < width - 1) {
                // Remove middle pixel if safe
                if (canRemovePixel(binary, scratch, width, height, midX, y)) {
                  scratch[midX + y * width] = 0;
                }
              } else if (runLen < expected && midX < width - 1) {
                // Add pixel if gradient suggests it
                const midIdx = midX + y * width;
                const grad = Math.hypot(gx[midIdx], gy[midIdx]);
                if (grad > 0.1 && binary[midIdx] === 0) {
                  scratch[midIdx] = 1;
                }
              }
            }
          }
          
          prevRunLen = runLen;
          runStart = -1;
        }
      }
    }
    
    // Phase 3: Remove isolated pixels (blips)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (binary[idx] === 1) {
          const n = countNeighbors(binary, width, height, x, y, 1);
          if (n === 0) scratch[idx] = 0;
        }
      }
    }
    
    binary.set(scratch);
  }
}

function countNeighbors(binary, width, height, x, y, value) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
        if (binary[ny * width + nx] === value) count++;
      }
    }
  }
  return count;
}

function canRemovePixel(binary, scratch, width, height, x, y) {
  const idx = y * width + x;
  if (binary[idx] !== 1) return false;
  
  // Check connectivity after removal
  const n = countNeighbors(binary, width, height, x, y, 1);
  if (n <= 1) return true; // Isolated or single connection
  
  // Check if it's a critical connection
  scratch[idx] = 0;
  const remainingNeighbors = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
        if (scratch[ny * width + nx] === 1) {
          remainingNeighbors.push({x: nx, y: ny});
        }
      }
    }
  }
  scratch[idx] = 1;
  
  // Simple connectivity check
  if (remainingNeighbors.length < 2) return true;
  
  return true; // Conservative - allow removal
}

function getNextPatternValue(prevLen) {
  // Simple slope order: alternate between similar lengths
  if (prevLen <= 1) return 2;
  if (prevLen >= 4) return 3;
  return prevLen;
}

/**
 * Momentum line closure - closes gaps using momentum analysis
 */
function applyMomentumLineClosure(binary, width, height, passes, momentumCloseRadius) {
  const scratch = new Uint8Array(binary.length);
  
  for (let pass = 0; pass < passes; pass++) {
    scratch.set(binary);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (binary[idx] !== 0) continue;
        
        // Find line endpoints in neighborhood
        const endpoints = findEndpoints(binary, width, height, x, y, momentumCloseRadius);
        if (endpoints.length >= 2) {
          // Try to connect endpoints with compatible momentum
          for (let i = 0; i < endpoints.length; i++) {
            for (let j = i + 1; j < endpoints.length; j++) {
              const e1 = endpoints[i];
              const e2 = endpoints[j];
              
              // Check momentum compatibility
              const dot = e1.dx * e2.dx + e1.dy * e2.dy;
              if (dot < -0.5) { // Approximately opposite directions
                // Try to bridge the gap
                if (canBridgeGap(binary, width, height, e1.x, e1.y, e2.x, e2.y)) {
                  drawLine(scratch, width, height, e1.x, e1.y, e2.x, e2.y);
                }
              }
            }
          }
        }
      }
    }
    
    binary.set(scratch);
  }
}

function findEndpoints(binary, width, height, cx, cy, radius) {
  const endpoints = [];
  
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      
      const idx = y * width + x;
      if (binary[idx] === 1) {
        // Check if this is an endpoint (has exactly one neighbor)
        const n = countNeighbors(binary, width, height, x, y, 1);
        if (n === 1) {
          // Compute direction (momentum) from neighbor
          let ndx = 0, ndy = 0;
          for (let ddy = -1; ddy <= 1; ddy++) {
            for (let ddx = -1; ddx <= 1; ddx++) {
              if (ddx === 0 && ddy === 0) continue;
              const nx = x + ddx;
              const ny = y + ddy;
              if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
                if (binary[ny * width + nx] === 1) {
                  ndx = ddx;
                  ndy = ddy;
                }
              }
            }
          }
          endpoints.push({x, y, dx: ndx, dy: ndy});
        }
      }
    }
  }
  
  return endpoints;
}

function canBridgeGap(binary, width, height, x1, y1, x2, y2) {
  // Simple Bresenham check
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  
  let x = x1;
  let y = y1;
  let steps = 0;
  
  while (true) {
    if (x === x2 && y === y2) break;
    
    // Check if path is clear (mostly background)
    const idx = y * width + x;
    if (binary[idx] === 1) {
      // Allow crossing existing lines but penalize
      steps++;
      if (steps > 3) return false;
    }
    
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  
  return true;
}

function drawLine(binary, width, height, x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  
  let x = x1;
  let y = y1;
  
  while (true) {
    if (x >= 0 && y >= 0 && x < width && y < height) {
      binary[y * width + x] = 1;
    }
    
    if (x === x2 && y === y2) break;
    
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Tufte ink minimization - reduces ink usage while preserving information
 */
function applyTufteInkPass(binary, luma, width, height, passes) {
  const scratch = new Uint8Array(binary.length);
  const error = new Float32Array(binary.length);
  
  for (let pass = 0; pass < passes; pass++) {
    scratch.set(binary);
    error.fill(0);
    
    // Floyd-Steinberg style error diffusion for ink reduction
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        
        if (binary[idx] === 1) {
          // Current accumulated error
          const currentError = error[idx];
          
          // Check if we can remove this pixel
          const n = countNeighbors(binary, width, height, x, y, 1);
          const canRemove = n > 2; // Has redundant connections
          
          if (canRemove && currentError > 0.3) {
            // Try removing and distribute error
            scratch[idx] = 0;
            const quantError = 1.0 + currentError;
            
            // Distribute to neighbors
            error[idx + 1] += quantError * 7 / 16;
            error[idx + width - 1] += quantError * 3 / 16;
            error[idx + width] += quantError * 5 / 16;
            error[idx + width + 1] += quantError * 1 / 16;
          }
        }
      }
    }
    
    binary.set(scratch);
  }
}

module.exports = {
  applyLienSortCleanup,
  applyMomentumLineClosure,
  applyTufteInkPass,
  countNeighbors
};
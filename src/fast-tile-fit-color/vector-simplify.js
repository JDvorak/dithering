const { computeGradients, boxBlur } = require('../randomwalk-bw/image');

/**
 * New pipeline structure following vectorize.md approach:
 * 1. Canny edge detection
 * 2. Line completion (gap closing)  
 * 3. Bezier curve fitting
 * 4. Frame field alignment
 */
function buildVectorSimplification(originalRgba, shadowRgba, luma, width, height, options) {
  // Step 0: Preprocessing - severability analysis and contrast enhancement
  
  // Compute severability map FIRST to guide contrast boost
  let severability = null;
  if (options.severabilityEnabled || options.contrastBoost > 0) {
    // Always compute severability if contrast boost is enabled - use it as edge mask
    severability = computeSeverabilityMap(luma, width, height, options);
  }
  
  // Apply edge-aware contrast boost using severability as mask
  let enhancedLuma = luma;
  if (options.contrastBoost > 0) {
    enhancedLuma = boostContrast(luma, width, height, options.contrastBoost, severability);
  }
  
  // Step 1: Canny edge detection
  const smooth = boxBlur(enhancedLuma, width, height, 1);
  const g = computeGradients(smooth, width, height);
  
  // Apply severability weighting to gradients if enabled
  if (severability && options.severabilityWeight > 0) {
    applySeverabilityWeighting(g, severability, width, height, options.severabilityWeight);
  }
  
  let edges = computeCannyFromGradients(g.gx, g.gy, g.grad, width, height, options.vectorCannyLow, options.vectorCannyHigh);
  
  // Step 2: Line completion (close gaps)
  if (options.vectorGapPasses > 0) {
    edges = closeEdgeGaps(edges, g.gx, g.gy, width, height, options.vectorGapPasses);
  }
  
  // Step 3: Bezier curve fitting (if enabled)
  let bezierCurves = null;
  if (options.bezierFitEnabled) {
    bezierCurves = fitBezierCurves(edges, g.gx, g.gy, width, height, options);
    // Render bezier curves to edge image
    edges = renderBezierEdges(bezierCurves, width, height, options.bezierSamplingRate);
  }
  
  // Step 4: Frame field computation for alignment
  const frameField = computeFrameField(edges, g.gx, g.gy, width, height, options);
  
  // Step 5: Grid-based alignment (if enabled)
  let alignedEdges = edges;
  if (options.gridAlignmentEnabled) {
    alignedEdges = alignStrokesToGrid(edges, frameField, width, height, options);
  }
  
  // Optional: Warp image toward aligned edges (disabled by default)
  let warpedOriginal = originalRgba;
  let warpedShadow = shadowRgba;
  if (options.vectorShiftStrength > 1e-6) {
    const nearest = buildNearestEdgeField(alignedEdges, width, height);
    warpedOriginal = warpRgbaTowardEdges(originalRgba, width, height, nearest, options.vectorBandRadius, options.vectorShiftStrength);
    warpedShadow = warpRgbaTowardEdges(shadowRgba, width, height, nearest, options.vectorBandRadius, options.vectorShiftStrength);
  }

  return {
    edges: alignedEdges,
    rawEdges: edges,
    bezierCurves,
    frameField,
    gx: g.gx,
    gy: g.gy,
    warpedOriginalRgba: warpedOriginal,
    warpedShadowRgba: warpedShadow
  };
}

/**
 * Fit Bezier curves to edge points using multi-scale approach
 * Based on vectorize.md section 6.2: Scale-space analysis for stroke linking
 */
function fitBezierCurves(edges, gx, gy, width, height, options) {
  const curves = [];
  const visited = new Uint8Array(width * height);
  const minChainLength = options.bezierMinChainLength || 8;
  const maxError = options.bezierMaxError || 2.0;
  
  // Build multi-scale edge representation if scale linking enabled
  let coarseEdges = null;
  let coarseGx = null;
  let coarseGy = null;
  let scaleFactor = 1;
  
  if (options.scaleSpaceEnabled && options.coarseScaleFactor > 1) {
    const coarseResult = buildCoarseScaleEdges(edges, gx, gy, width, height, options.coarseScaleFactor);
    coarseEdges = coarseResult.edges;
    coarseGx = coarseResult.gx;
    coarseGy = coarseResult.gy;
    scaleFactor = options.coarseScaleFactor;
  }
  
  // First pass: extract chains at fine scale
  const chainCandidates = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (edges[idx] <= 0 || visited[idx]) continue;
      
      // Trace a chain starting from this point
      const chain = traceEdgeChain(edges, gx, gy, visited, x, y, width, height, options.bezierMaxChainLength || 200);
      
      if (chain.length >= minChainLength) {
        chainCandidates.push({
          chain,
          centroid: computeCentroid(chain),
          tangent: computeMeanTangent(chain, gx, gy, width, height),
          length: chain.length
        });
      }
    }
  }
  
  // Second pass: link chains using scale-space coherence
  if (options.scaleSpaceEnabled && coarseEdges) {
    linkChainsUsingScaleSpace(chainCandidates, coarseEdges, coarseGx, coarseGy, width, height, scaleFactor);
  }
  
  // Third pass: extend chains by searching for nearby endpoints with similar tangents
  if (options.chainLinkingEnabled) {
    extendChainsByLinking(chainCandidates, edges, gx, gy, width, height, options);
  }
  
  // Fit bezier curves to linked chains
  for (const candidate of chainCandidates) {
    const curve = fitBezierToChain(candidate.chain, maxError, options.bezierMaxSegments || 4);
    if (curve) {
      // Store metadata about the curve
      curve.metadata = {
        originalChain: candidate.originalChain || candidate.chain,
        linked: candidate.linked || false,
        numLinks: candidate.numLinks || 0,
        length: candidate.chain.length
      };
      curves.push(curve);
    }
  }
  
  return curves;
}

/**
 * Build coarser scale edge representation for scale-space analysis
 */
function buildCoarseScaleEdges(edges, gx, gy, width, height, factor) {
  const coarseWidth = Math.ceil(width / factor);
  const coarseHeight = Math.ceil(height / factor);
  const coarseEdges = new Float32Array(coarseWidth * coarseHeight);
  const coarseGx = new Float32Array(coarseWidth * coarseHeight);
  const coarseGy = new Float32Array(coarseWidth * coarseHeight);
  
  // Downsample edges using max pooling
  for (let cy = 0; cy < coarseHeight; cy++) {
    for (let cx = 0; cx < coarseWidth; cx++) {
      let maxEdge = 0;
      let sumGx = 0;
      let sumGy = 0;
      let count = 0;
      
      const y0 = cy * factor;
      const y1 = Math.min(y0 + factor, height);
      const x0 = cx * factor;
      const x1 = Math.min(x0 + factor, width);
      
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = y * width + x;
          if (edges[idx] > maxEdge) {
            maxEdge = edges[idx];
          }
          if (edges[idx] > 0) {
            sumGx += gx[idx];
            sumGy += gy[idx];
            count++;
          }
        }
      }
      
      const cidx = cy * coarseWidth + cx;
      coarseEdges[cidx] = maxEdge;
      if (count > 0) {
        coarseGx[cidx] = sumGx / count;
        coarseGy[cidx] = sumGy / count;
      }
    }
  }
  
  return { edges: coarseEdges, gx: coarseGx, gy: coarseGy, width: coarseWidth, height: coarseHeight };
}

/**
 * Compute centroid of a point chain
 */
function computeCentroid(chain) {
  let sumX = 0, sumY = 0;
  for (const p of chain) {
    sumX += p.x;
    sumY += p.y;
  }
  return { x: sumX / chain.length, y: sumY / chain.length };
}

/**
 * Compute mean tangent direction of a chain
 */
function computeMeanTangent(chain, gx, gy, width, height) {
  let sumTx = 0, sumTy = 0;
  for (const p of chain) {
    const idx = Math.floor(p.y) * width + Math.floor(p.x);
    const gn = Math.hypot(gx[idx], gy[idx]);
    if (gn > 1e-8) {
      // Tangent is perpendicular to gradient
      sumTx += -gy[idx] / gn;
      sumTy += gx[idx] / gn;
    }
  }
  const n = Math.hypot(sumTx, sumTy);
  if (n > 1e-8) {
    return { x: sumTx / n, y: sumTy / n };
  }
  return { x: 1, y: 0 };
}

/**
 * Link chains using coarse-scale guidance
 * Chains that align with coarse-scale edges are more likely to be linked
 */
function linkChainsUsingScaleSpace(chainCandidates, coarseEdges, coarseGx, coarseGy, width, height, scaleFactor) {
  const coarseWidth = Math.ceil(width / scaleFactor);
  const coarseHeight = Math.ceil(height / scaleFactor);
  
  // Project chain centroids to coarse scale
  for (const candidate of chainCandidates) {
    const cx = Math.floor(candidate.centroid.x / scaleFactor);
    const cy = Math.floor(candidate.centroid.y / scaleFactor);
    
    if (cx >= 0 && cx < coarseWidth && cy >= 0 && cy < coarseHeight) {
      const cidx = cy * coarseWidth + cx;
      // Boost confidence if coarse scale has strong edge
      if (coarseEdges[cidx] > 0.5) {
        candidate.scaleCoherence = coarseEdges[cidx];
        // Align tangent with coarse scale
        const gn = Math.hypot(coarseGx[cidx], coarseGy[cidx]);
        if (gn > 1e-8) {
          const coarseTangent = { x: -coarseGy[cidx] / gn, y: coarseGx[cidx] / gn };
          const dot = Math.abs(candidate.tangent.x * coarseTangent.x + candidate.tangent.y * coarseTangent.y);
          candidate.scaleAlignment = dot;
        }
      }
    }
  }
}

/**
 * Extend chains by linking nearby endpoints with similar tangents
 */
function extendChainsByLinking(chainCandidates, edges, gx, gy, width, height, options) {
  const maxLinkDist = options.chainLinkMaxDist || 15;
  const minTangentAlign = options.chainLinkMinAlign || 0.7;
  const maxAngleDiff = options.chainLinkMaxAngle || Math.PI / 4; // 45 degrees
  
  // Build endpoint index
  const endpoints = [];
  for (let i = 0; i < chainCandidates.length; i++) {
    const c = chainCandidates[i];
    if (c.chain.length < 2) continue;
    
    // Store original chain before linking
    c.originalChain = [...c.chain];
    
    // Compute tangents at endpoints
    const startTangent = computeEndpointTangent(c.chain, 0, 5, gx, gy, width, height);
    const endTangent = computeEndpointTangent(c.chain, c.chain.length - 1, -5, gx, gy, width, height);
    
    endpoints.push({
      chainIdx: i,
      point: c.chain[0],
      tangent: { x: -startTangent.x, y: -startTangent.y }, // Pointing outward
      isStart: true
    });
    endpoints.push({
      chainIdx: i,
      point: c.chain[c.chain.length - 1],
      tangent: endTangent,
      isStart: false
    });
  }
  
  // Find link candidates
  const links = [];
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const ep1 = endpoints[i];
      const ep2 = endpoints[j];
      
      // Skip if same chain
      if (ep1.chainIdx === ep2.chainIdx) continue;
      
      const dx = ep2.point.x - ep1.point.x;
      const dy = ep2.point.y - ep1.point.y;
      const dist = Math.hypot(dx, dy);
      
      if (dist > maxLinkDist) continue;
      
      // Check tangent alignment
      const linkTangent = { x: dx / dist, y: dy / dist };
      const align1 = Math.abs(ep1.tangent.x * linkTangent.x + ep1.tangent.y * linkTangent.y);
      const align2 = Math.abs(ep2.tangent.x * linkTangent.x + ep2.tangent.y * linkTangent.y);
      
      // Check if both tangents point toward each other
      const angle1 = Math.acos(Math.max(-1, Math.min(1, align1)));
      const angle2 = Math.acos(Math.max(-1, Math.min(1, align2)));
      
      if (angle1 < maxAngleDiff && angle2 < maxAngleDiff) {
        links.push({
          ep1,
          ep2,
          dist,
          alignment: (align1 + align2) / 2
        });
      }
    }
  }
  
  // Sort by distance and alignment, apply greedily
  links.sort((a, b) => a.dist - b.dist || b.alignment - a.alignment);
  
  const usedChains = new Set();
  for (const link of links) {
    const c1Idx = link.ep1.chainIdx;
    const c2Idx = link.ep2.chainIdx;
    
    if (usedChains.has(c1Idx) || usedChains.has(c2Idx)) continue;
    
    const c1 = chainCandidates[c1Idx];
    const c2 = chainCandidates[c2Idx];
    
    // Link the chains
    let linkedChain;
    if (link.ep1.isStart && !link.ep2.isStart) {
      // c1 start -> c2 end: reverse c1, append c2
      linkedChain = [...c1.chain].reverse().concat(c2.chain);
    } else if (!link.ep1.isStart && link.ep2.isStart) {
      // c1 end -> c2 start: c1 + c2
      linkedChain = c1.chain.concat(c2.chain);
    } else if (link.ep1.isStart && link.ep2.isStart) {
      // Both starts: reverse c1, append c2
      linkedChain = [...c1.chain].reverse().concat(c2.chain);
    } else {
      // Both ends: c1 + reverse c2
      linkedChain = c1.chain.concat([...c2.chain].reverse());
    }
    
    // Update c1 with linked chain
    c1.chain = linkedChain;
    c1.linked = true;
    c1.numLinks = (c1.numLinks || 0) + 1;
    c1.centroid = computeCentroid(linkedChain);
    c1.tangent = computeMeanTangent(linkedChain, gx, gy, width, height);
    
    // Mark c2 as used
    c2.linked = true;
    c2.numLinks = (c2.numLinks || 0) + 1;
    usedChains.add(c2Idx);
  }
  
  // Fourth pass: long-range completion across larger gaps
  if (options.longRangeCompletionEnabled) {
    completeLongRangeGaps(chainCandidates, edges, width, height, options);
  }
}

/**
 * Complete gaps across longer stretches using collinearity and line inference
 * This finds lines that should connect even with large gaps between them
 */
function completeLongRangeGaps(chainCandidates, edges, width, height, options) {
  const maxGapDist = options.longRangeMaxGap || 50;
  const maxCollinearDist = options.longRangeCollinearDist || 100;
  const collinearThreshold = options.longRangeCollinearThreshold || 2.0; // pixels
  const minTangentAlign = options.longRangeMinAlign || 0.85;
  
  // Build endpoint index with line parameters for collinearity checking
  const endpoints = [];
  for (let i = 0; i < chainCandidates.length; i++) {
    const c = chainCandidates[i];
    if (c.chain.length < 2) continue;
    if (c.completed) continue; // Skip already completed chains
    
    // Compute robust line fit for each chain
    const lineFit = fitLineToChain(c.chain);
    
    endpoints.push({
      chainIdx: i,
      point: c.chain[0],
      tangent: computeEndpointTangent(c.chain, 0, 5, null, null, width, height),
      isStart: true,
      lineFit: lineFit
    });
    endpoints.push({
      chainIdx: i,
      point: c.chain[c.chain.length - 1],
      tangent: computeEndpointTangent(c.chain, c.chain.length - 1, -5, null, null, width, height),
      isStart: false,
      lineFit: lineFit
    });
  }
  
  // Find collinear endpoint pairs across gaps
  const completions = [];
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const ep1 = endpoints[i];
      const ep2 = endpoints[j];
      
      // Skip if same chain
      if (ep1.chainIdx === ep2.chainIdx) continue;
      
      const dx = ep2.point.x - ep1.point.x;
      const dy = ep2.point.y - ep1.point.y;
      const dist = Math.hypot(dx, dy);
      
      // Must be within collinear search range but beyond local linking range
      if (dist > maxCollinearDist || dist < options.chainLinkMaxDist || 15) continue;
      
      // Check if endpoints are roughly facing each other
      const gapTangent = { x: dx / dist, y: dy / dist };
      const align1 = ep1.tangent.x * gapTangent.x + ep1.tangent.y * gapTangent.y;
      const align2 = -(ep2.tangent.x * gapTangent.x + ep2.tangent.y * gapTangent.y); // Negate for opposite direction
      
      if (align1 < minTangentAlign || align2 < minTangentAlign) continue;
      
      // Check collinearity: distance from ep2 to line through ep1
      const line1 = ep1.lineFit;
      const distToLine = pointLineDistance(ep2.point, line1);
      
      // Check collinearity the other way too
      const line2 = ep2.lineFit;
      const distToLine2 = pointLineDistance(ep1.point, line2);
      
      const maxDistToLine = Math.max(distToLine, distToLine2);
      
      if (maxDistToLine < collinearThreshold) {
        // Check if gap area has supporting evidence (weak edges, similar gradient)
        const gapScore = scoreGapCompletion(ep1.point, ep2.point, edges, width, height);
        
        completions.push({
          ep1,
          ep2,
          dist,
          collinearError: maxDistToLine,
          gapScore,
          alignment: (align1 + align2) / 2
        });
      }
    }
  }
  
  // Sort by combined score and apply
  completions.sort((a, b) => {
    const scoreA = a.collinearError + (1 - a.gapScore) * 10;
    const scoreB = b.collinearError + (1 - b.gapScore) * 10;
    return scoreA - scoreB;
  });
  
  const usedInCompletion = new Set();
  for (const completion of completions) {
    const c1Idx = completion.ep1.chainIdx;
    const c2Idx = completion.ep2.chainIdx;
    
    if (usedInCompletion.has(c1Idx) || usedInCompletion.has(c2Idx)) continue;
    
    const c1 = chainCandidates[c1Idx];
    const c2 = chainCandidates[c2Idx];
    
    // Generate completion curve through the gap
    const completionCurve = generateCompletionCurve(
      completion.ep1.point, completion.ep1.tangent,
      completion.ep2.point, completion.ep2.tangent,
      completion.dist
    );
    
    // Link the chains with completion
    let linkedChain;
    if (completion.ep1.isStart && !completion.ep2.isStart) {
      linkedChain = [...c1.chain].reverse().concat(completionCurve).concat(c2.chain);
    } else if (!completion.ep1.isStart && completion.ep2.isStart) {
      linkedChain = c1.chain.concat(completionCurve).concat(c2.chain);
    } else if (completion.ep1.isStart && completion.ep2.isStart) {
      linkedChain = [...c1.chain].reverse().concat(completionCurve).concat(c2.chain);
    } else {
      linkedChain = c1.chain.concat(completionCurve).concat([...c2.chain].reverse());
    }
    
    // Update c1
    c1.chain = linkedChain;
    c1.completed = true;
    c1.numLinks = (c1.numLinks || 0) + 1;
    c1.centroid = computeCentroid(linkedChain);
    c1.tangent = computeMeanTangent(linkedChain, null, null, width, height);
    
    // Mark c2 as used
    c2.completed = true;
    usedInCompletion.add(c2Idx);
  }
}

/**
 * Fit a line to a chain using PCA/least squares
 */
function fitLineToChain(chain) {
  if (chain.length < 2) {
    return { point: chain[0] || { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
  }
  
  // Compute centroid
  let cx = 0, cy = 0;
  for (const p of chain) {
    cx += p.x;
    cy += p.y;
  }
  cx /= chain.length;
  cy /= chain.length;
  
  // Compute covariance matrix
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of chain) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  
  // Find principal direction (eigenvector of largest eigenvalue)
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det));
  const lambda1 = (trace + disc) / 2;
  const lambda2 = (trace - disc) / 2;
  
  let dx = 1, dy = 0;
  if (Math.abs(sxy) > 1e-8 || Math.abs(lambda1 - sxx) > 1e-8) {
    dx = lambda1 - syy;
    dy = sxy;
    const n = Math.hypot(dx, dy);
    if (n > 1e-8) {
      dx /= n;
      dy /= n;
    }
  }
  
  return {
    point: { x: cx, y: cy },
    direction: { x: dx, y: dy }
  };
}

/**
 * Compute perpendicular distance from point to line
 */
function pointLineDistance(point, line) {
  const dx = point.x - line.point.x;
  const dy = point.y - line.point.y;
  // Cross product magnitude / direction magnitude
  return Math.abs(dx * line.direction.y - dy * line.direction.x);
}

/**
 * Score how likely a gap completion is based on image evidence
 */
function scoreGapCompletion(p1, p2, edges, width, height) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return 1.0;
  
  const steps = Math.ceil(dist);
  const dirX = dx / dist;
  const dirY = dy / dist;
  
  let edgeSum = 0;
  let samples = 0;
  
  // Sample along the gap
  for (let i = 1; i < steps; i++) {
    const x = Math.round(p1.x + dirX * i);
    const y = Math.round(p1.y + dirY * i);
    
    if (x >= 0 && y >= 0 && x < width && y < height) {
      edgeSum += edges[y * width + x];
      samples++;
    }
  }
  
  // Also check perpendicular neighborhoods for nearby edges
  let nearbyEdgeSum = 0;
  const perpX = -dirY;
  const perpY = dirX;
  for (let i = 1; i < steps; i += 2) {
    for (let offset of [-1, 1]) {
      const x = Math.round(p1.x + dirX * i + perpX * offset);
      const y = Math.round(p1.y + dirY * i + perpY * offset);
      if (x >= 0 && y >= 0 && x < width && y < height) {
        nearbyEdgeSum += edges[y * width + x];
      }
    }
  }
  
  const avgEdge = samples > 0 ? edgeSum / samples : 0;
  const nearbyAvg = steps > 0 ? nearbyEdgeSum / (steps * 2) : 0;
  
  // Score combines direct edge presence and nearby edge support
  return avgEdge * 0.6 + nearbyAvg * 0.4;
}

/**
 * Generate a smooth completion curve between two endpoints
 */
function generateCompletionCurve(p1, t1, p2, t2, dist) {
  const curve = [];
  const steps = Math.max(3, Math.ceil(dist / 2));
  
  // Use Hermite interpolation for smooth curve
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    
    // Hermite basis functions
    const h00 = 2*t3 - 3*t2 + 1;
    const h10 = t3 - 2*t2 + t;
    const h01 = -2*t3 + 3*t2;
    const h11 = t3 - t2;
    
    // Control point spacing
    const scale = dist * 0.3;
    
    const x = h00 * p1.x + h10 * scale * t1.x + h01 * p2.x + h11 * scale * t2.x;
    const y = h00 * p1.y + h10 * scale * t1.y + h01 * p2.y + h11 * scale * t2.y;
    
    curve.push({ x, y });
  }
  
  return curve;
}

/**
 * Compute tangent at chain endpoint
 */
function computeEndpointTangent(chain, startIdx, step, gx, gy, width, height) {
  const endIdx = Math.max(0, Math.min(chain.length - 1, startIdx + step));
  const p1 = chain[startIdx];
  const p2 = chain[endIdx];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const n = Math.hypot(dx, dy);
  if (n > 1e-8) {
    return { x: dx / n, y: dy / n };
  }
  // Fallback to gradient-based tangent
  const idx = Math.floor(p1.y) * width + Math.floor(p1.x);
  const gn = Math.hypot(gx[idx], gy[idx]);
  if (gn > 1e-8) {
    return { x: -gy[idx] / gn, y: gx[idx] / gn };
  }
  return { x: 1, y: 0 };
}

/**
 * Trace a connected chain of edge pixels
 */
function traceEdgeChain(edges, gx, gy, visited, startX, startY, width, height, maxLength) {
  const chain = [{ x: startX, y: startY }];
  let x = startX;
  let y = startY;
  visited[y * width + x] = 1;
  
  // Follow gradient direction
  while (chain.length < maxLength) {
    const idx = y * width + x;
    let bestNext = null;
    let bestAlign = -1;
    
    // Check 8 neighbors
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        
        const nidx = ny * width + nx;
        if (edges[nidx] <= 0 || visited[nidx]) continue;
        
        // Prefer continuation in gradient direction
        const gn = Math.hypot(gx[idx], gy[idx]);
        if (gn > 1e-8) {
          const tx = -gy[idx] / gn;
          const ty = gx[idx] / gn;
          const align = Math.abs(tx * dx + ty * dy) / Math.hypot(dx, dy);
          if (align > bestAlign) {
            bestAlign = align;
            bestNext = { x: nx, y: ny };
          }
        }
      }
    }
    
    if (!bestNext || bestAlign < 0.5) break;
    
    x = bestNext.x;
    y = bestNext.y;
    visited[y * width + x] = 1;
    chain.push({ x, y });
  }
  
  return chain;
}

/**
 * Fit piecewise cubic Bezier curves to a chain of points
 * Uses iterative refinement from vectorize.md
 */
function fitBezierToChain(chain, maxError, maxSegments) {
  if (chain.length < 4) return null;
  
  // Start with single segment
  let segments = 1;
  let bestCurve = null;
  let bestError = Infinity;
  
  while (segments <= maxSegments) {
    const curve = fitPiecewiseBezier(chain, segments);
    const error = computeBezierError(chain, curve);
    
    if (error < bestError) {
      bestError = error;
      bestCurve = curve;
    }
    
    if (error <= maxError) break;
    segments++;
  }
  
  return bestCurve;
}

/**
 * Fit piecewise Bezier curve with n segments
 */
function fitPiecewiseBezier(chain, nSegments) {
  const n = chain.length;
  const segmentLength = Math.floor(n / nSegments);
  const curves = [];
  
  for (let i = 0; i < nSegments; i++) {
    const start = i * segmentLength;
    const end = Math.min((i + 1) * segmentLength, n - 1);
    if (end - start < 2) continue;
    
    const segment = chain.slice(start, end + 1);
    const bezier = fitSingleBezier(segment);
    if (bezier) curves.push(bezier);
  }
  
  return { segments: curves, chain };
}

/**
 * Fit single cubic Bezier to point segment
 * Using least-squares fitting
 */
function fitSingleBezier(points) {
  if (points.length < 4) return null;
  
  const n = points.length;
  const p0 = points[0];
  const p3 = points[n - 1];
  
  // Compute chord length parameterization
  const t = [0];
  let totalLen = 0;
  for (let i = 1; i < n; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalLen += Math.hypot(dx, dy);
    t.push(totalLen);
  }
  for (let i = 0; i < n; i++) t[i] /= Math.max(1e-8, totalLen);
  
  // Solve for control points p1, p2 using least squares
  let a1 = 0, a2 = 0, a12 = 0;
  let b1x = 0, b1y = 0, b2x = 0, b2y = 0;
  
  for (let i = 0; i < n; i++) {
    const ti = t[i];
    const b0 = (1 - ti) * (1 - ti) * (1 - ti);
    const b1 = 3 * (1 - ti) * (1 - ti) * ti;
    const b2 = 3 * (1 - ti) * ti * ti;
    const b3 = ti * ti * ti;
    
    const px = points[i].x - b0 * p0.x - b3 * p3.x;
    const py = points[i].y - b0 * p0.y - b3 * p3.y;
    
    a1 += b1 * b1;
    a2 += b2 * b2;
    a12 += b1 * b2;
    
    b1x += b1 * px;
    b1y += b1 * py;
    b2x += b2 * px;
    b2y += b2 * py;
  }
  
  // Solve 2x2 linear system
  const det = a1 * a2 - a12 * a12;
  if (Math.abs(det) < 1e-8) return null;
  
  const p1x = (a2 * b1x - a12 * b2x) / det;
  const p1y = (a2 * b1y - a12 * b2y) / det;
  const p2x = (a1 * b2x - a12 * b1x) / det;
  const p2y = (a1 * b2y - a12 * b1y) / det;
  
  return {
    p0: { x: p0.x, y: p0.y },
    p1: { x: p1x, y: p1y },
    p2: { x: p2x, y: p2y },
    p3: { x: p3.x, y: p3.y }
  };
}

/**
 * Compute fitting error for Bezier curve
 */
function computeBezierError(chain, curve) {
  if (!curve || !curve.segments) return Infinity;
  
  let totalError = 0;
  let idx = 0;
  
  for (const seg of curve.segments) {
    const segLength = Math.floor(chain.length / curve.segments.length);
    const endIdx = Math.min(idx + segLength, chain.length);
    
    for (let i = idx; i < endIdx; i++) {
      const t = (i - idx) / Math.max(1, segLength - 1);
      const point = evalCubicBezier(seg, t);
      const dx = chain[i].x - point.x;
      const dy = chain[i].y - point.y;
      totalError += dx * dx + dy * dy;
    }
    idx = endIdx;
  }
  
  return Math.sqrt(totalError / chain.length);
}

/**
 * Evaluate cubic Bezier at parameter t
 */
function evalCubicBezier(b, t) {
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;
  
  return {
    x: u3 * b.p0.x + 3 * u2 * t * b.p1.x + 3 * u * t2 * b.p2.x + t3 * b.p3.x,
    y: u3 * b.p0.y + 3 * u2 * t * b.p1.y + 3 * u * t2 * b.p2.y + t3 * b.p3.y
  };
}

/**
 * Render Bezier curves to edge image
 * curveData is an array of { segments: [...] }
 */
function renderBezierEdges(curveData, width, height, samplingRate = 0.02) {
  const edges = new Float32Array(width * height);
  if (!curveData || !Array.isArray(curveData) || curveData.length === 0) return edges;
  
  for (const curve of curveData) {
    if (!curve || !curve.segments) continue;
    for (const seg of curve.segments) {
      for (let t = 0; t <= 1; t += samplingRate) {
        const p = evalCubicBezier(seg, t);
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (x >= 0 && y >= 0 && x < width && y < height) {
          edges[y * width + x] = 1.0;
        }
      }
    }
  }
  
  return edges;
}

/**
 * Compute frame field aligned with strokes
 * Based on vectorize.md section 6.1
 */
function computeFrameField(edges, gx, gy, width, height, options) {
  const count = width * height;
  const frameX = new Float32Array(count);
  const frameY = new Float32Array(count);
  const frameStrength = new Float32Array(count);
  
  // Initialize from gradients
  for (let i = 0; i < count; i++) {
    if (edges[i] > 0) {
      const gn = Math.hypot(gx[i], gy[i]);
      if (gn > 1e-8) {
        // Tangent direction (perpendicular to gradient)
        frameX[i] = -gy[i] / gn;
        frameY[i] = gx[i] / gn;
        frameStrength[i] = edges[i];
      }
    }
  }
  
  // Smooth the frame field
  if (options.frameSmoothPasses > 0) {
    smoothFrameField(frameX, frameY, frameStrength, width, height, options.frameSmoothPasses);
  }
  
  return { x: frameX, y: frameY, strength: frameStrength };
}

/**
 * Smooth frame field using local averaging
 */
function smoothFrameField(frameX, frameY, strength, width, height, passes) {
  const count = width * height;
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        let vx = 0, vy = 0, wsum = 0;
        
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nidx = (y + dy) * width + (x + dx);
            const w = strength[nidx];
            vx += frameX[nidx] * w;
            vy += frameY[nidx] * w;
            wsum += w;
          }
        }
        
        if (wsum > 1e-8) {
          vx /= wsum;
          vy /= wsum;
          const n = Math.hypot(vx, vy);
          if (n > 1e-8) {
            sx[idx] = vx / n;
            sy[idx] = vy / n;
          } else {
            sx[idx] = frameX[idx];
            sy[idx] = frameY[idx];
          }
        }
      }
    }
    
    frameX.set(sx);
    frameY.set(sy);
  }
}

/**
 * Align strokes to grid using frame field guidance
 * Simplified version of vectorize.md grid parametrization
 */
function alignStrokesToGrid(edges, frameField, width, height, options) {
  const count = width * height;
  const aligned = new Float32Array(count);
  const gridScale = options.gridScale || 8;
  
  // For each edge pixel, snap to nearest grid line aligned with frame
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (edges[idx] <= 0) continue;
      
      const fx = frameField.x[idx];
      const fy = frameField.y[idx];
      const strength = frameField.strength[idx];
      
      if (strength < 0.1) {
        aligned[idx] = edges[idx];
        continue;
      }
      
      // Project position onto grid aligned with frame
      const gridX = Math.round(x / gridScale) * gridScale;
      const gridY = Math.round(y / gridScale) * gridScale;
      
      // Snap to isoline aligned with frame direction
      const proj = (x - gridX) * fx + (y - gridY) * fy;
      const snappedX = Math.round(gridX + proj * fx);
      const snappedY = Math.round(gridY + proj * fy);
      
      if (snappedX >= 0 && snappedY >= 0 && snappedX < width && snappedY < height) {
        const sidx = snappedY * width + snappedX;
        aligned[sidx] = Math.max(aligned[sidx], edges[idx]);
      } else {
        aligned[idx] = edges[idx];
      }
    }
  }
  
  return aligned;
}

function overlaySimplifiedLines(baseRgba, edges, gx, gy, width, height, strength, darken, debugLineColor = null) {
  if (strength <= 1e-6 && !debugLineColor) return baseRgba;
  const out = new Uint8ClampedArray(baseRgba.length);
  out.set(baseRgba);
  const useDebugBlack = debugLineColor === 'black';
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const e = edges[idx];
      if (e <= 0) continue;
      const n = Math.hypot(gx[idx], gy[idx]);
      if (n <= 1e-8) continue;
      
      const o = idx * 4;
      
      if (useDebugBlack) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 255;
      } else {
        const nx = gx[idx] / n;
        const ny = gy[idx] / n;
        const c0 = sampleRgb(baseRgba, width, height, x + nx, y + ny);
        const c1 = sampleRgb(baseRgba, width, height, x - nx, y - ny);
        const l0 = 0.2126 * c0.r + 0.7152 * c0.g + 0.0722 * c0.b;
        const l1 = 0.2126 * c1.r + 0.7152 * c1.g + 0.0722 * c1.b;
        const side = l0 < l1 ? c0 : c1;
        const lr = clamp01(side.r * (1 - darken));
        const lg = clamp01(side.g * (1 - darken));
        const lb = clamp01(side.b * (1 - darken));
        const a = strength * e;
        out[o] = Math.round(255 * (lerp(baseRgba[o] / 255, lr, a)));
        out[o + 1] = Math.round(255 * (lerp(baseRgba[o + 1] / 255, lg, a)));
        out[o + 2] = Math.round(255 * (lerp(baseRgba[o + 2] / 255, lb, a)));
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

function computeCannyFromGradients(gx, gy, grad, width, height, lowThreshold, highThreshold) {
  const nms = nonMaxSuppression(gx, gy, grad, width, height);
  return hysteresisThreshold(nms, width, height, lowThreshold, highThreshold);
}

function nonMaxSuppression(gx, gy, grad, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const g = grad[idx];
      if (g <= 1e-8) continue;
      const dir = quantizedDirection4((Math.atan2(gy[idx], gx[idx]) * 180) / Math.PI);
      let g0 = 0;
      let g1 = 0;
      if (dir === 0) {
        g0 = grad[idx - 1];
        g1 = grad[idx + 1];
      } else if (dir === 1) {
        g0 = grad[idx - width + 1];
        g1 = grad[idx + width - 1];
      } else if (dir === 2) {
        g0 = grad[idx - width];
        g1 = grad[idx + width];
      } else {
        g0 = grad[idx - width - 1];
        g1 = grad[idx + width + 1];
      }
      if (g >= g0 && g >= g1) out[idx] = g;
    }
  }
  return out;
}

function hysteresisThreshold(nms, width, height, lowThreshold, highThreshold) {
  const count = width * height;
  const out = new Float32Array(count);
  const state = new Uint8Array(count);
  const queue = new Int32Array(count);
  let q0 = 0;
  let q1 = 0;

  for (let i = 0; i < count; i++) {
    if (nms[i] >= highThreshold) {
      state[i] = 2;
      out[i] = nms[i];
      queue[q1++] = i;
    } else if (nms[i] >= lowThreshold) {
      state[i] = 1;
    }
  }

  while (q0 < q1) {
    const idx = queue[q0++];
    const y = (idx / width) | 0;
    const x = idx - y * width;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const ni = yy * width + xx;
        if (state[ni] !== 1) continue;
        state[ni] = 2;
        out[ni] = nms[ni];
        queue[q1++] = ni;
      }
    }
  }

  let max = 0;
  for (let i = 0; i < count; i++) if (out[i] > max) max = out[i];
  if (max > 1e-8) {
    const inv = 1 / max;
    for (let i = 0; i < count; i++) out[i] *= inv;
  }
  return out;
}

function closeEdgeGaps(edges, gx, gy, width, height, passes) {
  const out = new Float32Array(edges.length);
  out.set(edges);
  const scratch = new Float32Array(edges.length);
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];
  for (let pass = 0; pass < passes; pass++) {
    scratch.set(out);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (out[idx] > 0) continue;
        const n = Math.hypot(gx[idx], gy[idx]);
        if (n <= 1e-8) continue;
        const tx = -gy[idx] / n;
        const ty = gx[idx] / n;
        let best = 0;
        for (let d = 0; d < dirs.length; d++) {
          const dx = dirs[d][0];
          const dy = dirs[d][1];
          const dn = 1 / Math.hypot(dx, dy);
          const align = Math.abs(tx * (dx * dn) + ty * (dy * dn));
          if (align < 0.35) continue;
          const a = sampleEdge(out, width, height, x - dx, y - dy);
          const b = sampleEdge(out, width, height, x + dx, y + dy);
          if (a > 0 && b > 0) {
            const s = (a + b) * 0.5 * align;
            if (s > best) best = s;
          }
        }
        if (best > 0.2) scratch[idx] = best;
      }
    }
    out.set(scratch);
  }
  return out;
}

function buildNearestEdgeField(edges, width, height) {
  const count = width * height;
  const nearestX = new Int16Array(count);
  const nearestY = new Int16Array(count);
  const dist2 = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    nearestX[i] = -1;
    nearestY[i] = -1;
    dist2[i] = Infinity;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (edges[idx] > 0) {
        nearestX[idx] = x;
        nearestY[idx] = y;
        dist2[idx] = 0;
      }
    }
  }

  for (let iter = 0; iter < 2; iter++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        propagateNearest(x, y, width, height, nearestX, nearestY, dist2, -1, 0);
        propagateNearest(x, y, width, height, nearestX, nearestY, dist2, 0, -1);
        propagateNearest(x, y, width, height, nearestX, nearestY, dist2, -1, -1);
        propagateNearest(x, y, width, height, nearestX, nearestY, dist2, 1, -1);
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        propagateNearest(x, y, width, height, nearestX, nearestY, dist2, 1, 0);
        propagateNearest(x, y, width, height, nearestX, nearestY, dist2, 0, 1);
        propagateNearest(x, y, width, height, nearestX, nearestY, dist2, 1, 1);
        propagateNearest(x, y, width, height, nearestX, nearestY, dist2, -1, 1);
      }
    }
  }

  const dist = new Float32Array(count);
  for (let i = 0; i < count; i++) dist[i] = Math.sqrt(dist2[i]);
  return { nearestX, nearestY, dist };
}

function warpRgbaTowardEdges(rgba, width, height, nearest, radius, strength) {
  if (strength <= 1e-6) return Uint8ClampedArray.from(rgba);
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const d = nearest.dist[idx];
      let sx = x;
      let sy = y;
      if (d <= radius) {
        const nx = nearest.nearestX[idx] - x;
        const ny = nearest.nearestY[idx] - y;
        const w = strength * (1 - d / Math.max(1e-6, radius));
        sx = x + nx * w;
        sy = y + ny * w;
      }
      const c = sampleRgb(rgba, width, height, sx, sy);
      const o = idx * 4;
      out[o] = Math.round(c.r * 255);
      out[o + 1] = Math.round(c.g * 255);
      out[o + 2] = Math.round(c.b * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

function propagateNearest(x, y, width, height, nearestX, nearestY, dist2, ox, oy) {
  const nx = x + ox;
  const ny = y + oy;
  if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
  const i = y * width + x;
  const ni = ny * width + nx;
  const ex = nearestX[ni];
  const ey = nearestY[ni];
  if (ex < 0 || ey < 0) return;
  const dx = ex - x;
  const dy = ey - y;
  const d2 = dx * dx + dy * dy;
  if (d2 < dist2[i]) {
    dist2[i] = d2;
    nearestX[i] = ex;
    nearestY[i] = ey;
  }
}

function sampleEdge(edge, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return edge[y * width + x];
}

function sampleRgb(rgba, width, height, x, y) {
  const x0 = clampInt(Math.floor(x), 0, width - 1);
  const y0 = clampInt(Math.floor(y), 0, height - 1);
  const x1 = clampInt(x0 + 1, 0, width - 1);
  const y1 = clampInt(y0 + 1, 0, height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const a = readRgb(rgba, width, x0, y0);
  const b = readRgb(rgba, width, x1, y0);
  const c = readRgb(rgba, width, x0, y1);
  const d = readRgb(rgba, width, x1, y1);

  return {
    r: bilerp(a.r, b.r, c.r, d.r, fx, fy),
    g: bilerp(a.g, b.g, c.g, d.g, fx, fy),
    b: bilerp(a.b, b.b, c.b, d.b, fx, fy)
  };
}

function readRgb(rgba, width, x, y) {
  const i = (y * width + x) * 4;
  return { r: rgba[i] / 255, g: rgba[i + 1] / 255, b: rgba[i + 2] / 255 };
}

function bilerp(a, b, c, d, fx, fy) {
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

function quantizedDirection4(angleDegrees) {
  let a = angleDegrees;
  while (a < 0) a += 180;
  while (a >= 180) a -= 180;
  if (a < 22.5 || a >= 157.5) return 0;
  if (a < 67.5) return 1;
  if (a < 112.5) return 2;
  return 3;
}

function clampInt(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Boost contrast using edge-aware enhancement
 * Only boosts contrast in regions with existing edge structure to avoid noise amplification
 */
function boostContrast(luma, width, height, strength, edgeMask = null) {
  const count = width * height;
  const out = new Float32Array(count);
  
  // Compute local edge strength to guide contrast application
  let localEdges;
  if (!edgeMask) {
    localEdges = computeLocalEdgeStrength(luma, width, height);
  } else {
    localEdges = edgeMask;
  }
  
  // Find percentiles for robust min/max
  const sorted = Float32Array.from(luma).sort();
  const p05 = sorted[Math.floor(count * 0.05)];
  const p95 = sorted[Math.floor(count * 0.95)];
  const range = p95 - p05;
  const invRange = range > 1e-6 ? 1.0 / range : 1.0;
  
  // Apply S-curve contrast enhancement only in edge regions
  for (let i = 0; i < count; i++) {
    // Normalize to 0-1 using percentiles
    let v = (luma[i] - p05) * invRange;
    v = Math.max(0, Math.min(1, v));
    
    // Compute S-curve for contrast boost
    // smoothstep: 3v² - 2v³
    const sCurve = v * v * (3 - 2 * v);
    
    // Adaptive strength: higher near edges, lower in smooth regions
    // This prevents noise amplification
    const edgeWeight = Math.min(1, localEdges[i] * 3); // Scale edge response
    const adaptiveStrength = strength * (0.3 + 0.7 * edgeWeight);
    
    // Blend between original and enhanced based on adaptive strength
    const enhanced = luma[i] * (1 - adaptiveStrength) + sCurve * adaptiveStrength;
    out[i] = enhanced;
  }
  
  return out;
}

/**
 * Compute local edge strength for edge-aware processing
 */
function computeLocalEdgeStrength(luma, width, height) {
  const count = width * height;
  const edges = new Float32Array(count);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      // Compute local gradients
      const dx = luma[idx + 1] - luma[idx - 1];
      const dy = luma[idx + width] - luma[idx - width];
      const grad = Math.hypot(dx, dy);
      
      // Also check local variance
      let variance = 0;
      let mean = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nidx = (y + dy) * width + (x + dx);
          mean += luma[nidx];
          n++;
        }
      }
      mean /= n;
      
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nidx = (y + dy) * width + (x + dx);
          const diff = luma[nidx] - mean;
          variance += diff * diff;
        }
      }
      variance /= n;
      
      // Edge strength combines gradient and variance
      edges[idx] = Math.min(1, grad * 2 + variance * 5);
    }
  }
  
  return edges;
}

/**
 * Compute severability map - measures how "separable" each pixel is from its neighbors
 * High severability = good edge candidate
 * Based on local gradient statistics and edge coherence
 */
function computeSeverabilityMap(luma, width, height, options) {
  const count = width * height;
  const severability = new Float32Array(count);
  const windowSize = options.severabilityWindow || 3;
  const halfWindow = Math.floor(windowSize / 2);
  
  for (let y = halfWindow; y < height - halfWindow; y++) {
    for (let x = halfWindow; x < width - halfWindow; x++) {
      const idx = y * width + x;
      const centerVal = luma[idx];
      
      // Collect values in window
      const values = [];
      for (let dy = -halfWindow; dy <= halfWindow; dy++) {
        for (let dx = -halfWindow; dx <= halfWindow; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nidx = (y + dy) * width + (x + dx);
          values.push(luma[nidx]);
        }
      }
      
      // Compute local statistics
      let mean = 0;
      for (const v of values) mean += v;
      mean /= values.length;
      
      let variance = 0;
      for (const v of values) variance += (v - mean) * (v - mean);
      variance /= values.length;
      
      // Severability combines:
      // 1. How different center is from local mean (edge strength)
      // 2. Local variance (texture measure)
      const diff = Math.abs(centerVal - mean);
      const localStd = Math.sqrt(variance);
      
      // High severability if center is different AND neighborhood has structure
      const edgeScore = diff / Math.max(0.01, localStd);
      const coherenceScore = 1 - Math.exp(-localStd * 10); // More structure = higher score
      
      severability[idx] = edgeScore * coherenceScore;
    }
  }
  
  // Normalize severability
  let maxSev = 0;
  for (let i = 0; i < count; i++) {
    if (severability[i] > maxSev) maxSev = severability[i];
  }
  
  if (maxSev > 0) {
    for (let i = 0; i < count; i++) {
      severability[i] /= maxSev;
    }
  }
  
  return severability;
}

/**
 * Apply severability weighting to gradients
 * Emphasizes gradients at high-severability locations
 */
function applySeverabilityWeighting(g, severability, width, height, weight) {
  const count = width * height;
  const keepWeight = 1 - weight;
  
  for (let i = 0; i < count; i++) {
    // Weight gradient magnitude by severability
    const sevBoost = keepWeight + severability[i] * weight;
    g.grad[i] *= sevBoost;
    g.gx[i] *= sevBoost;
    g.gy[i] *= sevBoost;
  }
}

module.exports = {
  buildVectorSimplification,
  overlaySimplifiedLines
};

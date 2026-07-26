const { D, S, evaluate } = require('./harness');

const NAVY = [26, 26, 40];
const CORNER = 13; // Stack number region to ignore (top-left ~13x13)

// Composite candidate rgba onto navy background
function compositeOnNavy(rgba) {
  const rgb = new Uint8Array(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    const alpha = a / 255;
    rgb[i * 3] = Math.round(r * alpha + NAVY[0] * (1 - alpha));
    rgb[i * 3 + 1] = Math.round(g * alpha + NAVY[1] * (1 - alpha));
    rgb[i * 3 + 2] = Math.round(b * alpha + NAVY[2] * (1 - alpha));
  }
  return rgb;
}

// Zero out corner region (ignore stack numbers)
function maskCorner(rgb) {
  const masked = new Uint8Array(rgb);
  for (let y = 0; y < CORNER; y++) {
    for (let x = 0; x < CORNER; x++) {
      const idx = (y * S + x) * 3;
      masked[idx] = NAVY[0];
      masked[idx + 1] = NAVY[1];
      masked[idx + 2] = NAVY[2];
    }
  }
  return masked;
}

// Zero out corner weights
function maskWeightCorner(weights) {
  const masked = new Float32Array(weights);
  for (let y = 0; y < CORNER; y++) {
    for (let x = 0; x < CORNER; x++) {
      const idx = y * S + x;
      masked[idx] = 0;
    }
  }
  return masked;
}

// Get pixel with clamping
function getPixelNearest(rgb, x, y) {
  x = Math.max(0, Math.min(S - 1, Math.round(x)));
  y = Math.max(0, Math.min(S - 1, Math.round(y)));
  const idx = (y * S + x) * 3;
  return [rgb[idx], rgb[idx + 1], rgb[idx + 2]];
}

// Euclidean color distance
function colorDistance(p1, p2) {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const d = p1[i] - p2[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// Weighted SSD with alignment search over [-4..4] shifts
function weightedSSDWithAlignment(cellRgb, cellWeights, candRgb, candWeights) {
  let bestSSD = Infinity;

  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      let ssd = 0;
      let totalWeight = 0;

      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const idx = y * S + x;
          const w = cellWeights[idx];
          if (w < 0.05) continue; // Skip negligible weights

          const cellPx = getPixelNearest(cellRgb, x, y);
          const candPx = getPixelNearest(candRgb, x + dx, y + dy);

          const dist = colorDistance(cellPx, candPx);
          ssd += dist * dist * w;
          totalWeight += w;
        }
      }

      if (totalWeight > 0) {
        ssd /= totalWeight;
      }
      bestSSD = Math.min(bestSSD, ssd);
    }
  }

  return -bestSSD; // Negate for "higher = better" scoring
}

// Extract features: RGB + alpha-weighted foreground mask
function prep(rec, isCandidate) {
  let rgb;
  let rgba;
  if (isCandidate) {
    rgba = rec.rgba;
    rgb = compositeOnNavy(rgba);
  } else {
    rgb = rec.rgb;
  }

  rgb = maskCorner(rgb);

  // Build foreground weight map
  let weights = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const dist = colorDistance([r, g, b], NAVY);

    if (isCandidate) {
      // Use alpha channel: strong weight if a>50, soft weight if a>20
      const a = rgba[i * 4 + 3];
      if (a > 50) {
        weights[i] = 1.0;
      } else if (a > 20) {
        weights[i] = 0.2;
      } else {
        weights[i] = 0;
      }
    } else {
      // For cells: use distance from navy
      if (dist > 30) {
        weights[i] = 1.0;
      } else if (dist > 12) {
        weights[i] = 0.2;
      } else {
        weights[i] = 0;
      }
    }
  }
  weights = maskWeightCorner(weights);

  return { rgb, weights };
}

// Score: negative weighted SSD (lower SSD after alignment = better match)
function score(fA, fB) {
  return weightedSSDWithAlignment(fA.rgb, fA.weights, fB.rgb, fB.weights);
}

evaluate(prep, score, 'Final: foreground-weighted SSD + alignment [-4..4]');

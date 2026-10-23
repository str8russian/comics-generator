/**
 * Deterministic known-matte foreground extraction for Spike A Stage A1.
 * Border inliers estimate one matte. Exterior background grows only by
 * 4-connected CIE76 proximity from those seeds. Near-black pixels are a
 * contour barrier. Enclosed matte pockets are cleared only with strong
 * boundary evidence. Edge alpha is straight and narrow.
 */
import { EXTRACTION_CONFIG } from "./config.mjs";
import { deltaE, deltaELab, imageToLab, median, percentile, rgbToLab } from "./color.mjs";

const REJECT_LEVEL = "reject";
const REVIEW_LEVEL = "review";
const WARNING_LEVEL = "warning";

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function resolveConfig(overrides) {
  if (!overrides) return EXTRACTION_CONFIG;
  return { ...EXTRACTION_CONFIG, ...overrides };
}

function emptyResult(status, code, extra = {}) {
  return {
    status,
    reasons: status === "candidate-pass" ? [] : [code],
    warnings: [],
    findings: [{ code, level: status === "candidate-pass" ? WARNING_LEVEL : status }],
    rgba: null,
    alpha: null,
    metrics: extra.metrics || {},
    config: extra.config || EXTRACTION_CONFIG,
  };
}

function addFinding(findings, code, level, detail = null) {
  const existing = findings.find((item) => item.code === code);
  const rank = { warning: 0, review: 1, reject: 2 };
  if (!existing) {
    findings.push({ code, level, detail });
    return;
  }
  if (rank[level] > rank[existing.level]) existing.level = level;
  if (detail && !existing.detail) existing.detail = detail;
}

function finalize(findings) {
  let status = "candidate-pass";
  for (const finding of findings) {
    if (finding.level === REJECT_LEVEL) status = "reject";
    else if (finding.level === REVIEW_LEVEL && status !== "reject") status = "review";
  }
  return {
    status,
    reasons: findings.filter((item) => item.level === REJECT_LEVEL || item.level === REVIEW_LEVEL).map((item) => item.code),
    warnings: findings.filter((item) => item.level === WARNING_LEVEL).map((item) => item.code),
    findings,
  };
}

function alphaVaries(data, channels) {
  if (channels !== 4) return false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}

function collectBorder(width, height, band) {
  const pixels = [];
  const edgeOf = [];
  const push = (x, y, edge) => {
    pixels.push(y * width + x);
    edgeOf.push(edge);
  };
  for (let y = 0; y < band; y += 1) {
    for (let x = 0; x < width; x += 1) push(x, y, "top");
  }
  for (let y = height - band; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) push(x, y, "bottom");
  }
  for (let y = band; y < height - band; y += 1) {
    for (let x = 0; x < band; x += 1) push(x, y, "left");
    for (let x = width - band; x < width; x += 1) push(x, y, "right");
  }
  return { pixels, edgeOf };
}

function estimateMatte(L, A, B, data, channels, border, config) {
  const { pixels } = border;
  const lValues = new Float64Array(pixels.length);
  const aValues = new Float64Array(pixels.length);
  const bValues = new Float64Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 1) {
    const p = pixels[i];
    lValues[i] = L[p];
    aValues[i] = A[p];
    bValues[i] = B[p];
  }
  const rough = [median(lValues), median(aValues), median(bValues)];
  const inlierIndexes = [];
  for (let i = 0; i < pixels.length; i += 1) {
    const distance = Math.hypot(lValues[i] - rough[0], aValues[i] - rough[1], bValues[i] - rough[2]);
    if (distance <= config.matteInlierDeltaE) inlierIndexes.push(i);
  }
  const support = pixels.length === 0 ? 0 : inlierIndexes.length / pixels.length;
  if (inlierIndexes.length === 0) {
    return { support, matte: rough, rgb: [0, 0, 0], inlierIndexes };
  }
  const inL = [];
  const inA = [];
  const inB = [];
  const rs = [];
  const gs = [];
  const bs = [];
  for (const index of inlierIndexes) {
    const p = pixels[index];
    inL.push(L[p]);
    inA.push(A[p]);
    inB.push(B[p]);
    const offset = p * channels;
    rs.push(data[offset]);
    gs.push(data[offset + 1]);
    bs.push(data[offset + 2]);
  }
  return {
    support,
    matte: [median(inL), median(inA), median(inB)],
    rgb: [Math.round(median(rs)), Math.round(median(gs)), Math.round(median(bs))],
    inlierIndexes,
  };
}

function matteCellMedians(L, A, B, border, inlierSet, width, height, matte, config) {
  const { pixels, edgeOf } = border;
  const cells = [];
  for (let i = 0; i < pixels.length; i += 1) {
    const p = pixels[i];
    const x = p % width;
    const y = (p / width) | 0;
    const edge = edgeOf[i];
    let t = 0;
    if (edge === "top" || edge === "bottom") t = x / width;
    else t = y / height;
    const bin = Math.min(config.matteCellCount - 1, Math.floor(t * config.matteCellCount));
    const key = `${edge}:${bin}`;
    let cell = cells.find((item) => item.key === key);
    if (!cell) {
      cell = { key, total: 0, inliers: [] };
      cells.push(cell);
    }
    cell.total += 1;
    if (inlierSet.has(p)) cell.inliers.push(p);
  }
  const medians = [];
  for (const cell of cells) {
    const purity = cell.total === 0 ? 0 : cell.inliers.length / cell.total;
    if (cell.inliers.length < config.matteCellMinSamples || purity < config.matteCellMinPurity) continue;
    const ls = [];
    const as = [];
    const bs = [];
    for (const p of cell.inliers) {
      ls.push(L[p]);
      as.push(A[p]);
      bs.push(B[p]);
    }
    medians.push([median(ls), median(as), median(bs)]);
  }
  let maxDelta = 0;
  for (let i = 0; i < medians.length; i += 1) {
    for (let j = i + 1; j < medians.length; j += 1) {
      maxDelta = Math.max(maxDelta, deltaELab(medians[i], medians[j]));
    }
  }
  return { maxDelta, cellCount: medians.length, matteReference: matte };
}

function consistentEdgeSpread(L, A, B, border, width, matte, config) {
  const { pixels, edgeOf } = border;
  const grouped = { top: [], bottom: [], left: [], right: [] };
  for (let i = 0; i < pixels.length; i += 1) grouped[edgeOf[i]].push(pixels[i]);
  const edges = [];
  for (const [name, list] of Object.entries(grouped)) {
    if (list.length < config.edgeMinSamples) continue;
    const ls = [];
    const as = [];
    const bs = [];
    for (const p of list) {
      ls.push(L[p]);
      as.push(A[p]);
      bs.push(B[p]);
    }
    const center = [median(ls), median(as), median(bs)];
    const distances = list.map((p) => deltaE(L, A, B, p, center)).sort((a, b) => a - b);
    const p90 = percentile(distances, 0.9);
    edges.push({ name, count: list.length, center, p90, consistent: p90 <= config.edgeInternalMaxDeltaE });
  }
  let maxDelta = 0;
  const consistent = edges.filter((edge) => (
    edge.consistent && deltaELab(edge.center, matte) <= config.matteInlierDeltaE
  ));
  for (let i = 0; i < consistent.length; i += 1) {
    for (let j = i + 1; j < consistent.length; j += 1) {
      maxDelta = Math.max(maxDelta, deltaELab(consistent[i].center, consistent[j].center));
    }
  }
  return { edges, maxDelta };
}

function flood(width, height, seeds, traversable) {
  const n = width * height;
  const mask = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const seed of seeds) {
    if (mask[seed] || !traversable(seed)) continue;
    mask[seed] = 1;
    queue[tail] = seed;
    tail += 1;
  }
  while (head < tail) {
    const p = queue[head];
    head += 1;
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0 && !mask[p - 1] && traversable(p - 1)) {
      mask[p - 1] = 1;
      queue[tail] = p - 1;
      tail += 1;
    }
    if (x + 1 < width && !mask[p + 1] && traversable(p + 1)) {
      mask[p + 1] = 1;
      queue[tail] = p + 1;
      tail += 1;
    }
    if (y > 0 && !mask[p - width] && traversable(p - width)) {
      mask[p - width] = 1;
      queue[tail] = p - width;
      tail += 1;
    }
    if (y + 1 < height && !mask[p + width] && traversable(p + width)) {
      mask[p + width] = 1;
      queue[tail] = p + width;
      tail += 1;
    }
  }
  return mask;
}

function countMask(mask) {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) count += 1;
  return count;
}

function foregroundBounds(background, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let foreground = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (background[row + x]) continue;
      foreground += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (foreground === 0) {
    return { foreground, background: width * height, bbox: null, rectangularity: 0, margins: null };
  }
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  return {
    foreground,
    background: width * height - foreground,
    bbox: { x: minX, y: minY, width: boxWidth, height: boxHeight },
    rectangularity: foreground / (boxWidth * boxHeight),
    margins: [minX, minY, width - 1 - maxX, height - 1 - maxY],
  };
}

function edgeContacts(background, width, height) {
  const edges = [
    { edge: "top", length: width, at: (i) => i },
    { edge: "bottom", length: width, at: (i) => (height - 1) * width + i },
    { edge: "left", length: height, at: (i) => i * width },
    { edge: "right", length: height, at: (i) => i * width + width - 1 },
  ];
  return edges.map((spec) => {
    const runs = [];
    let current = null;
    let total = 0;
    for (let i = 0; i < spec.length; i += 1) {
      const foreground = background[spec.at(i)] === 0;
      if (foreground) {
        total += 1;
        if (!current) current = { start: i, length: 1 };
        else current.length += 1;
      } else if (current) {
        runs.push(current);
        current = null;
      }
    }
    if (current) runs.push(current);
    const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
    return {
      edge: spec.edge,
      runCount: runs.length,
      longestRun: longest,
      totalPixels: total,
      runs,
    };
  });
}

function enclosedComponents(L, A, B, dE, background, blocked, width, height, config) {
  const n = width * height;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const components = [];
  const touches = (p) => {
    const x = p % width;
    const y = (p / width) | 0;
    return x === 0 || y === 0 || x === width - 1 || y === height - 1;
  };
  for (let start = 0; start < n; start += 1) {
    if (seen[start] || background[start] || blocked[start] || dE[start] > config.pocketDeltaE) continue;
    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail] = start;
    tail += 1;
    let area = 0;
    let sum = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let perimeter = 0;
    let black = 0;
    let borderTouch = false;
    const members = [];
    while (head < tail) {
      const p = queue[head];
      head += 1;
      members.push(p);
      area += 1;
      sum += dE[p];
      const x = p % width;
      const y = (p / width) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (touches(p)) borderTouch = true;
      const neighbors = [];
      if (x > 0) neighbors.push(p - 1);
      if (x + 1 < width) neighbors.push(p + 1);
      if (y > 0) neighbors.push(p - width);
      if (y + 1 < height) neighbors.push(p + width);
      for (const next of neighbors) {
        if (!seen[next] && !background[next] && !blocked[next] && dE[next] <= config.pocketDeltaE) {
          seen[next] = 1;
          queue[tail] = next;
          tail += 1;
          continue;
        }
        if (background[next] || blocked[next] || dE[next] > config.pocketDeltaE) {
          perimeter += 1;
          if (blocked[next]) black += 1;
        }
      }
    }
    const thickness = Math.min(maxX - minX + 1, maxY - minY + 1);
    if (area < config.pocketMinArea || thickness < config.pocketMinThickness) continue;
    components.push({
      area,
      bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      centroid: {
        x: Math.round(members.reduce((sumX, p) => sumX + (p % width), 0) / area),
        y: Math.round(members.reduce((sumY, p) => sumY + ((p / width) | 0), 0) / area),
      },
      meanDeltaE: sum / area,
      blackFraction: perimeter === 0 ? 0 : black / perimeter,
      borderTouch,
      pixels: members,
    });
  }
  components.sort((a, b) => b.area - a.area);
  return components;
}

function classifyPockets(components, findings, config) {
  const reported = [];
  for (const component of components) {
    const matteLike = component.meanDeltaE <= config.pocketMatteMeanDeltaE;
    let action = "ignored";
    if (matteLike && component.area >= config.pocketNestedArea) {
      action = "rejected-as-nested";
      addFinding(findings, "inset-or-nested-canvas", REJECT_LEVEL, { area: component.area });
    } else if (
      matteLike &&
      !component.borderTouch &&
      component.blackFraction >= config.pocketClearBlackFraction &&
      component.meanDeltaE <= config.pocketClearMeanDeltaE &&
      component.area <= config.pocketMaxClearArea
    ) {
      action = "cleared";
    } else if (
      matteLike &&
      !component.borderTouch &&
      component.blackFraction >= config.pocketAmbiguousBlackFraction &&
      component.area < config.pocketNestedArea
    ) {
      action = "ambiguous";
      addFinding(findings, "ambiguous-enclosed-pocket", REVIEW_LEVEL, { area: component.area });
    } else if (matteLike && !component.borderTouch && component.blackFraction < config.pocketAmbiguousBlackFraction) {
      action = "protected";
      addFinding(findings, "matte-colored-foreground-risk", WARNING_LEVEL, { area: component.area });
    }
    reported.push({
      area: component.area,
      bbox: component.bbox,
      centroid: component.centroid,
      meanDeltaE: round(component.meanDeltaE, 2),
      blackFraction: round(component.blackFraction, 3),
      action,
    });
    if (action === "cleared") {
      addFinding(findings, "enclosed-pocket-cleared", WARNING_LEVEL, { area: component.area });
    }
  }
  return reported;
}

function leakyInteriorArea(background, width, height) {
  const n = width * height;
  const eroded = new Uint8Array(n);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (!background[p]) continue;
      let open = true;
      if (x > 0 && !background[p - 1]) open = false;
      if (x + 1 < width && !background[p + 1]) open = false;
      if (y > 0 && !background[p - width]) open = false;
      if (y + 1 < height && !background[p + width]) open = false;
      if (open) eroded[p] = 1;
    }
  }
  const reached = flood(width, height, borderSeeds(eroded, width, height), (p) => eroded[p] === 1);
  const seen = new Uint8Array(n);
  let leakArea = 0;
  const leaks = [];
  const queue = new Int32Array(n);
  for (let start = 0; start < n; start += 1) {
    if (!eroded[start] || reached[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail] = start;
    tail += 1;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let touchesBorder = false;
    while (head < tail) {
      const p = queue[head];
      head += 1;
      area += 1;
      const x = p % width;
      const y = (p / width) | 0;
      sx += x;
      sy += y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      if (x > 0 && eroded[p - 1] && !reached[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        queue[tail] = p - 1;
        tail += 1;
      }
      if (x + 1 < width && eroded[p + 1] && !reached[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        queue[tail] = p + 1;
        tail += 1;
      }
      if (y > 0 && eroded[p - width] && !reached[p - width] && !seen[p - width]) {
        seen[p - width] = 1;
        queue[tail] = p - width;
        tail += 1;
      }
      if (y + 1 < height && eroded[p + width] && !reached[p + width] && !seen[p + width]) {
        seen[p + width] = 1;
        queue[tail] = p + width;
        tail += 1;
      }
    }
    if (!touchesBorder) {
      leakArea += area;
      leaks.push({ area, centroid: { x: Math.round(sx / area), y: Math.round(sy / area) } });
    }
  }
  leaks.sort((a, b) => b.area - a.area);
  return { leakArea, leaks };
}

function borderSeeds(mask, width, height) {
  const seeds = [];
  for (let x = 0; x < width; x += 1) {
    if (mask[x]) seeds.push(x);
    const bottom = (height - 1) * width + x;
    if (mask[bottom]) seeds.push(bottom);
  }
  for (let y = 1; y < height - 1; y += 1) {
    const left = y * width;
    if (mask[left]) seeds.push(left);
    const right = left + width - 1;
    if (mask[right]) seeds.push(right);
  }
  return seeds;
}

function repairIsolatedTransparency(edge, data, channels, cleared, width, height, config) {
  const { alpha, rgba } = edge;
  const n = width * height;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let unexpected = 0;
  let restored = 0;
  for (let start = 0; start < n; start += 1) {
    if (seen[start] || alpha[start] !== 0) continue;
    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail] = start;
    tail += 1;
    const members = [];
    let touchesBorder = false;
    while (head < tail) {
      const p = queue[head];
      head += 1;
      members.push(p);
      const x = p % width;
      const y = (p / width) | 0;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      const visit = (next) => {
        if (seen[next] || alpha[next] !== 0) return;
        seen[next] = 1;
        queue[tail] = next;
        tail += 1;
      };
      if (x > 0) visit(p - 1);
      if (x + 1 < width) visit(p + 1);
      if (y > 0) visit(p - width);
      if (y + 1 < height) visit(p + width);
    }
    if (touchesBorder) continue;
    const orphans = members.filter((p) => !cleared[p]);
    if (orphans.length === 0) continue;
    if (orphans.length < config.destructiveHoleMinPixels) {
      for (const p of orphans) {
        const source = p * channels;
        const out = p * 4;
        rgba[out] = data[source];
        rgba[out + 1] = data[source + 1];
        rgba[out + 2] = data[source + 2];
        rgba[out + 3] = 255;
        alpha[p] = 255;
        restored += 1;
      }
      continue;
    }
    unexpected += orphans.length;
  }
  return { unexpected, restored };
}

export function interiorHoleArea(alpha, cleared, width, height) {
  const n = width * height;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let unexpected = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (seen[start] || alpha[start] !== 0) continue;
      let head = 0;
      let tail = 0;
      seen[start] = 1;
      queue[tail] = start;
      tail += 1;
      let touchesBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      let outsideCleared = 0;
      while (head < tail) {
        const p = queue[head];
        head += 1;
        if (!cleared[p]) outsideCleared += 1;
        const px = p % width;
        const py = (p / width) | 0;
        if (px === 0 || py === 0 || px === width - 1 || py === height - 1) touchesBorder = true;
        const tryNext = (next) => {
          if (seen[next] || alpha[next] !== 0) return;
          seen[next] = 1;
          queue[tail] = next;
          tail += 1;
        };
        if (px > 0) tryNext(p - 1);
        if (px + 1 < width) tryNext(p + 1);
        if (py > 0) tryNext(p - width);
        if (py + 1 < height) tryNext(p + width);
      }
      if (!touchesBorder) unexpected += outsideCleared;
    }
  }
  return unexpected;
}

function unmix(color, foreground, matte) {
  let weighted = 0;
  let weight = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const span = foreground[channel] - matte[channel];
    const magnitude = Math.abs(span);
    if (magnitude < 8) continue;
    weighted += ((color[channel] - matte[channel]) / span) * magnitude;
    weight += magnitude;
  }
  if (weight === 0) return { alpha: null, residual: Infinity };
  const alpha = Math.min(1, Math.max(0, weighted / weight));
  let residual = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const predicted = alpha * foreground[channel] + (1 - alpha) * matte[channel];
    residual += (predicted - color[channel]) ** 2;
  }
  return { alpha, residual: Math.sqrt(residual) };
}

function decontaminate(data, channels, L, background, cleared, width, height, matteRgb, config) {
  const n = width * height;
  const hard = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) hard[p] = background[p] || cleared[p] ? 0 : 255;
  const rgba = Buffer.alloc(n * 4);
  const boundary = new Uint8Array(n);
  const alpha = new Uint8Array(n);
  let boundaryCount = 0;
  let partialCount = 0;
  let unstable = 0;
  let residualSum = 0;
  let residualMax = 0;
  let worst = null;
  const localForeground = (p) => {
    const x = p % width;
    const y = (p / width) | 0;
    let best = null;
    let bestL = Infinity;
    const radius = config.decontamWindowPx;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (hard[next] !== 255) continue;
        if (L[next] < bestL) {
          bestL = L[next];
          const offset = next * channels;
          best = [data[offset], data[offset + 1], data[offset + 2]];
        }
      }
    }
    return best;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const offset = p * channels;
      const out = p * 4;
      const opaque = hard[p] === 255;
      let opposite = false;
      if (x > 0 && (hard[p - 1] === 255) !== opaque) opposite = true;
      if (x + 1 < width && (hard[p + 1] === 255) !== opaque) opposite = true;
      if (y > 0 && (hard[p - width] === 255) !== opaque) opposite = true;
      if (y + 1 < height && (hard[p + width] === 255) !== opaque) opposite = true;
      if (opposite) {
        boundary[p] = 1;
        boundaryCount += 1;
      }
      const rgb = [data[offset], data[offset + 1], data[offset + 2]];
      if (opaque && L[p] <= config.nearBlackLMax) {
        rgba[out] = rgb[0];
        rgba[out + 1] = rgb[1];
        rgba[out + 2] = rgb[2];
        rgba[out + 3] = 255;
        alpha[p] = 255;
        continue;
      }
      if (!opposite) {
        if (opaque) {
          rgba[out] = rgb[0];
          rgba[out + 1] = rgb[1];
          rgba[out + 2] = rgb[2];
          rgba[out + 3] = 255;
          alpha[p] = 255;
        }
        continue;
      }
      const foreground = localForeground(p);
      const mixed = foreground ? unmix(rgb, foreground, matteRgb) : { alpha: null, residual: Infinity };
      const unstablePixel = mixed.alpha == null || mixed.residual > config.decontamMaxResidual;
      if (unstablePixel) unstable += 1;
      if (Number.isFinite(mixed.residual)) {
        residualSum += mixed.residual;
        if (mixed.residual > residualMax) {
          residualMax = mixed.residual;
          worst = { x, y, residual: mixed.residual };
        }
      }
      let outAlpha = opaque ? 255 : 0;
      let outRgb = opaque ? rgb : [0, 0, 0];
      const partial = !unstablePixel
        && mixed.alpha > config.decontamPartialAlphaMin
        && mixed.alpha < config.decontamPartialAlphaMax;
      if (partial) {
        outAlpha = Math.round(mixed.alpha * 255);
        outRgb = foreground;
        partialCount += 1;
      } else if (!opaque) {
        outAlpha = 0;
        outRgb = [0, 0, 0];
      }
      rgba[out] = outRgb[0];
      rgba[out + 1] = outRgb[1];
      rgba[out + 2] = outRgb[2];
      rgba[out + 3] = outAlpha;
      alpha[p] = outAlpha;
    }
  }
  return {
    rgba,
    alpha,
    boundary,
    boundaryCount,
    partialCount,
    unstable,
    residualMean: boundaryCount === 0 ? 0 : residualSum / boundaryCount,
    residualMax,
    worst,
  };
}

function alphaHistogram(alpha) {
  const bins = [
    { name: "0", count: 0 },
    { name: "1-63", count: 0 },
    { name: "64-127", count: 0 },
    { name: "128-191", count: 0 },
    { name: "192-254", count: 0 },
    { name: "255", count: 0 },
  ];
  for (let i = 0; i < alpha.length; i += 1) {
    const value = alpha[i];
    if (value === 0) bins[0].count += 1;
    else if (value < 64) bins[1].count += 1;
    else if (value < 128) bins[2].count += 1;
    else if (value < 192) bins[3].count += 1;
    else if (value < 255) bins[4].count += 1;
    else bins[5].count += 1;
  }
  return bins;
}

function glowFraction(data, channels, dE, hardBoundary, background, width, height, config) {
  let boundary = 0;
  let lowContrast = 0;
  const n = width * height;
  for (let p = 0; p < n; p += 1) {
    if (!hardBoundary[p] || background[p]) continue;
    boundary += 1;
    if (dE[p] <= config.glowBoundaryDeltaE) lowContrast += 1;
  }
  return { boundary, lowContrast, fraction: boundary === 0 ? 0 : lowContrast / boundary };
}

function hardBoundary(background, width, height) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (background[p]) continue;
      if (
        (x > 0 && background[p - 1]) ||
        (x + 1 < width && background[p + 1]) ||
        (y > 0 && background[p - width]) ||
        (y + 1 < height && background[p + width])
      ) {
        mask[p] = 1;
      }
    }
  }
  return mask;
}

function erodeMemberCount(members, width, height, iterations) {
  const n = width * height;
  let mask = new Uint8Array(n);
  for (const pixel of members) mask[pixel] = 1;
  for (let step = 0; step < iterations; step += 1) {
    const next = new Uint8Array(n);
    for (const pixel of members) {
      const x = pixel % width;
      const y = (pixel / width) | 0;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
      if (mask[pixel] && mask[pixel - 1] && mask[pixel + 1] && mask[pixel - width] && mask[pixel + width]) {
        next[pixel] = 1;
      }
    }
    mask = next;
  }
  let count = 0;
  for (const pixel of members) if (mask[pixel]) count += 1;
  return count;
}

function contourHitFraction(members, blocked, width, height, radius) {
  const member = new Uint8Array(width * height);
  for (const pixel of members) member[pixel] = 1;
  let boundary = 0;
  let hits = 0;
  for (const pixel of members) {
    const x = pixel % width;
    const y = (pixel / width) | 0;
    const onCanvas = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    const exposed = onCanvas
      || x === 0 || !member[pixel - 1]
      || x === width - 1 || !member[pixel + 1]
      || y === 0 || !member[pixel - width]
      || y === height - 1 || !member[pixel + width];
    if (!exposed) continue;
    boundary += 1;
    let found = false;
    for (let dy = -radius; dy <= radius && !found; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (blocked[ny * width + nx]) {
          found = true;
          break;
        }
      }
    }
    if (found) hits += 1;
  }
  return boundary === 0 ? 0 : hits / boundary;
}

function reclaimMatteEdgeGarments(dE, background, blocked, width, height, config) {
  const n = width * height;
  const candidate = new Uint8Array(n);
  for (let pixel = 0; pixel < n; pixel += 1) {
    if (background[pixel] && dE[pixel] > config.reclaimMinDeltaE && dE[pixel] <= config.connectivityDeltaE) {
      candidate[pixel] = 1;
    }
  }
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const regions = [];
  for (let start = 0; start < n; start += 1) {
    if (!candidate[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail] = start;
    tail += 1;
    const members = [];
    let borderTouch = false;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let sum = 0;
    let sx = 0;
    let sy = 0;
    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      members.push(pixel);
      sum += dE[pixel];
      const x = pixel % width;
      const y = (pixel / width) | 0;
      sx += x;
      sy += y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) borderTouch = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      const visit = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const next = ny * width + nx;
        if (!seen[next] && candidate[next]) {
          seen[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      };
      visit(x - 1, y);
      visit(x + 1, y);
      visit(x, y - 1);
      visit(x, y + 1);
    }
    if (!borderTouch || members.length < config.reclaimMinArea) continue;
    const coreArea = erodeMemberCount(members, width, height, config.reclaimErodePx);
    if (coreArea < config.reclaimMinCore) continue;
    const contourFraction = contourHitFraction(members, blocked, width, height, config.reclaimContourRadius);
    const reclaimed = contourFraction >= config.reclaimContourFraction;
    if (reclaimed) {
      for (const pixel of members) background[pixel] = 0;
    }
    regions.push({
      area: members.length,
      coreArea,
      meanDeltaE: round(sum / members.length, 2),
      contourFraction: round(contourFraction, 3),
      reclaimed,
      bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      centroid: { x: Math.round(sx / members.length), y: Math.round(sy / members.length) },
    });
  }
  regions.sort((a, b) => b.area - a.area);
  return regions;
}

export function extractForeground(image, overrides) {
  const config = resolveConfig(overrides);
  const { width, height, data, channels } = image;
  if (!width || !height || !data || channels !== 3 && channels !== 4) {
    return emptyResult("reject", "decode-failed", { config });
  }
  if (width < config.minImagePx || height < config.minImagePx) {
    return emptyResult("reject", "decode-failed", { config, metrics: { width, height } });
  }
  if (alphaVaries(data, channels)) {
    return emptyResult("reject", "input-already-has-alpha", {
      config,
      metrics: { width, height, channels, hasAlpha: true },
    });
  }
  const { L, A, B } = imageToLab(data, width, height, channels);
  const blocked = new Uint8Array(width * height);
  for (let p = 0; p < blocked.length; p += 1) {
    if (L[p] <= config.nearBlackLMax && Math.hypot(A[p], B[p]) <= config.nearBlackChromaMax) blocked[p] = 1;
  }
  const border = collectBorder(width, height, config.borderBandPx);
  const estimated = estimateMatte(L, A, B, data, channels, border, config);
  const findings = [];
  if (estimated.support < config.minPerimeterSupport) {
    addFinding(findings, "insufficient-matte-border-support", REJECT_LEVEL, { support: round(estimated.support, 4) });
  }
  const dE = new Float32Array(width * height);
  for (let p = 0; p < dE.length; p += 1) dE[p] = deltaE(L, A, B, p, estimated.matte);
  const inlierSet = new Set(estimated.inlierIndexes.map((index) => border.pixels[index]));
  const cells = matteCellMedians(L, A, B, border, inlierSet, width, height, estimated.matte, config);
  const edgeSpread = consistentEdgeSpread(L, A, B, border, width, estimated.matte, config);
  const spatialDelta = Math.max(cells.maxDelta, edgeSpread.maxDelta);
  if (spatialDelta >= config.matteSpatialRejectDeltaE) {
    addFinding(findings, "non-uniform-matte", REJECT_LEVEL, { spatialDeltaE: round(spatialDelta, 2) });
  } else if (spatialDelta >= config.matteSpatialReviewDeltaE) {
    addFinding(findings, "non-uniform-matte", REVIEW_LEVEL, { spatialDeltaE: round(spatialDelta, 2) });
  }
  const seeds = [];
  for (const p of border.pixels) {
    if (dE[p] <= config.seedDeltaE && !blocked[p]) seeds.push(p);
  }
  const traversable = (threshold) => (p) => dE[p] <= threshold && !blocked[p];
  const background = flood(width, height, seeds, traversable(config.connectivityDeltaE));
  const lowCount = countMask(flood(width, height, seeds, traversable(Math.max(1, config.connectivityDeltaE - config.sensitivityDeltaE))));
  const highCount = countMask(flood(width, height, seeds, traversable(config.connectivityDeltaE + config.sensitivityDeltaE)));
  const baseCount = countMask(background);
  const sensitivityFraction = Math.max(Math.abs(lowCount - baseCount), Math.abs(highCount - baseCount)) / (width * height);
  if (sensitivityFraction > config.sensitivityMaxFraction) {
    addFinding(findings, "threshold-sensitivity", REVIEW_LEVEL, { fraction: round(sensitivityFraction, 4) });
  }
  const geometry = foregroundBounds(background, width, height);
  const areaFraction = geometry.foreground / (width * height);
  if (areaFraction < config.minForegroundFraction || areaFraction > config.maxForegroundFraction) {
    addFinding(findings, "implausible-foreground-area", REJECT_LEVEL, { foregroundFraction: round(areaFraction, 4) });
  }
  if (
    geometry.bbox &&
    geometry.rectangularity >= config.insetMinRectangularity &&
    geometry.margins.every((margin) => margin >= config.insetMinMarginPx)
  ) {
    addFinding(findings, "inset-or-nested-canvas", REJECT_LEVEL, {
      rectangularity: round(geometry.rectangularity, 3),
      margins: geometry.margins,
    });
  }
  const leak = leakyInteriorArea(background, width, height);
  if (leak.leakArea >= config.leakMinErodedArea) {
    addFinding(findings, "contour-gap-leak-risk", REJECT_LEVEL, { erodedArea: leak.leakArea });
  }
  const components = enclosedComponents(L, A, B, dE, background, blocked, width, height, config);
  const pocketReport = classifyPockets(components, findings, config);
  const cleared = new Uint8Array(width * height);
  for (let index = 0; index < components.length; index += 1) {
    if (pocketReport[index]?.action !== "cleared") continue;
    for (const p of components[index].pixels) cleared[p] = 1;
  }
  const edgeGarments = reclaimMatteEdgeGarments(dE, background, blocked, width, height, config);
  if (edgeGarments.length > 0) {
    addFinding(findings, "matte-like-edge-contact", REVIEW_LEVEL, {
      reclaimed: edgeGarments.filter((region) => region.reclaimed).map((region) => region.area),
      withheld: edgeGarments.filter((region) => !region.reclaimed).map((region) => region.area),
    });
  }
  const finalGeometry = foregroundBounds(background, width, height);
  const finalFraction = finalGeometry.foreground / (width * height);
  const contacts = edgeContacts(background, width, height);
  if (contacts.some((edge) => edge.totalPixels > 0)) {
    addFinding(findings, "canvas-edge-contact", WARNING_LEVEL, {
      edges: contacts.filter((edge) => edge.totalPixels > 0).map((edge) => edge.edge),
    });
  }
  const edge = decontaminate(data, channels, L, background, cleared, width, height, estimated.rgb, config);
  const holes = repairIsolatedTransparency(edge, data, channels, cleared, width, height, config);
  if (holes.unexpected > 0) {
    addFinding(findings, "destructive-interior-hole", REJECT_LEVEL, { pixels: holes.unexpected });
  }
  const unstableFraction = edge.boundaryCount === 0 ? 0 : edge.unstable / edge.boundaryCount;
  if (unstableFraction >= config.unstableBoundaryFractionReject) {
    addFinding(findings, "unstable-edge-decontamination", REJECT_LEVEL, { fraction: round(unstableFraction, 3) });
  } else if (unstableFraction >= config.unstableBoundaryFractionReview) {
    addFinding(findings, "unstable-edge-decontamination", REVIEW_LEVEL, { fraction: round(unstableFraction, 3) });
  } else if (edge.residualMean > config.decontamMaxResidual / 2) {
    addFinding(findings, "edge-decontamination-residual", WARNING_LEVEL, { mean: round(edge.residualMean, 2) });
  }
  const boundaryMask = hardBoundary(background, width, height);
  const glow = glowFraction(data, channels, dE, boundaryMask, background, width, height, config);
  if (glow.fraction >= config.glowBoundaryFractionReview) {
    addFinding(findings, "exterior-glow-or-strands", REVIEW_LEVEL, { fraction: round(glow.fraction, 3) });
  }
  const decision = finalize(findings);
  const matteLab = estimated.matte.map((value) => round(value, 2));
  return {
    ...decision,
    rgba: edge.rgba,
    alpha: edge.alpha,
    boundary: edge.boundary,
    config,
    metrics: {
      width,
      height,
      channels,
      hasAlpha: channels === 4,
      matte: { rgb: estimated.rgb, lab: matteLab },
      perimeterSupport: round(estimated.support, 4),
      spatialDeltaE: round(spatialDelta, 2),
      matteCellCount: cells.cellCount,
      backgroundArea: finalGeometry.background,
      foregroundArea: finalGeometry.foreground,
      foregroundFraction: round(finalFraction, 4),
      foregroundBBox: finalGeometry.bbox,
      rectangularity: round(finalGeometry.rectangularity, 3),
      margins: finalGeometry.margins,
      matteEdgeContact: edgeGarments.length === 0 ? null : {
        reclaimedArea: edgeGarments.filter((region) => region.reclaimed).reduce((sum, region) => sum + region.area, 0),
        regions: edgeGarments.slice(0, 6),
        largest: edgeGarments[0],
      },
      edgeContacts: contacts.map(({ runs, ...rest }) => rest),
      edgeContactRuns: contacts,
      enclosedComponents: pocketReport,
      leakErodedArea: leak.leakArea,
      leakSites: leak.leaks.slice(0, 5),
      alphaHistogram: alphaHistogram(edge.alpha),
      boundaryPixelCount: edge.boundaryCount,
      decontamination: {
        partialPixels: edge.partialCount,
        restoredOrphanPixels: holes.restored,
        unstablePixels: edge.unstable,
        unstableFraction: round(unstableFraction, 4),
        residualMean: round(edge.residualMean, 3),
        residualMax: round(edge.residualMax, 3),
        worst: edge.worst ? { x: edge.worst.x, y: edge.worst.y, residual: round(edge.worst.residual, 3) } : null,
      },
      glow: {
        boundary: glow.boundary,
        lowContrast: glow.lowContrast,
        fraction: round(glow.fraction, 4),
      },
      sensitivityFraction: round(sensitivityFraction, 4),
      thresholdProbe: { lowCount, baseCount, highCount },
    },
  };
}

export function labOfRgb(rgb) {
  return rgbToLab(rgb[0], rgb[1], rgb[2]);
}

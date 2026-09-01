/** Measurements that compare construction while largely ignoring grade and exposure. */
export interface FrameStructure {
  silhouette: Uint8Array;
  edges: Uint8Array;
  skeleton: Uint8Array;
  components: number;
  holes: number;
  endpoints: number;
  junctions: number;
}

export interface StructuralDifference {
  /** Intersection over union of normalized luminous silhouettes, 0–1. */
  silhouetteIoU: number;
  /** Symmetric distance between contour pixels, as a share of the frame diagonal. */
  contourDistance: number;
  leftComponents: number;
  rightComponents: number;
  leftHoles: number;
  rightHoles: number;
  leftEndpoints: number;
  rightEndpoints: number;
  leftJunctions: number;
  rightJunctions: number;
}

/** Coarse spatial chromaticity, independent of exposure and tube thickness. */
export interface MaterialStructure {
  columns: number;
  rows: number;
  /** Per cell: red share, green share, blue share, saturation, occupied flag. */
  cells: Float32Array;
}

const luma = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Normalize every frame by its own bright material, so cyan and magenta compare as geometry. */
function normalizedLuma(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const count = width * height;
  if (pixels.length !== count * 4) {
    throw new Error(`expected ${count * 4} RGBA bytes, received ${pixels.length}`);
  }
  const values = new Float32Array(count);
  const histogram = new Uint32Array(256);
  for (let index = 0; index < count; index++) {
    const at = index * 4;
    const value = luma(pixels[at], pixels[at + 1], pixels[at + 2]);
    values[index] = value;
    histogram[Math.max(0, Math.min(255, Math.round(value)))] += 1;
  }

  // The 98th percentile is the material's own white. A single clipped pixel
  // or compression spark cannot set the scale, and a dark exposure of the same
  // object therefore yields the same skeleton as its bright phase.
  const wanted = Math.max(1, Math.ceil(count * 0.98));
  let held = 0;
  let white = 1;
  for (let value = 0; value < histogram.length; value++) {
    held += histogram[value];
    if (held >= wanted) {
      white = Math.max(value, 1);
      break;
    }
  }
  const scale = 255 / white;
  for (let index = 0; index < values.length; index++) {
    values[index] = Math.min(255, values[index] * scale);
  }
  return values;
}

function regions(
  mask: Uint8Array,
  width: number,
  height: number,
  value: 0 | 1,
  minimum = Math.max(6, Math.floor(width * height * 0.00025)),
): {
  components: number;
  enclosed: number;
} {
  const count = width * height;
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  let components = 0;
  let enclosed = 0;

  for (let start = 0; start < count; start++) {
    if (seen[start] || mask[start] !== value) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    let border = false;
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const at = queue[head++];
      const x = at % width;
      const y = Math.floor(at / width);
      area += 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true;
      for (const next of [at - 1, at + 1, at - width, at + width]) {
        if (next < 0 || next >= count || seen[next] || mask[next] !== value) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
    if (area < minimum) continue;
    components += 1;
    if (!border) enclosed += 1;
  }
  return { components, enclosed };
}

/** Zhang–Suen thinning: reduce luminous tube cores to one-pixel curve skeletons. */
function thin(mask: Uint8Array, width: number, height: number): Uint8Array {
  const held = new Uint8Array(mask);
  const remove = new Uint8Array(mask.length);
  const neighbours = (at: number) => [
    held[at - width], held[at - width + 1], held[at + 1], held[at + width + 1],
    held[at + width], held[at + width - 1], held[at - 1], held[at - width - 1],
  ];
  for (let pass = 0; pass < width + height; pass++) {
    let changed = false;
    for (const second of [false, true]) {
      remove.fill(0);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const at = y * width + x;
          if (!held[at]) continue;
          const n = neighbours(at);
          const total = n.reduce((sum, value) => sum + value, 0);
          if (total < 2 || total > 6) continue;
          let transitions = 0;
          for (let index = 0; index < n.length; index++) {
            if (!n[index] && n[(index + 1) % n.length]) transitions += 1;
          }
          if (transitions !== 1) continue;
          const [north, , east, , south, , west] = n;
          const firstGate = second ? north * east * west : north * east * south;
          const secondGate = second ? north * south * west : east * south * west;
          if (firstGate || secondGate) continue;
          remove[at] = 1;
        }
      }
      for (let index = 0; index < held.length; index++) {
        if (!remove[index]) continue;
        held[index] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return held;
}

export function structureOf(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): FrameStructure {
  const values = normalizedLuma(pixels, width, height);
  const count = width * height;
  const silhouette = new Uint8Array(count);
  const edges = new Uint8Array(count);
  // Stay on the tube material, not its halo. A low threshold turns bloom into
  // one soft blob and destroys the very holes and crossings this comparator is
  // meant to preserve.
  for (let index = 0; index < count; index++) silhouette[index] = values[index] >= 64 ? 1 : 0;

  // A ray-marched highlight and a compressed highlight both carry isolated
  // one-pixel holes. One majority pass removes those acquisition artifacts
  // before topology is counted without rounding away a tube several pixels
  // wide or joining neighbours across a real black gap.
  const smoothed = new Uint8Array(silhouette);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) neighbours += silhouette[(y + dy) * width + x + dx];
      }
      smoothed[y * width + x] = neighbours >= 5 ? 1 : 0;
    }
  }
  silhouette.set(smoothed);

  // A central-difference contour plus the binary silhouette boundary. The
  // latter keeps a broad bloom from erasing the tube it came from; the former
  // preserves internal reflective bands and occlusion edges.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = y * width + x;
      const gradient = Math.hypot(
        values[at + 1] - values[at - 1],
        values[at + width] - values[at - width],
      );
      const boundary = silhouette[at] && (
        !silhouette[at - 1] || !silhouette[at + 1] ||
        !silhouette[at - width] || !silhouette[at + width]
      );
      edges[at] = gradient >= 36 || boundary ? 1 : 0;
    }
  }

  const lit = regions(silhouette, width, height, 1);
  const dark = regions(silhouette, width, height, 0);
  const skeleton = thin(silhouette, width, height);
  const junctionMask = new Uint8Array(count);
  let endpoints = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = y * width + x;
      if (!skeleton[at]) continue;
      let degree = 0;
      for (const next of [
        at - width - 1, at - width, at - width + 1, at - 1,
        at + 1, at + width - 1, at + width, at + width + 1,
      ]) degree += skeleton[next];
      if (degree === 1) endpoints += 1;
      // Three neighbours happens along ordinary diagonal stair-steps in an
      // eight-connected skeleton. Four is where two visible curves actually
      // meet or cross.
      if (degree >= 4) junctionMask[at] = 1;
    }
  }
  const junctions = regions(junctionMask, width, height, 1, 1).components;
  return {
    silhouette,
    edges,
    skeleton,
    components: lit.components,
    holes: dark.enclosed,
    endpoints,
    junctions,
  };
}

/**
 * Preserve where authored/material colours live without comparing brightness.
 *
 * The grid is deliberately coarse: it distinguishes a cyan cap from an amber
 * centre and alternating rails from one flat tint, while a two-pixel projection
 * shift or a wider bloom cannot dominate the result. RGB is divided by its sum
 * per pixel, so exposure and emissive strength are not mistaken for material.
 */
export function materialStructureOf(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  columns = 8,
  rows = 5,
): MaterialStructure {
  if (pixels.length !== width * height * 4) throw new Error('material structure dimensions do not match');
  const cells = new Float32Array(columns * rows * 5);
  const counts = new Uint32Array(columns * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.min(rows - 1, Math.floor((y / height) * rows));
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const r = pixels[at];
      const g = pixels[at + 1];
      const b = pixels[at + 2];
      const most = Math.max(r, g, b);
      if (most < 16) continue;
      const sum = Math.max(1, r + g + b);
      const cell = row * columns + Math.min(columns - 1, Math.floor((x / width) * columns));
      const out = cell * 5;
      cells[out] += r / sum;
      cells[out + 1] += g / sum;
      cells[out + 2] += b / sum;
      cells[out + 3] += (most - Math.min(r, g, b)) / most;
      counts[cell] += 1;
    }
  }
  for (let cell = 0; cell < counts.length; cell++) {
    const count = counts[cell];
    if (!count) continue;
    const at = cell * 5;
    cells[at] /= count;
    cells[at + 1] /= count;
    cells[at + 2] /= count;
    cells[at + 3] /= count;
    cells[at + 4] = 1;
  }
  return { columns, rows, cells };
}

/** Mean spatial chromaticity/saturation difference, 0 for the same materials. */
export function materialStructureDifference(left: MaterialStructure, right: MaterialStructure): number {
  if (left.columns !== right.columns || left.rows !== right.rows || left.cells.length !== right.cells.length) {
    throw new Error('material structures use different grids');
  }
  let total = 0;
  let compared = 0;
  for (let at = 0; at < left.cells.length; at += 5) {
    const leftOn = left.cells[at + 4] > 0;
    const rightOn = right.cells[at + 4] > 0;
    if (!leftOn && !rightOn) continue;
    compared += 1;
    if (!leftOn || !rightOn) {
      total += 0.5;
      continue;
    }
    const chromaticity = (
      Math.abs(left.cells[at] - right.cells[at]) +
      Math.abs(left.cells[at + 1] - right.cells[at + 1]) +
      Math.abs(left.cells[at + 2] - right.cells[at + 2])
    ) / 2;
    const saturation = Math.abs(left.cells[at + 3] - right.cells[at + 3]);
    total += chromaticity * 0.75 + saturation * 0.25;
  }
  return compared ? total / compared : 0;
}

function distanceTo(mask: Uint8Array, width: number, height: number): Float32Array {
  const distance = new Float32Array(mask.length);
  const diagonal = Math.SQRT2;
  const unreachable = Math.hypot(width, height);
  // If one phase is completely dark, construction is maximally unknown rather
  // than a million pixels away. Capping here keeps temporal blackouts finite
  // and lets the phase search align them instead of poisoning every mean.
  for (let index = 0; index < mask.length; index++) {
    distance[index] = mask[index] ? 0 : unreachable;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      if (x > 0) distance[at] = Math.min(distance[at], distance[at - 1] + 1);
      if (y > 0) distance[at] = Math.min(distance[at], distance[at - width] + 1);
      if (x > 0 && y > 0) distance[at] = Math.min(distance[at], distance[at - width - 1] + diagonal);
      if (x + 1 < width && y > 0) {
        distance[at] = Math.min(distance[at], distance[at - width + 1] + diagonal);
      }
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const at = y * width + x;
      if (x + 1 < width) distance[at] = Math.min(distance[at], distance[at + 1] + 1);
      if (y + 1 < height) distance[at] = Math.min(distance[at], distance[at + width] + 1);
      if (x + 1 < width && y + 1 < height) {
        distance[at] = Math.min(distance[at], distance[at + width + 1] + diagonal);
      }
      if (x > 0 && y + 1 < height) {
        distance[at] = Math.min(distance[at], distance[at + width - 1] + diagonal);
      }
    }
  }
  return distance;
}

export function structuralDifference(
  left: FrameStructure,
  right: FrameStructure,
  width: number,
  height: number,
): StructuralDifference {
  if (left.silhouette.length !== width * height || right.silhouette.length !== width * height) {
    throw new Error('structure dimensions do not match the requested frame');
  }
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < left.silhouette.length; index++) {
    if (left.silhouette[index] && right.silhouette[index]) intersection += 1;
    if (left.silhouette[index] || right.silhouette[index]) union += 1;
  }

  const leftDistance = distanceTo(left.edges, width, height);
  const rightDistance = distanceTo(right.edges, width, height);
  let total = 0;
  let points = 0;
  for (let index = 0; index < left.edges.length; index++) {
    if (left.edges[index]) {
      total += rightDistance[index];
      points += 1;
    }
    if (right.edges[index]) {
      total += leftDistance[index];
      points += 1;
    }
  }
  const frameDiagonal = Math.hypot(width, height);
  return {
    silhouetteIoU: union ? intersection / union : 1,
    contourDistance: points ? total / points / frameDiagonal : 1,
    leftComponents: left.components,
    rightComponents: right.components,
    leftHoles: left.holes,
    rightHoles: right.holes,
    leftEndpoints: left.endpoints,
    rightEndpoints: right.endpoints,
    leftJunctions: left.junctions,
    rightJunctions: right.junctions,
  };
}

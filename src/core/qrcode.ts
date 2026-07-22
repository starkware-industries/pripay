// Minimal QR code encoder — byte mode only, versions 1-10, all four ECC
// levels. Self-contained because node_modules is vendored and adding a
// dependency is off the table. Follows ISO/IEC 18004; structure mirrors
// the well-known Nayuki reference implementation.
//
// encodeQR(text) -> boolean[][] (true = dark module)
// qrToSvg(matrix, size) -> SVGElement ready to insert

export type Ecl = 'L' | 'M' | 'Q' | 'H';

// (ecPerBlock, [numBlocks, dataCodewordsPerBlock][]) indexed by version-1.
const EC_TABLE: Record<Ecl, Array<[number, Array<[number, number]>]>> = {
  L: [
    [7, [[1, 19]]], [10, [[1, 34]]], [15, [[1, 55]]], [20, [[1, 80]]], [26, [[1, 108]]],
    [18, [[2, 68]]], [20, [[2, 78]]], [24, [[2, 97]]], [30, [[2, 116]]], [18, [[2, 68], [2, 69]]],
  ],
  M: [
    [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
    [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]],
  ],
  Q: [
    [13, [[1, 13]]], [22, [[1, 22]]], [18, [[2, 17]]], [26, [[2, 24]]], [18, [[2, 15], [2, 16]]],
    [24, [[4, 19]]], [18, [[2, 14], [4, 15]]], [22, [[4, 18], [2, 19]]], [20, [[4, 16], [4, 17]]], [24, [[6, 19], [2, 20]]],
  ],
  H: [
    [17, [[1, 9]]], [28, [[1, 16]]], [22, [[2, 13]]], [16, [[4, 9]]], [22, [[2, 11], [2, 12]]],
    [28, [[4, 15]]], [26, [[4, 13], [1, 14]]], [26, [[4, 14], [2, 15]]], [24, [[4, 12], [4, 13]]], [28, [[6, 15], [2, 16]]],
  ],
};
const REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
const ALIGNMENT: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];
const ECL_BITS: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };

// --- GF(256) arithmetic for Reed-Solomon, polynomial 0x11D ------------------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a: number, b: number): number => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], GF_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse(); // highest-degree first, leading 1
}

function rsRemainder(data: Uint8Array, gen: Uint8Array): Uint8Array {
  const rem = new Uint8Array(gen.length - 1);
  for (const b of data) {
    const factor = b ^ rem[0];
    rem.copyWithin(0, 1);
    rem[rem.length - 1] = 0;
    for (let i = 0; i < rem.length; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

// --- Encoding ----------------------------------------------------------------
export function encodeQR(text: string, ecl: Ecl = 'M'): boolean[][] {
  const bytes = new TextEncoder().encode(text);

  // Smallest version that fits the byte-mode payload.
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const dataBytes = EC_TABLE[ecl][v - 1][1].reduce((n, [c, len]) => n + c * len, 0);
    const countBits = v <= 9 ? 8 : 16;
    if (4 + countBits + 8 * bytes.length <= 8 * dataBytes) { version = v; break; }
  }
  if (!version) throw new Error(`QR payload too long (${bytes.length} bytes) for versions 1-10 at ECL ${ecl}`);

  const [ecPerBlock, blockSpec] = EC_TABLE[ecl][version - 1];
  const totalData = blockSpec.reduce((n, [c, len]) => n + c * len, 0);
  const countBits = version <= 9 ? 8 : 16;

  // Bit stream: mode 0100, char count, data, terminator, pad codewords.
  const bits: number[] = [];
  const push = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, countBits);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, 8 * totalData - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < 8 * totalData; pad ^= 0xec ^ 0x11) push(pad, 8);

  const data = new Uint8Array(totalData);
  bits.forEach((bit, i) => { data[i >> 3] |= bit << (7 - (i & 7)); });

  // Split into blocks, compute EC, interleave.
  const gen = rsGenerator(ecPerBlock);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let off = 0;
  for (const [count, len] of blockSpec) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(off, off + len);
      off += len;
      dataBlocks.push(block);
      ecBlocks.push(rsRemainder(block, gen));
    }
  }
  const maxLen = Math.max(...dataBlocks.map((b) => b.length));
  const codewords: number[] = [];
  for (let i = 0; i < maxLen; i++) for (const b of dataBlocks) { if (i < b.length) codewords.push(b[i]); }
  for (let i = 0; i < ecPerBlock; i++) for (const b of ecBlocks) codewords.push(b[i]);

  return buildMatrix(version, ecl, new Uint8Array(codewords));
}

// --- Matrix construction ------------------------------------------------------
function buildMatrix(version: number, ecl: Ecl, codewords: Uint8Array): boolean[][] {
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFunc[y][x] = true; };

  // Finder patterns + separators.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  // Alignment patterns (skip any overlapping a finder).
  const centers = ALIGNMENT[version - 1];
  for (const cy of centers) {
    for (const cx of centers) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    if (!isFunc[6][i]) set(i, 6, i % 2 === 0);
    if (!isFunc[i][6]) set(6, i, i % 2 === 0);
  }
  // Reserve format areas (values drawn per-mask later) + dark module.
  for (let i = 0; i <= 8; i++) {
    if (!isFunc[8][i]) set(i, 8, false);
    if (!isFunc[i][8]) set(8, i, false);
    if (i < 8) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
  }
  set(8, size - 8, true);
  // Version info (v >= 7): 6 bits + 12-bit BCH, poly 0x1F25.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((vbits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // Zigzag data placement.
  let bitIdx = 0;
  const totalBits = codewords.length * 8 + REMAINDER_BITS[version - 1];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunc[y][x] && bitIdx < totalBits) {
          modules[y][x] = bitIdx < codewords.length * 8
            && ((codewords[bitIdx >> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
          bitIdx++;
        }
      }
    }
  }

  // Try all 8 masks, keep the lowest-penalty one.
  const MASKS: Array<(x: number, y: number) => boolean> = [
    (x, y) => (x + y) % 2 === 0,
    (_, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!isFunc[y][x] && MASKS[m](x, y)) modules[y][x] = !modules[y][x];
  };
  const drawFormat = (mask: number) => {
    const fdata = (ECL_BITS[ecl] << 3) | mask;
    let rem = fdata;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fbits = ((fdata << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((fbits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };

  let bestMask = 0, bestPenalty = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const p = penalty(modules, size);
    if (p < bestPenalty) { bestPenalty = p; bestMask = m; }
    applyMask(m); // XOR undo
  }
  applyMask(bestMask);
  drawFormat(bestMask);
  return modules;
}

function penalty(m: boolean[][], size: number): number {
  let score = 0;
  // N1: runs of >=5 in rows and columns.
  for (let y = 0; y < size; y++) {
    for (const line of [
      (i: number) => m[y][i], // row y
      (i: number) => m[i][y], // column y
    ]) {
      let run = 1;
      for (let x = 1; x <= size; x++) {
        if (x < size && line(x) === line(x - 1)) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
    }
  }
  // N2: 2x2 blocks.
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++)
      if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  // N3: finder-like 1011101 with 4 light modules on either side.
  const FINDER = [true, false, true, true, true, false, true];
  const hasPattern = (get: (i: number) => boolean, at: number): boolean =>
    FINDER.every((v, i) => get(at + i) === v);
  for (let y = 0; y < size; y++) {
    for (const get of [(i: number) => m[y][i], (i: number) => m[i][y]]) {
      for (let x = 0; x + 6 < size; x++) {
        if (!hasPattern(get, x)) continue;
        const lightBefore = x >= 4 && [1, 2, 3, 4].every((d) => !get(x - d));
        const lightAfter = x + 10 < size && [7, 8, 9, 10].every((d) => !get(x + d));
        if (lightBefore || lightAfter) score += 40;
      }
    }
  }
  // N4: dark-module proportion.
  let dark = 0;
  for (const row of m) for (const cell of row) if (cell) dark++;
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

// --- Rendering ----------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';

// One <path> for all dark modules, on a light background, with a standard
// 4-module quiet zone. `px` is the rendered CSS size.
export function qrToSvg(matrix: boolean[][], px: number, dark = '#1a2636', light = '#ffffff'): SVGElement {
  const n = matrix.length;
  const quiet = 4;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('viewBox', `0 0 ${n + quiet * 2} ${n + quiet * 2}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(n + quiet * 2));
  bg.setAttribute('height', String(n + quiet * 2));
  bg.setAttribute('fill', light);

  let d = '';
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (matrix[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', dark);

  svg.append(bg, path);
  return svg;
}

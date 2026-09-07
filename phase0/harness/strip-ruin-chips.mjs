// Strip the baked-in stone chips from the RUIN autotiles (2026-09-07: the
// debris layer owns every fleck on the floor now — play/js/debris.mjs — so
// the ruin tile keeps only the broken wall's stubs and their faces, and the
// chips a breach scatters come from the stone spray, governed by the same
// dials as every other debris). The repack tool generates chip-free ruins
// from now on (RUIN.chips = 0); this rewrites the COMMITTED files the same
// way without the packs, which are gitignored: every --tile-ruin-<mask> in
// play/tiles.css loses its isolated pixel components (a chip is a 1- or
// 2-pixel fleck a pixel clear of everything else; a stub always touches
// the tile's edge, ring included), and the matching cells of
// play/img/tileset.png are rewritten to agree.
//
// Usage: cd phase0 && node harness/strip-ruin-chips.mjs [--check]
//   --check  exit 1 if any ruin tile still carries an isolated component
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng, encodePng, samePixels } from '../lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = 16;

/** Connected components (4-way) of opaque pixels; those touching no edge. */
export function isolatedComponents(img) {
  const { width: w, height: h, data } = img;
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (seen[i] || !data[i * 4 + 3]) continue;
    const stack = [i], comp = [];
    let edge = false;
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      comp.push(j);
      const jx = j % w, jy = (j - jx) / w;
      if (jx === 0 || jy === 0 || jx === w - 1 || jy === h - 1) edge = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (seen[n] || !data[n * 4 + 3]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (!edge) out.push(comp);
  }
  return out;
}

/** The tile without its isolated flecks (a new image). */
export function stripIsolated(img) {
  const out = { width: img.width, height: img.height, data: Buffer.from(img.data) };
  let n = 0;
  for (const comp of isolatedComponents(img)) {
    if (comp.length > 2) throw new Error(`strip-ruin-chips: an isolated component of ${comp.length} px is not a chip — refusing to touch this tile`);
    for (const i of comp) { out.data.fill(0, i * 4, i * 4 + 4); n++; }
  }
  return { img: out, removed: n };
}

const RE = /(--tile-ruin-(\d+): url\("data:image\/png;base64,)([A-Za-z0-9+/=]+)("\);)/g;

export function run({ check = false } = {}) {
  const cssPath = join(ROOT, 'play', 'tiles.css');
  const atlasPath = join(ROOT, 'play', 'img', 'tileset.png');
  let css = readFileSync(cssPath, 'utf8');
  const swaps = []; // [before, after] tiles for the atlas
  let tiles = 0, removed = 0, dirty = 0;
  css = css.replace(RE, (m, pre, mask, b64, post) => {
    const img = decodePng(Buffer.from(b64, 'base64'));
    const { img: clean, removed: n } = stripIsolated(img);
    tiles++;
    if (!n) return m;
    dirty++;
    removed += n;
    swaps.push([img, clean]);
    return pre + encodePng(clean).toString('base64') + post;
  });
  if (check) {
    console.log(`${tiles} ruin tiles, ${dirty} with isolated chips (${removed} px)`);
    return dirty === 0;
  }
  let atlasCells = 0;
  if (dirty) {
    writeFileSync(cssPath, css);
    const atlas = decodePng(readFileSync(atlasPath));
    for (let y = 0; y + T <= atlas.height; y += T) for (let x = 0; x + T <= atlas.width; x += T) {
      const cell = { width: T, height: T, data: Buffer.alloc(T * T * 4) };
      for (let r = 0; r < T; r++) atlas.data.copy(cell.data, r * T * 4, ((y + r) * atlas.width + x) * 4, ((y + r) * atlas.width + x + T) * 4);
      const swap = swaps.find(([before]) => samePixels(before, cell));
      if (!swap) continue;
      for (let r = 0; r < T; r++) swap[1].data.copy(atlas.data, ((y + r) * atlas.width + x) * 4, r * T * 4, (r + 1) * T * 4);
      atlasCells++;
    }
    writeFileSync(atlasPath, encodePng(atlas));
  }
  console.log(`${tiles} ruin tiles, ${dirty} rewritten (${removed} chip px removed), ${atlasCells} atlas cells rewritten`);
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = run({ check: process.argv.includes('--check') });
  process.exit(ok ? 0 : 1);
}

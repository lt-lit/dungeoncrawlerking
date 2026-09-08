// Strip the baked-in stone chips from the RUIN autotiles (2026-09-07: the
// debris layer owns every fleck on the floor now — play/js/debris.mjs — so
// the ruin tile keeps only the broken wall's stubs and their faces, and the
// chips a breach scatters come from the stone spray, governed by the same
// dials as every other debris). The repack tool generates chip-free ruins
// from now on (RUIN.chips = 0); this rewrites the COMMITTED atlas the same
// way without the packs, which are gitignored: every ruin-<mask> cell of
// every theme in play/img/tileset.png (play/img/tileset.json says where)
// loses its isolated pixel components (a chip is a 1- or 2-pixel fleck a
// pixel clear of everything else; a stub always touches the tile's edge,
// ring included). (Until 2026-09-07 the same tiles lived as data URIs in
// play/tiles.css too; that file retired with the DOM board.)
//
// Usage: cd phase0 && node harness/strip-ruin-chips.mjs [--check]
//   --check  exit 1 if any ruin tile still carries an isolated component
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng, encodePng } from '../lib/png.mjs';

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

export function run({ check = false } = {}) {
  const atlasPath = join(ROOT, 'play', 'img', 'tileset.png');
  const index = JSON.parse(readFileSync(join(ROOT, 'play', 'img', 'tileset.json'), 'utf8'));
  const atlas = decodePng(readFileSync(atlasPath));
  const rowH = index.row ?? 2 * T;
  let tiles = 0, removed = 0, dirty = 0;
  for (const [theme, t] of Object.entries(index.themes)) {
    if (t.inhouse) continue;
    for (const [role, cell] of Object.entries(t.tiles)) {
      if (!/^ruin-\d+$/.test(role)) continue;
      const x0 = cell.col * T, y0 = t.row * rowH;
      const img = { width: T, height: T, data: Buffer.alloc(T * T * 4) };
      for (let r = 0; r < T; r++) atlas.data.copy(img.data, r * T * 4, ((y0 + r) * atlas.width + x0) * 4, ((y0 + r) * atlas.width + x0 + T) * 4);
      const { img: clean, removed: n } = stripIsolated(img);
      tiles++;
      if (!n) continue;
      dirty++;
      removed += n;
      if (!check) for (let r = 0; r < T; r++) clean.data.copy(atlas.data, ((y0 + r) * atlas.width + x0) * 4, r * T * 4, (r + 1) * T * 4);
      void theme;
    }
  }
  if (check) {
    console.log(`${tiles} ruin tiles, ${dirty} with isolated chips (${removed} px)`);
    return dirty === 0;
  }
  if (dirty) writeFileSync(atlasPath, encodePng(atlas));
  console.log(`${tiles} ruin tiles, ${dirty} rewritten (${removed} chip px removed)`);
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = run({ check: process.argv.includes('--check') });
  process.exit(ok ? 0 : 1);
}

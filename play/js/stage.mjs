// Stage schema v2 (slice refresh): terrain only, drawn as ASCII.
//
// A stage is GROUND — walls and dimensions, nothing else. Armies are not
// part of a stage (they come from armygen.mjs and mold to the terrain at
// duel time), and stages are stand-ins for dungeon-generated terrain, so
// they are authored as reviewable text, not through an editor:
//
//   { "schema": 2, "id": "s03-the-squeeze", "title": "The Squeeze",
//     "notes": "why this terrain exists / what it tests",
//     "map": ["#....",     <- top rank first (visual order, like FEN)
//             ".....", ...] }
//
// '.' floor · '#' wall ('*' accepted — it is the FEN wall glyph).
// Rectangular, 3–12 files × 5–10 ranks (the engine's largeboard caps are
// 12×10; the catalog registers duel_<files>x<ranks> for 3–12 × 5–10).
import { catalogVariantName } from './variant.mjs';

export function loadStageV2(json) {
  if (json.schema !== 2) throw new Error(`stage ${json.id ?? '?'}: schema ${json.schema} (want 2)`);
  if (!json.id || !Array.isArray(json.map) || !json.map.length) {
    throw new Error(`stage ${json.id ?? '?'}: missing id or map`);
  }
  const ranks = json.map.length;
  const files = json.map[0].length;
  if (files < 3 || files > 12 || ranks < 5 || ranks > 10) {
    throw new Error(`stage ${json.id}: ${files}x${ranks} outside 3-12 x 5-10`);
  }
  // grid[rankFromBottom][file] — '*' wall, null floor (the fenGrid convention
  // shared with director.mjs / armygen.mjs).
  const grid = Array.from({ length: ranks }, () => Array(files).fill(null));
  const walls = [];
  json.map.forEach((row, i) => {
    if (row.length !== files) throw new Error(`stage ${json.id}: ragged map row ${i}`);
    const r = ranks - 1 - i;
    for (let f = 0; f < files; f++) {
      const ch = row[f];
      if (ch === '#' || ch === '*') {
        grid[r][f] = '*';
        walls.push(`${String.fromCharCode(97 + f)}${r + 1}`);
      } else if (ch !== '.') {
        throw new Error(`stage ${json.id}: bad map char "${ch}" at row ${i} file ${f}`);
      }
    }
  });
  return {
    id: json.id,
    title: json.title ?? json.id,
    notes: json.notes ?? '',
    files,
    ranks,
    grid,
    walls,
    variantName: catalogVariantName(files, ranks),
  };
}

/**
 * Vertical mirror of a stage — the terrain that faced white now faces
 * black. TESTING CONVENTION (designer rule): a mirrored stage is NOT a
 * separate scenario; every balance corpus runs each stage in BOTH
 * orientations, and the pre-game test setup exposes a flip toggle.
 */
export function flipStageVertical(stage) {
  const { files, ranks } = stage;
  const grid = Array.from({ length: ranks }, (_, r) => [...stage.grid[ranks - 1 - r]]);
  const walls = [];
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      if (grid[r][f] === '*') walls.push(`${String.fromCharCode(97 + f)}${r + 1}`);
    }
  }
  return { ...stage, id: `${stage.id}~flipped`, grid, walls };
}

// Stage schema v2 (slice refresh): terrain only, drawn as ASCII.
//
// A stage is GROUND — terrain and dimensions, nothing else. Armies are not
// part of a stage (they come from armygen.mjs and mold to the terrain at
// duel time), and stages are stand-ins for dungeon-generated terrain, so
// they are authored as reviewable text, not through an editor:
//
//   { "schema": 2, "id": "s03-the-squeeze", "title": "The Squeeze",
//     "notes": "why this terrain exists / what it tests",
//     "map": ["#....",     <- top rank first (visual order, like FEN)
//             ".^...", ...] }
//
// '.' floor · '#' stone wall ('*' accepted — it is the FEN wall glyph) ·
// '^' furniture (§4.6: the neutral capturable occupant — a wall to molding
// and crop, an ordinary capture in play; `^`→`.` derives the stone-only
// corpus control arm from the same file). Rectangular, 3–12 files × 5–10
// ranks (the engine's largeboard caps; the catalog registers
// duel_<files>x<ranks> for 3–12 × 5–10).
//
// SKINS (2026-09-02, optional): a parallel "skin" grid, same shape as the
// map, says what each '^' LOOKS like — 'D' door · 'B' barrel · 'T' table ·
// 'C' chair · 'S' shelf · 'X' chest · 'K' crate · 'R' rubble (weak masonry) ·
// '.' default (crate).
// Pure cosmetics: every skin is the same '^' to the engine, molding, crop,
// the camp line and the gods (README: "skins are a cosmetic layer, never
// grid state"). A skin letter on anything but a '^' is a data bug. The
// grid rides every transform (flip, crop, the auto-crop) beside the map,
// and `stageSkins()` turns it into the square→skin map the renderer takes.
// Authored by phase0/harness/gen-skins.mjs (rule-based, reviewed), kept in
// the stage file so the diff stays the review surface.
//
// The old "no fully-walled extreme rank" load/crop guards are RETIRED
// (designer ground rules 2026-08-27): kings anchor the arena — dealMatchup
// AUTO-CROPS every row behind either king, so the promotion row is the
// enemy king's starting row by construction and stage-level policing was
// the wrong layer. A stage whose fully-terrain edge rows leave fewer than
// 5 playable ranks can never deal; the verifier flags that as a data bug.
import { catalogVariantName } from './variant.mjs';
import { WALL, FURNITURE } from './fen.mjs';

/** Skin letter → skin name (the renderer's `skin-<name>` cell class). */
export const SKIN_CHARS = { D: 'door', B: 'barrel', T: 'table', C: 'chair', S: 'shelf', X: 'chest', K: 'crate', R: 'rubble' };
export const SKIN_NAMES = Object.values(SKIN_CHARS);
/** Art themes (2026-09-03): which repacked tileset a stage's board wears —
 *  `hall` (pixel-poem), `castle` (Dungeon Gathering), `crypt` (Catacombs);
 *  play/tiles.css, phase0/harness/repack-tiles.mjs. Optional `theme` key on
 *  a stage; cosmetics only (a theme changes what the renderer paints, never
 *  the grid). Assigned over the bed by gen-skins.mjs; the Options panel and
 *  `?theme=` override it per device. */
export const THEMES = ['hall', 'castle', 'crypt'];

/** Square-name lists of each terrain kind in a grid. */
function terrainLists(grid, files, ranks) {
  const walls = [];
  const furniture = [];
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      if (grid[r][f] === WALL) walls.push(`${String.fromCharCode(97 + f)}${r + 1}`);
      else if (grid[r][f] === FURNITURE) furniture.push(`${String.fromCharCode(97 + f)}${r + 1}`);
    }
  }
  return { walls, furniture };
}

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
  // grid[rankFromBottom][file] — '*' wall, '^' furniture, null floor (the
  // fenGrid convention shared with director.mjs / armygen.mjs).
  const grid = Array.from({ length: ranks }, () => Array(files).fill(null));
  json.map.forEach((row, i) => {
    if (row.length !== files) throw new Error(`stage ${json.id}: ragged map row ${i}`);
    const r = ranks - 1 - i;
    for (let f = 0; f < files; f++) {
      const ch = row[f];
      if (ch === '#' || ch === WALL) {
        grid[r][f] = WALL;
      } else if (ch === FURNITURE) {
        grid[r][f] = FURNITURE;
      } else if (ch !== '.') {
        throw new Error(`stage ${json.id}: bad map char "${ch}" at row ${i} file ${f}`);
      }
    }
  });
  // skin[rankFromBottom][file] — a skin name on furniture squares, else null.
  const skin = Array.from({ length: ranks }, () => Array(files).fill(null));
  if (json.skin !== undefined) {
    if (!Array.isArray(json.skin) || json.skin.length !== ranks) throw new Error(`stage ${json.id}: skin grid must have ${ranks} rows`);
    json.skin.forEach((row, i) => {
      if (row.length !== files) throw new Error(`stage ${json.id}: ragged skin row ${i}`);
      const r = ranks - 1 - i;
      for (let f = 0; f < files; f++) {
        const ch = row[f];
        if (ch === '.') continue;
        const name = SKIN_CHARS[ch];
        if (!name) throw new Error(`stage ${json.id}: bad skin char "${ch}" at row ${i} file ${f}`);
        if (grid[r][f] !== FURNITURE) throw new Error(`stage ${json.id}: skin "${ch}" on a non-furniture square (row ${i} file ${f})`);
        skin[r][f] = name;
      }
    });
  }
  if (json.theme !== undefined && !THEMES.includes(json.theme)) throw new Error(`stage ${json.id}: unknown theme "${json.theme}" (want one of ${THEMES.join('/')})`);
  return {
    id: json.id,
    title: json.title ?? json.id,
    notes: json.notes ?? '',
    theme: json.theme ?? null,
    files,
    ranks,
    grid,
    skin,
    ...terrainLists(grid, files, ranks),
    variantName: catalogVariantName(files, ranks),
  };
}

/** {square: skinName} for every skinned furniture square — what BoardUI
 *  setPosition takes. Squares without a skin fall back to the crate. */
export function stageSkins(stage) {
  const out = {};
  if (!stage?.skin) return out;
  for (let r = 0; r < stage.ranks; r++) {
    for (let f = 0; f < stage.files; f++) {
      const name = stage.skin[r]?.[f];
      if (name && stage.grid[r][f] === FURNITURE) out[`${String.fromCharCode(97 + f)}${r + 1}`] = name;
    }
  }
  return out;
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
  const skin = stage.skin ? Array.from({ length: ranks }, (_, r) => [...stage.skin[ranks - 1 - r]]) : undefined;
  return { ...stage, id: `${stage.id}~flipped`, grid, skin, ...terrainLists(grid, files, ranks) };
}

/**
 * Crop a stage by redrawing its boundaries: drop `top` ranks off the far
 * edge and `bottom` ranks off the near edge. Designer rule (2026-08): to
 * every piece a boundary is a boundary — a rank of solid wall and the
 * board simply ending are identical — so cropping REMOVES the ranks
 * instead of walling them (terrain in a removed rank, furniture included,
 * goes with it), and the cropped board rides the smaller catalog variant.
 * This is both how the setup screen tests smaller gaps AND the mechanism
 * of the king-anchored AUTO-CROP (ground rules 2026-08-27 — dealMatchup
 * crops every row behind either king after molding).
 *
 * Throws on a crop that leaves fewer than 5 ranks (the catalog floor —
 * gap 1; a duel can't start any closer). The old fully-walled-extreme-rank
 * guard is retired: the auto-crop makes the promotion-row guarantee true
 * by construction, so a crop no longer needs to police it.
 */
export function cropStage(stage, top = 0, bottom = 0) {
  if (!top && !bottom) return stage;
  const { files } = stage;
  const ranks = stage.ranks - top - bottom;
  if (top < 0 || bottom < 0 || ranks < 5) {
    throw new Error(`crop ${top}t/${bottom}b leaves ${ranks} ranks (min 5)`);
  }
  const grid = Array.from({ length: ranks }, (_, r) => [...stage.grid[r + bottom]]);
  const skin = stage.skin ? Array.from({ length: ranks }, (_, r) => [...stage.skin[r + bottom]]) : undefined;
  return {
    ...stage,
    id: `${stage.id}~crop${top}t${bottom}b`,
    ranks,
    grid,
    skin,
    ...terrainLists(grid, files, ranks),
    variantName: catalogVariantName(files, ranks),
  };
}

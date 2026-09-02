#!/usr/bin/env node
// Author the "skin" grid of every stage — what each '^' LOOKS like (door,
// barrel, table, chair, shelf, chest, crate, rubble; stage.mjs SKIN_CHARS).
// Skins are cosmetic: the same '^' to the engine, molding, crop, the camp
// line and the gods. The assignment is RULE-BASED, not random, and reviewed:
//
//   1. DOOR — a '^' embedded in a wall line: both neighbours along an axis
//      are wall-ish ('#'/'^', or the board edge on one side) and that run
//      holds real stone; or the row/column is a wall line (≥60% wall-ish,
//      ≥2 stone) and the '^' touches stone along it.
//   2. Otherwise the stage's NOTES pick the furniture family (barrel row →
//      barrels, pantry/archive/wardrobe → shelves, banquet → table, hoard/
//      contraband → chests, closet/parlor → chairs; default crate), with
//      2×2 blocks always read as stacked crates.
//   3. OVERRIDES below settle what geometry + keywords get wrong (a crate
//      that caps a stone stub is not a gate; a barricade is not a row of
//      doors; weak masonry is rubble, not a door) — one line per square, so
//      the review is the diff.
//
// Usage (from phase0/):
//   node harness/gen-skins.mjs            # report: every stage's map with skins
//   node harness/gen-skins.mjs --write    # write "skin" into play/stages/*.json
// Then: node harness/gen-stage-manifest.mjs && node harness/verify-stages.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadStageV2 } from '../../play/js/stage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGE_DIR = join(ROOT, 'play', 'stages');
const WRITE = process.argv.includes('--write');
const ONLY = (() => {
  const i = process.argv.indexOf('--stage');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// Notes keyword → skin letter, first match wins (order matters).
const FAMILY = [
  [/barrel/i, 'B'],
  [/shelv|shelf|pantry|archive|stacks|wardrobe|cabinet/i, 'S'],
  [/banquet|table/i, 'T'],
  [/chest|hoard|contraband|loot|rarest|holdings/i, 'X'],
  [/chair|closet|parlor/i, 'C'],
];

// Square-level overrides (a-file, rank from the bottom — the log's names).
const OVERRIDES = {
  's02-cluttered-closet': { b4: 'T', a3: 'C' }, // a table and a chair in a closet
  's03-the-pantry': { c4: 'S', b3: 'S', c2: 'S' },
  's05-the-squeeze': { c5: 'K' }, // the crate that narrows the pass — not a gate
  's10-broken-barricade': { b6: 'K', c6: 'K', e6: 'K', f6: 'K', g6: 'K' }, // a barricade, not doors
  's12-rat-nest': { e7: 'B', h6: 'K', i6: 'K', d5: 'X', b4: 'B', f3: 'K', f2: 'B' },
  's13-gatehouse': { c8: 'D', d1: 'D' }, // gate leaves beside the stubs
  's16-cave-mouth': { d1: 'R' }, // the weak-masonry plug
  's19-diagonal-scar': { f7: 'R', d5: 'R', b3: 'R' }, // the scar's smashable segments
  's22-sinkhole': { b4: 'K', e4: 'K' }, // heaps on the flanks
  's27-posterngate': { e8: 'D', b1: 'D' },
  's31-ruined-l': { f7: 'R', f6: 'R' }, // weak masonry on the ruin's edge
  's36-crate-hoard': { c8: 'X', c7: 'X', c6: 'R', d6: 'R' }, // the hoard (a column the door rule misreads), and the breakable floor-edge
  's42-guardroom': { d3: 'D', e3: 'K' }, // the weak door and the crate shoved behind it
  's43-the-breach': { d7: 'R', d6: 'R', e6: 'R', e5: 'R' }, // rubble-choked breach column
  's45-collapsed-arch': { c5: 'R', d5: 'R', e5: 'R' }, // the fallen arch
  's46-cellar-steps': { b3: 'R', a2: 'K' }, // weak ceiling slab; the crate on the stairs
  's47-the-warrens': { e6: 'R' }, // the breakable stub on the divider
  's48-barricaded-bridge': { c4: 'K' }, // a two-crate barricade, not a gate leaf
  's50-last-stand': { d8: 'K' }, // the crate shoring the double door from inside
  's52-the-apartments': { c8: 'K', d8: 'K', c7: 'K', f9: 'X', h7: 'S', i7: 'S', i4: 'X', b3: 'C', c3: 'T' }, // corner stack, lone chest, wardrobe pair; a study downstairs
  's53-the-cellblock': { b8: 'X', i5: 'X', b2: 'X' }, // contraband in the cells; the cell doors the rule already finds
  's54-banquet-and-kitchens': { b9: 'B', e9: 'S', i9: 'B', d5: 'T', e5: 'T', f5: 'T', g5: 'T' },
  's55-gate-and-bailey': { e9: 'X', b6: 'K', b5: 'K' },
  's57-crossroads-market': { b8: 'X', i8: 'B', j8: 'B', a2: 'K', b2: 'K', b1: 'K' }, // one chest, a pair, a spill of three; stall doors by rule
  's58-drowned-halls': { g6: 'D', b6: 'B', i6: 'B', i5: 'B' }, // the g-divider's party door (one stone neighbour only); flotsam elsewhere
};

const wallish = (ch) => ch === '#' || ch === '^';

/** Rule 1 — is the '^' at map[i][f] embedded in a wall line? */
function isDoor(map, i, f) {
  const ranks = map.length;
  const files = map[0].length;
  const at = (ii, ff) => (ii < 0 || ii >= ranks || ff < 0 || ff >= files ? null : map[ii][ff]);
  const embedded = (a, b, run) => (a === null || wallish(a)) && (b === null || wallish(b)) && !(a === null && b === null) && run.includes('#');
  let l = f;
  while (l - 1 >= 0 && wallish(map[i][l - 1])) l--;
  let r = f;
  while (r + 1 < files && wallish(map[i][r + 1])) r++;
  const hRun = map[i].slice(l, r + 1);
  let u = i;
  while (u - 1 >= 0 && wallish(map[u - 1][f])) u--;
  let d = i;
  while (d + 1 < ranks && wallish(map[d + 1][f])) d++;
  const vRun = map.slice(u, d + 1).map((row) => row[f]).join('');
  if (embedded(at(i, f - 1), at(i, f + 1), hRun)) return true;
  if (embedded(at(i - 1, f), at(i + 1, f), vRun)) return true;
  const row = map[i];
  const rowWall = row.split('').filter(wallish).length / files;
  const rowStone = (row.match(/#/g) ?? []).length;
  if (rowWall >= 0.6 && rowStone >= 2 && (at(i, f - 1) === '#' || at(i, f + 1) === '#')) return true;
  const col = map.map((rw) => rw[f]).join('');
  const colWall = col.split('').filter(wallish).length / ranks;
  const colStone = (col.match(/#/g) ?? []).length;
  if (colWall >= 0.6 && colStone >= 2 && (at(i - 1, f) === '#' || at(i + 1, f) === '#')) return true;
  return false;
}

/** Rule 2 — a 2×2 block of '^' reads as stacked crates whatever the notes say. */
function inBlock(map, i, f) {
  const at = (ii, ff) => map[ii]?.[ff] === '^';
  for (const [di, df] of [[0, 0], [0, -1], [-1, 0], [-1, -1]]) {
    const i0 = i + di;
    const f0 = f + df;
    if (at(i0, f0) && at(i0 + 1, f0) && at(i0, f0 + 1) && at(i0 + 1, f0 + 1)) return true;
  }
  return false;
}

function skinGrid(json) {
  const map = json.map;
  const ranks = map.length;
  const files = map[0].length;
  const family = FAMILY.find(([re]) => re.test(json.notes ?? ''))?.[1] ?? 'K';
  const overrides = OVERRIDES[json.id] ?? {};
  const rows = [];
  const reasons = [];
  for (let i = 0; i < ranks; i++) {
    let row = '';
    for (let f = 0; f < files; f++) {
      if (map[i][f] !== '^') {
        row += '.';
        continue;
      }
      const sq = `${String.fromCharCode(97 + f)}${ranks - i}`;
      let letter;
      let why;
      if (overrides[sq]) {
        letter = overrides[sq];
        why = 'override';
      } else if (isDoor(map, i, f)) {
        letter = 'D';
        why = 'wall line';
      } else if (inBlock(map, i, f)) {
        letter = 'K';
        why = '2×2 block';
      } else {
        letter = family;
        why = family === 'K' ? 'default' : 'notes';
      }
      row += letter;
      reasons.push(`${sq}=${letter}(${why})`);
    }
    rows.push(row);
  }
  for (const sq of Object.keys(overrides)) {
    if (!reasons.some((r) => r.startsWith(`${sq}=`))) throw new Error(`${json.id}: override on ${sq}, which is not a '^'`);
  }
  return { rows, reasons };
}

let written = 0;
const tally = {};
for (const file of readdirSync(STAGE_DIR).sort()) {
  if (!file.endsWith('.json') || file === 'manifest.json') continue;
  const path = join(STAGE_DIR, file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  if (ONLY && json.id !== ONLY) continue;
  const { rows, reasons } = skinGrid(json);
  for (const ch of rows.join('')) if (ch !== '.') tally[ch] = (tally[ch] ?? 0) + 1;
  // Validate through the loader exactly as the game will see it.
  loadStageV2({ ...json, skin: rows });
  if (WRITE) {
    const out = {};
    for (const k of Object.keys(json)) {
      if (k === 'skin') continue;
      out[k] = json[k];
      if (k === 'map') out.skin = rows;
    }
    if (!('skin' in out)) out.skin = rows;
    writeFileSync(path, JSON.stringify(out, null, 1) + '\n');
    written++;
  } else {
    console.log(`\n== ${json.id} — ${json.notes}`);
    for (let i = 0; i < rows.length; i++) console.log(`   ${json.map[i]}   ${rows[i]}`);
    console.log(`   ${reasons.join(' · ')}`);
  }
}
console.log(`\nskins: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' ')}${WRITE ? ` — wrote ${written} stage files (now regenerate the manifest)` : ''}`);

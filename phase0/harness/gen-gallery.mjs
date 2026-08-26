// Stage-verification gallery generator (slice refresh).
//
// Reads play/stages/*.json (schema v2), deals seeded sample armies onto
// each stage with armygen.dealMatchup — the SAME single entry point the
// setup screen and the verifier use, king-anchored auto-crop included —
// and writes a SELF-CONTAINED review page to play/stages-gallery.html: the
// designer's accept/tweak/kill loop. No editor: stages are ASCII in JSON,
// this page is how they are judged.
//
// Per stage: the bare terrain (stone ■ sunken-dark, furniture ▦ on a wood
// tint — §4.6), three dealt samples (small native / big squeeze with
// offset anchors / scrambled budget-draw), the largest mirror army width
// that fits, the ⚠ furniture-sealed flag (legal — a chamber you must
// smash into), and every annotation the designer needs to call a tweak by
// coordinates (files lettered, ranks numbered). Samples show the board
// the duel actually gets: auto-cropped behind the kings when terrain
// pushed a royal off its extreme row.
//
// Usage: cd phase0 && node harness/gen-gallery.mjs
//        (needs the patched vendored pair overlaid — the guard says how)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish, assertFurnitureSupport } from '../lib/load.mjs';
import { loadStageV2 } from '../../play/js/stage.mjs';
import { dealMatchup, armiesConnected } from '../../play/js/armygen.mjs';
import { makeCatalogIni } from '../../play/js/variant.mjs';
import { WALL, FURNITURE } from '../../play/js/fen.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGE_DIR = path.resolve(HERE, '../../play/stages');
const OUT = path.resolve(HERE, '../../play/stages-gallery.html');

const ffish = await loadFfish();
ffish.loadVariantConfig(makeCatalogIni());
assertFurnitureSupport(ffish);

const stages = fs
  .readdirSync(STAGE_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'manifest.json') // manifest.json is the browser bundle, not a stage
  .sort()
  .map((f) => {
    const raw = JSON.parse(fs.readFileSync(path.join(STAGE_DIR, f), 'utf8'));
    const s = loadStageV2(raw);
    s.wave = raw.wave ?? 1;
    return s;
  });

const W_GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };
const B_GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };

/** One board table. `deal` (dealMatchup output) overlays its layouts onto
 *  ITS stage — pass deal.stage as `stage` so auto-crop shows truthfully. */
function boardHtml(stage, deal = null) {
  const { files, ranks, grid } = stage;
  const at = {};
  if (deal) {
    for (const c of deal.white.layout.cells) at[`${c.r},${c.f}`] = `<span class="wp">${W_GLYPH[c.piece]}</span>`;
    for (const c of deal.black.layout.cells) at[`${c.r},${c.f}`] = `<span class="bp">${B_GLYPH[c.piece]}</span>`;
  }
  let h = '<table class="board">';
  for (let r = ranks - 1; r >= 0; r--) {
    h += `<tr><td class="lab">${r + 1}</td>`;
    for (let f = 0; f < files; f++) {
      const cell = grid[r][f];
      const shade = (r + f) % 2 ? 'lt' : 'dk';
      if (cell === WALL) h += '<td class="sq wall"></td>';
      else if (cell === FURNITURE) h += '<td class="sq furn"><span class="fn">▦</span></td>';
      else h += `<td class="sq ${shade}">${at[`${r},${f}`] ?? ''}</td>`;
    }
    h += '</tr>';
  }
  h += `<tr><td class="lab"></td>${Array.from({ length: files }, (_, f) => `<td class="lab">${String.fromCharCode(97 + f)}</td>`).join('')}</tr>`;
  return h + '</table>';
}

const describeArmy = (a) => `${a.royal}+${a.back.join('')}+${a.width}P (${a.value}pt)`;

/** Try seeds until a sample deals cleanly through dealMatchup. */
function trySample(stage, mkSpecs) {
  let last = null;
  for (let seed = 1; seed <= 8; seed++) {
    const specs = mkSpecs(seed);
    if (!specs) return { fail: 'no feasible spec' };
    const d = dealMatchup({ stage, seed, gapMin: 1, ...specs, ffish });
    if (!d.ok) {
      last = d.error;
      continue;
    }
    return { d, seed };
  }
  return { fail: last ?? 'no seed worked' };
}

/** Largest W where a WxW mirror deals (gap >= 1; grid checks only). */
function maxMirrorWidth(stage) {
  for (let w = 8; w >= 3; w--) {
    const spec = { spec: { width: w, budget: w + 5 * (w - 1) } };
    const d = dealMatchup({ stage, white: spec, black: spec, seed: 3, gapMin: 1 });
    if (d.ok) return w;
  }
  return null;
}

function sampleCard(label, note, s) {
  if (s.fail) {
    return `<figure><figcaption><b>${label}</b> — ${note}<br><i class="miss">not shown: ${s.fail}</i></figcaption></figure>`;
  }
  const d = s.d;
  const bits = [`W ${describeArmy(d.white.army)} vs B ${describeArmy(d.black.army)}`, `gap ${d.gap}`, `seed ${s.seed}`];
  if (d.autoCrop.top || d.autoCrop.bottom) bits.push(`auto-cropped to ${d.files}×${d.ranks} (kings anchor the arena)`);
  const flags = [];
  if (d.violations.length) flags.push(`<span class="viol">soft: ${d.violations.join(', ')}</span>`);
  if (d.stage.furniture.length && !armiesConnected(d.stage, d, { furnitureBlocks: true })) {
    flags.push('<span class="sealed">⚠ furniture seals the armies apart — legal, you smash in (§4.6)</span>');
  }
  return `<figure>${boardHtml(d.stage, d)}<figcaption><b>${label}</b> — ${note}<br>` +
    `${bits.join(' · ')}${flags.length ? '<br>' + flags.join('<br>') : ''}</figcaption></figure>`;
}

// Waves render newest-first; unknown waves must never vanish silently
// (wave 3 did exactly that when this was a fixed two-key object).
const cardsByWave = {};
let issues = 0;
for (const stage of stages) {
  cardsByWave[stage.wave] ??= '';
  const wide = stage.files >= 6;
  const small = trySample(stage, () => ({
    white: { spec: { width: 3, budget: 12 } },
    black: { spec: { width: 3, budget: 8 } },
  }));
  const big = trySample(stage, () => {
    const anchorPairs = wide
      ? [['left', 'right'], ['right', 'left'], ['center', 'center']]
      : [['center', 'center']];
    for (let w = 8; w >= 3; w--) {
      const bw = Math.max(3, w - 2);
      for (const [aw, ab] of anchorPairs) {
        const specs = {
          white: { spec: { width: w, budget: w + 5 * (w - 1) }, anchor: aw },
          black: { spec: { width: bw, budget: bw + 4 * (bw - 1) }, anchor: ab },
        };
        if (dealMatchup({ stage, seed: 1, gapMin: 1, ...specs }).ok) return specs;
      }
    }
    return null;
  });
  const scrambled = trySample(stage, () => {
    for (let w = 6; w >= 3; w--) {
      const bw = Math.max(3, w - 1);
      const specs = {
        white: { spec: { width: w, budget: 20 }, anchor: wide ? 'right' : 'center', archetype: 'scrambled' },
        black: { spec: { width: bw, budget: 13 }, anchor: wide ? 'left' : 'center', archetype: 'scrambled' },
      };
      if (dealMatchup({ stage, seed: 1, gapMin: 1, ...specs }).ok) return specs;
    }
    return null;
  });
  if (small.fail || big.fail || scrambled.fail) issues++;
  const mirror = maxMirrorWidth(stage);
  cardsByWave[stage.wave] += `<section class="card" id="${stage.id}">
<h2>${stage.title} <code>${stage.id}</code></h2>
<p class="meta">${stage.files}×${stage.ranks} · ${stage.walls.length} walls · ${stage.furniture.length} furniture · largest mirror army that fits: ${mirror ? `${mirror}×2` : 'none'}</p>
<p class="notes">${stage.notes}</p>
<div class="row">
<figure>${boardHtml(stage)}<figcaption><b>Terrain</b> — as authored (samples may auto-crop)</figcaption></figure>
${sampleCard('A · small', '3×2 armies, centered', small)}
${sampleCard('B · big squeeze', 'largest army that fits, offset anchors', big)}
${sampleCard('C · scrambled', 'budget-drawn, scrambled ranks', scrambled)}
</div>
</section>`;
  console.log(
    `${stage.id}: mirror<=${mirror ?? '-'}` +
      (small.fail ? ` · A FAIL(${small.fail})` : '') +
      (big.fail ? ` · B FAIL(${big.fail})` : '') +
      (scrambled.fail ? ` · C FAIL(${scrambled.fail})` : '')
  );
}

const html = `<!-- GENERATED by phase0/harness/gen-gallery.mjs — edit stages in play/stages/, not here. -->
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Proving Grounds</title>
<style>
  body { font: 14px/1.45 system-ui, sans-serif; margin: 24px; background: #f7f5f0; color: #222; }
  h1 { margin: 0 0 4px; } .sub { color: #666; margin: 0 0 20px; max-width: 72ch; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 14px 18px; margin: 0 0 18px; }
  .card h2 { margin: 0; font-size: 18px; } .card h2 code { font-size: 12px; color: #888; font-weight: normal; }
  .meta { color: #666; margin: 2px 0 0; } .notes { max-width: 78ch; margin: 6px 0 10px; }
  .row { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
  figure { margin: 0; } figcaption { font-size: 12px; color: #444; margin-top: 5px; max-width: 240px; }
  .board { border-collapse: collapse; }
  .sq { width: 26px; height: 26px; text-align: center; vertical-align: middle; font-size: 19px; padding: 0; }
  .lt { background: #ece2cf; } .dk { background: #cbb894; } .wall { background: #3a352c; }
  .furn { background: #d9c7a8; box-shadow: inset 0 0 0 1px #a08a5c; } .fn { color: #7a5a2f; font-size: 17px; }
  .lab { font-size: 10px; color: #999; text-align: center; padding: 0 3px; }
  .wp { color: #fff; text-shadow: 0 0 2px #000, 0 1px 1px #000; } .bp { color: #111; }
  .viol { color: #b06000; } .sealed { color: #8a2be2; } .miss { color: #a33; }
</style>
<h1>Proving Grounds — stage review</h1>
<p class="sub">${stages.length} proposed stages, 3×5 → 10×10. Terrain only — armies are generator
output dealt onto each stage (royal rearmost row, pawns in front; the deal
AUTO-CROPS rows behind either king, so kings always start on the extreme
rows — sample captions say when that fired). Dark squares are stone (a
boundary); ▦ on the wood tint is FURNITURE (§4.6) — a neutral capturable
occupant either side may smash by capturing onto it. Deleting every ▦
must still leave a sensible arena (the stone-only corpus control arm).
For each stage: <b>keep / tweak / kill</b> — call tweaks by coordinates
(one char per square in the JSON: '.' floor, '#' stone, '^' furniture).
Samples are seeded and reproducible; "not shown" means the generator
rejected every attempt (that is data too). Balance testing runs every
stage in BOTH vertical orientations (designer rule — mirrors are not
separate scenarios), so judge terrain on its own merits, not by which
side it faces.</p>
${Object.keys(cardsByWave)
  .map(Number)
  .sort((a, b) => b - a)
  .map((w) => {
    const label = {
      4: 'Wave 4 — PROPOSED (the furniture bed: every stage authored with §4.6 capturable walls in mind — replacement for the retired waves 1–3)',
      3: 'Wave 3 — locked (the coverage-gap set: necks, lattices, two-front, wide-shallow, cornered royals, deep pawns, fortress pocket, serpentine, L-board, 3-wide terrain, minimum square)',
      2: 'Wave 2 — locked (broken deployment ground)',
      1: 'Wave 1 — locked (clean ground)',
    }[w] ?? `Wave ${w} — proposed`;
    return `<h1 class="wavehead">${label}</h1>\n${cardsByWave[w]}`;
  })
  .join('\n')}`;

fs.writeFileSync(OUT, html);
console.log(`\n${stages.length} stages, ${issues} with sample issues → ${OUT}`);

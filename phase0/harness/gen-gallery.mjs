// Stage-verification gallery generator (slice refresh).
//
// Reads play/stages/*.json (schema v2), molds seeded sample armies onto
// each stage with armygen, lints every composed matchup with ffish, and
// writes a SELF-CONTAINED review page to play/stages-gallery.html — the
// designer's accept/tweak/kill loop. No editor: stages are ASCII in JSON,
// this page is how they are judged.
//
// Per stage: the bare terrain, three molded samples (small native / big
// squeeze with offset anchors / scrambled budget-draw), the largest mirror
// army width that fits, and every annotation the designer needs to call a
// tweak by coordinates (files lettered, ranks numbered).
//
// Usage: cd phase0 && node harness/gen-gallery.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish } from '../lib/load.mjs';
import { loadStageV2 } from '../../play/js/stage.mjs';
import { buildMatchup, lintMatchupFen, armiesConnected } from '../../play/js/armygen.mjs';
import { makeCatalogIni } from '../../play/js/variant.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGE_DIR = path.resolve(HERE, '../../play/stages');
const OUT = path.resolve(HERE, '../../play/stages-gallery.html');

const ffish = await loadFfish();
ffish.loadVariantConfig(makeCatalogIni());

const stages = fs
  .readdirSync(STAGE_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => loadStageV2(JSON.parse(fs.readFileSync(path.join(STAGE_DIR, f), 'utf8'))));

const W_GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };
const B_GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };

function boardHtml(stage, matchup = null) {
  const { files, ranks, grid } = stage;
  const at = {};
  if (matchup) {
    for (const c of matchup.white.layout.cells) at[`${c.r},${c.f}`] = `<span class="wp">${W_GLYPH[c.piece]}</span>`;
    for (const c of matchup.black.layout.cells) at[`${c.r},${c.f}`] = `<span class="bp">${B_GLYPH[c.piece]}</span>`;
  }
  let h = '<table class="board">';
  for (let r = ranks - 1; r >= 0; r--) {
    h += `<tr><td class="lab">${r + 1}</td>`;
    for (let f = 0; f < files; f++) {
      const wall = grid[r][f] === '*';
      const shade = (r + f) % 2 ? 'lt' : 'dk';
      h += `<td class="sq ${wall ? 'wall' : shade}">${at[`${r},${f}`] ?? ''}</td>`;
    }
    h += '</tr>';
  }
  h += `<tr><td class="lab"></td>${Array.from({ length: files }, (_, f) => `<td class="lab">${String.fromCharCode(97 + f)}</td>`).join('')}</tr>`;
  return h + '</table>';
}

const describeArmy = (a) => `${a.royal}+${a.back.join('')}+${a.width}P (${a.value}pt)`;

/** Try seeds until a sample builds, lints clean, and connects. */
function trySample(stage, mkSpecs) {
  let last = null;
  for (let seed = 1; seed <= 8; seed++) {
    const specs = mkSpecs(seed);
    if (!specs) return { fail: 'no feasible spec' };
    const m = buildMatchup({ stage, seed, gapMin: 1, ...specs });
    if (m.error) {
      last = m.error;
      continue;
    }
    const lint = lintMatchupFen(ffish, stage.variantName, m.fen);
    if (!lint.ok) {
      last = `lint: ${lint.reasons.join(',')}`;
      continue;
    }
    if (!armiesConnected(stage, m)) {
      last = 'armies disconnected';
      continue;
    }
    return { m, seed };
  }
  return { fail: last ?? 'no seed worked' };
}

/** Largest W where a WxW mirror fits (gap >= 1). */
function maxMirrorWidth(stage) {
  for (let w = 8; w >= 3; w--) {
    const spec = { spec: { width: w, budget: w + 5 * (w - 1) } };
    const m = buildMatchup({ stage, white: spec, black: spec, seed: 3, gapMin: 1 });
    if (!m.error) return w;
  }
  return null;
}

function sampleCard(label, note, stage, s) {
  if (s.fail) {
    return `<figure><figcaption><b>${label}</b> — ${note}<br><i class="miss">not shown: ${s.fail}</i></figcaption></figure>`;
  }
  const m = s.m;
  const viol = m.violations.length ? `<br><span class="viol">soft: ${m.violations.join(', ')}</span>` : '';
  return `<figure>${boardHtml(stage, m)}<figcaption><b>${label}</b> — ${note}<br>` +
    `W ${describeArmy(m.white.army)} vs B ${describeArmy(m.black.army)} · gap ${m.gap} · seed ${s.seed}${viol}</figcaption></figure>`;
}

let cards = '';
let issues = 0;
for (const stage of stages) {
  const wide = stage.files >= 6;
  const small = trySample(stage, () => ({
    white: { spec: { width: 3, budget: 12 } },
    black: { spec: { width: 3, budget: 8 } },
  }));
  const big = trySample(stage, () => {
    for (let w = 8; w >= 3; w--) {
      const bw = Math.max(3, w - 2);
      const specs = {
        white: { spec: { width: w, budget: w + 5 * (w - 1) }, anchor: wide ? 'left' : 'center' },
        black: { spec: { width: bw, budget: bw + 4 * (bw - 1) }, anchor: wide ? 'right' : 'center' },
      };
      const probe = buildMatchup({ stage, seed: 1, gapMin: 1, ...specs });
      if (!probe.error) return specs;
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
      const probe = buildMatchup({ stage, seed: 1, gapMin: 1, ...specs });
      if (!probe.error) return specs;
    }
    return null;
  });
  if (small.fail || big.fail || scrambled.fail) issues++;
  const mirror = maxMirrorWidth(stage);
  cards += `<section class="card" id="${stage.id}">
<h2>${stage.title} <code>${stage.id}</code></h2>
<p class="meta">${stage.files}×${stage.ranks} · ${stage.walls.length} walls · largest mirror army that fits: ${mirror ? `${mirror}×2` : 'none'}</p>
<p class="notes">${stage.notes}</p>
<div class="row">
<figure>${boardHtml(stage)}<figcaption><b>Terrain</b></figcaption></figure>
${sampleCard('A · small', '3×2 armies, centered', stage, small)}
${sampleCard('B · big squeeze', 'largest army that fits, offset anchors', stage, big)}
${sampleCard('C · scrambled', 'budget-drawn, scrambled ranks', stage, scrambled)}
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
<title>Proving Grounds — stage review</title>
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
  .lab { font-size: 10px; color: #999; text-align: center; padding: 0 3px; }
  .wp { color: #fff; text-shadow: 0 0 2px #000, 0 1px 1px #000; } .bp { color: #111; }
  .viol { color: #b06000; } .miss { color: #a33; }
</style>
<h1>Proving Grounds — stage review</h1>
<p class="sub">12 authored stages, 3×5 → 10×10. Terrain only — armies are generator
output molded onto each stage (royal rearmost row, pawns in front; soft
pawn-coverage violations flagged). For each stage: <b>keep / tweak / kill</b> —
call tweaks by coordinates (walls are drawn in the JSON as ASCII, one char per
square). Samples are seeded and reproducible; "not shown" means the generator
rejected every attempt (that is data too).</p>
${cards}`;

fs.writeFileSync(OUT, html);
console.log(`\n${stages.length} stages, ${issues} with sample issues → ${OUT}`);

// The replay analyzer (2026-09-07) — a replay log (play/js/replaylog.mjs
// buildLog, schema dck-log/1) on the REAL board, on the phone. Its own page
// (replay/index.html, a sibling of play/), so the game's phase machine and
// main.mjs are untouched: the two share the renderer (board-ui.mjs), the
// stage helpers, the engine wrapper, the log store and the ONE report
// rendering (play/js/logreport.mjs — the Node post-mortem and this screen
// print the same lines).
//
// What it does:
//   load    the game's autosave ring (same origin → same localStorage:
//           `?slot=N`, `?latest=1`, the picker), a file (`<input type=file>`
//           works on the phone), pasted JSON, a URL (`?url=`, same-origin;
//           `?sample=1` is the committed sample), or a drop.
//   scrub   every recorded state (`states`) painted with ITS holes, god
//           crates, the stage's skins (re-derived from the manifest by id,
//           flip, crop and the recovered auto-crop) and the residue a
//           forward walk rebuilds (board-ui residueStep — the game's own
//           rule, on data); the ply's move as an arrow (gold = the player,
//           red = the enemy), that ply's quake residue as marks, the eval
//           bar, the gods line.
//   why     the quake's block from the report (path, meters, rolls, the
//           ranked pools with the pick marked, the rejects by reason, the
//           protected members and keys, the inputs, the gate verdict, the
//           rejected draws, timing) — and the parts that are square lists
//           painted on the board on a tap: before/after, protected, each
//           rung's pool, each rejected draw's board, each engine hint's line.
//   undos   the branch tree (logreport lineTree): step into an abandoned
//           line, scrub it like the line of record, step back out.
//   probe   an eval of any board, or the three-board deep Δ of any quake, on
//           this page's OWN engine (booted on first use — no duel is ever
//           live here, so rule 12's idle-window dance does not apply, but
//           its recovery does: a visible failure and a fresh instance); the
//           log's variant block registers the deal variant (rule 7,
//           cumulative). Results attach to the loaded log and export with it.
//   export  the (annotated) log as a file / clipboard, the whole report as
//           text on the clipboard.
//
// Old logs (before replay-log.1/.2: no `mover`, `candidates`, `pieceList`,
// `autoCrop`) load — every read is optional; a missing stage (the archived
// bed) paints without skins and says so.
//
// Query params: ?slot= ?latest=1 ?url= ?sample=1 ?ply= ?go= (probe limits;
// default the log's own) ?theme= ?pieces= ?doors= (look overrides, as the
// game's) ?fx=0.
//
// E2E/console surface: window.__DCK.replay — see the bottom of this file.
import { PIECE_SETS, DOOR_SETS, DEFAULT_PIECE_FIT, TILE_LIFT_RANGE, TILE_SHIFT_RANGE, residueStep } from '../../play/js/board-ui.mjs';
import { CanvasBoard } from '../../play/js/canvas-board.mjs'; // the one renderer (2026-09-07): the 16×16 canvas board, its art off play/img/
import { loadStageV2, flipStageVertical, cropStage, stageSkins, THEMES } from '../../play/js/stage.mjs';
import { createEngine } from '../../play/js/engine.mjs';
import { makeCatalogIni } from '../../play/js/variant.mjs';
import { deliverLog, logFileName, logSize, LogStore, jsonSafeNumbers } from '../../play/js/replaylog.mjs';
import { parseBoard, WALL, FURNITURE } from '../../play/js/fen.mjs';
import { envTransform, toEnvCell } from '../../play/js/debris.mjs'; // the deal's transform into the stage's grid (the floor's hash coordinates)
import * as R from '../../play/js/logreport.mjs';
import { stripData, renderStrips, setCursor, plyAtX, readoutAt, ALL_SERIES } from './strips.mjs';

export const REPLAY_BUILD = '2026-09-07 replay-ui.1';
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const OPT_KEY = 'dck.options.v1'; // the game's options (same origin): the board's look
const FX_SCALE = params.has('fx') ? Math.max(0, parseFloat(params.get('fx')) || 0) : 1;
document.documentElement.dataset.fx = String(FX_SCALE);

const logStore = new LogStore();

const app = {
  log: null, // the loaded export object (mutated in place by probes)
  tree: null, // logreport lineTree
  line: null, // the line being scrubbed (main or a branch)
  ply: 0,
  boardUI: null,
  stage: null, // the transformed stage (skins + theme), or null
  tx: null, // the deal's transform into the base stage's grid (debris.mjs envTransform), or null
  stageNote: '',
  skins: {},
  residue: new Map(), // line id → [{opened, rubble}] per state index
  showing: null, // an overlay on the current ply's board: {kind, …}
  engine: null,
  enginePending: null,
  engineFailures: 0,
  variantInis: new Set(),
  probe: { busy: false, queue: [], seq: 0 },
  source: null,
  strips: null, // { data, geom } for the current line (strips.mjs)
  stripHidden: new Set(), // series toggled off on the strips (persisted)
};
const STRIPS_KEY = 'dck.replay.strips.v1';
try {
  const saved = JSON.parse(localStorage.getItem(STRIPS_KEY) ?? '[]');
  if (Array.isArray(saved)) app.stripHidden = new Set(saved.filter((k) => ALL_SERIES.includes(k)));
} catch {
  /* no storage: every series shows */
}

// ------------------------------------------------------------------ chrome

function setStatus(msg) {
  $('status').textContent = msg;
}
function note(msg, cls = null) {
  const el = $('replay-log');
  const div = document.createElement('div');
  div.textContent = msg;
  if (cls) div.className = cls;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}
const say = (el, text) => {
  el.textContent = text;
};
const pre = (lines) => {
  const p = document.createElement('pre');
  p.className = 'rep';
  p.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
  return p;
};
const btn = (label, onClick, { cls = '', title = '' } = {}) => {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
};

// ---------------------------------------------------------------- the look

let options = {};
try {
  options = JSON.parse(localStorage.getItem(OPT_KEY) ?? '{}') ?? {};
} catch {
  options = {};
}
const clampNum = (v, lo, hi, dflt) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : dflt;
};
function themeFor(stage) {
  const pick = params.get('theme') ?? options.theme;
  if (pick && pick !== 'auto') return THEMES.includes(pick) ? pick : null;
  return stage?.theme ?? null;
}
function applyLook() {
  const ui = app.boardUI;
  if (!ui) return;
  ui.setTheme(themeFor(app.stage));
  const pieces = params.get('pieces') ?? options.pieces ?? 'nulltale';
  ui.setPieces(PIECE_SETS.includes(pieces) ? pieces : null);
  const doors = params.get('doors') ?? options.doors;
  ui.setDoors(DOOR_SETS.includes(doors) ? doors : null);
  ui.setPieceFit({
    tileLift: Math.round(clampNum(params.get('tilelift') ?? options.tileLift, TILE_LIFT_RANGE[0], TILE_LIFT_RANGE[1], DEFAULT_PIECE_FIT.tileLift)),
    tileShift: Math.round(clampNum(params.get('tileshift') ?? options.tileShift, TILE_SHIFT_RANGE[0], TILE_SHIFT_RANGE[1], DEFAULT_PIECE_FIT.tileShift)),
  });
}

// --------------------------------------------------------------- the stage

let manifestPromise = null;
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('../play/stages/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m) => m.stages.map((json) => loadStageV2(json)))
      .catch((e) => {
        note(`stage manifest failed to load (${e.message}) — boards paint without skins`, 'warn');
        return [];
      });
  }
  return manifestPromise;
}

/** The terrain of a stage grid vs a FEN's: every wall and every '^' on the
 *  same squares (pieces stand on floor, so they never disagree). */
function terrainMatches(stage, fen) {
  const grid = parseBoard(fen.split(' ')[0]); // [rankFromTop][file]
  if (grid.length !== stage.ranks || (grid[0]?.length ?? 0) !== stage.files) return false;
  for (let r = 0; r < stage.ranks; r++) {
    for (let f = 0; f < stage.files; f++) {
      const a = stage.grid[r][f];
      const b = grid[stage.ranks - 1 - r][f];
      const ta = a === WALL || a === FURNITURE ? a : null;
      const tb = b === WALL || b === FURNITURE ? b : null;
      if (ta !== tb) return false;
    }
  }
  return true;
}

/** The stage the log was played on, transformed as the deal transformed it:
 *  flip, the requested crop, then the king-anchored AUTO-CROP — recorded
 *  since 2026-09-07 (`autoCrop`), recovered for older logs by matching the
 *  stage's terrain against the start position. */
async function resolveStage(L) {
  app.stage = null;
  app.skins = {};
  app.stageNote = '';
  const stages = await loadManifest();
  const base = stages.find((s) => s.id === L.stage);
  if (!base) {
    app.stageNote = L.stage ? `stage ${L.stage} is not in this build's manifest — no skins` : 'no stage recorded — no skins';
    return;
  }
  let t = base;
  let autoCrop = { top: 0, bottom: 0 };
  try {
    if (L.flip) t = flipStageVertical(t);
    t = cropStage(t, L.crop?.top ?? 0, L.crop?.bottom ?? 0);
    const need = t.ranks - (L.ranks ?? t.ranks);
    if (need > 0) {
      let found = null;
      if (L.autoCrop && (L.autoCrop.top ?? 0) + (L.autoCrop.bottom ?? 0) === need) {
        found = cropStage(t, L.autoCrop.top ?? 0, L.autoCrop.bottom ?? 0);
        autoCrop = { top: L.autoCrop.top ?? 0, bottom: L.autoCrop.bottom ?? 0 };
      }
      if (!found || !terrainMatches(found, L.startFen)) {
        found = null;
        for (let top = 0; top <= need; top++) {
          const c = cropStage(t, top, need - top);
          if (terrainMatches(c, L.startFen)) {
            found = c;
            autoCrop = { top, bottom: need - top };
            break;
          }
        }
      }
      if (!found) throw new Error(`no auto-crop of ${need} rank${need === 1 ? '' : 's'} matches the start position`);
      t = found;
    }
    if (t.files !== L.files || t.ranks !== L.ranks) throw new Error(`stage is ${t.files}×${t.ranks}, the log ${L.files}×${L.ranks}`);
    if (L.startFen && !terrainMatches(t, L.startFen)) {
      app.stageNote = `stage ${t.id}: terrain differs from the start position (a re-authored stage?) — skins may be off`;
    }
  } catch (e) {
    app.stageNote = `stage ${L.stage}: ${e.message} — no skins`;
    return;
  }
  app.stage = t;
  app.skins = stageSkins(t);
  // The deal's transform into the base stage's own grid (debris.mjs
  // envTransform) — the coordinates the game hashes the floor's variants
  // on (the camera, 2026-09-08), so the analyzer paints the floor the
  // player saw on a flipped or cropped stage.
  app.tx = envTransform({ flip: !!L.flip, cropTop: L.crop?.top ?? 0, cropBottom: L.crop?.bottom ?? 0, autoCrop, files: L.files, ranks: L.ranks }, base);
}

// ------------------------------------------------------------- the board

/** The world coordinates a square's cosmetic hashes key on (canvas-board
 *  `hashCoords`): the environment's cell when the stage resolved, else the
 *  identity — the same rule as the game's. */
function hashCoords(f, rank) {
  const tx = app.tx;
  if (!tx) return [f, rank];
  const { ef, er } = toEnvCell(tx, String.fromCharCode(97 + f) + rank);
  return [ef, er + 1];
}

function mountBoard(files, ranks) {
  if (app.boardUI) app.boardUI.destroy();
  $('board').className = '';
  // North up, the phone's fit: the analyzer replays the view the log was
  // played in (the camera's turn buttons wait for the army).
  app.boardUI = new CanvasBoard($('board'), { files, ranks, facing: 0, fit: 'width', hashCoords, scaling: params.get('scaling') === 'fill' ? 'fill' : 'integer' });
  app.boardUI.setInteractive(false);
  applyLook();
}

const toSet = (a) => new Set(a ?? []);

/** The residue ({opened, rubble}) before every state of a line, by state
 *  index — one forward walk per line, the parent's prefix reused. */
function residueFor(line) {
  if (app.residue.has(line.id)) return app.residue.get(line.id);
  const L = app.log;
  const states = line.states ?? [];
  let out = [];
  let start = 0;
  let res = { opened: new Set(), rubble: new Set() };
  if (line.parent) {
    const parent = app.tree.byId.get(line.parent);
    const pres = residueFor(parent);
    // The prefix is the parent's states up to the fork: same array entries.
    const n = states.findIndex((s) => (s.ply ?? 0) > line.forkPly);
    start = n < 0 ? states.length : n;
    out = pres.slice(0, start);
    res = out[start - 1] ?? res;
  }
  for (let i = start; i < states.length; i++) {
    const prev = states[i - 1];
    if (i > 0 && prev?.fen && states[i]?.fen) {
      res = residueStep({ fen: prev.fen, holes: toSet(prev.holes), godCrates: toSet(prev.godCrates), ...res }, { fen: states[i].fen, holes: toSet(states[i].holes) }, app.skins, L.files, L.ranks);
    }
    out.push(res);
  }
  app.residue.set(line.id, out);
  return out;
}

/** The state (and its index) shown at a ply of the current line. */
function stateIndexAt(line, ply) {
  const states = line.states ?? [];
  let i = states.findIndex((s) => s.ply === ply && !s.ended);
  if (i < 0) i = states.findIndex((s) => s.ply === ply);
  return i;
}
const stateAt = (line, ply) => {
  const i = stateIndexAt(line, ply);
  return i < 0 ? null : line.states[i];
};

function ledgers(st) {
  return { holes: toSet(st?.holes), godCrates: toSet(st?.godCrates) };
}

/** The gods' residue marks for one quake event (the game's quakeMarks
 *  rule: a later rung supersedes an earlier mark on the same square). */
function quakeMarksOf(ev) {
  const cracked = (ev.terrain ?? []).filter((e) => e.kind === 'weaken').map((e) => e.square);
  const breached = (ev.terrain ?? []).filter((e) => e.kind === 'breach').map((e) => e.square);
  const pit = ev.crumble ? ev.crumble.square : null;
  return {
    pits: pit ? [pit] : [],
    cracked: cracked.filter((sq) => !breached.includes(sq)),
    breached: breached.filter((sq) => sq !== pit),
    arrows: (ev.displacements ?? []).map((d) => ({ from: d.from, to: d.to, strength: 0.7, kind: 'quake' })),
  };
}

function moveArrow(st) {
  const p = st?.move?.match(R.UCI_MOVE_RE);
  if (!p) return null;
  // Gold is the player's colour, red the enemy's last move (style.css roles).
  return st.mover === 'engine' ? { from: p[1], to: p[2], strength: 1, kind: 'last' } : { from: p[1], to: p[2], strength: 0.9, rank: 1, kind: 'hint' };
}

const idx = () => R.indexLine(app.line);

/** Paint the current ply (or the overlay on it) and refresh every readout. */
function paint() {
  const L = app.log;
  const line = app.line;
  const ply = app.ply;
  const ui = app.boardUI;
  const st = stateAt(line, ply);
  const i = stateIndexAt(line, ply);
  const res = residueFor(line)[i] ?? { opened: new Set(), rubble: new Set() };
  const ix = idx();
  const q = ix.quakes.get(ply) ?? null;
  const t = ix.traces.get(ply) ?? null;
  let marks = {};
  let fenShown = st?.fen ?? null;
  const show = app.showing;
  if (st?.fen) {
    if (show?.kind === 'before' && q) {
      const prev = stateAt(line, ply - 1);
      const pres = residueFor(line)[stateIndexAt(line, ply - 1)] ?? res;
      ui.setPosition(q.preFen, { ...ledgers(prev), skins: app.skins, ...pres });
      fenShown = q.preFen;
      marks = {};
    } else if (show?.kind === 'attempt') {
      const a = show.attempt;
      const prev = stateAt(line, ply - 1);
      const led = ledgers(prev);
      if (a.crumble?.square) led.holes.add(a.crumble.square);
      for (const e of a.terrain ?? []) if (e.kind === 'weaken') led.godCrates.add(e.square);
      const pres = residueFor(line)[stateIndexAt(line, ply - 1)] ?? res;
      const ares = residueStep({ fen: q?.preFen ?? prev?.fen, holes: toSet(prev?.holes), godCrates: toSet(prev?.godCrates), ...pres }, { fen: a.postFen, holes: led.holes }, app.skins, L.files, L.ranks);
      ui.setPosition(a.postFen, { ...led, skins: app.skins, ...ares });
      fenShown = a.postFen;
      marks = quakeMarksOf(a);
    } else {
      ui.setPosition(st.fen, { ...ledgers(st), skins: app.skins, ...res });
      const arrows = [];
      const mv = moveArrow(st);
      if (mv) arrows.push(mv);
      if (q) {
        const qm = quakeMarksOf(q);
        marks = { ...qm, arrows: [...qm.arrows, ...arrows] };
      } else marks = { arrows };
      if (show?.kind === 'pool') Object.assign(marks, poolMarks(show, marks));
      else if (show?.kind === 'protected') marks.heat = protectedHeat(t);
      else if (show?.kind === 'hint') marks.arrows = pvArrows(show.pv, st.fen);
      else if (show?.kind === 'probe-pv') marks.arrows = pvArrows(show.pv, st.fen);
    }
  }
  ui.setMarks(marks);
  app.fenShown = fenShown;
  app.marks = marks;

  // Readouts.
  $('plySlider').max = String(line.plies ?? 0);
  $('plySlider').value = String(ply);
  say($('ply-readout'), `p${ply} / ${line.plies ?? 0}`);
  const san = ply > 0 ? line.sans?.[ply - 1] ?? line.moves?.[ply - 1] ?? '?' : null;
  const plyLine = ply > 0 ? R.timelineLine(ply, san, { ...ix, states: line.states }) : `p  0  the start position${L.turn === 'b' ? ' (the enemy moves first)' : ''}`;
  const meter = st?.meter ? `  meter ${fmt(st.meter.value)} tedium ${fmt(st.meter.tedium)} heat ${fmt(st.meter.heat)} fun ${fmt(1 - (st.meter.staleness ?? 0))}` : '';
  const probe = st?.probe ? `\nprobe (${st.probe.go}, white POV): ${R.fmtScore(st.probe)}${st.probe.depth ? ` d${st.probe.depth}` : ''}  pv ${(st.probe.pv ?? []).slice(0, 8).join(' ')}` : '';
  const ended = st?.ended ? `\ngame over: ${st.result ?? ''} ${st.termination ?? st.error ?? ''}`.trimEnd() : '';
  const showing = show ? `\n▶ showing ${showingWords(show)} — tap the same button (or move) to return` : '';
  say($('ply-line'), plyLine + meter + probe + ended + showing);
  say($('gods-line'), q ? `⚡ the gods: ${R.quakeSummary(q)}` : t?.outcome === 'vetoed' ? '⚡ the gods: every draw softened — nothing landed' : '');
  say($('player-bar-text'), `${L.player === 'black' ? 'you · black' : 'you · white'}${line.id !== 'main' ? ` · ${line.name}` : ''}`);
  say($('enemy-bar'), `enemy · ${L.player === 'black' ? 'white' : 'black'} · ${L.stage ?? '?'}${L.title ? ` "${L.title}"` : ''}`);
  updateEvalBar(line, ply);
  syncStrips(ply);
  renderQuakeSection(q, t);
  highlightTimeline(ply);
  $('btnLineUp').hidden = !line.parent;
  $('btnPrev').disabled = ply <= 0;
  $('btnFirst').disabled = ply <= 0;
  $('btnNext').disabled = ply >= (line.plies ?? 0);
  $('btnLast').disabled = ply >= (line.plies ?? 0);
  syncProbeButtons();
}

const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');

function showingWords(show) {
  switch (show.kind) {
    case 'before':
      return `the board BEFORE the quake at ply ${app.ply}`;
    case 'attempt':
      return `rejected draw #${show.attempt.attempt} (${show.attempt.verdict}): the board it would have left`;
    case 'pool':
      return `${show.rung} pool — the pick in gold, the rest in blue, rejects dim`;
    case 'protected':
      return 'the protected set — pieces in gold, squares in blue';
    case 'hint':
      return `engine line (${show.source}) as arrows, numbered`;
    case 'probe-pv':
      return 'the probe\'s line as arrows, numbered';
    default:
      return show.kind;
  }
}

function poolMarks(show, base) {
  const c = show.candidates;
  const heat = {};
  const arrows = [...(base.arrows ?? [])];
  if (c.rung === 'displace') {
    c.pool.forEach((x, j) => {
      arrows.push({ from: x.from, to: x.to, strength: j === c.chosen ? 1 : 0.45, kind: 'quake' });
      heat[x.to] = j === c.chosen ? 'a' : 'b';
    });
    for (const r of c.rejected ?? []) if (r.to && !heat[r.to]) heat[r.to] = 'c';
  } else if (c.rung === 'crumble') {
    c.pool.forEach((sq, j) => (heat[sq] = j === c.chosen ? 'a' : 'b'));
    for (const x of c.terminal ?? []) heat[x.sq] = 't';
    for (const r of c.rejected ?? []) if (r.sq && !heat[r.sq]) heat[r.sq] = 'c';
  } else {
    c.pool.forEach((x, j) => (heat[x.sq] = j === c.chosen ? 'a' : 'b'));
    for (const r of c.rejected ?? []) if (r.sq && !heat[r.sq]) heat[r.sq] = 'c';
  }
  return { heat, arrows };
}

function protectedHeat(t) {
  const heat = {};
  for (const sq of t?.protected?.squareList ?? []) heat[sq] = 'b';
  for (const sq of t?.protected?.pieceList ?? []) heat[sq] = 'a';
  return heat;
}

/** A principal variation as numbered arrows: the first six moves, the
 *  best line's colour fading with distance. */
function pvArrows(pv, fen) {
  const out = [];
  (pv ?? []).slice(0, 6).forEach((m, j) => {
    const p = String(m).match(R.UCI_MOVE_RE);
    if (!p) return;
    out.push({ from: p[1], to: p[2], strength: Math.max(0.35, 1 - j * 0.13), rank: 1, kind: 'hint', label: String(j + 1) });
  });
  return out;
}

function updateEvalBar(line, ply) {
  const L = app.log;
  // The most recent reply search at or before this ply, mover (enemy) POV.
  let e = null;
  for (const x of line.engine ?? []) if (x.ply <= ply && (!e || x.ply > e.ply)) e = x;
  const st = stateAt(line, ply);
  let pov = null; // the player's POV, as the game's bar
  let src = '';
  if (st?.probe) {
    pov = L.player === 'black' ? { type: st.probe.type, value: -st.probe.value } : { type: st.probe.type, value: st.probe.value };
    src = 'probe';
  } else if (e?.score) {
    pov = { type: e.score.type, value: -e.score.value }; // the enemy's POV → the player's
    src = `d${e.depth ?? '?'} @p${e.ply}`;
  }
  const bar = $('eval-bar');
  if (!pov) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  let cp;
  let text;
  if (pov.type === 'mate') {
    cp = pov.value > 0 ? 10000 : -10000;
    text = pov.value > 0 ? `M${pov.value}` : `−M${-pov.value}`;
  } else {
    cp = pov.value;
    text = (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1);
  }
  $('eval-fill').style.width = (100 / (1 + Math.exp(-0.004 * cp))).toFixed(1) + '%';
  $('eval-text').textContent = `${text} (${src})`;
}

// ------------------------------------------------------------- the strips

const stripHosts = () => ({ gods: $('strip-gods'), eval: $('strip-eval') });

/** Rebuild the strips for the current line (a new log, a branch, a probe). */
function renderLineStrips() {
  const line = app.line;
  if (!line || !app.log) return;
  const data = stripData(line, app.log);
  data.forks = (line.forks ?? []).map((f) => f.forkPly);
  const geom = renderStrips(stripHosts(), data, app.ply, app.stripHidden);
  app.strips = { data, geom };
  syncStripToggles();
}

/** A legend item's on/off look, and the persisted choice. */
function syncStripToggles() {
  for (const b of document.querySelectorAll('.sw-btn')) b.classList.toggle('off', app.stripHidden.has(b.dataset.series));
}
function toggleSeries(key) {
  if (!ALL_SERIES.includes(key)) return false;
  if (app.stripHidden.has(key)) app.stripHidden.delete(key);
  else app.stripHidden.add(key);
  try {
    localStorage.setItem(STRIPS_KEY, JSON.stringify([...app.stripHidden]));
  } catch {
    /* fine */
  }
  app.strips = null;
  syncStrips(app.ply);
  return !app.stripHidden.has(key);
}

/** Move the cursor and refresh the readout for a ply (cheap, every paint). */
function syncStrips(ply) {
  if (!app.strips) renderLineStrips();
  const st = app.strips;
  if (!st) return;
  setCursor(stripHosts(), st.geom, ply);
  const r = readoutAt(st.data, ply);
  say($('ro-pressure'), r.pressure);
  say($('ro-tedium'), r.tedium);
  say($('ro-heat'), r.heat);
  say($('ro-fun'), r.fun);
  say($('ro-eval'), r.eval);
  say($('ro-eval-src'), r.probed ? 'probe' : r.eval === '—' ? '' : 'enemy\'s search');
}

/** Tap or drag on a strip scrubs to the ply under the pointer. */
function wireStrip(svg, name) {
  let down = false;
  const to = (e) => {
    const g = app.strips?.geom?.[name];
    if (!g) return;
    const rect = svg.getBoundingClientRect();
    const xPx = ((e.clientX - rect.left) / rect.width) * g.W;
    const p = plyAtX(g, xPx);
    if (p !== app.ply) goto(p);
  };
  svg.addEventListener('pointerdown', (e) => {
    down = true;
    svg.setPointerCapture?.(e.pointerId);
    to(e);
  });
  svg.addEventListener('pointermove', (e) => {
    if (down) to(e);
  });
  const up = () => {
    down = false;
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
}
if (typeof ResizeObserver !== 'undefined') {
  // A width change (rotation, a resized window) redraws in the new pixel space.
  const ro = new ResizeObserver(() => {
    if (app.strips) {
      const geom = renderStrips(stripHosts(), app.strips.data, app.ply, app.stripHidden);
      app.strips.geom = geom;
    }
  });
  ro.observe($('strip-gods'));
}

// --------------------------------------------------------- the sections

function renderQuakeSection(q, t) {
  const box = $('sec-quake-body');
  box.textContent = '';
  const sum = $('sec-quake-sum');
  const line = app.line;
  const ply = app.ply;
  const attempts = (line.attempts ?? []).filter((a) => a.ply === ply);
  if (!q && !t) {
    sum.textContent = `the gods at ply ${ply}: no trace`;
    box.appendChild(pre(ply === 0 ? 'the start position — the gods roll from ply 1' : 'no roll trace for this ply (an old log, or the game ended here)'));
    return;
  }
  const head = q ? `⚡ ply ${ply}: ${R.quakeSummary(q)}` : t.outcome === 'vetoed' ? `⚡ ply ${ply}: VETOED — every draw softened` : `ply ${ply}: quiet (${(t.path ?? []).join(' → ')}${t.p ? `, p ${t.p.quake}` : ''})`;
  sum.textContent = head;
  const tools = document.createElement('div');
  tools.className = 'tools';
  const toggle = (kind, label, extra = {}, title = '') => {
    const on = app.showing?.kind === kind && (extra.key === undefined || app.showing.key === extra.key);
    const b = btn(label, () => {
      app.showing = on ? null : { kind, ...extra };
      paint();
    }, { cls: on ? 'on' : '', title });
    tools.appendChild(b);
  };
  if (q) {
    toggle('before', app.showing?.kind === 'before' ? `after (p${ply})` : 'before', {}, 'the board as it stood before this quake');
  }
  if (t?.protected && (t.protected.pieces || t.protected.squares)) toggle('protected', `protected ${t.protected.pieces}p/${t.protected.squares}s`, {}, 'the pieces and squares the gods may not touch');
  (t?.candidates ?? []).forEach((c, j) => {
    const n = c.rung === 'crumble' ? c.pool.length + (c.terminal?.length ?? 0) : c.pool.length;
    toggle('pool', `${j + 1}: ${c.rung} ×${n}`, { key: `pool-${j}`, candidates: c, rung: c.rung }, `action ${j + 1}'s pool on the board`);
  });
  (t?.inputs?.hints ?? []).forEach((h, j) => {
    if (!h.pv?.length) return;
    toggle('hint', `line ${j + 1} ${R.fmtScore(h.score)}`, { key: `hint-${j}`, pv: h.pv, source: h.source }, `${h.source}: ${h.pv.slice(0, 8).join(' ')}`);
  });
  attempts.forEach((a, j) => {
    toggle('attempt', `✗ draw #${a.attempt}`, { key: `attempt-${j}`, attempt: a }, `${a.verdict}: the board this rejected draw would have left`);
  });
  if (q) {
    const b = btn(q.deepDelta ? 'deep Δ ✓' : 'deep Δ probe', () => queueDeep(q), { title: 'probe the three boards (before the move, before the quake, after) at the probe limits' });
    b.disabled = !!q.deepDelta || app.probe.busy;
    b.dataset.role = 'deep';
    tools.appendChild(b);
  }
  if (tools.childElementCount) box.appendChild(tools);
  if (q) {
    box.appendChild(pre(R.quakeBlock(q, t, { states: line.states, attempts: line.attempts ?? [], files: app.log.files ?? 10, stacked: true })));
  } else {
    const lines = R.traceDetail(t);
    if (t.outcome === 'vetoed') for (const a of attempts) lines.push(...R.attemptLines(a));
    box.appendChild(pre(lines));
  }
}

/** The tunes (dial / preset / favor changes, not undo markers) that happened
 *  on a line: by seq — inside a branch's tail range for a branch, outside
 *  every branch's range for the line of record. */
function tunesFor(line) {
  const L = app.log;
  const tunes = (L.tunes ?? []).filter((t) => !t.undo);
  const ranges = (L.branches ?? []).map((b) => {
    const seqs = [];
    for (const k of ['states', 'quakeTraces', 'engine', 'log', 'flags', 'quakes', 'attempts']) for (const e of b.tail?.[k] ?? []) if (typeof e?.seq === 'number') seqs.push(e.seq);
    return { id: `branch-${L.branches.indexOf(b) + 1}`, lo: seqs.length ? Math.min(...seqs) : b.seq, hi: b.seq };
  });
  const owner = (seq) => ranges.find((r) => seq >= r.lo && seq <= r.hi)?.id ?? 'main';
  return tunes.filter((t) => (typeof t.seq === 'number' ? owner(t.seq) : 'main') === line.id);
}

function renderTimeline() {
  const box = $('sec-timeline-body');
  box.textContent = '';
  const line = app.line;
  const ix = idx();
  const forksAt = new Map();
  for (const f of line.forks ?? []) forksAt.set(f.forkPly, [...(forksAt.get(f.forkPly) ?? []), f]);
  const row = (ply, text, cls = '') => {
    const d = document.createElement('div');
    d.className = `tl-row ${cls}`.trim();
    d.dataset.ply = String(ply);
    d.textContent = text;
    d.addEventListener('click', () => goto(ply));
    box.appendChild(d);
    return d;
  };
  const forkRows = (ply) => {
    for (const f of forksAt.get(ply) ?? []) {
      const d = document.createElement('div');
      d.className = 'tl-row fork';
      d.textContent = `      ↩ ${f.name} — abandoned ${f.plies - f.forkPly} plies, ${f.quakes.filter((q) => q.ply > f.forkPly).length} quakes · tap to step in`;
      d.addEventListener('click', () => enterBranch(f.id));
      box.appendChild(d);
    }
  };
  // Tune markers (a preset / dial / favor change mid-duel): the tunes ledger
  // is one list for the whole record, so a tune belongs to the line whose
  // events surround its seq (a branch's tail, else the line of record).
  const tunesAt = new Map();
  for (const t of tunesFor(line)) tunesAt.set(t.ply, [...(tunesAt.get(t.ply) ?? []), t]);
  const tuneRows = (ply) => {
    for (const t of tunesAt.get(ply) ?? []) {
      const d = document.createElement('div');
      d.className = 'tl-row tune';
      d.dataset.ply = String(ply);
      d.textContent = `      ⚙ tune @p${ply}: ${R.tuneWords(t)}`;
      d.addEventListener('click', () => goto(ply));
      box.appendChild(d);
    }
  };
  row(0, 'p  0  start');
  tuneRows(0);
  forkRows(0);
  for (let i = 0; i < (line.moves?.length ?? 0); i++) {
    const ply = i + 1;
    const san = line.sans?.[i] ?? line.moves[i];
    const inTail = !line.parent || ply > line.forkPly;
    const text = R.timelineLine(ply, san, { ...ix, states: line.states });
    row(ply, text, `${ix.quakes.has(ply) ? 'quake' : ''} ${inTail ? '' : 'prefix'} ${line.states?.some((s) => s.ply === ply && s.mover === 'player') ? 'player' : ''}`);
    tuneRows(ply);
    forkRows(ply);
  }
  if (line.parent) {
    const d = document.createElement('div');
    d.className = 'tl-row fork';
    d.textContent = `      ↩ the undo: play resumed on ${app.tree.byId.get(line.parent)?.name ?? 'the line above'} at ply ${line.forkPly} · tap to step out`;
    d.addEventListener('click', () => leaveBranch());
    box.appendChild(d);
  }
  $('sec-timeline-sum').textContent = `timeline · ${line.name} · ${line.plies} plies · ${line.quakes.length} quakes`;
}

function highlightTimeline(ply) {
  const box = $('sec-timeline-body');
  let cur = null;
  for (const d of box.querySelectorAll('.tl-row')) {
    const on = d.dataset.ply === String(ply) && !d.classList.contains('fork');
    d.classList.toggle('current', on);
    if (on) cur = d;
  }
  if (cur && $('sec-timeline').open) cur.scrollIntoView({ block: 'nearest' });
}

function renderUndos() {
  const box = $('sec-undos-body');
  box.textContent = '';
  const L = app.log;
  const branches = app.tree.lines.filter((n) => n.id !== 'main');
  $('sec-undos-sum').textContent = `undos · ${branches.length}`;
  if (!branches.length) {
    box.appendChild(pre('no undos in this log'));
    return;
  }
  for (const n of branches.sort((a, b) => a.index - b.index)) {
    const b = L.branches[n.index];
    const wrap = document.createElement('div');
    wrap.className = 'undo-row';
    const head = document.createElement('div');
    head.className = 'tools';
    head.appendChild(btn(app.line?.id === n.id ? `in ${n.name}` : `step into ${n.name}`, () => enterBranch(n.id), { cls: app.line?.id === n.id ? 'on' : '' }));
    if (n.parent !== 'main') {
      const p = document.createElement('span');
      p.className = 'muted';
      p.textContent = `hangs off ${app.tree.byId.get(n.parent)?.name ?? n.parent}`;
      head.appendChild(p);
    }
    wrap.appendChild(head);
    wrap.appendChild(pre(R.branchLines(L, b, n.index).slice(0, 3)));
    box.appendChild(wrap);
  }
}

function renderStatic() {
  const L = app.log;
  const lines = R.headerLines(L);
  if (app.stageNote) lines.push(`analyzer: ${app.stageNote}`);
  else if (app.stage) lines.push(`analyzer: stage ${app.stage.id} (${app.stage.theme ?? 'no theme'}), ${Object.keys(app.skins).length} skinned squares`);
  lines.push(`analyzer build ${REPLAY_BUILD}  source ${app.source ?? '?'}`);
  $('sec-header-body').textContent = '';
  $('sec-header-body').appendChild(pre(lines));
  $('sec-header-sum').textContent = `header · ${L.stage ?? '?'} · ${L.result ?? 'unfinished'} · ${L.plies ?? '?'} plies`;
  renderLineStatic();
}

function renderLineStatic() {
  const line = app.line;
  app.strips = null; // a new line: the strips are rebuilt on the next paint
  $('sec-engine-body').textContent = '';
  $('sec-engine-body').appendChild(pre((line.engine ?? []).map(R.engineLine)));
  $('sec-engine-sum').textContent = `engine · ${line.engine?.length ?? 0} reply searches`;
  $('sec-log-body').textContent = '';
  $('sec-log-body').appendChild(pre((line.log ?? []).map(R.logLine)));
  $('sec-log-sum').textContent = `duel log · ${line.log?.length ?? 0} lines`;
  const anomalies = R.anomalyLines(line);
  $('sec-anomalies-body').textContent = '';
  $('sec-anomalies-body').appendChild(pre(anomalies.length ? anomalies : 'none'));
  $('sec-anomalies-sum').textContent = `anomalies · ${line.anomalies?.length ?? 0}`;
  renderTimeline();
  renderUndos();
}

// ------------------------------------------------------------ navigation

function goto(ply) {
  const max = app.line?.plies ?? 0;
  const p = Math.max(0, Math.min(max, Number.isFinite(ply) ? Math.round(ply) : 0));
  app.showing = null;
  app.ply = p;
  paint();
  return p;
}
const step = (d) => goto(app.ply + d);
function jumpTo(plies, dir) {
  const sorted = [...new Set(plies)].sort((a, b) => a - b);
  const next = dir > 0 ? sorted.find((p) => p > app.ply) : [...sorted].reverse().find((p) => p < app.ply);
  if (next === undefined) {
    setStatus(dir > 0 ? 'no more ahead' : 'none before');
    return null;
  }
  return goto(next);
}
const quakePlies = () => [...app.line.quakes.map((q) => q.ply), ...R.vetoedPlies(app.line)];
const flagPlies = () => (app.line.flags ?? []).map((f) => f.ply);
const forkPlies = () => (app.line.forks ?? []).map((f) => f.forkPly);

function enterBranch(id) {
  const n = app.tree?.byId.get(id);
  if (!n || n === app.line) return false;
  app.line = n;
  app.showing = null;
  renderLineStatic();
  goto(Math.min(n.plies, n.forkPly + 1));
  setStatus(`in ${n.name}`);
  return true;
}
function leaveBranch() {
  const line = app.line;
  if (!line?.parent) return false;
  const parent = app.tree.byId.get(line.parent);
  app.line = parent;
  app.showing = null;
  renderLineStatic();
  goto(line.forkPly);
  setStatus(parent.id === 'main' ? 'the line of record' : `in ${parent.name}`);
  return true;
}

// ------------------------------------------------------------- the engine

function variantsIni() {
  return makeCatalogIni() + [...app.variantInis].map((x) => '\n' + x).join('');
}

async function ensureEngine() {
  if (app.engine) return app.engine;
  if (app.engineFailures >= 3) throw new Error('the engine failed three times — reload the page to try again');
  if (!app.enginePending) {
    app.enginePending = (async () => {
      setEngineStatus('summoning the engine…');
      const e = await createEngine();
      await e.loadVariantsIni(variantsIni());
      app.engine = e;
      app.engineNeedsIni = false;
      setEngineStatus(`engine ready · ${e.id ?? '?'}`);
      return e;
    })().finally(() => {
      app.enginePending = null;
    });
  }
  const e = await app.enginePending;
  if (app.engineNeedsIni) {
    await e.loadVariantsIni(variantsIni()); // a new log's deal variant (cumulative — rule 7)
    app.engineNeedsIni = false;
  }
  return e;
}

function setEngineStatus(msg) {
  say($('engine-status'), msg);
}

const probeGo = () => params.get('go') ?? $('probeGo').value.trim() ?? app.log?.go ?? 'depth 22 movetime 10000';

/** One WHITE-POV eval of a board: hash cleared (the v4.2 lesson), the
 *  log's variant, the search's own timeout. */
async function probeEval(engine, fen, go) {
  engine.send('setoption name Clear Hash');
  engine.position({ variant: app.log.variant, fen });
  const mt = go.match(/movetime (\d+)/);
  const t0 = performance.now();
  const res = await engine.go(go, { timeout: mt ? parseInt(mt[1], 10) + 6000 : 120000 });
  const score = engine.lastScore(res);
  if (!score) throw new Error('the probe returned no score');
  const depth = parseInt((res.infoLines[res.infoLines.length - 1]?.match(/ depth (\d+)/) ?? [])[1] ?? '0', 10);
  const pov = fen.split(' ')[1] === 'w' ? score : { type: score.type, value: -score.value };
  return { ...pov, depth, pv: engine.lastPv(res), ms: Math.round(performance.now() - t0), go };
}

function queueEval() {
  const st = stateAt(app.line, app.ply);
  if (!st?.fen) return false;
  if (st.probe) {
    setStatus('this board is already probed');
    return false;
  }
  app.probe.queue.push({ kind: 'eval', line: app.line, ply: app.ply, state: st, go: probeGo() });
  void drainProbes();
  return true;
}
function queueDeep(q) {
  if (!q || q.deepDelta) return false;
  const line = app.line;
  const before = stateAt(line, q.ply - 1);
  app.probe.queue.push({ kind: 'deep', line, quake: q, fens: { beforeMove: before?.fen ?? null, pre: q.preFen, post: q.postFen }, go: probeGo() });
  void drainProbes();
  return true;
}

async function drainProbes() {
  if (app.probe.busy) return;
  app.probe.busy = true;
  syncProbeButtons();
  try {
    while (app.probe.queue.length) {
      const job = app.probe.queue[0];
      let engine;
      try {
        engine = await ensureEngine();
      } catch (e) {
        app.probe.queue.length = 0;
        note(`⚠ engine unavailable: ${String(e?.message ?? e).split('\n')[0]}`, 'bad');
        setEngineStatus('engine unavailable');
        break;
      }
      try {
        if (job.kind === 'eval') {
          setEngineStatus(`probing ply ${job.ply} (${job.go})…`);
          const r = await probeEval(engine, job.state.fen, job.go);
          job.state.probe = { ...r, at: Date.now() };
          note(`probe p${job.ply}: ${R.fmtScore(r)} d${r.depth} in ${r.ms} ms  pv ${r.pv.slice(0, 8).join(' ')}`, 'ok');
        } else {
          const out = {};
          const keys = Object.entries(job.fens).filter(([, f]) => f);
          let k = 0;
          for (const [key, fen] of keys) {
            setEngineStatus(`deep Δ ply ${job.quake.ply}: board ${++k}/${keys.length} (${job.go})…`);
            out[key] = await probeEval(engine, fen, job.go);
          }
          job.quake.deepDelta = { go: job.go, pov: 'white', ...out, at: Date.now(), replay: true };
          note(`deep Δ p${job.quake.ply}:${R.threeWay(job.quake.deepDelta, ` ${job.go}`)}`, /LOST|LENGTHENED|FLIPPED/.test(R.deltaWords(out.pre, out.post, 'q')) ? 'warn' : 'ok');
        }
        app.engineFailures = 0;
        app.probe.queue.shift();
        app.probesMade = (app.probesMade ?? 0) + 1;
        setEngineStatus(`engine ready · ${engine.id ?? '?'}`);
      } catch (e) {
        // Rule 12: a dead probe is visible, and the instance is dropped (never
        // quit) so the next job gets a fresh one. Three strikes and we stop.
        app.engineFailures++;
        note(`⚠ probe failed (${String(e?.message ?? e).split('\n')[0]}) — ${app.engineFailures < 3 ? 'reforming the engine' : 'giving up'}`, 'bad');
        try {
          engine.send('stop');
        } catch {
          /* dead */
        }
        app.engine = null;
        if (app.engineFailures >= 3) {
          app.probe.queue.length = 0;
          setEngineStatus('engine gave up');
        }
      }
      // The job's ply may be on screen: refresh readouts (no repaint of the board).
      if (job.line === app.line) {
        app.strips = null; // a probe is a new dot on the eval strip
        paint();
      }
    }
  } finally {
    app.probe.busy = false;
    syncProbeButtons();
  }
}

function syncProbeButtons() {
  const st = app.line ? stateAt(app.line, app.ply) : null;
  const q = app.line ? idx().quakes.get(app.ply) : null;
  $('btnProbe').disabled = !st?.fen || !!st?.probe || app.probe.busy;
  $('btnDeep').disabled = !q || !!q.deepDelta || app.probe.busy;
  $('btnProbePv').disabled = !st?.probe?.pv?.length;
  $('btnProbePv').classList.toggle('on', app.showing?.kind === 'probe-pv');
  const d = document.querySelector('#sec-quake-body button[data-role="deep"]');
  if (d) d.disabled = !q || !!q.deepDelta || app.probe.busy;
  $('probe-queue').textContent = app.probe.queue.length ? `${app.probe.queue.length} queued` : '';
}

// ---------------------------------------------------------------- loading

function validateLog(data) {
  if (!data || typeof data !== 'object') throw new Error('not a JSON object');
  if (typeof data.schema !== 'string' || !data.schema.startsWith('dck-log/')) throw new Error(`not a replay log (schema ${JSON.stringify(data.schema ?? null)})`);
  if (!Array.isArray(data.states) || !data.states.length) throw new Error('the log has no states to scrub');
  if (!data.files || !data.ranks) throw new Error('the log has no board dimensions');
  return data;
}

export async function openLog(data, source = 'object') {
  const L = validateLog(typeof data === 'string' ? JSON.parse(data) : data);
  setStatus('loading…');
  app.log = L;
  app.source = source;
  app.tree = R.lineTree(L);
  app.line = app.tree.main;
  app.ply = 0;
  app.showing = null;
  app.residue = new Map();
  app.probe.queue.length = 0;
  if (L.variantIni && !app.variantInis.has(L.variantIni)) {
    app.variantInis.add(L.variantIni);
    app.engineNeedsIni = !!app.engine;
  }
  await resolveStage(L);
  mountBoard(L.files, L.ranks);
  renderStatic();
  $('probeGo').value = params.get('go') ?? L.go ?? 'depth 22 movetime 10000';
  $('screen-replay').hidden = false;
  $('load-panel').hidden = true;
  $('btnExport').hidden = false;
  $('btnCopyReport').hidden = false;
  document.title = `Replay — ${L.title ?? L.stage ?? 'duel'}`;
  $('title').textContent = `Replay · ${L.result ?? 'unfinished'}`;
  const wantPly = params.get('ply');
  goto(wantPly !== null ? parseInt(wantPly, 10) : 0);
  note(`loaded ${source}: ${L.stage ?? '?'} "${L.title ?? ''}", ${L.plies ?? L.moves?.length ?? '?'} plies, ${L.quakes?.length ?? 0} quakes, ${L.branches?.length ?? 0} undos, ${L.flags?.length ?? 0} flags, build ${L.meta?.app ?? '?'}${app.stageNote ? ` — ${app.stageNote}` : ''}`, app.stageNote ? 'warn' : 'ok');
  setStatus(`${L.plies ?? '?'} plies · ${L.quakes?.length ?? 0} quakes`);
  return L;
}

async function openSlot(slot) {
  const data = logStore.load(slot);
  if (!data) throw new Error(`no saved log in slot ${slot}`);
  return openLog(data, `autosave slot ${slot}`);
}

async function openUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return openLog(await res.json(), url);
}

async function openFile(file) {
  const text = await file.text();
  return openLog(text, file.name);
}

function refreshSavedLogs() {
  const idxs = logStore.index();
  const sel = $('savedLogSel');
  sel.textContent = '';
  for (const e of idxs) {
    const opt = document.createElement('option');
    opt.value = String(e.slot);
    const when = e.at ? new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?';
    const outcome = e.result ? `${e.result} ${e.termination ?? ''}`.trim() : 'unfinished';
    opt.textContent = `${when} · ${e.title ?? e.stage ?? 'duel'} · ${e.plies ?? 0} plies · ${outcome}${e.quakes ? ` · ${e.quakes} quake${e.quakes === 1 ? '' : 's'}` : ''}${e.branches ? ` · ${e.branches} undo${e.branches === 1 ? '' : 's'}` : ''}`;
    sel.appendChild(opt);
  }
  $('saved-row').hidden = idxs.length === 0;
  $('saved-none').hidden = idxs.length !== 0;
}

async function tryOpen(fn, what) {
  try {
    await fn();
  } catch (e) {
    const msg = `could not open ${what}: ${String(e?.message ?? e).split('\n')[0]}`;
    note(`⚠ ${msg}`, 'bad');
    setStatus(msg);
    $('load-panel').hidden = false;
  }
}

// ----------------------------------------------------------------- export

function annotated() {
  const L = app.log;
  if (!L) return null;
  L.meta = { ...(L.meta ?? {}), analyzed: { at: new Date().toISOString(), app: REPLAY_BUILD, probes: app.probesMade ?? 0 } };
  return jsonSafeNumbers(L);
}

async function exportLog(force = null) {
  const data = annotated();
  if (!data) return null;
  const json = JSON.stringify(data);
  const how = await deliverLog(json, { force, filename: logFileName(data), doc: document, nav: navigator });
  const said = { shared: 'log shared', downloaded: 'log downloaded', copied: 'log copied to clipboard', console: 'log dumped to console (nothing else worked)', cancelled: 'export cancelled' }[how] ?? how;
  note(`⎙ ${said} (${logSize(json)})`, how === 'console' ? 'bad' : 'ok');
  setStatus(said);
  return how;
}

function reportText(sections = R.SECTION_NAMES) {
  return app.log ? R.renderReport(app.log, { sections }) : '';
}

async function copyReport() {
  const text = reportText();
  try {
    await navigator.clipboard.writeText(text);
    note(`report copied to clipboard (${(text.length / 1024).toFixed(0)} KB of text)`, 'ok');
    setStatus('report copied');
  } catch {
    console.log(text);
    note('clipboard refused — the report is in the console', 'warn');
  }
}

// ------------------------------------------------------------------ wiring

wireStrip($('strip-gods'), 'gods');
wireStrip($('strip-eval'), 'eval');
for (const b of document.querySelectorAll('.sw-btn')) b.addEventListener('click', () => toggleSeries(b.dataset.series));
$('btnFirst').addEventListener('click', () => goto(0));
$('btnPrev').addEventListener('click', () => step(-1));
$('btnNext').addEventListener('click', () => step(1));
$('btnLast').addEventListener('click', () => goto(app.line?.plies ?? 0));
$('plySlider').addEventListener('input', (e) => goto(parseInt(e.target.value, 10)));
$('btnPrevQuake').addEventListener('click', () => jumpTo(quakePlies(), -1));
$('btnNextQuake').addEventListener('click', () => jumpTo(quakePlies(), 1));
$('btnNextFlag').addEventListener('click', () => jumpTo(flagPlies(), 1) ?? jumpTo(flagPlies(), -1));
$('btnNextUndo').addEventListener('click', () => jumpTo(forkPlies(), 1) ?? jumpTo(forkPlies(), -1));
$('btnLineUp').addEventListener('click', () => leaveBranch());
$('btnProbe').addEventListener('click', () => queueEval());
$('btnDeep').addEventListener('click', () => queueDeep(idx().quakes.get(app.ply)));
$('btnProbePv').addEventListener('click', () => {
  const st = stateAt(app.line, app.ply);
  if (!st?.probe?.pv?.length) return;
  app.showing = app.showing?.kind === 'probe-pv' ? null : { kind: 'probe-pv', pv: st.probe.pv };
  paint();
});
$('btnExport').addEventListener('click', () => void exportLog());
$('btnCopyReport').addEventListener('click', () => void copyReport());
$('btnLoadToggle').addEventListener('click', () => {
  $('load-panel').hidden = !$('load-panel').hidden;
  if (!$('load-panel').hidden) refreshSavedLogs();
});
$('btnSavedOpen').addEventListener('click', () => {
  const slot = parseInt($('savedLogSel').value, 10);
  void tryOpen(() => openSlot(slot), `saved log ${slot}`);
});
$('fileInput').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) void tryOpen(() => openFile(f), f.name);
});
$('btnPasteOpen').addEventListener('click', () => {
  const text = $('pasteBox').value.trim();
  if (!text) return;
  void tryOpen(() => openLog(text, 'pasted JSON'), 'the pasted text');
});
$('btnSampleOpen').addEventListener('click', () => void tryOpen(() => openUrl('samples/dck-log_s77-the-smithy_s1818861954.json'), 'the sample'));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) void tryOpen(() => openFile(f), f.name);
});
document.addEventListener('keydown', (e) => {
  if (!app.log || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'Home') goto(0);
  else if (e.key === 'End') goto(app.line?.plies ?? 0);
  else if (e.key === 'q') jumpTo(quakePlies(), e.shiftKey ? -1 : 1);
  else return;
  e.preventDefault();
});

// ------------------------------------------------------------------- boot

async function boot() {
  refreshSavedLogs();
  if (!window.crossOriginIsolated) note('crossOriginIsolated = false — probes need SharedArrayBuffer; coi-serviceworker fixes this after ONE reload', 'warn');
  const url = params.get('url');
  const slot = params.get('slot');
  if (params.has('sample')) await tryOpen(() => openUrl('samples/dck-log_s77-the-smithy_s1818861954.json'), 'the sample');
  else if (url) await tryOpen(() => openUrl(url), url);
  else if (slot !== null) await tryOpen(() => openSlot(parseInt(slot, 10)), `slot ${slot}`);
  else if (params.has('latest')) {
    const first = logStore.index()[0];
    if (first) await tryOpen(() => openSlot(first.slot), 'the latest saved log');
    else {
      note('no saved logs on this device yet', 'warn');
      setStatus('no saved logs');
    }
  } else setStatus('load a log');
}

// ------------------------------------------------ console / E2E surface

window.__DCK = {
  replay: {
    open: (data, source = 'object') => openLog(data, source),
    openUrl,
    openSlot,
    goto,
    next: () => step(1),
    prev: () => step(-1),
    nextQuake: () => jumpTo(quakePlies(), 1),
    prevQuake: () => jumpTo(quakePlies(), -1),
    enterBranch,
    leaveBranch,
    /** Toggle a board overlay: 'before' | 'protected' | {kind:'pool', index} | {kind:'attempt', index} | {kind:'hint', index} | null. */
    show: (what) => {
      const t = idx().traces.get(app.ply);
      const attempts = (app.line.attempts ?? []).filter((a) => a.ply === app.ply);
      if (what === null) app.showing = null;
      else if (what === 'before') app.showing = { kind: 'before' };
      else if (what === 'protected') app.showing = { kind: 'protected' };
      else if (what?.kind === 'pool') app.showing = { kind: 'pool', key: `pool-${what.index}`, candidates: t.candidates[what.index], rung: t.candidates[what.index].rung };
      else if (what?.kind === 'attempt') app.showing = { kind: 'attempt', key: `attempt-${what.index}`, attempt: attempts[what.index] };
      else if (what?.kind === 'hint') app.showing = { kind: 'hint', key: `hint-${what.index}`, pv: t.inputs.hints[what.index].pv, source: t.inputs.hints[what.index].source };
      paint();
      return app.showing;
    },
    probe: () => queueEval(),
    deep: () => queueDeep(idx().quakes.get(app.ply)),
    /** Toggle a strip series ('pressure' | 'tedium' | 'heat' | 'fun' | 'eval'); returns whether it is now shown. */
    toggleSeries,
    export: (force = null) => exportLog(force),
    report: (sections) => reportText(sections),
    get log() {
      return app.log;
    },
    get tree() {
      return app.tree;
    },
    get view() {
      return {
        line: app.line?.id ?? null,
        lineName: app.line?.name ?? null,
        ply: app.ply,
        plies: app.line?.plies ?? 0,
        fen: app.fenShown ?? null,
        showing: app.showing ? { kind: app.showing.kind, key: app.showing.key ?? null } : null,
        marks: app.marks ?? null,
        godsLine: $('gods-line').textContent,
        plyLine: $('ply-line').textContent,
        evalText: $('eval-text').textContent,
        stage: app.stage?.id ?? null,
        stageNote: app.stageNote,
        skins: app.skins,
        theme: app.boardUI?.theme ?? null,
        engine: $('engine-status').textContent,
        probeBusy: app.probe.busy,
        queued: app.probe.queue.length,
        strips: app.strips
          ? {
              plies: app.strips.data.plies,
              pressure: app.strips.data.pressure.filter((v) => v !== null).length,
              evalPoints: app.strips.data.evalAt.filter((v) => v !== null).length,
              probes: [...app.strips.data.probes.keys()],
              ticks: Object.fromEntries(app.strips.data.ticks),
              readout: readoutAt(app.strips.data, app.ply),
              hidden: [...app.stripHidden],
              drawn: [...document.querySelectorAll('#strips .st-line')].map((e) => [...e.classList].find((c) => c.startsWith('st-') && c !== 'st-line')?.slice(3)),
              labels: [...document.querySelectorAll('#strip-gods .st-label')].map((e) => e.textContent),
              cursorX: parseFloat($('strip-gods').querySelector('.st-cursor')?.getAttribute('x1') ?? 'NaN'),
              width: app.strips.geom.gods?.W ?? null,
            }
          : null,
        cell: (sq) => app.boardUI?.cellClasses(sq) ?? null,
      };
    },
    waitIdle: async () => {
      while (app.probe.busy || app.probe.queue.length) await new Promise((r) => setTimeout(r, 50));
      return true;
    },
    build: REPLAY_BUILD,
  },
  get app() {
    return app;
  },
  ready: null,
};
window.__DCK.ready = boot();

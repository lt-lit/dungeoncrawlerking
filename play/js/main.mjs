// App spine: boot, stage picker + army generator (the proving-grounds setup
// screen), duel driving, win/loss.
//
// Boot order (CLAUDE.md rules 1/7): ffish + engine init in parallel; the fixed
// 60-variant catalog is loaded ONCE into both (variant names are single-use);
// every duel thereafter varies only via FEN. One engine instance serves the
// whole page session (fresh ffish Board + `ucinewgame` per duel; a page
// reload is the recycle path — a session never approaches the ~40-game WASM
// fatigue limit).
//
// Setup flow (slice refresh — replaces the retired arena menu + placement
// screen): pick a stage (the designer-locked stage bed, fetched as one
// manifest bundle) → knobs (per-side army width/composition/archetype/
// anchor, flip, crop, initiative, ONE master seed — army, molding and
// Director streams all derive from it via childSeed) → armygen.dealMatchup
// composes and sanity-checks the duel → preview on the board → Begin.
// The player always holds White and sits at the bottom; "Enemy moves
// first" is the turn field, not a seat swap; the flip toggle mirrors the
// TERRAIN (the both-orientations testing convention), not the view.
//
// Test/debug query params (the E2E driver contract):
//   ?stage=<id>      auto-select that stage (e.g. s07-twin-chambers)
//   &flip=1&ct=&cb=  stage orientation + crop far/near
//   &turn=w|b        initiative (b = enemy moves first)
//   &seed=<n>        the master setup seed
//   &w=&b=           army specs, "width:spec:archetype:anchor" where spec is
//                    b<points> (budget draw) or piece letters (e.g. QRNBN);
//                    trailing parts optional — "6:b30", "5:QRNN:scrambled"
//   &autobegin=1     deal and begin immediately
//   &go=<uci go args>  override engine search (e.g. "depth 22 movetime 80")
//   &probe=<uci go args>  override the hint probe's search (default
//                    "depth 22 movetime 10000"; "Keep evaluating" drops the movetime)
//   &onset=&qramp=&cramp=&debt=&asymonset=&asymramp=&dirseed=
//     override the Director config (see director.mjs DIRECTOR_DEFAULTS)
//   &godsdebug=1     force the Gods debug overlay on (Phase 1.2 instrument)
//   &fx=<scale>      animation speed multiplier; 0 disables motion entirely
//                    (drivers should pass fx=0 — animations gate app.busy)
import { getFfish, createEngine } from './engine.mjs';
import { makeCatalogIni } from './variant.mjs';
import { findSquares, emptyBoard, serializeBoard, isTerrain, WALL, FURNITURE } from './fen.mjs';
import { loadStageV2, flipStageVertical, cropStage, stageSkins, THEMES } from './stage.mjs';
import { dealMatchup, ARMY_MIN_WIDTH, ARMY_MAX_WIDTH } from './armygen.mjs';
import { BoardUI, pickPromotion, PIECE_SETS, DOOR_SETS } from './board-ui.mjs';
import { DuelController } from './duel.mjs';
import { displacementCandidates, crumbleCandidates, lockedPawns, fenGrid, terrainCensus, GOD_PRESETS } from './director.mjs';

const $ = (id) => document.getElementById(id);
const UCI_MOVE_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))(.*)$/; // rank-10 squares are 3 chars (rule 8)
const params = new URLSearchParams(location.search);

// Animation budget. Every duration in this file is multiplied through FX(),
// so `?fx=0` collapses the whole thing to instant (headless drivers want
// that — animations run inside app.busy, so waitIdle() waits them out), and
// the OS reduced-motion setting does the same by default.
const FX_SCALE = (() => {
  const raw = parseFloat(params.get('fx') ?? '');
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 0 : 1;
})();
const FX = (ms) => Math.round(ms * FX_SCALE);
// Stamp the budget on <html> so CSS-timed motion (transitions, keyframes)
// collapses with the JS-timed kind under ?fx=0 (style.css [data-fx="0"]).
document.documentElement.dataset.fx = FX_SCALE === 0 ? '0' : '1';
const wait = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const app = {
  ffish: null,
  engine: null,
  catalog: null, // CUMULATIVE variants ini: the 60-variant catalog + every deal variant this session (spike 14)
  dealVariants: new Set(), // deal-variant names already appended to app.catalog
  cheatArrows: [], // current best-move arrows (cheat mode): {from, to, strength, rank, kind:'hint'}
  // RESIDUE (2026-09-03, cosmetic): floor squares where a door was opened
  // (captured) or a wall/crate broken (breached, captured) — the doorway
  // stays open, the rubble stays, under whatever stands there. Derived by
  // diffing the furniture squares of consecutive paints (so an undo that
  // brings the '^' back clears it); reset per duel.
  residue: { opened: new Set(), rubble: new Set(), lastFen: null },
  quakeMarks: null, // {from, to, pits, cracked, breached, arrows, text} — the gods' residue
  // since the player last moved (several quakes MERGE), held on the board and in
  // the gods line through the enemy's reply and cleared when the player moves
  stages: [], // loadStageV2 outputs from the manifest bundle, picker order
  session: null, // the previewed/live duel: {id, title, files, ranks, variantName, playerColor, enemyColor, deal}
  boardUI: null,
  duel: null,
  selectedSquare: null, // during play: player's selected from-square
  phase: 'boot', // boot | setup | preview | playing | ended | error
  busy: false, // gates input while the engine thinks / animations run
  enginePending: null, // whenQuiet() of an abandoned duel's in-flight search
  duelsOnEngine: 0, // rule 6: recycle the instance well before ~40 games
  godsCensus: null, // last on-demand candidate census {ply, tiers, crumbles, locked, ms}
  godsHeat: null, // {square: tier} heat marks painted from the census
  godsHeatOn: false, // user wants heat; turns itself off when the board changes
};

// ---------------------------------------------------------------- utilities

function setStatus(text) {
  $('status').textContent = text;
}

// The player's bar under the board carries two more lines (index.html):
// the oracle's ranked hints and the gods' last actions. Both survive the
// status line, which the turn loop overwrites the moment a turn resumes.
function setHintLine(text) {
  $('hint-line').textContent = text;
}

function setGodsLine(text) {
  $('gods-line').textContent = text;
}

function setPlayerBarText(text) {
  $('player-bar-text').textContent = text;
}

function log(el, msg, cls) {
  const line = document.createElement('div');
  line.textContent = msg;
  if (cls) line.className = cls;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// -------------------------------------------------- setup model (generator)

const SETUP_KEY = 'dck.setup.v1';
const ARCHETYPES = ['heavies-deep', 'minors-deep', 'scrambled'];
const ANCHORS = ['center', 'left', 'right'];

/** The generator's knobs. ONE master seed drives everything downstream
 *  (armies, molding, Director) via childSeed, so re-entering a seed with
 *  the same knobs reproduces the whole duel, quakes included. Default
 *  budgets hand the player the §13 material edge (~+6). */
const setup = {
  stageId: null,
  flip: false,
  cropTop: 0,
  cropBottom: 0,
  turn: 'w', // initiative: 'b' = the enemy moves first (the player is always White)
  seed: 1,
  white: { width: 6, mode: 'budget', budget: 30, pieces: 'QRRNB', archetype: 'heavies-deep', anchor: 'center' },
  black: { width: 6, mode: 'budget', budget: 24, pieces: 'QRNBN', archetype: 'heavies-deep', anchor: 'center' },
};

function loadSetup() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}');
    for (const k of ['stageId', 'flip', 'cropTop', 'cropBottom', 'turn', 'seed']) {
      if (k in saved) setup[k] = saved[k];
    }
    for (const side of ['white', 'black']) {
      if (saved[side]) for (const k of Object.keys(setup[side])) if (k in saved[side]) setup[side][k] = saved[side][k];
    }
  } catch {
    /* defaults */
  }
}

function saveSetup() {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
  } catch {
    /* QoL only */
  }
}

function currentStage() {
  return app.stages.find((s) => s.id === setup.stageId) ?? null;
}

/** Side knobs → a makeArmy spec, or throw with a human-readable reason. */
function sideSpec(side) {
  const s = setup[side];
  const width = s.width | 0;
  if (width < ARMY_MIN_WIDTH || width > ARMY_MAX_WIDTH) throw new Error(`${side}: width ${width} outside ${ARMY_MIN_WIDTH}–${ARMY_MAX_WIDTH}`);
  if (s.mode === 'pieces') {
    const pieces = [...s.pieces.toUpperCase().replace(/[^NBRQ]/g, '')];
    if (pieces.length !== width - 1) throw new Error(`${side}: ${pieces.length} pieces given, needs ${width - 1} (N/B/R/Q)`);
    return { spec: { width, pieces }, archetype: s.archetype, anchor: s.anchor };
  }
  return { spec: { width, budget: s.budget | 0 }, archetype: s.archetype, anchor: s.anchor };
}

/** Compose + sanity-check the duel the current knobs describe (armygen's
 *  dealMatchup: fit, gap, connectivity, no side in check, not decided at
 *  ply 0). Cheap — grid math + a couple of one-position ffish probes. */
function computeDeal() {
  const stage = currentStage();
  if (!stage) return { ok: false, error: 'pick a stage' };
  try {
    return dealMatchup({
      stage,
      flip: setup.flip,
      cropTop: setup.cropTop | 0,
      cropBottom: setup.cropBottom | 0,
      white: sideSpec('white'),
      black: sideSpec('black'),
      seed: setup.seed | 0 || 1,
      turn: setup.turn === 'b' ? 'b' : 'w',
      ffish: app.ffish,
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function makeSession(deal) {
  const stage = currentStage();
  return {
    id: deal.stage.id, // transform suffixes included (~flipped, ~crop…)
    title: stage?.title ?? deal.stageId,
    files: deal.files,
    ranks: deal.ranks,
    variantName: deal.variantName,
    playerColor: 'white', // the player ALWAYS holds White (designer rule);
    enemyColor: 'black', // initiative is the deal's turn field, not a seat swap
    deal,
    // Knob snapshot at deal time — the export stays truthful even if the
    // setup panel is edited while this duel runs.
    specs: { white: { ...setup.white }, black: { ...setup.black } },
  };
}

// ------------------------------------------------------- options (cheat mode)

const OPT_KEY = 'dck.options.v1';
const options = { cheat: false, hints: false, hintN: 3, hintCont: false, undo: false, evalBar: false, godPreset: 'restless', godCustom: null, godsDebug: false, theme: 'auto', pieces: 'nulltale', doors: 'auto' };

// The Gods (Board State Director) — the preset table lives in director.mjs
// now (ONE copy, shared with ladder-smoke and the god lab; retuned
// 2026-09-01 with per-preset staleness knobs). GOD_KNOBS stays the custom
// dial surface: the classic five, while the staleness knobs ride presets.
const GOD_KNOBS = ['onsetPly', 'rampPlies', 'sate', 'debtCap', 'extraActions'];

function godConfig() {
  if (options.godPreset === 'custom' && options.godCustom) return { ...GOD_PRESETS.restless, ...options.godCustom };
  return GOD_PRESETS[options.godPreset] ?? GOD_PRESETS.restless;
}

function loadOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPT_KEY) ?? '{}');
    for (const k of Object.keys(options)) if (k in saved) options[k] = saved[k];
    if (![1, 2, 3].includes(options.hintN)) options.hintN = 3;
    if (!(options.godPreset in GOD_PRESETS) && options.godPreset !== 'custom') options.godPreset = 'restless';
    if (!['auto', 'classic', ...THEMES].includes(options.theme)) options.theme = 'auto';
    if (!['classic', ...PIECE_SETS].includes(options.pieces)) options.pieces = 'nulltale';
    if (!['auto', ...DOOR_SETS].includes(options.doors)) options.doors = 'auto';
  } catch {
    /* defaults */
  }
}

function saveOptions() {
  try {
    localStorage.setItem(OPT_KEY, JSON.stringify(options));
  } catch {
    /* QoL only */
  }
}

const cheatHints = () => options.cheat && options.hints;
const cheatEval = () => options.cheat && options.evalBar;
const cheatUndo = () => options.cheat && options.undo;
// The Gods debug overlay (Phase 1.2) is a tuning instrument, not a cheat —
// it gates on its own option so it can run without Cheater Mode.
const godsDebug = () => options.godsDebug;

function syncOptionsUI() {
  $('optCheat').checked = options.cheat;
  $('optHints').checked = options.hints;
  $('optHintN').value = String(options.hintN);
  $('optHintCont').checked = !!options.hintCont;
  $('optUndo').checked = options.undo;
  $('optEval').checked = options.evalBar;
  $('cheat-opts').classList.toggle('disabled', !options.cheat);
  $('optGodPreset').value = options.godPreset;
  const cfg = godConfig();
  for (const k of GOD_KNOBS) {
    const el = $(`god_${k}`);
    el.value = Number.isFinite(cfg[k]) ? String(cfg[k]) : '';
    el.disabled = options.godPreset !== 'custom';
  }
  $('god-knobs').classList.toggle('disabled', options.godPreset !== 'custom');
  $('optGodsDebug').checked = options.godsDebug;
  $('optTheme').value = options.theme;
  $('optPieces').value = options.pieces;
  $('optDoors').value = options.doors;
}

/** The door set (board-ui DOOR_SETS): `?doors=` > the Doors option;
 *  'auto' = the theme's own. */
function doorsFor() {
  const pick = params.get('doors') ?? options.doors;
  return DOOR_SETS.includes(pick) ? pick : null;
}

/** The piece-sprite set (board-ui PIECE_SETS): `?pieces=` > the Pieces
 *  option; 'classic' (or anything unknown) is the Unicode glyphs. */
function piecesFor() {
  const pick = params.get('pieces') ?? options.pieces;
  return PIECE_SETS.includes(pick) ? pick : null;
}

/** The art theme the board wears right now (stage.mjs THEMES; the repacked
 *  tilesets in tiles.css): `?theme=` (a feel-check override, never saved) >
 *  the Art-set option > the stage's own `theme`. 'classic' — or a stage
 *  with no theme — is the in-house drawn set (no data-theme). */
function themeFor(stage) {
  const pick = params.get('theme') ?? options.theme;
  if (pick && pick !== 'auto') return THEMES.includes(pick) ? pick : null;
  return stage?.theme ?? null;
}

/** Stamp the current theme on the board and the options legend (the legend
 *  is built from the board's own tile classes, so it follows the art). */
function applyTheme() {
  const theme = themeFor(app.session?.deal?.stage ?? currentStage());
  app.boardUI?.setTheme(theme);
  app.boardUI?.setPieces(piecesFor());
  app.boardUI?.setDoors(doorsFor());
  const legend = document.querySelector('.legend');
  if (legend) {
    if (theme) legend.dataset.theme = theme;
    else delete legend.dataset.theme;
  }
}

function refreshCheatUI() {
  const inDuel = !!app.duel && (app.phase === 'playing' || app.phase === 'ended');
  $('btnUndo').hidden = !(cheatUndo() && inDuel);
  $('btnUndo').disabled =
    app.busy || !app.duel || !app.session || (app.duel.state === 'playing' && app.duel.turnColor() !== app.session.playerColor);
  $('eval-bar').hidden = !(cheatEval() && inDuel);
}

function applyOptions() {
  saveOptions();
  syncOptionsUI();
  refreshCheatUI();
  refreshGodsUI();
  applyTheme();
  if (!cheatHints()) {
    clearHints();
    if (app.duel && (app.phase === 'playing' || app.phase === 'ended')) renderPlayMarks();
  }
  if (app.duel && app.duel.state === 'playing' && !app.busy && app.duel.turnColor() === app.session.playerColor) {
    void runIdleProbes(); // options may have just enabled hints/eval/overlay mid-turn
  }
}

/** Cheat search: one MultiPV probe of the CURRENT position on the player's
 *  turn, feeding the hint arrows, the hint line and/or the eval bar. Runs on
 *  the shared engine while it is otherwise idle; MultiPV is restored to 1
 *  when it settles (and pinned to 1 by the duel before every reply, §2.2).
 *
 *  Since the 2026-09-02 refresh the probe STREAMS: it thinks as long as the
 *  enemy does (`depth 22 movetime 10000`, or the bare depth cap with "Keep
 *  evaluating" — rule 11 is the only limit then), and every `info multipv`
 *  line repaints the arrows, so the first hints land at depth ~8 within a
 *  few hundred ms and sharpen while the player thinks. The hint line shows
 *  the reached depth so a shifting arrow reads as refinement. */
const cheat = { seq: 0, active: null, engine: null, failures: 0, depth: null, paintTimer: null };
const PROBE_GO_DEFAULT = 'depth 22 movetime 10000'; // matched to the enemy's reply (beginDuel)
const PROBE_GO_CONT = 'depth 22'; // "Keep evaluating": ends at the depth cap or on the player's move

function probeGo() {
  return params.get('probe') ?? (options.hintCont ? PROBE_GO_CONT : PROBE_GO_DEFAULT);
}

function clearHints() {
  app.cheatArrows = [];
  cheat.depth = null;
  setHintLine('');
}

/** Stop the running probe. Resolves false when the instance never answered
 *  the stop: a probe still in flight past this fence would hand its
 *  bestmove to the duel's reply listener (two `go`s on one engine — measured:
 *  the second search receives the FIRST search's bestmove), so the instance
 *  is recycled here before anyone searches on it again (rule 12). */
async function cancelCheatSearch() {
  cheat.seq++;
  clearTimeout(cheat.paintTimer);
  cheat.paintTimer = null;
  if (!cheat.active) return true;
  const engine = cheat.engine ?? app.engine;
  try {
    // stop the instance the probe actually RUNS on — after an engine
    // recycle app.engine is a different object, and stopping that one
    // leaves the real search running.
    engine.send('stop');
  } catch {
    /* dead engine */
  }
  // A healthy instance answers `stop` with bestmove within milliseconds; a
  // dead one never does and its promise only settles on the go() timeout.
  // Never block the player's move on that: give the stop a moment to land,
  // then treat the instance as suspect. The stale probe's seq guard makes
  // its late result inert either way.
  const settled = await Promise.race([cheat.active.then(() => true), new Promise((r) => setTimeout(() => r(false), 300))]);
  cheat.active = null;
  cheat.engine = null;
  if (!settled && engine === app.engine) {
    log($('duel-log'), '⚠ hint probe unresponsive — reforming the engine', 'warn');
    await recycleIdleEngine(engine);
  }
  return settled;
}

async function runCheatSearch() {
  if (!app.duel || app.duel.state !== 'playing' || app.busy) return;
  if (!(cheatHints() || cheatEval())) return;
  if (app.duel.turnColor() !== app.session.playerColor) return;
  await cancelCheatSearch();
  // Re-check after the await: the player's move can land in that gap (it
  // sets app.busy BEFORE cancelling probes), and a probe launched past that
  // fence would overlap the duel's reply search — two `go`s on one engine.
  if (!app.duel || app.duel.state !== 'playing' || app.busy) return;
  if (app.duel.turnColor() !== app.session.playerColor) return;
  const duel = app.duel;
  const engine = app.engine;
  const mySeq = ++cheat.seq;
  const n = cheatHints() ? options.hintN : 1;
  const go = probeGo();
  const mt = go.match(/movetime (\d+)/);
  // Timeout matched to the search (movetime + 4 s) so a doomed probe fails
  // before the player has moved on; an untimed search ends at the depth cap
  // on its own (or on the player's move), so it gets a long leash.
  const timeout = mt ? parseInt(mt[1], 10) + 4000 : 600000;
  // The streaming reader paints only depth-COMPLETE sets. Stockfish emits
  // multipv 1..n per completed depth, so a rank-1 line at a NEW depth means
  // every rank that exists has reported the previous depth: paint that set
  // (one iteration behind the newest, and never a rank-3 label from depth
  // 11 beside a rank-1 label from depth 12). A short debounce covers the
  // last depth of a search that ends without a further rank-1 line.
  const live = new Map();
  const paint = (set) => {
    cheat.paintTimer = null;
    if (mySeq !== cheat.seq || app.duel !== duel || duel.state !== 'playing' || app.busy) return;
    if (!set.size) return;
    cheat.depth = set.get(1)?.depth ?? cheat.depth;
    applyHintLines([...set.values()], n, duel, true);
  };
  const onLine = (line) => {
    if (mySeq !== cheat.seq) return;
    const pv = parseInfoLine(line);
    if (!pv) return;
    clearTimeout(cheat.paintTimer);
    if (pv.rank === 1 && live.has(1) && pv.depth > live.get(1).depth) paint(new Map(live));
    live.set(pv.rank, pv);
    const snapshot = live;
    cheat.paintTimer = setTimeout(() => paint(new Map(snapshot)), 150);
  };
  let p;
  try {
    engine.setoption('MultiPV', String(n));
    engine.position({ fen: duel.baseFen, moves: duel.movesSinceBase });
    p = engine.go(go, { timeout, onLine }).finally(() => {
      try {
        engine.setoption('MultiPV', '1');
      } catch {
        /* dead engine */
      }
    });
  } catch (e) {
    await cheatProbeFailed(engine, e); // postMessage threw — instance is gone
    return;
  }
  cheat.active = p.catch(() => {});
  cheat.engine = engine;
  let res;
  try {
    res = await p;
  } catch (e) {
    // A probe failure used to be silent AND unrecoverable: the duel's ladder
    // only fires when the duel's OWN search fails, so an instance that dies
    // while idle on the player's turn left hints dead for the rest of the
    // duel with nothing on screen to say why.
    if (mySeq === cheat.seq) await cheatProbeFailed(engine, e);
    return;
  }
  clearTimeout(cheat.paintTimer);
  cheat.paintTimer = null;
  cheat.failures = 0;
  if (mySeq !== cheat.seq || app.duel !== duel || duel.state !== 'playing') return; // stale
  cheat.active = null;
  cheat.engine = null;
  const pvs = parseMultiPv(res.infoLines, n);
  if (!pvs.length) return;
  applyHintLines(pvs, n, duel, false);
}

/** Paint one set of MultiPV lines: the eval bar (rank 1) and, with hints
 *  on, rank-coloured arrows + the hint line ("1 Nf3 · 2 e4 · 3 d4 · d14").
 *  `partial` marks a mid-search paint (the depth readout says so). */
function applyHintLines(pvs, n, duel, partial) {
  const sorted = [...pvs].filter((pv) => pv.rank <= n).sort((a, b) => a.rank - b.rank);
  if (!sorted.length || sorted[0].rank !== 1) return;
  if (cheatEval()) updateEvalBar(sorted[0].score, app.session.playerColor);
  if (!cheatHints()) return;
  // Arrow strength scales with how close each move is to the best one
  // (lichess-style): equal → full size, 300cp worse → minimum size. COLOUR
  // carries the rank (board-ui.mjs setArrows), so equal-eval moves still
  // read apart.
  const cpOf = (s) => (!s ? 0 : s.type === 'mate' ? (s.value > 0 ? 10000 - s.value : -10000 - s.value) : s.value);
  const best = cpOf(sorted[0].score);
  const arrows = [];
  const sans = [];
  for (const pv of sorted) {
    const m = pv.move.match(UCI_MOVE_RE);
    if (!m) continue;
    const strength = Math.max(0.2, Math.min(1, 1 - (best - cpOf(pv.score)) / 300));
    arrows.push({ from: m[1], to: m[2], strength, rank: pv.rank, kind: 'hint', label: pv.score ? fmtScore(pv.score) : null });
    let san = pv.move;
    try {
      san = duel.board.sanMove(pv.move);
    } catch {
      /* keep uci */
    }
    sans.push(`${pv.rank} ${san}`);
  }
  app.cheatArrows = arrows;
  renderPlayMarks();
  const depth = sorted[0].depth ?? cheat.depth;
  if (depth) cheat.depth = depth;
  setHintLine(`${sans.join(' · ')}${depth ? ` · d${depth}${partial ? '…' : ''}` : ''}`);
}

/** Replace a dead idle-window engine instance and rebind the live duel
 *  (never quit() — rule 6). Shared by the cheat and eval-delta probes;
 *  safe because probes only run on the player's turn with the engine
 *  otherwise idle. Returns whether a healthy instance is in place. */
async function recycleIdleEngine(deadEngine) {
  if (app.engine !== deadEngine) return true; // someone already replaced it
  try {
    const fresh = await createEngine();
    await fresh.loadVariantsIni(app.catalog);
    app.engine = fresh;
    app.duelsOnEngine = 1;
    app.enginePending = null;
    if (app.duel && app.duel.state === 'playing') {
      app.duel.engine = fresh;
      fresh.send('ucinewgame');
      fresh.setoption('UCI_Variant', app.session.variantName);
      await fresh.isready();
    }
    return true;
  } catch {
    return false;
  }
}

/** A hint probe failed. Say so on screen (silence here is what made this
 *  undiagnosable), and recycle the engine so hints come back — the duel's own
 *  ladder can't help, it only fires on the duel's searches. */
async function cheatProbeFailed(deadEngine, err) {
  cheat.active = null;
  cheat.engine = null;
  cheat.failures++;
  clearHints();
  if (app.duel && app.phase === 'playing') renderPlayMarks();
  if (cheat.failures > 3) {
    setHintLine('hints unavailable');
    return; // stop thrashing the engine if recycling is not helping
  }
  log($('duel-log'), `⚠ hint probe failed (${String(err?.message ?? err).split('\n')[0]}) — reforming`, 'warn');
  if (!(await recycleIdleEngine(deadEngine))) {
    setHintLine('hints unavailable');
    return;
  }
  if (app.duel && app.duel.state === 'playing' && app.duel.turnColor() === app.session.playerColor && !app.busy) {
    void runCheatSearch();
  }
}

// ------------------------------------------------ eval delta probe (Phase 1.2)

/** Eval delta per quake — the ground-truth "did the arena change who's
 *  winning" (§10). Two short searches of the quake's pre/post FENs, run in
 *  the player's idle window on the shared engine (the duel searches only on
 *  the enemy's turn; runIdleProbes sequences this with the cheat probe so a
 *  single `go` is ever in flight). Both FENs have the same side to move —
 *  quakes never flip the turn — and scores are normalized to WHITE POV.
 *
 *  Rule 12: this is a new long-lived auxiliary search path, so it carries
 *  its OWN staleness seq, visible failure, capped recycle — the duel's
 *  stall ladder never fires for probes. */
const evalProbe = { seq: 0, active: null, engine: null, failures: 0, queue: [] };

const EVAL_PROBE_GO = 'depth 12 movetime 300'; // paired limits (rule 5); shallow is fine for a delta readout
const EVAL_PROBE_TIMEOUT = 4300; // movetime + 4 s: a doomed probe fails before the player moves on

async function cancelEvalProbe() {
  evalProbe.seq++;
  if (evalProbe.active) {
    try {
      (evalProbe.engine ?? app.engine).send('stop'); // stop the instance it RUNS on
    } catch {
      /* dead engine */
    }
    await Promise.race([evalProbe.active, new Promise((r) => setTimeout(r, 300))]);
    evalProbe.active = null;
    evalProbe.engine = null;
  }
}

/** Everything that may hold the idle engine — call before the player's move
 *  lands or the duel is abandoned. */
async function cancelIdleProbes() {
  await Promise.all([cancelCheatSearch(), cancelEvalProbe()]);
}

/** The player's-turn idle window: eval-delta probes first (they carry data
 *  the overlay records), then the cheat probe. Strictly sequenced, and
 *  NON-REENTRANT: driveTurn and applyOptions can both fire this in the same
 *  window, and two flights would put two `go` commands on one engine. */
let idleProbesFlight = null;
function runIdleProbes() {
  if (idleProbesFlight) return idleProbesFlight;
  idleProbesFlight = (async () => {
    try {
      await runEvalProbes();
      await runCheatSearch();
    } finally {
      idleProbesFlight = null;
    }
  })();
  return idleProbesFlight;
}

/** One WHITE-POV eval of a bare FEN (mover-POV score negated for black). */
async function probeEval(engine, fen) {
  engine.position({ fen });
  const res = await engine.go(EVAL_PROBE_GO, { timeout: EVAL_PROBE_TIMEOUT });
  const score = engine.lastScore(res);
  if (!score) throw new Error('eval probe returned no score');
  return fen.split(' ')[1] === 'w' ? score : { type: score.type, value: -score.value };
}

const scoreSign = (s) => (s.value > 0 ? 1 : s.value < 0 ? -1 : 0);

async function runEvalProbes() {
  if (evalProbe.active) return; // a drain is already mid-probe — never overlap `go`s
  while (evalProbe.queue.length) {
    const duel = app.duel;
    if (!duel || duel.state !== 'playing') {
      evalProbe.queue.length = 0;
      return;
    }
    if (duel.turnColor() !== app.session.playerColor || app.busy) return; // window closed — resume next turn
    const job = evalProbe.queue[0];
    if (job.duel !== duel) {
      evalProbe.queue.shift(); // stale job from an abandoned duel
      continue;
    }
    // An escaped cheat-probe retry could still hold the engine (it runs
    // outside the flight); a search under its MultiPV≠1 would also hand
    // lastScore the WORST pv's score. Quiet it and pin MultiPV before probing.
    if (cheat.active) await cancelCheatSearch();
    const mySeq = ++evalProbe.seq;
    const engine = app.engine;
    evalProbe.engine = engine;
    try {
      engine.setoption('MultiPV', '1');
    } catch (e) {
      // postMessage threw — the idle instance is gone. Without this guard
      // the whole idle-probes flight rejected unhandled: no visible
      // failure, no recycle, and the queued jobs re-threw every turn (the
      // exact silent-dead-probe mode rule 12 exists to prevent).
      evalProbe.engine = null;
      await evalProbeFailed(engine, e);
      return;
    }
    let before;
    let after;
    const run = (async () => {
      before = await probeEval(engine, job.preFen);
      if (mySeq !== evalProbe.seq) return;
      after = await probeEval(engine, job.postFen);
    })();
    evalProbe.active = run.catch(() => {});
    try {
      await run;
    } catch (e) {
      if (mySeq === evalProbe.seq) {
        evalProbe.active = null;
        evalProbe.engine = null;
        await evalProbeFailed(engine, e);
      }
      return;
    }
    if (mySeq !== evalProbe.seq) return; // cancelled mid-probe; the job stays queued
    evalProbe.active = null;
    evalProbe.engine = null;
    if (!after) return;
    evalProbe.failures = 0;
    evalProbe.queue.shift();
    // Attaching to the record.quakes entry itself: the ledger stays the one
    // source the overlay, the export, and E2E all read.
    job.ev.evalDelta = { before, after, pov: 'white', flipped: scoreSign(before) !== scoreSign(after) };
    appendGodsDelta(job.ev);
    renderGodsSummary();
  }
}

/** An eval probe failed — make it visible and recover (rule 12), with a cap
 *  so a truly dead path stops thrashing the engine. */
async function evalProbeFailed(deadEngine, err) {
  evalProbe.failures++;
  if (evalProbe.failures > 3) {
    log($('duel-log'), '⚠ eval-delta probe unavailable (repeated failures) — deltas stop here', 'warn');
    evalProbe.queue.length = 0;
    return;
  }
  log($('duel-log'), `⚠ eval probe failed (${String(err?.message ?? err).split('\n')[0]}) — reforming`, 'warn');
  await recycleIdleEngine(deadEngine);
  // No immediate retry: this runs INSIDE the idle-probes flight, so a retry
  // would just re-enter it. The queued jobs resume on the next player turn.
}

/** One `info … multipv R … depth D … score … pv M` line → {rank, move,
 *  score, depth}, or null for any other engine line. */
function parseInfoLine(line) {
  if (!line.startsWith('info')) return null;
  const pv = line.match(/ pv (\S+)/);
  if (!pv) return null;
  const s = line.match(/score (cp|mate) (-?\d+)/);
  const r = line.match(/multipv (\d+)/);
  const d = line.match(/ depth (\d+)/);
  return { rank: r ? parseInt(r[1], 10) : 1, move: pv[1], score: s ? { type: s[1], value: parseInt(s[2], 10) } : null, depth: d ? parseInt(d[1], 10) : null };
}

/** Last (deepest) info line per multipv rank → [{rank, move, score, depth}]. */
function parseMultiPv(infoLines, n) {
  const byRank = new Map();
  for (const line of infoLines) {
    const pv = parseInfoLine(line);
    if (!pv || pv.rank > n) continue;
    byRank.set(pv.rank, pv);
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank);
}

/** score is from povColor's point of view; the bar renders player-POV. */
function updateEvalBar(score, povColor) {
  if (!score || !app.session) return;
  const pov = povColor === app.session.playerColor ? score : { type: score.type, value: -score.value };
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
  $('eval-text').textContent = text;
}

/** Undo (cheat mode): rewind to the player's previous turn — works from a
 *  loss screen too, that being rather the point. */
async function doUndo() {
  if (!cheatUndo() || !app.duel || app.busy) return;
  const duel = app.duel;
  if (duel.state === 'playing' && duel.turnColor() !== app.session.playerColor) return;
  app.busy = true;
  await cancelIdleProbes();
  evalProbe.queue.length = 0; // queued jobs belong to the abandoned timeline
  const did = duel.undoToTurn(app.session.playerColor === 'white' ? 'w' : 'b');
  app.busy = false;
  if (!did) {
    setStatus('nothing to undo');
    return;
  }
  $('overlay').hidden = true;
  app.phase = 'playing';
  app.selectedSquare = null;
  clearHints();
  app.quakeMarks = null; // the rewound timeline's quake never happened
  setGodsLine('');
  app.godsCensus = null;
  godsHeatOff();
  renderGodsCensus();
  rerenderGodsTrace(); // ledger was truncated — re-derive the panel from it
  refreshGodsUI();
  paintBoard(duel.fen());
  renderPlayMarks();
  log($('duel-log'), `↩ took back to ply ${duel.ply}`, 'warn');
  await driveTurn();
}

// ------------------------------------------ the Gods debug overlay (Phase 1.2)
//
// The Director's tuning instrument (§10): per-ply roll trace with reason
// codes, candidate census + board heat, RNG-free probability readouts, a
// nominal forecast, live dials, and the eval delta above. Everything renders
// from duel.record (+ the pure Director getters) — the overlay never rolls,
// never re-enumerates on its own, and never touches the seeded stream. The
// one expensive act, the on-demand census, is an explicit button press
// (rule 14: director-scale enumeration is 300–720 ms and synchronous).

const pctOf = (x) => (x >= 1 ? '100%' : x <= 0 ? '0%' : x < 0.095 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);

function fmtScore(s) {
  return s.type === 'mate' ? (s.value > 0 ? `M${s.value}` : `−M${-s.value}`) : (s.value >= 0 ? '+' : '') + (s.value / 100).toFixed(1);
}

function refreshGodsUI() {
  const inDuel = !!app.duel && (app.phase === 'playing' || app.phase === 'ended');
  const show = godsDebug() && inDuel;
  $('gods-debug').hidden = !show;
  if (show) renderGodsSummary();
}

function countFreeSquares(fen, files, ranks) {
  let n = 0;
  for (const row of fenGrid(fen, files, ranks)) for (const c of row) if (c === null) n++;
  return n;
}

function renderGodsSummary() {
  const duel = app.duel;
  if (!duel || !duel.board) return;
  const dir = duel.director;
  const nextPly = duel.ply + 1;
  // The two meters, which are the whole trigger now (v3). "fun" is the
  // position read — 100% means everything is possible here, 0% means nothing
  // is — and it sets how fast restlessness climbs.
  const stale = dir.lastStaleness;
  const funBit = stale ? `fun ${pctOf(stale.fun)} (${stale.moves} moves, ${stale.captures} captures, ${stale.lockedPawns}/${stale.pawns} pawns locked)` : 'fun —';
  $('gods-meters').textContent =
    `${funBit} · restlessness ${dir.meter.value.toFixed(1)}/${dir.meter.rampPlies} → ` +
    `pressure ${pctOf(dir.pressure(nextPly))}${dir.meter.floor(nextPly) > dir.meter.p() ? ' (BACKSTOP floor)' : ''}`;

  const held = dir.holdInCheck && dir.lastTrace?.held ? ' · HELD (king in check)' : '';
  $('gods-summary').textContent =
    `next roll p${nextPly}: P(quake) ${pctOf(dir.pQuake(nextPly))} · ` +
    `budget ${1 + Math.floor(dir.pressure(nextPly) * dir.extraActions)} action(s) · ` +
    `debt ${dir.debt}/${dir.debtCap} · intensity ${dir.favor.toFixed(1)}${held}`;

  // The ladder, as it stands right now — rung weights are a pure function of
  // pressure and the terrain census, so showing them costs nothing.
  const terrain = terrainCensus(duel.fen(), duel.files, duel.ranks, dir.holes);
  const w = dir.rungWeights(nextPly, terrain);
  const total = w.weaken + w.breach + w.displace + w.crumble;
  const share = (x) => (total > 0 ? pctOf(x / total) : '—');
  const rungBit = dir.debt >= dir.debtCap
    ? 'CRUMBLE FORCED (debt cap)'
    : `weaken ${share(w.weaken)} · breach ${share(w.breach)} · displace ${share(w.displace)} · crumble ${share(w.crumble)}`;
  const free = countFreeSquares(duel.fen(), duel.files, duel.ranks);
  const f = dir.forecast(duel.ply);
  const p = (v) => (v === null ? 'beyond horizon' : `~p${v}`);
  $('gods-forecast').textContent =
    `ladder: ${rungBit}\n` +
    `terrain: ${terrain.walls} walls · ${terrain.crates} crates · ${terrain.holes} holes · ${free} free\n` +
    `forecast (at HELD pressure — the meter moves every ply): next quake ${p(f.nextQuake)} · next hole ${p(f.nextHole)}`;
}

function godsTraceCls(t) {
  if (t.outcome === 'quiet') return 'quiet';
  if (t.outcome === 'crumble' || t.outcome === 'terminal' || t.vetoed) return 'warn';
  if (t.outcome === 'starved') return 'bad';
  return 'ok'; // weaken / breach / displace
}

/** One compact line per roll trace — the per-ply record, reason codes and all. */
function godsTraceLine(t) {
  const meterBit = `meter ${t.meter?.toFixed(1) ?? '?'} · stale ${t.staleness === null || t.staleness === undefined ? '?' : pctOf(t.staleness)}`;
  if (t.outcome === 'quiet') {
    if (t.held) return `p${t.ply} · HELD — a king is in check, the gods sit it out`;
    const r = t.rolls.find((x) => x.roll === 'quake');
    return `p${t.ply} · ${meterBit} · P(q) ${pctOf(t.p.quake)}${r ? ` roll ${r.value.toFixed(2)} — quiet` : ' — before onset'}`;
  }
  const bits = [`p${t.ply} QUAKE`, meterBit];
  if (t.p.crumbleForced) bits.push('crumble FORCED (debt cap)');
  // The budget is the headline now: what makes a quake unreadable is that the
  // number and kind of actions vary, so the trace shows both.
  const spent = t.rungsSpent ?? [];
  bits.push(`budget ${spent.length}/${t.budget ?? '?'} → ${spent.join(' + ') || 'nothing'}`);
  if (t.rungFallback?.length) bits.push(`fell back: ${t.rungFallback.join(', ')}`);

  const c = t.census;
  if (c?.displacement) {
    const s = (x) => `${x.white}w/${x.black}b`;
    bits.push(`cand A ${s(c.displacement.A)} B ${s(c.displacement.B)} C ${s(c.displacement.C)}`);
  }
  if (c && c.lockedPawns > 0) bits.push(`locked pawns ${c.lockedPawns}`);

  for (const ter of t.chosen?.terrain ?? []) {
    bits.push(
      ter.kind === 'weaken'
        ? `WEAKEN ${ter.square} — a wall cracks into furniture`
        : `BREACH ${ter.square} — the crate is smashed open${ter.freed > 0 ? `, frees ${ter.freed} locked pawn${ter.freed === 1 ? '' : 's'}` : ''}`
    );
  }
  for (const d of t.chosen?.displacements ?? []) bits.push(`displace ${d.piece} ${d.from}→${d.to} [${d.tier}]`);
  const cr = t.chosen?.crumble;
  if (cr) {
    const pool = c?.crumble ? c.crumble.neutral + c.crumble.terminal : '?';
    bits.push(
      `${t.outcome === 'terminal' ? 'TERMINAL ' : ''}HOLE at ${cr.square}` +
        `${cr.pieceLost && !isTerrain(cr.pieceLost) ? ` swallows ${cr.pieceLost}` : ''} of ${pool} — permanent`
    );
  }
  if (t.outcome === 'starved') bits.push('STARVED — no legal candidate on any rung');
  if (t.vetoed) bits.push(`VETOED by duel layer: ${t.vetoed}`);
  return bits.join(' · ');
}

function appendGodsTrace(t) {
  if (!godsDebug()) return;
  log($('gods-trace'), godsTraceLine(t), godsTraceCls(t));
}

function appendGodsDelta(ev) {
  if (!godsDebug() || !ev.evalDelta) return;
  const d = ev.evalDelta;
  log(
    $('gods-trace'),
    `p${ev.ply} Δeval (white POV) ${fmtScore(d.before)} → ${fmtScore(d.after)}${d.flipped ? ' — FLIP: the quake changed who is winning' : ''}`,
    d.flipped ? 'bad' : 'ok'
  );
}

/** Rebuild the whole trace log from the record — undo truncates the ledger,
 *  so the DOM re-derives from it rather than trying to unpick lines. */
function rerenderGodsTrace() {
  const el = $('gods-trace');
  el.textContent = '';
  if (!app.duel) return;
  const deltaByPly = new Map();
  for (const ev of app.duel.record.quakes) if (ev.evalDelta) deltaByPly.set(ev.ply, ev);
  for (const t of app.duel.record.quakeTraces) {
    log(el, godsTraceLine(t), godsTraceCls(t));
    if (deltaByPly.has(t.ply)) appendGodsDelta(deltaByPly.get(t.ply));
  }
}

/** Full candidate census of the CURRENT position — the one deliberately
 *  expensive overlay act (a quake-scale enumeration, rule 14), so it only
 *  ever runs from an explicit button press or the __DCK test hook. */
function computeGodsCensus() {
  const d = app.duel;
  if (!d || !d.board) return null;
  const t0 = performance.now();
  const fen = d.fen();
  const tiers = displacementCandidates(app.ffish, d.variantName, fen, d.files, d.ranks);
  const crumbles = crumbleCandidates(app.ffish, d.variantName, fen, d.files, d.ranks);
  const locked = lockedPawns(fen, d.files, d.ranks);
  return { ply: d.ply, tiers, crumbles, locked, ms: Math.round(performance.now() - t0) };
}

function renderGodsCensus() {
  const c = app.godsCensus;
  const el = $('gods-census');
  if (!c) {
    el.textContent = '';
    return;
  }
  const side = (arr) => `${arr.filter((x) => x.white).length}w/${arr.filter((x) => !x.white).length}b`;
  // unsafe_landing per side is the number the 1.3 starvation analysis reads.
  const unsafe = c.tiers.rejected.filter((r) => r.reason === 'unsafe_landing');
  el.textContent =
    `census @p${c.ply} (${c.ms} ms): displace A ${side(c.tiers.A)} · B ${side(c.tiers.B)} · C ${side(c.tiers.C)}` +
    ` · vetoed ${c.tiers.rejected.length} (unsafe ${side(unsafe)})` +
    ` | crumble ok ${c.crumbles.neutral.length} · terminal ${c.crumbles.terminal.length} · vetoed ${c.crumbles.rejected.length}` +
    ` | locked pawns ${c.locked.length}`;
}

/** Heat map from a census: displacement landings by tier (A > B > C on
 *  collisions), terminal crumbles marked 't'. */
function buildHeat(c) {
  const heat = {};
  for (const t of c.crumbles.terminal) heat[t.sq] = 't';
  for (const [cls, arr] of [['c', c.tiers.C], ['b', c.tiers.B], ['a', c.tiers.A]]) {
    for (const cand of arr) heat[cand.to] = cls;
  }
  return heat;
}

function syncHeatButton() {
  $('btnGodsHeat').textContent = app.godsHeatOn ? 'heat: on' : 'heat: off';
  $('btnGodsHeat').classList.toggle('on', app.godsHeatOn);
}

/** The census describes ONE position; any move or quake invalidates it, and
 *  heat switches itself off rather than silently re-enumerating (rule 14). */
function godsHeatOff() {
  if (!app.godsHeatOn && !app.godsHeat) return;
  app.godsHeatOn = false;
  app.godsHeat = null;
  syncHeatButton();
}

let censusPending = false;

function godsCensusNow() {
  const duel = app.duel;
  if (!duel || duel.state !== 'playing' || censusPending) return;
  if (app.busy || duel.turnColor() !== app.session.playerColor) {
    setStatus('census: wait for your turn');
    return;
  }
  censusPending = true; // a double-tap must not queue two 300–720 ms freezes
  setStatus('reading the gods…'); // paint first — the enumeration blocks the thread
  setTimeout(() => {
    censusPending = false;
    if (app.duel !== duel || duel.state !== 'playing' || app.busy) return;
    if (duel.turnColor() !== app.session.playerColor) return; // turn moved on in the gap
    app.godsCensus = computeGodsCensus();
    renderGodsCensus();
    if (app.godsHeatOn && app.godsCensus) {
      app.godsHeat = buildHeat(app.godsCensus);
      renderPlayMarks();
    }
    setStatus('your move');
  }, 30);
}

/** JSON.stringify turns Infinity into null, which silently corrupts an
 *  exported config (the 'off' preset is onsetPly: Infinity — a replay
 *  built from null ramps quakes from ply 0 in a duel that had the gods
 *  OFF). Export non-finite numbers as strings; Number('Infinity') revives
 *  them exactly, so consumers map values through Number() and lose
 *  nothing. */
function jsonSafeNumbers(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (Array.isArray(v)) return v.map(jsonSafeNumbers);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafeNumbers(x)]));
  return v;
}

/** Everything a replay or offline analysis needs, from the one ledger. */
function godsExportData() {
  const d = app.duel;
  if (!d) return null;
  const dir = d.director;
  const deal = app.session?.deal;
  return {
    // Full deal provenance: (stage, flip, crop, specs, setupSeed) + the
    // Director seed below reconstruct the entire session, quakes included.
    stage: deal?.stageId ?? null,
    stageTransformed: app.session?.id ?? null,
    flip: deal?.flip ?? false,
    crop: deal ? { top: deal.cropTop, bottom: deal.cropBottom } : null,
    turn: deal?.turn ?? 'w',
    setupSeed: deal?.seed ?? null,
    dealAttempt: deal?.attempt ?? null,
    armies: deal
      ? {
          white: { ...deal.white.army, archetype: app.session.specs.white.archetype, anchor: app.session.specs.white.anchor },
          black: { ...deal.black.army, archetype: app.session.specs.black.archetype, anchor: app.session.specs.black.anchor },
        }
      : null,
    variant: d.variantName,
    startFen: d.startFen,
    seed: dir.seed,
    config0: jsonSafeNumbers(dir.config0), // starting config — what a replay constructs with
    config: jsonSafeNumbers({
      // live config at export time (tunes applied); the tunes ledger maps
      // one to the other, undo markers included
      onsetPly: dir.onsetPly,
      rampPlies: dir.meter.rampPlies,
      sate: dir.meter.sate,
      debtCap: dir.debtCap,
      extraActions: dir.extraActions,
    }),
    favor: dir.favor,
    tunes: jsonSafeNumbers(d.record.tunes),
    moves: d.record.moves,
    sans: d.record.sans,
    quakes: d.record.quakes.map(({ trace, ...rest }) => rest), // traces carried once, below
    quakeTraces: d.record.quakeTraces,
    anomalies: d.record.anomalies,
    result: d.record.result,
    termination: d.record.termination,
  };
}

/** Per-ply hook from the duel (fire-and-forget): every Director roll lands
 *  here, quake or quiet. */
function onDirectorTrace(trace) {
  if (!godsDebug()) return;
  appendGodsTrace(trace);
  renderGodsSummary();
}

// ---------------------------------------------------------------------- boot

async function boot() {
  const bootLog = $('boot-log');
  if (!window.crossOriginIsolated) {
    log(bootLog, 'crossOriginIsolated = false — SharedArrayBuffer unavailable. coi-serviceworker fixes this after ONE reload; if it persists, serve over https or localhost.', 'bad');
  }
  setStatus('summoning the engine…');
  try {
    const catalog = makeCatalogIni();
    const [ffish, engine] = await Promise.all([getFfish(), createEngine()]);
    app.ffish = ffish;
    app.engine = engine;
    app.catalog = catalog;
    ffish.loadVariantConfig(catalog);
    await engine.loadVariantsIni(catalog);
    log(bootLog, 'engine + rules ready (60-variant catalog loaded)', 'ok');
  } catch (e) {
    setStatus('boot failed');
    log(bootLog, 'BOOT FAILED: ' + (e && e.message ? e.message : e), 'bad');
    log(bootLog, 'If SharedArrayBuffer is the error: the page must be cross-origin isolated (see note above).', 'bad');
    app.phase = 'error';
    return;
  }

  setStatus('loading stages…');
  try {
    const res = await fetch('stages/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    app.stages = manifest.stages.map((json) => loadStageV2(json));
    log(bootLog, `${app.stages.length} stages loaded`, 'ok');
  } catch (e) {
    setStatus('boot failed');
    log(bootLog, `stage manifest failed to load: ${e.message} — regenerate with phase0/harness/gen-stage-manifest.mjs`, 'bad');
    app.phase = 'error';
    return;
  }
  applySetupParams();
  renderStageList();
  renderSidePanels();
  syncStagePicker();
  app.phase = 'setup';
  setStatus('pick a stage');

  const wantedStage = params.get('stage');
  if (wantedStage) {
    // A typo'd ?stage= must FAIL, not silently open the saved stage — a
    // driver would measure the wrong terrain without noticing.
    if (!app.stages.some((s) => s.id === wantedStage)) {
      setStatus(`unknown stage ${wantedStage}`);
      return;
    }
    openStagePreview(); // straight into the live preview
    if (params.get('autobegin')) {
      if (app.session) await beginDuel();
      else setStatus(`auto-deal failed: ${$('setup-readout').textContent}`);
    }
  }
}

// ------------------------------------------------- the setup screen (§4.2/§4.3)

/** URL params → setup knobs (the E2E driver contract; see the header). */
function applySetupParams() {
  const stage = params.get('stage');
  if (stage && app.stages.some((s) => s.id === stage)) setup.stageId = stage;
  if (!currentStage()) setup.stageId = null; // saved id no longer in the set
  if (params.get('flip') !== null) setup.flip = params.get('flip') === '1';
  if (params.get('ct') !== null) setup.cropTop = intParam('ct', setup.cropTop, 0);
  if (params.get('cb') !== null) setup.cropBottom = intParam('cb', setup.cropBottom, 0);
  const turn = params.get('turn');
  if (turn === 'w' || turn === 'b') setup.turn = turn;
  setup.seed = intParam('seed', setup.seed, 1);
  for (const [p, side] of [['w', 'white'], ['b', 'black']]) {
    const raw = params.get(p);
    if (!raw) continue;
    // "width:spec:archetype:anchor" — spec is b<points> or piece letters.
    const [w, spec, archetype, anchor] = raw.split(':');
    const s = setup[side];
    const width = parseInt(w, 10);
    if (width >= ARMY_MIN_WIDTH && width <= ARMY_MAX_WIDTH) s.width = width;
    if (spec) {
      const budget = spec.match(/^b(\d+)$/i);
      if (budget) {
        s.mode = 'budget';
        s.budget = parseInt(budget[1], 10);
      } else if (/^[NBRQnbrq]+$/.test(spec)) {
        s.mode = 'pieces';
        s.pieces = spec.toUpperCase();
      }
    }
    if (ARCHETYPES.includes(archetype)) s.archetype = archetype;
    if (ANCHORS.includes(anchor)) s.anchor = anchor;
  }
}

/** Tiny terrain thumbnail: the ASCII map as it is authored (far rank on
 *  top). Stone solid, furniture the board's own crate glyph, floor a dot. */
function stageMiniMap(stage) {
  const rows = [];
  for (let r = stage.ranks - 1; r >= 0; r--) {
    rows.push(stage.grid[r].map((c) => (c === WALL ? '█' : c === FURNITURE ? '▦' : '·')).join(''));
  }
  return rows.join('\n');
}

function renderStageList() {
  const list = $('stage-list');
  list.textContent = '';
  for (const stage of app.stages) {
    const card = document.createElement('button');
    card.className = 'stage-card';
    card.dataset.stageId = stage.id;
    card.innerHTML = `<pre class="stage-map"></pre><span class="stage-title"></span><span class="stage-dims"></span>`;
    card.querySelector('.stage-map').textContent = stageMiniMap(stage);
    card.querySelector('.stage-title').textContent = stage.title;
    card.querySelector('.stage-dims').textContent = `${stage.files}×${stage.ranks}`;
    card.title = stage.notes;
    card.addEventListener('click', () => {
      setup.stageId = stage.id;
      clampCrops();
      saveSetup();
      syncStagePicker();
      openStagePreview();
    });
    list.appendChild(card);
  }
}

/** Crops are bounded by the catalog floor (5 ranks must survive). */
function clampCrops() {
  const stage = currentStage();
  const budget = stage ? Math.max(0, stage.ranks - 5) : 0;
  setup.cropTop = Math.max(0, Math.min(setup.cropTop | 0, budget));
  setup.cropBottom = Math.max(0, Math.min(setup.cropBottom | 0, budget - setup.cropTop));
}

/** Build one side's knob block (identical structure per side, distinct ids). */
function renderSidePanels() {
  for (const side of ['white', 'black']) {
    const el = $(`setup-${side}`);
    const label = side === 'white' ? 'You (White)' : 'Enemy (Black)';
    el.innerHTML =
      `<span class="side-label">${label}</span>` +
      `<label class="opt">Width <select data-k="width">${Array.from(
        { length: ARMY_MAX_WIDTH - ARMY_MIN_WIDTH + 1 },
        (_, i) => `<option>${ARMY_MIN_WIDTH + i}</option>`
      ).join('')}</select></label>` +
      `<label class="opt">Army <select data-k="mode"><option value="budget">points</option><option value="pieces">exact</option></select></label>` +
      `<label class="opt mode-budget">Points <input type="number" data-k="budget" min="4" max="75" step="1"></label>` +
      `<label class="opt mode-pieces">Pieces <input type="text" data-k="pieces" size="8" placeholder="QRNBN"></label>` +
      `<label class="opt">Depth <select data-k="archetype">${ARCHETYPES.map((a) => `<option>${a}</option>`).join('')}</select></label>` +
      `<label class="opt">Anchor <select data-k="anchor">${ANCHORS.map((a) => `<option>${a}</option>`).join('')}</select></label>`;
    for (const input of el.querySelectorAll('[data-k]')) {
      input.addEventListener('change', () => {
        const k = input.dataset.k;
        const v = input.type === 'number' || k === 'width' ? parseInt(input.value, 10) : input.value;
        setup[side][k] = v;
        saveSetup();
        syncPanel();
        refreshLiveDeal(); // the armies update on the board as you tweak
      });
    }
  }
}

function syncStagePicker() {
  for (const card of $('stage-list').children) {
    card.classList.toggle('selected', card.dataset.stageId === setup.stageId);
  }
}

/** Reflect the setup model into the panel controls (never deals). */
function syncPanel() {
  const stage = currentStage();
  if (!stage) return;
  $('supFlip').checked = setup.flip;
  const budget = Math.max(0, stage.ranks - 5);
  $('supCropTop').max = String(budget);
  $('supCropBottom').max = String(budget);
  $('supCropTop').value = String(setup.cropTop);
  $('supCropBottom').value = String(setup.cropBottom);
  $('supTurn').value = setup.turn;
  $('supSeed').value = String(setup.seed);
  for (const side of ['white', 'black']) {
    const el = $(`setup-${side}`);
    for (const input of el.querySelectorAll('[data-k]')) {
      const k = input.dataset.k;
      if (input.value !== String(setup[side][k])) input.value = String(setup[side][k]);
    }
    el.querySelector('.mode-budget').hidden = setup[side].mode !== 'budget';
    el.querySelector('.mode-pieces').hidden = setup[side].mode !== 'pieces';
  }
}

const randomSeed = () => 1 + Math.floor(Math.random() * 0x7ffffffe);

/** (Re)mount the board for the given dims and show a position on it. */
function mountPreviewBoard(files, ranks, fen, skins = {}) {
  if (!app.boardUI || app.boardUI.files !== files || app.boardUI.ranks !== ranks) {
    if (app.boardUI) app.boardUI.destroy();
    app.boardUI = new BoardUI($('board'), {
      files,
      ranks,
      flipped: false, // the player is always White at the bottom
      onSquareTap: onSquareTap,
    });
  }
  app.boardUI.setPosition(fen, { skins });
  app.boardUI.setMarks({});
  app.boardUI.setInteractive(false);
  applyTheme();
}

/** Walls-only FEN of the transformed terrain — what the preview shows when
 *  the current knobs cannot deal (the stage stays visible, the reason
 *  says why the armies are missing). */
function terrainOnly() {
  const stage = currentStage();
  let t;
  try {
    t = cropStage(setup.flip ? flipStageVertical(stage) : stage, setup.cropTop | 0, setup.cropBottom | 0);
  } catch {
    t = setup.flip ? flipStageVertical(stage) : stage; // the crop is the invalid part
  }
  // Stamp the grid VERBATIM — both terrain glyphs (copying only '*' would
  // silently hide authored furniture from the preview).
  const board = emptyBoard(t.files, t.ranks);
  for (let r = 0; r < t.ranks; r++) {
    for (let f = 0; f < t.files; f++) if (t.grid[r][f] !== null) board[t.ranks - 1 - r][f] = t.grid[r][f];
  }
  return { files: t.files, ranks: t.ranks, fen: `${serializeBoard(board)} w - - 0 1`, skins: stageSkins(t) };
}

/** THE live loop: recompute the deal from the current knobs and paint the
 *  result on the board immediately. Every knob change lands here. */
function refreshLiveDeal() {
  if (app.phase !== 'preview') return;
  const out = $('setup-readout');
  if (!currentStage()) {
    // configureSetup can inject an unknown stageId while previewing —
    // report instead of dereferencing a null stage in terrainOnly().
    app.session = null;
    out.textContent = '✗ pick a stage';
    out.className = 'bad';
    $('btnBegin').disabled = true;
    setStatus('pick a stage');
    return;
  }
  const deal = computeDeal();
  if (!deal.ok) {
    app.session = null;
    const t = terrainOnly();
    mountPreviewBoard(t.files, t.ranks, t.fen, t.skins);
    $('enemy-bar').textContent = 'enemy · black';
    setPlayerBarText('you · white');
    out.textContent = `✗ ${deal.error}`;
    out.className = 'bad';
    $('btnBegin').disabled = true;
    setStatus("doesn't fit — adjust the armies");
    return;
  }
  app.session = makeSession(deal);
  mountPreviewBoard(deal.files, deal.ranks, deal.fen, stageSkins(deal.stage));
  $('enemy-bar').textContent = `enemy · black · ${deal.black.army.value} pts`;
  setPlayerBarText(`you · white · ${deal.white.army.value} pts`);
  const edge = deal.edge > 0 ? `your edge +${deal.edge}` : deal.edge < 0 ? `enemy edge +${-deal.edge}` : 'even armies';
  const extras = [];
  if (deal.attempt > 0) extras.push(`re-dealt ×${deal.attempt}`);
  if (deal.violations.length) extras.push(`${deal.violations.length} open file${deal.violations.length > 1 ? 's' : ''}`);
  if (deal.autoCrop.top || deal.autoCrop.bottom) extras.push('cropped behind the kings');
  out.textContent = `✓ ${deal.files}×${deal.ranks} · gap ${deal.gap} · ${edge}${extras.length ? ' · ' + extras.join(' · ') : ''}`;
  out.className = 'ok';
  $('btnBegin').disabled = false;
  setStatus(`${edge} · gap ${deal.gap}${deal.turn === 'b' ? ' · the enemy moves first' : ''}`);
}

/** Open the live preview for the currently selected stage: the board up
 *  top, the generator knobs under it, armies re-dealt on every change. */
function openStagePreview() {
  const stage = currentStage();
  if (!stage) return;
  app.phase = 'preview';
  app.busy = false;
  refreshGodsUI(); // an ended duel's panel may still be up — hide it
  refreshCheatUI();
  showScreen('duel');
  $('title').textContent = stage.title;
  $('duel-log').textContent = '';
  setHintLine('');
  setGodsLine('');
  $('preview-controls').hidden = false;
  $('setup-panel').hidden = false;
  syncPanel();
  refreshLiveDeal();
}

/** New seed, same knobs — the Re-deal buttons land here. */
function redeal() {
  setup.seed = randomSeed();
  saveSetup();
  syncPanel();
  refreshLiveDeal();
}

// ------------------------------------------------------------------- screens

function showScreen(name) {
  $('screen-setup').hidden = name !== 'setup';
  $('screen-duel').hidden = name !== 'duel';
  $('btnBack').hidden = name === 'setup';
}

/** Fence + recycle before binding a duel to the shared engine: never reuse an
 *  instance with a search still in flight (its stale bestmove would satisfy
 *  the next duel's listener), and honor CLAUDE.md rule 6 by recycling well
 *  before the ~40-game WASM fatigue limit. */
async function ensureEngineReady() {
  if (app.enginePending) {
    const quiet = await Promise.race([
      app.enginePending.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 4000)),
    ]);
    app.enginePending = null;
    if (!quiet) app.duelsOnEngine = Infinity; // unresponsive — force a fresh instance
  }
  if (app.duelsOnEngine >= 20) {
    const fresh = await createEngine();
    await fresh.loadVariantsIni(app.catalog);
    app.engine = fresh; // old instance is just dropped, never quit() (rule 6)
    app.duelsOnEngine = 0;
  }
  app.duelsOnEngine++;
}

/** Override params are test-only; a typo must not silently change the
 *  game — fall back to the configured numbers unless the value is sane. */
function intParam(name, fallback, min) {
  const v = parseInt(params.get(name) ?? '', 10);
  return Number.isInteger(v) && v >= min ? v : fallback;
}

async function beginDuel() {
  const session = app.session;
  if (!session) return;
  const deal = session.deal;
  $('preview-controls').hidden = true;
  $('setup-panel').hidden = true;
  $('duel-log').textContent = '';
  app.phase = 'playing';
  app.selectedSquare = null;
  await ensureEngineReady();
  // Camp-line double-step (spike 14): every deal rides its own variant
  // (double-step region = each side's camp, home edge up to its mode
  // pawn rank). Append it to the cumulative ini — recycle paths reload
  // app.catalog, so a mid-duel engine swap keeps the live variant — and
  // reload this instance now.
  if (!app.dealVariants.has(deal.variantName)) {
    app.catalog += '\n' + deal.variantIni;
    app.dealVariants.add(deal.variantName);
  }
  await app.engine.loadVariantsIni(app.catalog);

  // Director config: settings preset (or custom knobs) + the seed the deal
  // derived from the master setup seed (one number reproduces the whole
  // session); every knob overridable via query param (test-only).
  const god = godConfig();
  const director = {
    onsetPly: intParam('onset', god.onsetPly, 1),
    rampPlies: intParam('mramp', god.rampPlies, 1),
    sate: intParam('sate', god.sate, 0),
    debtCap: intParam('debt', god.debtCap, 1),
    extraActions: intParam('acts', god.extraActions, 0),
    seed: intParam('dirseed', deal.directorSeed, 1),
  };
  clearHints();
  app.quakeMarks = null;
  app.residue = { opened: new Set(), rubble: new Set(), lastFen: null };
  setGodsLine('');
  $('eval-fill').style.width = '50%';
  $('eval-text').textContent = '';
  // Gods debug overlay: fresh duel, fresh ledger.
  app.godsCensus = null;
  godsHeatOff();
  evalProbe.queue.length = 0;
  evalProbe.seq++;
  evalProbe.failures = 0; // fresh duel, fresh engine budget
  $('gods-trace').textContent = '';
  $('gods-census').textContent = '';
  $('godsIntensity').value = '1';
  $('godsIntensityVal').textContent = '1.0';
  if (app.duel) app.duel.destroy();
  app.duel = new DuelController({
    ffish: app.ffish,
    engine: app.engine,
    variantName: session.variantName,
    startFen: deal.fen,
    files: session.files,
    ranks: session.ranks,
    director,
    // depth 22, NOT 60: ultra-deep searches are what probabilistically crash
    // this WASM build's pthread ("index out of bounds" — the stall the
    // recovery ladder catches; measured d60 1/30, d22 0/50). Within that
    // cap the engine may think as long as it needs, up to 10 s (designer
    // decision 2026-08: human-play pacing is not a tuning concern yet) —
    // small boards still reply in <200 ms because d22 arrives first; big
    // boards get the full think. Lab corpora set their own faster limits.
    go: params.get('go') ?? 'depth 22 movetime 10000',
    hooks: { onMove, onQuake, onEnd, onEngineInfo, onEngineStall, onDirectorTrace },
  });
  await app.duel.start();
  paintBoard(app.duel.fen());
  applyTheme();
  app.boardUI.setMarks({});
  refreshGodsUI();
  if (app.duel.state === 'playing') await driveTurn();
}

// --------------------------------------------------------------------- play

async function driveTurn() {
  const duel = app.duel;
  if (!duel || duel.state !== 'playing') return;
  if (duel.turnColor() === app.session.playerColor) {
    app.busy = false;
    app.boardUI.setInteractive(true);
    setStatus('your move');
    refreshCheatUI();
    void runIdleProbes();
  } else {
    app.busy = true;
    app.boardUI.setInteractive(false);
    setStatus('the enemy is thinking…');
    refreshCheatUI();
    const r = await duel.engineMove();
    if (!r.ended) await driveTurn();
  }
}

/** Paint a position with the Director's terrain ledgers, so a crumbled '*'
 *  renders as a hole and a god-weakened '^' as a cracked wall (board-ui.mjs
 *  setPosition). Every LIVE-duel paint goes through here; the setup preview
 *  has no Director and paints bare (every '*' stone, every '^' a crate). */
function paintBoard(fen) {
  const dir = app.duel?.director;
  const skins = stageSkins(app.session?.deal?.stage);
  const res = app.residue;
  if (res.lastFen && res.lastFen !== fen) {
    // Terrain that stood on the last paint and is gone now — a wall can
    // crack AND break in one quake budget, so walls count, not only '^'.
    const before = new Set(findSquares(res.lastFen, (c) => isTerrain(c)).map((s) => s.name));
    const after = new Set(findSquares(fen, (c) => isTerrain(c)).map((s) => s.name));
    for (const sq of before) {
      if (after.has(sq) || dir?.holes.has(sq)) continue;
      if (skins[sq] === 'door' && !dir?.godCrates.has(sq)) res.opened.add(sq); // captured or burst open: the doorway stays
      else res.rubble.add(sq);
    }
    for (const sq of after) { res.opened.delete(sq); res.rubble.delete(sq); } // undo brought it back
  }
  res.lastFen = fen;
  app.boardUI.setPosition(fen, { holes: dir?.holes ?? new Set(), godCrates: dir?.godCrates ?? new Set(), skins, opened: res.opened, rubble: res.rubble });
}

/** Compose all in-play board marks (selection, last move, check, the gods'
 *  residue by rung, hint + quake arrows). */
function renderPlayMarks() {
  const q = app.quakeMarks;
  const marks = {
    lastMove: lastMoveMarks(),
    check: checkMark(),
    arrows: [...(q?.arrows ?? []), ...app.cheatArrows],
    quakeFrom: q?.from ?? [],
    quakeTo: q?.to ?? [],
    pits: q?.pits ?? [],
    cracked: q?.cracked ?? [],
    breached: q?.breached ?? [],
    heat: app.godsHeat ?? {},
  };
  if (app.selectedSquare && app.duel && app.duel.state === 'playing') {
    marks.selected = app.selectedSquare;
    marks.targets = targetsFor(app.selectedSquare);
  }
  app.boardUI.setMarks(marks);
}

function targetsFor(from) {
  const targets = app.duel
    .legalMoves()
    .map((m) => m.match(UCI_MOVE_RE))
    .filter((p) => p && p[1] === from)
    .map((p) => p[2]);
  return [...new Set(targets)];
}

function onSquareTap(sq) {
  if (app.busy) return;
  if (app.phase !== 'playing' || !app.duel || app.duel.state !== 'playing') return;
  if (app.duel.turnColor() !== app.session.playerColor) return;

  const legal = app.duel.legalMoves();
  const from = app.selectedSquare;
  if (from && sq !== from) {
    const matches = legal.filter((m) => {
      const p = m.match(UCI_MOVE_RE);
      return p && p[1] === from && p[2] === sq;
    });
    if (matches.length) return void playPlayerMove(from, sq, matches);
  }
  // (Re)select: any square with at least one legal move from it.
  const froms = new Set(legal.map((m) => (m.match(UCI_MOVE_RE) ?? [])[1]).filter(Boolean));
  app.selectedSquare = froms.has(sq) && sq !== from ? sq : null;
  renderPlayMarks();
}

function lastMoveMarks() {
  const moves = app.duel?.record.moves;
  if (!moves || !moves.length) return [];
  const p = moves[moves.length - 1].match(UCI_MOVE_RE);
  return p ? [p[1], p[2]] : [];
}

async function playPlayerMove(from, to, matches) {
  let uci = matches[0];
  if (matches.length > 1 || (matches[0].match(UCI_MOVE_RE) ?? [])[3]) {
    // Promotion (§4.4): several suffixed moves for one from-to pair.
    const letters = [...new Set(matches.map((m) => (m.match(UCI_MOVE_RE) ?? [])[3]).filter(Boolean))];
    if (letters.length) {
      const choice = await pickPromotion(letters, { pieces: piecesFor() });
      uci = from + to + choice;
    }
  }
  app.busy = true;
  app.selectedSquare = null;
  app.boardUI.setInteractive(false);
  await cancelIdleProbes(); // the engine must be quiet before its reply search
  try {
    const r = await app.duel.playerMove(uci);
    if (!r.ended) await driveTurn();
  } catch (e) {
    setStatus(e.message);
    app.busy = false;
    app.boardUI.setInteractive(true);
  }
}

// -------------------------------------------------------------------- hooks

let lastEngineInfo = null;

async function onMove({ uci, san, mover, ply }) {
  const duel = app.duel;
  clearHints(); // stale the moment the position changes
  // duel.#push mutates its own board but renders nothing, so the DOM still
  // holds the PRE-move position here — which is exactly what the FLIP clone
  // needs to slide from. The engine's reply gets the longer slide: the player
  // did not choose it and has to read it.
  const parts = uci.match(UCI_MOVE_RE);
  if (parts) {
    await app.boardUI.animateSlide(parts[1], parts[2], { ms: FX(mover === 'engine' ? 240 : 150), fade: true });
    if (app.duel !== duel || !duel.board) return; // abandoned mid-slide
  }
  // The player has answered the gods; their residue has served its purpose.
  if (mover === 'player') {
    app.quakeMarks = null;
    setGodsLine('');
  }
  godsHeatOff(); // the census described the pre-move position
  paintBoard(app.duel.fen());
  renderPlayMarks();
  const n = Math.ceil(ply / 2);
  const isWhiteMove = ply % 2 === 1;
  log($('duel-log'), `${n}${isWhiteMove ? '.' : '…'} ${san}${mover === 'engine' && lastEngineInfo ? `  (${lastEngineInfo})` : ''}`);
  if (mover === 'engine') lastEngineInfo = null;
}

function checkMark() {
  if (!app.duel || app.duel.state !== 'playing') return null;
  if (!app.duel.board.isCheck()) return null;
  // Mark the on-turn side's king square.
  const target = app.duel.turnColor() === 'white' ? 'K' : 'k';
  return findSquares(app.duel.fen(), (c) => c === target)[0]?.name ?? null;
}

/**
 * The quake, in three beats: rumble, then motion, then a settle before the
 * enemy's reply is allowed to land on top of it. (The old version fired the
 * board shake, the square flashes and the teleport into one 450 ms window —
 * so the piece jumped while its own 700 ms cue was still playing, and
 * nothing on the board said which way it went.)
 *
 * Motion is per RUNG (board-ui.mjs animateTerrain): a weaken cracks, a
 * breach bursts, a crumble sinks, a displacement slides — and each edited
 * tile HOLDS its end frame until the single commit, so a multi-action quake
 * never shows a wall snapping back to solid while pieces are still sliding.
 * Beat order stays terrain → pieces → pit: a valid causal reading of every
 * budget (a breach edits '^', a weaken '*', a crumble bare floor; a slide
 * can only ever vacate a square a crumble then takes), heaviest last.
 */
async function onQuake(ev) {
  const { displacements, crumble, terrain, endedGame, postFen } = ev;
  const duel = app.duel;
  const ui = app.boardUI;
  const board = $('board');
  // Eval delta (Phase 1.2): queue the pre/post probe for the player's idle
  // window — `ev` IS the record.quakes entry, so the result lands on the
  // ledger. Ended duels are not probed (the probe only runs while playing),
  // and a probe path that already failed past its recycle cap stays retired
  // for the rest of the duel — no fresh jobs, no per-turn failure spam.
  if (godsDebug() && !endedGame && evalProbe.failures <= 3) {
    evalProbe.queue.push({ duel, ev, preFen: ev.preFen, postFen: ev.postFen });
    if (evalProbe.queue.length > 8) evalProbe.queue.shift(); // bound the backlog
  }
  godsHeatOff(); // the census described the pre-quake position
  const edits = terrain ?? [];
  const cracked = edits.filter((e) => e.kind === 'weaken').map((e) => e.square);
  const breached = edits.filter((e) => e.kind === 'breach').map((e) => e.square);
  // Rung-specific flavor for the status line. It lives only for the
  // animation (the turn loop overwrites it as soon as the turn resumes), so
  // the durable telling is the gods line + the log, below. The line names
  // the heaviest thing, which is also what the eye will land on. Audio
  // hangs off the same split when it lands.
  setStatus(
    crumble ? 'the arena shudders — the floor gives!'
      : breached.length ? 'something gives way — the wall breaks open!'
      : displacements.length ? 'the arena shudders…'
      : cracked.length ? 'stone groans — a wall is failing…'
      : 'the arena shudders…'
  );

  // Beat 1 — the rumble, alone, so the eye is on the board before anything moves.
  board.style.setProperty('--fx-ms', `${FX(280)}ms`);
  board.classList.add('quaking');
  await wait(FX(280));
  board.classList.remove('quaking');
  board.style.removeProperty('--fx-ms');
  if (app.duel !== duel) return;

  // Beat 2 — the motion, each edited tile held on its end frame.
  for (const e of edits) await ui.animateTerrain(e.square, e.kind, FX(e.kind === 'breach' ? 320 : 300), { hold: true });
  if (app.duel !== duel) return;
  if (displacements.length) await ui.animateSlides(displacements, { ms: FX(340), stagger: FX(120) });
  if (app.duel !== duel) return;
  if (crumble) await ui.animateTerrain(crumble.square, 'crumble', FX(450), { hold: true });
  if (app.duel !== duel) return; // user backed out mid-animation

  // Beat 3 — commit and mark. The marks outlive the enemy's reply and MERGE
  // with an earlier quake's in the same window (a quake after the player's
  // ply followed by one after the enemy's used to leave only the second).
  paintBoard(postFen);
  const prev = app.quakeMarks ?? { from: [], to: [], pits: [], cracked: [], breached: [], arrows: [], text: [] };
  const bits = quakeBits(ev);
  const pit = crumble ? crumble.square : null;
  app.quakeMarks = {
    from: [...prev.from, ...displacements.map((d) => d.from)],
    to: [...prev.to, ...displacements.map((d) => d.to)],
    pits: [...prev.pits, ...(pit ? [pit] : [])],
    // A later rung supersedes an earlier mark on the same square — across
    // quakes AND within one budget (weaken then breach the same wall): a
    // crack that then broke open is a breach, a breach that then collapsed
    // is a pit.
    cracked: [...prev.cracked, ...cracked].filter((sq) => !breached.includes(sq)),
    breached: [...prev.breached, ...breached].filter((sq) => sq !== pit),
    arrows: [...prev.arrows, ...displacements.map((d) => ({ from: d.from, to: d.to, strength: 0.7, kind: 'quake' }))],
    text: [...prev.text, ...bits],
  };
  renderPlayMarks();
  setGodsLine(`⚡ the gods: ${app.quakeMarks.text.join(' · ')}`);
  log($('duel-log'), `⚡ the gods stir — ${bits.join(' · ')}`, 'gods');
  await wait(FX(240)); // settle: the reply does not land in the same breath
}

/** The quake in words, one bit per action in the order the beats played
 *  (terrain, pieces, pit); the same string feeds the gods line and the log.
 *  Every rung is named — the old line skipped terrain edits entirely, so a
 *  crack-only quake logged "the gods stir — " with nothing after the dash. */
function quakeBits(ev) {
  const bits = [];
  for (const e of ev.terrain ?? []) {
    if (e.kind === 'weaken') bits.push(`wall cracks ${e.square}`);
    else bits.push(`${e.square} breaks open${e.freed > 0 ? ` (frees ${e.freed} pawn${e.freed === 1 ? '' : 's'})` : ''}`);
  }
  for (const d of ev.displacements) {
    const yours = (d.piece === d.piece.toUpperCase() ? 'white' : 'black') === app.session.playerColor;
    bits.push(`${yours ? 'your' : 'enemy'} ${pieceName(d.piece)} ${d.from}→${d.to}`);
  }
  if (ev.crumble) bits.push(`${ev.crumble.square} collapses — a hole`);
  if (ev.endedGame) bits.push('nowhere left to stand');
  return bits;
}

function pieceName(letter) {
  return { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[letter.toLowerCase()] ?? letter;
}

/** Engine-stall recovery (duel.mjs ladder): abandon the dead WASM instance
 *  (never quit() — rule 6), boot a fresh one, reload the catalog. */
async function onEngineStall() {
  setStatus('the enemy summoner falters — reforming…');
  log($('duel-log'), '⚠ engine stalled — recycling instance', 'warn');
  const fresh = await createEngine();
  await fresh.loadVariantsIni(app.catalog);
  app.engine = fresh;
  app.duelsOnEngine = 1;
  app.enginePending = null; // the stalled instance is abandoned outright
  return fresh;
}

function onEngineInfo({ score, depth }) {
  // Score is from the ENGINE's point of view (it is the mover).
  const s = score.type === 'mate' ? (score.value > 0 ? `M${score.value}` : `−M${-score.value}`) : (score.value / 100).toFixed(1);
  lastEngineInfo = `d${depth ?? '?'} ${s}`;
  if (cheatEval()) updateEvalBar(score, app.session.enemyColor);
}

async function onEnd({ result, winner, termination }) {
  app.phase = 'ended';
  app.busy = false;
  app.boardUI.setInteractive(false);
  const playerWon = winner === app.session.playerColor;
  const title = termination === 'error' ? 'The arena falters' : playerWon ? 'Victory' : 'Defeat';
  const detail =
    termination === 'error'
      ? app.duel.record.error
      : {
          checkmate: playerWon ? 'Checkmate — the enemy king falls.' : 'Checkmate — your king falls. The run is over.',
          'king-capture': playerWon ? 'The enemy king is taken.' : 'Your king is taken. The run is over.',
          'army-extinct': playerWon
            ? 'The enemy army falls — with nothing left to summon, the barrier claims its king.'
            : 'Your army falls — your summoning is broken. The run is over.',
          stalemate: playerWon
            ? 'The enemy king has nowhere left to stand — the floor gives way beneath him.'
            : 'Your king has nowhere left to stand — the floor gives way.',
          earthquake: playerWon
            ? 'The gods end it — the arena collapses around the enemy king.'
            : 'The gods end it — the arena collapses around your king. The run is over.',
        }[termination] ?? `${result}`;
  $('overlay-title').textContent = title;
  $('overlay-detail').textContent = detail;
  $('btnOverlayUndo').hidden = !cheatUndo();
  $('overlay').hidden = false;
  refreshCheatUI();
  refreshGodsUI(); // the panel survives the end screen — post-mortems welcome
  setStatus(result ? `${result} · ${termination}` : 'error');
}

// ------------------------------------------------------------------- wiring

$('btnBegin').addEventListener('click', beginDuel);
$('btnRedeal').addEventListener('click', redeal);
$('btnReseed').addEventListener('click', redeal);
$('supFlip').addEventListener('change', (e) => {
  setup.flip = e.target.checked;
  saveSetup();
  syncPanel();
  refreshLiveDeal();
});
for (const [el, key] of [['supCropTop', 'cropTop'], ['supCropBottom', 'cropBottom']]) {
  $(el).addEventListener('change', (e) => {
    setup[key] = Math.max(0, parseInt(e.target.value, 10) || 0);
    clampCrops();
    saveSetup();
    syncPanel();
    refreshLiveDeal();
  });
}
$('supTurn').addEventListener('change', (e) => {
  setup.turn = e.target.value === 'b' ? 'b' : 'w';
  saveSetup();
  syncPanel();
  refreshLiveDeal();
});
$('supSeed').addEventListener('change', (e) => {
  const v = parseInt(e.target.value, 10);
  setup.seed = Number.isInteger(v) && v >= 1 ? v : 1;
  saveSetup();
  syncPanel();
  refreshLiveDeal();
});
$('btnBack').addEventListener('click', () => {
  const probesQuiet = cancelIdleProbes(); // cheat + eval probes are in-flight searches too
  evalProbe.queue.length = 0;
  const d = app.duel;
  app.duel = null;
  if (d) d.destroy(); // sends 'stop' to any in-flight search
  // Fence (best effort): stops are sent and given a beat; a truly dead
  // instance can outlive this, which is why ensureEngineReady adds its own
  // 4 s wait and force-recycles when the fence never goes quiet.
  app.enginePending = Promise.all([probesQuiet, d ? d.whenQuiet() : null]).then(() => {});
  app.busy = false;
  app.phase = 'setup';
  showScreen('setup');
  refreshCheatUI();
  refreshGodsUI();
  $('title').textContent = 'Dungeon Crawler King';
  syncStagePicker();
  setStatus('pick a stage');
});
$('btnUndo').addEventListener('click', doUndo);
$('btnOverlayUndo').addEventListener('click', doUndo);
$('btnOptions').addEventListener('click', () => {
  syncOptionsUI();
  $('options').hidden = false;
});
$('btnOptionsClose').addEventListener('click', () => {
  $('options').hidden = true;
});
for (const [el, key] of [['optCheat', 'cheat'], ['optHints', 'hints'], ['optHintCont', 'hintCont'], ['optUndo', 'undo'], ['optEval', 'evalBar'], ['optGodsDebug', 'godsDebug']]) {
  $(el).addEventListener('change', (e) => {
    options[key] = e.target.checked;
    applyOptions();
  });
}
$('optHintN').addEventListener('change', (e) => {
  options.hintN = parseInt(e.target.value, 10);
  applyOptions();
});
$('optTheme').addEventListener('change', (e) => {
  options.theme = e.target.value;
  applyOptions();
});
$('optPieces').addEventListener('change', (e) => {
  options.pieces = e.target.value;
  applyOptions();
});
$('optDoors').addEventListener('change', (e) => {
  options.doors = e.target.value;
  applyOptions();
});
/** Live ramp dials (Phase 1.2): while the debug overlay is on and a duel is
 *  running, Gods settings changes apply to the LIVE Director too (recorded
 *  on the duel ledger). Without the overlay they keep their shipped meaning:
 *  from the next duel. */
function liveTune(partial) {
  if (!godsDebug() || !app.duel || app.duel.state !== 'playing') return;
  const applied = app.duel.tuneDirector(partial);
  if (Object.keys(applied).length) {
    log($('gods-trace'), `dial @p${app.duel.ply}: ${Object.entries(applied).map(([k, v]) => `${k}=${v}`).join(' ')} (live)`, 'ok');
    renderGodsSummary();
  }
}

$('optGodPreset').addEventListener('change', (e) => {
  options.godPreset = e.target.value;
  if (options.godPreset === 'custom' && !options.godCustom) options.godCustom = { ...GOD_PRESETS.restless };
  applyOptions();
  liveTune(godConfig());
});
for (const k of GOD_KNOBS) {
  $(`god_${k}`).addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    if (!Number.isInteger(v) || v < 1) return syncOptionsUI(); // reject, restore
    options.godCustom = { ...(options.godCustom ?? GOD_PRESETS.restless), [k]: v };
    options.godPreset = 'custom';
    applyOptions();
    liveTune({ [k]: v });
  });
}
// Intensity (designer rename, 2026-09-01 — was "favor"): a DEBUG dial on the
// quake-probability multiplier, driving the CURRENT duel only; resets to 1
// with each new Director. The Director API stays setFavor()/favor because
// "Favor of the Gods" remains the brief's OPEN future mechanic (§4.5:
// shrines/items/taunting move the same multiplier in-game, theme TBD) — this
// slider is the instrument, that would be the mechanic.
$('godsIntensity').addEventListener('input', (e) => {
  $('godsIntensityVal').textContent = parseFloat(e.target.value).toFixed(1);
});
$('godsIntensity').addEventListener('change', (e) => {
  const v = parseFloat(e.target.value);
  if (!Number.isFinite(v) || !app.duel || app.duel.state !== 'playing') return;
  app.duel.setFavor(v); // recorded on the ledger (as `favor`)
  log($('gods-trace'), `intensity @p${app.duel.ply}: ${v.toFixed(1)}`, 'ok');
  renderGodsSummary();
});
$('btnGodsCensus').addEventListener('click', godsCensusNow);
$('btnGodsHeat').addEventListener('click', () => {
  app.godsHeatOn = !app.godsHeatOn;
  syncHeatButton();
  if (!app.godsHeatOn) {
    app.godsHeat = null;
    if (app.duel && (app.phase === 'playing' || app.phase === 'ended')) renderPlayMarks();
    return;
  }
  if (app.godsCensus && app.duel && app.godsCensus.ply === app.duel.ply) {
    app.godsHeat = buildHeat(app.godsCensus);
    renderPlayMarks();
  } else {
    godsCensusNow(); // applies heat when the census lands (godsHeatOn is set)
  }
});
$('btnGodsExport').addEventListener('click', async () => {
  const data = godsExportData();
  if (!data) return;
  const json = JSON.stringify(data);
  try {
    await navigator.clipboard.writeText(json);
    log($('gods-trace'), `trace copied (${(json.length / 1024).toFixed(1)} KB)`, 'ok');
  } catch {
    console.log('[DCK gods trace]', json); // clipboard blocked — console fallback
    log($('gods-trace'), 'clipboard unavailable — trace dumped to console', 'bad');
  }
});
// Rematch: the SAME deal and the SAME Director seed — the identical duel,
// for "let me try that again". Re-deal: back to the live preview on a
// fresh seed.
$('btnAgain').addEventListener('click', () => {
  $('overlay').hidden = true;
  void beginDuel(); // session (deal + Director seed) is untouched
});
$('btnOverlayRedeal').addEventListener('click', () => {
  $('overlay').hidden = true;
  // Fresh seed FIRST, then one preview — openStagePreview deals once;
  // dealing with the stale seed and immediately re-dealing flashed the
  // discarded position and ran the pipeline twice.
  setup.seed = randomSeed();
  saveSetup();
  openStagePreview();
});
$('btnMenu').addEventListener('click', () => {
  $('overlay').hidden = true;
  $('btnBack').click();
});

// Test hook (Playwright E2E drives the game through this).
window.__DCK = {
  get app() {
    return app;
  },
  get record() {
    return app.duel?.record ?? null;
  },
  // Favor of the Gods — runtime tuning hook (theme TBD). Scales quake
  // probability mid-duel: 0 silences the gods, 1 baseline, >1 angers them.
  // In-game effects (items, shrines, taunts) will call this; exposed here
  // so it can be exercised from the console / E2E today. Recorded on the
  // duel ledger since Phase 1.2.
  setFavor: (mult) => app.duel?.setFavor(mult),
  // The Gods debug overlay (Phase 1.2) — the instrument's console surface.
  // Everything here is RNG-free or reads the ledger; census() is the one
  // expensive call (a quake-scale enumeration, rule 14).
  gods: {
    get traces() {
      return app.duel?.record.quakeTraces ?? null;
    },
    get quakes() {
      return app.duel?.record.quakes ?? null;
    },
    get tunes() {
      return app.duel?.record.tunes ?? null;
    },
    probs: () => {
      const duel = app.duel;
      if (!duel) return null;
      const dir = duel.director;
      const ply = duel.ply + 1;
      return {
        ply,
        pQuake: dir.pQuake(ply),
        pressure: dir.pressure(ply),
        meter: dir.meter.value,
        staleness: dir.lastStaleness?.staleness ?? null,
        rungWeights: dir.rungWeights(ply),
        crumbleForced: dir.debt >= dir.debtCap,
        extraActions: dir.extraActions,
        debt: dir.debt,
        debtCap: dir.debtCap,
        favor: dir.favor,
      };
    },
    forecast: (opts = {}) => {
      const duel = app.duel;
      if (!duel || !duel.board) return null;
      const free = countFreeSquares(duel.fen(), duel.files, duel.ranks);
      return duel.director.forecast(duel.ply, { freeSquares: free, ...opts });
    },
    census: () => computeGodsCensus(),
    tune: (partial) => app.duel?.tuneDirector(partial) ?? null,
    export: () => godsExportData(),
  },
  // UI test surface (2026-09-02 refresh). The renderer has no other
  // regression net: selftest.html never loads the game board.
  /** The art theme on the live board (null = the in-house drawn set). */
  get theme() {
    return app.boardUI?.theme ?? null;
  },
  /** The piece-sprite set on the live board (null = glyphs). */
  get pieces() {
    return app.boardUI?.pieces ?? null;
  },
  /** The door set on the live board (null = the theme's own). */
  get doors() {
    return app.boardUI?.doors ?? null;
  },
  /** The residue ledger: squares where a door was opened / a wall or crate broken. */
  get residue() {
    return { opened: [...app.residue.opened], rubble: [...app.residue.rubble] };
  },
  get cheat() {
    return { seq: cheat.seq, active: !!cheat.active, depth: cheat.depth, arrows: app.cheatArrows, hintLine: $('hint-line').textContent, go: probeGo() };
  },
  get marks() {
    return { quake: app.quakeMarks, godsLine: $('gods-line').textContent, cell: (sq) => app.boardUI?.cellClasses(sq) ?? null };
  },
  ready: null,
  // Setup-screen surface: patch the knobs, deal, preview, begin.
  setup,
  configureSetup: (partial) => {
    for (const k of ['stageId', 'flip', 'cropTop', 'cropBottom', 'turn', 'seed']) if (k in partial) setup[k] = partial[k];
    for (const side of ['white', 'black']) if (partial[side]) Object.assign(setup[side], partial[side]);
    clampCrops();
    saveSetup();
    syncStagePicker();
    if (app.phase === 'preview') {
      syncPanel();
      refreshLiveDeal();
    }
  },
  deal: () => computeDeal(),
  preview: () => openStagePreview(),
  begin: () => beginDuel(),
  legalMoves: () => app.duel.legalMoves(),
  randomMove: () => {
    const legal = app.duel.legalMoves();
    return legal[Math.floor(Math.random() * legal.length)];
  },
  playerMove: async (uci) => {
    await cancelIdleProbes();
    const r = await app.duel.playerMove(uci);
    if (!r.ended) await driveTurn();
    return app.duel.state;
  },
  options,
  applyOptions,
  undo: doUndo,
  waitIdle: async () => {
    while (app.busy) await new Promise((res) => setTimeout(res, 50));
    return app.duel?.state ?? app.phase;
  },
};

loadOptions();
loadSetup();
if (params.get('godsdebug')) options.godsDebug = true; // E2E/dev override (not persisted until the user touches options)
syncOptionsUI();
window.__DCK.ready = boot();

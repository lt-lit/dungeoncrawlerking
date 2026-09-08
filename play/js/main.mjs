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
//   ?stage=<id>      auto-select that stage (e.g. s59-hall-corner)
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
import { findSquares, emptyBoard, serializeBoard, isTerrain, WALL, FURNITURE, getSquare, squareName, parseSquare } from './fen.mjs';
import { loadStageV2, flipStageVertical, cropStage, stageSkins, THEMES } from './stage.mjs';
import { dealMatchup, ARMY_MIN_WIDTH, ARMY_MAX_WIDTH } from './armygen.mjs';
import { pickPromotion, PIECE_SETS, DOOR_SETS, DEFAULT_PIECE_FIT, TILE_LIFT_RANGE, TILE_SHIFT_RANGE, classifyTerrain, residueStep, skinVariantIndex, floorVariantIndex } from './board-ui.mjs';
// THE 16×16 RENDERER (Phase 2, 2026-09-07): one native buffer scaled once to
// the screen — the one board since the DOM board's retirement the same day
// (CLAUDE.md § Phase 2). The atlas is its art and the debris sampler's.
import { CanvasBoard, loadAtlas } from './canvas-board.mjs';
import { normFacing, facingName } from './camera.mjs'; // THE CAMERA's facing (2026-09-08)
import { Atlas } from './atlas.mjs';
import { ARROW_STYLE_DEFAULT, ARROW_WIDTH_RANGE, ARROW_ALPHA_RANGE } from './pixelarrow.mjs'; // the arrows' width / opacity dials
// THE DEBRIS LAYER (2026-09-07): the ledger + painter, the flight, the PNG.
import { DebrisLedger, identityTransform, toEnvCell, fromEnvCell, toEnvPx, envDir, chunksOf, shatterOf, paintCell, spriteVar, CATEGORY, CATEGORIES, kindIsFloor, wearLevel, DRY_PLIES, BASELINE as DEBRIS_BASELINE } from './debris.mjs';
import { Particles } from './particles.mjs';
import { DuelController } from './duel.mjs';
import { displacementCandidates, crumbleCandidates, lockedPawns, fenGrid, terrainCensus, GOD_PRESETS, DIRECTOR_DEFAULTS } from './director.mjs';
import { buildLog, deliverLog, logFileName, logSize, LogStore } from './replaylog.mjs';
import { deltaWords } from './logreport.mjs'; // the deep-Δ wording, shared with the report and the analyzer

// Stamped into every exported replay log (`meta.app`) so a log says which
// build played it. Pages has no build step: bump it by hand with a change
// that alters what the log records or how the gods decide.
const APP_BUILD = '2026-09-07 replay-ui.1';

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
  residue: { opened: new Set(), rubble: new Set(), lastFen: null, lastHoles: null, lastCrates: null },
  // THE DEBRIS LAYER (2026-09-07): the environment's ledger (one per stage,
  // persisted), the live deal's transform into it, the per-cell paint cache
  // (env cell index → 16×16 RGBA buffer | null), events still in flight,
  // the sprite sampler, the flight, the last paint's terrain kinds — see
  // the debris section below and play/js/debris.mjs.
  debris: { ledger: null, envId: null, tx: null, urls: new Map(), pending: new Set(), sampler: null, particles: null, saveTimer: null, kinds: null, dryPly: -1, warmSeq: 0 },
  previewPaint: null, // what the setup preview last painted ({files, ranks, fen, skins}) — a repaint on a toggle
  quakeMarks: null, // {from, to, pits, cracked, breached, arrows, text} — the gods' residue
  // since the player last moved (several quakes MERGE), held on the board and in
  // the gods line through the enemy's reply and cleared when the player moves
  stages: [], // loadStageV2 outputs from the manifest bundle, picker order
  session: null, // the previewed/live duel: {id, title, files, ranks, variantName, playerColor, enemyColor, deal}
  boardUI: null,
  // THE CAMERA (Phase 2, 2026-09-08): the facing in force — which world
  // direction points up the screen (0 north … 3 west). Runtime state, never
  // saved: the turn buttons wait for the army (brief §5.1), so today only
  // the debug turn buttons and `?facing=` move it.
  view: { facing: 0 },
  duel: null,
  selectedSquare: null, // during play: player's selected from-square
  phase: 'boot', // boot | setup | preview | playing | ended | error
  busy: false, // gates input while the engine thinks / animations run
  enginePending: null, // whenQuiet() of an abandoned duel's in-flight search
  duelsOnEngine: 0, // rule 6: recycle the instance well before ~40 games
  godsCensus: null, // last on-demand candidate census {ply, tiers, crumbles, locked, ms}
  godsHeat: null, // {square: tier} heat marks painted from the census
  godsHeatOn: false, // user wants heat; turns itself off when the board changes
  logSlot: null, // the replay log's autosave slot for the live duel (replaylog.mjs LogStore)
  godsBefore: null, // {ply} while the board shows the last quake's PRE-quake position (debug panel "before")
};
const logStore = new LogStore();

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
  // The replay log mirrors the duel log: what the player was told, next to
  // what happened (duel.mjs record.log).
  if (el.id === 'duel-log' && app.duel) app.duel.note(msg, cls ?? null);
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
/** The canvas board's scaling — an integer step (the default: even pixels,
 *  the board centred in the width it gets) or a fill of the width (the
 *  fallback: uneven pixel widths, every layer still aligned). */
const SCALINGS = ['integer', 'fill'];
/** THE CAMERA OWNS THE SCREEN (2026-09-08): on a screen at least this wide
 *  the duel screen is two columns — the board fills the left one top to
 *  bottom (canvas-board fit 'box': k is the largest integer step that fits
 *  the board and its headroom row on BOTH axes, height-bound on a 1080p
 *  desktop) and the bars, the hint list, the log and the debug panel stack
 *  in a column beside it (style.css body.layout-wide). Narrower — every
 *  phone — keeps the stacked layout the phone verdicts were given on. The
 *  ONE breakpoint: main.mjs stamps the body class, style.css keys on it.
 *  `?layout=wide|stack` pins it (test-only). */
const WIDE_LAYOUT = '(min-width: 900px)';
const wideMQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(WIDE_LAYOUT) : null;
const options = { cheat: false, hints: false, hintN: 3, hintCont: false, undo: false, evalBar: false, godPreset: 'restless', godCustom: null, godLadder: null, godsDebug: false, scaling: 'integer', arrowWidth: ARROW_STYLE_DEFAULT.width, arrowAlpha: ARROW_STYLE_DEFAULT.alpha, theme: 'auto', pieces: 'nulltale', doors: 'auto', tileLift: DEFAULT_PIECE_FIT.tileLift, tileShift: DEFAULT_PIECE_FIT.tileShift, debris: { destruction: true, blood: true, skid: true, wear: true, fx: true, intensity: 1, v: 2 } };

// The Gods (Board State Director) — the preset table lives in director.mjs
// now (ONE copy, shared with ladder-smoke and the god lab; retuned
// 2026-09-01 with per-preset staleness knobs). GOD_KNOBS stays the custom
// dial surface: the classic five, while the staleness knobs ride presets.
const GOD_KNOBS = ['onsetPly', 'rampPlies', 'sate', 'debtCap', 'extraActions'];
// The ladder's rung weights (v4.1, designer: "weight sliders in the gods
// debug menu"): four biases, orthogonal to temperament — a preset says how
// often the gods act, the ladder says what they reach for. null = the
// Director's defaults; a set value persists and applies to new duels (and
// live, through the same dial path as the knobs).
const GOD_LADDER = ['weakenBias', 'breachBias', 'displaceBias', 'crumbleBias'];
const LADDER_RANGE = [0, 6];

function godConfig() {
  const base = options.godPreset === 'custom' && options.godCustom ? { ...GOD_PRESETS.restless, ...options.godCustom } : (GOD_PRESETS[options.godPreset] ?? GOD_PRESETS.restless);
  return options.godLadder ? { ...base, ...options.godLadder } : base;
}

function clampNum(v, [lo, hi], dflt) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : dflt;
}

function loadOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPT_KEY) ?? '{}');
    for (const k of Object.keys(options)) if (k in saved) options[k] = saved[k];
    if (![1, 2, 3].includes(options.hintN)) options.hintN = 3;
    if (!(options.godPreset in GOD_PRESETS) && options.godPreset !== 'custom') options.godPreset = 'restless';
    if (!SCALINGS.includes(options.scaling)) options.scaling = 'integer';
    // The arrow dials (2026-09-07): the shaft in whole floor pixels, the opacity.
    options.arrowWidth = Math.round(clampNum(options.arrowWidth, ARROW_WIDTH_RANGE, ARROW_STYLE_DEFAULT.width));
    options.arrowAlpha = clampNum(options.arrowAlpha, ARROW_ALPHA_RANGE, ARROW_STYLE_DEFAULT.alpha);
    if (!['auto', 'classic', ...THEMES].includes(options.theme)) options.theme = 'auto';
    if (!PIECE_SETS.includes(options.pieces)) options.pieces = 'nulltale'; // (a saved 'classic' — the glyph set, retired with the DOM board — lands here)
    if (!['auto', ...DOOR_SETS].includes(options.doors)) options.doors = 'auto';
    // (A saved renderer / piece-pixel mode / % dial from the DOM era is not read.)
    options.tileLift = Math.round(clampNum(options.tileLift, TILE_LIFT_RANGE, DEFAULT_PIECE_FIT.tileLift));
    options.tileShift = Math.round(clampNum(options.tileShift, TILE_SHIFT_RANGE, DEFAULT_PIECE_FIT.tileShift));
    // The debris toggles (2026-09-07): five booleans and a clamped amount.
    // v2 (same day): the slider's 100% became the old 200% (debris.mjs
    // BASELINE), so a setting saved on the old scale is halved ONCE — the
    // board looks exactly as it did.
    {
      const d = options.debris && typeof options.debris === 'object' ? options.debris : {};
      const legacy = d.v !== 2 && Number.isFinite(parseFloat(d.intensity));
      options.debris = { destruction: d.destruction !== false, blood: d.blood !== false, skid: d.skid !== false, wear: d.wear !== false, fx: d.fx !== false, intensity: clampNum(legacy ? parseFloat(d.intensity) / DEBRIS_BASELINE : d.intensity, [0, 2], 1), v: 2 };
    }
    // The ladder override (v4.1): four clamped numbers or nothing.
    if (options.godLadder && typeof options.godLadder === 'object') {
      const clean = {};
      for (const k of GOD_LADDER) if (k in options.godLadder) clean[k] = clampNum(options.godLadder[k], LADDER_RANGE, DIRECTOR_DEFAULTS[k]);
      options.godLadder = Object.keys(clean).length ? clean : null;
    } else options.godLadder = null;
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
  for (const k of GOD_LADDER) {
    const v = options.godLadder?.[k] ?? DIRECTOR_DEFAULTS[k];
    $(`ladder_${k}`).value = String(v);
    $(`ladder_${k}_val`).textContent = Number(v).toFixed(1);
  }
  $('btnLadderReset').disabled = !options.godLadder;
  $('optGodsDebug').checked = options.godsDebug;
  $('optScaling').value = scalingFor();
  $('optTheme').value = options.theme;
  $('optPieces').value = options.pieces;
  $('optDoors').value = options.doors;
  const fit = pieceFitFor();
  const pxv = (v) => `${v > 0 ? '+' : ''}${v} px`;
  $('optTileLift').value = String(fit.tileLift);
  $('optTileLiftV').textContent = pxv(fit.tileLift);
  $('optTileShift').value = String(fit.tileShift);
  $('optTileShiftV').textContent = pxv(fit.tileShift);
  const ar = arrowStyleFor();
  $('optArrowWidth').value = String(ar.width);
  $('optArrowWidthV').textContent = `${ar.width} px`;
  $('optArrowAlpha').value = String(ar.alpha);
  $('optArrowAlphaV').textContent = `${Math.round(ar.alpha * 100)}%`;
  const dz = debrisOpts();
  $('optDebrisDestruction').checked = dz.destruction;
  $('optDebrisBlood').checked = dz.blood;
  $('optDebrisSkid').checked = dz.skid;
  $('optDebrisWear').checked = dz.wear;
  $('optDebrisFx').checked = dz.fx;
  $('optDebrisIntensity').value = String(dz.intensity);
  $('optDebrisIntensityV').textContent = `${Math.round(dz.intensity * 100)}%`;
}

/** The piece placement (canvas-board setPieceFit): `?tilelift=` /
 *  `?tileshift=` (whole tile pixels; feel-check overrides, never saved) >
 *  the Options. */
function pieceFitFor() {
  return {
    tileLift: Math.round(clampNum(params.get('tilelift') ?? options.tileLift, TILE_LIFT_RANGE, DEFAULT_PIECE_FIT.tileLift)),
    tileShift: Math.round(clampNum(params.get('tileshift') ?? options.tileShift, TILE_SHIFT_RANGE, DEFAULT_PIECE_FIT.tileShift)),
  };
}

/** The arrows' style (canvas-board setArrowStyle): `?arrowwidth=` (the
 *  shaft in floor pixels, 1–5) / `?arrowalpha=` (0.2–1) > the Options. */
function arrowStyleFor() {
  return {
    width: Math.round(clampNum(params.get('arrowwidth') ?? options.arrowWidth, ARROW_WIDTH_RANGE, ARROW_STYLE_DEFAULT.width)),
    alpha: clampNum(params.get('arrowalpha') ?? options.arrowAlpha, ARROW_ALPHA_RANGE, ARROW_STYLE_DEFAULT.alpha),
  };
}

/** The canvas board's scaling: `?scaling=integer|fill` > the Options. */
function scalingFor() {
  const pick = params.get('scaling') ?? options.scaling;
  return SCALINGS.includes(pick) ? pick : 'integer';
}

/** The layout in force: 'wide' (the camera owns the screen) or 'stack'.
 *  `?layout=` pins it; else the media query decides. */
function layoutFor() {
  const p = params.get('layout');
  if (p === 'wide' || p === 'stack') return p;
  return wideMQ?.matches ? 'wide' : 'stack';
}

/** The board's fit for the layout (canvas-board fit): `?zoom=N` pins a
 *  fixed zoom (fit 'window' — the walk's fit, a test surface on this page). */
function fitFor() {
  if (zoomFor()) return 'window';
  return layoutFor() === 'wide' ? 'box' : 'width';
}

/** `?zoom=N` (1–12): the board at a fixed integer zoom, or null. */
function zoomFor() {
  const z = parseInt(params.get('zoom') ?? '', 10);
  return Number.isFinite(z) && z >= 1 ? Math.min(12, z) : null;
}

/** THE VIEWPORT (milestone 4): 'crop' — the buffer is the arena (this
 *  page's default) — or 'screen', the screen's tiles with the world around
 *  the arena (`?viewport=screen`; a zoom implies it). */
function viewportFor() {
  const v = params.get('viewport');
  if (v === 'screen' || v === 'crop') return v;
  return zoomFor() ? 'screen' : 'crop';
}

/** Stamp the layout on the body and refit the mounted board. Runs at boot
 *  and whenever the media query flips (a desktop window resized across
 *  the breakpoint). */
function applyLayout() {
  const wide = layoutFor() === 'wide';
  document.body.classList.toggle('layout-wide', wide);
  app.boardUI?.setFit(fitFor());
}
wideMQ?.addEventListener?.('change', applyLayout);

/** THE CAMERA's facing: `?facing=` (0–3, or n / e / s / w) pins it for a
 *  driver; else the runtime state the turn buttons move. */
function facingFor() {
  const p = params.get('facing');
  if (p !== null) {
    const named = { n: 0, north: 0, e: 1, east: 1, s: 2, south: 2, w: 3, west: 3 }[p.toLowerCase()];
    return normFacing(named ?? p);
  }
  return app.view.facing;
}

/** Turn the camera (a CUT): the board repaints from its state, the marks
 *  and arrows ride along, the flight's pixels land where the camera says. */
function setFacing(n) {
  params.delete('facing'); // a turn beats the URL's pin
  app.view.facing = normFacing(n);
  app.boardUI?.setFacing(app.view.facing);
  syncFacingUI();
  return app.view.facing;
}

function syncFacingUI() {
  const el = $('facingName');
  if (el) el.textContent = `${facingName(app.view.facing)} up`;
}

/** The world coordinates a square's cosmetic hashes key on: the board's
 *  WORLD CELL for the square (Phase 2 milestone 4 — the environment is the
 *  world, the debris ledger's space; on this page the world is the dealt
 *  arena, so the cell is the square itself). The identity until a board
 *  is mounted. */
function hashCoordsOf(sq) {
  const c = app.boardUI?.cells.get(sq);
  if (c?.cell) return [c.cell.f, c.cell.r + 1];
  return [sq.charCodeAt(0) - 97, parseInt(sq.slice(1), 10)];
}

/** Mount the board on `el` (canvas-board.mjs — the one renderer). It
 *  reports its geometry to the diagnostics line under the board. */
function createBoard(el, opts) {
  const ui = new CanvasBoard(el, { ...opts, facing: facingFor(), fit: fitFor(), viewport: viewportFor(), zoom: zoomFor() ?? 4, arrowStyle: arrowStyleFor(), scaling: scalingFor(), onResize: (info) => renderDiag(info) });
  app.view.facing = ui.facing;
  syncFacingUI();
  void ui.ready.then(() => renderDiag(ui.renderInfo));
  return ui;
}

/** The diagnostics line under the board: device pixel ratio, the canvas's
 *  device-pixel size, the scale and whether it is the integer step or the
 *  fill fallback. */
function renderDiag(info) {
  const el = $('render-diag');
  if (!el) return;
  const ui = app.boardUI;
  if (!info || !ui) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = ui.diag;
}

/** The mounted board no longer matches the options (the scaling changed):
 *  mount a fresh one of the same dims and repaint what was showing — the
 *  preview, or the live duel with its marks. */
function remountBoard() {
  const ui = app.boardUI;
  if (!ui) return;
  if (ui.scaling === scalingFor()) return;
  if (app.busy && (app.phase === 'playing')) return; // never under an animation; the next mount takes it
  const { files, ranks } = ui;
  if (app.phase === 'preview' && app.previewPaint) {
    const p = app.previewPaint;
    mountPreviewBoard(p.files, p.ranks, p.fen, p.skins);
    return;
  }
  ui.destroy();
  app.boardUI = createBoard($('board'), { files, ranks, flipped: false, onSquareTap });
  app.residue.lastFen = null; // the fresh board has no last paint to diff against
  if (app.duel?.board && (app.phase === 'playing' || app.phase === 'ended')) {
    paintBoard(app.duel.fen());
    renderPlayMarks();
    app.boardUI.setInteractive(app.duel.state === 'playing' && !app.busy && app.duel.turnColor() === app.session.playerColor);
  }
  applyTheme();
}

/** The door set (board-ui DOOR_SETS): `?doors=` > the Doors option;
 *  'auto' = the theme's own. */
function doorsFor() {
  const pick = params.get('doors') ?? options.doors;
  return DOOR_SETS.includes(pick) ? pick : null;
}

/** The piece-sprite set (board-ui PIECE_SETS): `?pieces=` > the Pieces
 *  option; anything unknown is the board's default set. */
function piecesFor() {
  const pick = params.get('pieces') ?? options.pieces;
  return PIECE_SETS.includes(pick) ? pick : null;
}

/** The art theme the board wears right now (stage.mjs THEMES; the atlas's
 *  rows): `?theme=` (a feel-check override, never saved) > the Art-set
 *  option > the stage's own `theme`. 'classic' — or a stage with no theme —
 *  is the in-house drawn set (no data-theme; the atlas's classic row). */
function themeFor(stage) {
  const pick = params.get('theme') ?? options.theme;
  if (pick && pick !== 'auto') return THEMES.includes(pick) ? pick : null;
  return stage?.theme ?? null;
}

/** Stamp the current theme on the board and repaint the options legend
 *  (drawn off the same atlas, so it follows the art). */
function applyTheme() {
  const theme = themeFor(app.session?.deal?.stage ?? currentStage());
  app.boardUI?.setTheme(theme);
  app.boardUI?.setPieces(piecesFor());
  app.boardUI?.setDoors(doorsFor());
  app.boardUI?.setPieceFit(pieceFitFor());
  app.boardUI?.setArrowStyle?.(arrowStyleFor());
  void debrisWarm(); // the debris is THIS theme's pixels (theme-keyed sampler; repaints only when it decoded something new)
  void paintLegend(theme);
}

/** The options legend (index.html .legend): five tiles as the board draws
 *  them — a wall, a hole, a crate, a door, a cracked wall — off the atlas
 *  under the theme and door set the board wears (atlas.mjs tileOf, the
 *  board's own resolver), so it cannot drift from the board. The DOM legend
 *  was five real cells under tiles.css; these are five 16×16 canvases. */
async function paintLegend(theme) {
  const cells = document.querySelectorAll('.legend canvas[data-legend]');
  if (!cells.length) return;
  const seq = (app.legendSeq = (app.legendSeq ?? 0) + 1);
  const atlas = await loadAtlas();
  if (seq !== app.legendSeq) return; // a later theme owns the paint
  const doors = doorsFor();
  const tile = (role) => atlas.tileOf(theme, role, { doors });
  const T = 16;
  for (const c of cells) {
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, T, T);
    const draw = (t, y = 0) => { if (t) g.drawImage(t.src, t.sx, t.sy, t.w, t.h, 0, y, t.w, t.h); };
    // the floor under everything: the theme's common flagstone, or the classic flat colour
    g.fillStyle = '#4a4a42';
    g.fillRect(0, 0, T, T);
    draw(theme ? tile('floor-1') : null);
    const kind = c.dataset.legend;
    if (kind === 'wall') draw(tile('wall'));
    else if (kind === 'cracked') {
      // the wall block with the crack masked to its pixels, as the board composes it
      const wall = tile('wall'), crack = atlas.crack(1);
      const scratch = document.createElement('canvas');
      scratch.width = T;
      scratch.height = T;
      const sg = scratch.getContext('2d');
      sg.imageSmoothingEnabled = false;
      if (wall) sg.drawImage(wall.src, wall.sx, wall.sy, wall.w, wall.h, 0, 0, T, T);
      if (crack) {
        sg.globalCompositeOperation = 'source-atop';
        sg.drawImage(crack.src, crack.sx, crack.sy, crack.w, crack.h, 0, 0, T, T);
      }
      g.drawImage(scratch, 0, 0);
    } else if (kind === 'hole') {
      const pit = theme ? tile('hole-0') : null;
      if (pit) draw(pit);
      else {
        g.fillStyle = '#0a0a0e';
        g.fillRect(0, 0, T, T);
        g.fillStyle = '#000';
        g.fillRect(0, 0, T, 3);
      }
    } else if (kind === 'crate') {
      const t = tile('crate');
      draw(t, t && t.h === 2 * T ? -T : 0); // a prop's lower half is its square
    } else if (kind === 'door') draw(tile('door'));
  }
}

function refreshCheatUI() {
  const inDuel = !!app.duel && (app.phase === 'playing' || app.phase === 'ended');
  $('btnUndo').hidden = !(cheatUndo() && inDuel);
  $('btnUndo').disabled =
    app.busy || !app.duel || !app.session || (app.duel.state === 'playing' && app.duel.turnColor() !== app.session.playerColor);
  $('eval-bar').hidden = !(cheatEval() && inDuel);
  // The replay log's flag: not a cheat, so it rides the duel alone.
  $('btnFlag').hidden = !inDuel;
}

function applyOptions() {
  saveOptions();
  syncOptionsUI();
  refreshCheatUI();
  refreshGodsUI();
  remountBoard(); // a scaling change remounts the board
  applyTheme();
  applyDebrisOptions(); // after the theme: the debris is that theme's pixels
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
 *  on, rank-coloured arrows + the hint list ("1 Nf3 +0.8 · 2 e4 +0.6 · 3 d4
 *  +0.5 · d14"). The evals live in the list, NOT on the arrows (designer
 *  2026-09-07: "I don't think the numbers are worth keeping [on the
 *  arrows]. Let's list them somewhere else"). `partial` marks a mid-search
 *  paint (the depth readout says so). */
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
  const items = [];
  for (const pv of sorted) {
    const m = pv.move.match(UCI_MOVE_RE);
    if (!m) continue;
    const strength = Math.max(0.2, Math.min(1, 1 - (best - cpOf(pv.score)) / 300));
    arrows.push({ from: m[1], to: m[2], strength, rank: pv.rank, kind: 'hint' });
    let san = pv.move;
    try {
      san = duel.board.sanMove(pv.move);
    } catch {
      /* keep uci */
    }
    items.push({ rank: pv.rank, san, score: pv.score ? fmtScore(pv.score) : null });
  }
  app.cheatArrows = arrows;
  renderPlayMarks();
  const depth = sorted[0].depth ?? cheat.depth;
  if (depth) cheat.depth = depth;
  setHintList(items, depth ? `d${depth}${partial ? '…' : ''}` : '');
}

/** The hint list in the player's bar: one entry per rank — a swatch in the
 *  rank's arrow colour (CSS, by class), the move and its eval — then the
 *  depth readout. Its textContent reads "1 Nf3 +0.8 · 2 e4 +0.6 · d14". */
function setHintList(items, depthText) {
  const el = $('hint-line');
  el.textContent = '';
  items.forEach((it, i) => {
    if (i) el.append(' · ');
    const span = document.createElement('span');
    span.className = `hint-item rank-${it.rank}`;
    span.dataset.rank = String(it.rank);
    span.append(`${it.rank} ${it.san}`);
    if (it.score) {
      const b = document.createElement('b');
      b.textContent = ` ${it.score}`;
      span.appendChild(b);
    }
    el.appendChild(span);
  });
  if (depthText) {
    if (items.length) el.append(' · ');
    const d = document.createElement('span');
    d.className = 'hint-depth';
    d.textContent = depthText;
    el.appendChild(d);
  }
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

/** One WHITE-POV eval of a bare FEN (mover-POV score negated for black).
 *  `go` defaults to the shallow delta readout; the deep probe passes the
 *  enemy's own limits and CLEARS THE HASH first (a probe on the table the
 *  reply search left behind misreads mates — the v4.2 lesson). */
async function probeEval(engine, fen, go = EVAL_PROBE_GO, { clearHash = false } = {}) {
  if (clearHash) engine.send('setoption name Clear Hash');
  engine.position({ fen });
  const mt = go.match(/movetime (\d+)/);
  const res = await engine.go(go, { timeout: mt ? parseInt(mt[1], 10) + 4000 : 60000 });
  const score = engine.lastScore(res);
  if (!score) throw new Error('eval probe returned no score');
  const depth = (res.infoLines[res.infoLines.length - 1]?.match(/ depth (\d+)/) ?? [])[1];
  const pov = fen.split(' ')[1] === 'w' ? score : { type: score.type, value: -score.value };
  if (depth) pov.depth = parseInt(depth, 10);
  return pov;
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
    const deep = {}; // the deep job's three verdicts, white POV
    const run = (async () => {
      if (job.kind === 'deep') {
        // The deep probe (2026-09-06): the board before the ply's move, the
        // board the gods edited, the board they left — at the enemy's own
        // limits, hash cleared — so a lost mate is pinned on the move or on
        // the quake. Up to three long searches; the seq check between them
        // lets the player's move cancel cleanly (the job stays queued).
        for (const [k, fen] of Object.entries(job.fens)) {
          if (!fen) continue;
          if (mySeq !== evalProbe.seq) return;
          syncDeepButton(`deep Δ ${Object.keys(deep).length + 1}/${Object.values(job.fens).filter(Boolean).length}…`);
          deep[k] = await probeEval(engine, fen, job.go, { clearHash: true });
        }
        return;
      }
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
        syncDeepButton();
        await evalProbeFailed(engine, e);
      }
      return;
    }
    if (mySeq !== evalProbe.seq) {
      syncDeepButton();
      return; // cancelled mid-probe; the job stays queued
    }
    evalProbe.active = null;
    evalProbe.engine = null;
    if (job.kind === 'deep') {
      evalProbe.failures = 0;
      evalProbe.queue.shift();
      job.ev.deepDelta = { go: job.go, pov: 'white', ...deep };
      appendGodsDeep(job.ev);
      renderGodsSummary();
      syncDeepButton();
      autosaveLog();
      continue;
    }
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
  godsBeforeOff({ repaint: false }); // the undo repaints the present itself
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
  debrisUndo(duel.ply); // the rewound plies' scars go with them (this epoch only)
  paintBoard(duel.fen());
  renderPlayMarks();
  log($('duel-log'), `↩ took back to ply ${duel.ply}`, 'warn');
  autosaveLog(); // the branch is on the record now
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
  if (show) {
    renderGodsSummary();
    syncBeforeButton();
    syncDeepButton();
  }
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
  // v4: heat is the record's recent temperature (hot plies over the window)
  // and scales the fill; the threats are what the last move created.
  const threats = dir.lastThreats?.length ? ` (${dir.lastThreats.join(' ')})` : '';
  $('gods-meters').textContent =
    `${funBit} · heat ${pctOf(dir.meter.heat)}${threats} · tedium ${pctOf(dir.meter.t)} · restlessness ${dir.meter.value.toFixed(1)}/${dir.meter.rampPlies} → ` +
    `pressure ${pctOf(dir.pressure(nextPly))}${dir.meter.deadFloor() > 0 && dir.meter.deadFloor() >= dir.meter.p() && dir.meter.deadFloor() >= dir.meter.floor(nextPly) ? ' (DEAD-BOARD floor)' : dir.meter.floor(nextPly) > dir.meter.p() ? ' (BACKSTOP floor)' : ''}`;

  const held = dir.holdInCheck && dir.lastTrace?.held ? ' · HELD (king in check)' : '';
  $('gods-summary').textContent =
    `next roll p${nextPly}: P(quake) ${pctOf(dir.pQuake(nextPly))} · ` +
    `budget ~${1 + Math.floor(dir.meter.t * dir.favor * dir.extraActions)} action(s) · ` +
    `debt ${dir.debt}/${dir.debtCap} · intensity ${dir.favor.toFixed(1)}${held}`;

  // The ladder, as it stands right now — rung weights are a pure function of
  // pressure and the terrain census, so showing them costs nothing.
  const terrain = terrainCensus(duel.fen(), duel.files, duel.ranks, dir.holes, dir.godCrates);
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
  if (t.outcome === 'vetoed') return 'warn';
  if (t.outcome === 'crumble' || t.outcome === 'terminal' || t.vetoed) return 'warn';
  if (t.outcome === 'starved') return 'bad';
  return 'ok'; // weaken / breach / displace
}

/** One compact line per roll trace — the per-ply record, reason codes and all. */
function godsTraceLine(t) {
  const meterBit =
    `meter ${t.meter?.toFixed(1) ?? '?'}${typeof t.meterAfter === 'number' ? `→${t.meterAfter.toFixed(1)}` : ''}` +
    ` · heat ${typeof t.heat === 'number' ? pctOf(t.heat) : '?'}${t.threats ? ` (+${t.threats} threat${t.threats === 1 ? '' : 's'})` : ''}` +
    `${typeof t.tedium === 'number' ? ` · tedium ${pctOf(t.tedium)}` : ''}` +
    ` · stale ${t.staleness === null || t.staleness === undefined ? '?' : pctOf(t.staleness)}`;
  if (t.outcome === 'quiet') {
    if (t.held) return `p${t.ply} · HELD — a king is in check, the gods sit it out`;
    const r = t.rolls.find((x) => x.roll === 'quake');
    return `p${t.ply} · ${meterBit} · P(q) ${pctOf(t.p.quake)}${r ? ` roll ${r.value.toFixed(2)} — quiet` : ' — before onset'}`;
  }
  const fmtScore = (s) => (!s ? '?' : s.type === 'mate' ? `#${s.value}` : `${s.value > 0 ? '+' : ''}${(s.value / 100).toFixed(1)}`);
  if (t.outcome === 'vetoed') {
    const g = t.evalGate ?? {};
    return `p${t.ply} QUAKE VETOED · ${meterBit} · eval gate: ${(g.rejected ?? []).length} draw${(g.rejected ?? []).length === 1 ? '' : 's'} softened the game (${fmtScore(g.before)} → ${(g.rejected ?? []).map((r) => `${fmtScore(r.after)} ${r.verdict}`).join(', ')}) — nothing lands, the meter is spent`;
  }
  const bits = [`p${t.ply} QUAKE`, meterBit];
  if (t.evalGate) {
    const g = t.evalGate;
    bits.push(`eval gate ${g.verdict} (${fmtScore(g.before)} → ${fmtScore(g.after)})${g.attempt ? ` on draw ${g.attempt + 1}${g.fallback ? ` (${g.fallback} fallback)` : ''} after ${(g.rejected ?? []).map((r) => r.verdict).join(', ')}` : ''}`);
  }
  if (t.p.crumbleForced) bits.push('crumble FORCED (debt cap)');
  // The budget is the headline now: what makes a quake unreadable is that the
  // number and kind of actions vary, so the trace shows both.
  const spent = t.rungsSpent ?? [];
  bits.push(`budget ${spent.length}/${t.budget ?? '?'} → ${spent.join(' + ') || 'nothing'}`);
  if (t.rungFallback?.length) bits.push(`fell back: ${t.rungFallback.join(', ')}`);
  // v4: what the gods were forbidden to touch — the threat ledger's pieces
  // and squares plus every forced win's net (tactics.mjs).
  if (t.protected) {
    const pr = t.protected;
    const wins = pr.wins ? `grid wins w${pr.wins.white}/b${pr.wins.black}` : '';
    const eng = pr.engine
      ? ` · engine ${pr.engine.mates} mate line${pr.engine.mates === 1 ? '' : 's'}${pr.engine.mates ? ` (${pr.engine.lines.map((l) => `${l.winner} #${l.mateIn} ${l.source}`).join(', ')})` : ''}` +
        `${pr.engine.probes ? ` from ${pr.engine.probes.ran} probe${pr.engine.probes.ran === 1 ? '' : 's'}${pr.engine.probes.fresh ? ' + the reply search' : ''}${pr.engine.probes.failed ? ` (${pr.engine.probes.failed} FAILED)` : ''}` : ''}`
      : '';
    bits.push(`protected ${pr.pieces} piece${pr.pieces === 1 ? '' : 's'} / ${pr.squares} sq · ${wins}${pr.truncated ? ' (search cut)' : ''}${eng}`);
  }

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

function appendGodsDeep(ev) {
  if (!godsDebug() || !ev.deepDelta) return;
  const d = ev.deepDelta;
  const bad = /LOST|LENGTHENED|FLIPPED/.test(deltaWords(d.pre, d.post, 'q'));
  log(
    $('gods-trace'),
    `p${ev.ply} DEEP Δ (${d.go}, white POV): before the move ${fmtScore(d.beforeMove)} → before the quake ${fmtScore(d.pre)} → after ${fmtScore(d.post)} — ${d.beforeMove ? deltaWords(d.beforeMove, d.pre, 'the move') + '; ' : ''}${deltaWords(d.pre, d.post, 'the quake')}`,
    bad ? 'bad' : 'ok'
  );
}

/** Rebuild the whole trace log from the record — undo truncates the ledger,
 *  so the DOM re-derives from it rather than trying to unpick lines. */
function rerenderGodsTrace() {
  const el = $('gods-trace');
  el.textContent = '';
  if (!app.duel) return;
  const byPly = new Map();
  for (const ev of app.duel.record.quakes) if (ev.evalDelta || ev.deepDelta) byPly.set(ev.ply, ev);
  for (const t of app.duel.record.quakeTraces) {
    log(el, godsTraceLine(t), godsTraceCls(t));
    if (byPly.has(t.ply)) {
      appendGodsDelta(byPly.get(t.ply));
      appendGodsDeep(byPly.get(t.ply));
    }
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

// ---- the replay log's in-game half (2026-09-06): before/after + deep Δ ----
// "Did the gods just wreck my position?" answered in the moment, from the
// record: the last quake's pre-quake board painted on the real board, and
// a probe of that quake's boards at the enemy's own depth. Both read the
// record.quakes entry the duel already keeps; nothing is re-derived.

function lastQuakeEv() {
  const q = app.duel?.record.quakes;
  return q && q.length ? q[q.length - 1] : null;
}

/** The ledgers as they stood before a quake: the state of the previous
 *  ply (post-quake of ITS ply; a quake fires after its ply's move, so the
 *  previous state is exactly the pre-quake ledgers). */
function preQuakeLedgers(ev) {
  const st = app.duel?.record.states.find((s) => s.ply === ev.ply - 1 && !s.ended) ?? null;
  return { holes: new Set(st?.holes ?? []), godCrates: new Set(st?.godCrates ?? []) };
}

function canGodsBefore() {
  const duel = app.duel;
  return !!duel && duel.state === 'playing' && !app.busy && duel.turnColor() === app.session?.playerColor && !!lastQuakeEv();
}

/** Paint the board as it stood before the last quake. Player's turn only;
 *  the board is non-interactive while it shows the past, and any move,
 *  quake or undo paints the present again (godsBeforeOff). */
function godsBeforeOn() {
  if (!canGodsBefore()) return false;
  const ev = lastQuakeEv();
  app.godsBefore = { ply: ev.ply };
  app.selectedSquare = null;
  app.boardUI.setInteractive(false);
  app.boardUI.setPosition(ev.preFen, { ...preQuakeLedgers(ev), skins: stageSkins(app.session?.deal?.stage), opened: app.residue.opened, rubble: app.residue.rubble, debris: debrisPainter() });
  app.boardUI.setMarks({});
  setStatus(`the board before the gods' quake at ply ${ev.ply} — "after" returns to now`);
  syncBeforeButton();
  return true;
}

function godsBeforeOff({ repaint = true } = {}) {
  if (!app.godsBefore) return;
  app.godsBefore = null;
  syncBeforeButton();
  if (!repaint || !app.duel?.board) return;
  paintBoard(app.duel.fen()); // residue: the live fen never changed under the past, so no diff
  renderPlayMarks();
  if (canGodsBefore()) {
    app.boardUI.setInteractive(true);
    setStatus('your move');
  }
}

function syncBeforeButton() {
  const b = $('btnGodsBefore');
  if (!b) return;
  b.textContent = app.godsBefore ? `after (p${app.godsBefore.ply})` : 'before';
  b.classList.toggle('on', !!app.godsBefore);
  b.disabled = !app.godsBefore && !canGodsBefore();
}

function syncDeepButton(label = null) {
  const b = $('btnGodsDeep');
  if (!b) return;
  const ev = lastQuakeEv();
  const queued = evalProbe.queue.some((j) => j.kind === 'deep');
  b.textContent = label ?? (queued ? 'deep Δ queued' : 'deep Δ');
  b.classList.toggle('on', !!label || queued);
  b.disabled = !ev || !!ev.deepDelta || queued || !!label || app.duel?.state !== 'playing';
}

/** Queue the deep probe of the last quake: the board before the ply's
 *  move, the board the gods edited, the board they left — at the enemy's
 *  own limits (`duel.go`, up to 10 s each on the phone), in the player's
 *  idle window, ahead of the shallow delta and the hint probe. The verdict
 *  lands on the record.quakes entry (`deepDelta`) and the trace panel. */
function godsDeepNow() {
  const duel = app.duel;
  const ev = lastQuakeEv();
  if (!duel || !ev || duel.state !== 'playing' || ev.deepDelta) return false;
  if (evalProbe.queue.some((j) => j.kind === 'deep' && j.ev === ev)) return false;
  const st = duel.record.states.find((s) => s.ply === ev.ply - 1 && !s.ended) ?? null;
  evalProbe.queue.unshift({ kind: 'deep', duel, ev, go: duel.go, fens: { beforeMove: st?.fen ?? null, pre: ev.preFen, post: ev.postFen } });
  log($('gods-trace'), `deep Δ @p${ev.ply} queued — ${duel.go} × ${st ? 3 : 2}, runs while you think`, 'ok');
  syncDeepButton();
  // A flight already in the air (the hint probe, usually) returns itself
  // from runIdleProbes and would never reach the new job this turn: kick
  // again once it lands. ("Keep evaluating" holds the engine all turn — the
  // job then runs on the next one.)
  const kick = () => {
    if (canGodsBefore()) void runIdleProbes();
  };
  if (idleProbesFlight) idleProbesFlight.then(kick, kick);
  else kick();
  return true;
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

// ------------------------------------------------------ the replay log (2026-09-06)
// The duel records everything (duel.mjs `record`); replaylog.mjs builds the
// one export object, delivers it and keeps the last few games. This block is
// the host's half: what the duel cannot know (build, device, engine build,
// the options in force), when to autosave, and the buttons.

/** What the duel does not know about itself. */
function logMeta() {
  return {
    app: APP_BUILD,
    ua: navigator.userAgent,
    url: location.origin + location.pathname,
    query: location.search || null,
    engine: app.engine?.id ?? null,
    probeGo: probeGo(),
    fx: FX_SCALE,
    options: {
      cheat: options.cheat,
      hints: options.hints,
      hintN: options.hintN,
      hintCont: !!options.hintCont,
      undo: options.undo,
      evalBar: options.evalBar,
      godPreset: options.godPreset,
      godCustom: options.godCustom,
      godLadder: options.godLadder,
      godsDebug: options.godsDebug,
    },
    godConfig: godConfig(),
  };
}

/** Everything a replay or offline analysis needs, from the one ledger —
 *  the debug overlay's copy button, the Export buttons, the autosave and
 *  `__DCK.log.build()` all return this same object. */
function godsExportData() {
  if (!app.duel) return null;
  return buildLog({ duel: app.duel, session: app.session, meta: logMeta() });
}

/** The live duel's id for the autosave ring: one slot per game, rewritten
 *  after every ply (the record survives a reload or a dead tab). */
function logId() {
  const d = app.duel;
  return d ? `${app.session?.id ?? 'duel'}:${app.session?.deal?.seed ?? 0}:${d.record.startedAt}` : null;
}

let autosaveWarned = false;
function autosaveLog() {
  const d = app.duel;
  if (!d) return false;
  const data = godsExportData();
  if (!data) return false;
  if (app.logSlot === null) app.logSlot = logStore.claim(logId());
  const ok = logStore.save(app.logSlot, data, {
    id: logId(),
    stage: data.stage,
    title: data.title,
    seed: data.setupSeed,
    plies: data.plies,
    result: data.result,
    termination: data.termination,
    quakes: data.quakes.length,
    branches: data.branches.length,
    flags: data.flags.length,
  });
  if (!ok && !autosaveWarned) {
    autosaveWarned = true;
    log($('duel-log'), '⚠ replay log autosave unavailable (storage full or blocked) — export before leaving', 'warn');
  }
  return ok;
}

/** Get the live duel's log off the device (share → download → clipboard). */
async function exportCurrentLog(force = null) {
  const data = godsExportData();
  if (!data) {
    setStatus('no duel to export');
    return null;
  }
  const json = JSON.stringify(data);
  const how = await deliverLog(json, { force, filename: logFileName(data), doc: document, nav: navigator });
  const said = { shared: 'log shared', downloaded: 'log downloaded', copied: 'log copied to clipboard', console: 'log dumped to console (nothing else worked)', cancelled: 'export cancelled' }[how] ?? how;
  const line = `${said} (${logSize(json)})`;
  log($('duel-log'), `⎙ ${line}`, how === 'console' ? 'bad' : 'ok');
  if (godsDebug()) log($('gods-trace'), line, how === 'console' ? 'bad' : 'ok');
  setStatus(line);
  return how;
}

/** The player's own "look at this" mark on the record, with an optional note. */
function flagMoment() {
  const d = app.duel;
  if (!d) return null;
  const note = prompt('Flag this moment for the replay log — a note (optional):', '');
  if (note === null) return null; // cancelled
  const f = d.flag(note);
  log($('duel-log'), `⚑ flagged ply ${f.ply}${note ? ` — ${note}` : ''}`, 'warn');
  autosaveLog();
  return f;
}

/** The setup screen's saved-logs row: the autosave ring, newest first. */
function refreshSavedLogs() {
  const idx = logStore.index();
  const box = $('saved-logs');
  const sel = $('savedLogSel');
  sel.textContent = '';
  for (const e of idx) {
    const opt = document.createElement('option');
    opt.value = String(e.slot);
    const when = e.at ? new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?';
    const outcome = e.result ? `${e.result} ${e.termination ?? ''}`.trim() : 'unfinished';
    opt.textContent = `${when} · ${e.title ?? e.stage ?? 'duel'} · ${e.plies ?? 0} plies · ${outcome}${e.branches ? ` · ${e.branches} undo${e.branches === 1 ? '' : 's'}` : ''}${e.flags ? ` · ${e.flags} flag${e.flags === 1 ? '' : 's'}` : ''}`;
    sel.appendChild(opt);
  }
  box.hidden = idx.length === 0;
}

async function exportSavedLog(force = null) {
  const slot = parseInt($('savedLogSel').value, 10);
  const json = Number.isInteger(slot) ? logStore.loadJson(slot) : null;
  if (!json) {
    setStatus('no saved log');
    return null;
  }
  let data = null;
  try {
    data = JSON.parse(json);
  } catch {
    /* deliver the raw text anyway */
  }
  const how = await deliverLog(json, { force, filename: logFileName(data ?? {}), doc: document, nav: navigator });
  const said = { shared: 'log shared', downloaded: 'log downloaded', copied: 'log copied to clipboard', console: 'log dumped to console', cancelled: 'export cancelled' }[how] ?? how;
  setStatus(`${said} (${logSize(json)})`);
  return how;
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
  const stale = app.boardUI && app.boardUI.scaling !== scalingFor();
  if (!app.boardUI || stale || app.boardUI.files !== files || app.boardUI.ranks !== ranks) {
    if (app.boardUI) app.boardUI.destroy();
    app.boardUI = createBoard($('board'), {
      files,
      ranks,
      flipped: false, // the player is always White at the bottom
      onSquareTap: onSquareTap,
    });
    app.residue.lastFen = null;
  }
  app.previewPaint = { files, ranks, fen, skins };
  paintWithDebris(fen, { skins }); // the stage's scars from earlier duels (the debris ledger)
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
    debrisBind(null); // the setup's flip and crop, no auto-crop
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
  debrisBind(deal); // the stage's ledger + this deal's transform into it
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
  app.residue = { opened: new Set(), rubble: new Set(), lastFen: null, lastHoles: null, lastCrates: null };
  // The debris layer: this duel is a new EPOCH on the stage's floor (its
  // scars stay; blood dries, flecks settle).
  debrisBind(deal);
  app.debris.ledger?.beginEpoch();
  app.debris.dryPly = -1;
  app.debris.urls.clear();
  debrisSave();
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
  app.logSlot = null; // a fresh duel claims its own autosave slot
  app.godsBefore = null;
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
    // v4.2: the gods' mate probes when a quake is due (`?mateprobe=off` to
    // silence them, or a `depth N movetime M` pair to retune).
    mateGo: params.get('mateprobe') === 'off' ? null : (params.get('mateprobe') ?? undefined),
    // v4.3: the eval gate — `?evalgate=off` to let every composition land.
    evalGate: params.get('evalgate') === 'off' ? null : undefined,
    hooks: { onMove, onQuake, onEnd, onEngineInfo, onEngineStall, onDirectorTrace },
  });
  await app.duel.start();
  paintBoard(app.duel.fen());
  applyTheme();
  app.boardUI.setMarks({});
  refreshGodsUI();
  refreshCheatUI(); // the flag button rides the duel
  autosaveLog(); // the start position, before anyone moves
  if (app.duel.state === 'playing') await driveTurn();
}

// --------------------------------------------------------------------- play

async function driveTurn() {
  const duel = app.duel;
  if (!duel || duel.state !== 'playing') return;
  autosaveLog(); // every completed ply lands in the autosave ring
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

// ------------------------------------------------------- THE DEBRIS LAYER
// (2026-09-07 — play/js/debris.mjs is the ledger + painter, particles.mjs
// the flight; this is the game's wiring.) The floor remembers: a capture
// leaves blood, a smashed crate its splinters, a broken wall its stone, a
// displacement its skid, and every square wears down with traffic. The
// LEDGER BELONGS TO THE ENVIRONMENT, AND THE ENVIRONMENT IS THE WORLD
// (Phase 2 milestone 4, 2026-09-08; world.mjs): on this page the world IS
// the dealt arena — the stage as flipped and cropped for the deal — so the
// ledger is one per arena (keyed by the transformed stage's id), in the
// arena's own grid, the transform the identity, saved in localStorage and
// kept across duels on the same arena until the run save (milestone 4b)
// takes it over. Each duel is an EPOCH on the floor (blood dries, flecks
// settle). Toggles filter at paint time, never at record time, so a toggle
// flipped mid-game shows the whole history. Undo forgets this epoch's
// events past the rewound ply and recounts the traffic from the record.

const DEBRIS_KEY = 'dck.debris.v1:';
const DEBRIS_DEFAULTS = { destruction: true, blood: true, skid: true, wear: true, fx: true, intensity: 1, v: 2 };
const DEBRIS_INTENSITY_RANGE = [0, 2];

/** The live debris options: `?debris=` (test-only — `off`, `all`, or a comma
 *  list of destruction/blood/skid/wear/fx) over the saved Options. */
function debrisOpts() {
  const o = { ...DEBRIS_DEFAULTS, ...(options.debris ?? {}) };
  const p = params.get('debris');
  if (p == null) return o;
  if (p === 'off' || p === '0') return { ...o, destruction: false, blood: false, skid: false, wear: false, fx: false };
  if (p === 'all' || p === '1') return { ...o, destruction: true, blood: true, skid: true, wear: true };
  const set = new Set(p.split(',').map((s) => s.trim()).filter(Boolean));
  return { ...o, destruction: set.has('destruction'), blood: set.has('blood'), skid: set.has('skid'), wear: set.has('wear'), fx: set.has('fx') };
}

/** The ARENA a deal stands on — the world of this page (its ledger's
 *  environment): the deal's transformed stage, or the setup's transformed
 *  terrain when nothing deals. */
function debrisStageOf(deal) {
  if (deal?.ok && deal.stage) return deal.stage;
  const stage = currentStage();
  if (!stage) return null;
  try {
    return cropStage(setup.flip ? flipStageVertical(stage) : stage, setup.cropTop | 0, setup.cropBottom | 0);
  } catch {
    return setup.flip ? flipStageVertical(stage) : stage;
  }
}

/** Open (load or create) the environment's ledger. */
function debrisEnvOpen(stage) {
  const D = app.debris;
  if (!stage) return null;
  if (D.ledger && D.envId === stage.id) return D.ledger;
  D.envId = stage.id;
  D.ledger = null;
  try {
    const raw = localStorage.getItem(DEBRIS_KEY + stage.id);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && obj.v === 1 && obj.files === stage.files && obj.ranks === stage.ranks) D.ledger = DebrisLedger.load(obj);
    }
  } catch {
    /* a corrupt save is a clean floor */
  }
  if (!D.ledger) D.ledger = new DebrisLedger({ id: stage.id, files: stage.files, ranks: stage.ranks });
  D.urls.clear();
  D.pending.clear();
  return D.ledger; // applyTheme warms the sampler once the board wears its theme
}

/** Bind the ledger of the arena the board shows (the world of this page)
 *  and the identity transform into it. A failed deal (the terrain-only
 *  preview) binds the setup's transformed terrain. */
function debrisBind(deal) {
  const stage = debrisStageOf(deal);
  if (!stage) return;
  debrisEnvOpen(stage);
  app.debris.tx = identityTransform(stage.files, stage.ranks);
  app.debris.urls.clear();
}

function debrisSave(now = false) {
  const D = app.debris;
  if (!D.ledger) return;
  clearTimeout(D.saveTimer);
  const write = () => {
    D.saveTimer = null;
    try {
      localStorage.setItem(DEBRIS_KEY + D.ledger.id, JSON.stringify(D.ledger.serialize()));
    } catch {
      /* QoL only */
    }
  };
  if (now) write();
  else D.saveTimer = setTimeout(write, 300);
}

/** Sprite pixels by the debris layer's sprite NAME (debris.mjs spriteVar —
 *  the custom-property spelling of the DOM era, kept as the ledger's key),
 *  read off THE ATLAS for the theme and door set the board wears (atlas.mjs
 *  tileOf: the cascade the board paints by, on data), decoded once each.
 *  `get` is synchronous — the painter is — so `ensure` warms what an event
 *  needs before it is recorded. (Until 2026-09-07 the sampler decoded the
 *  sprites off the board's computed style, tiles.css's data URIs; the DOM
 *  board's retirement made the atlas the one art source.) */
function debrisSampler() {
  const D = app.debris;
  if (D.sampler) return D.sampler;
  // Keyed by THEME + DOOR SET + name: the same name is a different sprite
  // under each art set, and the board's theme can change under a warm-up.
  const cache = new Map();
  const themeKey = () => `${$('board').dataset.theme ?? ''}|${$('board').dataset.doors ?? ''}|`;
  // --tile-wall-<m> → wall-<m> · --tile-wall → wall · --tile-floor-<v> → floor-<v> · --sprite-<role>[-N] → <role>[-N]
  const roleOf = (name) => (name.startsWith('--tile-') ? name.slice(7) : name.startsWith('--sprite-') ? name.slice(9) : null);
  D.sampler = {
    get: (name) => (name ? cache.get(themeKey() + name) ?? null : null),
    has: (name) => cache.has(themeKey() + name),
    /** Decode what is not cached yet; returns how many sprites are NEW, so
     *  a warm-up knows whether to repaint. */
    async ensure(names) {
      const want = [...new Set(names.filter(Boolean))];
      if (!want.some((n) => !cache.has(themeKey() + n))) return 0;
      const atlas = await loadAtlas();
      const board = $('board');
      const theme = board.dataset.theme ?? null, doors = board.dataset.doors ?? null;
      const tk = themeKey();
      let fresh = 0;
      for (const n of want) {
        const key = tk + n;
        if (cache.has(key)) continue;
        const role = roleOf(n);
        const tile = role ? atlas.tileOf(theme, role, { doors }) : null;
        const px = tile ? Atlas.pixelsOf(tile) : null; // null: the material palette stands in
        cache.set(key, px);
        if (px) fresh++;
      }
      return fresh;
    },
    invalidate: () => cache.clear(),
    get size() {
      return cache.size;
    },
  };
  return D.sampler;
}

/** Warm the sampler with everything this floor and this board can break:
 *  every recorded event's sprite, the arena's standing skins, its wall
 *  cases and the floors. Then repaint, because cells painted before the
 *  warm-up carried palette stand-ins. */
async function debrisWarm() {
  const D = app.debris;
  if (!D.ledger || typeof Image === 'undefined') return;
  const names = new Set();
  for (const ev of D.ledger.events) names.add(spriteVar({ role: ev.role, v: ev.v, mask: ev.mask }));
  for (let v = 1; v <= 6; v++) names.add(`--tile-floor-${v}`);
  if (D.kinds) {
    for (const [sq, k] of D.kinds) {
      if (k.wallTile || k.cracked || k.weak) names.add(`--tile-wall-${k.mask}`);
      else if (k.skin) names.add(spriteVar(debrisSrcOf(sq, k)));
    }
  }
  const token = (D.warmSeq = (D.warmSeq ?? 0) + 1);
  const fresh = await debrisSampler().ensure([...names]);
  if (!fresh || token !== D.warmSeq) return; // nothing new, or a later warm-up owns the repaint
  D.urls.clear();
  debrisRepaint();
}

/** What a square's terrain was wearing, as the debris layer records it: the
 *  wall case for stone (a wall, a god-cracked wall, authored masonry), the
 *  door leaf or its double's half AS THE SCREEN DEALS IT (the camera; an
 *  edge-on door is the leaf — its splinters are the leaf's wood), else the
 *  skin and the variant this square shows (board-ui skinVariantIndex on the
 *  environment's coordinates, the same the board hashes on). */
function debrisSrcOf(sq, k) {
  if (!k) return null;
  const [hf, hr] = hashCoordsOf(sq);
  if (k.wallTile || k.cracked || k.weak) return { role: 'wall', v: 0, mask: k.mask };
  if (k.hole) return null;
  if (k.skin === 'door') {
    const half = app.boardUI?.doorHalfOf?.(sq) ?? null;
    return { role: half ? `door2-${half}` : 'door', v: 1, mask: -1 };
  }
  if (k.furniture) return { role: k.skin ?? 'crate', v: skinVariantIndex(hf, hr), mask: -1 };
  return { role: 'floor', v: floorVariantIndex(hf, hr), mask: -1 };
}

function debrisPaintCtx(o = debrisOpts()) {
  const D = app.debris;
  return {
    sprites: debrisSampler(),
    toggles: { destruction: o.destruction, blood: o.blood, skid: o.skid, wear: o.wear },
    intensity: o.intensity * DEBRIS_BASELINE, // the slider's 100% is the designer's 200%
    ply: app.duel?.ply ?? 0,
    epoch: D.ledger?.epoch ?? 0,
    pending: D.pending,
  };
}

/** The square's debris buffer (16×16 RGBA, or null for a clean floor), from
 *  the per-env-cell paint cache; the cache is dropped by an event, an undo,
 *  a toggle or a theme. Floor only (debris.mjs kindIsFloor). */
function debrisBufFor(sq, k, ctx) {
  const D = app.debris;
  if (!kindIsFloor(k)) return null;
  const { ef, er } = toEnvCell(D.tx, sq);
  if (!D.ledger.inBounds(ef, er)) return null;
  const i = D.ledger.cellIndex(ef, er);
  if (D.urls.has(i)) return D.urls.get(i);
  const buf = paintCell(D.ledger, ef, er, ctx);
  D.urls.set(i, buf);
  return buf;
}

/** The painter board-ui setPosition calls per square: the buffer its debris
 *  image should show (setDebris encodes it, decodes the new image off the
 *  DOM and swaps it in over the old one — nothing on the cell's own style,
 *  never a frame without its debris). */
function debrisPainter() {
  const D = app.debris;
  if (!D.ledger || !D.tx) return null;
  const o = debrisOpts();
  if (!o.destruction && !o.blood && !o.skid && !o.wear) return null;
  const ctx = debrisPaintCtx(o);
  return (sq, k) => debrisBufFor(sq, k, ctx);
}

/** Every live paint of the board goes through here: the terrain classes
 *  (setPosition) plus the debris layer, and the kinds are remembered for
 *  the flight's landing and the warm-up. */
function paintWithDebris(fen, ledgers) {
  const D = app.debris;
  D.kinds = classifyTerrain(fen, ledgers, app.boardUI.files, app.boardUI.ranks);
  debrisDryTick();
  app.boardUI.setPosition(fen, { ...ledgers, debris: debrisPainter() });
}

/** Blood dries DRY_PLIES plies after the kill: the cells of a kill crossing
 *  that line repaint (everything else about age is per epoch). */
function debrisDryTick() {
  const D = app.debris;
  const ply = app.duel?.ply ?? 0;
  if (!D.ledger || D.dryPly === ply) return;
  D.dryPly = ply;
  for (const ev of D.ledger.events) if (ev.k === 'kill' && ev.e === D.ledger.epoch && ply - ev.p === DRY_PLIES) for (const i of D.ledger.cellsOf(ev)) D.urls.delete(i);
}

/** Repaint the board as it stands (a toggle, a theme, a warm-up). Never
 *  under a held quake frame — the commit that follows carries it. */
function debrisRepaint() {
  if (!app.boardUI) return;
  if ((app.phase === 'playing' || app.phase === 'ended') && app.duel) {
    if (app.busy && app.phase === 'playing') return;
    if (app.residue.lastFen && !app.godsBefore) paintBoard(app.residue.lastFen);
  } else if (app.phase === 'preview' && app.previewPaint) {
    const p = app.previewPaint;
    mountPreviewBoard(p.files, p.ranks, p.fen, p.skins);
  }
}

/**
 * Record an event on an arena square: `k` the kind, `sq` where, `to` the
 * landing square of a skid, (dx, dy) the direction in arena screen space
 * (right, down — a blow away from the attacker), `src` what stood there
 * (debrisSrcOf). Warms the sprite first so the painter and the flight see
 * the same pixels. Returns the stored event (env space).
 */
async function debrisEvent({ k, sq, to = null, dx = 0, dy = 0, src = null, n = 1, ply = app.duel?.ply ?? 0 }) {
  const D = app.debris;
  if (!D.ledger || !D.tx) return null;
  const origin = toEnvPx(D.tx, sq);
  const d = envDir(D.tx, dx, dy);
  const ev = { k, x: origin.x, y: origin.y, dx: d.dx, dy: d.dy, p: ply, s: D.ledger.next, src, n };
  if (to) {
    const e2 = toEnvPx(D.tx, to);
    ev.x2 = e2.x;
    ev.y2 = e2.y;
  }
  if (src) await debrisSampler().ensure([spriteVar(src)]);
  const stored = D.ledger.add(ev);
  for (const i of D.ledger.cellsOf(stored)) D.urls.delete(i);
  debrisSave();
  return stored;
}

function debrisParticles() {
  const D = app.debris;
  if (!D.particles || D.particles.ui !== app.boardUI) D.particles = new Particles(app.boardUI);
  return D.particles;
}

/** Land an event: its cells' debris images are re-encoded, decoded and
 *  swapped in (a flight lands between paints; setDebris touches nothing
 *  else on the cell). Resolves when the swaps have landed — a few ms — so
 *  a held flight is released only once the debris is really under it. */
async function debrisLand(ev) {
  const D = app.debris;
  if (!ev || !D.ledger || !D.tx) return;
  D.pending.delete(ev.id);
  const painter = debrisPainter();
  const swaps = [];
  for (const i of D.ledger.cellsOf(ev)) {
    D.urls.delete(i);
    const ef = i % D.ledger.files, er = (i - ef) / D.ledger.files;
    const sq = fromEnvCell(D.tx, ef, er);
    if (!sq || !app.boardUI?.cells.has(sq)) continue;
    const k = D.kinds?.get(sq);
    swaps.push(app.boardUI.setDebris(sq, painter && k ? painter(sq, k) : null));
  }
  await Promise.race([Promise.all(swaps), wait(250)]);
}

/**
 * Fly an event's chunks and land them. `shatter` = the src whose sprite
 * bursts into 2×2 blocks (the thing that broke), `inward` for the crumble
 * (the floor's blocks fall into the pit), `sq` the square whose sprite the
 * flight replaces. Never throws; with the flight off (option, ?fx=0,
 * reduced motion) the debris simply appears. Runs while the engine thinks.
 */
async function debrisFly(ev, { shatter = null, inward = false, sq = null, ms = 320, after = null } = {}) {
  const D = app.debris;
  if (!ev) return;
  const o = debrisOpts();
  const fxMs = FX(ms);
  if (!o.fx || !fxMs || !o[CATEGORY[ev.k]] || !app.boardUI) {
    // No flight: the debris appears when the thing that made it is gone —
    // after the rung's own animation (`after`), never before the wall has
    // broken (the first cut dropped the stone on the floor at the start of
    // the burst: "the transition is not smooth at all").
    if (after) await after;
    await debrisLand(ev);
    return;
  }
  D.pending.add(ev.id);
  for (const i of D.ledger.cellsOf(ev)) D.urls.delete(i);
  let flight = null;
  const P = debrisParticles();
  try {
    const ctx = debrisPaintCtx(o);
    const chunks = chunksOf(ev, debrisSampler(), ctx);
    const sprite = shatter ? debrisSampler().get(spriteVar(shatter)) : null;
    const eph = sprite ? shatterOf(ev, sprite, { intensity: ctx.intensity, inward }) : [];
    if (sq && sprite && !inward) app.boardUI.shatterSprite(sq);
    if (ev.k === 'skid') flight = P.streak({ tx: D.tx, chunks, ms: fxMs });
    else {
      const arc = Particles.arcFor(ev.m);
      flight = P.fly({ tx: D.tx, chunks, eph, origin: { x: ev.x, y: ev.y }, ms: fxMs, hop: arc.hop, bounce: arc.bounce });
    }
    await flight.landed; // the chunks are down and HELD on the flight layer
  } catch (e) {
    console.warn('debris flight', e);
  }
  await debrisLand(ev); // the cells wear the debris under the held chunks…
  if (flight) P.release(flight.id); // …and then the chunks leave the flight layer
}

/** The capture a move made, if any: the square whose occupant vanished
 *  (the landing square, or the pawn taken en passant — never the mover's
 *  own from-square) and whether it was a piece or terrain. */
function debrisCaptureOf(prevFen, nextFen, from, to) {
  if (!prevFen || !nextFen) return null;
  const before = getSquare(prevFen, to);
  if (before && before !== WALL) return { sq: to, victim: before === FURNITURE ? 'terrain' : 'piece', char: before };
  // En passant: the mover is a pawn, the victim stands beside the from-rank on the to-file.
  const ep = to[0] + from.slice(1);
  if (ep !== from && ep !== to) {
    const b = getSquare(prevFen, ep);
    if (b && b !== WALL && b !== FURNITURE && !getSquare(nextFen, ep)) return { sq: ep, victim: 'piece', char: b };
  }
  return null;
}

/** Traffic: the landing square and, for a straight move, every square it
 *  passed over (a slider wears the file it runs on). */
function debrisTraffic(from, to) {
  const D = app.debris;
  if (!D.ledger || !D.tx) return;
  const a = parseSquare(from), b = parseSquare(to);
  const visit = (f, r) => {
    const { ef, er } = toEnvCell(D.tx, squareName(f, r));
    const before = wearLevel(D.ledger.trafficAt(ef, er));
    D.ledger.visit(ef, er);
    if (wearLevel(D.ledger.trafficAt(ef, er)) !== before) D.urls.delete(D.ledger.cellIndex(ef, er));
  };
  const ar = a.rankFromBottom, br = b.rankFromBottom;
  visit(b.file, br);
  const df = Math.sign(b.file - a.file), dr = Math.sign(br - ar);
  const straight = a.file === b.file || ar === br || Math.abs(b.file - a.file) === Math.abs(br - ar);
  if (!straight) return;
  for (let f = a.file + df, r = ar + dr; f !== b.file || r !== br; f += df, r += dr) visit(f, r);
}

/** Undo: forget this epoch's events past the ply, recount its traffic. */
function debrisUndo(ply) {
  const D = app.debris;
  if (!D.ledger || !D.tx || !app.duel) return;
  D.ledger.dropAfter(ply);
  D.ledger.resetEpochTraffic();
  for (const uci of app.duel.record.moves) {
    const p = uci.match(UCI_MOVE_RE);
    if (p) debrisTraffic(p[1], p[2]);
  }
  D.pending.clear();
  D.urls.clear();
  debrisSave();
}

/** Options → Debris: stamp the enabled kinds on the board (data-debris —
 *  CSS and the tests read it), drop the paint cache, repaint. (A theme
 *  change went through applyTheme just before, which warms the sampler.) */
function applyDebrisOptions() {
  const D = app.debris;
  const o = debrisOpts();
  const board = $('board');
  const on = CATEGORIES.filter((c) => o[c]);
  board.dataset.debris = on.length ? [...on, ...(o.fx ? ['fx'] : [])].join(' ') : 'off';
  D.urls.clear();
  debrisRepaint();
}

/** Forget every mark on this stage (or every stage). */
function debrisClean(all = false) {
  const D = app.debris;
  if (all) {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(DEBRIS_KEY)) localStorage.removeItem(k);
    } catch {
      /* QoL only */
    }
  }
  if (D.ledger) {
    D.ledger.clear();
    debrisSave(true);
  }
  D.urls.clear();
  D.pending.clear();
  debrisRepaint();
}

// ---------------------------------------------------------------------------

/** Paint a position with the Director's terrain ledgers, so a crumbled '*'
 *  renders as a hole and a god-weakened '^' as a cracked wall (board-ui.mjs
 *  setPosition). Every LIVE-duel paint goes through here; the setup preview
 *  has no Director and paints bare (every '*' stone, every '^' a crate). */
function paintBoard(fen) {
  const dir = app.duel?.director;
  const skins = stageSkins(app.session?.deal?.stage);
  const res = app.residue;
  const holes = new Set(dir?.holes ?? []), godCrates = new Set(dir?.godCrates ?? []);
  if (res.lastFen && res.lastFen !== fen) {
    // Terrain that stood on the LAST paint and is gone now leaves its residue
    // (board-ui residueStep — the one rule, on data, shared with the replay
    // analyzer; until 2026-09-07 this read the last paint's cell classes):
    // a door its OPEN DOORWAY (posts where its walls stand — above and
    // below for a north–south door since the camera, 2026-09-08); a wall,
    // a cracked wall or authored masonry the RUIN stub (round 10: "cracked
    // walls turning into open doors doesn't make any sense"); any other
    // furniture (a crate, a barrel, a chest…) nothing — it never continued
    // a wall line. Judged on the last paint's OWN ledgers (a wall can crack
    // and then break; undo brings terrain back and clears its residue).
    const step = residueStep({ fen: res.lastFen, holes: res.lastHoles, godCrates: res.lastCrates, opened: res.opened, rubble: res.rubble }, { fen, holes }, skins, app.boardUI.files, app.boardUI.ranks);
    res.opened = step.opened;
    res.rubble = step.rubble;
  }
  res.lastFen = fen;
  res.lastHoles = holes;
  res.lastCrates = godCrates;
  paintWithDebris(fen, { holes, godCrates, skins, opened: res.opened, rubble: res.rubble });
}

/** Compose all in-play board marks (selection, check, the gods' terrain
 *  residue by rung, and the arrows: the enemy's last move, the gods'
 *  displacements, the oracle's hints). */
function renderPlayMarks() {
  const q = app.quakeMarks;
  const last = lastMoveArrow();
  const marks = {
    check: checkMark(),
    arrows: [...(last ? [last] : []), ...(q?.arrows ?? []), ...app.cheatArrows],
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

/** The ENEMY's most recent move as a red arrow (round 13: "stop trying to
 *  indicate the previous move with the square color filters"), shown
 *  while it is the last move played — from the reply until the player
 *  answers it; the player's own move gets no arrow. */
function lastMoveArrow() {
  const duel = app.duel;
  const moves = duel?.record.moves;
  if (!moves || !moves.length) return null;
  if (duel.turnColor() !== app.session.playerColor) return null; // the player moved last
  const p = moves[moves.length - 1].match(UCI_MOVE_RE);
  return p ? { from: p[1], to: p[2], strength: 1, kind: 'last' } : null;
}

async function playPlayerMove(from, to, matches) {
  let uci = matches[0];
  if (matches.length > 1 || (matches[0].match(UCI_MOVE_RE) ?? [])[3]) {
    // Promotion (§4.4): several suffixed moves for one from-to pair.
    const letters = [...new Set(matches.map((m) => (m.match(UCI_MOVE_RE) ?? [])[3]).filter(Boolean))];
    if (letters.length) {
      const choice = await pickPromotion(letters, { pieces: piecesFor(), atlas: app.boardUI?.atlas ?? null });
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
  godsBeforeOff({ repaint: false }); // the past leaves the board before the present moves on it
  clearHints(); // stale the moment the position changes
  // duel.#push mutates its own board but renders nothing, so the DOM still
  // holds the PRE-move position here — which is exactly what the FLIP clone
  // needs to slide from. The engine's reply gets the longer slide: the player
  // did not choose it and has to read it.
  const parts = uci.match(UCI_MOVE_RE);
  // THE DEBRIS LAYER: what this move broke. The board before the move is
  // the last paint's fen (this hook runs before the commit); the victim is
  // the square whose occupant vanished — the landing square, or the pawn
  // taken en passant. A piece leaves BLOOD away from the blow; terrain
  // leaves ITS OWN pixels (a crate's planks, a wall's stone) and the sprite
  // SHATTERS on impact instead of dissolving. Traffic wears the path.
  let hit = null, dz = null, hitSrc = null;
  if (parts) {
    hit = debrisCaptureOf(app.residue.lastFen, duel.fen(), parts[1], parts[2]);
    debrisTraffic(parts[1], parts[2]);
    if (hit) {
      const a = parseSquare(parts[1]), v = parseSquare(hit.sq);
      const len = Math.hypot(v.file - a.file, v.rankFromBottom - a.rankFromBottom) || 1;
      const dir = { dx: (v.file - a.file) / len, dy: -(v.rankFromBottom - a.rankFromBottom) / len }; // screen: down = lower rank
      hitSrc = hit.victim === 'terrain' ? debrisSrcOf(hit.sq, app.debris.kinds?.get(hit.sq)) : null;
      dz = await debrisEvent({ k: hit.victim === 'terrain' ? 'smash' : 'kill', sq: hit.sq, ...dir, src: hitSrc, ply });
    }
  }
  if (parts) {
    // A shattering crate holds until the piece arrives; a piece still dissolves under the blow.
    const shatters = !!(dz && hit?.victim === 'terrain' && debrisOpts().fx && FX(1));
    await app.boardUI.animateSlide(parts[1], parts[2], { ms: FX(mover === 'engine' ? 240 : 150), fade: !shatters });
    if (app.duel !== duel || !duel.board) return; // abandoned mid-slide
  }
  // The spray flies while the engine thinks (never awaited); it lands into
  // the cells' own layer, so the commit below paints without it and the
  // landing fills it in.
  if (dz) void debrisFly(dz, { shatter: hitSrc, sq: hit.sq, ms: hitSrc ? 340 : 300 });
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
  ui.rumble(FX(280)); // the board shakes its blit by whole native pixels
  await wait(FX(280));
  if (app.duel !== duel) return;

  // Beat 2 — the motion, each edited tile held on its end frame. THE DEBRIS
  // LAYER rides every rung: a weaken drops chips from the crack, a breach
  // scatters the cracked wall's own stone and shatters it, a displacement
  // scuffs the floor under the slide, a crumble throws the floor's pixels
  // outward while its blocks fall into the pit. Every event is recorded on
  // the PRE-quake board (what stood there) and awaited within its beat, so
  // the commit below paints them landed.
  const preKinds = classifyTerrain(ev.preFen, { ...preQuakeLedgers(ev), skins: stageSkins(app.session?.deal?.stage), opened: app.residue.opened, rubble: app.residue.rubble }, ui.files, ui.ranks);
  for (const e of edits) {
    const src = debrisSrcOf(e.square, preKinds.get(e.square));
    const dzEv = e.kind === 'weaken' || e.kind === 'breach' ? await debrisEvent({ k: e.kind, sq: e.square, src }) : null;
    const anim = ui.animateTerrain(e.square, e.kind, FX(e.kind === 'breach' ? 320 : 300), { hold: true });
    await Promise.all([anim, dzEv ? debrisFly(dzEv, { shatter: e.kind === 'breach' ? src : null, sq: e.square, ms: e.kind === 'breach' ? 340 : 300, after: anim }) : null]);
  }
  if (app.duel !== duel) return;
  if (displacements.length) {
    const skids = [];
    for (const d of displacements) skids.push(await debrisEvent({ k: 'skid', sq: d.from, to: d.to }));
    const slides = ui.animateSlides(displacements, { ms: FX(340), stagger: FX(120) });
    await Promise.all([slides, ...skids.map((sk, i) => (async () => { await wait(i * FX(120)); await debrisFly(sk, { ms: 340, after: slides }); })())]);
  }
  if (app.duel !== duel) return;
  if (crumble) {
    const src = debrisSrcOf(crumble.square, preKinds.get(crumble.square));
    const dzEv = await debrisEvent({ k: 'crumble', sq: crumble.square, src });
    const anim = ui.animateTerrain(crumble.square, 'crumble', FX(450), { hold: true });
    await Promise.all([anim, dzEv ? debrisFly(dzEv, { shatter: src, inward: true, ms: 450, after: anim }) : null]);
  }
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
  autosaveLog(); // the final position and the verdict
  debrisSave(true); // the floor keeps its scars
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
  autosaveLog(); // an abandoned duel is still a saved log
  refreshSavedLogs();
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
$('optScaling').addEventListener('change', (e) => {
  options.scaling = SCALINGS.includes(e.target.value) ? e.target.value : 'integer';
  applyOptions();
});
// THE CAMERA's debug turn buttons (2026-09-08): turning the army LEFT puts
// the world's west up the screen (facing − 1), RIGHT its east (facing + 1).
// The real turn buttons wait for the army (brief §5.1).
$('btnTurnL').addEventListener('click', () => setFacing(app.view.facing - 1));
$('btnTurnR').addEventListener('click', () => setFacing(app.view.facing + 1));
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
// The piece placement, in whole tile pixels — applied live as the dials
// drag (input), so the designer can settle the feel on the phone and read
// the numbers off the labels.
$('optTileLift').addEventListener('input', (e) => {
  options.tileLift = Math.round(clampNum(e.target.value, TILE_LIFT_RANGE, DEFAULT_PIECE_FIT.tileLift));
  applyOptions();
});
$('optTileShift').addEventListener('input', (e) => {
  options.tileShift = Math.round(clampNum(e.target.value, TILE_SHIFT_RANGE, DEFAULT_PIECE_FIT.tileShift));
  applyOptions();
});
// The arrow dials (2026-09-07): the shaft in floor pixels and the opacity,
// pushed to the mounted board through applyTheme (setArrowStyle).
$('optArrowWidth').addEventListener('input', (e) => {
  options.arrowWidth = Math.round(clampNum(e.target.value, ARROW_WIDTH_RANGE, ARROW_STYLE_DEFAULT.width));
  applyOptions();
});
$('optArrowAlpha').addEventListener('input', (e) => {
  options.arrowAlpha = clampNum(e.target.value, ARROW_ALPHA_RANGE, ARROW_STYLE_DEFAULT.alpha);
  applyOptions();
});
// The debris toggles (2026-09-07): every kind a checkbox, the amount a
// slider, and two ways to forget.
for (const [el, key] of [['optDebrisDestruction', 'destruction'], ['optDebrisBlood', 'blood'], ['optDebrisSkid', 'skid'], ['optDebrisWear', 'wear'], ['optDebrisFx', 'fx']]) {
  $(el).addEventListener('change', (e) => {
    options.debris = { ...options.debris, [key]: e.target.checked };
    applyOptions();
  });
}
$('optDebrisIntensity').addEventListener('input', (e) => {
  options.debris = { ...options.debris, intensity: clampNum(e.target.value, DEBRIS_INTENSITY_RANGE, 1) };
  applyOptions();
});
$('btnDebrisClean').addEventListener('click', () => debrisClean(false));
$('btnDebrisCleanAll').addEventListener('click', () => debrisClean(true));
window.addEventListener('pagehide', () => debrisSave(true));
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
// The ladder sliders (v4.1): each moves one rung's bias, live and for the
// next duel alike; the forecast line above shows the resulting shares at
// the board's current tedium. Reset returns to the Director's defaults.
for (const k of GOD_LADDER) {
  $(`ladder_${k}`).addEventListener('input', (e) => {
    const v = clampNum(e.target.value, LADDER_RANGE, DIRECTOR_DEFAULTS[k]);
    options.godLadder = { ...(options.godLadder ?? {}), [k]: v };
    applyOptions();
    liveTune({ [k]: v });
  });
}
$('btnLadderReset').addEventListener('click', () => {
  options.godLadder = null;
  applyOptions();
  liveTune(Object.fromEntries(GOD_LADDER.map((k) => [k, DIRECTOR_DEFAULTS[k]])));
});
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
// The replay log's buttons (2026-09-06). The overlay's copy button keeps its
// clipboard channel (the console-paste workflow); every Export button walks
// the delivery ladder — share a file on a phone, download on a desktop.
$('btnGodsExport').addEventListener('click', () => void exportCurrentLog('clipboard'));
$('btnGodsBefore').addEventListener('click', () => {
  if (app.godsBefore) godsBeforeOff();
  else godsBeforeOn();
});
$('btnGodsDeep').addEventListener('click', () => void godsDeepNow());
$('btnOverlayExport').addEventListener('click', () => void exportCurrentLog());
$('btnOptionsExport').addEventListener('click', () => void exportCurrentLog());
$('btnOptionsCopy').addEventListener('click', () => void exportCurrentLog('clipboard'));
$('btnFlag').addEventListener('click', () => void flagMoment());
$('btnSavedExport').addEventListener('click', () => void exportSavedLog());
// The replay analyzer (2026-09-07) is its own page next to this one; it reads
// the same autosave ring (same origin), so both entry points just navigate.
$('btnSavedOpen').addEventListener('click', () => {
  const slot = parseInt($('savedLogSel').value, 10);
  if (Number.isInteger(slot)) location.href = `../replay/?slot=${slot}`;
});
$('btnOverlayReview').addEventListener('click', () => {
  autosaveLog(); // the ended duel's final state, in the ring the analyzer reads
  location.href = '../replay/?latest=1';
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
        heat: dir.meter.heat,
        tedium: dir.meter.t,
        threats: dir.lastThreats ?? [],
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
    // 2026-09-06: the replay log's in-game half — paint the last quake's
    // pre-quake board (true/false), and queue the deep before/after probe.
    before: (on = true) => (on ? godsBeforeOn() : (godsBeforeOff(), true)),
    get showingBefore() {
      return app.godsBefore;
    },
    deep: () => godsDeepNow(),
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
  /** The residue ledger: squares where a door was opened / a wall broken. */
  get residue() {
    return { opened: [...app.residue.opened], rubble: [...app.residue.rubble] };
  },
  /** THE DEBRIS LAYER (2026-09-07): the environment's ledger and its paint. */
  debris: {
    get ledger() {
      return app.debris.ledger;
    },
    get env() {
      return app.debris.envId;
    },
    get tx() {
      return app.debris.tx;
    },
    get options() {
      return debrisOpts();
    },
    stats: () => (app.debris.ledger ? { ...app.debris.ledger.stats(), pending: app.debris.pending.size, cached: app.debris.urls.size, sampler: app.debris.sampler?.size ?? 0, flights: app.debris.particles?.flights.length ?? 0, painted: app.boardUI?.debrisBufs.size ?? 0 } : null),
    events: () => (app.debris.ledger ? app.debris.ledger.events.map((e) => ({ ...e })) : []),
    /** One arena square: its env cell, the events on it, its wear and the painted URL (from the DOM). */
    cell: (sq) => {
      const D = app.debris;
      if (!D.ledger || !D.tx) return null;
      const { ef, er } = toEnvCell(D.tx, sq);
      const cell = app.boardUI?.cells.get(sq);
      const buf = app.boardUI?.debrisBuf(sq) ?? null;
      let opaque = 0, pixels = 0;
      if (buf) for (let i = 3; i < buf.length; i += 4) { if (buf[i]) pixels++; if (buf[i] === 255) opaque++; }
      return { ef, er, events: D.ledger.eventsAt(ef, er).map((e) => ({ id: e.id, k: e.k, m: e.m, e: e.e, p: e.p })), traffic: D.ledger.trafficAt(ef, er), wear: wearLevel(D.ledger.trafficAt(ef, er)), painted: !!app.boardUI?.hasDebris?.(sq), pixels, opaque };
    },
    /** The painter's raw buffer for a square (a Uint8ClampedArray or null). */
    paint: (sq) => {
      const D = app.debris;
      if (!D.ledger || !D.tx) return null;
      const { ef, er } = toEnvCell(D.tx, sq);
      return paintCell(D.ledger, ef, er, debrisPaintCtx());
    },
    frames: () => app.debris.particles?.frames ?? 0,
    get busy() {
      return !!app.debris.particles?.busy;
    },
    clean: (all = false) => debrisClean(all),
    save: () => debrisSave(true),
    key: DEBRIS_KEY,
    /** The sampler's pixels for a sprite name (decoded off the atlas if not yet) — { w, h, data } or null. */
    sample: async (name) => {
      await debrisSampler().ensure([name]);
      return debrisSampler().get(name);
    },
  },
  /** The piece-fit dials as applied to the live board. */
  get pieceFit() {
    return app.boardUI?.pieceFit ?? null;
  },
  /** The renderer's geometry (device pixel ratio, device-pixel size, the
   *  scale k, integer or fill), the buffer's pixels, the arrows it draws,
   *  the atlas's tiles and the device-pixel gate's test pattern. `kind` is
   *  always 'canvas' since the DOM board's retirement (2026-09-07). */
  renderer: {
    get kind() {
      return app.boardUI?.kind ?? null;
    },
    get info() {
      return app.boardUI?.renderInfo ?? null;
    },
    get diag() {
      return app.boardUI?.diag ?? '';
    },
    get diagShown() {
      return !$('render-diag').hidden ? $('render-diag').textContent : null;
    },
    square: (sq) => app.boardUI?.squarePixels(sq) ?? null,
    buffer: () => app.boardUI?.bufferPixels() ?? null,
    decor: (sq) => app.boardUI?.decorOf(sq) ?? null,
    /** The arrows the board draws, in draw order. */
    get arrows() {
      return app.boardUI?.arrows.map((a) => ({ ...a })) ?? null;
    },
    testPattern: (on) => app.boardUI?.setTestPattern?.(on),
    snapMode: (mode) => app.boardUI?.setSnapMode?.(mode),
    paintNow: () => app.boardUI?.paintNow?.(),
    /** THE CAMERA (2026-09-08): read the facing, or turn to one (0–3). */
    facing: (n = null) => (n === null ? app.view.facing : setFacing(n)),
    /** The layout in force and the board's fit ('wide' → 'box'). */
    get layout() {
      return { layout: layoutFor(), fit: app.boardUI?.renderInfo.fit ?? null, wide: document.body.classList.contains('layout-wide') };
    },
    /** The hit-test and its inverse, for the round trip under a turn. */
    squareAtPoint: (x, y) => app.boardUI?.squareAtPoint?.(x, y) ?? null,
    pointOfSquare: (sq) => app.boardUI?.pointOfSquare?.(sq) ?? null,
    /** THE WINDOW (milestone 4): the world cell under a point and back; the viewport, the zoom, the focus. */
    cellAtPoint: (x, y) => app.boardUI?.cellAtPoint?.(x, y) ?? null,
    pointOfCell: (f, r) => app.boardUI?.pointOfCell?.(f, r) ?? null,
    viewport: (v = null) => (v === null ? app.boardUI?.viewport ?? null : app.boardUI?.setViewport?.(v) ?? null),
    zoom: (k = null) => (k === null ? app.boardUI?.zoom ?? null : (app.boardUI?.setFit?.('window'), app.boardUI?.setZoom?.(k) ?? null)),
    lookAt: (f = null, r = null, dx = 0, dy = 0) => app.boardUI?.lookAt?.(f, r, dx, dy),
    /** The atlas's pixels for a role under the board's theme / door set, and the crack drawings — { w, h, data } or null. */
    tile: (role) => { const a = app.boardUI?.atlas; const t = a?.tileOf(app.boardUI.theme, role, { doors: app.boardUI.doors }); return t ? Atlas.pixelsOf(t) : null; },
    crack: (n) => { const t = app.boardUI?.atlas?.crack(n); return t ? Atlas.pixelsOf(t) : null; },
    ready: () => app.boardUI?.ready ?? Promise.resolve(),
    /** Set the scaling (`set('fill')`; the old two-argument `set('canvas', 'fill')` still reads).
     *  A driver's choice beats the URL's (`?scaling=` pins the option otherwise). */
    set: (a, b = null) => {
      const scaling = b ?? a;
      params.delete('scaling');
      if (SCALINGS.includes(scaling)) options.scaling = scaling;
      applyOptions();
      return app.boardUI?.kind;
    },
  },
  /** The current stage's skin grid ({square: skinName}). */
  get skins() {
    return stageSkins(app.session?.deal?.stage);
  },
  get cheat() {
    return { seq: cheat.seq, active: !!cheat.active, depth: cheat.depth, arrows: app.cheatArrows, hintLine: $('hint-line').textContent, go: probeGo() };
  },
  /** The arrows' style as the board wears it (the dials, or the URL's override). */
  get arrowStyle() {
    return app.boardUI?.arrowStyle ?? arrowStyleFor();
  },
  /** Set the dials (drops any URL override so the Options rule again). */
  setArrowStyle: (width, alpha) => {
    params.delete('arrowwidth');
    params.delete('arrowalpha');
    if (width != null) options.arrowWidth = Math.round(clampNum(width, ARROW_WIDTH_RANGE, ARROW_STYLE_DEFAULT.width));
    if (alpha != null) options.arrowAlpha = clampNum(alpha, ARROW_ALPHA_RANGE, ARROW_STYLE_DEFAULT.alpha);
    applyOptions();
    return app.boardUI?.arrowStyle ?? null;
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
    godsBeforeOff(); // a driver can move while the past is painted; the tap path cannot
    await cancelIdleProbes();
    const r = await app.duel.playerMove(uci);
    if (!r.ended) await driveTurn();
    return app.duel.state;
  },
  options,
  applyOptions,
  undo: doUndo,
  // The replay log (2026-09-06): the export object, the flag, the autosave
  // ring. `build()` is the same object every Export button delivers.
  log: {
    build: () => godsExportData(),
    flag: (note = '') => {
      const f = app.duel?.flag(note) ?? null;
      if (f) autosaveLog();
      return f;
    },
    autosave: () => autosaveLog(),
    saved: () => logStore.index(),
    load: (slot) => logStore.load(slot),
    store: logStore,
    export: (force = null) => exportCurrentLog(force),
  },
  waitIdle: async () => {
    while (app.busy) await new Promise((res) => setTimeout(res, 50));
    return app.duel?.state ?? app.phase;
  },
};

loadOptions();
loadSetup();
if (params.get('godsdebug')) options.godsDebug = true; // E2E/dev override (not persisted until the user touches options)
applyLayout(); // the camera's layout before anything is mounted
app.view.facing = facingFor();
syncFacingUI();
syncOptionsUI();
refreshSavedLogs(); // the autosave ring from earlier sessions, on the setup screen
window.__DCK.ready = boot();

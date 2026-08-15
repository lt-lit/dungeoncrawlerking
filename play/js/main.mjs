// App spine: boot, arena menu, placement flow (§4.3), duel driving, win/loss.
//
// Boot order (CLAUDE.md rules 1/7): ffish + engine init in parallel; the fixed
// 50-variant catalog is loaded ONCE into both (variant names are single-use);
// every duel thereafter varies only via FEN. One engine instance serves the
// whole page session (fresh ffish Board + `ucinewgame` per duel; a page
// reload is the recycle path — a session never approaches the ~40-game WASM
// fatigue limit).
//
// Test/debug query params (used by the Playwright E2E suite):
//   ?arena=<id>      auto-open that arena
//   &autoplace=1     accept the default placement immediately
//   &autobegin=1     also begin the duel
//   &go=<uci go args>  override engine search (e.g. "depth 60 movetime 80")
//   &onset=&qramp=&cramp=&debt=&asymonset=&asymramp=&seed=
//     override the Director config (see director.mjs DIRECTOR_DEFAULTS)
//   &fx=<scale>      animation speed multiplier; 0 disables motion entirely
//                    (drivers should pass fx=0 — animations gate app.busy)
import { getFfish, createEngine } from './engine.mjs';
import { makeCatalogIni } from './variant.mjs';
import { parseSquare, findSquares } from './fen.mjs';
import {
  ARENA_MANIFEST,
  fetchArena,
  playerSlotSquares,
  playerPawnSquares,
  playerPool,
  defaultPawnSquares,
  defaultEnemySetup,
  buildStartFen,
  buildPreviewFen,
} from './arena.mjs';
import { BoardUI, Tray, pickPromotion } from './board-ui.mjs';
import { DuelController } from './duel.mjs';

const $ = (id) => document.getElementById(id);
const PIECE_VALUES = { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 };
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
const wait = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const app = {
  ffish: null,
  engine: null,
  catalog: null,
  cheatArrows: [], // current best-move arrows (cheat mode): {from, to, strength}
  quakeMarks: null, // {from:[], to:[], pit} — the last quake's residue, held
  // on the board through the enemy's reply and cleared when the player moves
  enemySetup: {}, // square -> piece letter for the enemy formation (editable in cheat mode)
  enemySelected: null, // enemy editor: selected enemy square
  arenas: [], // loaded arena objects, menu order
  arena: null,
  boardUI: null,
  tray: null,
  duel: null,
  placement: {}, // square -> piece letter (uppercase)
  selectedTrayId: null,
  selectedSquare: null, // during play: player's selected from-square
  phase: 'boot', // boot | menu | placement | playing | ended | error
  busy: false, // gates input while the engine thinks / animations run
  enginePending: null, // whenQuiet() of an abandoned duel's in-flight search
  duelsOnEngine: 0, // rule 6: recycle the instance well before ~40 games
};

// ---------------------------------------------------------------- utilities

function setStatus(text) {
  $('status').textContent = text;
}

function log(el, msg, cls) {
  const line = document.createElement('div');
  line.textContent = msg;
  if (cls) line.className = cls;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function storageKey(arena) {
  return `dck.place.${arena.id}`;
}

function loadSavedPlacement(arena) {
  try {
    const raw = localStorage.getItem(storageKey(arena));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    buildStartFen(arena, saved); // the one true validity check — throws on stale saves
    return saved;
  } catch {
    return null;
  }
}

function savePlacement(arena, placement) {
  try {
    localStorage.setItem(storageKey(arena), JSON.stringify(placement));
  } catch {
    /* storage unavailable — QoL only */
  }
}

/** Default placement — the authored formation: king nearest the patch
 *  middle, pieces by value outward (the harness's "balanced" archetype, §7),
 *  pawns at their authored squares. */
function defaultPlacement(arena) {
  const slots = playerSlotSquares(arena); // file-ascending
  if (!slots.length) return {};
  const placement = {};
  const mid = (arena.player.backRankStart * 2 + arena.player.patchWidth - 1) / 2;
  const byMid = slots
    .slice()
    .sort((a, b) => Math.abs(parseSquare(a).file - mid) - Math.abs(parseSquare(b).file - mid));
  placement[byMid[0]] = 'K';
  const rest = byMid.slice(1);
  const pieces = arena.player.pieceSet
    .slice()
    .sort((a, b) => PIECE_VALUES[b.toLowerCase()] - PIECE_VALUES[a.toLowerCase()]);
  pieces.slice(0, rest.length).forEach((p, i) => {
    placement[rest[i]] = p;
  });
  for (const sq of defaultPawnSquares(arena)) {
    if (!placement[sq]) placement[sq] = 'P';
  }
  return placement;
}

// ------------------------------------------------------- options (cheat mode)

const OPT_KEY = 'dck.options.v1';
const options = { cheat: false, hints: false, hintN: 3, undo: false, evalBar: false, enemyEdit: false, godPreset: 'restless', godCustom: null };

// The Gods (Board State Director) — tuning presets. Numbers are plies.
// 'restless' is the sweep-validated baseline; custom exposes every knob.
const GOD_PRESETS = {
  calm: { onsetPly: 20, quakeRamp: 100, crumbleRamp: 160, debtCap: 12, asymOnsetPly: 70, asymRamp: 80 },
  restless: { onsetPly: 8, quakeRamp: 60, crumbleRamp: 100, debtCap: 10, asymOnsetPly: 50, asymRamp: 60 },
  wrathful: { onsetPly: 4, quakeRamp: 25, crumbleRamp: 50, debtCap: 6, asymOnsetPly: 30, asymRamp: 30 },
  off: { onsetPly: Infinity, quakeRamp: 60, crumbleRamp: 100, debtCap: 10, asymOnsetPly: 50, asymRamp: 60 },
};
const GOD_KNOBS = ['onsetPly', 'quakeRamp', 'crumbleRamp', 'debtCap', 'asymOnsetPly', 'asymRamp'];

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
const cheatEnemyEdit = () => options.cheat && options.enemyEdit;

function syncOptionsUI() {
  $('optCheat').checked = options.cheat;
  $('optHints').checked = options.hints;
  $('optHintN').value = String(options.hintN);
  $('optUndo').checked = options.undo;
  $('optEval').checked = options.evalBar;
  $('optEnemyEdit').checked = options.enemyEdit;
  $('cheat-opts').classList.toggle('disabled', !options.cheat);
  $('optGodPreset').value = options.godPreset;
  const cfg = godConfig();
  for (const k of GOD_KNOBS) {
    const el = $(`god_${k}`);
    el.value = Number.isFinite(cfg[k]) ? String(cfg[k]) : '';
    el.disabled = options.godPreset !== 'custom';
  }
  $('god-knobs').classList.toggle('disabled', options.godPreset !== 'custom');
}

function refreshCheatUI() {
  const inDuel = !!app.duel && (app.phase === 'playing' || app.phase === 'ended');
  $('btnUndo').hidden = !(cheatUndo() && inDuel);
  $('btnUndo').disabled =
    app.busy || !app.duel || (app.duel.state === 'playing' && app.duel.turnColor() !== app.arena.playerColor);
  $('eval-bar').hidden = !(cheatEval() && inDuel);
}

function applyOptions() {
  saveOptions();
  syncOptionsUI();
  refreshCheatUI();
  if (!cheatHints()) {
    app.cheatArrows = [];
    if (app.duel && app.phase !== 'placement') renderPlayMarks();
  }
  if (app.phase === 'placement') {
    if (!cheatEnemyEdit()) app.enemySelected = null;
    refreshPlacement();
  }
  if (app.duel && app.duel.state === 'playing' && !app.busy && app.duel.turnColor() === app.arena.playerColor) {
    void runCheatSearch(); // options may have just enabled hints/eval mid-turn
  }
}

/** Cheat search: one MultiPV probe of the CURRENT position on the player's
 *  turn, feeding the hint marks and/or the eval bar. Runs on the shared
 *  engine while it is otherwise idle; MultiPV is always restored to 1 so the
 *  engine's own replies stay full-strength single-PV searches (§2.2). */
const cheat = { seq: 0, active: null, engine: null, failures: 0 };

async function cancelCheatSearch() {
  cheat.seq++;
  if (cheat.active) {
    try {
      // stop the instance the probe actually RUNS on — after an engine
      // recycle app.engine is a different object, and stopping that one
      // leaves the real search running.
      (cheat.engine ?? app.engine).send('stop');
    } catch {
      /* dead engine */
    }
    // A dead instance never emits bestmove, so its promise only settles on
    // the go() timeout. Never block the player's move on that: give the stop
    // a moment to land, then move on and let the stale probe expire alone
    // (its seq guard makes it inert).
    await Promise.race([cheat.active, new Promise((r) => setTimeout(r, 300))]);
    cheat.active = null;
    cheat.engine = null;
  }
}

async function runCheatSearch() {
  if (!app.duel || app.duel.state !== 'playing') return;
  if (!(cheatHints() || cheatEval())) return;
  if (app.duel.turnColor() !== app.arena.playerColor) return;
  await cancelCheatSearch();
  const duel = app.duel;
  const engine = app.engine;
  const mySeq = ++cheat.seq;
  const n = cheatHints() ? options.hintN : 1;
  let p;
  try {
    engine.setoption('MultiPV', String(n));
    engine.position({ fen: duel.baseFen, moves: duel.movesSinceBase });
    // Timeout matched to the search (movetime + 4 s), not 12 s: a probe that
    // is going to fail should fail before the player has moved on.
    p = engine.go('depth 22 movetime 450', { timeout: 4450 }).finally(() => {
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
  cheat.failures = 0;
  if (mySeq !== cheat.seq || app.duel !== duel || duel.state !== 'playing') return; // stale
  const pvs = parseMultiPv(res.infoLines, n);
  if (!pvs.length) return;
  if (cheatEval()) updateEvalBar(pvs[0].score, app.arena.playerColor);
  if (cheatHints()) {
    // Arrow strength scales with how close each move is to the best one
    // (lichess-style): equal → full size, 300cp worse → minimum size.
    const cpOf = (s) => (!s ? 0 : s.type === 'mate' ? (s.value > 0 ? 10000 - s.value : -10000 - s.value) : s.value);
    const best = cpOf(pvs[0].score);
    const arrows = [];
    const sans = [];
    for (const pv of pvs) {
      const m = pv.move.match(UCI_MOVE_RE);
      if (!m) continue;
      const strength = Math.max(0.2, Math.min(1, 1 - (best - cpOf(pv.score)) / 300));
      arrows.push({ from: m[1], to: m[2], strength });
      try {
        sans.push(duel.board.sanMove(pv.move));
      } catch {
        sans.push(pv.move);
      }
    }
    app.cheatArrows = arrows;
    renderPlayMarks();
    setStatus(`your move · ${sans.join(' · ')}`);
  }
}

/** A hint probe failed. Say so on screen (silence here is what made this
 *  undiagnosable), and recycle the engine so hints come back — the duel's own
 *  ladder can't help, it only fires on the duel's searches. Recycling is safe
 *  here: probes only run on the player's turn with the engine otherwise idle. */
async function cheatProbeFailed(deadEngine, err) {
  cheat.active = null;
  cheat.engine = null;
  cheat.failures++;
  app.cheatArrows = [];
  if (app.duel && app.phase === 'playing') renderPlayMarks();
  if (cheat.failures > 3) {
    setStatus('your move · hints unavailable');
    return; // stop thrashing the engine if recycling is not helping
  }
  log($('duel-log'), `⚠ hint probe failed (${String(err?.message ?? err).split('\n')[0]}) — reforming`, 'crumble');
  if (app.engine !== deadEngine) return; // someone already replaced it
  try {
    const fresh = await createEngine();
    await fresh.loadVariantsIni(app.catalog);
    app.engine = fresh;
    app.duelsOnEngine = 1;
    app.enginePending = null;
    if (app.duel && app.duel.state === 'playing') {
      app.duel.engine = fresh;
      fresh.send('ucinewgame');
      fresh.setoption('UCI_Variant', app.arena.variantName);
      await fresh.isready();
      if (app.duel.turnColor() === app.arena.playerColor && !app.busy) void runCheatSearch();
    }
  } catch {
    setStatus('your move · hints unavailable');
  }
}

/** Last (deepest) info line per multipv rank → [{rank, move, score}]. */
function parseMultiPv(infoLines, n) {
  const byRank = new Map();
  for (const line of infoLines) {
    const pv = line.match(/ pv (\S+)/);
    if (!pv) continue;
    const s = line.match(/score (cp|mate) (-?\d+)/);
    const r = line.match(/multipv (\d+)/);
    const rank = r ? parseInt(r[1], 10) : 1;
    if (rank > n) continue;
    byRank.set(rank, { rank, move: pv[1], score: s ? { type: s[1], value: parseInt(s[2], 10) } : null });
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank);
}

/** score is from povColor's point of view; the bar renders player-POV. */
function updateEvalBar(score, povColor) {
  if (!score || !app.arena) return;
  const pov = povColor === app.arena.playerColor ? score : { type: score.type, value: -score.value };
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
  if (duel.state === 'playing' && duel.turnColor() !== app.arena.playerColor) return;
  app.busy = true;
  await cancelCheatSearch();
  const did = duel.undoToTurn(app.arena.playerColor === 'white' ? 'w' : 'b');
  app.busy = false;
  if (!did) {
    setStatus('nothing to undo');
    return;
  }
  $('overlay').hidden = true;
  app.phase = 'playing';
  app.selectedSquare = null;
  app.cheatArrows = [];
  app.quakeMarks = null; // the rewound timeline's quake never happened
  app.boardUI.setPosition(duel.fen());
  renderPlayMarks();
  log($('duel-log'), `↩ took back to ply ${duel.ply}`, 'crumble');
  await driveTurn();
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
    log(bootLog, 'engine + rules ready (50-variant catalog loaded)', 'ok');
  } catch (e) {
    setStatus('boot failed');
    log(bootLog, 'BOOT FAILED: ' + (e && e.message ? e.message : e), 'bad');
    log(bootLog, 'If SharedArrayBuffer is the error: the page must be cross-origin isolated (see note above).', 'bad');
    app.phase = 'error';
    return;
  }

  setStatus('loading arenas…');
  const fetched = await Promise.allSettled(ARENA_MANIFEST.map((url) => fetchArena(url)));
  fetched.forEach((r, i) => {
    if (r.status === 'fulfilled') app.arenas.push(r.value);
    else log(bootLog, `arena ${ARENA_MANIFEST[i]} failed to load: ${r.reason.message}`, 'bad');
  });
  renderMenu();
  app.phase = 'menu';
  setStatus('choose an arena');

  const wanted = params.get('arena');
  if (wanted) {
    const arena = app.arenas.find((a) => a.id === wanted);
    if (arena) await openArena(arena);
  }
}

function renderMenu() {
  const list = $('arena-list');
  list.textContent = '';
  for (const arena of app.arenas) {
    const card = document.createElement('button');
    card.className = 'arena-card';
    card.innerHTML =
      `<span class="arena-title"></span><span class="arena-dims"></span><span class="arena-intro"></span>`;
    card.querySelector('.arena-title').textContent = arena.title;
    card.querySelector('.arena-dims').textContent =
      `${arena.files}×${arena.ranks} · ${arena.initiative === 'player' ? 'you hold the initiative' : 'AMBUSH — the enemy moves first'}`;
    card.querySelector('.arena-intro').textContent = arena.intro;
    card.addEventListener('click', () => openArena(arena));
    list.appendChild(card);
  }
}

// ----------------------------------------------------------------- placement

function showScreen(name) {
  $('screen-menu').hidden = name !== 'menu';
  $('screen-duel').hidden = name !== 'duel';
  $('btnBack').hidden = name === 'menu';
}

async function openArena(arena) {
  app.arena = arena;
  app.phase = 'placement';
  app.busy = false;
  showScreen('duel');
  $('title').textContent = arena.title;
  $('duel-log').textContent = '';
  $('placement-controls').hidden = false;

  if (app.boardUI) app.boardUI.destroy();
  app.boardUI = new BoardUI($('board'), {
    files: arena.files,
    ranks: arena.ranks,
    flipped: arena.playerColor === 'black',
    onSquareTap: onSquareTap,
  });
  app.tray = new Tray($('tray'), { onTap: onTrayTap });
  $('enemy-bar').textContent = `enemy · ${arena.enemyColor}`;
  $('player-bar').textContent = `you · ${arena.playerColor}`;

  app.placement = loadSavedPlacement(arena) ?? defaultPlacement(arena);
  app.enemySetup = defaultEnemySetup(arena);
  app.selectedTrayId = null;
  app.enemySelected = null;

  refreshPlacement();
  if (params.get('autoplace') && params.get('autobegin')) await beginDuel();
}

/** Tray model: one entry per pool piece (king, pieces, then pawns). */
function trayItems() {
  const pool = playerPool(app.arena).map((p, i) => ({ id: `${p}${i}`, piece: p }));
  const used = new Map(); // piece -> count placed
  for (const p of Object.values(app.placement)) used.set(p, (used.get(p) ?? 0) + 1);
  return pool.map((item) => {
    let state = 'available';
    const left = used.get(item.piece) ?? 0;
    if (left > 0) {
      used.set(item.piece, left - 1);
      state = 'placed';
    }
    if (item.id === app.selectedTrayId) state = 'selected';
    return { ...item, color: app.arena.playerColor, state };
  });
}

function selectedTrayPiece() {
  return app.selectedTrayId ? app.selectedTrayId.replace(/\d+$/, '') : null;
}

/** Squares where the currently selected tray piece may go (empty, right rows). */
function legalDropSquares(piece) {
  const arena = app.arena;
  const occupied = (sq) => app.placement[sq] || app.enemySetup[sq];
  const base = piece === 'P' ? playerPawnSquares(arena) : piece ? playerSlotSquares(arena) : playerPawnSquares(arena);
  return base.filter((sq) => !occupied(sq));
}

function refreshPlacement() {
  const arena = app.arena;
  app.boardUI.setPosition(buildPreviewFen(arena, app.placement, app.enemySetup));
  app.boardUI.setMarks({
    slots: legalDropSquares(selectedTrayPiece()),
    selected: app.enemySelected ?? undefined,
  });
  app.tray.setPieces(trayItems());
  app.boardUI.setInteractive(true);
  const hasKing = Object.values(app.placement).includes('K');
  $('btnBegin').disabled = !hasKing;
  if (app.enemySelected) {
    setStatus('tap a square to move the enemy piece — tap it again to remove it');
  } else {
    setStatus(hasKing ? 'place your pieces — then begin' : 'place your king');
  }
}

function onTrayTap(id) {
  if (app.phase !== 'placement') return;
  const items = trayItems();
  const item = items.find((x) => x.id === id);
  if (!item || item.state === 'placed') return;
  app.selectedTrayId = app.selectedTrayId === id ? null : id;
  app.enemySelected = null;
  refreshPlacement();
}

/** Enemy formation editor (cheat mode, testing tool): tap an enemy piece to
 *  pick it up, tap a square to move it, tap it again to remove it. The king
 *  can be moved but never removed (the duel config needs both kings). */
function enemyEditTap(sq) {
  const wallSet = new Set(app.arena.walls);
  if (app.enemySelected) {
    if (sq === app.enemySelected) {
      if (app.enemySetup[sq] === 'K') {
        app.enemySelected = null;
        refreshPlacement();
        setStatus('the enemy king must stay on the board');
        return true;
      }
      delete app.enemySetup[sq]; // second tap removes
      app.enemySelected = null;
      refreshPlacement();
      return true;
    }
    if (app.enemySetup[sq]) {
      app.enemySelected = sq; // re-select another enemy piece
      refreshPlacement();
      return true;
    }
    if (!wallSet.has(sq) && !app.placement[sq]) {
      app.enemySetup[sq] = app.enemySetup[app.enemySelected];
      delete app.enemySetup[app.enemySelected];
      app.enemySelected = null;
      refreshPlacement();
      return true;
    }
    return true; // wall / player-occupied — ignore the tap, keep selection
  }
  if (app.enemySetup[sq]) {
    app.enemySelected = sq;
    app.selectedTrayId = null;
    refreshPlacement();
    return true;
  }
  return false;
}

function placementTap(sq) {
  if (cheatEnemyEdit() && enemyEditTap(sq)) return;
  const existing = app.placement[sq];
  const piece = selectedTrayPiece();
  if (piece) {
    if (!legalDropSquares(piece).includes(sq)) return;
    // A king may only exist once: placing it elsewhere moves it.
    if (piece === 'K') {
      for (const [s, p] of Object.entries(app.placement)) if (p === 'K') delete app.placement[s];
    }
    app.placement[sq] = piece;
    app.selectedTrayId = null;
  } else if (existing) {
    delete app.placement[sq]; // pick the piece back up
  }
  refreshPlacement();
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

/** Crumble override params are test-only; a typo must not silently change
 *  the game — fall back to the arena's numbers unless the value is sane. */
function intParam(name, fallback, min) {
  const v = parseInt(params.get(name) ?? '', 10);
  return Number.isInteger(v) && v >= min ? v : fallback;
}

async function beginDuel() {
  const arena = app.arena;
  let startFen;
  try {
    ({ startFen } = buildStartFen(arena, app.placement, app.enemySetup));
  } catch (e) {
    setStatus(e.message);
    return;
  }
  // The enemy editor can craft positions FSF rejects — check before starting.
  if (app.ffish.validateFen(startFen, arena.variantName) !== 1) {
    setStatus('illegal position — adjust the setup');
    return;
  }
  savePlacement(arena, app.placement);
  $('placement-controls').hidden = true;
  app.tray.clear();
  app.phase = 'playing';
  app.selectedSquare = null;
  await ensureEngineReady();

  // Director config: settings preset (or custom knobs) + the arena's seed
  // for determinism; every knob overridable via query param (test-only).
  const god = godConfig();
  const director = {
    onsetPly: intParam('onset', god.onsetPly, 1),
    quakeRamp: intParam('qramp', god.quakeRamp, 1),
    crumbleRamp: intParam('cramp', god.crumbleRamp, 1),
    debtCap: intParam('debt', god.debtCap, 1),
    asymOnsetPly: intParam('asymonset', god.asymOnsetPly, 1),
    asymRamp: intParam('asymramp', god.asymRamp, 1),
    seed: intParam('seed', arena.crumble?.seed ?? 1, 1),
  };
  app.cheatArrows = [];
  app.quakeMarks = null;
  $('eval-fill').style.width = '50%';
  $('eval-text').textContent = '';
  if (app.duel) app.duel.destroy();
  app.duel = new DuelController({
    ffish: app.ffish,
    engine: app.engine,
    variantName: arena.variantName,
    startFen,
    files: arena.files,
    ranks: arena.ranks,
    director,
    // depth 22, NOT 60: on 4–6-file arenas movetime 500 rips past depth 55,
    // and ultra-deep searches are what probabilistically crash this WASM
    // build's pthread ("index out of bounds" — the stall the recovery ladder
    // catches). Measured: d60 crashed 1/30 searches at d55+; d22 crashed
    // 0/50 and still returns in <200 ms. On big boards movetime binds first
    // either way, so this costs nothing (the engine was reaching d22-23 in
    // live play). Full strength per §13 is untouched — this is a stability
    // cap, not a handicap.
    go: params.get('go') ?? 'depth 22 movetime 500',
    hooks: { onMove, onQuake, onEnd, onEngineInfo, onEngineStall },
  });
  await app.duel.start();
  app.boardUI.setPosition(app.duel.fen());
  app.boardUI.setMarks({});
  if (app.duel.state === 'playing') await driveTurn();
}

// --------------------------------------------------------------------- play

async function driveTurn() {
  const duel = app.duel;
  if (!duel || duel.state !== 'playing') return;
  if (duel.turnColor() === app.arena.playerColor) {
    app.busy = false;
    app.boardUI.setInteractive(true);
    setStatus('your move');
    refreshCheatUI();
    void runCheatSearch();
  } else {
    app.busy = true;
    app.boardUI.setInteractive(false);
    setStatus('the enemy is thinking…');
    refreshCheatUI();
    const r = await duel.engineMove();
    if (!r.ended) await driveTurn();
  }
}

/** Compose all in-play board marks (selection, last move, check, arrows). */
function renderPlayMarks() {
  const q = app.quakeMarks;
  const marks = {
    lastMove: lastMoveMarks(),
    check: checkMark(),
    arrows: app.cheatArrows,
    quakeFrom: q?.from ?? [],
    quakeTo: q?.to ?? [],
    pit: q?.pit ?? null,
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
  if (app.phase === 'placement') return placementTap(sq);
  if (app.phase !== 'playing' || !app.duel || app.duel.state !== 'playing') return;
  if (app.duel.turnColor() !== app.arena.playerColor) return;

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
      const choice = await pickPromotion(letters);
      uci = from + to + choice;
    }
  }
  app.busy = true;
  app.selectedSquare = null;
  app.boardUI.setInteractive(false);
  await cancelCheatSearch(); // the engine must be quiet before its reply search
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
  app.cheatArrows = []; // stale the moment the position changes
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
  if (mover === 'player') app.quakeMarks = null;
  app.boardUI.setPosition(app.duel.fen());
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
 * The quake, in three beats. The old version fired the board shake, the
 * square flashes and the teleport into one 450 ms window — so the piece
 * jumped while its own 700 ms cue was still playing, and nothing on the
 * board said which way it went. Now: rumble, then motion, then a settle
 * before the enemy's reply is allowed to land on top of it.
 */
async function onQuake({ displacements, crumble, endedGame, postFen }) {
  const duel = app.duel;
  const ui = app.boardUI;
  const board = $('board');
  setStatus(crumble ? 'the arena shudders — the floor gives!' : 'the arena shudders…');

  // Beat 1 — the rumble, alone, so the eye is on the board before anything moves.
  board.style.setProperty('--fx-ms', `${FX(280)}ms`);
  board.classList.add('quaking');
  await wait(FX(280));
  board.classList.remove('quaking');
  board.style.removeProperty('--fx-ms');
  if (app.duel !== duel) return;

  // Beat 2 — the motion. A quake is displacement-only OR crumble-only
  // (director.quake() returns as soon as it has displacements, and only
  // reaches the crumble leg with none), so these never contend for frames.
  if (displacements.length) await ui.animateSlides(displacements, { ms: FX(340), stagger: FX(120) });
  else if (crumble) await ui.animateCrumble(crumble.square, FX(450));
  if (app.duel !== duel) return; // user backed out mid-animation

  // Beat 3 — commit and mark. These marks outlive the enemy's reply.
  ui.setPosition(postFen);
  app.quakeMarks = {
    from: displacements.map((d) => d.from),
    to: displacements.map((d) => d.to),
    pit: crumble ? crumble.square : null,
  };
  renderPlayMarks();
  await wait(FX(240)); // settle: the reply does not land in the same breath
  if (app.duel !== duel) return;
  const bits = [];
  for (const d of displacements) {
    const yours = (d.piece === d.piece.toUpperCase() ? 'white' : 'black') === app.arena.playerColor;
    bits.push(`${yours ? 'your' : 'enemy'} ${pieceName(d.piece)} ${d.from}→${d.to}`);
  }
  if (crumble) {
    let c = `${crumble.square} collapses`;
    if (crumble.pieceLost && crumble.pieceLost !== '*') {
      const yours = (crumble.pieceLost === crumble.pieceLost.toUpperCase() ? 'white' : 'black') === app.arena.playerColor;
      c += ` · ${yours ? 'your' : 'enemy'} ${pieceName(crumble.pieceLost)} is swallowed`;
    }
    bits.push(c);
  }
  if (endedGame) bits.push('nowhere left to stand');
  log($('duel-log'), `⚠ the gods stir — ${bits.join(' · ')}`, 'crumble');
}

function pieceName(letter) {
  return { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[letter.toLowerCase()] ?? letter;
}

/** Engine-stall recovery (duel.mjs ladder): abandon the dead WASM instance
 *  (never quit() — rule 6), boot a fresh one, reload the catalog. */
async function onEngineStall() {
  setStatus('the enemy summoner falters — reforming…');
  log($('duel-log'), '⚠ engine stalled — recycling instance', 'crumble');
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
  if (cheatEval()) updateEvalBar(score, app.arena.enemyColor);
}

async function onEnd({ result, winner, termination }) {
  app.phase = 'ended';
  app.busy = false;
  app.boardUI.setInteractive(false);
  const playerWon = winner === app.arena.playerColor;
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
  setStatus(result ? `${result} · ${termination}` : 'error');
}

// ------------------------------------------------------------------- wiring

$('btnBegin').addEventListener('click', beginDuel);
$('btnResetPlacement').addEventListener('click', () => {
  app.placement = defaultPlacement(app.arena);
  app.enemySetup = defaultEnemySetup(app.arena);
  app.selectedTrayId = null;
  app.enemySelected = null;
  refreshPlacement();
});
$('btnBack').addEventListener('click', () => {
  const hintQuiet = cancelCheatSearch(); // a cheat probe is also an in-flight search
  const d = app.duel;
  app.duel = null;
  if (d) d.destroy(); // sends 'stop' to any in-flight search
  // Fence: the next duel waits for every flushed bestmove before reusing the engine.
  app.enginePending = Promise.all([hintQuiet, d ? d.whenQuiet() : null]).then(() => {});
  app.busy = false;
  app.phase = 'menu';
  showScreen('menu');
  refreshCheatUI();
  $('title').textContent = 'Dungeon Crawler King';
  setStatus('choose an arena');
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
for (const [el, key] of [['optCheat', 'cheat'], ['optHints', 'hints'], ['optUndo', 'undo'], ['optEval', 'evalBar'], ['optEnemyEdit', 'enemyEdit']]) {
  $(el).addEventListener('change', (e) => {
    options[key] = e.target.checked;
    applyOptions();
  });
}
$('optHintN').addEventListener('change', (e) => {
  options.hintN = parseInt(e.target.value, 10);
  applyOptions();
});
$('optGodPreset').addEventListener('change', (e) => {
  options.godPreset = e.target.value;
  if (options.godPreset === 'custom' && !options.godCustom) options.godCustom = { ...GOD_PRESETS.restless };
  applyOptions();
});
for (const k of GOD_KNOBS) {
  $(`god_${k}`).addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    if (!Number.isInteger(v) || v < 1) return syncOptionsUI(); // reject, restore
    options.godCustom = { ...(options.godCustom ?? GOD_PRESETS.restless), [k]: v };
    options.godPreset = 'custom';
    applyOptions();
  });
}
$('btnAgain').addEventListener('click', () => {
  $('overlay').hidden = true;
  openArena(app.arena);
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
  // so it can be exercised from the console / E2E today.
  setFavor: (mult) => app.duel?.director.setFavor(mult),
  ready: null,
  openArenaById: (id) => {
    const a = app.arenas.find((x) => x.id === id);
    if (!a) throw new Error(`no arena ${id}`);
    return openArena(a);
  },
  autoplace: () => {
    app.placement = defaultPlacement(app.arena);
    refreshPlacement();
  },
  begin: () => beginDuel(),
  legalMoves: () => app.duel.legalMoves(),
  randomMove: () => {
    const legal = app.duel.legalMoves();
    return legal[Math.floor(Math.random() * legal.length)];
  },
  playerMove: async (uci) => {
    await cancelCheatSearch();
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
syncOptionsUI();
window.__DCK.ready = boot();

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
//   &onset=N&cadence=N&seed=N  override the arena's crumble config
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

const app = {
  ffish: null,
  engine: null,
  catalog: null,
  cheatArrows: [], // current best-move arrows (cheat mode): {from, to, strength}
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
const options = { cheat: false, hints: false, hintN: 3, undo: false, evalBar: false, enemyEdit: false };

function loadOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPT_KEY) ?? '{}');
    for (const k of Object.keys(options)) if (k in saved) options[k] = saved[k];
    if (![1, 2, 3].includes(options.hintN)) options.hintN = 3;
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
const cheat = { seq: 0, active: null };

async function cancelCheatSearch() {
  cheat.seq++;
  if (cheat.active) {
    try {
      app.engine.send('stop');
    } catch {
      /* dead engine */
    }
    await cheat.active;
    cheat.active = null;
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
  engine.setoption('MultiPV', String(n));
  engine.position({ fen: duel.baseFen, moves: duel.movesSinceBase });
  const p = engine.go('depth 60 movetime 450', { timeout: 12000 }).finally(() => {
    try {
      engine.setoption('MultiPV', '1');
    } catch {
      /* dead engine */
    }
  });
  cheat.active = p.catch(() => {});
  let res;
  try {
    res = await p;
  } catch {
    return; // stalled probe — the duel's own recovery ladder owns engine health
  }
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

  const crumble = {
    onsetPly: intParam('onset', arena.crumble.onsetPly, 1),
    cadence: intParam('cadence', arena.crumble.cadence, 0),
    seed: intParam('seed', arena.crumble.seed, 1),
  };
  app.cheatArrows = [];
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
    crumble,
    go: params.get('go') ?? 'depth 60 movetime 500',
    hooks: { onMove, onCrumble, onEnd, onEngineInfo, onEngineStall },
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
  const marks = { lastMove: lastMoveMarks(), check: checkMark(), arrows: app.cheatArrows };
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

async function onMove({ san, mover, ply }) {
  app.cheatArrows = []; // stale the moment the position changes
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

async function onCrumble({ square, type, pieceLost, endedGame, postFen }) {
  const duel = app.duel;
  const ui = app.boardUI;
  setStatus(type === 'repetition' ? 'the repeated ground gives way!' : 'the arena is crumbling…');
  await ui.animateCrumble(square);
  if (app.duel !== duel) return; // user backed out mid-animation
  ui.setPosition(postFen);
  renderPlayMarks();
  let line = `⚠ ${type} crumble — ${square} collapses`;
  if (pieceLost) {
    const color = pieceLost === pieceLost.toUpperCase() ? 'white' : 'black';
    const yours = color === app.arena.playerColor;
    line += ` · ${yours ? 'your' : 'enemy'} ${pieceName(pieceLost)} is swallowed`;
  }
  if (endedGame) line += ' · nowhere left to stand';
  log($('duel-log'), line, 'crumble');
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
          stalemate: playerWon
            ? 'The enemy king has nowhere left to stand — the floor gives way beneath him.'
            : 'Your king has nowhere left to stand — the floor gives way.',
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

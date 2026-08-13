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
import { ARENA_MANIFEST, fetchArena, playerSlotSquares, buildStartFen, buildPreviewFen } from './arena.mjs';
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

/** Default placement: king nearest the patch middle, pieces by value outward
 *  (the harness's "balanced" archetype, §7). */
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
  return placement;
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
  app.selectedTrayId = null;

  // §4.3 QoL: auto-skip when there is genuinely no choice to make.
  const slots = playerSlotSquares(arena);
  const noChoice = arena.player.pieceSet.length === 0 && slots.length === 1;
  refreshPlacement();
  if (noChoice || params.get('autoplace')) {
    if (noChoice || params.get('autobegin')) await beginDuel();
  }
}

/** Tray model: one entry per pool piece; king first. */
function trayItems() {
  const placedBySquare = Object.entries(app.placement); // [sq, piece]
  const pool = [{ id: 'K', piece: 'K' }, ...app.arena.player.pieceSet.map((p, i) => ({ id: `${p}${i}`, piece: p }))];
  const used = new Map(); // piece -> count placed
  for (const [, p] of placedBySquare) used.set(p, (used.get(p) ?? 0) + 1);
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

function refreshPlacement() {
  const arena = app.arena;
  app.boardUI.setPosition(buildPreviewFen(arena, app.placement));
  app.boardUI.setMarks({ slots: playerSlotSquares(arena).filter((sq) => !app.placement[sq]) });
  app.tray.setPieces(trayItems());
  app.boardUI.setInteractive(true);
  const hasKing = Object.values(app.placement).includes('K');
  $('btnBegin').disabled = !hasKing;
  setStatus(hasKing ? 'place your pieces — then begin' : 'place your king');
}

function onTrayTap(id) {
  if (app.phase !== 'placement') return;
  const items = trayItems();
  const item = items.find((x) => x.id === id);
  if (!item || item.state === 'placed') return;
  app.selectedTrayId = app.selectedTrayId === id ? null : id;
  refreshPlacement();
}

function placementTap(sq) {
  const slots = playerSlotSquares(app.arena);
  if (!slots.includes(sq)) return;
  const existing = app.placement[sq];
  if (app.selectedTrayId) {
    const piece = app.selectedTrayId === 'K' ? 'K' : app.selectedTrayId.replace(/\d+$/, '');
    // A king may only exist once: placing it elsewhere moves it.
    if (piece === 'K') {
      for (const [s, p] of Object.entries(app.placement)) if (p === 'K') delete app.placement[s];
    }
    app.placement[sq] = piece; // replaces any occupant (it returns to the tray)
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
    ({ startFen } = buildStartFen(arena, app.placement));
  } catch (e) {
    setStatus(e.message);
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
  } else {
    app.busy = true;
    app.boardUI.setInteractive(false);
    setStatus('the enemy is thinking…');
    const r = await duel.engineMove();
    if (!r.ended) await driveTurn();
  }
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
  if (froms.has(sq) && sq !== from) {
    app.selectedSquare = sq;
    const targets = legal
      .map((m) => m.match(UCI_MOVE_RE))
      .filter((p) => p && p[1] === sq)
      .map((p) => p[2]);
    app.boardUI.setMarks({ selected: sq, targets: [...new Set(targets)], lastMove: lastMoveMarks() });
  } else {
    app.selectedSquare = null;
    app.boardUI.setMarks({ lastMove: lastMoveMarks() });
  }
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
  app.boardUI.setPosition(app.duel.fen());
  const check = checkMark();
  app.boardUI.setMarks({ lastMove: lastMoveMarks(), check });
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
  ui.setMarks({});
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
  $('overlay').hidden = false;
  setStatus(result ? `${result} · ${termination}` : 'error');
}

// ------------------------------------------------------------------- wiring

$('btnBegin').addEventListener('click', beginDuel);
$('btnResetPlacement').addEventListener('click', () => {
  app.placement = defaultPlacement(app.arena);
  app.selectedTrayId = null;
  refreshPlacement();
});
$('btnBack').addEventListener('click', () => {
  if (app.duel) {
    const d = app.duel;
    app.duel = null;
    d.destroy(); // sends 'stop' to any in-flight search
    app.enginePending = d.whenQuiet(); // fence: next duel waits for the flushed bestmove
  }
  app.busy = false;
  app.phase = 'menu';
  showScreen('menu');
  $('title').textContent = 'Dungeon Crawler King';
  setStatus('choose an arena');
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
    const r = await app.duel.playerMove(uci);
    if (!r.ended) await driveTurn();
    return app.duel.state;
  },
  waitIdle: async () => {
    while (app.busy) await new Promise((res) => setTimeout(res, 50));
    return app.duel?.state ?? app.phase;
  },
};

window.__DCK.ready = boot();

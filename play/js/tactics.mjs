// TACTICS — the threat ledger and the protected set (the Gods, v4).
//
// v4 (designer 2026-09-05) gave the Director two things it never had: a
// memory of what either side is THREATENING, and a rule that the gods may
// not touch it. Before this module the Director's whole tactical vocabulary
// was threat.mjs — static exchange on a landing square plus the ray test for
// what an edit uncovers — and both only ever asked whether an edit CREATES a
// new loss. Neither asked whether an edit RELIEVES one. So the guards were
// one-directional: a displacement could not move a piece INTO attack, and
// could freely move a forked piece OUT of the fork; a pinned piece with no
// legal moves was exactly what the second displacement tier hunted for; and
// a mating net — which immobilizes pieces, which is what the Director's
// "unstick" charter targets — was indistinguishable from a fortress. Measured
// on the v3 corpora: a third of the quakes that fired onto a board with a
// forced mate already on it destroyed or delayed that mate, and on mate-in-2
// or less it was closer to half. The mechanic built to shorten duels was
// un-mating them on a treadmill.
//
// Two exports carry the fix:
//
//   threatLedger(grid)    grid-only, every ply: for EACH side, the threats it
//                         currently holds — pieces it wins by static exchange
//                         ("hang"), pins, skewers, forks — as keys, plus the
//                         pieces and squares that make each threat work. The
//                         meter diffs a mover's keys ply to ply: a move that
//                         creates a new threat is a HOT ply (meter.mjs), so
//                         building an attack reads as action, not boredom.
//   forcedWins(ffish)     ffish-only, on quake plies: every win-in-1 for
//                         either side (a move after which the opponent has no
//                         legal moves — mate, stalemate-as-loss and the
//                         bare-army strip are one test under rule 4), and
//                         mate-in-2 by a bounded checks-and-captures search.
//                         Each winning line yields its NET — the mating piece,
//                         the mated king's zone, everything attacking or
//                         standing in it, the line squares — mapped back onto
//                         the board the gods are about to edit.
//
// The Director unions both into a protected set (protectedSet below) and
// enforces three vetoes on every rung: no displacement of a protected piece,
// no landing on a protected square, no terrain edit or hole on a protected
// square. Everything else on the board stays fair game (designer: "they can
// still displace stuff, just not the specific pieces responsible").
//
// Symmetric by construction: both sides' threats are computed the same way
// and colour never enters a decision (designer: "the gods don't know or care
// which color is the player"). Deterministic: the ledger is pure grid
// arithmetic and the win search visits moves in ffish's legal-move order
// under a NODE budget (never a clock), so seeded replay is untouched.
//
// Terrain is never an attacker, a victim or a ray square here — rays stop at
// walls and crates exactly as they do in threat.mjs, and every cell test goes
// through isTerrain first ('^' === '^'.toUpperCase() is the standing
// landmine, §4.6).

import { isTerrain, splitFen, joinFen } from './fen.mjs';
import { captureLoss, PIECE_VALUE } from './threat.mjs';

const SQ = (f, r) => `${String.fromCharCode(97 + f)}${r + 1}`;
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KING_STEPS = [...ORTHO, ...DIAG];
const KNIGHT_HOPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const UCI_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))([a-z]?)$/;
/** 'e4' → { f, r } (0-based). */
const sqFR = (sq) => ({ f: sq.charCodeAt(0) - 97, r: parseInt(sq.slice(1), 10) - 1 });

const isWhite = (ch) => ch === ch.toUpperCase();
const valueOf = (ch) => PIECE_VALUE[ch.toLowerCase()] ?? 0;
const sideOf = (ch) => (isWhite(ch) ? 'white' : 'black');
const onBoard = (f, r, files, ranks) => f >= 0 && f < files && r >= 0 && r < ranks;

/** Ray directions a piece slides along, or null for a leaper/stepper. */
function sliderDirs(ch) {
  const t = ch.toLowerCase();
  if (t === 'q') return KING_STEPS;
  if (t === 'r') return ORTHO;
  if (t === 'b') return DIAG;
  return null;
}

/**
 * Squares the piece on (f, r) attacks, as [{f, r, ch}] of the OCCUPANTS it
 * attacks plus the empty squares it covers ({f, r, ch: null}). Rays stop at
 * the first occupant (included) and at terrain (excluded). Pawns attack
 * diagonally forward only; kings step; knights leap over anything (§4.5).
 */
export function attacksFrom(grid, f, r, files, ranks) {
  const ch = grid[r][f];
  const out = [];
  if (!ch || isTerrain(ch)) return out;
  const t = ch.toLowerCase();
  const push = (nf, nr) => {
    if (!onBoard(nf, nr, files, ranks)) return false;
    const occ = grid[nr][nf];
    if (isTerrain(occ)) return false;
    out.push({ f: nf, r: nr, ch: occ ?? null });
    return !occ;
  };
  const dirs = sliderDirs(ch);
  if (dirs) {
    for (const [df, dr] of dirs) {
      let nf = f + df;
      let nr = r + dr;
      while (push(nf, nr)) {
        nf += df;
        nr += dr;
      }
    }
  } else if (t === 'n') {
    for (const [df, dr] of KNIGHT_HOPS) push(f + df, r + dr);
  } else if (t === 'k') {
    for (const [df, dr] of KING_STEPS) push(f + df, r + dr);
  } else if (t === 'p') {
    const dr = isWhite(ch) ? 1 : -1;
    push(f - 1, r + dr);
    push(f + 1, r + dr);
  }
  return out;
}

/** Every piece on the grid, as [{f, r, ch, sq}]. */
export function piecesOn(grid, files, ranks) {
  const out = [];
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      const ch = grid[r][f];
      if (ch && !isTerrain(ch)) out.push({ f, r, ch, sq: SQ(f, r) });
    }
  }
  return out;
}

/** Attackers of every square: Map<sq, [{f, r, ch, sq}]>, both colours. */
export function attackMap(grid, files, ranks) {
  const map = new Map();
  for (const p of piecesOn(grid, files, ranks)) {
    for (const a of attacksFrom(grid, p.f, p.r, files, ranks)) {
      const key = SQ(a.f, a.r);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
  }
  return map;
}

/** Empty squares strictly between two aligned squares (a ray walk). */
function between(a, b) {
  const out = [];
  const df = Math.sign(b.f - a.f);
  const dr = Math.sign(b.r - a.r);
  if (!df && !dr) return out;
  const aligned = a.f === b.f || a.r === b.r || Math.abs(b.f - a.f) === Math.abs(b.r - a.r);
  if (!aligned) return out;
  let f = a.f + df;
  let r = a.r + dr;
  while (f !== b.f || r !== b.r) {
    out.push(SQ(f, r));
    f += df;
    r += dr;
  }
  return out;
}

function mkSide() {
  return { keys: new Set(), pieces: new Set(), squares: new Set() };
}

/**
 * The threat ledger: what each side is threatening RIGHT NOW, read from the
 * grid alone.
 *
 *   hang:<sq>    the other side's piece on <sq> is lost to static exchange
 *                (captureLoss > 0) — the fork's victims land here too, since a
 *                queen attacked by a knight is SEE-losing even when defended
 *   pin:<sq>     a slider pins the enemy piece on <sq> to a more valuable one
 *                (or the king) behind it
 *   skewer:<sq>  a slider attacks the enemy piece on <sq> with a less
 *                valuable one behind it (a checked king counts)
 *   fork:<sq>    one piece on <sq> attacks two or more targets that are
 *                hanging or the king
 *
 * `pieces` is every piece that makes the threat work (attacker AND victim,
 * the piece behind a pin) and `squares` every empty square the threat runs
 * through — together, what a quake may not touch. Returns
 * { white: {keys, pieces, squares}, black: {...} }.
 */
export function threatLedger(grid, files, ranks) {
  const sides = { white: mkSide(), black: mkSide() };
  const pieces = piecesOn(grid, files, ranks);
  const attacks = attackMap(grid, files, ranks);

  // hang — priced by the same SEE the landing guard uses (threat.mjs)
  for (const p of pieces) {
    if (captureLoss(grid, p.f, p.r, files, ranks) <= 0) continue;
    const atk = sides[isWhite(p.ch) ? 'black' : 'white'];
    atk.keys.add(`hang:${p.sq}`);
    atk.pieces.add(p.sq);
    for (const a of attacks.get(p.sq) ?? []) {
      if (isWhite(a.ch) === isWhite(p.ch)) continue;
      atk.pieces.add(a.sq);
      for (const s of between(a, p)) atk.squares.add(s);
    }
  }

  // pins and skewers — walk every slider's rays two occupants deep
  for (const s of pieces) {
    const dirs = sliderDirs(s.ch);
    if (!dirs) continue;
    const mine = sides[sideOf(s.ch)];
    for (const [df, dr] of dirs) {
      let f = s.f + df;
      let r = s.r + dr;
      let first = null;
      let second = null;
      while (onBoard(f, r, files, ranks)) {
        const occ = grid[r][f];
        if (isTerrain(occ)) break;
        if (occ) {
          if (!first) first = { f, r, ch: occ, sq: SQ(f, r) };
          else {
            second = { f, r, ch: occ, sq: SQ(f, r) };
            break;
          }
        }
        f += df;
        r += dr;
      }
      if (!first || !second) continue;
      if (isWhite(first.ch) === isWhite(s.ch) || isWhite(second.ch) === isWhite(s.ch)) continue;
      const vFirst = valueOf(first.ch);
      const vSecond = valueOf(second.ch);
      let kind = null;
      if (second.ch.toLowerCase() === 'k' || vSecond > vFirst) kind = 'pin';
      else if (vFirst > vSecond) kind = 'skewer';
      if (!kind) continue;
      mine.keys.add(`${kind}:${first.sq}`);
      mine.pieces.add(s.sq);
      mine.pieces.add(first.sq);
      mine.pieces.add(second.sq);
      for (const sq of between(s, first)) mine.squares.add(sq);
      for (const sq of between(first, second)) mine.squares.add(sq);
    }
  }

  // forks — one attacker, two or more paying targets
  for (const p of pieces) {
    const mine = sides[sideOf(p.ch)];
    const targets = [];
    for (const a of attacksFrom(grid, p.f, p.r, files, ranks)) {
      if (!a.ch || isWhite(a.ch) === isWhite(p.ch)) continue;
      const sq = SQ(a.f, a.r);
      if (a.ch.toLowerCase() === 'k' || mine.keys.has(`hang:${sq}`)) targets.push(sq);
    }
    if (targets.length < 2) continue;
    mine.keys.add(`fork:${p.sq}`);
    mine.pieces.add(p.sq);
    for (const sq of targets) mine.pieces.add(sq);
  }

  return sides;
}

/** Keys `side` holds in `now` that it did not hold in `prev` — the threats
 *  its last move created. `prev` may be null (first ply). */
export function newThreats(prev, now, side) {
  const out = [];
  const before = prev?.[side]?.keys;
  for (const k of now[side].keys) if (!before || !before.has(k)) out.push(k);
  return out;
}

function flipTurn(fen) {
  const f = splitFen(fen);
  f.turn = f.turn === 'w' ? 'b' : 'w';
  return joinFen(f);
}

/** Board field of a FEN → cell grid [rankFromBottom][file] (fenGrid's twin;
 *  duplicated here so tactics.mjs depends on nothing in director.mjs). */
export function gridOf(fen, files, ranks) {
  const g = Array.from({ length: ranks }, () => Array(files).fill(null));
  fen.split(' ')[0].split('/').forEach((row, ri) => {
    const r = ranks - 1 - ri;
    let f = 0;
    for (let i = 0; i < row.length; i++) {
      const m = row.slice(i).match(/^\d+/);
      if (m) {
        f += parseInt(m[0], 10);
        i += m[0].length - 1;
        continue;
      }
      g[r][f] = row[i];
      f++;
    }
  });
  return g;
}

/** Every move after which the opponent has no legal move — mate, stalemate
 *  (mover-loses, §4.4) or a bare-army strip, one test under rule 4. Runs on
 *  the live board with push/pop (21 µs a move; a fresh Board costs 2.7 ms). */
export function winInOne(board) {
  const wins = [];
  const moves = board.legalMoves().trim().split(/\s+/).filter(Boolean);
  for (const m of moves) {
    board.push(m);
    if (board.numberLegalMoves() === 0) wins.push({ move: m, fen: board.fen() });
    board.pop();
  }
  return { wins, nodes: moves.length };
}

/**
 * The mating NET of a terminal position (the side to move has no legal
 * move): the mated king's zone (its square and the 8 around it), every piece
 * standing in or attacking that zone — both colours; the loser's own
 * blockers are part of the net — and the line squares from each attacker of
 * the king to the king. Returns { pieces: Set<sq>, squares: Set<sq> }.
 */
export function netOf(fen, files, ranks) {
  const g = gridOf(fen, files, ranks);
  const loserWhite = fen.split(' ')[1] === 'w';
  const pieces = new Set();
  const squares = new Set();
  let king = null;
  for (const p of piecesOn(g, files, ranks)) {
    if (p.ch.toLowerCase() === 'k' && isWhite(p.ch) === loserWhite) king = p;
  }
  if (!king) return { pieces, squares };
  const zone = [{ f: king.f, r: king.r }];
  for (const [df, dr] of KING_STEPS) {
    const f = king.f + df;
    const r = king.r + dr;
    if (onBoard(f, r, files, ranks)) zone.push({ f, r });
  }
  const attacks = attackMap(g, files, ranks);
  for (const z of zone) {
    const sq = SQ(z.f, z.r);
    squares.add(sq);
    const occ = g[z.r][z.f];
    if (occ && !isTerrain(occ)) pieces.add(sq);
    for (const a of attacks.get(sq) ?? []) {
      pieces.add(a.sq);
      if (z.f === king.f && z.r === king.r) for (const s of between(a, king)) squares.add(s);
    }
  }
  return { pieces, squares };
}

/**
 * Forced wins for EITHER side on `fen`, and their nets mapped back onto the
 * board as it stands now.
 *
 * Depth 1 is exact: every win-in-1 for the side to move, and for the side
 * that just moved (turn flipped — "the trap is set"; skipped when the side
 * to move is in check, where the flipped position is illegal). Depth 2 is a
 * bounded search: first moves are checks and captures (every legal move, forcing
 * ones first, when there are `allMovesBelow` or fewer), every defender reply, then the exact
 * win-in-1 test. `nodeBudget` counts pushes — never a clock — so the result
 * is a pure function of the position and replay survives; when it runs out
 * the search stops and `truncated` says so.
 *
 * Returns { pieces, squares, wins: {white, black}, lines, nodes, truncated }.
 * `pieces` are squares whose occupant the gods may not move; `squares` are
 * squares nothing may land on and no edit may touch. A move's FROM square is
 * a protected piece (the piece sits there now) and its TO square a protected
 * square (the line runs through it).
 */
export function forcedWins(ffish, variant, fen, files, ranks, { depth = 2, nodeBudget = 12000, allMovesBelow = 32 } = {}) {
  const out = { pieces: new Set(), squares: new Set(), wins: { white: 0, black: 0 }, lines: [], nodes: 0, truncated: false };
  if (ffish.validateFen(fen, variant) !== 1) return out;
  const turnWhite = fen.split(' ')[1] === 'w';
  const root = new ffish.Board(variant, fen);
  const inCheck = root.isCheck();
  root.delete();

  // A move in a winning line protects its mover (FROM: the piece stands
  // there now), its destination, and its PATH — the squares a slider crosses
  // to get there. The first cut protected a1 and a8 for Ra8# and left a2–a7
  // open: a pawn scooted onto a3, a hole opened on a6, and the mate was gone
  // (the dev fixture un-mated 22 of 40 seeds until the path joined the net).
  const absorbMove = (uci) => {
    const m = UCI_RE.exec(uci);
    if (!m) return;
    out.pieces.add(m[1]);
    out.squares.add(m[2]);
    for (const sq of between(sqFR(m[1]), sqFR(m[2]))) out.squares.add(sq);
  };
  const absorb = (line) => {
    absorbMove(line.move);
    for (const net of line.nets) {
      for (const sq of net.pieces) out.pieces.add(sq);
      for (const sq of net.squares) out.squares.add(sq);
    }
  };

  for (const side of ['white', 'black']) {
    const own = side === 'white' ? turnWhite : !turnWhite;
    if (!own && inCheck) continue; // flipped position would be illegal
    const f = own ? fen : flipTurn(fen);
    if (!own && ffish.validateFen(f, variant) !== 1) continue;
    const b = new ffish.Board(variant, f);
    try {
      // --- depth 1: exact ---
      const one = winInOne(b);
      out.nodes += one.nodes;
      const winning = new Set();
      for (const w of one.wins) {
        winning.add(w.move);
        const line = { side, depth: 1, move: w.move, nets: [netOf(w.fen, files, ranks)] };
        out.lines.push(line);
        absorb(line);
        out.wins[side]++;
      }
      if (depth < 2) continue;
      // --- depth 2: bounded, checks and captures first ---
      // One push per move classifies it; forcing moves are searched first so
      // a budget cut loses the quiet candidates, never the checks.
      const moves = b.legalMoves().trim().split(/\s+/).filter(Boolean);
      const all = moves.length <= allMovesBelow;
      const forcing = [];
      const quiet = [];
      for (const m of moves) {
        if (winning.has(m)) continue;
        const cap = b.isCapture(m);
        b.push(m);
        out.nodes++;
        const chk = b.isCheck();
        b.pop();
        (cap || chk ? forcing : quiet).push(m);
      }
      for (const m of all ? [...forcing, ...quiet] : forcing) {
        if (out.nodes >= nodeBudget) {
          out.truncated = true;
          break;
        }
        b.push(m);
        out.nodes++;
        const replies = b.legalMoves().trim().split(/\s+/).filter(Boolean);
        const branches = [];
        let forced = replies.length > 0;
        for (const r of replies) {
          if (out.nodes >= nodeBudget) {
            out.truncated = true;
            forced = false;
            break;
          }
          b.push(r);
          out.nodes++;
          const w = winInOne(b);
          out.nodes += w.nodes;
          b.pop();
          if (!w.wins.length) {
            forced = false;
            break;
          }
          branches.push({ reply: r, wins: w.wins });
        }
        if (forced) {
          const nets = [];
          const later = [];
          for (const br of branches) {
            later.push(br.reply);
            for (const w of br.wins) {
              later.push(w.move);
              nets.push(netOf(w.fen, files, ranks));
            }
          }
          const line = { side, depth: 2, move: m, nets };
          out.lines.push(line);
          absorb(line);
          // The replies and the finishing moves are part of the line too:
          // their movers stand on their FROM squares now (or the square is
          // empty and only landings and edits there matter — harmless).
          for (const uci of later) absorbMove(uci);
          out.wins[side]++;
        }
        b.pop();
      }
    } finally {
      b.delete();
    }
  }
  return out;
}

/**
 * Everything a quake may not touch on `fen`: the union of both sides' threat
 * ledgers (pieces + squares) and every forced win's net. Pure of RNG. The
 * Director calls this once per quake that fires and threads the result
 * through every rung.
 */
export function protectedSet(ffish, variant, fen, files, ranks, opts = {}) {
  const grid = gridOf(fen, files, ranks);
  const ledger = threatLedger(grid, files, ranks);
  const wins = forcedWins(ffish, variant, fen, files, ranks, opts);
  const pieces = new Set([...ledger.white.pieces, ...ledger.black.pieces, ...wins.pieces]);
  const squares = new Set([...ledger.white.squares, ...ledger.black.squares, ...wins.squares]);
  return {
    pieces,
    squares,
    threats: { white: ledger.white.keys.size, black: ledger.black.keys.size },
    wins: wins.wins,
    lines: wins.lines.map((l) => ({ side: l.side, depth: l.depth, move: l.move })),
    nodes: wins.nodes,
    truncated: wins.truncated,
  };
}

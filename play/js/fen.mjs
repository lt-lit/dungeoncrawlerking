// FEN utilities for largeboard Fairy-Stockfish positions.
//
// Handles: multi-digit empty runs (boards up to 12 files), terrain squares
// (`*` stone wall, `#` hard wall, `_` pit, `^` furniture), pockets `[...]`,
// and per-square editing.
// The board is represented as a 2D array indexed [rankFromTop][file] where
// rankFromTop 0 is the highest rank (first FEN rank). Cell values: piece
// char ('K', 'p', ...), '*' wall, '#' hard wall, '_' pit, '^' furniture, or
// null for empty.

// THE THREE TERRAIN GLYPHS (brief §4.6, §4.8). '*' is the BREAKABLE wall:
// the gods' weaken rung and the sledgehammer turn it into '^'. '#' is ANY
// INDESTRUCTIBLE OBSTACLE (wall-kinds, 2026-09-17): bedrock, the map's edge,
// a pit a crumble wrote — one thing to the engine, a square nothing enters
// and nothing can crack (engine/patches/wall-kinds.patch). What a '#' LOOKS
// like (a pit or a dark stone) is the game's own ledger's to say — the
// Director's holes list — never the engine's; a pit is permanent, never
// weakened, never reopened (that permanence is the termination guarantee,
// §4.5). Before 2026-09-17 a hole was a '*' in the ledger; old logs still
// read that way (the ledger decides, whatever the glyph).
//
// '^' is furniture — a neutral occupant either side may capture (an ordinary
// capture, priced natively by the patched engine pair). Since v3 the gods
// both CREATE it (weakening a wall) and REMOVE it (breaching); nothing else
// does. It is TERRAIN to every game system except the capture itself
// (molding, crop, the camp line, and displacement, which neither carries a
// crate nor lands on one). This module is the leaf every consumer already
// imports — cell tests belong here, not hand-rolled (the '^'-as-white-piece
// toUpperCase() landmine class).
export const WALL = '*';
export const FURNITURE = '^';
export const HARD = '#';
// THE PIT (2026-09-20, engine/patches/ice.patch; brief §4.9): '_' is a HOLE
// the engine can tell from bedrock — a square nothing enters by a move (as
// '#') but that a SLIDING piece falls into and dies in. Before the ice a pit
// and bedrock shared '#' and the ledger told them apart for the eye alone;
// the designer's "sliding pieces can fall into holes and die. So I guess we
// do in fact need to differentiate between holes and indestructible walls"
// gave the pit its own glyph. A crumble writes '_' now (plus the ledger
// entry, as ever); every off-map square and every bedrock stays '#'. Old
// logs still spell a pit '#' (or '*'): the ledger decides what the eye sees.
export const PIT = '_';

// THE PORTALS (2026-09-17, engine/patches/portals.patch): a cast is a DROP of
// the portal scroll, `O@e4` for either side (FSF prints the piece letter
// uppercase for both hands); a move whose target is a portal square is a
// portal move — plain `from``to` notation, the engine and the game both know
// the square is a portal. The pairs and the half-open portals ride the
// FEN's trailing field, `{c3-h8,d1-a9,e4w}`.
export const CAST_RE = /^([A-Za-z])@([a-l](?:10|[1-9]))$/;
export const isCast = (uci) => CAST_RE.test(uci);
/** PORTALS v3 (the one-turn cast): a PASS — the king's square twice (`e8e8`): the frozen side's one move, or a cast that fizzles. */
export const isPass = (uci) => { const m = String(uci ?? '').match(/^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))$/); return !!m && m[1] === m[2]; };

/** THE ICE (2026-09-20): the letter a cast drops — 'o' the portal scroll, 'i' the ice scroll — lowercase, or null for a move. */
export const castLetter = (uci) => { const m = String(uci ?? '').match(CAST_RE); return m ? m[1].toLowerCase() : null; };

/** Is this cell terrain (a wall of either kind, a pit or furniture)? Safe on null/undefined. */
export const isTerrain = (c) => c === WALL || c === FURNITURE || c === HARD || c === PIT;
/** Is this cell a wall of either kind or a pit — stone, not a crate, and nothing a piece may enter? */
export const isWall = (c) => c === WALL || c === HARD || c === PIT;

/** Split a full FEN into its fields. Returns { board, pocket, turn, castling, ep, halfmove, fullmove, rest } */
export function splitFen(fen) {
  const parts = fen.trim().split(/\s+/);
  let boardField = parts[0];
  let pocket = null;
  const m = boardField.match(/^(.*)\[(.*)\]$/);
  if (m) {
    boardField = m[1];
    pocket = m[2];
  }
  return {
    board: boardField,
    pocket,
    turn: parts[1] ?? 'w',
    castling: parts[2] ?? '-',
    ep: parts[3] ?? '-',
    halfmove: parts[4] ?? '0',
    fullmove: parts[5] ?? '1',
    rest: parts.slice(6),
  };
}

/** Parse the board field of a FEN into a 2D array [rankFromTop][file]. */
export function parseBoard(boardField) {
  return boardField.split('/').map((rankStr) => {
    const cells = [];
    let i = 0;
    while (i < rankStr.length) {
      const ch = rankStr[i];
      if (/\d/.test(ch)) {
        let j = i;
        while (j < rankStr.length && /\d/.test(rankStr[j])) j++;
        const n = parseInt(rankStr.slice(i, j), 10);
        for (let k = 0; k < n; k++) cells.push(null);
        i = j;
      } else if (ch === '*' || ch === '^' || ch === '#' || ch === '_') {
        cells.push(ch); // terrain: a breakable wall / furniture / an indestructible obstacle / a pit (§4.6, §4.8, §4.9)
        i++;
      } else if (ch === '+') {
        // promoted-piece prefix (shogi-style); keep attached to next char
        cells.push('+' + rankStr[i + 1]);
        i += 2;
      } else {
        cells.push(ch);
        i++;
      }
    }
    return cells;
  });
}

/** Serialize a 2D board array back into a FEN board field. */
export function serializeBoard(board) {
  return board
    .map((rank) => {
      let out = '';
      let run = 0;
      for (const cell of rank) {
        if (cell === null) {
          run++;
        } else {
          if (run > 0) {
            out += run;
            run = 0;
          }
          out += cell;
        }
      }
      if (run > 0) out += run;
      return out;
    })
    .join('/');
}

/**
 * The portal field of a FEN: `{c3-h8,d1-a9,e4w,~e5,~f5}` after the move
 * counters — linked pairs (`a-b`), half-open portals (a square and the
 * colour that opened it, `e4w` / `f6b`) and, since THE ICE (2026-09-20),
 * the SLIPPERY squares (`~e5`). Returns the pairs, the halves by colour, a
 * square → twin map, the set of every square a portal or a half stands on,
 * and `slick`: every slippery square as written (a portal square among them
 * is never slippery in play — the engine's `slick_effective`; `slickAt`
 * reads that). A FEN without the field parses to the empty shape.
 */
export function parsePortalField(fen) {
  const out = { pairs: [], halves: { w: null, b: null }, twin: new Map(), squares: new Set(), slick: new Set() };
  const m = String(fen ?? '').match(/\{([^}]*)\}/);
  if (!m) return out;
  for (const entry of m[1].split(',')) {
    const e = entry.trim();
    if (!e) continue;
    const ice = e.match(/^~([a-l](?:10|[1-9]))$/);
    if (ice) {
      out.slick.add(ice[1]);
      continue;
    }
    const pair = e.match(/^([a-l](?:10|[1-9]))-([a-l](?:10|[1-9]))$/);
    if (pair) {
      out.pairs.push([pair[1], pair[2]]);
      out.twin.set(pair[1], pair[2]);
      out.twin.set(pair[2], pair[1]);
      out.squares.add(pair[1]);
      out.squares.add(pair[2]);
      continue;
    }
    const half = e.match(/^([a-l](?:10|[1-9]))([wb])$/);
    if (half) {
      out.halves[half[2]] = half[1];
      out.squares.add(half[1]);
    }
  }
  return out;
}

/** The FEN with its holdings block set (`[OOoo]`): the scrolls in hand. */
export function withPocket(fen, pocket) {
  const f = splitFen(fen);
  f.pocket = pocket;
  return joinFen(f);
}

/** THE ICE: the slippery squares of a FEN that slide in play — the field's
 *  `~sq` entries less the portal squares (a portal square is never slippery:
 *  a slide that reaches one is a landing). */
export function slickSquares(fen) {
  const P = parsePortalField(fen);
  const out = new Set();
  for (const sq of P.slick) if (!P.squares.has(sq)) out.add(sq);
  return out;
}

/** The FEN with these squares slippery (`~sq` entries added to the trailing
 *  field, the pairs and halves kept) — the test fixtures' builder; in play
 *  the engine writes the field. */
export function withSlick(fen, squares) {
  const P = parsePortalField(fen);
  const all = new Set([...P.slick, ...squares]);
  const entries = [...P.pairs.map(([a, b]) => `${a}-${b}`), ...['w', 'b'].filter((s) => P.halves[s]).map((s) => `${P.halves[s]}${s}`), ...[...all].sort((a, b) => squareOrder(a) - squareOrder(b)).map((sq) => `~${sq}`)];
  const bare = String(fen).replace(/\s*\{[^}]*\}\s*$/, '').trim();
  return entries.length ? `${bare} {${entries.join(',')}}` : bare;
}

// ---- THE PORTAL SPELL's ledger (2026-09-17 — the designer, on the first
// portal duel: "the enemy portals should be a different color… each new
// portal pair has a unique color so the player can see how they link").
// The FEN's field names a pair without its caster (`c3-h8`) — only a half
// wears its side (`e4w`) — so who cast each pair, and in what order, is
// rebuilt by ONE FORWARD WALK over the positions (the residue rule's shape,
// board-ui residueStep): a pair that appears while a side's half stood on
// one of its squares is that side's, numbered in the order the side linked
// them; a pair with no such history (an authored pair, a bare FEN) is
// nobody's ('x'). The game walks the duel record's states, the analyzer a
// line's; a bare FEN alone paints every pair as nobody's.

const squareOrder = (sq) => {
  const s = parseSquare(sq);
  return s.rankFromBottom * 12 + s.file;
};

/** A pair's key, the lower square first (as the engine emits it). */
export function portalPairKey(a, b) {
  return squareOrder(a) <= squareOrder(b) ? `${a}-${b}` : `${b}-${a}`;
}

export function portalLedgerEmpty() {
  return { pairs: new Map(), count: { w: 0, b: 0, x: 0 } };
}

/** The ledger after one position follows another: every pair of `nextFen`
 *  keeps its entry, a new one is the side whose half stood on it in
 *  `prevFen` (else nobody's), numbered among that side's pairs. */
export function portalLedgerStep(ledger, prevFen, nextFen) {
  const prev = parsePortalField(prevFen);
  const next = parsePortalField(nextFen);
  const out = { pairs: new Map(), count: { ...ledger.count } };
  for (const [a, b] of next.pairs) {
    const key = portalPairKey(a, b);
    const known = ledger.pairs.get(key);
    if (known) {
      out.pairs.set(key, known);
      continue;
    }
    const side = prev.halves.w === a || prev.halves.w === b ? 'w' : prev.halves.b === a || prev.halves.b === b ? 'b' : 'x';
    out.pairs.set(key, { side, n: out.count[side]++ });
  }
  return out;
}

/** The ledger of a whole line of positions, walked from the first. */
export function portalLedger(fens) {
  let led = portalLedgerEmpty();
  let prev = null;
  for (const f of fens) {
    if (!f) continue;
    led = portalLedgerStep(led, prev, f);
    prev = f;
  }
  return led;
}

/** The field parsed (parsePortalField) plus `owner`: square → { side, n,
 *  half } — a pair's caster and its number among that caster's pairs, a
 *  half's side with the number its pair will get when it links. Without a
 *  ledger every pair is nobody's. */
export function portalInfo(fen, ledger = null) {
  const P = parsePortalField(fen);
  P.owner = new Map();
  for (const [a, b] of P.pairs) {
    const o = ledger?.pairs.get(portalPairKey(a, b)) ?? { side: 'x', n: 0 };
    P.owner.set(a, o);
    P.owner.set(b, o);
  }
  for (const side of ['w', 'b']) if (P.halves[side]) P.owner.set(P.halves[side], { side, n: ledger?.count[side] ?? 0, half: true });
  return P;
}

/** Reassemble a full FEN from split fields (as returned by splitFen). */
export function joinFen(f) {
  const boardField = f.pocket !== null && f.pocket !== undefined ? `${f.board}[${f.pocket}]` : f.board;
  return [boardField, f.turn, f.castling, f.ep, f.halfmove, f.fullmove, ...(f.rest ?? [])].join(' ');
}

/** Square name like 'e4' for file index (0-based) and rank index from bottom (0-based). */
export function squareName(file, rankFromBottom) {
  return String.fromCharCode(97 + file) + (rankFromBottom + 1);
}

/** Parse 'e4' → { file, rankFromBottom } (0-based). */
export function parseSquare(name) {
  const m = name.match(/^([a-l])(\d{1,2})$/);
  if (!m) throw new Error(`bad square: ${name}`);
  return { file: m[1].charCodeAt(0) - 97, rankFromBottom: parseInt(m[2], 10) - 1 };
}

/**
 * Edit one square of a FEN. `value` is a piece char, '*', '^', or null
 * (empty). Returns the new FEN. Board dimensions come from the FEN itself.
 */
export function setSquare(fen, square, value) {
  const f = splitFen(fen);
  const board = parseBoard(f.board);
  const ranks = board.length;
  const { file, rankFromBottom } = typeof square === 'string' ? parseSquare(square) : square;
  const rankFromTop = ranks - 1 - rankFromBottom;
  if (rankFromTop < 0 || rankFromTop >= ranks || file < 0 || file >= board[rankFromTop].length) {
    throw new Error(`square out of range: ${JSON.stringify(square)} on ${ranks} ranks`);
  }
  board[rankFromTop][file] = value;
  f.board = serializeBoard(board);
  return joinFen(f);
}

/** Get the value of one square of a FEN (piece char, '*', '^', or null). */
export function getSquare(fen, square) {
  const f = splitFen(fen);
  const board = parseBoard(f.board);
  const ranks = board.length;
  const { file, rankFromBottom } = typeof square === 'string' ? parseSquare(square) : square;
  const rankFromTop = ranks - 1 - rankFromBottom;
  return board[rankFromTop]?.[file];
}

/** Clear the en-passant field of a FEN (used on every crumble). */
export function clearEp(fen) {
  const f = splitFen(fen);
  f.ep = '-';
  return joinFen(f);
}

/** Build an empty board (all null) of files × ranks. */
export function emptyBoard(files, ranks) {
  return Array.from({ length: ranks }, () => Array(files).fill(null));
}

/** List all squares matching a predicate(cell, file, rankFromBottom). */
export function findSquares(fen, pred) {
  const f = splitFen(fen);
  const board = parseBoard(f.board);
  const ranks = board.length;
  const out = [];
  for (let rt = 0; rt < ranks; rt++) {
    for (let file = 0; file < board[rt].length; file++) {
      const rb = ranks - 1 - rt;
      if (pred(board[rt][file], file, rb)) out.push({ file, rankFromBottom: rb, name: squareName(file, rb), cell: board[rt][file] });
    }
  }
  return out;
}

/** THE SLEDGEHAMMER (2026-09-17, engine/patches/hammer.patch): the square a
 *  move hammers — its destination when that was a breakable wall on the board
 *  before the move (every move onto a '*' IS a hammer) — else null. Read by
 *  the duel (the state's `hammer`), the hint painter and the analyzer's
 *  arrows (THE HAMMER GLYPH, 2026-09-18). */
const HAMMER_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))$/;
export function hammerOf(fenBefore, uci) {
  const m = String(uci ?? '').match(HAMMER_RE);
  if (!m) return null;
  try {
    return getSquare(fenBefore, m[2]) === WALL ? m[2] : null;
  } catch {
    return null;
  }
}

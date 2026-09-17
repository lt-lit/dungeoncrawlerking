// FEN utilities for largeboard Fairy-Stockfish positions.
//
// Handles: multi-digit empty runs (boards up to 12 files), terrain squares
// (`*` stone wall, `^` furniture), pockets `[...]`, and per-square editing.
// The board is represented as a 2D array indexed [rankFromTop][file] where
// rankFromTop 0 is the highest rank (first FEN rank). Cell values: piece
// char ('K', 'p', ...), '*' wall, '^' furniture, or null for empty.

// The two terrain glyphs (brief §4.6). '*' is stone. It means two different
// things that FSF cannot tell apart and the Director can: an authored WALL,
// which the gods may crack into '^', and a HOLE that a crumble wrote, which
// is permanent — never weakened, never reopened (that permanence is the
// termination guarantee, §4.5). Hole-ness lives in Director state, not here.
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

// THE PORTALS (2026-09-17, engine/patches/portals.patch): a cast is a DROP of
// the portal scroll, `O@e4` for either side (FSF prints the piece letter
// uppercase for both hands); a move whose target is a portal square is a
// portal move — plain `from``to` notation, the engine and the game both know
// the square is a portal. The pairs and the half-open portals ride the
// FEN's trailing field, `{c3-h8,d1-a9,e4w}`.
export const CAST_RE = /^([A-Za-z])@([a-l](?:10|[1-9]))$/;
export const isCast = (uci) => CAST_RE.test(uci);

/** Is this cell terrain (stone wall or furniture)? Safe on null/undefined. */
export const isTerrain = (c) => c === WALL || c === FURNITURE;

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
      } else if (ch === '*' || ch === '^') {
        cells.push(ch); // terrain: stone wall / furniture (§4.6)
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
 * The portal field of a FEN: `{c3-h8,d1-a9,e4w}` after the move counters —
 * linked pairs (`a-b`) and half-open portals (a square and the colour that
 * opened it, `e4w` / `f6b`). Returns the pairs, the halves by colour, a
 * square → twin map and the set of every square a portal or a half stands
 * on. A FEN without the field parses to the empty shape.
 */
export function parsePortalField(fen) {
  const out = { pairs: [], halves: { w: null, b: null }, twin: new Map(), squares: new Set() };
  const m = String(fen ?? '').match(/\{([^}]*)\}/);
  if (!m) return out;
  for (const entry of m[1].split(',')) {
    const e = entry.trim();
    if (!e) continue;
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

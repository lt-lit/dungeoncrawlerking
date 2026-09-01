// Static threat evaluation over a FEN grid — attack chains + a simplified
// static exchange evaluation (SEE).
//
// Why this exists: the Director's displacement filter (director.mjs) only
// ever checked KING safety — no check given, no side left in check, no
// zero-legal-move result. Ordinary piece safety was never considered, so a
// "symmetric" quake could step a rook onto a square the opponent already
// attacked and hand it over for free (observed: arena03, black rook a7->b7
// into a white rook already bearing down the open b-file). Symmetric meant
// symmetric in COUNT, not in CONSEQUENCE.
//
// This module is the stopgap half of the fix: landing safety. It answers
// "if this piece stands here, does the opponent win material by capturing?"
// The full rule — a quake may create no new winning capture for EITHER side,
// evaluated on the composite post-quake position — lands in Phase 1.3 and
// will build on these same primitives.
//
// Pure: no ffish, no engine, no FEN parsing. Callers pass the
// [rankFromBottom][file] cell grid that fenGrid() produces ('*' walls,
// '^' furniture, null empty, piece letters otherwise), so this costs a few
// array walks per candidate — far cheaper than the ffish Board probes the
// filter already runs per candidate. Terrain — furniture included — blocks
// rays and is never an attacker or victim here: to the gods' safety guard
// '^' is stone (§4.6 interim; whether SEE must price ^-captures is 1.3's
// question, decided with the whole-board rule).
//
// The discovered-attack gap is CLOSED as of 2026-09-01 (`editExposes`,
// below — the promoted "no new winning capture" rule, §10 old-1.3 scope):
// live play produced exactly the predicted failure — a breach opened a line
// and handed a queen to the side to move (designer report, ply ~30). A
// board edit only ever changes SEE relations for the FIRST piece outward
// along each of the 8 rays through an edited square, so the guard prices
// exactly those pieces on both boards and rejects any candidate that turns
// a standing SEE-safe piece into a SEE-losing one, either side.
//
// Known gaps (deliberate, still):
//  - pins and absolute-pin legality are ignored (a "defender" that is pinned
//    still counts), so the guard is occasionally over-permissive;
//  - rescuing an already-hanging piece is a gift too, and is not checked;
//  - compound geometry across a multi-action budget (two edits jointly
//    opening a line neither opens alone) is only caught where the edits
//    share a ray or a landed square (landingsStillSafe covers the rest of
//    the known composite cases — CLAUDE.md rule 13).

import { isTerrain } from './fen.mjs';

/** Centipawn values. Only relative order matters to the swap-off. */
export const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT_HOPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

// Only ever called on piece letters — terrain never enters a chain (below).
const isWhitePiece = (ch) => ch === ch.toUpperCase();
const valueOf = (ch) => PIECE_VALUE[ch.toLowerCase()] ?? 0;

/**
 * Does `ch`, sitting `dist` steps from the target along the ray (df, dr)
 * walked OUTWARD from the target, attack the target square?
 *
 * Note the direction convention: because the ray is walked outward, a WHITE
 * pawn that attacks the target sits one rank BELOW it, i.e. dr === -1.
 */
function raySees(ch, ortho, dr, dist) {
  const t = ch.toLowerCase();
  if (t === 'q') return true;
  if (ortho) {
    if (t === 'r') return true;
  } else if (t === 'b') {
    return true;
  }
  if (dist !== 1) return false;
  if (t === 'k') return true;
  if (t === 'p' && !ortho) return isWhitePiece(ch) ? dr === -1 : dr === 1;
  return false;
}

/**
 * Ordered occupant chains radiating from the target, one per ray direction.
 * The chain head is the only piece that can attack right now; pieces behind
 * it become attackers as heads are consumed (x-ray). A head that does NOT
 * attack blocks its ray permanently — it is not on the contested square, so
 * nothing in the swap-off removes it.
 *
 * Terrain terminates a ray exactly like a piece would: FSF blocks sliders
 * on pit squares (brief §4.5), and furniture blocks them until captured
 * (§4.6) — the gods' guard treats it as stone, so it never enters a chain
 * (before this was explicit, '^' entered as an inert piece and blocked by
 * ACCIDENT — raySees matched no type for it; do not rely on that again).
 */
function buildChains(grid, tf, tr, files, ranks) {
  const chains = [];
  for (const [dirs, ortho] of [[ORTHO, true], [DIAG, false]]) {
    for (const [df, dr] of dirs) {
      const cells = [];
      let f = tf + df;
      let r = tr + dr;
      let dist = 1;
      while (f >= 0 && f < files && r >= 0 && r < ranks) {
        const ch = grid[r][f];
        if (isTerrain(ch)) break;
        if (ch) cells.push({ ch, dist });
        f += df;
        r += dr;
        dist++;
      }
      if (cells.length) chains.push({ ortho, dr, cells, idx: 0 });
    }
  }
  return chains;
}

/** Knight attackers of the target. Leapers ignore walls in between (§4.5). */
function knightAttackers(grid, tf, tr, files, ranks) {
  const out = [];
  for (const [df, dr] of KNIGHT_HOPS) {
    const f = tf + df;
    const r = tr + dr;
    if (f < 0 || f >= files || r < 0 || r >= ranks) continue;
    const ch = grid[r][f];
    if (ch && !isTerrain(ch) && ch.toLowerCase() === 'n') out.push({ ch, used: false });
  }
  return out;
}

/** Cheapest piece of `white` currently able to capture on the target. */
function leastValuableAttacker(state, white) {
  let best = null;
  for (const chain of state.chains) {
    const head = chain.cells[chain.idx];
    if (!head || isWhitePiece(head.ch) !== white) continue;
    if (!raySees(head.ch, chain.ortho, chain.dr, head.dist)) continue;
    const value = valueOf(head.ch);
    if (!best || value < best.value) best = { value, chain };
  }
  for (const knight of state.knights) {
    if (knight.used || isWhitePiece(knight.ch) !== white) continue;
    if (!best || PIECE_VALUE.n < best.value) best = { value: PIECE_VALUE.n, knight };
  }
  return best;
}

/**
 * Recursive swap-off (the classic CPW formulation): what `white` nets by
 * initiating captures on a square holding `occupantValue`. Each side may
 * decline, hence max(0, …) — which is also what keeps a suicidal king
 * capture out of the line: it scores hugely negative and is pruned.
 */
function swapOff(state, white, occupantValue) {
  const attacker = leastValuableAttacker(state, white);
  if (!attacker) return 0;
  if (attacker.chain) attacker.chain.idx++;
  else attacker.knight.used = true;
  const net = Math.max(0, occupantValue - swapOff(state, !white, attacker.value));
  if (attacker.chain) attacker.chain.idx--;
  else attacker.knight.used = false;
  return net;
}

/**
 * Centipawns the opponent of (tf, tr)'s occupant wins by capturing there.
 * 0 means the square is safe for it — nothing to win, or only an even trade.
 * Returns 0 for empty squares and terrain (furniture is nobody's material).
 */
export function captureLoss(grid, tf, tr, files, ranks) {
  const occ = grid[tr]?.[tf];
  if (!occ || isTerrain(occ)) return 0;
  const state = {
    chains: buildChains(grid, tf, tr, files, ranks),
    knights: knightAttackers(grid, tf, tr, files, ranks),
  };
  return swapOff(state, !isWhitePiece(occ), valueOf(occ));
}

/**
 * The Director's landing-safety threshold, in centipawns. A displacement is
 * rejected when the moved piece would lose MORE than this where it lands.
 *
 * 0 means "no free material at all" — even trades (captureLoss === 0) still
 * pass, on the grounds that the gods forcing a trade is a far smaller sin
 * than the gods handing over a rook. Phase 1.3 owns retuning this.
 */
export const SAFE_LANDING_LOSS = 0;

/** Is `grid` safe for the piece standing on (tf, tr)? */
export function landingIsSafe(grid, tf, tr, files, ranks) {
  return captureLoss(grid, tf, tr, files, ranks) <= SAFE_LANDING_LOSS;
}

const RAYS8 = [...ORTHO, ...DIAG];

/**
 * The "no new winning capture" guard (the promoted §10 old-1.3 rule — see
 * the header). `edits` is the list of {f, r} squares the candidate changes
 * (a terrain edit has one; a displacement has two). Walks the 8 rays from
 * every edited square in BOTH grids (a ray can reach farther in one than
 * the other), collects the first piece in each direction, and reports the
 * first STANDING piece — same letter, same square in both grids, so the
 * moved piece itself stays landing safety's job — that was SEE-safe before
 * and is SEE-losing after. Either side's piece counts: the gods hand out
 * no free material, whoever's it is. Returns {f, r, ch, loss} or null.
 *
 * Pure grid arithmetic (rule 14: this runs BEFORE any ffish probe). A ray
 * walk stops at the first non-empty cell; terrain blocks and is never a
 * victim.
 */
export function editExposes(preGrid, postGrid, edits, files, ranks) {
  const seen = new Set();
  for (const grid of [preGrid, postGrid]) {
    for (const { f, r } of edits) {
      for (const [df, dr] of RAYS8) {
        let nf = f + df;
        let nr = r + dr;
        while (nf >= 0 && nf < files && nr >= 0 && nr < ranks) {
          const cell = grid[nr][nf];
          if (cell) {
            if (!isTerrain(cell)) seen.add(nf + nr * 32);
            break;
          }
          nf += df;
          nr += dr;
        }
      }
    }
  }
  for (const key of seen) {
    const f = key % 32;
    const r = (key - f) / 32;
    const ch = postGrid[r][f];
    if (!ch || isTerrain(ch) || preGrid[r][f] !== ch) continue;
    if (captureLoss(preGrid, f, r, files, ranks) > SAFE_LANDING_LOSS) continue; // hanging already — not new
    const loss = captureLoss(postGrid, f, r, files, ranks);
    if (loss > SAFE_LANDING_LOSS) return { f, r, ch, loss };
  }
  return null;
}

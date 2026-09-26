// Duel-variant generation: variants.ini snippet + startFen builders.
// Browser port of phase0/lib/variant.mjs with two additions: a known-key
// allowlist (unknown variants.ini keys are silently ignored by BOTH libraries
// — spike 6 — so a typo produces legal-looking wrong rules) and the fixed
// 60-variant catalog (variant names are single-use — spike 1 — so the game
// loads every duel_<files>x<ranks> once at boot and never redefines).
import { emptyBoard, serializeBoard, isTerrain } from './fen.mjs';

// Keys the duel baseline is allowed to emit. Extend deliberately, never ad hoc.
const KNOWN_INI_KEYS = new Set([
  'maxRank',
  'maxFile',
  'castling',
  'stalemateValue',
  'nMoveRule',
  'nFoldRule',
  'nFoldValue',
  'extinctionValue',
  'extinctionPieceTypes',
  'extinctionPieceCount',
  'extinctionPseudoRoyal',
  'promotionRegionWhite',
  'promotionRegionBlack',
  'promotionPieceTypes',
  'doubleStepRegionWhite',
  'doubleStepRegionBlack',
  'pieceDrops',
  'capturesToHand',
  'dropRegionWhite',
  'dropRegionBlack',
  // THE PORTAL SPELL (2026-09-17, engine/patches/portals.patch)
  'immobile',
  'portalScroll',
  'pieceValueMg',
  'pieceValueEg',
  // THE SLEDGEHAMMER (2026-09-17, engine/patches/hammer.patch)
  'hammerPieceTypes',
  'hammerPieceTypesWhite',
  'hammerPieceTypesBlack',
  // THE ICE (2026-09-20, engine/patches/ice.patch): the ice scroll is FSF's
  // first custom piece with an empty Betza (immobile), its cast rows the
  // custom piece's mobility region.
  'customPiece1',
  'iceScroll',
  'mobilityRegionWhiteCustomPiece1',
  'mobilityRegionBlackCustomPiece1',
  // THE DECK IN THE ENGINE (2026-09-26, engine/patches/deck.patch): the hand
  // size, the slot letters, and `card<ID> = portal|ice|win|meta` per card ID
  // (checked by pattern below — the IDs are the catalog's, deck.mjs).
  'handSize',
  'cardSlots',
]);
const DECK_CARD_KEY = /^card\d+$/;

// THE PORTAL SPELL (2026-09-17): the scroll is a piece type that only ever
// lives in hand (FSF's own `immobile` piece, letter `o`), two per side per
// duel — one pair, cast in two turns. The engine's `portalScroll` key names
// it; a drop of it opens a half (`O@e4`) or, when the caster holds an open
// half, links that half to the square. The drop region keeps every cast
// PORTAL_ROW_MARGIN rows off each king row (the promotion zones): never ON
// a king row, so no pawn ever promotes through a portal and the engine
// needs no promotion branch for the move (the engine's own floor — its
// parse drops a field entry on a king row), and since 2026-09-20 never on
// the row BESIDE one either (designer: "portals must be placed two spaces
// away from promotion zones instead of one") — an ini rule, no engine
// change. The name suffix carries the margin, so a deal variant's name
// encodes its region (rule 7; the one-row deals were `__portals`, and the
// committed portal samples still carry them).
// The scroll's value is 0 — and since THE DECK IN THE ENGINE (2026-09-26)
// a scroll or a card in hand weighs NOTHING to the eval at all: FSF's flat
// in-hand piece-square bonus (35–70 cp a piece, the "small in-hand bonus"
// this comment used to count on) is zero for every spell type, so the enemy
// casts when the position after the cast is better and for no other reason.
export const PORTAL_SCROLL = 'o';
export const PORTAL_SCROLLS_PER_SIDE = 2;
export const PORTAL_SCROLL_VALUE = 0;
export const PORTAL_ROW_MARGIN = 2;
export const PORTAL_VARIANT_SUFFIX = `__portals${PORTAL_ROW_MARGIN}`;

// THE SLEDGEHAMMER (2026-09-17, engine/patches/hammer.patch + wall-kinds.patch;
// brief §4.8): a piece of a hammer type may spend its move turning an
// ADJACENT breakable wall ('*') into a crate ('^') — the engine's HAMMER move,
// plain `e1d1` notation (every move onto a breakable wall IS a hammer), SAN
// `K*d1`; never in check, never a check; '#' walls never yield. The engine's
// `hammerPieceTypes` key names the types per colour, and for the stress
// test EVERY KING IS A SLEDGE-KING (designer 2026-09-17). An upgrade later:
// per colour is a deal-variant setting, so "this king hammers, that one
// does not" costs no new piece letter.
export const HAMMER_PIECES = 'k';
export const HAMMER_VARIANT_SUFFIX = '__sledge';

/** The variants.ini keys that arm the kings. */
export function hammerIniKeys() {
  return { hammerPieceTypes: HAMMER_PIECES };
}

// THE ICE (2026-09-20, engine/patches/ice.patch; brief §4.9): the ice scroll
// is a piece type that only lives in hand (FSF's `customPiece1` with an empty
// Betza string — immobile — letter `i`), ONE per side per duel for the stress
// test; a drop of it (`I@e5`, one ply, never in check, on any floor square of
// the cast rows, occupied or not) turns the floor of the 3×3 around the
// square slippery for the rest of the duel. THE CAST ROWS are the board's
// two MIDDLE ranks (`iceIniKeys`: the custom piece's mobility region, which
// the engine intersects with the drop region), so a patch never comes nearer
// than two rows to a king row on the 10-rank box (ranks 5–6 → rows 4–7;
// 4–5 → 3–6 on the selftest's 8) — the portal's two-row promotion margin,
// kept for the ice. The scroll's value is 0 like the portal scroll's (FSF's
// in-hand bonus is ZERO for a spell since 2026-09-26 — no nudge at all). The name suffix `__ice` makes an
// ice deal its own variant (rule 7).
export const ICE_SCROLL = 'i';
export const ICE_SCROLLS_PER_SIDE = 1;
export const ICE_SCROLL_VALUE = 0;
export const ICE_VARIANT_SUFFIX = '__ice';

/** The two middle ranks of a `ranks`-deep board, 1-based: the ice cast's rows. */
export function iceCastRanks(ranks) {
  const lo = Math.floor(ranks / 2);
  return ranks >= 2 ? [lo, lo + 1] : [1];
}

/**
 * The variants.ini keys that turn the ice spell on for a `ranks`-deep board.
 * The piece VALUE keys are shared with the portal scroll's (one `pieceValueMg`
 * line names every scroll), so a deal composes them through `spellIniKeys`.
 */
export function iceIniKeys(ranks) {
  const rows = iceCastRanks(ranks).map((r) => `*${r}`).join(' ');
  return {
    customPiece1: `${ICE_SCROLL}:`,
    iceScroll: ICE_SCROLL,
    pieceDrops: 'true',
    mobilityRegionWhiteCustomPiece1: rows,
    mobilityRegionBlackCustomPiece1: rows,
  };
}

/** The keys of every spell a deal carries — the portal's, the ice's, and ONE
 *  value line for all the scrolls (a second `pieceValueMg` would overwrite
 *  the first in the ini object). */
export function spellIniKeys(ranks, { portals = false, ice = false } = {}) {
  const out = { ...(portals ? portalIniKeys(ranks) : {}), ...(ice ? iceIniKeys(ranks) : {}) };
  const values = [...(portals ? [`${PORTAL_SCROLL}:${PORTAL_SCROLL_VALUE}`] : []), ...(ice ? [`${ICE_SCROLL}:${ICE_SCROLL_VALUE}`] : [])];
  if (values.length) {
    out.pieceValueMg = values.join(' ');
    out.pieceValueEg = values.join(' ');
  }
  return out;
}

/** The holdings block of a duel with these spells: the ice scroll, then the
 *  portal scrolls, White's uppercase then Black's (`[IOOioo]`); '' with none. */
export function spellPocket({ portals = false, ice = false } = {}) {
  const white = (ice ? ICE_SCROLL.toUpperCase().repeat(ICE_SCROLLS_PER_SIDE) : '') + (portals ? PORTAL_SCROLL.toUpperCase().repeat(PORTAL_SCROLLS_PER_SIDE) : '');
  const black = (ice ? ICE_SCROLL.repeat(ICE_SCROLLS_PER_SIDE) : '') + (portals ? PORTAL_SCROLL.repeat(PORTAL_SCROLLS_PER_SIDE) : '');
  return white + black;
}

/**
 * The variants.ini keys that turn the portal spell on for a `ranks`-deep
 * board: a cast lands on ranks 1 + PORTAL_ROW_MARGIN … ranks − PORTAL_ROW_MARGIN
 * (3…8 on a 10-rank arena), the same region for both colours.
 */
export function portalIniKeys(ranks) {
  const first = 1 + PORTAL_ROW_MARGIN;
  const last = ranks - PORTAL_ROW_MARGIN;
  const middle = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => `*${first + i}`).join(' ');
  return {
    immobile: PORTAL_SCROLL,
    portalScroll: PORTAL_SCROLL,
    pieceDrops: 'true',
    dropRegionWhite: middle,
    dropRegionBlack: middle,
    pieceValueMg: `${PORTAL_SCROLL}:${PORTAL_SCROLL_VALUE}`,
    pieceValueEg: `${PORTAL_SCROLL}:${PORTAL_SCROLL_VALUE}`,
  };
}

/** The holdings block for a duel where both sides carry their scrolls. */
export function portalPocket(n = PORTAL_SCROLLS_PER_SIDE) {
  return PORTAL_SCROLL.toUpperCase().repeat(n) + PORTAL_SCROLL.repeat(n);
}

/**
 * Emit a variants.ini snippet for a duel arena.
 * Baseline rules follow brief §4.4: no draws, dual loss condition,
 * promotion on enemy back rank, no castling (generated positions).
 * Any key in `extra` overrides/extends the baseline (allowlisted).
 */
export function makeDuelVariantIni({ name = 'duel', files = 8, ranks = 8, extra = {} } = {}) {
  if (files < 1 || files > 12 || ranks < 1 || ranks > 10) {
    throw new Error(`board ${files}x${ranks} outside FSF largeboard caps (12 files x 10 ranks)`);
  }
  const opts = {
    maxRank: String(ranks),
    maxFile: String(files),
    castling: 'false',
    // No draws, ever (§4.4). nFoldRule=0 kills repetition adjudication;
    // nFoldValue=loss additionally disables the engine's PRIVATE in-search
    // repetition draw-scoring (spike 10: without it, a losing engine holds
    // its eval at 0.00 by shuffling — "Plan A-prime" config).
    stalemateValue: 'loss',
    nMoveRule: '0',
    nFoldRule: '0',
    nFoldValue: 'loss',
    // Loss conditions beyond checkmate (§4.4): bare-army IN-GRAMMAR — a side
    // down to 1 total piece (its king) loses, and the engine plays for it
    // (strip-wins score mate-1; hints/eval bar are truthful automatically).
    // pseudoRoyal=false is required for the count rule to fire; the king
    // stays royal (spike 4 finding 5), so check semantics are untouched.
    // Kingless states (surgery-only) are adjudicated in duel.mjs.
    extinctionValue: 'loss',
    extinctionPieceTypes: '*',
    extinctionPieceCount: '1',
    extinctionPseudoRoyal: 'false',
    // Promotion region = enemy back rank (§4.4, spike 5)
    promotionRegionWhite: `*${ranks}`,
    promotionRegionBlack: '*1',
    // UNIVERSAL pawn double-step (slice refresh; spike 13): armies mold to
    // terrain, so pawns start on arbitrary ranks — the region covers every
    // pawn-legal rank so the push is never an accident of deployment depth.
    // FSF region semantics are every-visit (no first-move tracking): any
    // pawn in the region always has the double-step. Walls block both the
    // jumped and landing squares; en passant works against any of them.
    doubleStepRegionWhite: Array.from({ length: Math.max(0, ranks - 2) }, (_, i) => `*${i + 2}`).join(' '),
    doubleStepRegionBlack: Array.from({ length: Math.max(0, ranks - 2) }, (_, i) => `*${ranks - 1 - i}`).join(' '),
    ...extra,
  };
  for (const k of Object.keys(opts)) {
    if (!KNOWN_INI_KEYS.has(k) && !DECK_CARD_KEY.test(k)) {
      throw new Error(`unknown variants.ini key "${k}" — unknown keys are silently ignored by FSF/ffish (spike 6); add it to KNOWN_INI_KEYS deliberately if it is real`);
    }
  }
  const lines = [`[${name}:chess]`];
  for (const [k, v] of Object.entries(opts)) {
    if (v === null || v === undefined) continue;
    lines.push(`${k} = ${v}`);
  }
  return lines.join('\n') + '\n';
}

/** Catalog variant name for a board size. */
export function catalogVariantName(files, ranks) {
  return `duel_${files}x${ranks}`;
}

// THE DECK IN THE ENGINE (2026-09-26; engine/patches/deck.patch + deck-search.patch;
// brief §4.10 "Phase 3.3" — the designer: "I need an engine that actually sees the
// deck and understands that both players will draw more cards"): a deal with
// decks declares them to the engine — the HAND SIZE, the SLOT letters the hands
// live in (custom immobile pieces s..z, bound per colour to card IDs by the FEN's
// trailing field) and, per card ID either deck holds, the card's ENGINE KIND:
// `portal` (a pair cast in one turn, the card spent on the link), `ice` (the
// 3×3 patch), `win` (the test-only You Win card: cast on your own king, the
// game over — the horizon instrument), `meta` (a blank to the engine: Reveal
// and Undo, the player's alone). The engine then draws for the side about to
// move inside every move that hands it the turn, offers the mulligan `@@@@`,
// and searches through both piles. THE NAME CARRIES THE WHOLE DECLARATION
// (rule 7): `__deck4_1i_2p_101m_102m` — the hand size, then each ID with its
// kind's initial — so two deals that declare different cards are different
// variants and a same-named re-registration is always an identical no-op.
// No card is valued by a number (designer, standing): the slots are worth 0
// to the engine (its custom pieces with an empty Betza have no material
// value and the eval never counts a scroll), so the engine casts a card when
// the cast is the best move and for no other reason.
export const DECK_SLOT_LETTERS = 'stuvwxyz';
export const DECK_HAND_SIZE = 4;
export const DECK_VARIANT_SUFFIX = '__deck';
/** The engine's card kinds a deal may declare, and the initial each wears in the variant name. */
export const DECK_ENGINE_KINDS = { portal: 'p', ice: 'i', win: 'w', meta: 'm' };

/** The variants.ini keys that declare a deck: `deck` = { handSize, cards: { <id>: <engine kind> } }. */
export function deckIniKeys({ handSize = DECK_HAND_SIZE, cards = {} } = {}) {
  const out = { handSize: String(handSize | 0), cardSlots: DECK_SLOT_LETTERS, pieceDrops: 'true' };
  for (const id of Object.keys(cards).map(Number).sort((a, b) => a - b)) {
    if (!DECK_ENGINE_KINDS[cards[id]]) throw new Error(`card ${id}: unknown engine kind "${cards[id]}"`);
    out[`card${id}`] = cards[id];
  }
  return out;
}

/** The name suffix that encodes a deck declaration (rule 7): the hand size, then every ID with its kind's initial. */
export function deckVariantSuffix({ handSize = DECK_HAND_SIZE, cards = {} } = {}) {
  const ids = Object.keys(cards).map(Number).sort((a, b) => a - b);
  return `${DECK_VARIANT_SUFFIX}${handSize | 0}${ids.map((id) => `_${id}${DECK_ENGINE_KINDS[cards[id]]}`).join('')}`;
}

/**
 * Per-deal duel variant: the catalog baseline with the pawn double-step
 * region set to each side's CAMP — every rank from its home edge up to
 * its camp line: the rank holding the MOST of that side's dealt pawns,
 * ties toward the enemy (spike 14; designer rule 2026-08-21, final
 * form). The line sits where the position LOOKS like the starting line
 * — the pawn wall — so it reads at a glance, chess's own row-based rule
 * generalized (row = first-move-only in chess only because nothing
 * there moves pawns backward; quakes CAN, and where the readings
 * diverge the row wins). At or behind the line, a pawn can leap; past
 * it, never again. Designer-signed consequences: a pawn dealt AHEAD of
 * the line (molding bumped it past the wall) is already advanced and
 * never leaps; a moved pawn knocked back behind the line regains the
 * jump; rear pawns behind the line can single-step then double once
 * lanes open (a tied stack puts the line at its front wall, so the
 * whole mass has access); all-scattered terrain ties resolve toward
 * the enemy, keeping nearly every pawn leap-capable.
 *
 * The name ENCODES the config, so re-registering a colliding name is
 * always an identical no-op, never a silent rules change (rule 7 bans
 * redefinition; spike 14 verified incremental ADDITION in both
 * libraries). Registration is the caller's job: ffish via
 * `loadVariantConfig(ini)` (dealMatchup does it), the engine via a
 * cumulative variants-ini reload (main.mjs appends to app.catalog).
 */
export function dealVariant(files, ranks, whiteLineRank, blackLineRank, { portals = false, hammer = false, ice = false, deck = null } = {}) {
  const w = whiteLineRank | 0;
  const b = blackLineRank | 0;
  if (w < 1 || w > ranks || b < 1 || b > ranks) {
    throw new Error(`camp lines w${w}/b${b} outside 1-${ranks}`);
  }
  // The name encodes the config (rule 7): a portal deal, a sledge deal, an ice deal, is its own variant.
  const name = `${catalogVariantName(files, ranks)}__w${w}__b${b}${portals ? PORTAL_VARIANT_SUFFIX : ''}${hammer ? HAMMER_VARIANT_SUFFIX : ''}${ice ? ICE_VARIANT_SUFFIX : ''}${deck ? deckVariantSuffix(deck) : ''}`;
  const ini = makeDuelVariantIni({
    name,
    files,
    ranks,
    extra: {
      doubleStepRegionWhite: Array.from({ length: w }, (_, i) => `*${i + 1}`).join(' '),
      doubleStepRegionBlack: Array.from({ length: ranks - b + 1 }, (_, i) => `*${b + i}`).join(' '),
      ...spellIniKeys(ranks, { portals, ice }),
      ...(hammer ? hammerIniKeys() : {}),
      ...(deck ? deckIniKeys(deck) : {}), // THE DECK IN THE ENGINE: the hand size, the slots, every card ID's kind
    },
  });
  return { name, ini, portals: !!portals, hammer: !!hammer, ice: !!ice, deck: deck ? { handSize: deck.handSize ?? DECK_HAND_SIZE, cards: { ...deck.cards } } : null };
}

/**
 * The fixed 60-variant catalog: duel_<files>x<ranks> for files 3–12 × ranks
 * 5–10 (spikes 1/3/8; ranks-5 added by the slice refresh for the 3×5
 * minimum stage). Loaded ONCE at boot into both ffish and the engine;
 * every duel thereafter varies only via FEN.
 */
export function makeCatalogIni() {
  const blocks = [];
  for (let files = 3; files <= 12; files++) {
    for (let ranks = 5; ranks <= 10; ranks++) {
      blocks.push(makeDuelVariantIni({ name: catalogVariantName(files, ranks), files, ranks }));
    }
  }
  return blocks.join('\n');
}

/**
 * Build a duel start position as a 2D board array.
 *
 * spec = {
 *   files, ranks,
 *   walls: ['c3', ...],                      // wall squares from terrain
 *   white: { backRank: ['R','N','K',...], backRankStart: 0, row: 0,  // row = rank from bottom
 *            pawnFiles: [0, 2] },            // optional: explicit pawn files
 *   black: { backRank: [...], backRankStart: 0, row: ranks-1 },
 * }
 * Pawn rows are stamped in front of each back row (§4.2). Default: automatic,
 * spanning the patch width; a walled back-row slot then suppresses BOTH the
 * piece and that file's pawn (walls eat slots — the semantics every Phase 0
 * sweep shipped with). With explicit `pawnFiles` (0-based file indices) only
 * those files get pawns, decoupled from back-row wall clipping — the arena
 * author owns the pawn count. Walled pawn squares stay empty either way.
 */
export function buildDuelBoard(spec) {
  const { files, ranks } = spec;
  const board = emptyBoard(files, ranks);
  const put = (file, rankFromBottom, piece) => {
    board[ranks - 1 - rankFromBottom][file] = piece;
  };
  for (const w of spec.walls ?? []) {
    const file = w.charCodeAt(0) - 97;
    const rank = parseInt(w.slice(1), 10) - 1;
    put(file, rank, '*');
  }
  const stamp = (side, isWhite) => {
    if (!side) return;
    const row = side.row ?? (isWhite ? 0 : ranks - 1);
    const pawnRow = isWhite ? row + 1 : row - 1;
    const start = side.backRankStart ?? 0;
    const pawnAt = (file) => {
      if (file < 0 || file >= files) return;
      if (!isTerrain(board[ranks - 1 - pawnRow][file])) {
        put(file, pawnRow, isWhite ? 'P' : 'p');
      }
    };
    side.backRank.forEach((piece, i) => {
      const file = start + i;
      if (file >= files) return; // clipped by board edge
      if (isTerrain(board[ranks - 1 - row][file])) return; // terrain eats slots (§4.2/§4.6)
      if (piece) put(file, row, isWhite ? piece.toUpperCase() : piece.toLowerCase());
      if (!side.pawnFiles) pawnAt(file); // automatic full-width row (§4.2 default)
    });
    if (side.pawnFiles) for (const f of side.pawnFiles) pawnAt(f);
  };
  stamp(spec.white, true);
  stamp(spec.black, false);
  return board;
}

/** Serialize a duel board + turn into a full startFen. */
export function boardToFen(board, { turn = 'w', pocket = null } = {}) {
  const boardField = serializeBoard(board);
  const pocketField = pocket !== null ? `[${pocket}]` : '';
  return `${boardField}${pocketField} ${turn} - - 0 1`;
}

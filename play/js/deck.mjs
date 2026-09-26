// THE DECK (2026-09-25, designer: "Could we have spells as cards drawn from a
// deck? … both decks and hands fully visible to both players"; the rulings
// the same session — a hand of FOUR, drawn up to at the start of each turn,
// two decks, a shuffle and a fresh hand at the start of every duel, a cast is
// the caster's move, no card is ever valued by a number: the engine casts a
// card when the cast is the best move and for no other reason).
//
// THE DECK IN THE ENGINE (2026-09-26, Phase 3.3a; engine/patches/deck.patch;
// brief §4.10 "Phase 3.3" — the designer: "I need an engine that actually
// sees the deck and understands that both players will draw more cards. An
// engine that plays at a super human level is of upmost importance"): THE
// FEN IS THE DECK. A side's hand is card SLOTS in the holdings (custom
// immobile pieces s..z, one letter per copy — identical cards share a slot),
// each slot bound to a card ID by the FEN's trailing field (`S=w1`), its pile
// the same field's `w|2.1.101` (top first). The ENGINE draws for the side
// about to move inside every move that hands it the turn (never the frozen
// side of an open half, never on the link ply), offers the MULLIGAN as the
// move `@@@@` (SAN `redraw`: the hand discarded, a fresh one drawn, the turn
// spent) and searches through both piles — so the win card ten mulligans
// deep is a mate in eleven to it. A CARD is a kind out of the catalog below,
// with the ID the engine knows it by and the engine KIND that says what its
// cast does (portal, ice, the test-only win, or meta — a blank the engine
// never casts: Reveal and Undo are the player's alone, played outside the
// move grammar by rewriting the hand). This module is pure: the catalog, the
// starter decks, the seeded shuffle, the OPENING DEAL (both hands drawn into
// the start FEN by the engine's own binding rule), and every reader off a
// FEN — the hand, the pile, what a cast casts, what a ply drew. The old
// stress-test set (`?deck=off`: every spell as scrolls in the pocket, no
// deck) still reads through the legacy readers at the bottom.
import { ICE_SCROLL, ICE_SCROLLS_PER_SIDE, PORTAL_SCROLL, PORTAL_SCROLLS_PER_SIDE, DECK_HAND_SIZE, DECK_SLOT_LETTERS } from './variant.mjs';
import { mulberry32, childSeed, shuffle, pick } from './prng.mjs';
import { splitFen, parseDeckField, withDeck, castLetter, isCast, MULLIGAN } from './fen.mjs';

/** The hand's size — drawn up to at the start of each of a side's turns (designer 2026-09-25: "a hand size of four"). */
export const HAND_SIZE = DECK_HAND_SIZE;
export { MULLIGAN };

/** THE CATALOG: every card kind this build knows. `id` is the card's number
 *  to the engine (the FEN's bindings and piles carry it; a deal declares
 *  `card<id> = <engine>` for every ID its decks hold), `engine` what its cast
 *  does to the engine ('portal', 'ice', 'win', 'meta'), `cls` 'spell' (a
 *  move) or 'meta' (free, the player's alone), `test` a card that exists for
 *  the instruments and never in a starter. THE CARD UI (Phase 3.2) reads
 *  `cost`, `short` and `text`; the legacy readers `letter` / `scrolls`. */
export const CARDS = {
  ice: { kind: 'ice', id: 1, engine: 'ice', name: 'Ice', glyph: '❄', letter: ICE_SCROLL, scrolls: ICE_SCROLLS_PER_SIDE, cls: 'spell', cost: 'move', short: '3×3 ice, middle rows', text: 'a 3×3 patch of ice on the middle rows; a piece that moves onto it slides on until something stops it' },
  portal: { kind: 'portal', id: 2, engine: 'portal', name: 'Portal', glyph: '◎', letter: PORTAL_SCROLL, scrolls: PORTAL_SCROLLS_PER_SIDE, cls: 'spell', cost: 'move', short: 'a linked pair, one turn', text: 'a pair of portals, cast in one turn; a piece that moves onto one comes out of the other' },
  reveal: { kind: 'reveal', id: 101, engine: 'meta', name: 'Reveal', glyph: '☉', cls: 'meta', cost: 'free', short: "the oracle's three lines", text: "the engine's best lines for this turn; costs no move" },
  undo: { kind: 'undo', id: 102, engine: 'meta', name: 'Undo', glyph: '↺', cls: 'meta', cost: 'free', short: 'take back your last turn', text: "take back your last move and the enemy's reply; costs no move" },
  // THE YOU WIN CARD (designer 2026-09-25: "if you play it you win. Each player gets one copy, and it's always at the
  // bottom of the deck") — the engine's horizon instrument: cast on your own king, the game is over. Test only.
  win: { kind: 'win', id: 200, engine: 'win', name: 'You Win', glyph: '★', cls: 'spell', cost: 'move', short: 'play it: you win', text: 'play it and you win — a test card, one copy at the bottom of each deck, so the engine can be watched digging for it', test: true },
};
export const CARD_KINDS = Object.keys(CARDS);
export const SPELL_KINDS = CARD_KINDS.filter((k) => CARDS[k].cls === 'spell' && !CARDS[k].test);
export const META_KINDS = CARD_KINDS.filter((k) => CARDS[k].cls === 'meta');
export const isCardKind = (k) => Object.prototype.hasOwnProperty.call(CARDS, k);
const BY_ID = new Map(CARD_KINDS.map((k) => [CARDS[k].id, k]));
/** The card kind of an engine ID, or `card<id>` for one the catalog does not know (an old log, a foreign deck). */
export const kindOfId = (id) => BY_ID.get(id | 0) ?? `card${id}`;
export const idOfKind = (k) => CARDS[k]?.id ?? null;

/** THE STARTER DECKS — one for now, from the spells that exist; more once the
 *  library has axes (the designer: "a few starter decks the player could
 *  choose from"). Every deck carries one Reveal and one Undo. */
export const STARTER_DECKS = {
  adept: { name: 'Adept', cards: ['portal', 'portal', 'portal', 'ice', 'ice', 'ice', 'reveal', 'undo'] },
};
export const DEFAULT_STARTER = 'adept';

/** The cards of a starter deck by name, or null. */
export function starterCards(name) {
  const d = STARTER_DECKS[name];
  return d ? d.cards.slice() : null;
}

/** THE ENEMY'S DECK by its army's width (brief §8: the level telegraph; the
 *  designer: "deck strength would roughly scale with army size"): width − 1
 *  spell cards drawn by the seed — two at width 3, three at 4. Spells only. */
export function enemyDeck(width, seed) {
  const n = Math.max(0, (width | 0) - 1);
  const rng = mulberry32(childSeed(seed >>> 0, 'enemy-deck'));
  return Array.from({ length: n }, () => pick(rng, SPELL_KINDS));
}

/** The enemy's version of any card list: the spell cards alone (an engine reveals nothing to itself and never undoes). */
export const enemyCards = (cards) => (cards ?? []).filter((k) => isCardKind(k) && CARDS[k].cls === 'spell');

/** A fresh deck for the deal: the cards shuffled by ONE seeded draw, as { pile } (top first). `fixed` keeps the list's
 *  own order (a hand-built `?deck=` list: the smokes, and a URL that forces an opening hand). */
export function newDeckState(cards, seed, { fixed = false } = {}) {
  const clean = (cards ?? []).filter(isCardKind);
  return { pile: fixed ? clean : shuffle(mulberry32(seed >>> 0), clean) };
}

/** The two decks' seeds off a deal's seed (a replay of the deal is a replay of the shuffle). */
export const deckSeeds = (dealSeed) => ({ w: childSeed(dealSeed >>> 0, 'deck:w'), b: childSeed(dealSeed >>> 0, 'deck:b') });

export const cloneDeckState = (d) => (d ? { pile: [...d.pile] } : null);
export const cloneDecks = (decks) => (decks ? { w: cloneDeckState(decks.w), b: cloneDeckState(decks.b) } : null);

/** What a deal DECLARES to the engine for these two decks: the hand size and every card ID's engine kind (variant.mjs deckIniKeys). */
export function deckDeclaration(decks, handSize = HAND_SIZE) {
  const cards = {};
  for (const side of ['w', 'b']) for (const k of decks?.[side]?.pile ?? []) if (CARDS[k]) cards[CARDS[k].id] = CARDS[k].engine;
  return { handSize, cards };
}

// ---------------------------------------------------------------- the engine's binding rule

const SLOTS = DECK_SLOT_LETTERS;
const handCount = (slots) => Object.values(slots).reduce((n, s) => n + (s?.n ?? 0), 0);
/** The slot a drawn card takes — THE ENGINE'S RULE (deck.patch refill): a slot already holding this ID, else the
 *  lowest empty slot that is not the slot whose portal half stands open. Null when none is free. */
export function slotFor(slots, id) {
  for (const l of SLOTS) if ((slots[l]?.n ?? 0) > 0 && slots[l].id === id) return l;
  for (const l of SLOTS) if (!(slots[l]?.n > 0) && !slots[l]?.open) return l;
  return null;
}

/**
 * THE OPENING DEAL: both sides draw `handSize` cards off the top of their shuffled piles into the slots, by the
 * engine's own binding rule (the engine draws every later card itself). Returns the deck as fen.mjs withDeck writes
 * it — { piles (the rest, kinds turned into IDs), slots, winner: null } — for `dealDeckFen`.
 */
export function openingDeck(decks, handSize = HAND_SIZE) {
  const out = { piles: { w: [], b: [] }, slots: { w: {}, b: {} }, winner: null };
  for (const side of ['w', 'b']) {
    const pile = (decks?.[side]?.pile ?? []).filter(isCardKind).map((k) => CARDS[k].id);
    while (pile.length && handCount(out.slots[side]) < handSize) {
      const id = pile[0];
      const l = slotFor(out.slots[side], id);
      if (!l) break;
      pile.shift();
      out.slots[side][l] = { id, n: (out.slots[side][l]?.n ?? 0) + 1, open: false };
    }
    out.piles[side] = pile;
  }
  return out;
}

/** The start FEN of a deal with these decks: the opening hands in the holdings, the piles and bindings in the field. */
export const dealDeckFen = (fen, decks, handSize = HAND_SIZE) => withDeck(fen, openingDeck(decks, handSize));

// ------------------------------------------------------------------------- readers off a FEN

/** Does this FEN carry a deck (slots in the holdings, or piles / bindings in the field)? */
export const deckOn = (fen) => parseDeckField(fen).present;

const sideToMove = (fen) => (splitFen(fen).turn === 'b' ? 'b' : 'w');

/** A side's hand as card kinds, one entry per copy, in slot order — off the FEN's slots; the legacy pocket's spell
 *  cards (`?deck=off`) when the FEN carries no deck. */
export function handOf(fen, side) {
  const D = parseDeckField(fen);
  if (!D.present) return spellHand(fen, side);
  const out = [];
  for (const l of SLOTS) {
    const s = D.slots[side]?.[l];
    if (s) for (let i = 0; i < s.n; i++) out.push(kindOfId(s.id));
  }
  return out;
}

/** A side's pile as card kinds, top first (empty without a deck). */
export const pileOf = (fen, side) => parseDeckField(fen).piles[side].map(kindOfId);

/** The multiset difference a − b of two kind lists (order of `a` kept). */
export function minusCards(a, b) {
  const take = new Map();
  for (const k of b) take.set(k, (take.get(k) ?? 0) + 1);
  const out = [];
  for (const k of a) {
    if ((take.get(k) ?? 0) > 0) take.set(k, take.get(k) - 1);
    else out.push(k);
  }
  return out;
}

/** A side's SPENT cards: the deck as shuffled (`deck0`, { pile }) less what is still on the pile and in the hand. */
export function spentOf(fen, side, deck0) {
  if (!deck0?.pile) return [];
  return minusCards(minusCards(deck0.pile, pileOf(fen, side)), handOf(fen, side));
}

/** The slots (letters) of a side that hold a kind, the open one first (the link ply's own portal). */
export function slotsOfKind(fen, side, kind) {
  const D = parseDeckField(fen);
  const id = idOfKind(kind);
  const out = [];
  for (const l of SLOTS) {
    const s = D.slots[side]?.[l];
    if (s && s.n > 0 && s.id === id) (s.open ? out.unshift(l) : out.push(l));
  }
  return out;
}

/** The slot whose portal half stands open for a side, or null. */
export function openSlotOf(fen, side) {
  const D = parseDeckField(fen);
  for (const l of SLOTS) if (D.slots[side]?.[l]?.open) return l;
  return null;
}

/** Which card a cast casts on this FEN — 'ice', 'portal', 'win', … for a slot drop (by the caster's bindings; `side` the side to move unless given),
 *  'ice' / 'portal' for the legacy scrolls `I@` / `O@`, null for a move that is no cast (or a slot bound to nothing). */
export function cardOfCast(fen, uci, side = sideToMove(fen)) {
  const l = castLetter(uci);
  if (!l) return null;
  if (l === ICE_SCROLL) return 'ice';
  if (l === PORTAL_SCROLL) return 'portal';
  if (!SLOTS.includes(l)) return null;
  const s = parseDeckField(fen).slots[side]?.[l];
  return s && s.n > 0 ? kindOfId(s.id) : null;
}

/** The UCI that casts a kind on a square for the side to move: the slot's drop (`S@e4`, the open slot first on the
 *  link ply), or the legacy scroll's (`I@e4`, `O@e4`) when the FEN carries no deck. Null when the side holds none. */
export function castUci(fen, kind, sq, side = sideToMove(fen)) {
  const D = parseDeckField(fen);
  if (!D.present) return CARDS[kind]?.letter ? `${CARDS[kind].letter.toUpperCase()}@${sq}` : null;
  const l = slotsOfKind(fen, side, kind)[0];
  return l ? `${l.toUpperCase()}@${sq}` : null;
}

/** The cards that ENTERED a side's hand between two FENs (the draw the engine made at the turn's hand-over; a
 *  mulligan's fresh hand), by kind — a multiset difference. */
export const drawnBetween = (fenBefore, fenAfter, side) => minusCards(handOf(fenAfter, side), handOf(fenBefore, side));

/** What a ply did to a hand, for the record: { discarded, drew } for the mover of a mulligan (the whole hand went,
 *  a fresh one came), { drew } for the side that drew at the hand-over. */
export function handDelta(fenBefore, fenAfter, side) {
  return { discarded: minusCards(handOf(fenBefore, side), handOf(fenAfter, side)), drew: drawnBetween(fenBefore, fenAfter, side) };
}

/** A META CARD PLAYED (Reveal, Undo — outside the move grammar, no move spent): the FEN with one copy of the kind's
 *  card taken out of the side's hand, or null when the hand holds none. The engine draws the side up at its next
 *  turn's start, as after any card. */
export function removeCard(fen, side, kind) {
  const D = parseDeckField(fen);
  if (!D.present) return null;
  const l = slotsOfKind(fen, side, kind)[0];
  if (!l) return null;
  const slots = { w: { ...D.slots.w }, b: { ...D.slots.b } };
  slots[side][l] = { ...slots[side][l], n: slots[side][l].n - 1 };
  return withDeck(fen, { piles: D.piles, slots, winner: D.winner });
}

/** Is the side to move's mulligan on offer — the move `@@@@` among the legal moves? */
export const mulliganOffered = (legalMoves) => (legalMoves ?? []).includes(MULLIGAN);

/** Is the side to move bound to the LINK of its own open portal half — every legal move a cast of the open slot (or,
 *  without a deck, of the portal scroll)? */
export function mustLinkOf(fen, legalMoves) {
  const ms = legalMoves ?? [];
  if (!ms.length || !ms.every((m) => isCast(m))) return false;
  const letters = new Set(ms.map(castLetter));
  if (letters.size !== 1) return false;
  const l = ms[0] ? castLetter(ms[0]) : null;
  return l === PORTAL_SCROLL || l === openSlotOf(fen, sideToMove(fen));
}

/** What the record carries per ply: each side's hand, pile and spent cards — visible decks, on the record. `decks0`
 *  is the pair as shuffled ({ w: { pile }, b: { pile } }); without it the spent piles read empty. */
export function deckRecord(fen, decks0 = null) {
  const out = {};
  for (const side of ['w', 'b']) out[side] = { hand: handOf(fen, side), pile: pileOf(fen, side), spent: spentOf(fen, side, decks0?.[side]) };
  return out;
}

/** A hand or a pile as glyphs, for a bar: "❄ ◎◎ ↺" — every card's glyph. */
export function glyphsOf(kinds) {
  return (kinds ?? []).map((k) => CARDS[k]?.glyph ?? '?').join(' ');
}

/** `?deck=` for the page: 'off', a starter's name, or a comma list of kinds (a hand-built deck for the smokes and the
 *  instruments — the test cards allowed here and nowhere else). Null for none. */
export function parseDeckParam(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === 'off' || s === '0' || s === 'none') return { off: true };
  if (STARTER_DECKS[s]) return { starter: s, cards: starterCards(s) };
  const cards = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (cards.length && cards.every(isCardKind)) return { starter: null, cards, fixed: true }; // a hand-built list is dealt in its own order, top first
  return null;
}

// --------------------------------------------------------- the legacy pocket (`?deck=off`)

const cased = (letter, side) => (side === 'w' ? letter.toUpperCase() : letter.toLowerCase());
const LEGACY_KINDS = CARD_KINDS.filter((k) => CARDS[k].letter);

/** The scrolls in a side's pocket by card kind: { ice: n, portal: n } (a count of LETTERS, not cards). */
export function scrollCounts(fen, side) {
  const pocket = splitFen(fen).pocket ?? '';
  const out = {};
  for (const k of LEGACY_KINDS) {
    const ch = cased(CARDS[k].letter, side);
    out[k] = [...pocket].filter((c) => c === ch).length;
  }
  return out;
}

/** The spell cards a side holds in the LEGACY pocket: per kind, ceil(scrolls / the card's scrolls) — a portal card
 *  with one scroll spent (its half open) is still a card in hand. Catalog order. */
export function spellHand(fen, side) {
  const counts = scrollCounts(fen, side);
  const out = [];
  for (const k of LEGACY_KINDS) {
    const n = Math.ceil(counts[k] / CARDS[k].scrolls);
    for (let i = 0; i < n; i++) out.push(k);
  }
  return out;
}

/** The canonical legacy holdings string from per-side scroll counts: `[IOOioo]` for one ice and one portal card each. */
export function pocketString(counts) {
  let s = '';
  for (const side of ['w', 'b']) for (const k of LEGACY_KINDS) s += cased(CARDS[k].letter, side).repeat(counts[side]?.[k] ?? 0);
  return s;
}

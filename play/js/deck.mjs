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
import { parseDef, defWords } from './carddef.mjs'; // THE TERRAIN INTERPRETER (2026-10-03): every card is a definition

/** The hand's size — drawn up to at the start of each of a side's turns (designer 2026-09-25: "a hand size of four"). */
export const HAND_SIZE = DECK_HAND_SIZE;
export { MULLIGAN };

/** THE CATALOG: every card kind this build knows. `id` is the card's number
 *  to the engine (the FEN's bindings and piles carry it; a deal declares
 *  `card<id> = <def>` for every ID its decks hold), `def` its DEFINITION —
 *  `<effect> <shape> <targeting>` (carddef.mjs; THE TERRAIN INTERPRETER,
 *  2026-10-03), the engine's whole knowledge of the card — and `engine` the
 *  def's effect word ('hit', 'ice', 'wall', 'pit', 'harden', 'sledge', 'drop',
 *  'win', 'portal', 'meta'); `cls` 'spell' (a move) or 'meta' (free, the
 *  player's alone), `test` a card that exists for the instruments and never
 *  in a starter. THE CARD UI (Phase 3.2) reads `cost`, `short` and `text`;
 *  the legacy readers `letter` / `scrolls` (the `?deck=off` pocket). THE FIRST
 *  LIBRARY is the 3.3b ruling's (brief §4.10 "3.3b RULED"): names systematic
 *  until authored — the effect and the shape. IDs are stable: 1 ice, 2 portal,
 *  101 / 102 the meta cards and 200 the win card as the committed samples
 *  carry them; the terrain cards from 10 up by family. */
const card = (kind, id, def, name, glyph, short, extra = {}) => {
  const d = parseDef(def);
  return { kind, id, def: d.text, engine: d.effect, name, glyph, cls: d.effect === 'meta' ? 'meta' : 'spell', cost: d.effect === 'meta' ? 'free' : 'move', short, text: extra.text ?? defWords(d), ...extra };
};
export const CARDS = {
  // the two spells that came first — the Ice goes ANYWHERE since the ruling (its middle-rows rule was the portal margin's carry-over)
  ice: card('ice', 1, 'ice xxx/xox/xxx any', 'Ice', '❄', '3×3 ice, anywhere', { letter: ICE_SCROLL, scrolls: ICE_SCROLLS_PER_SIDE, text: 'a 3×3 patch of ice anywhere on the board; a piece that moves onto it slides on until something stops it' }),
  portal: card('portal', 2, 'portal', 'Portal', '◎', 'a linked pair, one turn', { letter: PORTAL_SCROLL, scrolls: PORTAL_SCROLLS_PER_SIDE, text: 'a pair of portals, cast in one turn; a piece that moves onto one comes out of the other' }),
  'ice-row': card('ice-row', 3, 'ice xox any', 'Ice row', '❄', 'three ice in a row'),
  'ice-l': card('ice-l', 4, 'ice x./x./ox any', 'Ice L', '❄', 'an L of ice'),
  // the hits: an intact wall cracks into a crate, a crate becomes floor; a smash does both at once
  crack: card('crack', 10, 'hit1 o near', 'Crack', '✸', 'crack one square'),
  smash: card('smash', 11, 'hit2 o near', 'Smash', '✸', 'smash one square'),
  'crack-row': card('crack-row', 12, 'hit1 xox near', 'Crack row', '✸', 'crack three in a row'),
  'crack-file': card('crack-file', 13, 'hit1 x/o/x near', 'Crack file', '✸', 'crack three in a file'),
  demolish: card('demolish', 14, 'hit1 xxx/xox/xxx near', 'Demolish', '✸', 'crack a 3×3'),
  blast: card('blast', 15, 'hit2 .x./xox/.x. near', 'Blast', '✸', 'smash a plus'),
  lance: card('lance', 16, 'hit1 o ray', 'Lance', '➶', 'a ray from your king'),
  // the builders: empty floor rises as breakable stone
  'wall-file': card('wall-file', 20, 'wall x/o/x near', 'Wall file', '▦', 'raise three in a file'),
  'wall-row': card('wall-row', 21, 'wall xox near', 'Wall row', '▦', 'raise three in a row'),
  'wall-l1': card('wall-l1', 22, 'wall x./x./ox near', 'Wall L', '▦', 'raise an L'),
  'wall-l2': card('wall-l2', 23, 'wall .x/.x/xo near', 'Wall L', '▦', 'raise an L'),
  'wall-l3': card('wall-l3', 24, 'wall xo/.x/.x near', 'Wall L', '▦', 'raise an L'),
  'wall-l4': card('wall-l4', 25, 'wall ox/x./x. near', 'Wall L', '▦', 'raise an L'),
  // the pits: empty floor sinks; a sliding piece falls in
  'sink-row': card('sink-row', 30, 'pit ox near', 'Sink row', '●', 'sink two in a row'),
  'sink-file': card('sink-file', 31, 'pit o/x near', 'Sink file', '●', 'sink two in a file'),
  // petrify: intact walls become bedrock
  petrify: card('petrify', 40, 'harden xox near', 'Petrify', '◆', 'petrify three in a row'),
  // the sledge enchantment: the hammer's home since the ruling (the always-on setting is gone)
  sledge: card('sledge', 50, 'sledge o king', 'Sledge', '⚒', 'your king cracks walls'),
  // reinforcement: a real pawn placed in your camp
  reinforce: card('reinforce', 60, 'drop p o camp', 'Reinforce', '♟', 'a pawn in your camp'),
  // the meta cards: the player's alone, free, never cast by the engine
  reveal: card('reveal', 101, 'meta', 'Reveal', '☉', "the oracle's three lines", { text: "the engine's best lines for this turn; costs no move" }),
  undo: card('undo', 102, 'meta', 'Undo', '↺', 'take back your last turn', { text: "take back your last move and the enemy's reply; costs no move" }),
  // THE YOU WIN CARD (designer 2026-09-25: "if you play it you win. Each player gets one copy, and it's always at the
  // bottom of the deck") — the engine's horizon instrument: cast on your own king, the game is over. Test only.
  win: card('win', 200, 'win', 'You Win', '★', 'play it: you win', { text: 'play it and you win — a test card, one copy at the bottom of each deck, so the engine can be watched digging for it', test: true }),
};
export const CARD_KINDS = Object.keys(CARDS);
export const SPELL_KINDS = CARD_KINDS.filter((k) => CARDS[k].cls === 'spell' && !CARDS[k].test);
export const META_KINDS = CARD_KINDS.filter((k) => CARDS[k].cls === 'meta');
/** The parsed definition of a kind (carddef.mjs), or null. */
export const defOf = (k) => (CARDS[k] ? parseDef(CARDS[k].def) : null);
export const isCardKind = (k) => Object.prototype.hasOwnProperty.call(CARDS, k);
const BY_ID = new Map(CARD_KINDS.map((k) => [CARDS[k].id, k]));
/** The card kind of an engine ID, or `card<id>` for one the catalog does not know (an old log, a foreign deck). */
export const kindOfId = (id) => BY_ID.get(id | 0) ?? `card${id}`;
export const idOfKind = (k) => CARDS[k]?.id ?? null;

/** THE STARTER DECKS (the designer: "a few starter decks the player could
 *  choose from"): THE LIBRARY — THE DEFAULT since 2026-10-03 — every spell in
 *  the library ONCE plus Reveal and Undo, shuffled by the deal's seed like
 *  every deck (24 cards today, and every card the library gains joins it);
 *  ADEPT (the two spells that came first) and SAPPER (the terrain set) the
 *  authored sets. The library replaced a six-spell Random starter the same
 *  day it shipped — the designer, on the first play: "We just got thru
 *  refactoring the fucking game to support large decks, and the setting to
 *  test it gives the enemy TWO cards. Not even a full hand." The stress-test
 *  setting deals full decks to both sides. */
export const STARTER_DECKS = {
  library: { name: 'The library', library: true },
  adept: { name: 'Adept', cards: ['portal', 'portal', 'portal', 'ice', 'ice', 'ice', 'reveal', 'undo'] },
  sapper: { name: 'Sapper', cards: ['crack', 'smash', 'crack-row', 'demolish', 'blast', 'lance', 'wall-file', 'wall-row', 'sink-row', 'petrify', 'sledge', 'reinforce', 'reveal', 'undo'] },
};
export const DEFAULT_STARTER = 'library';

/** The cards of a starter deck by name, or null — the library is every spell once (catalog order; the deal shuffles it). `seed` is unused since the library replaced the drawn starter and stays for the callers. */
export function starterCards(name, seed = 1) { // eslint-disable-line no-unused-vars
  const d = STARTER_DECKS[name];
  if (!d) return null;
  if (d.library) return [...SPELL_KINDS, 'reveal', 'undo'];
  return d.cards.slice();
}

/** THE ENEMY'S DECK: THE WHOLE LIBRARY, every spell once (the deal shuffles
 *  it by the enemy's seed) — the stress-test regime since 2026-10-03. It was
 *  width − 1 spells (two at width 3), a rule written when the library held two
 *  cards; "deck strength scaling with army size" (brief §8) returns as THE
 *  RUN'S ECONOMY in Phase 3.6, where the size is a rule of the floor. `width`
 *  and `seed` stay for the callers. Spells only. */
export function enemyDeck(width, seed) { // eslint-disable-line no-unused-vars
  return SPELL_KINDS.slice();
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

/** What a deal DECLARES to the engine for these two decks: the hand size and every card ID's DEFINITION (variant.mjs deckIniKeys). */
export function deckDeclaration(decks, handSize = HAND_SIZE) {
  const cards = {};
  for (const side of ['w', 'b']) for (const k of decks?.[side]?.pile ?? []) if (CARDS[k]) cards[CARDS[k].id] = CARDS[k].def;
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

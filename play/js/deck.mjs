// THE DECK (2026-09-25, designer: "Could we have spells as cards drawn from a
// deck? … both decks and hands fully visible to both players"; the rulings
// the same session — a hand of FOUR, drawn up to at the start of each turn,
// two decks, a shuffle and a fresh hand at the start of every duel, a cast is
// the caster's move, no card is ever valued by a number: the engine casts a
// card when the cast is the best move and for no other reason).
//
// A pure module. A CARD is a kind out of the catalog below. A SPELL card is
// one or more scrolls in the FEN's holdings — the engine's own view of a hand
// (a portal card is the pair's two scrolls, an ice card its one), and THE
// POCKET IS THE TRUTH for spells: the spell cards a side holds are read off
// the holdings at any moment (a half-spent portal, one scroll left with its
// half open, is still a card in hand). A META card never reaches the engine:
// Reveal and Undo are the player's alone, cost no move and live beside the
// pocket in the deck state. A DECK STATE per side is { pile (top first),
// meta (the meta cards in hand), spent }; the hand is the pocket's spell
// cards plus `meta`. A shuffle is one seeded draw from the deal's seed
// (prng.mjs), so a run replays from its inputs and both decks are perfect
// information the way the floor is. The enemy's deck holds spell cards only
// — an engine reveals nothing to itself and never undoes.
import { ICE_SCROLL, ICE_SCROLLS_PER_SIDE, PORTAL_SCROLL, PORTAL_SCROLLS_PER_SIDE } from './variant.mjs';
import { mulberry32, childSeed, shuffle, pick } from './prng.mjs';
import { splitFen, withPocket } from './fen.mjs';

/** The hand's size — drawn up to at the start of each of a side's turns (designer 2026-09-25: "a hand size of four"). */
export const HAND_SIZE = 4;

/** THE CATALOG: every card kind this build knows. `scrolls` is the number of
 *  holdings letters one card is to the engine; `cls` 'spell' rides the
 *  pocket, 'meta' the deck state. THE CARD UI (Phase 3.2, 2026-09-25) reads
 *  `cost` ('move': the cast is the caster's move; 'free': a meta card) for
 *  the face's cost pip, `short` for the face's one line and `text` for the
 *  reader (a long press) and the desktop's hover. */
export const CARDS = {
  ice: { kind: 'ice', name: 'Ice', glyph: '❄', letter: ICE_SCROLL, scrolls: ICE_SCROLLS_PER_SIDE, cls: 'spell', cost: 'move', short: '3×3 ice, middle rows', text: 'a 3×3 patch of ice on the middle rows; a piece that moves onto it slides on until something stops it' },
  portal: { kind: 'portal', name: 'Portal', glyph: '◎', letter: PORTAL_SCROLL, scrolls: PORTAL_SCROLLS_PER_SIDE, cls: 'spell', cost: 'move', short: 'a linked pair, one turn', text: 'a pair of portals, cast in one turn; a piece that moves onto one comes out of the other' },
  reveal: { kind: 'reveal', name: 'Reveal', glyph: '☉', cls: 'meta', cost: 'free', short: "the oracle's three lines", text: "the engine's best lines for this turn; costs no move" },
  undo: { kind: 'undo', name: 'Undo', glyph: '↺', cls: 'meta', cost: 'free', short: 'take back your last turn', text: "take back your last move and the enemy's reply; costs no move" },
};
export const CARD_KINDS = Object.keys(CARDS);
export const SPELL_KINDS = CARD_KINDS.filter((k) => CARDS[k].cls === 'spell');
export const META_KINDS = CARD_KINDS.filter((k) => CARDS[k].cls === 'meta');
export const isCardKind = (k) => Object.prototype.hasOwnProperty.call(CARDS, k);

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

/** A fresh deck state: the cards shuffled by ONE seeded draw, nothing in hand, nothing spent. `fixed` keeps the
 *  list's own order (a hand-built `?deck=` list: the smokes, and a URL that forces an opening hand). */
export function newDeckState(cards, seed, { fixed = false } = {}) {
  const clean = (cards ?? []).filter(isCardKind);
  return { pile: fixed ? clean : shuffle(mulberry32(seed >>> 0), clean), meta: [], spent: [] };
}

/** The two decks' seeds off a deal's seed (a replay of the deal is a replay of the shuffle). */
export const deckSeeds = (dealSeed) => ({ w: childSeed(dealSeed >>> 0, 'deck:w'), b: childSeed(dealSeed >>> 0, 'deck:b') });

export const cloneDeckState = (d) => (d ? { pile: [...d.pile], meta: [...d.meta], spent: [...d.spent] } : null);
export const cloneDecks = (decks) => (decks ? { w: cloneDeckState(decks.w), b: cloneDeckState(decks.b) } : null);

const cased = (letter, side) => (side === 'w' ? letter.toUpperCase() : letter.toLowerCase());

/** The scrolls in a side's pocket by card kind: { ice: n, portal: n } (a count of LETTERS, not cards). */
export function scrollCounts(fen, side) {
  const pocket = splitFen(fen).pocket ?? '';
  const out = {};
  for (const k of SPELL_KINDS) {
    const ch = cased(CARDS[k].letter, side);
    out[k] = [...pocket].filter((c) => c === ch).length;
  }
  return out;
}

/** The spell cards a side holds, read off the pocket: per kind, ceil(scrolls / the card's scrolls) — a
 *  portal card with one scroll spent (its half open) is still a card in hand. Catalog order. */
export function spellHand(fen, side) {
  const counts = scrollCounts(fen, side);
  const out = [];
  for (const k of SPELL_KINDS) {
    const n = Math.ceil(counts[k] / CARDS[k].scrolls);
    for (let i = 0; i < n; i++) out.push(k);
  }
  return out;
}

/** The hand as the player sees it: the pocket's spell cards, then the meta cards. */
export function handOf(fen, side, deck) {
  return [...spellHand(fen, side), ...(deck?.meta ?? [])];
}

/** The holdings string for a FEN with a side's scrolls of one kind set to `n` letters (the other side's and the other kinds kept, canonical order: catalog order, white then black). */
function pocketWith(fen, side, kind, n) {
  const counts = { w: scrollCounts(fen, 'w'), b: scrollCounts(fen, 'b') };
  counts[side][kind] = n;
  return pocketString(counts);
}

/** The canonical holdings string from per-side scroll counts: `[IOOioo]` for one ice and one portal card each. */
export function pocketString(counts) {
  let s = '';
  for (const side of ['w', 'b']) for (const k of SPELL_KINDS) s += cased(CARDS[k].letter, side).repeat(counts[side]?.[k] ?? 0);
  return s;
}

/**
 * DRAW UP TO THE HAND SIZE for one side: the top of the pile, card by card,
 * while the hand (the pocket's spell cards + the meta cards) is short of
 * `handSize` and the pile has cards. A spell card's scrolls join the pocket;
 * a meta card joins `deck.meta`. Mutates `deck`; returns { fen (the holdings
 * rewritten when a spell was drawn), drew: [kinds] }.
 */
export function drawUp(fen, side, deck, handSize = HAND_SIZE) {
  const drew = [];
  let f = fen;
  while (deck.pile.length && handOf(f, side, deck).length < handSize) {
    const k = deck.pile.shift();
    const card = CARDS[k];
    if (!card) continue;
    if (card.cls === 'spell') {
      const n = scrollCounts(f, side)[k] + card.scrolls;
      f = withPocket(f, pocketWith(f, side, k, n));
    } else deck.meta.push(k);
    drew.push(k);
  }
  return { fen: f, drew };
}

/**
 * THE OPENING HANDS: both sides draw to the hand size from fresh deck states
 * before the first ply. Returns { pocket, decks } — the holdings string the
 * deal writes into its start FEN (`withPocket`) and the deck states after the
 * draw. `decks` is { w: DeckState, b: DeckState } and is mutated.
 */
export function openHands(decks, handSize = HAND_SIZE) {
  let fen = '8/8/8/8/8/8/8/8[] w - - 0 1'; // any FEN: only its holdings are read here
  for (const side of ['w', 'b']) if (decks[side]) fen = drawUp(fen, side, decks[side], handSize).fen;
  return { pocket: splitFen(fen).pocket ?? '', decks };
}

/** Spend a meta card from a side's hand (Reveal, Undo): true when it was there. */
export function spendMeta(deck, kind) {
  const i = deck?.meta?.indexOf(kind) ?? -1;
  if (i < 0) return false;
  deck.meta.splice(i, 1);
  deck.spent.push(kind);
  return true;
}

/**
 * THE MULLIGAN (designer: "an option to spend your turn discarding any cards
 * you don't like and drawing a new hand"): every card in the side's hand
 * goes to `spent` — the pocket's spell cards (whole ones; a half-spent
 * portal is mid-cast and no mulligan is offered then) and the meta cards —
 * and a fresh hand is drawn. Returns { fen, discarded, drew }.
 */
export function mulligan(fen, side, deck, handSize = HAND_SIZE) {
  const discarded = handOf(fen, side, deck);
  let f = fen;
  for (const k of SPELL_KINDS) f = withPocket(f, pocketWith(f, side, k, 0));
  deck.spent.push(...deck.meta);
  deck.meta = [];
  for (const k of spellHand(fen, side)) deck.spent.push(k);
  const { fen: f2, drew } = drawUp(f, side, deck, handSize);
  return { fen: f2, discarded, drew };
}

/** What the record carries per ply: each side's hand, pile and spent list — visible decks, on the record. */
export function deckRecord(fen, decks) {
  if (!decks) return null;
  const out = {};
  for (const side of ['w', 'b']) if (decks[side]) out[side] = { hand: handOf(fen, side, decks[side]), pile: [...decks[side].pile], spent: [...decks[side].spent] };
  return out;
}

/** A hand or a pile as glyphs, for a bar: "❄ ◎◎ ↺" — every card's glyph, spells first as the catalog orders them. */
export function glyphsOf(kinds) {
  return (kinds ?? []).map((k) => CARDS[k]?.glyph ?? '?').join(' ');
}

/** `?deck=` for the page: 'off', a starter's name, or a comma list of kinds (a hand-built deck for the smokes). Null for none. */
export function parseDeckParam(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === 'off' || s === '0' || s === 'none') return { off: true };
  if (STARTER_DECKS[s]) return { starter: s, cards: starterCards(s) };
  const cards = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (cards.length && cards.every(isCardKind)) return { starter: null, cards, fixed: true }; // a hand-built list is dealt in its own order, top first
  return null;
}

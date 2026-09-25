// THE DECK (2026-09-25, play/js/deck.mjs): the catalog against the engine's
// scroll letters, a seeded shuffle that replays, the opening hands as a
// pocket, the hand read off the pocket (a half-spent portal still a card),
// the draw to the hand size, the meta cards beside the pocket, the mulligan,
// the enemy's deck by width, the record's shape, the page's `?deck=` parser.
// Node only, no engine. Usage: cd phase0 && node harness/test-deck.mjs
import { CARDS, SPELL_KINDS, META_KINDS, HAND_SIZE, STARTER_DECKS, DEFAULT_STARTER, starterCards, enemyDeck, enemyCards, newDeckState, deckSeeds, openHands, scrollCounts, spellHand, handOf, drawUp, spendMeta, mulligan, deckRecord, pocketString, glyphsOf, parseDeckParam, cloneDecks } from '../../play/js/deck.mjs';
import { ICE_SCROLL, PORTAL_SCROLL, PORTAL_SCROLLS_PER_SIDE, ICE_SCROLLS_PER_SIDE, spellPocket } from '../../play/js/variant.mjs';
import { splitFen, withPocket } from '../../play/js/fen.mjs';

let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`FAIL ${what}`); } };
const fenWith = (pocket) => `4k3/8/8/8/8/8/8/4K3[${pocket}] w - - 0 1`;

// ---- the catalog is the engine's letters
check(CARDS.ice.letter === ICE_SCROLL && CARDS.ice.scrolls === ICE_SCROLLS_PER_SIDE, 'the ice card is the ice scroll');
check(CARDS.portal.letter === PORTAL_SCROLL && CARDS.portal.scrolls === PORTAL_SCROLLS_PER_SIDE, 'the portal card is the pair of portal scrolls');
check(SPELL_KINDS.join(',') === 'ice,portal' && META_KINDS.join(',') === 'reveal,undo', `spells ${SPELL_KINDS} · meta ${META_KINDS}`);
check(HAND_SIZE === 4, 'a hand of four');
check(STARTER_DECKS[DEFAULT_STARTER] && starterCards(DEFAULT_STARTER).length === 8 && starterCards('nope') === null, 'the default starter deck has eight cards; an unknown name is null');
check(starterCards(DEFAULT_STARTER).includes('reveal') && starterCards(DEFAULT_STARTER).includes('undo'), 'every starter carries Reveal and Undo');
// The old stress-test set reads as one ice card and one portal card a side through the same readers.
check(spellHand(fenWith(spellPocket({ portals: true, ice: true })), 'w').join(',') === 'ice,portal' && spellHand(fenWith(spellPocket({ portals: true, ice: true })), 'b').join(',') === 'ice,portal', 'the stress-test pocket [IOOioo] reads as one ice and one portal card a side');

// ---- a seeded shuffle replays; another seed differs; the cards are conserved
{
  const a = newDeckState(starterCards('adept'), 12345), b = newDeckState(starterCards('adept'), 12345), c = newDeckState(starterCards('adept'), 12346);
  check(a.pile.join(',') === b.pile.join(','), 'the same seed shuffles the same');
  check(a.pile.join(',') !== c.pile.join(','), 'another seed shuffles differently');
  check([...a.pile].sort().join(',') === [...starterCards('adept')].sort().join(','), 'a shuffle conserves the cards');
  check(a.meta.length === 0 && a.spent.length === 0, 'a fresh deck holds nothing in hand and nothing spent');
  const s = deckSeeds(777);
  check(s.w !== s.b && deckSeeds(777).w === s.w, 'the two decks draw different seeds off one deal seed, stably');
  check(newDeckState(['ice', 'bogus', 'portal'], 1).pile.length === 2, 'an unknown kind is dropped from a deck');
}

// ---- the opening hands: four cards each, the spells in the pocket, the meta cards beside it
{
  const decks = { w: newDeckState(starterCards('adept'), 1), b: newDeckState(enemyDeck(4, 1), 2) };
  const before = cloneDecks(decks);
  const { pocket } = openHands(decks);
  const fen = fenWith(pocket);
  const hw = handOf(fen, 'w', decks.w), hb = handOf(fen, 'b', decks.b);
  check(hw.length === 4, `white's opening hand is four cards (${hw})`);
  check(hb.length === 3, `a width-4 enemy's whole deck (three cards) is its hand (${hb})`);
  check(decks.w.pile.length === 4 && decks.b.pile.length === 0, `the piles hold the rest (w ${decks.w.pile.length}, b ${decks.b.pile.length})`);
  check(before.w.pile.slice(0, 4).join(',') === hw.slice().sort((x, y) => before.w.pile.indexOf(x) - before.w.pile.indexOf(y)).join(','), 'the hand is the top of the pile');
  const counts = scrollCounts(fen, 'w');
  check(counts.portal === 2 * hw.filter((k) => k === 'portal').length && counts.ice === hw.filter((k) => k === 'ice').length, `the pocket carries two scrolls per portal card and one per ice (${pocket})`);
  check(decks.w.meta.every((k) => META_KINDS.includes(k)) && hw.filter((k) => META_KINDS.includes(k)).length === decks.w.meta.length, 'the meta cards sit beside the pocket');
  check(/^[A-Z]*[a-z]*$/.test(pocket), `the pocket is canonical, white then black (${pocket})`);
}

// ---- the hand read off the pocket: a half-spent portal is still a card; the draw refills to four
{
  const deck = { pile: ['ice', 'reveal', 'portal'], meta: [], spent: [] };
  let fen = fenWith('OOOioo'); // white: one pair and a HALF-SPENT pair (three scrolls)
  check(spellHand(fen, 'w').join(',') === 'portal,portal', `three portal scrolls read as two cards, one mid-cast (${spellHand(fen, 'w')})`);
  check(handOf(fen, 'w', deck).length === 2, 'the hand counts the mid-cast card');
  const r = drawUp(fen, 'w', deck);
  check(r.drew.join(',') === 'ice,reveal', `the draw takes two off the top to fill four (${r.drew})`);
  fen = r.fen;
  check(scrollCounts(fen, 'w').ice === 1 && deck.meta.join(',') === 'reveal' && deck.pile.join(',') === 'portal', `an ice card became a scroll, Reveal joined the meta hand, one card left on the pile (${splitFen(fen).pocket})`);
  check(handOf(fen, 'w', deck).length === 4, 'the hand is four');
  const r2 = drawUp(fen, 'w', deck);
  check(r2.drew.length === 0 && r2.fen === fen, 'a full hand draws nothing');
  // spend the ice (as a cast would: the letter leaves the pocket), then the next draw refills
  fen = withPocket(fen, splitFen(fen).pocket.replace('I', ''));
  const r3 = drawUp(fen, 'w', deck);
  check(r3.drew.join(',') === 'portal' && deck.pile.length === 0 && scrollCounts(r3.fen, 'w').portal === 5, `after a cast the last card is drawn (${r3.drew}; portal scrolls ${scrollCounts(r3.fen, 'w').portal})`);
  const r4 = drawUp(withPocket(r3.fen, ''), 'w', deck);
  check(r4.drew.length === 0, 'an empty pile draws nothing');
  check(scrollCounts(r3.fen, 'b').portal === 2 && spellHand(r3.fen, 'b').join(',') === 'ice,portal', "black's pocket is untouched by white's draws");
}

// ---- meta cards: spend, refuse what is not held
{
  const deck = { pile: [], meta: ['reveal', 'undo'], spent: [] };
  check(spendMeta(deck, 'undo') && deck.meta.join(',') === 'reveal' && deck.spent.join(',') === 'undo', 'a meta card is spent from the hand');
  check(!spendMeta(deck, 'undo') && deck.meta.length === 1, 'a card not held cannot be spent');
  check(!spendMeta(null, 'reveal'), 'no deck, no spend');
}

// ---- the mulligan: the whole hand to spent, a fresh hand drawn, the other side untouched
{
  const deck = { pile: ['ice', 'ice', 'portal', 'undo', 'ice'], meta: ['reveal'], spent: [] };
  const fen = fenWith('IOOioo');
  const m = mulligan(fen, 'w', deck);
  check(m.discarded.join(',') === 'ice,portal,reveal', `the hand went to spent (${m.discarded})`);
  check(m.drew.join(',') === 'ice,ice,portal,undo' && deck.pile.join(',') === 'ice', `a fresh four drawn off the top (${m.drew}); one left`);
  check(deck.spent.join(',') === 'reveal,ice,portal', `spent lists the discards (${deck.spent})`);
  check(scrollCounts(m.fen, 'w').ice === 2 && scrollCounts(m.fen, 'w').portal === 2 && deck.meta.join(',') === 'undo', `the new hand's spells are in the pocket (${splitFen(m.fen).pocket})`);
  check(splitFen(m.fen).pocket.endsWith('ioo'), "black's scrolls stayed");
}

// ---- the enemy's deck by width: width − 1 spells, by seed, spells only
{
  check(enemyDeck(3, 5).length === 2 && enemyDeck(4, 5).length === 3 && enemyDeck(1, 5).length === 0, 'width − 1 cards');
  check(enemyDeck(3, 5).join(',') === enemyDeck(3, 5).join(','), 'the same seed, the same enemy deck');
  check(enemyDeck(6, 5).every((k) => SPELL_KINDS.includes(k)), 'spells only');
  check(enemyCards(starterCards('adept')).length === 6 && enemyCards(starterCards('adept')).every((k) => SPELL_KINDS.includes(k)), "the enemy's version of a starter is its spells alone");
}

// ---- the record's shape and the glyphs
{
  const decks = { w: { pile: ['ice'], meta: ['undo'], spent: ['reveal'] }, b: { pile: [], meta: [], spent: [] } };
  const rec = deckRecord(fenWith('OOioo'), decks);
  check(rec.w.hand.join(',') === 'portal,undo' && rec.w.pile.join(',') === 'ice' && rec.w.spent.join(',') === 'reveal' && rec.b.hand.join(',') === 'ice,portal', `the record names hand / pile / spent per side (${JSON.stringify(rec.w)})`);
  check(deckRecord(fenWith(''), null) === null, 'no decks, no record');
  check(glyphsOf(['ice', 'portal', 'reveal', 'undo']) === '❄ ◎ ☉ ↺' && glyphsOf([]) === '', 'glyphs per card');
  check(pocketString({ w: { ice: 1, portal: 2 }, b: { ice: 1, portal: 2 } }) === 'IOOioo', 'the canonical pocket string (scroll counts: one ice, two portal scrolls a side)');
}

// ---- the page's parameter
{
  check(parseDeckParam(null) === null && parseDeckParam('off').off === true && parseDeckParam('0').off === true, 'off and nothing');
  const s = parseDeckParam('adept');
  check(s.starter === 'adept' && s.cards.length === 8, 'a starter by name');
  const h = parseDeckParam('ice,portal,reveal,undo');
  check(h.starter === null && h.cards.join(',') === 'ice,portal,reveal,undo' && h.fixed === true, 'a hand-built list, dealt in its own order');
  check(newDeckState(['undo', 'ice', 'portal'], 1, { fixed: true }).pile.join(',') === 'undo,ice,portal', 'a fixed deck keeps its order');
  check(parseDeckParam('ice,bogus') === null, 'an unknown kind refuses the list');
}

console.log(`test-deck: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

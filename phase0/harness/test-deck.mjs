// THE DECK (2026-09-25, play/js/deck.mjs) — IN THE ENGINE since 2026-09-26
// (deck.patch; brief §4.10 "Phase 3.3"): the catalog's IDs and engine kinds,
// a seeded shuffle that replays, THE OPENING DEAL into a FEN by the engine's
// own binding rule (identical cards share a slot, the lowest free slot
// otherwise), the readers off a FEN (the hand, the pile, the spent cards,
// what a cast casts, what a ply drew), a meta card taken out of the hand,
// the deal's declaration and the variant it names, the enemy's deck by width,
// the page's `?deck=` parser, and the legacy pocket (`?deck=off`) through the
// same readers. Node only, no engine. Usage: cd phase0 && node harness/test-deck.mjs
import { CARDS, CARD_KINDS, SPELL_KINDS, META_KINDS, HAND_SIZE, STARTER_DECKS, DEFAULT_STARTER, starterCards, enemyDeck, enemyCards, newDeckState, deckSeeds, cloneDecks, deckDeclaration, slotFor, openingDeck, dealDeckFen, deckOn, handOf, pileOf, spentOf, minusCards, slotsOfKind, openSlotOf, cardOfCast, castUci, drawnBetween, handDelta, removeCard, mulliganOffered, mustLinkOf, deckRecord, glyphsOf, parseDeckParam, kindOfId, idOfKind, scrollCounts, spellHand, pocketString, MULLIGAN } from '../../play/js/deck.mjs';
import { ICE_SCROLL, PORTAL_SCROLL, spellPocket, dealVariant, deckIniKeys, deckVariantSuffix, DECK_SLOT_LETTERS } from '../../play/js/variant.mjs';
import { splitFen, parseDeckField, withDeck, deckPocket, castSlot, isMulligan } from '../../play/js/fen.mjs';

let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`FAIL ${what}`); } };
const BARE = '4k3/pppp4/8/8/8/8/PPPP4/4K3[] w - - 0 1';
const field = (f) => (f.match(/\{[^}]*\}/) || [''])[0];
const pocket = (f) => splitFen(f).pocket ?? '';

// ---- the catalog: IDs, engine kinds, classes
check(CARDS.ice.id === 1 && CARDS.ice.engine === 'ice' && CARDS.portal.id === 2 && CARDS.portal.engine === 'portal', 'the ice and portal cards carry their IDs and engine kinds');
check(CARDS.reveal.engine === 'meta' && CARDS.undo.engine === 'meta' && CARDS.win.engine === 'win' && CARDS.win.test === true, 'the meta cards are blanks to the engine; You Win is the test card');
check(new Set(CARD_KINDS.map((k) => CARDS[k].id)).size === CARD_KINDS.length && CARD_KINDS.every((k) => kindOfId(CARDS[k].id) === k && idOfKind(k) === CARDS[k].id), 'every card has its own ID and reads back by it');
check(kindOfId(999) === 'card999' && idOfKind('nope') === null, 'an unknown ID reads as card<id>, an unknown kind has no ID');
check(SPELL_KINDS.join(',') === 'ice,portal' && META_KINDS.join(',') === 'reveal,undo', `spells ${SPELL_KINDS} (the test card apart) · meta ${META_KINDS}`);
check(CARDS.ice.letter === ICE_SCROLL && CARDS.portal.letter === PORTAL_SCROLL, 'the legacy letters stay on the two scroll cards');
check(HAND_SIZE === 4 && MULLIGAN === '@@@@' && isMulligan(MULLIGAN), 'a hand of four; the mulligan is the move @@@@');
check(STARTER_DECKS[DEFAULT_STARTER] && starterCards(DEFAULT_STARTER).length === 8 && starterCards('nope') === null, 'the default starter deck has eight cards; an unknown name is null');
check(starterCards(DEFAULT_STARTER).includes('reveal') && starterCards(DEFAULT_STARTER).includes('undo') && !starterCards(DEFAULT_STARTER).includes('win'), 'every starter carries Reveal and Undo and never the test card');

// ---- a seeded shuffle replays; another seed differs; the cards are conserved
{
  const a = newDeckState(starterCards('adept'), 12345), b = newDeckState(starterCards('adept'), 12345), c = newDeckState(starterCards('adept'), 12346);
  check(a.pile.join(',') === b.pile.join(','), 'the same seed shuffles the same');
  check(a.pile.join(',') !== c.pile.join(','), 'another seed shuffles differently');
  check([...a.pile].sort().join(',') === [...starterCards('adept')].sort().join(','), 'a shuffle conserves the cards');
  const s = deckSeeds(777);
  check(s.w !== s.b && deckSeeds(777).w === s.w, 'the two decks draw different seeds off one deal seed, stably');
  check(newDeckState(['ice', 'bogus', 'portal'], 1).pile.length === 2, 'an unknown kind is dropped from a deck');
  check(newDeckState(['ice', 'portal', 'win'], 1, { fixed: true }).pile.join(',') === 'ice,portal,win', 'a fixed list keeps its order');
  const cl = cloneDecks({ w: a, b: c });
  check(cl.w.pile.join(',') === a.pile.join(',') && cl.w !== a && cl.w.pile !== a.pile, 'a clone is a copy');
}

// ---- the engine's binding rule
{
  const slots = {};
  check(slotFor(slots, 1) === 's', 'an empty hand: the first card takes s');
  slots.s = { id: 1, n: 1, open: false };
  check(slotFor(slots, 1) === 's' && slotFor(slots, 2) === 't', 'a second copy joins its slot, a new card takes the next');
  slots.t = { id: 2, n: 1, open: true };
  slots.u = { id: 3, n: 0, open: false };
  check(slotFor(slots, 5) === 'u', 'an emptied slot is free again; the slot with the open half is skipped when empty');
  slots.t = { id: 2, n: 0, open: true };
  check(slotFor(slots, 5) === 'u' && slotFor(slots, 2) === 'u', 'the open slot takes nothing new, its own card included');
}

// ---- the opening deal: the hands into the slots, the piles into the field, both sides
{
  const decks = { w: newDeckState(['portal', 'reveal', 'ice', 'undo', 'ice', 'portal', 'ice', 'portal'], 1, { fixed: true }), b: newDeckState(['ice', 'portal', 'ice', 'portal', 'ice'], 1, { fixed: true }) };
  const op = openingDeck(decks);
  check(JSON.stringify(op.slots.w) === JSON.stringify({ s: { id: 2, n: 1, open: false }, t: { id: 101, n: 1, open: false }, u: { id: 1, n: 1, open: false }, v: { id: 102, n: 1, open: false } }), `white's four cards take s..v in draw order (${JSON.stringify(op.slots.w)})`);
  check(op.piles.w.join('.') === '1.2.1.2' && op.piles.b.join('.') === '1', `the rest stays on the piles as IDs (w ${op.piles.w.join('.')} · b ${op.piles.b.join('.')})`);
  check(JSON.stringify(op.slots.b) === JSON.stringify({ s: { id: 1, n: 2, open: false }, t: { id: 2, n: 2, open: false } }), `black's identical cards merge: two ice in s, two portals in t (${JSON.stringify(op.slots.b)})`);
  const fen = dealDeckFen(BARE, decks);
  check(fen === '4k3/pppp4/8/8/8/8/PPPP4/4K3[STUVsstt] w - - 0 1 {w|1.2.1.2,S=w2,T=w101,U=w1,V=w102,b|1,S=b1,T=b2}', `the start FEN carries the hands and the piles the way the engine prints them (${fen})`);
  check(deckOn(fen) && !deckOn(BARE) && !deckOn('4k3/8/8/8/8/8/8/4K3[IOOioo] w - - 0 1'), 'a deck is on when the FEN carries slots or piles; the legacy pocket is not one');
  check(handOf(fen, 'w').join(',') === 'portal,reveal,ice,undo' && handOf(fen, 'b').join(',') === 'ice,ice,portal,portal', `the hands read back in slot order (${handOf(fen, 'w')} · ${handOf(fen, 'b')})`);
  check(pileOf(fen, 'w').join(',') === 'ice,portal,ice,portal' && pileOf(fen, 'b').join(',') === 'ice', 'the piles read back as kinds, top first');
  check(spentOf(fen, 'w', decks.w).length === 0 && spentOf(fen, 'b', decks.b).length === 0, 'nothing is spent at the start');
  const rec = deckRecord(fen, decks);
  check(rec.w.hand.length === 4 && rec.w.pile.length === 4 && rec.w.spent.length === 0 && rec.b.hand.length === 4 && rec.b.pile.length === 1, 'the record carries both decks: hand, pile, spent');
  check(deckRecord(fen).w.spent.length === 0, 'without the pair as shuffled the spent pile reads empty');
  const decl = deckDeclaration(decks);
  check(JSON.stringify(decl) === JSON.stringify({ handSize: 4, cards: { 1: 'ice', 2: 'portal', 101: 'meta', 102: 'meta' } }), `the declaration names every ID either deck holds (${JSON.stringify(decl)})`);
  const v = dealVariant(8, 8, 2, 7, { portals: true, ice: true, deck: decl });
  check(v.name === 'duel_8x8__w2__b7__portals2__ice__deck4_1i_2p_101m_102m', `the deal's variant name carries the declaration (${v.name})`);
  check(/handSize = 4\n/.test(v.ini) && /cardSlots = stuvwxyz\n/.test(v.ini) && /card1 = ice\n/.test(v.ini) && /card2 = portal\n/.test(v.ini) && /card101 = meta\n/.test(v.ini) && /card102 = meta\n/.test(v.ini) && /pieceDrops = true\n/.test(v.ini), 'the ini declares the hand size, the slots and every card');
  check(deckVariantSuffix({ handSize: 4, cards: { 200: 'win', 1: 'ice' } }) === '__deck4_1i_200w' && DECK_SLOT_LETTERS === 'stuvwxyz', 'the suffix sorts the IDs; the slot letters are s..z');
  let threw = false;
  try { deckIniKeys({ cards: { 7: 'fire' } }); } catch { threw = true; }
  check(threw, 'an unknown engine kind is refused');
  // the writer round-trips through the reader, other field entries kept in the engine's order
  const D = parseDeckField(fen);
  check(withDeck('4k3/pppp4/8/8/8/8/PPPP4/4K3[IOOioo] w - - 0 1 {c3-h8,~e4}', D) === '4k3/pppp4/8/8/8/8/PPPP4/4K3[STUVsstt] w - - 0 1 {c3-h8,~e4,w|1.2.1.2,S=w2,T=w101,U=w1,V=w102,b|1,S=b1,T=b2}', 'withDeck keeps the pairs and the ice before the deck entries and replaces a legacy pocket');
  check(deckPocket(D.slots) === 'STUVsstt', 'the holdings from the slots: white then black, one letter per copy');
}

// ---- what a cast casts, the UCI that casts a kind, the link's slot
{
  const fen = '4k3/pppp4/8/8/8/8/PPPP4/4K3[STUVsstt] w - - 0 1 {w|1.2,S=w2,T=w101,U=w1,V=w102,S=b1,T=b2}';
  check(cardOfCast(fen, 'S@e4') === 'portal' && cardOfCast(fen, 'U@e4') === 'ice' && cardOfCast(fen, 'T@e4') === 'reveal' && cardOfCast(fen, 'W@e4') === null && cardOfCast(fen, 'e2e4') === null, 'a slot drop casts the card its slot holds; an empty slot casts nothing; a move is no cast');
  check(cardOfCast(fen, 'S@e4', 'b') === 'ice' && cardOfCast(fen.replace(' w ', ' b '), 'T@e4') === 'portal', "the other side's bindings read by side, or by the side to move");
  check(cardOfCast(fen, 'I@e4') === 'ice' && cardOfCast(fen, 'O@e4') === 'portal', 'the legacy scrolls cast by their letter');
  check(castUci(fen, 'ice', 'e4') === 'U@e4' && castUci(fen, 'portal', 'c5') === 'S@c5' && castUci(fen, 'win', 'e1') === null && castUci(fen, 'ice', 'e4', 'b') === 'S@e4', 'the UCI that casts a kind is its slot\'s drop; a kind not held casts nothing');
  check(castSlot('U@e4') === 'u' && castSlot('I@e4') === null && castSlot('e2e4') === null, 'castSlot names a slot letter alone');
  check(slotsOfKind(fen, 'w', 'ice').join('') === 'u' && slotsOfKind(fen, 'b', 'portal').join('') === 't' && openSlotOf(fen, 'w') === null, 'the slots of a kind; no open slot');
  const half = '4k3/pppp4/8/8/8/8/PPPP4/4K3[STUVsstt] w - - 0 1 {e4w,w|1.2,S=w2+,T=w101,U=w1,V=w102,S=b1,T=b2}';
  check(openSlotOf(half, 'w') === 's' && slotsOfKind(half, 'w', 'portal')[0] === 's' && castUci(half, 'portal', 'c5') === 'S@c5', 'the open slot is the link\'s: first among its kind');
  check(mustLinkOf(half, ['S@c5', 'S@d5']) && !mustLinkOf(half, ['S@c5', 'e2e4']) && !mustLinkOf(half, ['U@c5']) && !mustLinkOf(half, []), 'the link ply: every legal move a cast of the open slot');
  check(mustLinkOf('4k3/8/8/8/8/8/8/4K3[Ooo] w - - 0 1 {e4w}', ['O@c5', 'O@d5']), 'the legacy scroll\'s link ply reads the same');
  check(mulliganOffered(['e2e4', '@@@@']) && !mulliganOffered(['e2e4']), 'the mulligan is on offer when the engine lists @@@@');
  check(castUci('4k3/8/8/8/8/8/8/4K3[IOOioo] w - - 0 1', 'ice', 'e4') === 'I@e4' && castUci('4k3/8/8/8/8/8/8/4K3[IOOioo] w - - 0 1', 'portal', 'e4') === 'O@e4', 'without a deck a kind casts by its scroll letter');
}

// ---- what a ply drew, a mulligan's hands, a meta card taken out
{
  const before = '4k3/pppp4/8/8/8/8/PPPP4/4K3[STUss] b - - 0 1 {w|1.2.1,S=w2,T=w101,U=w1,S=b1}';
  const after = '4k3/pppp4/8/8/8/8/PPPP4/4K3[STUVss] w - - 0 2 {w|2.1,S=w2,T=w101,U=w1,V=w1,S=b1}'; // hmm: an ice would merge into u — a foreign layout, read as the engine wrote it
  check(drawnBetween(before, after, 'w').join(',') === 'ice' && drawnBetween(before, after, 'b').length === 0, 'the draw is the multiset difference of the hands');
  const m0 = '4k3/pppp4/8/8/8/8/PPPP4/4K3[SSTss] w - - 0 1 {w|2.1.2.1.101,S=w1,T=w2,S=b1}'; // ice, ice, portal
  const m1 = '4k3/pppp4/8/8/8/8/PPPP4/4K3[SSTss] b - - 0 1 {w|101,S=w2,T=w101,S=b1}'; // portal, portal, reveal
  const d = handDelta(m0, m1, 'w');
  check(d.discarded.join(',') === 'ice,ice' && d.drew.join(',') === 'portal,reveal', `handDelta reads the multiset change (discarded ${d.discarded}, drew ${d.drew})`);
  check(minusCards(['ice', 'portal', 'ice'], ['ice']).join(',') === 'portal,ice' && minusCards(['ice'], ['ice', 'ice']).length === 0, 'minusCards is a multiset difference, order kept');
  const fen = '4k3/pppp4/8/8/8/8/PPPP4/4K3[STUVsstt] w - - 0 1 {w|1.2,S=w2,T=w101,U=w1,V=w102,S=b1,T=b2}';
  const r = removeCard(fen, 'w', 'reveal');
  check(r === '4k3/pppp4/8/8/8/8/PPPP4/4K3[SUVsstt] w - - 0 1 {w|1.2,S=w2,U=w1,V=w102,S=b1,T=b2}', `a meta card taken out: its slot emptied, the pile untouched (${r})`);
  check(removeCard(fen, 'w', 'win') === null && removeCard(fen, 'b', 'reveal') === null && removeCard('4k3/8/8/8/8/8/8/4K3[IOOioo] w - - 0 1', 'w', 'ice') === null, 'nothing to take out: null');
  const two = removeCard('4k3/pppp4/8/8/8/8/PPPP4/4K3[SSs] w - - 0 1 {S=w101,S=b1}', 'w', 'reveal');
  check(two === '4k3/pppp4/8/8/8/8/PPPP4/4K3[Ss] w - - 0 1 {S=w101,S=b1}', 'one copy of a doubled card goes, the binding stays');
  check(spentOf(r, 'w', { pile: ['portal', 'reveal', 'ice', 'undo', 'ice', 'portal'] }).join(',') === 'reveal', 'the spent pile is the deck less the pile and the hand');
}

// ---- the enemy's deck by width, the page's parameter, the glyphs
{
  check(enemyDeck(3, 1).length === 2 && enemyDeck(4, 1).length === 3 && enemyDeck(1, 1).length === 0, 'width − 1 spell cards');
  check(enemyDeck(4, 5).join(',') === enemyDeck(4, 5).join(',') && enemyDeck(4, 5).every((k) => SPELL_KINDS.includes(k)), 'stable by seed, spells only');
  check(enemyCards(['ice', 'reveal', 'portal', 'undo', 'win']).join(',') === 'ice,portal,win', 'the enemy keeps the spell cards alone');
  check(parseDeckParam(null) === null && parseDeckParam('off').off && parseDeckParam('adept').starter === 'adept' && parseDeckParam('adept').cards.length === 8, '?deck=: off, a starter');
  const list = parseDeckParam('ice,portal,win');
  check(list.fixed === true && list.starter === null && list.cards.join(',') === 'ice,portal,win' && parseDeckParam('ice,bogus') === null, 'a hand-built list is fixed, the test card allowed; an unknown kind refuses the list');
  check(glyphsOf(['ice', 'portal', 'undo']) === '❄ ◎ ↺' && glyphsOf(['nope']) === '?', 'glyphs');
}

// ---- the legacy pocket (`?deck=off`) through the same readers
{
  const fen = `4k3/8/8/8/8/8/8/4K3[${spellPocket({ portals: true, ice: true })}] w - - 0 1`;
  check(handOf(fen, 'w').join(',') === 'ice,portal' && handOf(fen, 'b').join(',') === 'ice,portal', 'the stress-test pocket [IOOioo] reads as one ice and one portal card a side');
  check(spellHand('4k3/8/8/8/8/8/8/4K3[OOOioo] w - - 0 1', 'w').join(',') === 'portal,portal', 'three portal scrolls read as two cards, one mid-cast');
  check(scrollCounts(fen, 'w').portal === 2 && scrollCounts(fen, 'w').ice === 1 && pocketString({ w: { ice: 1, portal: 2 }, b: { ice: 1, portal: 2 } }) === 'IOOioo', 'the legacy counts and the canonical pocket');
  check(pileOf(fen, 'w').length === 0 && deckRecord(fen).w.hand.join(',') === 'ice,portal', 'no pile without a deck; the record still names the hand');
}

console.log(`test-deck: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

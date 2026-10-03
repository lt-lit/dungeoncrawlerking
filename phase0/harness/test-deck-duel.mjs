// THE DECK IN THE ENGINE, in the duel (2026-09-26; play/js/deck.mjs +
// duel.mjs on the vendored pair, deck.patch): a deal on the canon controller
// with two decks — the opening hands of four in the start FEN's slots, the
// piles in its field, the deal's variant declaring every card; no draw on a
// quiet ply; after a cast the ENGINE draws for the caster inside the reply
// that hands it the turn (the state's `drew`, the pile one shorter); no draw
// on the link ply or for the frozen side; the meta cards played outside the
// move grammar (the hand rewritten, a bare position, spent through an undo);
// the mulligan as the engine's own move `@@@@` (SAN `redraw`, the hand
// replaced, the turn spent, the engine moving on from it); an undo restoring
// the hands and the piles with the position; the You Win card ending the
// duel; a duel without a deck the old controller. Needs the play/vendor
// overlay (engine/README.md). Usage: cd phase0 && node harness/test-deck-duel.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish, loadEngine, assertFurnitureSupport } from '../lib/load.mjs';
import { makeCatalogIni } from '../../play/js/variant.mjs';
import { loadStageV2 } from '../../play/js/stage.mjs';
import { dealMatchup } from '../../play/js/armygen.mjs';
import { DuelController } from '../../play/js/duel.mjs';
import { starterCards, enemyDeck, newDeckState, deckSeeds, cloneDecks, HAND_SIZE, handOf, pileOf, castUci, MULLIGAN } from '../../play/js/deck.mjs';
import { splitFen, parseDeckField } from '../../play/js/fen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0;
const check = (ok, what) => { process.stderr.write(`${ok ? 'ok ' : 'BAD'} ${what}\n`); if (ok) pass++; else fail++; };

const ffish = await loadFfish();
const engine = await loadEngine();
engine.setoption('Use NNUE', 'false');
const catalogIni = makeCatalogIni();
ffish.loadVariantConfig(catalogIni);
await engine.loadVariantsIni(catalogIni);
try { assertFurnitureSupport(ffish); } catch (e) { console.error(e.message); process.exit(2); }

const stage = loadStageV2(JSON.parse(fs.readFileSync(path.join(ROOT, 'play/stages/s59-hall-corner.json'), 'utf8')));
const seed = 3;
const seeds = deckSeeds(seed);
const decks = { w: newDeckState(starterCards('adept'), seeds.w), b: newDeckState(enemyDeck(3, seed), seeds.b) };
const dealWith = (d) => dealMatchup({ stage, white: { spec: { width: 4, pieces: ['R', 'N', 'B'] }, archetype: 'heavies-deep' }, black: { spec: { width: 3, pieces: ['N', 'B'] }, archetype: 'heavies-deep' }, seed, turn: 'w', portals: true, hammer: true, ice: true, decks: d, ffish });
const deal = dealWith(decks);
if (!deal.ok) { console.error('deal failed:', deal.error); process.exit(2); }
check(/__deck4_1i_2p_101m_102m$/.test(deal.variantName), `the deal's variant declares the deck (${deal.variantName})`);
check(parseDeckField(deal.fen).present && handOf(deal.fen, 'w').length === 4 && pileOf(deal.fen, 'w').length === 4 && handOf(deal.fen, 'b').length === 2 && pileOf(deal.fen, 'b').length === 0, `the start FEN carries the hands and the piles (${splitFen(deal.fen).pocket} ${(deal.fen.match(/\{[^}]*\}/) || [''])[0]})`);
await engine.loadVariantsIni(catalogIni + '\n' + deal.variantIni);

const mk = async (d0, dl = deal) => {
  const duel = new DuelController({ ffish, engine, variantName: dl.variantName, startFen: dl.fen, files: dl.files, ranks: dl.ranks, director: { seed: dl.directorSeed, onsetPly: 400, rampPlies: 400 }, go: 'depth 4 movetime 200', mateGo: null, evalGate: null, decks0: d0, handSize: HAND_SIZE, hooks: {} });
  await duel.start();
  return duel;
};
// A hand-built order for the blocks that need a portal, a Reveal and an Undo in the opening hand, and the win card at the bottom.
const fixed = { w: { pile: ['portal', 'reveal', 'ice', 'undo', 'ice', 'portal', 'ice', 'win'] }, b: { pile: ['ice', 'portal'] } };
const dealFixed = dealWith(cloneDecks(fixed));
if (!dealFixed.ok) { console.error('fixed deal failed:', dealFixed.error); process.exit(2); }
check(/__deck4_1i_2p_101m_102m_200w$/.test(dealFixed.variantName) && dealFixed.variantName !== deal.variantName, `a deck with the win card is another variant (${dealFixed.variantName})`);
check(handOf(dealFixed.fen, 'w').join(',') === 'portal,reveal,ice,undo' && pileOf(dealFixed.fen, 'w').join(',') === 'ice,portal,ice,win', 'the hand-built decks deal in their own order, the win card last on the pile');
await engine.loadVariantsIni(catalogIni + '\n' + deal.variantIni + '\n' + dealFixed.variantIni);
const plain = (duel) => duel.legalMoves().find((m) => /^[a-l]\d+[a-l]\d+[nbrq]?$/.test(m) && m.slice(0, 2) !== m.slice(2, 4));
// white's turn as a bystander would play it: the forced pass when the enemy's half froze it (the engine then links), else a plain move
const myTurn = async (duel) => (duel.forcedMove() ? duel.playForced('player') : duel.playerMove(plain(duel)));
const castOf = (duel, kind) => { const u = castUci(duel.fen(), kind, 'e5'); const l = u ? u[0] : null; return l ? duel.legalMoves().find((m) => m.startsWith(l + '@')) : null; };
const hands = (duel) => duel.hands();
const piles = (duel) => ({ w: pileOf(duel.fen(), 'w'), b: pileOf(duel.fen(), 'b') });

// ---- the opening hands and a quiet ply
{
  const duel = await mk(decks);
  const h = hands(duel);
  check(duel.hasDeck && h.w.length === 4 && h.b.length === 2, `opening hands: white ${h.w.join(',')} · black ${h.b.join(',')}`);
  check(duel.record.states[0].deck?.w?.hand?.length === 4 && duel.record.states[0].deck.w.pile.length === 4 && duel.record.states[0].deck.w.spent.length === 0, 'the start state carries the hands, the piles and an empty spent list');
  const pile0 = piles(duel).w.length;
  await duel.playerMove(plain(duel));
  await duel.engineMove();
  check(piles(duel).w.length === pile0 && !duel.record.states[duel.record.states.length - 1].drew, 'a quiet ply draws nothing');
  // an ice cast: the card leaves the hand; the engine draws for white inside black's reply
  const ice = castOf(duel, 'ice');
  if (ice) {
    const pileBefore = piles(duel).w.length;
    const top = piles(duel).w[0];
    await duel.playerMove(ice);
    check(hands(duel).w.length === 3 && duel.lastMove.card === 'ice' && duel.lastMove.cast === 'ice', `after the cast the hand is three (${hands(duel).w.join(',')}); the record names the card`);
    const r = await duel.engineMove();
    if (!r.ended) {
      const st = duel.record.states[duel.record.states.length - 1];
      check(hands(duel).w.length === 4 && piles(duel).w.length === pileBefore - 1, `at the hand-over the engine drew one: hand ${hands(duel).w.join(',')}, pile ${piles(duel).w.length}`);
      check(st.drew?.side === 'w' && st.drew.cards.length === 1 && st.drew.cards[0] === top, `the state of record says what was drawn (${JSON.stringify(st.drew)}), the top of the pile`);
      check(st.deck.w.hand.length === 4 && st.deck.w.spent.join(',') === 'ice', `the state's deck: the hand refilled, the ice spent (${st.deck.w.spent})`);
      check(duel.movesSinceBase.length === 4, 'no bare position was needed: the draw is the engine\'s own (four moves since the base)');
      check(duel.legalMoves().length > 0, 'the engine and ffish agree on the refilled position');
    } else check(false, 'the duel ended on the reply');
  } else check(false, 'no ice cast was legal at ply 3');
  duel.destroy();
}

// ---- the one-turn portal cast: no draw on the frozen side's pass or on the link ply; the card is spent at the link
{
  const duel = await mk(cloneDecks(fixed), dealFixed);
  const portal = castOf(duel, 'portal');
  if (portal) {
    await duel.playerMove(portal);
    check(duel.forcedMove() !== null && duel.lastMove.cast === 'half' && duel.lastMove.card === 'portal', 'the enemy is frozen: its one move the pass; the record names the half');
    const pileB = piles(duel).b.length;
    await duel.playForced('engine');
    check(piles(duel).b.length === pileB && duel.mustLink(), 'the frozen side drew nothing; the caster is on the link ply');
    check(hands(duel).w.length === 4 && parseDeckField(duel.fen()).slots.w.s?.open === true, `the half-spent portal is still a card in hand, its slot marked open (${hands(duel).w.join(',')})`);
    check(!duel.canMulligan(), 'no mulligan on the link ply');
    const link = castOf(duel, 'portal');
    await duel.playerMove(link);
    check(hands(duel).w.length === 3 && duel.turnColor() === 'black' && duel.lastMove.cast === 'link', `the link spends the card (${hands(duel).w.join(',')})`);
    const r = await duel.engineMove();
    if (!r.ended) check(hands(duel).w.length === 4, `the engine draws white up at the hand-over (${hands(duel).w.join(',')})`);
  } else check(false, 'no portal cast was legal at ply 1');
  duel.destroy();
}

// ---- the meta cards: played outside the move grammar, the hand rewritten, spent on the record, kept spent through an undo
{
  const duel = await mk(cloneDecks(fixed), dealFixed);
  const had = hands(duel).w.includes('reveal');
  const ok = duel.playMeta('w', 'reveal');
  check(had && ok, `Reveal is held and plays (held ${had}, played ${ok})`);
  if (ok) {
    check(!hands(duel).w.includes('reveal') && duel.record.metaPlays.length === 1 && duel.record.metaPlays[0].kind === 'reveal' && duel.record.metaPlays[0].ply === 0, 'the card is gone from the hand and on metaPlays');
    check(duel.record.states[0].deck.w.hand.includes('reveal') === false && duel.record.states[0].deck.w.spent.join(',') === 'reveal', 'the state of record for the ply follows: spent');
    check(duel.movesSinceBase.length === 0 && duel.baseFen === duel.fen(), 'the rewritten hand is a bare position for the engine');
    check(!duel.playMeta('w', 'reveal') && duel.record.metaPlays.length === 1, 'a card not held cannot be played twice');
  }
  await myTurn(duel);
  await duel.engineMove();
  const st = duel.record.states[duel.record.states.length - 1];
  check(st.drew?.side === 'w' && st.drew.cards.length === 1, `the engine drew white one card at the hand-over for the played Reveal (${JSON.stringify(st.drew)})`);
  await myTurn(duel);
  await duel.engineMove();
  const did = duel.undoToTurn('w');
  check(did && duel.ply === 2, `an undo rewinds a turn (ply ${duel.ply})`);
  if (ok) check(!hands(duel).w.includes('reveal') && duel.record.states[duel.record.states.length - 1].deck.w.spent.includes('reveal'), 'the played card stays spent after the undo');
  check(duel.record.metaPlays.length === (ok ? 1 : 0), 'the meta play is on the record before the fork');
  // …and back to the very state it was played on: the play stays on the record with the card spent (the snapshot moved with it)
  const did0 = duel.undoToTurn('w');
  check(did0 && duel.ply === 0 && duel.record.metaPlays.length === (ok ? 1 : 0) && !hands(duel).w.includes('reveal') && hands(duel).w.length === 3, `an undo to the play's own state keeps the play (ply ${duel.ply}, ${duel.record.metaPlays.length} on record, hand ${hands(duel).w.join(',')})`);
  duel.destroy();
}

// ---- the mulligan: the engine's own move — the hand replaced, the turn spent, the engine moving on
{
  const duel = await mk(cloneDecks(decks));
  check(duel.canMulligan() && duel.legalMoves().includes(MULLIGAN), 'white may redraw on its turn: @@@@ is a legal move');
  const handBefore = hands(duel).w.slice();
  const pileBefore = piles(duel).w.slice();
  const r = await duel.mulligan('player');
  check(r.ok && !r.ended && duel.turnColor() === 'black' && duel.ply === 1, `the redraw spends the turn (ply ${duel.ply}, ${duel.turnColor()} to move)`);
  const st = duel.record.states[duel.record.states.length - 1];
  check(duel.record.moves[0] === MULLIGAN && duel.record.sans[0] === 'redraw' && st.cast === 'mulligan' && st.mulligan?.discarded?.join(',') === handBefore.join(','), `the record reads the engine's redraw (${duel.record.sans[0]}, ${st.cast}: discarded ${st.mulligan?.discarded?.join(',')})`);
  const want = pileBefore.slice(0, HAND_SIZE);
  check(hands(duel).w.slice().sort().join(',') === want.slice().sort().join(',') && st.mulligan.drew.join(',') === hands(duel).w.join(','), `the new hand is the top of the pile (${hands(duel).w.join(',')})`);
  check(handBefore.every((k) => st.deck.w.spent.includes(k)) && piles(duel).w.length === pileBefore.length - HAND_SIZE, 'the old hand is spent, the pile four shorter');
  check(duel.movesSinceBase.length === 1, 'a move of the record, no bare position');
  const r2 = await duel.engineMove();
  check(!r2.ended && duel.ply === 2 && duel.turnColor() === 'white', `the engine replies from the redrawn position (ply ${duel.ply})`);
  check(duel.canMulligan() === duel.legalMoves().includes(MULLIGAN), 'the redraw is offered exactly when the engine lists it');
  const did = duel.undoToTurn('w');
  check(did && duel.ply === 0 && hands(duel).w.slice().sort().join(',') === handBefore.slice().sort().join(',') && piles(duel).w.length === pileBefore.length, `an undo puts the old hand and pile back (ply ${duel.ply}: ${hands(duel).w.join(',')})`);
  duel.destroy();
}

// ---- the win card: the engine digs for it; played, the duel ends
{
  const duel = await mk(cloneDecks(fixed), dealFixed);
  // three mulligans put the win card in hand: portal,reveal,ice,undo | ice,portal,ice,win → after one redraw the hand is ice,portal,ice,win
  const r = await duel.mulligan('player');
  check(r.ok && hands(duel).w.includes('win'), `one redraw draws the win card (${hands(duel).w.join(',')})`);
  await duel.engineMove();
  // the cast is offered out of check alone: a reply that checks the king postpones it a turn
  let win = castOf(duel, 'win');
  for (let i = 0; i < 4 && !win && duel.state === 'playing'; i++) {
    await myTurn(duel);
    if (duel.state === 'playing') await duel.engineMove();
    win = duel.state === 'playing' && !duel.forcedMove() ? castOf(duel, 'win') : null;
  }
  check(!!win && duel.legalMoves().filter((m) => m.startsWith(win[0] + '@')).length === 1 && /^U@/.test(win), `the win card is castable on the king's own square alone (${win}; hand ${hands(duel).w.join(',')}, in check ${duel.board.isCheck()})`);
  if (win) {
    const r2 = await duel.playerMove(win);
    check(r2.ended && duel.state === 'ended' && duel.record.result === '1-0' && duel.record.termination === 'win-card' && duel.lastMove.cast === 'win' && duel.lastMove.card === 'win', `the You Win card ends the duel (${duel.record.result} ${duel.record.termination})`);
    check(parseDeckField(duel.fen()).winner === 'w', 'the FEN names the winner');
  }
  duel.destroy();
}

// ---- the enemy's hand runs dry: a width-3 enemy holds two cards and draws nothing more
{
  const duel = await mk(cloneDecks(decks));
  check(piles(duel).b.length === 0 && hands(duel).b.length === 2, `the enemy's whole deck is its hand (${hands(duel).b.join(',')})`);
  duel.destroy();
}

// ---- no deck: the controller is the old one (no hands, no mulligan, no meta play)
{
  const dealNone = dealWith(null);
  await engine.loadVariantsIni(catalogIni + '\n' + deal.variantIni + '\n' + dealFixed.variantIni + '\n' + dealNone.variantIni);
  const duel = await mk(undefined, dealNone);
  check(!duel.hasDeck && duel.hands() === null && !duel.canMulligan() && !duel.playMeta('w', 'reveal'), 'without a deck nothing draws and nothing plays');
  check(splitFen(duel.fen()).pocket === 'IOOioo', `the old stress-test set is the pocket (${splitFen(duel.fen()).pocket})`);
  await duel.playerMove(plain(duel));
  await duel.engineMove();
  check(!duel.record.states[duel.record.states.length - 1].deck, 'no deck on the record');
  duel.destroy();
}

console.log(`test-deck-duel: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

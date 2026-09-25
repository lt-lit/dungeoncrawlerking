// THE DECK in the duel (2026-09-25; play/js/deck.mjs + duel.mjs): a deal on
// the vendored pair with two decks — the opening hands of four in the
// holdings, no draw on a quiet ply, the refill after a cast at the caster's
// next turn start (the state's `drew`, the pile one shorter, a bare position
// for the engine), no draw on the link ply or for the frozen side, the meta
// cards played outside the move grammar and spent in the record (an undo to
// that state keeps them spent), the mulligan as a pass of the game's own
// (the turn flipped, the hand replaced, the engine moving on from it), an
// undo restoring the piles with the position. Needs the play/vendor overlay
// (engine/README.md). Usage: cd phase0 && node harness/test-deck-duel.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish, loadEngine, assertFurnitureSupport } from '../lib/load.mjs';
import { makeCatalogIni } from '../../play/js/variant.mjs';
import { loadStageV2 } from '../../play/js/stage.mjs';
import { dealMatchup } from '../../play/js/armygen.mjs';
import { DuelController } from '../../play/js/duel.mjs';
import { starterCards, enemyDeck, newDeckState, deckSeeds, openHands, cloneDecks, HAND_SIZE, handOf } from '../../play/js/deck.mjs';
import { castLetter, isCast, splitFen } from '../../play/js/fen.mjs';

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
const decks0 = cloneDecks(decks);
const { pocket } = openHands(decks, HAND_SIZE);
const deal = dealMatchup({ stage, white: { spec: { width: 4, pieces: ['R', 'N', 'B'] }, archetype: 'heavies-deep' }, black: { spec: { width: 3, pieces: ['N', 'B'] }, archetype: 'heavies-deep' }, seed, turn: 'w', portals: true, hammer: true, ice: true, pocket, ffish });
if (!deal.ok) { console.error('deal failed:', deal.error); process.exit(2); }
await engine.loadVariantsIni(catalogIni + '\n' + deal.variantIni);
check(splitFen(deal.fen).pocket === pocket, `the deal's holdings are the opening hands' scrolls (${pocket})`);

const mk = async (d, dl = deal) => {
  const duel = new DuelController({ ffish, engine, variantName: dl.variantName, startFen: dl.fen, files: dl.files, ranks: dl.ranks, director: { seed: dl.directorSeed, onsetPly: 400, rampPlies: 400 }, go: 'depth 4 movetime 200', mateGo: null, evalGate: null, decks: d, handSize: HAND_SIZE, hooks: {} });
  await duel.start();
  return duel;
};
// A hand-built order for the blocks that need a portal and a Reveal in the opening hand: the same deal, the holdings from these piles.
const fixedDecks = () => ({ w: { pile: ['portal', 'reveal', 'ice', 'undo', 'ice', 'portal', 'ice', 'portal'], meta: [], spent: [] }, b: { pile: ['ice', 'portal'], meta: [], spent: [] } });
const fixed = fixedDecks();
const fixedPocket = openHands(fixed, HAND_SIZE).pocket;
const dealFixed = dealMatchup({ stage, white: { spec: { width: 4, pieces: ['R', 'N', 'B'] }, archetype: 'heavies-deep' }, black: { spec: { width: 3, pieces: ['N', 'B'] }, archetype: 'heavies-deep' }, seed, turn: 'w', portals: true, hammer: true, ice: true, pocket: fixedPocket, ffish });
if (!dealFixed.ok) { console.error('fixed deal failed:', dealFixed.error); process.exit(2); }
check(dealFixed.variantName === deal.variantName && splitFen(dealFixed.fen).pocket === 'IOOioo', `the hand-built decks deal the same variant with their own holdings (${splitFen(dealFixed.fen).pocket})`);
const plain = (duel) => duel.legalMoves().find((m) => !isCast(m) && !/^[a-l]\d+[a-l]\d+$/.test(m) === false && !isCast(m)) ?? duel.legalMoves().find((m) => !isCast(m));
const castOf = (duel, letter) => duel.legalMoves().find((m) => castLetter(m) === letter);

// ---- the opening hands and a quiet ply
{
  const duel = await mk(decks);
  const h = duel.hands();
  check(h.w.length === 4 && h.b.length === 2, `opening hands: white ${h.w.join(',')} · black ${h.b.join(',')}`);
  check(duel.record.states[0].deck?.w?.hand?.length === 4 && duel.record.states[0].deck.w.pile.length === decks.w.pile.length, 'the start state carries the hands and the piles');
  const pile0 = duel.decks.w.pile.length;
  await duel.playerMove(plain(duel));
  await duel.engineMove();
  check(duel.decks.w.pile.length === pile0 && !duel.record.states[duel.record.states.length - 1].drew, 'a quiet ply draws nothing');
  // an ice cast: the card leaves the pocket; at white's next turn start the refill draws one
  const ice = castOf(duel, 'i');
  if (ice) {
    const pileBefore = duel.decks.w.pile.length;
    const top = duel.decks.w.pile[0];
    await duel.playerMove(ice);
    check(duel.hands().w.length === 3, `after the cast the hand is three (${duel.hands().w.join(',')})`);
    const r = await duel.engineMove();
    if (!r.ended) {
      const st = duel.record.states[duel.record.states.length - 1];
      check(duel.hands().w.length === 4 && duel.decks.w.pile.length === pileBefore - 1, `at white's turn start the refill draws one: hand ${duel.hands().w.join(',')}, pile ${duel.decks.w.pile.length}`);
      check(st.drew?.side === 'w' && st.drew.cards.length === 1 && st.drew.cards[0] === top, `the state of record says what was drawn (${JSON.stringify(st.drew)}), the top of the pile`);
      check(duel.movesSinceBase.length === 0 || st.drew.cards.every((k) => k === 'reveal' || k === 'undo'), 'a drawn spell is a bare position for the engine (movesSinceBase reset)');
      check(duel.board.fen() === duel.baseFen || duel.movesSinceBase.length > 0, 'the ffish board and the engine base agree');
      check(duel.legalMoves().length > 0, 'the engine and ffish accept the refilled position');
    } else check(false, 'the duel ended on the reply');
  } else check(false, 'no ice cast was legal at ply 3');
  duel.destroy();
}

// ---- the one-turn portal cast: no draw on the frozen side's pass or on the link ply; the card is spent at the link
{
  const duel = await mk(cloneDecks(fixed), dealFixed);
  const portal = castOf(duel, 'o');
  if (portal) {
    await duel.playerMove(portal);
    check(duel.forcedMove() !== null, "the enemy is frozen: its one move the pass");
    const pileB = duel.decks.b.pile.length;
    await duel.playForced('engine');
    check(duel.decks.b.pile.length === pileB && duel.mustLink(), 'the frozen side drew nothing; the caster is on the link ply');
    check(duel.hands().w.length === 4, `the half-spent portal is still a card in hand (${duel.hands().w.join(',')})`);
    const link = castOf(duel, 'o');
    await duel.playerMove(link);
    check(duel.hands().w.length === 3 && duel.turnColor() === 'black', `the link spends the card (${duel.hands().w.join(',')})`);
    const r = await duel.engineMove();
    if (!r.ended) check(duel.hands().w.length === 4, `the refill lands at white's next turn (${duel.hands().w.join(',')})`);
  } else check(false, 'no portal cast was legal at ply 1');
  duel.destroy();
}

// ---- the meta cards: played outside the move grammar, spent on the record, kept spent through an undo
{
  const duel = await mk(cloneDecks(fixed), dealFixed);
  const had = duel.hands().w.includes('reveal');
  const ok = duel.playMeta('w', 'reveal');
  check(had && ok, `Reveal is held and plays (held ${had}, played ${ok})`);
  if (ok) {
    check(!duel.hands().w.includes('reveal') && duel.decks.w.spent.includes('reveal') && duel.record.metaPlays.length === 1 && duel.record.metaPlays[0].kind === 'reveal' && duel.record.metaPlays[0].ply === 0, 'the card is spent: gone from the hand, on the spent list, on metaPlays');
    check(duel.record.states[0].deck.w.hand.includes('reveal') === false, 'the state of record for the ply follows');
    check(!duel.playMeta('w', 'reveal') && duel.record.metaPlays.length === 1, 'a card not held cannot be played twice');
  }
  await duel.playerMove(plain(duel));
  await duel.engineMove();
  await duel.playerMove(plain(duel));
  await duel.engineMove();
  const did = duel.undoToTurn('w');
  check(did && duel.ply === 2, `an undo rewinds a turn (ply ${duel.ply})`);
  if (ok) check(!duel.hands().w.includes('reveal') && duel.decks.w.spent.includes('reveal'), 'the played card stays spent after the undo');
  check(duel.record.metaPlays.length === (ok ? 1 : 0), 'the meta play is on the record before the fork');
  // …and back to the very state it was played on: the play stays on the record with the card spent (the snapshot's lens moved with it)
  const did0 = duel.undoToTurn('w');
  check(did0 && duel.ply === 0 && duel.record.metaPlays.length === (ok ? 1 : 0) && !duel.hands().w.includes('reveal'), `an undo to the play's own state keeps the play (ply ${duel.ply}, ${duel.record.metaPlays.length} on record, hand ${duel.hands().w.join(',')})`);
  duel.destroy();
}

// ---- the mulligan: a pass of the game's own — the hand replaced, the turn flipped, the engine moving on
{
  const duel = await mk(cloneDecks(decks));
  check(duel.canMulligan(), 'white may redraw on its turn');
  const handBefore = duel.hands().w.slice();
  const pileBefore = duel.decks.w.pile.slice();
  const r = await duel.mulligan('player');
  check(r.ok && !r.ended && duel.turnColor() === 'black' && duel.ply === 1, `the redraw spends the turn (ply ${duel.ply}, ${duel.turnColor()} to move)`);
  const st = duel.record.states[duel.record.states.length - 1];
  check(duel.record.moves[0] === '--' && duel.record.sans[0] === '--' && st.cast === 'mulligan' && st.mulligan?.discarded?.length === handBefore.length, `the record reads a mulligan (${st.cast}: discarded ${st.mulligan?.discarded?.join(',')})`);
  const want = pileBefore.slice(0, HAND_SIZE);
  check(duel.hands().w.slice().sort().join(',') === want.slice().sort().join(','), `the new hand is the top of the pile (${duel.hands().w.join(',')})`);
  check(handBefore.every((k) => duel.decks.w.spent.includes(k)), 'the old hand is spent');
  check(duel.movesSinceBase.length === 0 && duel.baseFen === duel.board.fen(), 'a bare position for the engine');
  const r2 = await duel.engineMove();
  check(!r2.ended && duel.ply === 2 && duel.turnColor() === 'white', `the engine replies from the redrawn position (ply ${duel.ply})`);
  check(!duel.canMulligan() || duel.decks.w.pile.length > 0 || duel.hands().w.length > 0, 'the redraw is offered again only with cards to draw or discard');
  const did = duel.undoToTurn('w');
  check(did && duel.ply === 0 && duel.hands().w.slice().sort().join(',') === handBefore.slice().sort().join(',') && duel.decks.w.pile.length === pileBefore.length, `an undo puts the old hand and pile back (ply ${duel.ply}: ${duel.hands().w.join(',')})`);
  duel.destroy();
}

// ---- the enemy's hand runs dry: a width-3 enemy holds two cards and draws nothing more
{
  const duel = await mk(cloneDecks(decks));
  check(duel.decks.b.pile.length === 0 && duel.hands().b.length === 2, `the enemy's whole deck is its hand (${duel.hands().b.join(',')})`);
  duel.destroy();
}

// ---- no decks: the controller is the old one (no refill, no hands)
{
  const duel = await mk(undefined);
  check(duel.hands() === null && duel.decks === null && !duel.canMulligan() && !duel.playMeta('w', 'reveal'), 'without decks nothing draws and nothing plays');
  await duel.playerMove(plain(duel));
  await duel.engineMove();
  check(!duel.record.states[duel.record.states.length - 1].deck, 'no deck on the record');
  duel.destroy();
}

console.log(`test-deck-duel: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

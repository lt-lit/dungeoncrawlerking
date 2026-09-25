// DECK STRESS (2026-09-25; brief §4.10 "the instruments"): engine against
// engine on the canon DuelController with two decks, gods off by default —
// the deck read without a phone. Per card kind: how often it is cast, at
// what ply, by the side ahead or behind (the enemy's own score at the cast,
// mover POV), how many were dead in hand at the end; per game the plies,
// the result, the casts per 100 plies, the redraws none (an engine never
// mulligans). No card is ever valued by a number here either: the engine
// casts when the cast is its best move, and this harness counts.
//
// Usage: cd phase0 && node harness/deck-stress.mjs [--stage s59-hall-corner]
//   [--games 4] [--seed 1] [--go "depth 8 movetime 300"] [--plies 200]
//   [--deck adept | ice,portal,…] [--enemy width | adept] [--width 3]
//   [--gods on] [--out results/deck-stress.jsonl]
// Needs the play/vendor overlay in node_modules (engine/README.md).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish, loadEngine, assertFurnitureSupport } from '../lib/load.mjs';
import { makeCatalogIni } from '../../play/js/variant.mjs';
import { loadStageV2 } from '../../play/js/stage.mjs';
import { dealMatchup } from '../../play/js/armygen.mjs';
import { DuelController } from '../../play/js/duel.mjs';
import { CARDS, SPELL_KINDS, starterCards, enemyDeck, enemyCards, newDeckState, deckSeeds, openHands, cloneDecks, HAND_SIZE, parseDeckParam } from '../../play/js/deck.mjs';
import { GOD_PRESETS } from '../../play/js/director.mjs';
import { childSeed } from '../../play/js/prng.mjs';
import { castLetter } from '../../play/js/fen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const STAGE = arg('stage', 's59-hall-corner');
const GAMES = parseInt(arg('games', '4'), 10);
const SEED = parseInt(arg('seed', '1'), 10);
const GO = arg('go', 'depth 8 movetime 300');
const PLIES = parseInt(arg('plies', '200'), 10);
const DECK = arg('deck', 'adept');
const ENEMY = arg('enemy', 'width');
const WIDTH = parseInt(arg('width', '3'), 10);
const GODS = arg('gods', 'off');
const OUT = arg('out', null);

const ffish = await loadFfish();
const engine = await loadEngine();
engine.setoption('Use NNUE', 'false');
const catalogIni = makeCatalogIni();
ffish.loadVariantConfig(catalogIni);
await engine.loadVariantsIni(catalogIni);
try { assertFurnitureSupport(ffish); } catch (e) { console.error(e.message); process.exit(2); }
const stage = loadStageV2(JSON.parse(fs.readFileSync(path.join(ROOT, `play/stages/${STAGE}.json`), 'utf8')));
const spec = parseDeckParam(DECK);
if (!spec || spec.off) { console.error(`--deck ${DECK}: not a starter or a list`); process.exit(2); }
const letterKind = Object.fromEntries(SPELL_KINDS.map((k) => [CARDS[k].letter, k]));

const lines = [];
const tally = { games: 0, plies: 0, casts: { w: {}, b: {} }, castable: { w: 0, b: 0 }, turns: { w: 0, b: 0 }, results: {}, deadInHand: { w: {}, b: {} }, bound: 0, searched: 0 };
for (const k of SPELL_KINDS) { tally.casts.w[k] = []; tally.casts.b[k] = []; tally.deadInHand.w[k] = 0; tally.deadInHand.b[k] = 0; }
const mt = GO.match(/movetime (\d+)/);
const boundMs = mt ? parseInt(mt[1], 10) : Infinity;

for (let g = 0; g < GAMES; g++) {
  const seed = childSeed(SEED, `game${g}`);
  const seeds = deckSeeds(seed);
  const enemyList = ENEMY === 'width' ? enemyDeck(WIDTH, seed) : enemyCards(parseDeckParam(ENEMY)?.cards ?? starterCards(ENEMY) ?? []);
  const decks = { w: newDeckState(spec.cards, seeds.w, { fixed: !!spec.fixed }), b: newDeckState(enemyList, seeds.b) };
  const decks0 = cloneDecks(decks);
  const { pocket } = openHands(decks, HAND_SIZE);
  const all = [...decks0.w.pile, ...decks0.b.pile];
  const deal = dealMatchup({ stage, white: { spec: { width: 4, pieces: ['R', 'N', 'B'] }, archetype: 'heavies-deep' }, black: { spec: { width: WIDTH, budget: 12 }, archetype: 'heavies-deep' }, seed, turn: 'w', portals: all.includes('portal'), hammer: true, ice: all.includes('ice'), pocket, ffish });
  if (!deal.ok) { console.error(`game ${g}: deal failed: ${deal.error}`); continue; }
  await engine.loadVariantsIni(catalogIni + '\n' + deal.variantIni);
  const god = GODS === 'off' ? { seed: deal.directorSeed, onsetPly: 100000, rampPlies: 100000 } : { ...GOD_PRESETS[GODS] ?? GOD_PRESETS.restless, seed: deal.directorSeed };
  const duel = new DuelController({ ffish, engine, variantName: deal.variantName, startFen: deal.fen, files: deal.files, ranks: deal.ranks, director: god, go: GO, mateGo: null, evalGate: null, decks, handSize: HAND_SIZE, hooks: {} });
  await duel.start();
  const casts = [];
  while (duel.state === 'playing' && duel.ply < PLIES) {
    const side = duel.board.turn() ? 'w' : 'b';
    const forced = duel.forcedMove();
    if (forced) { await duel.playForced('engine'); continue; }
    const hand = duel.hands()[side];
    const spellsInHand = hand.filter((k) => SPELL_KINDS.includes(k)).length;
    tally.turns[side]++;
    if (spellsInHand) tally.castable[side]++;
    const link = duel.mustLink();
    const r = await duel.engineMove();
    if (r.ended) break;
    const e = duel.record.engine[duel.record.engine.length - 1];
    tally.searched++;
    if (e && e.ms >= boundMs) tally.bound++;
    const uci = duel.record.moves[duel.record.moves.length - 1];
    const letter = castLetter(uci);
    if (letter && !link) { // the half or the ice: one card; the link is the same card
      const kind = letterKind[letter];
      const score = e?.score ? (e.score.type === 'mate' ? (e.score.value > 0 ? 9999 : -9999) : e.score.value) : null;
      casts.push({ side, kind, ply: duel.ply, score, depth: e?.depth ?? null });
      tally.casts[side][kind].push({ ply: duel.ply, score, depth: e?.depth ?? null, game: g });
    }
  }
  const r = duel.record;
  const hands = duel.hands() ?? { w: [], b: [] };
  for (const side of ['w', 'b']) for (const k of hands[side]) if (SPELL_KINDS.includes(k)) tally.deadInHand[side][k]++;
  const line = { game: g, seed, plies: duel.ply, result: r.result, termination: r.termination, state: duel.state, casts, dead: { w: hands.w, b: hands.b }, piles: { w: duel.decks.w.pile, b: duel.decks.b.pile }, decks0: { w: decks0.w.pile, b: decks0.b.pile } };
  lines.push(line);
  tally.games++;
  tally.plies += duel.ply;
  tally.results[`${r.result ?? 'unfinished'}:${r.termination ?? (duel.state === 'playing' ? 'ply-cap' : duel.state)}`] = (tally.results[`${r.result ?? 'unfinished'}:${r.termination ?? (duel.state === 'playing' ? 'ply-cap' : duel.state)}`] ?? 0) + 1;
  console.error(`game ${g}: ${duel.ply} plies, ${r.result ?? '*'} ${r.termination ?? duel.state}, casts w ${casts.filter((c) => c.side === 'w').map((c) => `${c.kind}@${c.ply}`).join(' ') || '-'} · b ${casts.filter((c) => c.side === 'b').map((c) => `${c.kind}@${c.ply}`).join(' ') || '-'}`);
  duel.destroy();
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const med = (xs) => { if (!xs.length) return '-'; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log(`deck-stress: ${tally.games} games on ${STAGE}, deck ${DECK} vs enemy ${ENEMY}${ENEMY === 'width' ? ` (width ${WIDTH})` : ''}, go "${GO}", gods ${GODS}: ${tally.plies} plies, ${tally.bound}/${tally.searched} searches at the time bound`);
console.log(`results: ${Object.entries(tally.results).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
for (const side of ['w', 'b']) {
  const n = SPELL_KINDS.reduce((a, k) => a + tally.casts[side][k].length, 0);
  console.log(`${side === 'w' ? 'white (the deck)' : 'black (the enemy)'}: ${n} casts in ${tally.turns[side]} turns, ${tally.castable[side]} with a spell in hand → ${pct(n, tally.castable[side])} of castable turns; ${n && tally.plies ? ((100 * n) / tally.plies).toFixed(1) : '0'} casts per 100 plies`);
  for (const k of SPELL_KINDS) {
    const cs = tally.casts[side][k];
    const behind = cs.filter((c) => c.score !== null && c.score < 0).length;
    console.log(`  ${CARDS[k].name.padEnd(7)} cast ×${cs.length} · median ply ${med(cs.map((c) => c.ply))} · by the side behind ${cs.length ? pct(behind, cs.length) : '-'} · dead in hand at the end ${tally.deadInHand[side][k]}`);
  }
}
if (OUT) { fs.mkdirSync(path.dirname(path.join(ROOT, 'phase0', OUT)), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'phase0', OUT), lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); console.log(`wrote ${OUT}`); }
process.exit(0);

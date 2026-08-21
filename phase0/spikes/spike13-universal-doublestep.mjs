// Spike 13 — universal pawn double-step (slice-refresh decision 1).
//
// Molding means pawns start on arbitrary ranks, and the designer wants the
// double-step available "regardless of starting position". FSF has no
// first-move tracking for pawns — double-step is granted by REGION
// membership — so the question splits:
//   (a) Does this build accept a MULTI-RANK doubleStepRegion (space-
//       separated rank tokens), or does it silently ignore it (the rule-3
//       trap: unknown/malformed keys no-op)?
//   (b) Semantics check: region membership means the double-step is
//       available EVERY time a pawn sits in the region — not only on its
//       first move. Characterize, don't assume.
//   (c) Walls must block the double-step (both the jumped square and the
//       landing square).
//   (d) En passant must work against a non-native-rank double-step.
//   (e) The engine's own ini parser must accept the config (it is a
//       separate reader from ffish's) and search under it.
//
// Deterministic; exit 0 = all assertions hold.
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni } from '../lib/variant.mjs';

const ffish = await loadFfish();
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

const legal = (variant, fen) => {
  const b = new ffish.Board(variant, fen);
  const moves = b.legalMoves().trim().split(/\s+/).filter(Boolean);
  b.delete();
  return moves;
};

// 5x8 board. Multi-rank region: every rank a pawn can legally occupy
// (2..ranks-1 for white, ranks-1..2 for black — promotion rank excluded).
const RANKS = 8;
const wRegion = Array.from({ length: RANKS - 2 }, (_, i) => `*${i + 2}`).join(' ');
const bRegion = Array.from({ length: RANKS - 2 }, (_, i) => `*${RANKS - 1 - i}`).join(' ');
const iniUniversal = makeDuelVariantIni({
  name: 'ds_universal',
  files: 5,
  ranks: RANKS,
  extra: { doubleStepRegionWhite: wRegion, doubleStepRegionBlack: bRegion },
});
const iniBaseline = makeDuelVariantIni({ name: 'ds_baseline', files: 5, ranks: RANKS });
ffish.loadVariantConfig(iniUniversal + '\n' + iniBaseline);

// Fixtures keep both sides armed (rule 4b: bare-king positions are decided
// at load under the extinction config).
const pawnC3 = '2k2/p4/5/5/5/2P2/5/2K2 w - - 0 1'; // white pawn c3, off the native rank
const wallC4 = '2k2/p4/5/5/2*2/2P2/5/2K2 w - - 0 1'; // wall directly in front
const wallC5 = '2k2/p4/5/2*2/5/2P2/5/2K2 w - - 0 1'; // wall on the landing square
const epSetup = '2k2/p4/5/1p3/5/2P2/5/2K2 w - - 0 1'; // black pawn b5 waits

// (a) multi-rank region accepted: pawn on rank 3 gets the double-step.
check('c3 pawn has c3c5 under multi-rank region', legal('ds_universal', pawnC3).includes('c3c5'));
check('c3 pawn has NO c3c5 under baseline *2 region (control)', !legal('ds_baseline', pawnC3).includes('c3c5'));

// (b) semantics: available every visit to the region, not first-move-only.
{
  const b = new ffish.Board('ds_universal', '2k2/p4/5/5/5/5/2P2/2K2 w - - 0 1'); // pawn c2
  b.push('c2c3'); // pawn has now MOVED
  b.push('a7a6');
  const moves = b.legalMoves().trim().split(/\s+/).filter(Boolean);
  b.delete();
  check('a pawn that already moved still double-steps from c3', moves.includes('c3c5'), 'region grants it on EVERY move in-region — a rules change beyond "keep your first move", documented not assumed');
}

// (c) walls block it — jumped square and landing square.
check('wall on c4 blocks c3c4 and c3c5', !legal('ds_universal', wallC4).includes('c3c5') && !legal('ds_universal', wallC4).includes('c3c4'));
check('wall on c5 blocks c3c5 but not c3c4', !legal('ds_universal', wallC5).includes('c3c5') && legal('ds_universal', wallC5).includes('c3c4'));

// (d) en passant against a non-native double-step.
{
  const b = new ffish.Board('ds_universal', epSetup);
  b.push('c3c5');
  const fenAfter = b.fen();
  const replies = b.legalMoves().trim().split(/\s+/).filter(Boolean);
  b.delete();
  check('ep square recorded after c3c5', fenAfter.includes(' c4 '), fenAfter);
  check('black b5 pawn may capture en passant (b5c4)', replies.includes('b5c4'));
}

// (e) the ENGINE's ini parser accepts it and searches.
const engine = await loadEngine();
await engine.uci();
engine.setoption('Use NNUE', 'false'); // rule 1
engine.setoption('Threads', '1');
await engine.loadVariantsIni(iniUniversal + '\n' + iniBaseline);
engine.setoption('UCI_Variant', 'ds_universal');
await engine.isready();
engine.position({ fen: pawnC3 });
const res = await engine.go('depth 6 movetime 500', { timeout: 8000 });
check('engine searches the universal-region variant and returns a move', !!res.bestmove && res.bestmove !== '(none)', `bestmove ${res.bestmove}`);
// Engine legality view must agree with ffish on the new move: c3c5 playable.
engine.position({ fen: pawnC3, moves: ['c3c5'] });
const res2 = await engine.go('depth 4 movetime 300', { timeout: 8000 });
check('engine accepts c3c5 as a played move', !!res2.bestmove && res2.bestmove !== '(none)', `reply ${res2.bestmove}`);

console.log(failures === 0 ? '\nSPIKE 13 PASS' : `\nSPIKE 13 FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

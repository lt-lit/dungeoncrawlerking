// Self-test: generate a duel variant + FEN, load into both ffish and engine,
// cross-check legality (ffish legalMoves count vs engine perft 1), play a move.
import { loadFfish, loadEngine } from './load.mjs';
import { makeDuelVariantIni, buildDuelBoard, boardToFen } from './variant.mjs';
import { setSquare, getSquare, splitFen, parseBoard, serializeBoard } from './fen.mjs';

// FEN round-trip test (incl. both terrain glyphs — '^' furniture, §4.6)
const fens = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'n*nnnn*k/**pppp**/pp4pp/8/8/PP4PP/**PPPP**/K*NNNN*N w - - 0 1',
  'rnbqkbnr4/pppppppp4/12/12/12/12/PPPPPPPP4/RNBQKBNR4/12/12 w kq - 0 1',
  '2k2r/6/2*3/2^3/6/2K2R w - - 0 1',
];
for (const fen of fens) {
  const f = splitFen(fen);
  const rt = serializeBoard(parseBoard(f.board));
  if (rt !== f.board) throw new Error(`round-trip failed:\n  ${f.board}\n  ${rt}`);
}
console.log('fen round-trip: OK');

const wallFen = setSquare(fens[0], 'e4', '*');
if (getSquare(wallFen, 'e4') !== '*') throw new Error('setSquare failed');
console.log('setSquare wall: OK →', wallFen.split(' ')[0]);

const crateFen = setSquare(fens[0], 'e4', '^');
if (getSquare(crateFen, 'e4') !== '^') throw new Error('setSquare furniture failed');
console.log('setSquare furniture: OK →', crateFen.split(' ')[0]);

// Duel generation test: 9x8 arena, walls, 4-wide white patch, 5-wide black patch
const spec = {
  files: 9,
  ranks: 8,
  walls: ['e4', 'e5', 'a3'],
  white: { backRank: ['R', 'N', 'K', 'B'], backRankStart: 2, row: 0 },
  black: { backRank: ['r', 'n', 'k', 'b', 'q'], backRankStart: 3, row: 7 },
};
const board = buildDuelBoard(spec);
const startFen = boardToFen(board);
const ini = makeDuelVariantIni({ name: 'duel', files: 9, ranks: 8 });
console.log('generated ini:\n' + ini);
console.log('generated fen:', startFen);

const ffish = await loadFfish();
ffish.loadVariantConfig(ini);
const valid = ffish.validateFen(startFen, 'duel');
console.log('ffish validateFen:', valid);
const b = new ffish.Board('duel', startFen);
const ffishMoves = b.legalMoves().trim().split(/\s+/).filter(Boolean);
console.log('ffish legal moves:', ffishMoves.length);
b.delete();

const engine = await loadEngine();
await engine.uci();
engine.setoption('Use NNUE', 'false');
await engine.loadVariantsIni(ini);
engine.setoption('UCI_Variant', 'duel');
engine.position({ fen: startFen });
const perftLines = await engine.sendUntil('go perft 1', (l) => l.startsWith('Nodes searched'));
const perft1 = parseInt(perftLines[perftLines.length - 1].split(':')[1], 10);
console.log('engine perft 1:', perft1);
if (perft1 !== ffishMoves.length) throw new Error(`MISMATCH: ffish ${ffishMoves.length} vs engine ${perft1}`);
console.log('legality cross-check: OK');

engine.position({ fen: startFen });
const res = await engine.go('depth 8');
console.log('engine bestmove:', res.bestmove, 'score:', JSON.stringify(engine.lastScore(res)));
if (!ffishMoves.includes(res.bestmove)) throw new Error(`engine bestmove ${res.bestmove} not in ffish legal moves`);
console.log('bestmove legality: OK');
console.log('\nALL SELF-TESTS PASSED');
process.exit(0);

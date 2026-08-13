// Spike 6 — capturesToHand per-color? (§9.6). Expected answer: variant-wide
// only — per-color spellings don't exist. Confirms the ground truth, probes
// what happens when a per-color spelling is fed to the config parser (error
// vs silent ignore), and validates the symmetric "Necromancer" boss block.
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni, buildDuelBoard, boardToFen } from '../lib/variant.mjs';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${detail ? `  [${detail}]` : ''}`);
  cond ? pass++ : fail++;
};

const ffish = await loadFfish();
const engine = await loadEngine();
await engine.uci();
engine.setoption('Use NNUE', 'false');

const legal = (b) => b.legalMoves().trim().split(/\s+/).filter(Boolean);

// A small arena both configs share: 6x7, minor pieces
const mkBoard = () =>
  buildDuelBoard({
    files: 6, ranks: 7, walls: [],
    white: { backRank: ['R', 'K', 'N'], backRankStart: 1, row: 0 },
    black: { backRank: ['r', 'k', 'n'].map((c) => c.toUpperCase()), backRankStart: 1, row: 6 },
  });

// ---- 1. Ground truth: per-color spellings do not exist ---------------------
console.log('--- 1. per-color spelling probes ---');
{
  // Necromancer baseline: variant-wide capturesToHand works
  const necro = makeDuelVariantIni({
    name: 'necro', files: 6, ranks: 7,
    extra: { pieceDrops: 'true', capturesToHand: 'true' },
  });
  // Per-color spellings (both plausible orders) — if accepted they'd make
  // white-only capture-to-hand; expectation is they are NOT valid options
  const probeA = makeDuelVariantIni({
    name: 'probea', files: 6, ranks: 7,
    extra: { pieceDrops: 'true', capturesToHandWhite: 'true' },
  });
  const probeB = makeDuelVariantIni({
    name: 'probeb', files: 6, ranks: 7,
    extra: { pieceDrops: 'true', whiteCapturesToHand: 'true' },
  });
  ffish.loadVariantConfig(necro);
  ffish.loadVariantConfig(probeA);
  ffish.loadVariantConfig(probeB);
  await engine.loadVariantsIni([necro, probeA, probeB].join('\n'));

  // Behavioral test beats parser chatter: make a white capture in each
  // variant and inspect white's pocket afterwards.
  const capSetup = (variant) => {
    // place a black pawn where white rook can take it: Rb1xb6? use simple:
    const fen = '1rkn2/1ppp2/6/6/1p4/1PPP2/1RKN2 w - - 0 1'; // black pawn b3 capturable by... use rook b1? blocked by pawn b2. Use pawn capture: white pawn c2 takes b3.
    const b = new ffish.Board(variant, fen);
    const mv = legal(b).find((m) => m === 'c2b3');
    if (!mv) {
      b.delete();
      return { err: 'setup capture unavailable' };
    }
    b.push(mv);
    const pocket = b.pocket(true); // true = white
    b.delete();
    return { pocket };
  };
  const necroRes = capSetup('necro');
  check('variant-wide capturesToHand: white capture fills white pocket', necroRes.pocket === 'p', `pocket='${necroRes.pocket}' ${necroRes.err ?? ''}`);
  const aRes = capSetup('probea');
  const bRes = capSetup('probeb');
  check('capturesToHandWhite: NOT honored (pocket stays empty => option does not exist)', aRes.pocket === '', `pocket='${aRes.pocket}' ${aRes.err ?? ''}`);
  check('whiteCapturesToHand: NOT honored (pocket stays empty => option does not exist)', bRes.pocket === '', `pocket='${bRes.pocket}' ${bRes.err ?? ''}`);
  console.log('INFO - per-color spellings are silently IGNORED by the config parser (no hard error): treat unknown-key typos as a real footgun; validate config keys against the documented option list at generation time.');
}

// ---- 2. Necromancer block: full behavioral validation ----------------------
console.log('\n--- 2. symmetric Necromancer modifier ---');
{
  const b = new ffish.Board('necro', boardToFen(mkBoard()));
  // play a scripted capture exchange; verify both pockets fill and drops appear
  const fen = '1rkn2/1ppp2/6/2p3/3P2/1PP3/1RKN2 w - - 0 1';
  const b2 = new ffish.Board('necro', fen);
  const cap = legal(b2).find((m) => m === 'd3c4');
  check('capture available in necro arena', !!cap);
  if (cap) {
    b2.push(cap);
    check('white pocket holds captured pawn', b2.pocket(true) === 'p', `'${b2.pocket(true)}'`);
    const recap = legal(b2).find((m) => m === 'b5c4');
    if (recap) {
      b2.push(recap);
      check('black pocket holds recaptured pawn (symmetric)', b2.pocket(false) === 'p', `'${b2.pocket(false)}'`);
      const drops = legal(b2).filter((m) => m.includes('@'));
      check('white drop moves now available (P@)', drops.length > 0 && drops.every((m) => m.startsWith('P@')), `${drops.length} drops e.g. ${drops.slice(0, 3).join(',')}`);
      // pocket FEN round-trips
      const f = b2.fen();
      check('pocket appears in FEN [...]', /\[\w+\]/.test(f), f);
    }
  }
  b2.delete();
  b.delete();

  // engine plays under necro rules
  engine.setoption('UCI_Variant', 'necro');
  engine.position({ fen: '1rkn2/1ppp2/6/2p3/3P2/1PP3/1RKN2 w - - 0 1' });
  const res = await engine.go('depth 8');
  const bv = new ffish.Board('necro', '1rkn2/1ppp2/6/2p3/3P2/1PP3/1RKN2 w - - 0 1');
  check('engine plays legally under Necromancer rules', legal(bv).includes(res.bestmove), `best=${res.bestmove} score=${JSON.stringify(engine.lastScore(res))}`);
  bv.delete();

  // perft cross-check WITH pockets in play
  const pocketFen = '1rkn2/1ppp2/6/2p3/6/1PP3/1RKN2[Pp] w - - 0 1';
  const bp = new ffish.Board('necro', pocketFen);
  engine.position({ fen: pocketFen });
  const lines = await engine.sendUntil('go perft 1', (l) => l.startsWith('Nodes searched'));
  const p1 = parseInt(lines[lines.length - 1].split(':')[1], 10);
  check('perft1 == ffish with pockets (drops counted)', p1 === bp.numberLegalMoves(), `${p1} vs ${bp.numberLegalMoves()}`);
  const dropCount = legal(bp).filter((m) => m.includes('@')).length;
  console.log(`INFO - pocket position has ${dropCount} drop moves of ${bp.numberLegalMoves()} total`);
  bp.delete();
}

console.log(`\nSPIKE 6: ${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECKS FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);

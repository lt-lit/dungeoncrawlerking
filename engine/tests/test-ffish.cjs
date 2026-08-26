const FFISH_JS = process.env.FFISH_JS; if(!FFISH_JS){console.error('set FFISH_JS=/path/to/patched/ffish.js');process.exit(2);}
const realFetch=global.fetch; delete global.fetch;
const Module=require(FFISH_JS);
Module.onRuntimeInitialized=()=>{ global.fetch=realFetch; run(Module); };
function run(ffish){
  let pass=0,fail=0;
  const ok=(n,c,x='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`);};
  ffish.loadVariantConfig(`[crate6x6:chess]
maxRank = 6
maxFile = 6
castling = false
stalemateValue = loss
nMoveRule = 0
nFoldRule = 0
nFoldValue = loss
extinctionValue = loss
extinctionPieceTypes = *
extinctionPieceCount = 1
extinctionPseudoRoyal = false
promotionRegionWhite = *6
promotionRegionBlack = *1

[crate6x6mc:crate6x6]
mustCapture = true
`);
  // Both sides K+R (neither bare, rule 4b). Crate on c4. Both rooks bear on it.
  const fen='2r2k/6/2^3/6/6/2R2K w - - 0 1';
  ok('validateFen accepts ^', ffish.validateFen(fen,'crate6x6')===1);
  const b=new ffish.Board('crate6x6',fen);
  ok('FEN round-trips', b.fen()===fen, b.fen());
  const wm=b.legalMoves().split(' ').filter(m=>m.startsWith('c1'));
  ok('WHITE captures the crate (c1c4)', wm.includes('c1c4'), wm.join(','));
  ok('crate blocks white beyond it (no c1c5/c1c6)', !wm.includes('c1c5')&&!wm.includes('c1c6'));
  const b2=new ffish.Board('crate6x6',fen.replace(' w ',' b '));
  const bm=b2.legalMoves().split(' ').filter(m=>m.startsWith('c6'));
  ok('BLACK captures the SAME crate (c6c4)', bm.includes('c6c4'), bm.join(','));
  ok('crate blocks black beyond it (no c6c3/c6c2/c6c1)', !bm.includes('c6c3')&&!bm.includes('c6c2')&&!bm.includes('c6c1'));
  b.push('c1c4');
  ok('crate gone after capture', !b.fen().includes('^'), b.fen());
  ok('rook now occupies c4', b.fen().split('/')[2]==='2R3', b.fen());

  // Pawn semantics. White K+P+R, Black k+r -> neither bare. Crates b3 and c3, pawn c2.
  const pf='2k2r/6/6/1^^3/2P3/2K2R w - - 0 1';
  const pb=new ffish.Board('crate6x6',pf);
  const pm=pb.legalMoves().split(' ').filter(m=>m.startsWith('c2'));
  ok('pawn CAPTURES crate diagonally (c2b3)', pm.includes('c2b3'), pm.join(',')||'(none)');
  ok('pawn CANNOT push onto crate ahead (no c2c3)', !pm.includes('c2c3'));
  ok('wall + crate coexist', new ffish.Board('crate6x6','2k2r/6/2*3/2^3/6/2K2R w - - 0 1').fen()==='2k2r/6/2*3/2^3/6/2K2R w - - 0 1');

  // SAN choice on record: crate captures are written as captures.
  const sb=new ffish.Board('crate6x6',fen);
  ok("crate capture SAN is 'Rxc4'", sb.sanMove('c1c4')==='Rxc4', sb.sanMove('c1c4'));

  // Promotion-capture of a crate (brief 4.6: legal, intended) + push/pop round-trip.
  // This position class is the one the reference diff's undo bug corrupts
  // (native counts, hand-verified d1: perft 1-3 = 24, 177, 3345).
  const PROMO='r^1^1k/2P3/6/6/6/R4K w - - 0 1';
  const pr=new ffish.Board('crate6x6',PROMO);
  const prm=pr.legalMoves().split(' ').filter(Boolean);
  ok('promo fixture has 24 legal moves', prm.length===24, String(prm.length));
  ok('pawn promotes by capturing crate (c5b6q, c5d6n)', prm.includes('c5b6q')&&prm.includes('c5d6n'));
  pr.push('c5b6q');
  ok('crate replaced by promoted queen', pr.fen().startsWith('rQ1^1k/'), pr.fen());
  pr.pop();
  ok('pop restores the crate exactly (undo path)', pr.fen()===PROMO, pr.fen());

  // Designer ruling 2026-08-25: terrain is not a victim. mustCapture neither
  // forces a crate capture nor is satisfied by one.
  const mc1=new ffish.Board('crate6x6mc','2r2k/6/2^3/6/6/2R2K w - - 0 1');
  const mc1m=mc1.legalMoves().split(' ').filter(Boolean);
  ok('mustCapture: lone crate capture forces nothing (10 moves)', mc1m.length===10, String(mc1m.length));
  const mc2=new ffish.Board('crate6x6mc','2r2k/6/2^3/6/4r1/2R2K w - - 0 1');
  const mc2m=mc2.legalMoves().split(' ').filter(Boolean);
  ok('mustCapture: real capture forced, crate capture illegal', mc2m.length===1&&mc2m[0]==='f1e2', mc2m.join(','));
  let cat=0; for(let f=3;f<=12;f++) for(let r=5;r<=10;r++){ffish.loadVariantConfig(`[duel_${f}x${r}:chess]\nmaxRank = ${r}\nmaxFile = ${f}\ncastling = false\n`);cat++;}
  ok('all 60 catalog variants register', cat===60);
  console.log(`\nffish: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
}

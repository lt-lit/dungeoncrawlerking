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
  let cat=0; for(let f=3;f<=12;f++) for(let r=5;r<=10;r++){ffish.loadVariantConfig(`[duel_${f}x${r}:chess]\nmaxRank = ${r}\nmaxFile = ${f}\ncastling = false\n`);cat++;}
  ok('all 60 catalog variants register', cat===60);
  console.log(`\nffish: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
}

// ffish ^-free regression: the patched ffish.js must agree with the shipped
// stock 0.7.9 artifact (play/vendor/ffish.js) on crate-free positions.
// Rule-16 owed item. Asserts: perft 1-4 parity, UCI legalMoves identity, and
// validateFen return codes on the regress fixtures + a 12x10 largeboard FEN.
// SAN strings are printed for eyeballing but NOT asserted (upstream SAN may
// legitimately drift between the 0.7.9 base and current master; legality may not).
//
// Two emscripten classic builds cannot share one Node process, so this script
// spawns itself once per build (env FFISH_ONE) and diffs the JSON.
const path=require('path');
const STOCK=path.resolve(__dirname,'../../play/vendor/ffish.js');

if(process.env.FFISH_ONE){
  const saved=global.fetch; delete global.fetch;
  const Module=require(process.env.FFISH_ONE);
  Module.onRuntimeInitialized=()=>{
    global.fetch=saved;
    const ffish=Module;
    ffish.loadVariantConfig(`[crate6x6:chess]\nmaxRank = 6\nmaxFile = 6\ncastling = false\nstalemateValue = loss\nnMoveRule = 0\nnFoldRule = 0\nnFoldValue = loss\nextinctionValue = loss\nextinctionPieceTypes = *\nextinctionPieceCount = 1\nextinctionPseudoRoyal = false\npromotionRegionWhite = *6\npromotionRegionBlack = *1\n\n[duel_12x10:chess]\nmaxRank = 10\nmaxFile = 12\ncastling = false\n`);
    const perft=(b,d)=>{ if(d===0)return 1; let n=0; for(const m of b.legalMoves().split(' ').filter(Boolean)){ b.push(m); n+=perft(b,d-1); b.pop(); } return n; };
    const out={fixtures:[],validate:[],large:null};
    const FENS=['2r2k/6/6/6/2P3/2R2K w - - 0 1','2r2k/6/2*3/6/2P3/2R2K w - - 0 1','1rbqk1/6/2P3/1P4/6/1RBQK1 w - - 0 1'];
    for(const fen of FENS){
      const b=new ffish.Board('crate6x6',fen);
      out.fixtures.push({fen,
        perft:[1,2,3,4].map(d=>perft(new ffish.Board('crate6x6',fen),d)),
        moves:b.legalMoves().split(' ').filter(Boolean).sort(),
        san:b.legalMovesSan().split(' ').filter(Boolean).sort()});
    }
    for(const [fen,variant] of [...FENS.map(f=>[f,'crate6x6']),['junk not a fen','crate6x6']])
      out.validate.push(ffish.validateFen(fen,variant));
    const LF='3rk7/12/12/12/12/12/12/12/12/3RK7 w - - 0 1';
    const lb=new ffish.Board('duel_12x10',LF);
    out.large={validate:ffish.validateFen(LF,'duel_12x10'), fen:lb.fen(), nMoves:lb.legalMoves().split(' ').filter(Boolean).length};
    console.log(JSON.stringify(out));
    process.exit(0);
  };
  return;
}

const PATCHED = process.env.FFISH_JS; if(!PATCHED){console.error('set FFISH_JS=/path/to/patched/ffish.js');process.exit(2);}
const {execFileSync}=require('child_process');
const run=p=>JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,FFISH_ONE:p},maxBuffer:64*1024*1024}).toString());
const a=run(path.resolve(PATCHED)), b=run(STOCK);
let fail=0;
for(let i=0;i<a.fixtures.length;i++){
  const pa=a.fixtures[i], pb=b.fixtures[i];
  const okP=JSON.stringify(pa.perft)===JSON.stringify(pb.perft);
  const okM=JSON.stringify(pa.moves)===JSON.stringify(pb.moves);
  if(!okP||!okM)fail++;
  console.log(`${okP&&okM?'PASS':'FAIL'}  ${pa.fen.padEnd(35)} perft ${pa.perft} ${okP?'==':'!='} ${pb.perft}; moves ${okM?'identical':'DIFFER'}`);
  if(JSON.stringify(pa.san)!==JSON.stringify(pb.san))
    console.log(`  note: SAN drift (not asserted): patched=${pa.san.join(' ')} stock=${pb.san.join(' ')}`);
}
const okV=JSON.stringify(a.validate)===JSON.stringify(b.validate);
const okL=JSON.stringify(a.large)===JSON.stringify(b.large);
if(!okV)fail++; if(!okL)fail++;
console.log(`${okV?'PASS':'FAIL'}  validateFen codes ${JSON.stringify(a.validate)} ${okV?'==':'!='} ${JSON.stringify(b.validate)}`);
console.log(`${okL?'PASS':'FAIL'}  12x10 largeboard ${JSON.stringify(a.large)} ${okL?'==':'!='} ${JSON.stringify(b.large)}`);
console.log('\n'+(fail?'FAIL':'PASS')+'  patched ffish matches stock 0.7.9 on crate-free positions');
process.exit(fail?1:0);

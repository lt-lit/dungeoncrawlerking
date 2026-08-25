// Fixed-depth search-transcript identity on ^-free positions: patched engine
// vs the shipped 1.1.11 (play/vendor/stockfish.js). Strictly stronger than
// perft parity - catches staged-movepicker defects (e.g. the reference diff's
// QUIET-stage double-emission) that perft is structurally blind to, plus any
// eval or ordering drift. The authored patch predicts EXACT identity: with
// deadSquares empty every changed expression reduces to the stock one.
//
// Fixed depth, single thread, NNUE off, fresh engine instance per position
// (rule 6; also avoids TT carryover). No movetime - the repo's evidence
// fingers wall-clock limits as the nondeterminism source.
//
// PILOT=1 runs the vendored engine against itself instead (determinism pilot:
// run this first on any new machine; if it fails, node counts jitter there
// and only bestmove+score should be compared).
const path=require('path');
const DEPTH=parseInt(process.env.DEPTH||'12',10);
const VENDORED=path.resolve(__dirname,'../../play/vendor/stockfish.js');
const PATCHED=process.env.PILOT?VENDORED:process.env.ENGINE_JS;
if(!PATCHED){console.error('set ENGINE_JS=/path/to/patched/stockfish.js (or PILOT=1)');process.exit(2);}
const INI=`[crate6x6:chess]\nmaxRank = 6\nmaxFile = 6\ncastling = false\nstalemateValue = loss\nnMoveRule = 0\nnFoldRule = 0\nnFoldValue = loss\nextinctionValue = loss\nextinctionPieceTypes = *\nextinctionPieceCount = 1\nextinctionPseudoRoyal = false\npromotionRegionWhite = *6\npromotionRegionBlack = *1\n`;
const FENS=['2r2k/6/6/6/2P3/2R2K w - - 0 1','2r2k/6/2*3/6/2P3/2R2K w - - 0 1','1rbqk1/6/2P3/1P4/6/1RBQK1 w - - 0 1'];

async function searchOne(enginePath,fen){
  const saved=global.fetch; global.fetch=undefined;
  delete require.cache[require.resolve(enginePath)];
  const S=require(enginePath); const sf=await S(); global.fetch=saved;
  const lines=[]; sf.addMessageListener(l=>lines.push(l)); const send=c=>sf.postMessage(c);
  const until=(p,ms=120000)=>new Promise((res,rej)=>{const s=lines.length;const t=setInterval(()=>{for(let i=s;i<lines.length;i++)if(p(lines[i])){clearInterval(t);clearTimeout(k);return res(lines.slice(s));}},20);const k=setTimeout(()=>{clearInterval(t);rej(new Error('timeout'));},ms);});
  send('uci'); await until(l=>l==='uciok');
  send('setoption name Use NNUE value false'); send('setoption name Threads value 1');
  sf.FS.writeFile('/variants.ini',INI); send('setoption name VariantPath value /variants.ini');
  send('isready'); await until(l=>l==='readyok');
  send('setoption name UCI_Variant value crate6x6'); send('isready'); await until(l=>l==='readyok');
  send('position fen '+fen);
  send('go depth '+DEPTH);
  const out=await until(l=>l.startsWith('bestmove'));
  const infos=out.filter(l=>/^info depth \d+ /.test(l)&&/ nodes /.test(l));
  const last=infos[infos.length-1]||'';
  const g=(re)=>{const m=last.match(re);return m?m[1]:null;};
  return { bestmove:(out.find(l=>l.startsWith('bestmove'))||'').split(' ')[1],
           depth:g(/^info depth (\d+)/), nodes:g(/ nodes (\d+)/), score:g(/ score (\S+ -?\d+)/) };
}

(async()=>{
  let fail=0;
  for(const fen of FENS){
    const p=await searchOne(PATCHED,fen);
    const v=await searchOne(VENDORED,fen);
    const same=JSON.stringify(p)===JSON.stringify(v);
    if(!same)fail++;
    console.log(`${same?'PASS':'FAIL'}  ${fen}`);
    console.log(`        ${process.env.PILOT?'run1':'patched '}: ${JSON.stringify(p)}`);
    console.log(`        ${process.env.PILOT?'run2':'vendored'}: ${JSON.stringify(v)}`);
  }
  console.log('\n'+(fail?'FAIL':'PASS')+(process.env.PILOT
    ?'  determinism pilot (vendored vs itself)'
    :`  patched matches vendored 1.1.11 exactly at depth ${DEPTH} on crate-free positions`));
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERR',e.message);process.exit(2);});

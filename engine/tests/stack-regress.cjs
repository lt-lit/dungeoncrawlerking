// Search-thread stack-overflow regression (patches/thread-stack.patch).
//
// P60 golden fixture, investigation of 2026-08-27 (see engine/README.md):
// on an 8MB search-thread stack (TH_STACK_SIZE pre-patch, upstream FSF
// issue #804) this exact node-capped depth-22 search overflows the stack
// ~118 recursive frames deep (~70KB/frame in the largeboard build) and
// KILLS the instance — natively a SIGSEGV, in wasm a silent corruption
// that surfaces as "memory access out of bounds" with the search never
// answering again. With the 32MB stack it completes, deterministically:
// nodes 1,786,533, seldepth 32, bestmove d1i1 (validated identical in
// Node, headless Chromium, and native builds).
//
// Liveness is proven by a SECOND SEARCH, not isready: the Node failure
// mode leaves the UCI queue answering readyok while the search thread is
// dead (rule-12 territory) — isready is not proof of life.
const path=require('path');
const ENGINE_JS = process.env.ENGINE_JS || path.join(__dirname,'..','..','play','vendor','stockfish.js');
const INI=`[duel_10x10__w2__b9:chess]
maxRank = 10
maxFile = 10
castling = false
stalemateValue = loss
nMoveRule = 0
nFoldRule = 0
nFoldValue = loss
extinctionValue = loss
extinctionPieceTypes = *
extinctionPieceCount = 1
extinctionPseudoRoyal = false
promotionRegionWhite = *10
promotionRegionBlack = *1
doubleStepRegionWhite = *1 *2
doubleStepRegionBlack = *9 *10
`;
const FEN='2**5r/1ppk*1p1p1/3ppp2p1/6**2/1**7/5P1*2/1P3NP2n/2P**K4/r2P1B3*/***R6 w - - 0 31';
const saved=global.fetch; global.fetch=undefined;
const Stockfish=require(ENGINE_JS);
Stockfish().then(async sf=>{
  global.fetch=saved;
  let pass=0,fail=0; const ok=(n,c,x='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`);};
  const lines=[]; sf.addMessageListener(l=>lines.push(l));
  const send=c=>sf.postMessage(c);
  const until=(pred,ms=30000)=>new Promise((res,rej)=>{const s=lines.length;const t=setInterval(()=>{
    for(let i=s;i<lines.length;i++) if(pred(lines[i])){clearInterval(t);clearTimeout(k);return res(lines.slice(s));}
  },20);const k=setTimeout(()=>{clearInterval(t);rej(new Error('timeout: '+lines.slice(-6).join(' | ')));},ms);});

  send('uci'); await until(l=>l==='uciok');
  send('setoption name Use NNUE value false');
  send('setoption name Threads value 1');
  sf.FS.writeFile('/variants.ini', INI);
  send('setoption name VariantPath value /variants.ini');
  send('isready'); await until(l=>l==='readyok');
  send('setoption name UCI_Variant value duel_10x10__w2__b9');
  send('isready'); await until(l=>l==='readyok');

  // The kill-search, on a fresh instance (cold TT — the measured condition).
  // Node-capped => deterministic tree; on an 8MB stack the instance dies here.
  send('position fen '+FEN);
  send('go depth 22 nodes 3000000');
  const r=await until(l=>l.startsWith('bestmove'),120000)
    .catch(e=>{ok('depth-22 kill-search returns bestmove (stack held)',false,e.message);
      console.log(`\nstack-regress: ${pass} passed, ${fail} failed`);process.exit(1);});
  const best=r.find(l=>l.startsWith('bestmove'));
  ok('depth-22 kill-search returns bestmove (stack held)', !!best, best);
  ok('bestmove is d1i1', /^bestmove d1i1\b/.test(best||''), best);
  const last=[...r].reverse().find(l=>/^info depth 22 seldepth /.test(l)&&/ nodes /.test(l))||'';
  const nodes=parseInt((last.match(/ nodes (\d+)/)||[])[1]||'0',10);
  const sd=parseInt((last.match(/ seldepth (\d+)/)||[])[1]||'0',10);
  ok('deterministic node count 1786533 (search unchanged by the patch)', nodes===1786533, `nodes ${nodes}`);
  ok('seldepth 32', sd===32, `seldepth ${sd}`);

  // Proof of life: a real second search, NOT isready (see header). A dead
  // instance may go silent at any fence here (even ucinewgame/isready), so
  // the whole block reports as ONE liveness verdict rather than throwing.
  let alive=false, note='(silent — instance dead)';
  try{
    send('ucinewgame'); send('isready'); await until(l=>l==='readyok',10000);
    send('position fen '+FEN);
    send('go depth 8');
    const r2=await until(l=>l.startsWith('bestmove'),60000);
    const b2=r2.find(l=>l.startsWith('bestmove'));
    if(b2){alive=true;note=b2;}
  }catch(e){note='(dead: '+String(e.message||e).slice(0,120)+')';}
  ok('instance survives: post-kill depth-8 search answers', alive, note);

  console.log(`\nstack-regress: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
}).catch(e=>{console.error('LOAD FAIL',e.message);process.exit(2);});

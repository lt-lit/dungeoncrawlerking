const ENGINE_JS = process.env.ENGINE_JS; if(!ENGINE_JS){console.error('set ENGINE_JS=/path/to/patched/stockfish.js');process.exit(2);}
const INI=`[crate6x6:chess]
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
`;
const FEN='2r2k/6/2^3/6/6/2R2K w - - 0 1';
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
  send('setoption name UCI_Variant value crate6x6');
  send('isready'); await until(l=>l==='readyok');

  send('position fen '+FEN);
  send('d');
  const d=await until(l=>l.startsWith('Fen:')||l.includes('Legal uci moves'),10000).catch(()=>[]);
  const board=d.join('\n');
  ok("engine board shows the crate as ^", board.includes('^'), board.split('\n').find(l=>l.includes('^'))||'(no ^ row)');
  const legal=(board.split('\n').find(l=>l.includes('Legal uci moves'))||'');
  ok('engine generates c1c4 (crate capture)', legal.includes('c1c4'), legal.slice(0,120));
  ok('engine does NOT generate c1c5/c1c6', !legal.includes('c1c5')&&!legal.includes('c1c6'));

  // perft cross-check vs ffish
  const pf=[];
  for(const depth of [1,2,3]){
    send('go perft '+depth);
    const r=await until(l=>/^Nodes searched/.test(l),60000);
    pf.push(parseInt(r.find(l=>/^Nodes searched/.test(l)).split(':')[1].trim(),10));
  }
  console.log('ENGINE_PERFT '+JSON.stringify(pf));
  require('fs').writeFileSync(require('path').join(require('os').tmpdir(),'crate-engine-perft.json'),JSON.stringify(pf));

  send('position fen '+FEN); send('go depth 12');
  const bm=await until(l=>l.startsWith('bestmove'),60000);
  const best=bm.find(l=>l.startsWith('bestmove'));
  ok('engine returns a bestmove at depth 12 (no crash)', !!best, best);
  console.log(`\nengine: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
}).catch(e=>{console.error('LOAD FAIL',e.message);process.exit(2);});

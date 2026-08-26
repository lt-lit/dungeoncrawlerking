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
  // 'd' has no terminator line (this build prints board/Fen/Key/Checkers/Chased,
  // no 'Legal uci moves') - fence it with isready so the slice is complete.
  send('d'); send('isready');
  const d=await until(l=>l==='readyok',10000).catch(()=>[]);
  const board=d.join('\n');
  ok("engine board shows the crate as ^", board.includes('^'), board.split('\n').find(l=>l.includes('^'))||'(no ^ row)');
  ok("engine 'd' FEN round-trips the crate", board.includes('Fen: '+FEN));
  // Legal moves via 'go perft 1' (protocol-independent per-move lines)
  send('go perft 1');
  const p1=await until(l=>/^Nodes searched/.test(l),30000);
  const legal=p1.filter(l=>/^\S+: \d+$/.test(l)&&!/^Nodes/.test(l)).map(l=>l.split(':')[0]).join(' ');
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
  ok('perft 1-3 match the validated counts [10,88,1024]', JSON.stringify(pf)==='[10,88,1024]', JSON.stringify(pf));
  require('fs').writeFileSync(require('path').join(require('os').tmpdir(),'crate-engine-perft.json'),JSON.stringify(pf));

  // Promotion-capture of a crate: the position class the reference diff's
  // undo bug corrupted (its counts diverged from depth 2). Expected counts
  // validated natively on the authored patch, d1 hand-counted.
  send('position fen r^1^1k/2P3/6/6/6/R4K w - - 0 1');
  const promoPf=[];
  for(const depth of [1,2,3]){
    send('go perft '+depth);
    const r=await until(l=>/^Nodes searched/.test(l),60000);
    promoPf.push(parseInt(r.find(l=>/^Nodes searched/.test(l)).split(':')[1].trim(),10));
  }
  ok('promo-capture-of-crate perft 1-3 = [24,177,3345]', JSON.stringify(promoPf)==='[24,177,3345]', JSON.stringify(promoPf));

  send('position fen '+FEN); send('go depth 12');
  const bm=await until(l=>l.startsWith('bestmove'),60000);
  const best=bm.find(l=>l.startsWith('bestmove'));
  ok('engine returns a bestmove at depth 12 (no crash)', !!best, best);
  console.log(`\nengine: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
}).catch(e=>{console.error('LOAD FAIL',e.message);process.exit(2);});

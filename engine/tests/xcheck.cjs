const FFISH_JS = process.env.FFISH_JS; if(!FFISH_JS){console.error('set FFISH_JS=/path/to/patched/ffish.js');process.exit(2);}
const ENGINE_JS = process.env.ENGINE_JS; if(!ENGINE_JS){console.error('set ENGINE_JS=/path/to/patched/stockfish.js');process.exit(2);}
const INI=`[crate6x6:chess]\nmaxRank = 6\nmaxFile = 6\ncastling = false\nstalemateValue = loss\nnMoveRule = 0\nnFoldRule = 0\nnFoldValue = loss\nextinctionValue = loss\nextinctionPieceTypes = *\nextinctionPieceCount = 1\nextinctionPseudoRoyal = false\npromotionRegionWhite = *6\npromotionRegionBlack = *1\n`;
const FEN='2r2k/6/2^3/6/6/2R2K w - - 0 1';
const saved=global.fetch; global.fetch=undefined;
const F=require(FFISH_JS);
F.onRuntimeInitialized=()=>{
  F.loadVariantConfig(INI);
  const perft=(b,d)=>{ if(d===0)return 1; let n=0; for(const m of b.legalMoves().split(' ').filter(Boolean)){ b.push(m); n+=perft(b,d-1); b.pop(); } return n; };
  const b=new F.Board('crate6x6',FEN);
  const fp=[1,2,3].map(d=>perft(new F.Board('crate6x6',FEN),d));
  console.log('FFISH_PERFT   '+JSON.stringify(fp));
  console.log('FFISH d1 moves: '+b.legalMoves());
  const Stockfish=require(ENGINE_JS);
  Stockfish().then(async sf=>{
    global.fetch=saved;
    const lines=[]; sf.addMessageListener(l=>lines.push(l));
    const send=c=>sf.postMessage(c);
    const until=(p,ms=60000)=>new Promise((res,rej)=>{const s=lines.length;const t=setInterval(()=>{for(let i=s;i<lines.length;i++)if(p(lines[i])){clearInterval(t);clearTimeout(k);return res(lines.slice(s));}},20);const k=setTimeout(()=>{clearInterval(t);rej(new Error('timeout'));},ms);});
    send('uci'); await until(l=>l==='uciok');
    send('setoption name Use NNUE value false'); send('setoption name Threads value 1');
    sf.FS.writeFile('/variants.ini',INI); send('setoption name VariantPath value /variants.ini');
    send('isready'); await until(l=>l==='readyok');
    send('setoption name UCI_Variant value crate6x6'); send('isready'); await until(l=>l==='readyok');
    send('position fen '+FEN);
    const ep=[];
    for(const d of [1,2,3]){ send('go perft '+d); const r=await until(l=>/^Nodes searched/.test(l)); ep.push(parseInt(r.find(l=>/^Nodes searched/.test(l)).split(':')[1].trim(),10)); if(d===1) console.log('ENGINE d1 moves: '+r.filter(l=>/^[a-f]\d+[a-f]\d+:/.test(l)).map(l=>l.split(':')[0]).join(' ')); }
    console.log('ENGINE_PERFT  '+JSON.stringify(ep));
    const agree=JSON.stringify(fp)===JSON.stringify(ep);
    console.log('\n'+(agree?'PASS':'FAIL')+'  ffish and engine AGREE on perft 1-3 with a crate on the board');
    process.exit(agree?0:1);
  });
};

const FFISH_JS = process.env.FFISH_JS; if(!FFISH_JS){console.error('set FFISH_JS=/path/to/patched/ffish.js');process.exit(2);}
const ENGINE_JS = process.env.ENGINE_JS; if(!ENGINE_JS){console.error('set ENGINE_JS=/path/to/patched/stockfish.js');process.exit(2);}
const INI=`[crate6x6:chess]\nmaxRank = 6\nmaxFile = 6\ncastling = false\nstalemateValue = loss\nnMoveRule = 0\nnFoldRule = 0\nnFoldValue = loss\nextinctionValue = loss\nextinctionPieceTypes = *\nextinctionPieceCount = 1\nextinctionPseudoRoyal = false\npromotionRegionWhite = *6\npromotionRegionBlack = *1\n\n[crate6x6mc:crate6x6]\nmustCapture = true\n`;
// Fixture set: plain crate board (both sides), pawn/crate semantics, wall+crate,
// the promotion-capture-of-crate MIRROR PAIR (the reference diff's undo bug
// diverged here from depth 2 and failed mirror self-consistency), and the
// mustCapture semantics pair (designer ruling: terrain is not a victim).
const FIXTURES=[
  {variant:'crate6x6',  fen:'2r2k/6/2^3/6/6/2R2K w - - 0 1',  depths:[1,2,3]},
  {variant:'crate6x6',  fen:'2r2k/6/2^3/6/6/2R2K b - - 0 1',  depths:[1,2,3]},
  {variant:'crate6x6',  fen:'2k2r/6/6/1^^3/2P3/2K2R w - - 0 1',depths:[1,2,3]},
  {variant:'crate6x6',  fen:'2k2r/6/2*3/2^3/6/2K2R w - - 0 1', depths:[1,2,3]},
  {variant:'crate6x6',  fen:'r^1^1k/2P3/6/6/6/R4K w - - 0 1',  depths:[1,2,3], mirror:'A'},
  {variant:'crate6x6',  fen:'r4k/6/6/6/2p3/R^1^1K b - - 0 1',  depths:[1,2,3], mirror:'A'},
  {variant:'crate6x6mc',fen:'2r2k/6/2^3/6/6/2R2K w - - 0 1',  depths:[1,2]},
  {variant:'crate6x6mc',fen:'2r2k/6/2^3/6/4r1/2R2K w - - 0 1', depths:[1,2]},
];
const saved=global.fetch; global.fetch=undefined;
const F=require(FFISH_JS);
F.onRuntimeInitialized=()=>{
  F.loadVariantConfig(INI);
  const perft=(b,d)=>{ if(d===0)return 1; let n=0; for(const m of b.legalMoves().split(' ').filter(Boolean)){ b.push(m); n+=perft(b,d-1); b.pop(); } return n; };
  for(const fx of FIXTURES) fx.ffish=fx.depths.map(d=>perft(new F.Board(fx.variant,fx.fen),d));
  const Stockfish=require(ENGINE_JS);
  Stockfish().then(async sf=>{
    global.fetch=saved;
    const lines=[]; sf.addMessageListener(l=>lines.push(l));
    const send=c=>sf.postMessage(c);
    const until=(p,ms=90000)=>new Promise((res,rej)=>{const s=lines.length;const t=setInterval(()=>{for(let i=s;i<lines.length;i++)if(p(lines[i])){clearInterval(t);clearTimeout(k);return res(lines.slice(s));}},20);const k=setTimeout(()=>{clearInterval(t);rej(new Error('timeout'));},ms);});
    send('uci'); await until(l=>l==='uciok');
    send('setoption name Use NNUE value false'); send('setoption name Threads value 1');
    sf.FS.writeFile('/variants.ini',INI); send('setoption name VariantPath value /variants.ini');
    send('isready'); await until(l=>l==='readyok');
    let fail=0;
    for(const fx of FIXTURES){
      send('setoption name UCI_Variant value '+fx.variant); send('isready'); await until(l=>l==='readyok');
      send('position fen '+fx.fen);
      fx.engine=[];
      for(const d of fx.depths){ send('go perft '+d); const r=await until(l=>/^Nodes searched/.test(l)); fx.engine.push(parseInt(r.find(l=>/^Nodes searched/.test(l)).split(':')[1].trim(),10)); }
      const agree=JSON.stringify(fx.ffish)===JSON.stringify(fx.engine);
      if(!agree)fail++;
      console.log(`${agree?'PASS':'FAIL'}  ${fx.variant.padEnd(11)} ${fx.fen.padEnd(35)} ffish=${fx.ffish} engine=${fx.engine}`);
    }
    const mirrors=FIXTURES.filter(f=>f.mirror==='A');
    const mirrorOk=JSON.stringify(mirrors[0].engine)===JSON.stringify(mirrors[1].engine);
    if(!mirrorOk)fail++;
    console.log(`${mirrorOk?'PASS':'FAIL'}  promo mirror pair self-consistent (${mirrors[0].engine} vs ${mirrors[1].engine})`);
    console.log('\n'+(fail?'FAIL':'PASS')+'  ffish and engine agree on all crate fixtures');
    process.exit(fail?1:0);
  });
};

// Rule-11 depth-cap measurement on a WASM engine build (Node, pthread path).
// Runs N searches at `go depth 22 movetime 10000` and M at `go depth 60
// movetime 10000` over mixed 4-6 file arenas (walls and crates included),
// with the production watchdog (movetime + 1.5s grace -> stop; +3s -> dead).
// Counts completed / stopped-by-watchdog / dead-instance. Fresh instance
// every 40 searches (rule 6) and after every failure.
//
//   ENGINE_JS=... node engine/tests/depthcap.cjs            # 110 d22 + 30 d60
//   ENGINE_JS=... N22=10 N60=5 node engine/tests/depthcap.cjs   # quick look
const ENGINE_JS = process.env.ENGINE_JS; if(!ENGINE_JS){console.error('set ENGINE_JS');process.exit(2);}
const N22=parseInt(process.env.N22||'110',10), N60=parseInt(process.env.N60||'30',10);
const INI=`[duel_4x6:chess]\nmaxRank = 6\nmaxFile = 4\ncastling = false\n[duel_5x8:chess]\nmaxRank = 8\nmaxFile = 5\ncastling = false\n[duel_6x8:chess]\nmaxRank = 8\nmaxFile = 6\ncastling = false\n[crate6x6:chess]\nmaxRank = 6\nmaxFile = 6\ncastling = false\nstalemateValue = loss\nnMoveRule = 0\nnFoldRule = 0\nnFoldValue = loss\nextinctionValue = loss\nextinctionPieceTypes = *\nextinctionPieceCount = 1\nextinctionPseudoRoyal = false\npromotionRegionWhite = *6\npromotionRegionBlack = *1\n`;
const POSITIONS=[
  ['duel_4x6','r1qk/pp2/4/1^2/PP2/R1QK w - - 0 1'],
  ['duel_4x6','1rk1/2p1/4/1n1*/2P1/1RK1 w - - 0 1'],
  ['duel_4x6','rqk1/1p2/2^1/1*2/1P2/RQK1 w - - 0 1'],
  ['duel_5x8','2rk1/ppp2/5/1^3/2*2/5/PPP2/2RK1 w - - 0 1'],
  ['duel_5x8','q1k2/1pp2/5/2^2/5/1*3/1PP2/Q1K2 w - - 0 1'],
  ['duel_5x8','1rbk1/2pp1/5/1^1^1/5/5/2PP1/1RBK1 w - - 0 1'],
  ['duel_6x8','2rqk1/1pppp1/6/2^3/3*2/6/1PPPP1/2RQK1 w - - 0 1'],
  ['duel_6x8','1r2k1/2pp2/6/1^2*1/6/2n3/2PP2/1R2K1 w - - 0 1'],
  ['crate6x6','2r2k/6/2^3/6/6/2R2K w - - 0 1'],
  ['crate6x6','r^1^1k/2P3/6/6/6/R4K w - - 0 1'],
];
const saved=global.fetch;
async function fresh(){
  global.fetch=undefined;
  delete require.cache[require.resolve(ENGINE_JS)];
  const S=require(ENGINE_JS); const sf=await S(); global.fetch=saved;
  const lines=[]; sf.addMessageListener(l=>lines.push(l));
  const send=c=>sf.postMessage(c);
  const until=(p,ms)=>new Promise((res,rej)=>{const s=lines.length;const t=setInterval(()=>{for(let i=s;i<lines.length;i++)if(p(lines[i])){clearInterval(t);clearTimeout(k);return res(lines[i]);}},20);const k=setTimeout(()=>{clearInterval(t);rej(new Error('timeout'));},ms);});
  send('uci'); await until(l=>l==='uciok',30000);
  send('setoption name Use NNUE value false'); send('setoption name Threads value 1');
  sf.FS.writeFile('/variants.ini',INI); send('setoption name VariantPath value /variants.ini');
  send('isready'); await until(l=>l==='readyok',15000);
  return {send,until};
}
(async()=>{
  // sanity: every fixture must load and search shallow before the runs
  let eng=await fresh();
  for(const [v,fen] of POSITIONS){
    eng.send('setoption name UCI_Variant value '+v); eng.send('isready'); await eng.until(l=>l==='readyok',15000);
    eng.send('position fen '+fen); eng.send('go depth 4');
    await eng.until(l=>l.startsWith('bestmove'),20000).catch(e=>{console.error('BAD FIXTURE',v,fen);process.exit(2);});
  }
  console.log('fixtures ok:',POSITIONS.length);
  for(const [label,depth,n] of [['d22',22,N22],['d60',60,N60]]){
    let done=0,stopped=0,dead=0,sinceRecycle=0,maxMs=0;
    for(let i=0;i<n;i++){
      if(sinceRecycle>=40){eng=await fresh();sinceRecycle=0;}
      const [v,fen]=POSITIONS[i%POSITIONS.length];
      try{
        eng.send('setoption name UCI_Variant value '+v); eng.send('isready'); await eng.until(l=>l==='readyok',15000);
        eng.send('position fen '+fen);
        const t0=Date.now();
        eng.send(`go depth ${depth} movetime 10000`);
        try{ await eng.until(l=>l.startsWith('bestmove'),11500); done++; }
        catch{ // watchdog: grace elapsed -> stop
          eng.send('stop');
          try{ await eng.until(l=>l.startsWith('bestmove'),3000); stopped++; }
          catch{ dead++; eng=await fresh(); sinceRecycle=0; }
        }
        maxMs=Math.max(maxMs,Date.now()-t0);
        sinceRecycle++;
      }catch(e){ dead++; eng=await fresh(); sinceRecycle=0; }
      if((i+1)%10===0) process.stdout.write(`  ${label} ${i+1}/${n} (done ${done} stopped ${stopped} dead ${dead})\n`);
    }
    console.log(`${label}: ${n} searches -> ${done} completed, ${stopped} watchdog-stopped, ${dead} dead instances; slowest ${maxMs} ms`);
  }
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(2);});

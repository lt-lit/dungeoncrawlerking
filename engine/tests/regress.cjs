const ENGINE_JS = process.env.ENGINE_JS; if(!ENGINE_JS){console.error('set ENGINE_JS=/path/to/patched/stockfish.js');process.exit(2);}
const INI=`[crate6x6:chess]\nmaxRank = 6\nmaxFile = 6\ncastling = false\nstalemateValue = loss\nnMoveRule = 0\nnFoldRule = 0\nnFoldValue = loss\nextinctionValue = loss\nextinctionPieceTypes = *\nextinctionPieceCount = 1\nextinctionPseudoRoyal = false\npromotionRegionWhite = *6\npromotionRegionBlack = *1\n`;
// crate-FREE positions, one with a WALL, to check the patch changes nothing pre-existing
const FENS=['2r2k/6/6/6/2P3/2R2K w - - 0 1','2r2k/6/2*3/6/2P3/2R2K w - - 0 1','1rbqk1/6/2P3/1P4/6/1RBQK1 w - - 0 1'];
async function drive(path){
  const saved=global.fetch; global.fetch=undefined;
  delete require.cache[require.resolve(path)];
  const S=require(path); const sf=await S(); global.fetch=saved;
  const lines=[]; sf.addMessageListener(l=>lines.push(l)); const send=c=>sf.postMessage(c);
  const until=(p,ms=90000)=>new Promise((res,rej)=>{const s=lines.length;const t=setInterval(()=>{for(let i=s;i<lines.length;i++)if(p(lines[i])){clearInterval(t);clearTimeout(k);return res(lines.slice(s));}},20);const k=setTimeout(()=>{clearInterval(t);rej(new Error('timeout'));},ms);});
  send('uci'); await until(l=>l==='uciok');
  send('setoption name Use NNUE value false'); send('setoption name Threads value 1');
  sf.FS.writeFile('/variants.ini',INI); send('setoption name VariantPath value /variants.ini');
  send('isready'); await until(l=>l==='readyok');
  send('setoption name UCI_Variant value crate6x6'); send('isready'); await until(l=>l==='readyok');
  const out=[];
  for(const f of FENS){ send('position fen '+f); const row=[];
    for(const d of [1,2,3,4]){ send('go perft '+d); const r=await until(l=>/^Nodes searched/.test(l)); row.push(parseInt(r.find(l=>/^Nodes searched/.test(l)).split(':')[1].trim(),10)); }
    out.push(row); }
  return out;
}
(async()=>{
  const nu=await drive(ENGINE_JS);
  console.log('PATCHED   ', JSON.stringify(nu));
  const old=await drive(require('path').resolve(__dirname,'../../play/vendor/stockfish.js'));
  console.log('VENDORED  ', JSON.stringify(old));
  const same=JSON.stringify(nu)===JSON.stringify(old);
  console.log('\n'+(same?'PASS':'FAIL')+'  patched build matches the shipped 1.1.11 engine on crate-free positions (incl. a wall)');
  process.exit(same?0:1);
})().catch(e=>{console.error('ERR',e.message);process.exit(2);});

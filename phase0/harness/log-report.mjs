// Replay-log report (2026-09-06): a browser export (play/js/replaylog.mjs,
// schema dck-log/1 — the Export / copy-log buttons, `__DCK.log.build()`, or
// a saved autosave slot) printed as a human-readable post-mortem. No engine,
// no ffish: every board is drawn from the FENs the log carries, so a pasted
// log is readable anywhere Node runs.
//
// Usage: node harness/log-report.mjs <log.json> [sections…] [--ply N]
//   sections (default: header timeline quakes branches flags anomalies):
//     header     the deal, the build, the engine limits, the verdict
//     timeline   one line per ply: move, engine eval, quake summary, flags,
//                where an undo resumed
//     quakes     every quake in full: board before/after, the ladder path,
//                the protected census, the engine inputs, the gate verdict,
//                the rejected attempts, timing, eval delta
//     branches   every undo: the board right before it, the abandoned line
//     flags      the player's marks
//     anomalies  the duel layer's warnings
//     engine     the enemy's eval trajectory, one line per search
//     log        the display lines the player saw
//     all        everything
//   --ply N      restrict quakes/attempts/traces to one ply (adds the ply's
//                full roll trace as JSON)
//   --json a.b   print one field of the log as JSON and exit
import fs from 'fs';
import { parseBoard } from '../../play/js/fen.mjs';

const argv = process.argv.slice(2);
const SECTION_NAMES = new Set(['header', 'timeline', 'quakes', 'branches', 'flags', 'anomalies', 'engine', 'log', 'all']);
const file = argv.find((a) => !a.startsWith('--') && !SECTION_NAMES.has(a) && argv[argv.indexOf(a) - 1] !== '--ply' && argv[argv.indexOf(a) - 1] !== '--json');
if (!file) {
  console.error('usage: node harness/log-report.mjs <log.json> [header|timeline|quakes|branches|flags|anomalies|engine|log|all] [--ply N] [--json path]');
  process.exit(2);
}
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const wanted = new Set(argv.filter((a) => SECTION_NAMES.has(a)));
if (wanted.has('all')) for (const s of SECTION_NAMES) wanted.add(s);
if (!wanted.size) for (const s of ['header', 'timeline', 'quakes', 'branches', 'flags', 'anomalies']) wanted.add(s);
const onlyPly = opt('ply') !== null ? parseInt(opt('ply'), 10) : null;

const L = JSON.parse(fs.readFileSync(file, 'utf8'));
if (opt('json') !== null) {
  const v = opt('json').split('.').reduce((o, k) => (o == null ? o : o[/^\d+$/.test(k) ? parseInt(k, 10) : k]), L);
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}
const num = (v) => (typeof v === 'string' && /^-?Infinity$|^NaN$/.test(v) ? Number(v) : v); // jsonSafeNumbers' strings

// ---------------------------------------------------------------- helpers

const files = L.files ?? 10;
const ranks = L.ranks ?? 10;
const fmtScore = (s) => {
  if (!s) return '—';
  if (s.type === 'mate') return s.value > 0 ? `M${s.value}` : `−M${-s.value}`;
  return `${s.value >= 0 ? '+' : ''}${(s.value / 100).toFixed(2)}`;
};
const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '?');
const fileLetter = (f) => String.fromCharCode(97 + f);
const sqName = (f, r) => `${fileLetter(f)}${r + 1}`;

/** One board as text rows (top rank first). Walls '#', a hole 'O', a
 *  god-cracked wall 'x', authored furniture '^', floor '·'. */
function boardRows(fen, { holes = [], godCrates = [] } = {}) {
  const grid = parseBoard(fen.split(' ')[0]);
  const holeSet = new Set(holes);
  const crateSet = new Set(godCrates);
  const rows = [];
  for (let i = 0; i < grid.length; i++) {
    const r = grid.length - 1 - i; // rank index from the bottom
    let line = `${String(r + 1).padStart(2)} `;
    for (let f = 0; f < grid[i].length; f++) {
      const c = grid[i][f];
      const sq = sqName(f, r);
      let ch;
      if (c === null) ch = '·';
      else if (c === '*') ch = holeSet.has(sq) ? 'O' : '#';
      else if (c === '^') ch = crateSet.has(sq) ? 'x' : '^';
      else ch = c;
      line += ch + ' ';
    }
    rows.push(line.trimEnd());
  }
  rows.push('   ' + Array.from({ length: grid[0]?.length ?? files }, (_, f) => fileLetter(f)).join(' '));
  return rows;
}

function sideBySide(a, b, gap = '   →   ') {
  const w = Math.max(...a.map((s) => s.length));
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push((a[i] ?? '').padEnd(w) + (b[i] !== undefined ? gap + b[i] : ''));
  return out;
}

const stateAt = (ply, states = L.states) => states.find((s) => s.ply === ply && !s.ended) ?? states.find((s) => s.ply === ply) ?? null;
const ledgersAt = (ply, states = L.states) => {
  const s = stateAt(ply, states);
  return s ? { holes: s.holes ?? [], godCrates: s.godCrates ?? [] } : {};
};

function quakeSummary(q) {
  const bits = [];
  for (const e of q.terrain ?? []) bits.push(e.kind === 'weaken' ? `crack ${e.square}` : `breach ${e.square}${e.freed ? ` (frees ${e.freed})` : ''}`);
  for (const d of q.displacements ?? []) bits.push(`${d.piece} ${d.from}→${d.to}`);
  if (q.crumble) bits.push(`hole ${q.crumble.square}`);
  if (q.endedGame) bits.push('TERMINAL');
  return bits.join(', ') || '(nothing landed)';
}

const out = [];
const say = (...s) => out.push(s.join(''));
const rule = (title) => say(`\n${'═'.repeat(8)} ${title} ${'═'.repeat(Math.max(0, 60 - title.length))}`);

// ----------------------------------------------------------------- header

if (wanted.has('header')) {
  rule('REPLAY LOG');
  say(`schema ${L.schema}  build ${L.meta?.app ?? '?'}  exported ${L.meta?.exportedAt ?? '?'}  started ${L.meta?.startedAt ?? '?'}`);
  say(`stage ${L.stage}${L.stageTransformed && L.stageTransformed !== L.stage ? ` (${L.stageTransformed})` : ''}  "${L.title ?? ''}"  ${files}×${ranks}  flip ${L.flip}  crop ${L.crop?.top ?? 0}/${L.crop?.bottom ?? 0}  first move ${L.turn}`);
  say(`setup seed ${L.setupSeed} (attempt ${L.dealAttempt})  director seed ${L.seed}  player ${L.player}`);
  if (L.armies) say(`armies  W ${JSON.stringify(L.armies.white)}\n        B ${JSON.stringify(L.armies.black)}`);
  say(`engine ${L.meta?.engine ?? '?'}  go "${L.go}"  mate probe "${L.mateGo}"  eval gate ${L.evalGate ? JSON.stringify(L.evalGate) : 'off'}  hint probe "${L.meta?.probeGo ?? '?'}"`);
  say(`gods preset ${L.meta?.options?.godPreset ?? '?'}${L.meta?.options?.godLadder ? `  ladder ${JSON.stringify(L.meta.options.godLadder)}` : ''}  favor ${L.favor}`);
  say(`config0 ${JSON.stringify(L.config0)}`);
  if (L.tunes?.length) say(`tunes ${L.tunes.map((t) => `@p${t.ply} ${t.undo ? `UNDO(from ${t.fromPly})` : Object.entries(t).filter(([k]) => !['ply', 'seq', 'at'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' ')}`).join(' · ')}`);
  say(`RESULT ${L.result ?? '(unfinished)'}  ${L.termination ?? ''}  winner ${L.winner ?? '—'}${L.error ? `  ERROR ${L.error}` : ''}`);
  say(`plies ${L.plies}  quakes ${L.quakes?.length ?? 0}  rejected draws ${L.attempts?.length ?? 0}  undos ${L.branches?.length ?? 0}  flags ${L.flags?.length ?? 0}  anomalies ${L.anomalies?.length ?? 0}  events ${L.seq}`);
  say(`device ${L.meta?.ua ?? '?'}`);
  say(`url ${L.meta?.url ?? '?'}${L.meta?.query ?? ''}`);
}

// --------------------------------------------------------------- timeline

const engineByPly = new Map((L.engine ?? []).map((e) => [e.ply, e]));
const quakeByPly = new Map((L.quakes ?? []).map((q) => [q.ply, q]));
const traceByPly = new Map((L.quakeTraces ?? []).map((t) => [t.ply, t]));
const flagsByPly = new Map();
for (const f of L.flags ?? []) flagsByPly.set(f.ply, [...(flagsByPly.get(f.ply) ?? []), f]);
const resumedAt = new Map();
(L.branches ?? []).forEach((b, i) => resumedAt.set(b.toPly, [...(resumedAt.get(b.toPly) ?? []), i + 1]));
const vetoedPlies = new Set((L.quakeTraces ?? []).filter((t) => t.outcome === 'vetoed').map((t) => t.ply));

function timelineLines(moves, sans, { engine = engineByPly, quakes = quakeByPly, traces = traceByPly, flags = flagsByPly, startPly = 0 } = {}) {
  const lines = [];
  for (let i = 0; i < moves.length; i++) {
    const ply = startPly + i + 1;
    const n = Math.ceil(ply / 2);
    const white = ply % 2 === 1;
    const e = engine.get(ply);
    const q = quakes.get(ply);
    const t = traces.get(ply);
    let line = `p${String(ply).padStart(3)}  ${String(n).padStart(3)}${white ? '. ' : '… '}${(sans?.[i] ?? moves[i]).padEnd(8)}`;
    line += e ? ` e:d${e.depth ?? '?'} ${fmtScore(e.score).padStart(6)} ${String(e.ms ?? '?').padStart(5)}ms${e.recovered ? ' RECOVERED' : ''}` : ' '.repeat(23);
    if (t && t.outcome !== 'quiet' && t.outcome !== 'vetoed') line += `  ⚡ ${q ? quakeSummary(q) : t.outcome}${t.evalGate?.attempt ? ` [draw ${t.evalGate.attempt + 1}]` : ''}`;
    else if (t?.outcome === 'vetoed') line += `  ⚡ VETOED (every draw softened)`;
    else if (t?.vetoed) line += `  ⚡ ${t.vetoed} (duel-layer veto)`;
    for (const f of flags.get(ply) ?? []) line += `  ⚑${f.note ? ` ${f.note}` : ''}`;
    lines.push(line);
    if (resumedAt.has(ply) && flags === flagsByPly) for (const k of resumedAt.get(ply)) lines.push(`      ↩ undo #${k} rewound to here (see branches)`);
  }
  return lines;
}

if (wanted.has('timeline')) {
  rule('TIMELINE (the line of record)');
  if (resumedAt.has(0)) for (const k of resumedAt.get(0)) say(`      ↩ undo #${k} rewound to the start`);
  for (const l of timelineLines(L.moves ?? [], L.sans ?? [])) say(l);
  const last = L.states?.[L.states.length - 1];
  if (last?.fen) {
    say('\nfinal position' + (last.ended ? ` (${last.result ?? ''} ${last.termination ?? last.error ?? ''})` : ''));
    for (const r of boardRows(last.fen, last)) say('  ', r);
  }
}

// ----------------------------------------------------------------- quakes

function traceDetail(t, indent = '  ') {
  const s = [];
  s.push(`${indent}path ${t.path?.join(' → ')}${t.rungsSpent ? `  rungs ${t.rungsSpent.join(',')}` : ''}  budget ${t.budget ?? '—'}${t.only ? ` only=${t.only}` : ''}${t.fellThrough ? '  FELL THROUGH' : ''}${t.attempt ? `  attempt ${t.attempt}` : ''}`);
  s.push(`${indent}meter ${t.meter} → ${t.meterAfter ?? '—'}  heat ${t.heat}  tedium ${t.tedium}  staleness ${t.staleness}  debt ${t.debtBefore}→${t.debtAfter}  favor ${t.favor}  held ${t.held}`);
  if (t.p) s.push(`${indent}p: quake ${t.p.quake} pressure ${t.p.pressure} meterP ${t.p.meterP} floor ${t.p.floor} dead ${t.p.dead}${t.p.crumbleForced ? ' CRUMBLE FORCED' : ''}`);
  if (t.weights) s.push(`${indent}weights ${JSON.stringify(t.weights)}${t.conserve !== undefined ? `  conserve ${JSON.stringify(t.conserve)}` : ''}`);
  if (t.rolls?.length) s.push(`${indent}rolls ${t.rolls.map((r) => (r.p === undefined ? `${r.roll}=${JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'roll')))}` : `${r.roll}:${r.value}<${r.p}${r.pass ? '✓' : '✗'}`)).join(' ')}`);
  if (t.census) s.push(`${indent}census ${JSON.stringify(t.census)}`);
  if (t.protected) {
    const p = t.protected;
    s.push(`${indent}protected ${p.pieces} pieces / ${p.squares} squares  threats ${JSON.stringify(p.threats)}  wins ${JSON.stringify(p.wins)}  nodes ${p.nodes}${p.truncated ? ' (search cut)' : ''}`);
    if (p.engine) s.push(`${indent}  engine: ${p.engine.hints} hints → ${p.engine.mates} mate lines ${JSON.stringify(p.engine.lines ?? [])}  probes ${JSON.stringify(p.engine.probes ?? null)}`);
  }
  if (t.inputs) {
    s.push(`${indent}inputs: before ${fmtScore(t.inputs.before)}  probes ${JSON.stringify(t.inputs.probes)}`);
    for (const h of t.inputs.hints ?? []) s.push(`${indent}  hint ${h.source}: ${fmtScore(h.score)}  pv ${(h.pv ?? []).slice(0, 10).join(' ')}${(h.pv?.length ?? 0) > 10 ? ' …' : ''}`);
  }
  if (t.evalGate) {
    const g = t.evalGate;
    s.push(`${indent}eval gate: ${g.verdict}  ${fmtScore(g.before)} → ${fmtScore(g.after)}${g.fallback ? `  fallback ${g.fallback}` : ''}${g.rejected?.length ? `  rejected ${g.rejected.map((r) => `#${r.attempt} ${r.verdict} (${fmtScore(r.after)})`).join(', ')}` : ''}`);
  }
  if (t.chosen) s.push(`${indent}chosen ${JSON.stringify(t.chosen)}`);
  if (t.timing) s.push(`${indent}timing ms: roll ${t.timing.roll} probes ${t.timing.probes} compose ${t.timing.compose} gate ${t.timing.gate} total ${t.timing.total}`);
  if (t.vetoed) s.push(`${indent}DUEL-LAYER VETO: ${t.vetoed}`);
  return s;
}

function quakeBlock(q, t, { states = L.states, attempts = L.attempts ?? [] } = {}) {
  const s = [];
  s.push(`⚡ ply ${q.ply}  ${quakeSummary(q)}  (seq ${q.seq}, ${when(q.at)})`);
  const pre = boardRows(q.preFen, ledgersAt(q.ply - 1, states));
  const post = boardRows(q.postFen, ledgersAt(q.ply, states));
  for (const r of sideBySide(pre, post)) s.push('  ' + r);
  if (q.evalDelta) s.push(`  eval delta (white POV): ${fmtScore(q.evalDelta.before)} → ${fmtScore(q.evalDelta.after)}${q.evalDelta.flipped ? '  FLIPPED' : ''}`);
  if (t) s.push(...traceDetail(t));
  for (const a of attempts.filter((a) => a.ply === q.ply)) {
    s.push(`  ✗ rejected draw #${a.attempt}${a.fallback ? ` (${a.fallback})` : ''}: ${a.verdict}  ${fmtScore(a.before)} → ${fmtScore(a.after)}  would have: ${quakeSummary(a)}`);
    if (a.trace?.chosen) s.push(`    chosen ${JSON.stringify(a.trace.chosen)}`);
    if (a.trace?.path) s.push(`    path ${a.trace.path.join(' → ')}`);
  }
  return s;
}

if (wanted.has('quakes')) {
  rule(`QUAKES (${L.quakes?.length ?? 0} landed, ${vetoedPlies.size} vetoed plies, ${L.attempts?.length ?? 0} rejected draws)`);
  const quakes = (L.quakes ?? []).filter((q) => onlyPly === null || q.ply === onlyPly);
  for (const q of quakes) {
    for (const l of quakeBlock(q, traceByPly.get(q.ply))) say(l);
    say('');
  }
  for (const ply of [...vetoedPlies].filter((p) => onlyPly === null || p === onlyPly)) {
    const t = traceByPly.get(ply);
    say(`⚡ ply ${ply}  VETOED — nothing landed, meter spent`);
    say(...traceDetail(t).map((l) => l + '\n'));
    for (const a of (L.attempts ?? []).filter((a) => a.ply === ply)) say(`  ✗ rejected draw #${a.attempt}${a.fallback ? ` (${a.fallback})` : ''}: ${a.verdict}  ${fmtScore(a.before)} → ${fmtScore(a.after)}  would have: ${quakeSummary(a)}`);
    say('');
  }
  if (onlyPly !== null) {
    const t = traceByPly.get(onlyPly);
    if (t) {
      say(`full roll trace @p${onlyPly}:`);
      say(JSON.stringify(t, null, 2));
    } else say(`no roll trace for ply ${onlyPly}`);
  }
}

// --------------------------------------------------------------- branches

if (wanted.has('branches')) {
  rule(`UNDOS (${L.branches?.length ?? 0})`);
  (L.branches ?? []).forEach((b, i) => {
    const tail = b.tail ?? {};
    say(`↩ undo #${i + 1}  ply ${b.fromPly} → ${b.toPly}  (seq ${b.seq}, ${when(b.at)})  abandoned: ${tail.moves?.length ?? 0} plies, ${tail.quakes?.length ?? 0} quakes, ${tail.attempts?.length ?? 0} rejected draws, ${tail.flags?.length ?? 0} flags`);
    const f = b.from ?? {};
    say(`  state right before the undo: ply ${f.ply}, ${f.turn === 'w' ? 'white' : 'black'} to move, game ${f.state}${f.result ? ` (${f.result} ${f.termination ?? ''})` : ''}${f.error ? ` ERROR ${f.error}` : ''}`);
    say(`  holes ${JSON.stringify(f.holes ?? [])}  god crates ${JSON.stringify(f.godCrates ?? [])}  debt ${f.debt}  meter ${JSON.stringify(f.meter)}`);
    if (f.fen) for (const r of boardRows(f.fen, f)) say('    ', r);
    const resumed = stateAt(b.toPly);
    if (resumed?.fen && resumed.fen !== f.fen) {
      say(`  resumed from (ply ${b.toPly}):`);
      for (const r of boardRows(resumed.fen, resumed)) say('    ', r);
    }
    if (tail.moves?.length) {
      say('  the abandoned line:');
      const eng = new Map((tail.engine ?? []).map((e) => [e.ply, e]));
      const qs = new Map((tail.quakes ?? []).map((q) => [q.ply, q]));
      const ts = new Map((tail.quakeTraces ?? []).map((t) => [t.ply, t]));
      const fl = new Map();
      for (const x of tail.flags ?? []) fl.set(x.ply, [...(fl.get(x.ply) ?? []), x]);
      for (const l of timelineLines(tail.moves, tail.sans, { engine: eng, quakes: qs, traces: ts, flags: fl, startPly: b.toPly })) say('  ', l);
      // The tail's states carry the ledgers for its own quake boards.
      const tailStates = [...(L.states ?? []).filter((s) => s.ply <= b.toPly), ...(tail.states ?? [])];
      for (const q of tail.quakes ?? []) {
        say('');
        for (const l of quakeBlock(q, ts.get(q.ply), { states: tailStates, attempts: tail.attempts ?? [] })) say('  ', l);
      }
    }
    for (const x of tail.flags ?? []) say(`  ⚑ flag @p${x.ply}${x.note ? `: ${x.note}` : ''}`);
    for (const l of tail.log ?? []) if (l.cls === 'warn' || l.cls === 'bad') say(`  log: ${l.msg}`);
    say('');
  });
}

// -------------------------------------------------------- flags / anomalies

if (wanted.has('flags')) {
  rule(`FLAGS (${L.flags?.length ?? 0} on the line of record)`);
  for (const f of L.flags ?? []) {
    say(`⚑ ply ${f.ply}  ${when(f.at)}${f.note ? `  "${f.note}"` : ''}  game ${f.state}`);
    if (f.fen) for (const r of boardRows(f.fen, f)) say('  ', r);
  }
}

if (wanted.has('anomalies')) {
  rule(`ANOMALIES (${L.anomalies?.length ?? 0})`);
  for (const a of L.anomalies ?? []) say('  ', a);
  const bad = (L.log ?? []).filter((l) => l.cls === 'warn' || l.cls === 'bad');
  if (bad.length) {
    say('warnings the player saw:');
    for (const l of bad) say(`  p${l.ply}  ${l.msg}`);
  }
}

// --------------------------------------------------------------- engine / log

if (wanted.has('engine')) {
  rule(`ENGINE (${L.engine?.length ?? 0} reply searches)`);
  for (const e of L.engine ?? []) say(`p${String(e.ply).padStart(3)}  d${String(e.depth ?? '?').padStart(2)}/${e.seldepth ?? '?'}  ${fmtScore(e.score).padStart(7)}  ${String(e.ms).padStart(6)} ms  ${String(e.nodes ?? '?').padStart(9)} n  ${e.bestmove}  pv ${(e.pv ?? []).slice(0, 8).join(' ')}${e.recovered ? '  RECOVERED' : ''}`);
}

if (wanted.has('log')) {
  rule(`DUEL LOG (${L.log?.length ?? 0} lines the player saw)`);
  for (const l of L.log ?? []) say(`p${String(l.ply).padStart(3)}  ${l.cls ? `[${l.cls}] ` : ''}${l.msg}`);
}

console.log(out.join('\n'));

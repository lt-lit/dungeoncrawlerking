// The replay log's ONE rendering (2026-09-07). Everything that turns a
// `dck-log/1` export (replaylog.mjs buildLog) into words lives here — the
// boards as text, a quake's ladder path and pools, the timeline, the undo
// branches, the delta wording — and BOTH readers import it: the Node
// post-mortem (phase0/harness/log-report.mjs, a thin CLI over renderReport)
// and the in-browser analyzer (replay/js/replay.mjs, the same blocks on the
// real board). One implementation, two hosts, so the phone and the report
// cannot drift (the lab-rig "no ports" law, applied to the reader).
//
// Pure: no DOM, no engine, no ffish. Every function takes the log (or the
// slice of it) explicitly. Old logs (fields missing before replay-log.1/.2:
// `mover`, `candidates`, `pieceList`, …) degrade to shorter lines, never
// throw — every read is optional.
import { parseBoard } from './fen.mjs';

/** jsonSafeNumbers' strings back to numbers ('Infinity', '-Infinity', 'NaN'). */
export const num = (v) => (typeof v === 'string' && /^-?Infinity$|^NaN$/.test(v) ? Number(v) : v);

/** A score as the report writes it: +1.23 / M3 / −M2 / — . */
export const fmtScore = (s) => {
  if (!s) return '—';
  if (s.type === 'mate') return s.value > 0 ? `M${s.value}` : `−M${-s.value}`;
  return `${s.value >= 0 ? '+' : ''}${(s.value / 100).toFixed(2)}`;
};
export const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '?');
export const fileLetter = (f) => String.fromCharCode(97 + f);
export const sqName = (f, r) => `${fileLetter(f)}${r + 1}`;
/** UCI "e2e4" / "f10f9" / "e9e10q" → [from, to, promo] (rank-10 squares are 3 chars — rule 8). */
export const UCI_MOVE_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))(.*)$/;

/** One board as text rows (top rank first). Walls '#', a hole 'O', a
 *  god-cracked wall 'x', authored furniture '^', floor '·'. `files` is the
 *  footer's width when the fen has no ranks (never, in practice). */
export function boardRows(fen, { holes = [], godCrates = [] } = {}, files = 10) {
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

export function sideBySide(a, b, gap = '   →   ') {
  const w = Math.max(...a.map((s) => s.length));
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push((a[i] ?? '').padEnd(w) + (b[i] !== undefined ? gap + b[i] : ''));
  return out;
}

/** The state after ply N — the live one over an `ended` marker on the same ply. */
export const stateAt = (states, ply) => (states ?? []).find((s) => s.ply === ply && !s.ended) ?? (states ?? []).find((s) => s.ply === ply) ?? null;
/** The Director's ledgers as they stood after ply N (what a board paint needs). */
export const ledgersAt = (states, ply) => {
  const s = stateAt(states, ply);
  return s ? { holes: s.holes ?? [], godCrates: s.godCrates ?? [] } : {};
};

/** What a quake did, in one line: "crack f7, breach j3 (frees 1), R a1→a3, hole d4". */
export function quakeSummary(q) {
  const bits = [];
  for (const e of q.terrain ?? []) bits.push(e.kind === 'weaken' ? `crack ${e.square}` : `breach ${e.square}${e.freed ? ` (frees ${e.freed})` : ''}`);
  for (const d of q.displacements ?? []) bits.push(`${d.piece} ${d.from}→${d.to}`);
  if (q.crumble) bits.push(`hole ${q.crumble.square}`);
  if (q.endedGame) bits.push('TERMINAL');
  return bits.join(', ') || '(nothing landed)';
}

/** What one step did to a white-POV score, in words: a mate lost, gained,
 *  shortened, lengthened or flipped, else the swing in pawns. `actor` is
 *  "the move" or "the quake". main.mjs' deep-Δ readout uses the same words. */
export function deltaWords(a, b, actor) {
  if (!a || !b) return `${actor}: —`;
  const mate = (s) => (s.type === 'mate' ? { side: s.value > 0 ? 'white' : 'black', n: Math.abs(s.value) } : null);
  const ma = mate(a);
  const mb = mate(b);
  if (ma && !mb) return `${actor} LOST ${ma.side}'s mate-in-${ma.n}`;
  if (!ma && mb) return `${actor} created a mate-in-${mb.n} for ${mb.side}`;
  if (ma && mb) {
    if (ma.side !== mb.side) return `${actor} FLIPPED the mate (${ma.side} M${ma.n} → ${mb.side} M${mb.n})`;
    if (mb.n === ma.n) return `${actor} kept ${ma.side}'s mate-in-${ma.n}`;
    return `${actor} ${mb.n > ma.n ? 'LENGTHENED' : 'shortened'} ${ma.side}'s mate (M${ma.n} → M${mb.n})`;
  }
  const swing = b.value - a.value;
  if (Math.abs(swing) < 50) return `${actor} kept it (${swing >= 0 ? '+' : ''}${(swing / 100).toFixed(1)})`;
  return `${actor} moved it ${swing >= 0 ? '+' : ''}${(swing / 100).toFixed(1)} for white`;
}

/** A three-board verdict (before the ply's move → before the quake → after
 *  it) on one line, with the words for each step. */
export const threeWay = (d, label) =>
  `  ${label}: before the move ${fmtScore(d.beforeMove)}${d.beforeMove?.depth ? ` (d${d.beforeMove.depth})` : ''} → before the quake ${fmtScore(d.pre)}${d.pre?.depth ? ` (d${d.pre.depth})` : ''} → after ${fmtScore(d.post)}${d.post?.depth ? ` (d${d.post.depth})` : ''} — ${d.beforeMove ? deltaWords(d.beforeMove, d.pre, 'the move') + '; ' : ''}${deltaWords(d.pre, d.post, 'the quake')}`;

/** The rejects of one rung's pool, grouped by reason: "walled_in: a2 a3 | …". */
export function rejectsByReason(c) {
  const byReason = {};
  for (const r of c.rejected ?? []) (byReason[r.reason] ??= []).push(r.sq ?? `${r.piece}${r.from}→${r.to}`);
  return Object.entries(byReason).map(([k, v]) => `${k}: ${v.join(' ')}`).join(' | ') || 'none';
}

/** One roll trace in full: the ladder path, the meters, the rolls, the
 *  ply's classification, the protected set with its members and keys,
 *  every rung's pool ranked with the pick marked and the rejects by
 *  reason, the engine inputs, the gate verdict, timing. */
export function traceDetail(t, indent = '  ') {
  const s = [];
  s.push(`${indent}path ${t.path?.join(' → ')}${t.rungsSpent ? `  rungs ${t.rungsSpent.join(',')}` : ''}  budget ${t.budget ?? '—'}${t.only ? ` only=${t.only}` : ''}${t.fellThrough ? '  FELL THROUGH' : ''}${t.attempt ? `  attempt ${t.attempt}` : ''}`);
  s.push(`${indent}meter ${t.meter} → ${t.meterAfter ?? '—'}  heat ${t.heat}  tedium ${t.tedium}  staleness ${t.staleness}  debt ${t.debtBefore}→${t.debtAfter}  favor ${t.favor}  held ${t.held}`);
  if (t.p) s.push(`${indent}p: quake ${t.p.quake} pressure ${t.p.pressure} meterP ${t.p.meterP} floor ${t.p.floor} dead ${t.p.dead}${t.p.crumbleForced ? ' CRUMBLE FORCED' : ''}`);
  if (t.weights) s.push(`${indent}weights ${JSON.stringify(t.weights)}${t.conserve !== undefined ? `  conserve ${JSON.stringify(t.conserve)}` : ''}`);
  if (t.rolls?.length) s.push(`${indent}rolls ${t.rolls.map((r) => (r.p === undefined ? `${r.roll}=${JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'roll')))}` : `${r.roll}:${r.value}<${r.p}${r.pass ? '✓' : '✗'}`)).join(' ')}`);
  if (t.moveEv || t.stale) {
    const ev = t.moveEv ? Object.entries(t.moveEv).filter(([, v]) => v).map(([k]) => k).join(',') || 'quiet' : '?';
    s.push(`${indent}the ply: ${ev}${t.threatKeys?.length ? `  new threats ${t.threatKeys.join(' ')}` : ''}${t.stale ? `  staleness inputs: ${t.stale.moves} legal, ${t.stale.captures} captures, ${t.stale.lockedPawns} locked pawns, ${t.stale.pieces} pieces` : ''}`);
  }
  if (t.census) s.push(`${indent}census ${JSON.stringify(t.census)}`);
  if (t.protected) {
    const p = t.protected;
    s.push(`${indent}protected ${p.pieces} pieces / ${p.squares} squares  threats ${JSON.stringify(p.threats)}  wins ${JSON.stringify(p.wins)}  nodes ${p.nodes}${p.truncated ? ' (search cut)' : ''}`);
    if (p.pieceList) s.push(`${indent}  pieces ${p.pieceList.join(' ') || '—'}  squares ${p.squareList.join(' ') || '—'}`);
    if (p.keys) s.push(`${indent}  threat keys  white: ${p.keys.white.join(' ') || '—'}  black: ${p.keys.black.join(' ') || '—'}`);
    if (p.by) s.push(`${indent}  by source  ledger: ${p.by.ledger.join(' ') || '—'}  grid wins: ${p.by.wins.join(' ') || '—'}  engine lines: ${p.by.engine.join(' ') || '—'}`);
    if (p.engine) s.push(`${indent}  engine: ${p.engine.hints} hints → ${p.engine.mates} mate lines ${JSON.stringify(p.engine.lines ?? [])}  probes ${JSON.stringify(p.engine.probes ?? null)}`);
  }
  // Every rung's pool, ranked, the pick marked, and the rejects by reason —
  // "why this square" from the log alone.
  for (const [i, c] of (t.candidates ?? []).entries()) {
    const mark = (j) => (j === c.chosen ? ' ◀ CHOSEN' : '');
    const rej = rejectsByReason(c);
    if (c.rung === 'weaken' || c.rung === 'breach') {
      const ranked = c.pool.map((x, j) => ({ x, j })).sort((a, b) => b.x.impact - a.x.impact);
      s.push(`${indent}action ${i + 1} ${c.rung}: ${c.pool.length} candidates${c.pool.length ? ' — ' + ranked.map(({ x, j }) => `${x.sq}(${x.impact}${x.lockedFile ? '·locked file' : ''}${x.freed ? `·frees ${x.freed}` : ''})${mark(j)}`).join(' ') : ''}`);
    } else if (c.rung === 'displace') {
      const tierLine = ['A', 'B', 'C'].map((k) => `${k}: ${c.tiers?.[k]?.map((x) => `${x.piece}${x.from}→${x.to}`).join(' ') || '—'}`).join('  ');
      s.push(`${indent}action ${i + 1} displace from tier ${c.tier ?? 'none'}: ${c.pool.map((x, j) => `${x.piece}${x.from}→${x.to}${mark(j)}`).join(' ') || 'nothing eligible'}`);
      s.push(`${indent}  tiers  ${tierLine}`);
    } else if (c.rung === 'crumble') {
      s.push(`${indent}action ${i + 1} crumble: ${c.pool.length} bare-floor squares${c.chosen !== null && c.chosen !== undefined ? ` — chose ${c.pool[c.chosen]}` : ''}${c.terminal?.length ? `  terminal ${c.terminal.map((x) => `${x.sq}(${x.reason})`).join(' ')}${c.chosenTerminal !== undefined ? ` ◀ ${c.terminal[c.chosenTerminal]?.sq}` : ''}` : ''}`);
      if (c.pool.length) s.push(`${indent}  pool ${c.pool.join(' ')}`);
    }
    s.push(`${indent}  rejected — ${rej}`);
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

/** One rejected draw (v4.3 eval gate) in one or three lines. */
export function attemptLines(a, indent = '  ') {
  const s = [`${indent}✗ rejected draw #${a.attempt}${a.fallback ? ` (${a.fallback})` : ''}: ${a.verdict}  ${fmtScore(a.before)} → ${fmtScore(a.after)}  would have: ${quakeSummary(a)}`];
  if (a.trace?.chosen) s.push(`${indent}  chosen ${JSON.stringify(a.trace.chosen)}`);
  if (a.trace?.path) s.push(`${indent}  path ${a.trace.path.join(' → ')}`);
  return s;
}

/** A quake in full: the board before and after, the eval deltas (the
 *  overlay's shallow one, the in-game deep one, a probe made now), the
 *  roll trace, the rejected draws. `states` supplies the ledgers of the
 *  line the quake sits on (a branch's tail carries its own). */
export function quakeBlock(q, t, { states = [], attempts = [], probe = null, probeGo = null, files = 10, stacked = false } = {}) {
  const s = [];
  s.push(`⚡ ply ${q.ply}  ${quakeSummary(q)}  (seq ${q.seq}, ${when(q.at)})`);
  const pre = boardRows(q.preFen, ledgersAt(states, q.ply - 1), files);
  const post = boardRows(q.postFen, ledgersAt(states, q.ply), files);
  if (stacked) {
    // A phone is too narrow for two boards abreast (the analyzer's choice);
    // the rows are the same, one board under the other.
    s.push('  before:');
    for (const r of pre) s.push('  ' + r);
    s.push('  after:');
    for (const r of post) s.push('  ' + r);
  } else for (const r of sideBySide(pre, post)) s.push('  ' + r);
  if (q.evalDelta) s.push(`  eval delta (white POV): ${fmtScore(q.evalDelta.before)} → ${fmtScore(q.evalDelta.after)}${q.evalDelta.flipped ? '  FLIPPED' : ''}`);
  if (q.deepDelta) s.push(threeWay(q.deepDelta, `deep Δ in game (${q.deepDelta.go}, white POV)`));
  if (probe) s.push(threeWay(probe, `probe now (${probeGo ?? probe.go ?? '?'}, white POV)`));
  if (t) s.push(...traceDetail(t));
  for (const a of attempts.filter((a) => a.ply === q.ply)) s.push(...attemptLines(a, '  '));
  return s;
}

/** Per-ply lookup maps over one line's arrays (the log's, or a branch tail's). */
export function indexLine({ engine = [], quakes = [], quakeTraces = [], flags = [] } = {}) {
  const flagsByPly = new Map();
  for (const f of flags ?? []) flagsByPly.set(f.ply, [...(flagsByPly.get(f.ply) ?? []), f]);
  return {
    engine: new Map((engine ?? []).map((e) => [e.ply, e])),
    quakes: new Map((quakes ?? []).map((q) => [q.ply, q])),
    traces: new Map((quakeTraces ?? []).map((t) => [t.ply, t])),
    flags: flagsByPly,
  };
}

/** Which undo numbers (1-based, in log order) rewound to each ply. */
export function resumedAtMap(L) {
  const resumedAt = new Map();
  (L.branches ?? []).forEach((b, i) => resumedAt.set(b.toPly, [...(resumedAt.get(b.toPly) ?? []), i + 1]));
  return resumedAt;
}

/** The player walked away from a mate the enemy's own search had conceded
 *  (the s75 false alarm): a player state whose predicted reply was not
 *  followed while the engine saw itself mated. */
export const leftMateLine = (st) => st?.mover === 'player' && st.followed === false && st.engineSaw?.type === 'mate' && st.engineSaw.value < 0;

/** The timeline: one line per ply — move, engine eval, the quake or veto,
 *  flags, where an undo resumed (`resumedAt`, the line of record only). */
export function timelineLines(moves, sans, { engine = new Map(), quakes = new Map(), traces = new Map(), flags = new Map(), states = [], startPly = 0, resumedAt = null } = {}) {
  const lines = [];
  for (let i = 0; i < moves.length; i++) {
    const ply = startPly + i + 1;
    lines.push(timelineLine(ply, sans?.[i] ?? moves[i], { engine, quakes, traces, flags, states }));
    if (resumedAt?.has(ply)) for (const k of resumedAt.get(ply)) lines.push(`      ↩ undo #${k} rewound to here (see branches)`);
  }
  return lines;
}

/** One timeline line (the replay screen's status line for a ply). */
export function timelineLine(ply, san, { engine = new Map(), quakes = new Map(), traces = new Map(), flags = new Map(), states = [] } = {}) {
  const n = Math.ceil(ply / 2);
  const white = ply % 2 === 1;
  const e = engine.get(ply);
  const q = quakes.get(ply);
  const t = traces.get(ply);
  const st = stateAt(states, ply);
  let line = `p${String(ply).padStart(3)}  ${String(n).padStart(3)}${white ? '. ' : '… '}${String(san ?? '?').padEnd(8)}`;
  line += e ? ` e:d${e.depth ?? '?'} ${fmtScore(e.score).padStart(6)} ${String(e.ms ?? '?').padStart(5)}ms${e.recovered ? ' RECOVERED' : ''}` : ' '.repeat(23);
  if (leftMateLine(st)) line += `  ⚠ left the engine's mate-in-${-st.engineSaw.value} line (it expected ${st.predicted})`;
  if (t && t.outcome !== 'quiet' && t.outcome !== 'vetoed') line += `  ⚡ ${q ? quakeSummary(q) : t.outcome}${t.evalGate?.attempt ? ` [draw ${t.evalGate.attempt + 1}]` : ''}`;
  else if (t?.outcome === 'vetoed') line += `  ⚡ VETOED (every draw softened)`;
  else if (t?.vetoed) line += `  ⚡ ${t.vetoed} (duel-layer veto)`;
  for (const f of flags.get(ply) ?? []) line += `  ⚑${f.note ? ` ${f.note}` : ''}`;
  return line;
}

// ------------------------------------------------------------- sections

/** One tunes-ledger entry in words: "UNDO(from 40)" or "rampPlies=14 sate=4". */
export const tuneWords = (t) => (t.undo ? `UNDO(from ${t.fromPly})` : Object.entries(t).filter(([k]) => !['ply', 'seq', 'at'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' '));

/** The header block: the deal, the build, the engine limits, the verdict. */
export function headerLines(L) {
  const files = L.files ?? 10;
  const ranks = L.ranks ?? 10;
  const s = [];
  s.push(`schema ${L.schema}  build ${L.meta?.app ?? '?'}  exported ${L.meta?.exportedAt ?? '?'}  started ${L.meta?.startedAt ?? '?'}`);
  if (L.world) s.push(`world ${L.world.id}  "${L.world.title ?? ''}"  the barrier at walk turn ${L.world.walkTurn ?? '?'}  crop (${L.world.crop?.wf ?? '?'}, ${L.world.crop?.wr ?? '?'}) facing ${['north', 'east', 'south', 'west'][L.world.crop?.facing ?? 0]}  ${files}×${ranks}  kings on file ${String.fromCharCode(97 + (L.world.kingFile ?? 0))}  first move ${L.turn}`);
  else s.push(`stage ${L.stage}${L.stageTransformed && L.stageTransformed !== L.stage ? ` (${L.stageTransformed})` : ''}  "${L.title ?? ''}"  ${files}×${ranks}  flip ${L.flip}  crop ${L.crop?.top ?? 0}/${L.crop?.bottom ?? 0}  first move ${L.turn}`);

  s.push(`setup seed ${L.setupSeed} (attempt ${L.dealAttempt})  director seed ${L.seed}  player ${L.player}`);
  if (L.armies) s.push(`armies  W ${JSON.stringify(L.armies.white)}\n        B ${JSON.stringify(L.armies.black)}`);
  s.push(`engine ${L.meta?.engine ?? '?'}  go "${L.go}"  mate probe "${L.mateGo}"  eval gate ${L.evalGate ? JSON.stringify(L.evalGate) : 'off'}  hint probe "${L.meta?.probeGo ?? '?'}"`);
  s.push(`gods preset ${L.meta?.options?.godPreset ?? '?'}${L.meta?.options?.godLadder ? `  ladder ${JSON.stringify(L.meta.options.godLadder)}` : ''}  favor ${L.favor}`);
  s.push(`config0 ${JSON.stringify(L.config0)}`);
  if (L.tunes?.length) s.push(`tunes ${L.tunes.map((t) => `@p${t.ply} ${tuneWords(t)}`).join(' · ')}`);
  s.push(`RESULT ${L.result ?? '(unfinished)'}  ${L.termination ?? ''}  winner ${L.winner ?? '—'}${L.error ? `  ERROR ${L.error}` : ''}`);
  s.push(`plies ${L.plies}  quakes ${L.quakes?.length ?? 0}  rejected draws ${L.attempts?.length ?? 0}  undos ${L.branches?.length ?? 0}  flags ${L.flags?.length ?? 0}  anomalies ${L.anomalies?.length ?? 0}  events ${L.seq}`);
  // A mate the enemy's own search saw against itself, and the player then
  // walked away from: the commonest "the gods delayed my mate" false alarm.
  const leftMate = (L.states ?? []).filter(leftMateLine);
  if (leftMate.length) s.push(`the player left the engine's mate line ${leftMate.length}× (ply ${leftMate.map((s) => s.ply).join(', ')}) — ⚠ marks on the timeline; a quake right after is not what lost it`);
  s.push(`device ${L.meta?.ua ?? '?'}`);
  s.push(`url ${L.meta?.url ?? '?'}${L.meta?.query ?? ''}`);
  return s;
}

/** The line of record's timeline, then the final position. */
export function timelineSection(L) {
  const s = [];
  const idx = indexLine(L);
  const resumedAt = resumedAtMap(L);
  if (resumedAt.has(0)) for (const k of resumedAt.get(0)) s.push(`      ↩ undo #${k} rewound to the start`);
  s.push(...timelineLines(L.moves ?? [], L.sans ?? [], { ...idx, states: L.states ?? [], resumedAt }));
  const last = L.states?.[L.states.length - 1];
  if (last?.fen) {
    s.push('\nfinal position' + (last.ended ? ` (${last.result ?? ''} ${last.termination ?? last.error ?? ''})` : ''));
    for (const r of boardRows(last.fen, last, L.files ?? 10)) s.push('  ' + r);
  }
  return s;
}

/** Every quake on the line of record in full, the vetoed plies, and (with
 *  `onlyPly`) one ply's whole roll trace as JSON. `probes` maps ply → a
 *  three-board probe made now (the CLI's --probe). */
export function quakesSection(L, { onlyPly = null, probes = new Map(), probeGo = null } = {}) {
  const s = [];
  const idx = indexLine(L);
  const files = L.files ?? 10;
  const quakes = (L.quakes ?? []).filter((q) => onlyPly === null || q.ply === onlyPly);
  for (const q of quakes) {
    s.push(...quakeBlock(q, idx.traces.get(q.ply), { states: L.states ?? [], attempts: L.attempts ?? [], probe: probes.get(q.ply) ?? null, probeGo, files }));
    s.push('');
  }
  for (const ply of [...vetoedPlies(L)].filter((p) => onlyPly === null || p === onlyPly)) {
    const t = idx.traces.get(ply);
    s.push(`⚡ ply ${ply}  VETOED — nothing landed, meter spent`);
    s.push(traceDetail(t).map((l) => l + '\n').join(''));
    for (const a of (L.attempts ?? []).filter((a) => a.ply === ply)) s.push(...attemptLines(a, '  ').slice(0, 1));
    s.push('');
  }
  if (onlyPly !== null) {
    const t = idx.traces.get(onlyPly);
    if (t) {
      s.push(`full roll trace @p${onlyPly}:`);
      s.push(JSON.stringify(t, null, 2));
    } else s.push(`no roll trace for ply ${onlyPly}`);
  }
  return s;
}

export const vetoedPlies = (L) => new Set((L.quakeTraces ?? []).filter((t) => t.outcome === 'vetoed').map((t) => t.ply));

/** One undo: the board right before it, where play resumed, the abandoned
 *  line (its timeline, its quakes in full), its flags and warnings. */
export function branchLines(L, b, i) {
  const s = [];
  const files = L.files ?? 10;
  const tail = b.tail ?? {};
  s.push(`↩ undo #${i + 1}  ply ${b.fromPly} → ${b.toPly}  (seq ${b.seq}, ${when(b.at)})  abandoned: ${tail.moves?.length ?? 0} plies, ${tail.quakes?.length ?? 0} quakes, ${tail.attempts?.length ?? 0} rejected draws, ${tail.flags?.length ?? 0} flags`);
  const f = b.from ?? {};
  s.push(`  state right before the undo: ply ${f.ply}, ${f.turn === 'w' ? 'white' : 'black'} to move, game ${f.state}${f.result ? ` (${f.result} ${f.termination ?? ''})` : ''}${f.error ? ` ERROR ${f.error}` : ''}`);
  s.push(`  holes ${JSON.stringify(f.holes ?? [])}  god crates ${JSON.stringify(f.godCrates ?? [])}  debt ${f.debt}  meter ${JSON.stringify(f.meter)}`);
  if (f.fen) for (const r of boardRows(f.fen, f, files)) s.push('    ' + r);
  const resumed = stateAt(L.states, b.toPly);
  if (resumed?.fen && resumed.fen !== f.fen) {
    s.push(`  resumed from (ply ${b.toPly}):`);
    for (const r of boardRows(resumed.fen, resumed, files)) s.push('    ' + r);
  }
  if (tail.moves?.length) {
    s.push('  the abandoned line:');
    const idx = indexLine(tail);
    for (const l of timelineLines(tail.moves, tail.sans, { ...idx, states: tail.states ?? [], startPly: b.toPly })) s.push('  ' + l);
    // The tail's states carry the ledgers for its own quake boards.
    const tailStates = [...(L.states ?? []).filter((s) => s.ply <= b.toPly), ...(tail.states ?? [])];
    for (const q of tail.quakes ?? []) {
      s.push('');
      for (const l of quakeBlock(q, idx.traces.get(q.ply), { states: tailStates, attempts: tail.attempts ?? [], files })) s.push('  ' + l);
    }
  }
  for (const x of tail.flags ?? []) s.push(`  ⚑ flag @p${x.ply}${x.note ? `: ${x.note}` : ''}`);
  for (const l of tail.log ?? []) if (l.cls === 'warn' || l.cls === 'bad') s.push(`  log: ${l.msg}`);
  return s;
}

export function flagLines(L) {
  const s = [];
  for (const f of L.flags ?? []) {
    s.push(`⚑ ply ${f.ply}  ${when(f.at)}${f.note ? `  "${f.note}"` : ''}  game ${f.state}`);
    if (f.fen) for (const r of boardRows(f.fen, f, L.files ?? 10)) s.push('  ' + r);
  }
  return s;
}

export function anomalyLines(L) {
  const s = [];
  for (const a of L.anomalies ?? []) s.push('  ' + a);
  const bad = (L.log ?? []).filter((l) => l.cls === 'warn' || l.cls === 'bad');
  if (bad.length) {
    s.push('warnings the player saw:');
    for (const l of bad) s.push(`  p${l.ply}  ${l.msg}`);
  }
  return s;
}

export const engineLine = (e) => `p${String(e.ply).padStart(3)}  d${String(e.depth ?? '?').padStart(2)}/${e.seldepth ?? '?'}  ${fmtScore(e.score).padStart(7)}  ${String(e.ms).padStart(6)} ms  ${String(e.nodes ?? '?').padStart(9)} n  ${e.bestmove}  pv ${(e.pv ?? []).slice(0, 8).join(' ')}${e.recovered ? '  RECOVERED' : ''}`;
export const engineLines = (L) => (L.engine ?? []).map(engineLine);
export const logLine = (l) => `p${String(l.ply).padStart(3)}  ${l.cls ? `[${l.cls}] ` : ''}${l.msg}`;
export const logLines = (L) => (L.log ?? []).map(logLine);

export const SECTION_NAMES = ['header', 'timeline', 'quakes', 'branches', 'flags', 'anomalies', 'engine', 'log'];
export const DEFAULT_SECTIONS = ['header', 'timeline', 'quakes', 'branches', 'flags', 'anomalies'];

export const sectionRule = (title) => `\n${'═'.repeat(8)} ${title} ${'═'.repeat(Math.max(0, 60 - title.length))}`;

/** The whole post-mortem as text — what the Node CLI prints. `sections`
 *  in SECTION_NAMES order; `probes` (ply → three-board probe) and
 *  `probeGo` come from the CLI's --probe. */
export function renderReport(L, { sections = DEFAULT_SECTIONS, onlyPly = null, probes = new Map(), probeGo = null } = {}) {
  const wanted = new Set(sections);
  const out = [];
  if (wanted.has('header')) {
    out.push(sectionRule('REPLAY LOG'));
    out.push(...headerLines(L));
  }
  if (wanted.has('timeline')) {
    out.push(sectionRule('TIMELINE (the line of record)'));
    out.push(...timelineSection(L));
  }
  if (wanted.has('quakes')) {
    out.push(sectionRule(`QUAKES (${L.quakes?.length ?? 0} landed, ${vetoedPlies(L).size} vetoed plies, ${L.attempts?.length ?? 0} rejected draws)${probeGo ? ` — probed now at "${probeGo}"` : ''}`));
    out.push(...quakesSection(L, { onlyPly, probes, probeGo }));
  }
  if (wanted.has('branches')) {
    out.push(sectionRule(`UNDOS (${L.branches?.length ?? 0})`));
    (L.branches ?? []).forEach((b, i) => {
      out.push(...branchLines(L, b, i));
      out.push('');
    });
  }
  if (wanted.has('flags')) {
    out.push(sectionRule(`FLAGS (${L.flags?.length ?? 0} on the line of record)`));
    out.push(...flagLines(L));
  }
  if (wanted.has('anomalies')) {
    out.push(sectionRule(`ANOMALIES (${L.anomalies?.length ?? 0})`));
    out.push(...anomalyLines(L));
  }
  if (wanted.has('engine')) {
    out.push(sectionRule(`ENGINE (${L.engine?.length ?? 0} reply searches)`));
    out.push(...engineLines(L));
  }
  if (wanted.has('log')) {
    out.push(sectionRule(`DUEL LOG (${L.log?.length ?? 0} lines the player saw)`));
    out.push(...logLines(L));
  }
  return out.join('\n');
}

// ------------------------------------------------------------ the tree

/**
 * The undo history as a TREE of lines (the analyzer steps into a branch;
 * the flat report prints them in order). The line of record is `main`;
 * every branch is the tail an undo cut off, hanging off the line that was
 * current when it happened. Recovered from `seq` alone: a branch's parent
 * is the EARLIEST later undo that rewound BELOW its fork ply (that undo
 * moved the plies the branch forked from into its own tail), else main.
 * Each line carries full per-ply arrays from ply 0 — the parent's prefix
 * up to the fork, then the tail — so a reader scrubs any line the same way.
 */
export function lineTree(L) {
  const branches = (L.branches ?? []).map((b, i) => ({ b, i, seq: b.seq ?? i + 1 }));
  const keys = ['moves', 'sans', 'states', 'quakeTraces', 'quakes', 'attempts', 'engine', 'anomalies', 'log', 'flags'];
  const main = { id: 'main', name: 'the line of record', parent: null, forkPly: 0, from: null, undo: null, forks: [] };
  for (const k of keys) main[k] = L[k] ?? [];
  main.plies = L.moves?.length ?? 0;
  const lines = [main];
  // Resolve parents oldest first: a branch's parent is either main or a
  // branch with a HIGHER seq, which the loop below has not built yet — so
  // build all headers first, then fill the arrays in reverse seq order.
  const nodes = branches.map(({ b, i, seq }) => ({ id: `branch-${i + 1}`, name: `undo #${i + 1} (ply ${b.fromPly} → ${b.toPly})`, index: i, seq, forkPly: b.toPly, from: b.from ?? null, undo: b, parentNode: null, forks: [] }));
  for (const n of nodes) {
    const later = nodes.filter((m) => m.seq > n.seq && m.forkPly < n.forkPly).sort((a, b) => a.seq - b.seq);
    n.parentNode = later[0] ?? null;
  }
  const fill = (n) => {
    if (n.filled) return n;
    const parent = n.parentNode ? fill(n.parentNode) : main;
    n.parent = parent.id;
    const tail = n.undo.tail ?? {};
    for (const k of keys) {
      const all = parent[k] ?? [];
      // The prefix: the parent's entries up to the fork. Anomalies are bare
      // strings ("ply N: …"); everything else carries `ply`.
      const pre =
        k === 'moves' || k === 'sans'
          ? all.slice(0, n.forkPly)
          : k === 'anomalies'
            ? all.filter((a) => (parseInt(String(a).match(/^ply (\d+)/)?.[1] ?? '0', 10) || 0) <= n.forkPly)
            : all.filter((e) => (e?.ply ?? 0) <= n.forkPly);
      n[k] = [...pre, ...(tail[k] ?? [])];
    }
    n.plies = n.moves.length;
    n.filled = true;
    parent.forks.push(n);
    lines.push(n);
    return n;
  };
  for (const n of [...nodes].sort((a, b) => b.seq - a.seq)) fill(n);
  for (const n of lines) {
    n.forks.sort((a, b) => a.forkPly - b.forkPly || a.seq - b.seq);
    delete n.parentNode;
    delete n.filled;
  }
  return { main, lines, byId: new Map(lines.map((n) => [n.id, n])) };
}

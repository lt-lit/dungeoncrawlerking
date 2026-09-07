// The replay analyzer's smoke (2026-09-07): drive replay/index.html in
// headless Chromium through window.__DCK.replay on the committed sample log
// and assert what the eye would check — the sample loads with its stage's
// skins, scrubbing paints every state's own fen, a quake ply wears the
// gods' marks and the residue a captured cracked wall leaves, the why panel
// carries the pick, the overlays (before / pool / protected / rejected draw)
// paint and clear, a branch steps in and out with the pre-undo board as its
// last, the probe engine boots on demand and attaches an eval and a deep Δ
// to the log, the annotated export round-trips, the report copies, and a
// file-loaded log with the why layer stripped still scrubs. Screenshots
// land in phase0/results/replay-smoke/ for the eye.
//
// Setup (once): cd phase0 && npm i --no-save playwright  (Chromium: see
// selftest-headless.mjs). Usage: cd phase0 && node harness/replay-smoke.mjs
//   [--shots] [--go 'depth 6 movetime 300'] [--log path.json]
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'phase0/results/replay-smoke');
const PORT = 8933;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const SHOTS = argv.includes('--shots');
const GO = arg('go', 'depth 6 movetime 300');
const SAMPLE = 'replay/samples/dck-log_s77-the-smithy_s1818861954.json';
const LOG = arg('log', path.join(ROOT, SAMPLE));
const L = JSON.parse(fs.readFileSync(LOG, 'utf8'));

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const failures = [];
const notes = [];
const expect = (ok, what) => {
  if (ok) notes.push(`ok  ${what}`);
  else failures.push(what);
};

const executablePath = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
});
if (SHOTS) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
}
const shot = async (name, full = false) => {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
};
const view = () => page.evaluate(() => {
  const v = window.__DCK.replay.view;
  return { ...v, cell: undefined, skinCount: Object.keys(v.skins ?? {}).length, skins: undefined };
});
const cells = (sqs) => page.evaluate((sqs) => Object.fromEntries(sqs.map((s) => [s, window.__DCK.replay.view.cell(s)])), sqs);

// ------------------------------------------------------------- load (URL)
const q = new URLSearchParams({ url: `../${SAMPLE}`, fx: '0', go: GO });
await page.goto(`http://127.0.0.1:${PORT}/replay/index.html?${q}`);
await page.evaluate(() => window.__DCK.ready);
let v = await view();
expect(v.line === 'main' && v.ply === 0 && v.plies === L.plies, `sample loads on the line of record (${v.plies} plies)`);
expect(v.fen === L.states[0].fen, 'ply 0 paints the start position');
expect(v.stage === L.stage && v.skinCount > 0 && !v.stageNote, `stage ${v.stage} resolved with ${v.skinCount} skinned squares${v.stageNote ? ` — ${v.stageNote}` : ''}`);
expect(!!v.theme, `the board wears the stage's theme (${v.theme})`);
expect(await page.evaluate(() => document.getElementById('load-panel').hidden && !document.getElementById('screen-replay').hidden), 'the load panel folds away, the replay screen shows');
await shot('00-loaded');

// ------------------------------------------------------------- scrub
const quake = L.quakes[0];
const crack = quake.terrain.find((e) => e.kind === 'weaken')?.square;
const breach = quake.terrain.find((e) => e.kind === 'breach')?.square;
await page.evaluate((p) => window.__DCK.replay.goto(p), quake.ply);
v = await view();
expect(v.ply === quake.ply && v.fen === L.states.find((s) => s.ply === quake.ply).fen, `goto ${quake.ply} paints that ply's fen`);
expect(v.godsLine.includes('the gods') && v.plyLine.includes('⚡'), `the gods line and the ply line name the quake ("${v.godsLine}")`);
expect(crack ? v.marks.cracked.includes(crack) : true, `the crack at ${crack} is a fresh-crack mark`);
expect(breach ? v.marks.breached.includes(breach) : true, `the breach at ${breach} is a fresh-breach mark`);
expect(v.marks.arrows.some((a) => a.kind === 'last'), 'the enemy\'s move is the red arrow');
let c = await cells([crack, breach].filter(Boolean));
if (crack) expect(c[crack]?.includes('cracked') && c[crack]?.includes('fresh-crack') && c[crack]?.some((x) => x.startsWith('wm-')), `${crack} paints as a cracked wall with an autotile case (${c[crack]?.join(' ')})`);
if (breach) expect(c[breach]?.includes('fresh-breach') && !c[breach]?.includes('wall') && !c[breach]?.includes('furniture'), `${breach} paints as floor with the breach frame (${c[breach]?.join(' ')})`);
expect(/\+\d|−M|M\d/.test(v.evalText), `the eval bar reads the enemy's search (${v.evalText})`);
await shot(`01-quake-p${quake.ply}`);
// The strips under the scrubber: the gods' stats + eval on one x-axis, a
// tick per quake, the readout at the cursor, tap and drag to scrub.
const trace12 = L.quakeTraces.find((t) => t.ply === quake.ply);
const strips = v.strips;
expect(strips && strips.plies === L.plies && strips.pressure >= L.plies - 2, `the strips cover ${strips?.pressure} of ${L.plies} plies with a pressure value`);
expect(strips && Object.entries(strips.ticks).filter(([, k]) => k === 'quake').length === L.quakes.length, `one quake tick per landed quake (${JSON.stringify(strips?.ticks)})`);
expect(strips && strips.readout.pressure === trace12.p.quake.toFixed(2) && strips.readout.tedium === trace12.tedium.toFixed(2) && strips.readout.heat === trace12.heat.toFixed(2), `the readout at ply ${quake.ply} is the trace's P(quake) / tedium / heat (${JSON.stringify(strips?.readout)})`);
expect(strips && /^[+−-]\d/.test(strips.readout.eval) && strips.readout.probed === false, `the eval readout reads the enemy's search (${strips?.readout.eval})`);
expect(strips && strips.readout.fun === (1 - trace12.staleness).toFixed(2), `fun is 1 − staleness (${strips?.readout.fun})`);
expect(strips && Math.abs(strips.cursorX - (4 + ((strips.width - 8 - 14) * quake.ply) / L.plies)) < 1, 'the cursor hairline stands on the ply');
expect(strips && ['pressure', 'tedium', 'heat', 'fun', 'eval'].every((k) => strips.drawn.includes(k)) && strips.labels.join('') .length === 4 && new Set(strips.labels).size === 4, `every series is drawn and the four gods lines carry direct labels (${strips?.labels.join('')})`);
// The legend toggles: a series hides, its button reads off, the choice survives a reload.
{
  const off = await page.evaluate(() => {
    document.querySelector('.sw-btn[data-series="tedium"]').click();
    const v = window.__DCK.replay.view.strips;
    return { drawn: v.drawn, hidden: v.hidden, labels: v.labels, btnOff: document.querySelector('.sw-btn[data-series="tedium"]').classList.contains('off') };
  });
  expect(!off.drawn.includes('tedium') && off.hidden.join() === 'tedium' && off.btnOff && off.labels.length === 3, `tapping the legend hides tedium (drawn ${off.drawn.join(',')}, labels ${off.labels.join('')})`);
  await shot('01a-strip-toggled');
  await page.reload();
  await page.evaluate(() => window.__DCK.ready);
  const kept = await page.evaluate(() => window.__DCK.replay.view.strips.hidden);
  expect(kept.join() === 'tedium', 'the toggle persists across a reload');
  const back = await page.evaluate(() => window.__DCK.replay.toggleSeries('tedium') && window.__DCK.replay.view.strips.drawn.includes('tedium'));
  expect(back, 'and toggles back on');
  await page.evaluate((p) => window.__DCK.replay.goto(p), quake.ply);
}
{
  const box = await page.evaluate(() => {
    const r = document.getElementById('strip-gods').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  // The plot spans the SVG less its padding and the label column (4 + 4 + 14 px).
  const plyAt = (frac) => Math.round(((frac * box.w - 4) / (box.w - 22)) * L.plies);
  await page.mouse.click(box.x + box.w * 0.5, box.y + box.h / 2);
  const tapped = await page.evaluate(() => window.__DCK.replay.view.ply);
  expect(Math.abs(tapped - plyAt(0.5)) <= 1, `a tap at the strip's middle scrubs to ply ${tapped} (expected ~${plyAt(0.5)})`);
  await page.mouse.move(box.x + box.w * 0.2, box.y + box.h / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.9, box.y + box.h / 2, { steps: 4 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => window.__DCK.replay.view.ply);
  expect(Math.abs(dragged - plyAt(0.9)) <= 1, `a drag to 90% scrubs to ply ${dragged} (expected ~${plyAt(0.9)})`);
  await page.evaluate((p) => window.__DCK.replay.goto(p), quake.ply);
}
// The why panel: the pick is marked, the tools are there.
const why = await page.evaluate(() => ({ text: document.getElementById('sec-quake-body').textContent, buttons: [...document.querySelectorAll('#sec-quake-body .tools button')].map((b) => b.textContent) }));
expect(why.text.includes('◀ CHOSEN') && why.text.includes('path '), 'the why panel prints the ladder path and marks the pick');
expect(why.buttons.some((b) => b === 'before') && why.buttons.some((b) => /^\d: (weaken|breach|displace|crumble)/.test(b)), `the why panel offers before + the pools (${why.buttons.join(' | ')})`);
expect(why.text.includes('before:') && why.text.includes('after:'), 'the quake block stacks its two boards for the phone');

// The captured cracked wall leaves a ruin later on.
let ruinPly = null;
if (crack) {
  for (const s of L.states) {
    if (s.ply <= quake.ply) continue;
    const board = s.fen.split(' ')[0];
    // crude: the crack square no longer holds '^' once captured — find the first such state via the page's own residue
    await page.evaluate((p) => window.__DCK.replay.goto(p), s.ply);
    const cc = await cells([crack]);
    if (cc[crack]?.includes('ruin')) {
      ruinPly = s.ply;
      break;
    }
    void board;
  }
  expect(ruinPly !== null, `the cracked wall at ${crack} wears the ruin stub once captured (from ply ${ruinPly})`);
  if (ruinPly !== null) await shot(`02-ruin-p${ruinPly}`);
}
// Step controls.
await page.evaluate(() => window.__DCK.replay.goto(0));
await page.evaluate(() => window.__DCK.replay.next());
await page.evaluate(() => window.__DCK.replay.next());
v = await view();
expect(v.ply === 2 && v.fen === L.states.find((s) => s.ply === 2).fen, 'next/next lands on ply 2');
const nq = await page.evaluate(() => window.__DCK.replay.nextQuake());
expect(nq === quake.ply, `next quake jumps to ply ${quake.ply}`);
await page.evaluate(() => window.__DCK.replay.goto(9999));
v = await view();
expect(v.ply === L.plies && v.plyLine.includes('game over'), `the end clamps to ply ${L.plies} and says the game is over`);

// ------------------------------------------------------------- overlays
await page.evaluate((p) => window.__DCK.replay.goto(p), quake.ply);
let s = await page.evaluate(() => {
  const r = window.__DCK.replay.show('before');
  return { showing: r?.kind, fen: window.__DCK.replay.view.fen };
});
expect(s.showing === 'before' && s.fen === quake.preFen, 'before paints the pre-quake board');
await shot('03-before');
s = await page.evaluate(() => {
  window.__DCK.replay.show(null);
  return window.__DCK.replay.view.fen;
});
expect(s === L.states.find((x) => x.ply === quake.ply).fen, 'and clears back to the ply');
const trace = L.quakeTraces.find((t) => t.ply === quake.ply);
if (trace?.candidates?.length) {
  const pool = await page.evaluate(() => {
    const r = window.__DCK.replay.show({ kind: 'pool', index: 0 });
    const v = window.__DCK.replay.view;
    return { showing: r?.kind, heat: v.marks.heat ?? {} };
  });
  const cand = trace.candidates[0];
  const chosenSq = cand.rung === 'displace' ? cand.pool[cand.chosen]?.to : cand.rung === 'crumble' ? cand.pool[cand.chosen] : cand.pool[cand.chosen]?.sq;
  expect(pool.showing === 'pool' && pool.heat[chosenSq] === 'a', `the pool overlay paints the pick ${chosenSq} gold`);
  expect(Object.values(pool.heat).filter((h) => h === 'b').length === cand.pool.length - 1, 'and the rest of the pool blue');
  await shot('04-pool');
  await page.evaluate(() => window.__DCK.replay.show(null));
}
// A quake with a protected set, if the log has one.
const protectedQ = L.quakes.find((qq) => (L.quakeTraces.find((t) => t.ply === qq.ply)?.protected?.pieces ?? 0) > 0);
if (protectedQ) {
  await page.evaluate((p) => window.__DCK.replay.goto(p), protectedQ.ply);
  const pr = await page.evaluate(() => {
    window.__DCK.replay.show('protected');
    return window.__DCK.replay.view.marks.heat ?? {};
  });
  const t = L.quakeTraces.find((x) => x.ply === protectedQ.ply);
  expect(t.protected.pieceList.every((sq) => pr[sq] === 'a'), `protected overlay at ply ${protectedQ.ply}: ${t.protected.pieceList.length} pieces gold`);
  await shot(`05-protected-p${protectedQ.ply}`);
  await page.evaluate(() => window.__DCK.replay.show(null));
} else notes.push('--  no quake with a protected set in this log (protected overlay untested)');
const attemptQ = (L.attempts ?? [])[0];
if (attemptQ) {
  await page.evaluate((p) => window.__DCK.replay.goto(p), attemptQ.ply);
  const at = await page.evaluate(() => {
    window.__DCK.replay.show({ kind: 'attempt', index: 0 });
    return window.__DCK.replay.view.fen;
  });
  expect(at === attemptQ.postFen, `the rejected draw overlay paints the board it would have left (ply ${attemptQ.ply})`);
  await page.evaluate(() => window.__DCK.replay.show(null));
} else notes.push('--  no rejected draws in this log (attempt overlay untested)');

// ------------------------------------------------------------- branches
if (L.branches?.length) {
  const b = L.branches[0];
  const entered = await page.evaluate(() => window.__DCK.replay.enterBranch('branch-1'));
  v = await view();
  expect(entered && v.line === 'branch-1' && v.ply === b.toPly + 1, `step into undo #1: ply ${v.ply} of ${v.plies} on ${v.lineName}`);
  await page.evaluate(() => window.__DCK.replay.goto(9999));
  v = await view();
  expect(v.ply === b.fromPly && v.fen === b.from.fen, 'the branch ends on the exact pre-undo board');
  await shot('06-branch');
  const left = await page.evaluate(() => window.__DCK.replay.leaveBranch());
  v = await view();
  expect(left && v.line === 'main' && v.ply === b.toPly, `step out lands on the line of record at ply ${b.toPly}`);
  const tl = await page.evaluate(() => ({ forks: document.querySelectorAll('#sec-timeline-body .tl-row.fork').length, rows: document.querySelectorAll('#sec-timeline-body .tl-row').length, undos: document.querySelectorAll('#sec-undos-body .undo-row').length }));
  expect(tl.forks === L.branches.length && tl.undos === L.branches.length, `the timeline shows ${tl.forks} fork rows, the undos section ${tl.undos} branches`);
  expect(tl.rows === L.plies + 1 + L.branches.length, `the timeline has a row per ply (${tl.rows})`);
} else notes.push('--  no undos in this log (branches untested)');

// ------------------------------------------------------------- probes
await page.evaluate((p) => window.__DCK.replay.goto(p), quake.ply);
const queued = await page.evaluate(() => window.__DCK.replay.probe());
expect(queued, 'an eval probe queues');
await page.evaluate(() => window.__DCK.replay.waitIdle());
v = await view();
const stProbe = await page.evaluate((p) => window.__DCK.replay.log.states.find((s) => s.ply === p)?.probe ?? null, quake.ply);
expect(stProbe && ['cp', 'mate'].includes(stProbe.type) && stProbe.depth > 0 && stProbe.go === GO, `the probe attaches to the state (${JSON.stringify(stProbe)?.slice(0, 80)})`);
expect(v.plyLine.includes('probe (') && v.engine.includes('ready'), `the ply line shows the probe and the engine is ready (${v.engine})`);
expect(v.evalText.includes('probe'), `the eval bar switched to the probe (${v.evalText})`);
expect(v.strips?.probes.includes(quake.ply) && v.strips.readout.probed === true, `the probe is a dot on the eval strip and the readout reads it (${v.strips?.readout.eval})`);
await shot('07a-strips-probed');
const deepQ = await page.evaluate(() => window.__DCK.replay.deep());
expect(deepQ, 'a deep Δ probe queues');
await page.evaluate(() => window.__DCK.replay.waitIdle());
const dd = await page.evaluate((p) => window.__DCK.replay.log.quakes.find((qq) => qq.ply === p)?.deepDelta ?? null, quake.ply);
expect(dd && dd.beforeMove && dd.pre && dd.post && dd.replay === true, `deep Δ attaches three verdicts to the quake (${dd ? `${dd.beforeMove.value} → ${dd.pre.value} → ${dd.post.value}` : 'none'})`);
const deepShown = await page.evaluate(() => document.getElementById('sec-quake-body').textContent.includes('deep Δ in game'));
expect(deepShown, 'the why panel prints the deep Δ verdict');
await shot('07-probed');
// The probe's line as arrows.
const pvArrows = await page.evaluate(() => {
  document.getElementById('btnProbePv').click();
  return window.__DCK.replay.view.marks.arrows.filter((a) => a.label).length;
});
expect(pvArrows > 0 && pvArrows <= 6, `the probe's line paints as ${pvArrows} numbered arrows`);
await page.evaluate(() => document.getElementById('btnProbePv').click());

// ------------------------------------------------------------- export + report
const rep = await page.evaluate(() => window.__DCK.replay.report());
expect(rep.includes('═ REPLAY LOG') && rep.includes('deep Δ in game') && rep.includes('═ UNDOS'), `the report renders in the browser (${(rep.length / 1024).toFixed(0)} KB) with the probe in it`);
const exported = await page.evaluate(async () => {
  const how = await window.__DCK.replay.export('clipboard').catch((e) => `error ${e.message}`);
  const data = window.__DCK.replay.log;
  return { how, analyzed: data.meta?.analyzed ?? null, hasProbe: !!data.states.find((s) => s.probe), json: JSON.stringify(data).length };
});
expect(['copied', 'console', 'downloaded'].includes(exported.how) && exported.analyzed?.probes === 2 && exported.hasProbe, `the annotated log exports (${exported.how}, ${(exported.json / 1024).toFixed(0)} KB, ${exported.analyzed?.probes} probes)`);

// ------------------------------------------------------------- an old-shape log through the object path
const old = JSON.parse(JSON.stringify(L));
for (const st of old.states) for (const k of ['move', 'san', 'mover', 'predicted', 'followed', 'engineSaw']) delete st[k];
for (const t of old.quakeTraces) for (const k of ['candidates', 'moveEv', 'threatKeys', 'stale', 'inputs']) delete t[k];
delete old.autoCrop;
delete old.attempts;
old.stage = 's01-nowhere'; // a stage this build does not carry
// Synthetic tunes: one on the line of record (seq outside every branch), one
// inside undo #1's tail (seq between its first tail entry and the branch).
const b1 = L.branches[0];
const tailSeq = b1.tail.states[0].seq + 1;
old.tunes = [...(old.tunes ?? []), { ply: 5, seq: 20, rampPlies: 14, sate: 4 }, { ply: b1.toPly + 1, seq: tailSeq, favor: 2 }];
const oldRes = await page.evaluate(async (data) => {
  await window.__DCK.replay.open(data, 'old-shape');
  window.__DCK.replay.goto(12);
  const v = window.__DCK.replay.view;
  return { ply: v.ply, fen: v.fen, note: v.stageNote, skins: Object.keys(v.skins).length, godsLine: v.godsLine, why: document.getElementById('sec-quake-body').textContent.slice(0, 60) };
}, old);
expect(oldRes.ply === 12 && oldRes.fen === L.states.find((s) => s.ply === 12).fen, 'an old-shape log (no why layer, no state annotations) scrubs');
expect(oldRes.note.includes('not in this build') && oldRes.skins === 0, `a missing stage is said and paints without skins ("${oldRes.note}")`);
expect(oldRes.godsLine.includes('the gods'), 'its quake still reads on the gods line');
const tuneRows = await page.evaluate(() => {
  const rows = (sel) => [...document.querySelectorAll(sel)].map((d) => d.textContent.trim());
  const main = rows('#sec-timeline-body .tl-row.tune');
  window.__DCK.replay.enterBranch('branch-1');
  const branch = rows('#sec-timeline-body .tl-row.tune');
  window.__DCK.replay.leaveBranch();
  return { main, branch };
});
expect(tuneRows.main.length === 1 && tuneRows.main[0].includes('@p5: rampPlies=14 sate=4'), `a tune on the line of record is a timeline row (${JSON.stringify(tuneRows.main)})`);
expect(tuneRows.branch.length === 1 && tuneRows.branch[0].includes('favor=2'), `a tune made inside an abandoned line shows on that branch only (${JSON.stringify(tuneRows.branch)})`);

// ------------------------------------------------------------- the load panel: saved ring + paste
const pasted = await page.evaluate(async (json) => {
  document.getElementById('btnLoadToggle').click();
  document.getElementById('pasteBox').value = json;
  document.getElementById('btnPasteOpen').click();
  await new Promise((r) => setTimeout(r, 300));
  while (!window.__DCK.replay.view.stage && !window.__DCK.replay.view.stageNote) await new Promise((r) => setTimeout(r, 50));
  return { stage: window.__DCK.replay.view.stage, plies: window.__DCK.replay.view.plies, panelHidden: document.getElementById('load-panel').hidden };
}, JSON.stringify(L));
expect(pasted.stage === L.stage && pasted.plies === L.plies && pasted.panelHidden, 'pasted JSON opens through the real button');
const ring = await page.evaluate(() => {
  localStorage.setItem('dck.log.v1.1', JSON.stringify(window.__DCK.replay.log));
  localStorage.setItem('dck.log.v1.index', JSON.stringify([{ slot: 1, at: Date.now(), id: 'x', stage: 's77-the-smithy', title: 'The Smithy', plies: 77, result: '1-0' }]));
  document.getElementById('btnLoadToggle').click();
  return { rowHidden: document.getElementById('saved-row').hidden, options: document.getElementById('savedLogSel').options.length };
});
expect(!ring.rowHidden && ring.options === 1, 'the game\'s autosave ring shows on the load panel');
await page.goto(`http://127.0.0.1:${PORT}/replay/index.html?latest=1&fx=0`);
await page.evaluate(() => window.__DCK.ready);
v = await view();
expect(v.plies === L.plies && v.line === 'main', '?latest=1 opens the newest saved log');
await shot('08-latest', true);

expect(pageErrors.length === 0, `no page errors${pageErrors.length ? ` — ${pageErrors.join(' | ')}` : ''}`);

await browser.close();
server.close();
for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`SUMMARY: ${notes.length} ok, ${failures.length} failed${SHOTS ? ` — screenshots in ${OUT}` : ''}`);
process.exit(failures.length ? 1 : 0);

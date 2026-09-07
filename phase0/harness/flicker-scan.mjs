// THE FLICKER RECORDER + BLINK SCANNER (2026-09-07, the debris layer's
// three flicker rounds). Records a duel — or an idle player turn — in
// Playwright's Firefox or Chromium at a phone or desktop viewport, splits
// the video into frames, and scans them for SQUARES THAT BLINK: a square
// whose mean colour jumps and comes back within a few frames. Reports the
// biggest, the whole-board frames (headless Firefox records white/black
// frames on every build — a capture artefact, ignore them), and for
// s59-hall-corner the door (g5) and torch (h5) vanishes that caught the
// piece z-index bug. An idle recording also carries a per-frame DOM
// sampler (every .piece present and visible?) and a mutation log of the
// board, so a rendering glitch and a DOM change are told apart.
//
// Usage (cd phase0; Firefox once: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
// npx playwright install firefox):
//   node harness/flicker-scan.mjs record --out /tmp/cast [--browser firefox|chromium]
//        [--stage s59-hall-corner] [--plies 24] [--idle 25000] [--debris off|all|list] [--renderer dom|canvas]
//        [--desktop] [--root <repo>] [--port 8960]
//   node harness/flicker-scan.mjs scan /tmp/cast
//   node harness/flicker-scan.mjs compare /tmp/castA /tmp/castB …
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { decodePng } from '../lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const mode = argv[0];
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.ini': 'text/plain' };

async function record() {
  const { firefox, chromium } = await import('playwright');
  const ROOT = path.resolve(arg('root', path.resolve(HERE, '../..')));
  const OUT = path.resolve(arg('out', '/tmp/dck-cast'));
  const PORT = parseInt(arg('port', '8960'), 10);
  const browserName = arg('browser', 'firefox');
  const stage = arg('stage', 's59-hall-corner');
  const plies = parseInt(arg('plies', '24'), 10);
  const idleMs = parseInt(arg('idle', '0'), 10);
  const debris = arg('debris', null);
  const desktop = flag('desktop');
  const size = desktop ? { width: 1100, height: 900 } : { width: 390, height: 844 };
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const launcher = browserName === 'chromium' ? chromium : firefox;
  const exe = process.env.BROWSER_EXE ?? (browserName === 'chromium' && fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await launcher.launch({ ...(exe ? { executablePath: exe } : {}), args: browserName === 'chromium' ? ['--no-sandbox'] : [] });
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: OUT, size } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  const renderer = arg('renderer', null); // PHASE 2: --renderer canvas records the canvas board
  const q = new URLSearchParams({ stage, autobegin: '1', seed: '3', go: 'depth 6 movetime 100', probe: 'depth 4 movetime 50', onset: '1', mramp: '2', debt: '2', ...(debris ? { debris } : {}), ...(renderer ? { renderer } : {}) });
  await page.goto(`http://127.0.0.1:${PORT}/play/index.html?${q}`);
  await page.waitForFunction(() => window.__DCK?.app?.duel?.state === 'playing', null, { timeout: 120000 });
  if (idleMs) await page.evaluate(() => { const o = window.__DCK.options; o.cheat = true; o.hints = true; o.hintN = 3; o.evalBar = true; window.__DCK.applyOptions(); });
  await page.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const rect = await page.evaluate(() => { const r = document.getElementById('board').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, files: window.__DCK.app.boardUI.files, ranks: window.__DCK.app.boardUI.ranks }; });
  const t0 = Date.now();
  const log = await page.evaluate(async ({ plies, idleMs }) => {
    const K = window.__DCK;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const board = document.getElementById('board');
    const muts = [];
    const mo = new MutationObserver((list) => { for (const m of list) muts.push({ t: performance.now(), type: m.type, target: m.target.nodeType === 1 ? `${m.target.tagName.toLowerCase()}.${[...m.target.classList].slice(0, 3).join('.')}` : '#text', attr: m.attributeName }); });
    mo.observe(board, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'data-piece', 'data-pieces', 'data-theme', 'data-debris'] });
    const marks = [];
    for (let i = 0; i < plies && K.app.duel.state === 'playing'; i++) {
      const before = K.app.duel.record.quakes.length, sans = K.app.duel.record.sans.length;
      await K.playerMove(K.randomMove());
      const t1 = Date.now();
      while ((K.app.busy || K.debris?.busy) && Date.now() - t1 < 30000) await wait(30);
      if (K.app.duel.record.quakes.length > before) marks.push({ t: Date.now(), what: `quake after ply ${K.app.duel.ply}` });
      if (K.app.duel.record.sans.slice(sans).some((s) => s.includes('x'))) marks.push({ t: Date.now(), what: `capture by ply ${K.app.duel.ply}` });
    }
    const idleStart = performance.now();
    const samples = [];
    if (idleMs) {
      await new Promise((done) => {
        const tick = () => {
          const pieces = [...document.querySelectorAll('#board .piece')];
          const vis = pieces.filter((p) => { const cs = getComputedStyle(p); return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.5; }).length;
          samples.push({ t: Math.round(performance.now() - idleStart), n: pieces.length, vis });
          if (performance.now() - idleStart < idleMs) requestAnimationFrame(tick); else done();
        };
        requestAnimationFrame(tick);
      });
    }
    mo.disconnect();
    return { marks, samples, muts: muts.map((m) => ({ ...m, t: Math.round(m.t - idleStart) })), stats: K.debris?.stats?.() ?? null };
  }, { plies, idleMs });
  const video = page.video();
  await ctx.close();
  const vpath = await video.path();
  await browser.close();
  server.close();
  const ffmpeg = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('ffmpeg')).map((d) => path.join('/opt/pw-browsers', d, 'ffmpeg-linux')).find((p) => fs.existsSync(p)) ?? 'ffmpeg';
  execFileSync(ffmpeg, ['-loglevel', 'error', '-i', vpath, path.join(OUT, 'f%04d.png')]);
  const frames = fs.readdirSync(OUT).filter((f) => /^f\d+\.png$/.test(f)).length;
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ rect, size, browser: browserName, stage, plies, idleMs, debris, t0, marks: log.marks.map((m) => ({ ...m, t: m.t - t0 })), samples: log.samples, muts: log.muts, stats: log.stats, errs, fps: 25 }, null, 1));
  const bad = log.samples.filter((x) => x.vis < x.n || x.n === 0).length;
  console.log(`${OUT}: ${frames} frames (${browserName}, ${desktop ? 'desktop' : 'phone'}), ${log.marks.length} marks${idleMs ? `, idle ${idleMs} ms: ${log.samples.length} DOM samples, ${bad} with a hidden/missing piece, ${log.muts.filter((m) => m.t >= 0).length} board mutations` : ''}, errs ${errs.length}`);
}

function signatures(OUT) {
  const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8'));
  const { rect } = meta;
  const files = fs.readdirSync(OUT).filter((f) => /^f\d+\.png$/.test(f)).sort();
  const F = rect.files, R = rect.ranks;
  const sigs = [];
  for (const f of files) {
    const img = decodePng(fs.readFileSync(path.join(OUT, f)));
    const sx = img.width / meta.size.width, sy = img.height / meta.size.height;
    const x0 = rect.x * sx, y0 = rect.y * sy, cw = (rect.w * sx) / F, ch = (rect.h * sy) / R;
    const sig = new Float32Array(F * R * 3);
    for (let r = 0; r < R; r++) for (let c = 0; c < F; c++) {
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = Math.floor(y0 + r * ch); y < Math.floor(y0 + (r + 1) * ch); y++) for (let x = Math.floor(x0 + c * cw); x < Math.floor(x0 + (c + 1) * cw); x++) { const o = (y * img.width + x) * 4; sr += img.data[o]; sg += img.data[o + 1]; sb += img.data[o + 2]; n++; }
      const i = (r * F + c) * 3;
      sig[i] = sr / n; sig[i + 1] = sg / n; sig[i + 2] = sb / n;
    }
    sigs.push(sig);
  }
  return { meta, sigs, F, R };
}

function blinksOf(OUT) {
  const cached = path.join(OUT, 'blinks.json');
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
  const { meta, sigs, F, R } = signatures(OUT);
  const dist = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  const T = 6;
  const blinks = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < F; c++) {
    const i = (r * F + c) * 3;
    for (let k = 1; k < sigs.length - 1; k++) {
      const d = dist(sigs[k], sigs[k - 1], i);
      if (d < T) continue;
      for (let j = k + 1; j <= Math.min(sigs.length - 1, k + 3); j++) {
        if (dist(sigs[j], sigs[k - 1], i) < T / 2 && dist(sigs[j], sigs[k], i) > T * 0.7) { blinks.push({ frame: k, back: j, sq: String.fromCharCode(97 + c) + (R - r), d: +d.toFixed(1), t: Math.round((k / meta.fps) * 1000) }); break; }
      }
    }
  }
  const out = { frames: sigs.length, secs: sigs.length / meta.fps, blinks };
  fs.writeFileSync(cached, JSON.stringify(out));
  return out;
}

function summary(OUT) {
  const { frames, secs, blinks } = blinksOf(OUT);
  const by = new Map();
  for (const x of blinks) by.set(x.frame, (by.get(x.frame) ?? 0) + 1);
  const local = (x) => (by.get(x.frame) ?? 0) < 20 && (by.get(x.frame + 1) ?? 0) < 20 && (by.get(x.frame - 1) ?? 0) < 20;
  const loc = blinks.filter(local);
  return { name: path.basename(OUT), frames, secs, whole: [...by.values()].filter((n) => n >= 60).length, piece: loc.filter((x) => x.d >= 15).length, debris: loc.filter((x) => x.d < 15).length, door: loc.filter((x) => x.sq === 'g5' && x.d >= 60).length, torch: loc.filter((x) => x.sq === 'h5' && x.d >= 60).length, biggest: [...loc].sort((a, b) => b.d - a.d).slice(0, 10) };
}

function scan() {
  const OUT = path.resolve(argv[1]);
  const s = summary(OUT);
  console.log(`${s.name}: ${s.frames} frames over ${s.secs.toFixed(0)} s; whole-board frames ${s.whole} (the recorder's — ignore); local blinks: piece-scale ${s.piece}, debris-scale ${s.debris}; s59 door g5 vanishes ${s.door}, torch h5 ${s.torch}`);
  console.log('biggest local blinks:', s.biggest.map((b) => `f${b.frame}→f${b.back} ${b.sq} Δ${b.d} @${(b.t / 1000).toFixed(2)}s`).join('  '));
  const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8'));
  if (meta.marks.length) console.log('marks:', meta.marks.map((m) => `${(m.t / 1000).toFixed(1)}s ${m.what}`).join(' | '));
}

function compare() {
  for (const dir of argv.slice(1)) {
    const s = summary(path.resolve(dir));
    console.log(`${s.name.padEnd(16)} ${s.secs.toFixed(0).padStart(3)}s  whole-board ${String(s.whole).padStart(3)}  local blinks: piece-scale ${String(s.piece).padStart(3)}  debris-scale ${String(s.debris).padStart(3)}  (per 10 s: ${((s.piece / s.secs) * 10).toFixed(1)} / ${((s.debris / s.secs) * 10).toFixed(1)})  door/torch vanishes ${s.door}/${s.torch}`);
  }
}

if (mode === 'record') await record();
else if (mode === 'scan') scan();
else if (mode === 'compare') compare();
else { console.log('usage: flicker-scan.mjs record|scan|compare … (see the header)'); process.exit(2); }

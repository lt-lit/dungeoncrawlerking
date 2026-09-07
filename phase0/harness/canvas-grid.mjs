// THE CANVAS GRID gate (Phase 2 milestone 1, 2026-09-07): the canvas
// board's one blit lands on the screen's device-pixel grid — every device
// pixel of the board is one native pixel scaled by the whole number k, at
// fractional device pixel ratios and fractional container widths, in
// Chromium and (when installed — `npx playwright install firefox`)
// Firefox.
//
// How: the game page on the canvas renderer (?renderer=canvas), booted
// once per browser and ratio (the widths, scalings and snap strategies
// are walked on the live page), the board switched to its TEST PATTERN (__DCK.renderer.testPattern: every native
// pixel encodes its own (x, y) — red = x, green = y mod 256, blue = 255),
// a screenshot at the emulated ratio, and every device pixel inside the
// board rectangle must read the encoding of ⌊(px − x0) / k⌋, ⌊(py − y0) /
// k⌋ — no pixel drawn a different size or alignment from its neighbours.
// The board rectangle comes from __DCK.renderer.info (x0, y0, k, the
// canvas's device size) and the canvas element's screen position.
//
// CHROMIUM RUNS AT RATIO 1 ONLY. Playwright's deviceScaleFactor on Chromium
// is a compositor-level emulation: layout still believes ratio 1
// (ResizeObserver's device-pixel box comes back in CSS px, a whole factor
// off — the board falls back to css × ratio when the two disagree,
// renderInfo.emulated), and a canvas's bitmap is resampled once into its
// CSS box and once more by the emulation's scale, so blocks drift by a
// device pixel part way across even with the element at a whole device
// pixel and its box exactly its backing size (measured 2026-09-07: 9/18
// cases at ratios 1.25–3 with either snap, all four ratio-1 cases exact).
// That is the emulator, not the browser: a real screen's ratio is the
// compositor's own. Firefox's emulation is the real preference
// (layout.css.devPixelsPerPx), so every ratio runs there; a real phone's
// screenshot is the final word.
//
// Usage (from phase0/): node harness/canvas-grid.mjs [--browser chromium|firefox|all] [--snap none|margin|transform|all] [--shots]
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, firefox } from 'playwright';
import { decodePng } from '../lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'phase0/results/canvas-grid');
const PORT = 8934;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ini': 'text/plain' };
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const which = arg('browser', 'all');
const SHOTS = argv.includes('--shots');
const STAGE = arg('stage', 's59-hall-corner');
// Ratios and CSS widths: the phones' ratios (1, 2, 2.625, 3) and the
// laptop's (1.25), at widths that leave a fractional margin at every k.
const CASES = [
  { dpr: 1, width: 390 }, { dpr: 1, width: 413 }, { dpr: 1.25, width: 640 }, { dpr: 2, width: 375 }, { dpr: 2, width: 414 },
  { dpr: 2.625, width: 411 }, { dpr: 3, width: 360 }, { dpr: 3, width: 393 }, { dpr: 3, width: 430 },
];

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
if (SHOTS) { fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true }); }
const failures = [], notes = [];
const expect = (ok, what) => (ok ? notes.push(`ok  ${what}`) : failures.push(what));

const SNAPS = (arg('snap', 'all') === 'all' ? ['none', 'margin', 'transform'] : [arg('snap', 'all')]);

/** One page per browser × ratio (the engine boots once); the widths,
 *  scalings and snap strategies are walked on the live page. */
async function openRatio(browser, dpr) {
  const ctx = await browser.newContext({ viewport: { width: CASES.find((c) => c.dpr === dpr).width, height: 900 }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  const q = new URLSearchParams({ stage: STAGE, autobegin: '1', fx: '0', seed: '3', go: 'depth 3', probe: 'depth 3', renderer: 'canvas', onset: '999' });
  await page.goto(`http://127.0.0.1:${PORT}/play/index.html?${q}`);
  await page.waitForFunction(() => window.__DCK?.app?.duel?.state === 'playing', null, { timeout: 120000 });
  await page.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  await page.evaluate(() => window.__DCK.renderer.ready());
  return { ctx, page, errs };
}

async function measure(pg, name, { dpr, width, scaling, snap }) {
  const { page, errs } = pg;
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(120);
  await page.evaluate(async (sc) => { window.__DCK.renderer.set('canvas', sc); await window.__DCK.renderer.ready(); }, scaling);
  await page.waitForTimeout(120);
  await page.evaluate((m) => { window.__DCK.renderer.snapMode(m); window.__DCK.renderer.testPattern(true); window.__DCK.renderer.paintNow(); }, snap);
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__DCK.renderer.paintNow()); // a second frame: the snap measured on the first lands on this one
  await page.waitForTimeout(100);
  const geo = await page.evaluate(() => {
    const K = window.__DCK;
    K.renderer.paintNow();
    const c = document.querySelector('#board canvas');
    const r = c.getBoundingClientRect();
    return { info: K.renderer.info, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, cw: c.width, ch: c.height };
  });
  const png = decodePng(await page.screenshot({ type: 'png' }));
  if (SHOTS) fs.writeFileSync(path.join(OUT, `${name}-dpr${dpr}-w${width}-${scaling}-${snap}.png`), await page.locator('#board').screenshot({ type: 'png' }));
  await page.evaluate(() => window.__DCK.renderer.testPattern(false));
  const { info, rect } = geo;
  const k = info.k;
  // Where the board landed: the browser snaps the canvas element to a
  // device pixel of its own choosing (the CSS rect × ratio is fractional),
  // so the board's origin is FOUND on the screenshot — the first pixel of
  // the (0, 0)-encoded block nearest the expected spot — and the pattern
  // is checked from there. Only the mapping is under test, not the offset.
  const ex = Math.round(rect.x * dpr + info.x0), ey = Math.round(rect.y * dpr + info.y0);
  let bx = -1, by = -1;
  for (let dy = -3; dy <= 3 && bx < 0; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = ex + dx, y = ey + dy;
    const o = (y * png.width + x) * 4;
    const left = ((y * png.width + x - 1) * 4), up = (((y - 1) * png.width + x) * 4);
    const isOrigin = (p) => png.data[p] === 0 && png.data[p + 1] === 0 && png.data[p + 2] === 255;
    if (isOrigin(o) && !isOrigin(left) && !isOrigin(up)) { bx = x; by = y; break; }
  }
  if (bx < 0) return { info, k, checked: 0, bad: 1, blended: 0, samples: [`no (0,0) block near (${ex},${ey})`], errs: errs.splice(0), canvasPx: `${geo.cw}×${geo.ch}`, rect, snap: info.snap };
  const bw = info.bufW * k, bh = info.bufH * k;
  let checked = 0, bad = 0, blended = 0;
  const samples = [];
  // Every device pixel inside the board. An integer k means device pixel
  // p shows native ⌊(p − b) / k⌋; a fractional k (fill) means the native
  // pixel under the device pixel's CENTRE, which is what nearest-neighbour
  // sampling draws — still one resample, still no seam, only uneven.
  const native = (p, b) => (Number.isInteger(k) ? Math.floor((p - b) / k) : Math.floor((p - b + 0.5) / k));
  for (let py = by; py < Math.floor(by + bh - 0.5); py++) for (let px = bx; px < Math.floor(bx + bw - 0.5); px++) {
    const o = (py * png.width + px) * 4;
    const nx = native(px, bx), ny = native(py, by);
    const r = png.data[o], g = png.data[o + 1], b = png.data[o + 2];
    checked++;
    if (b !== 255) blended++;
    if (r !== (nx & 255) || g !== (ny & 255) || b !== 255) {
      bad++;
      if (samples.length < 3) samples.push(`(${px},${py}) want ${nx & 255},${ny & 255},255 got ${r},${g},${b}`);
    }
  }
  return { info, k, checked, bad, blended, samples, errs: errs.splice(0), canvasPx: `${geo.cw}×${geo.ch}`, rect, origin: `${bx},${by} (expected ${ex},${ey})`, snap: info.snap };
}

async function runBrowser(name) {
  let browser;
  if (name === 'chromium') {
    const executablePath = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  } else {
    if (!fs.existsSync(firefox.executablePath())) { notes.push(`--  firefox not installed (npx playwright install firefox) — skipped`); return; }
    browser = await firefox.launch();
  }
  const tally = {};
  const fails = [];
  const pages = {};
  const cases = name === 'chromium' ? CASES.filter((c) => c.dpr === 1) : CASES;
  const ratios = [...new Set(cases.map((c) => c.dpr))];
  for (const dpr of ratios) pages[dpr] = await openRatio(browser, dpr);
  for (const snap of SNAPS) for (const c of cases) {
    for (const scaling of ['integer', 'fill']) {
      const m = await measure(pages[c.dpr], name, { ...c, scaling, snap });
      tally[snap] ??= { n: 0, exact: 0 };
      tally[snap].n++;
      const kInt = Number.isInteger(m.k);
      // Integer: every device pixel exact. Fill: no pixel blended (every one
      // a pattern colour) and the centre-sampling model right to a rounding
      // of Chromium's own nearest-neighbour phase (≥ 97%).
      // (The fill model — nearest-neighbour about the device pixel's centre —
      // is not the browser's exact phase; what fill must show is NO BLENDING,
      // every device pixel a pattern colour, and the model right nearly everywhere.)
      const ok = m.checked > 0 && m.errs.length === 0 && (scaling === 'integer' ? m.bad === 0 && kInt : m.blended === 0 && m.bad / m.checked < 0.15);
      if (ok) tally[snap].exact++;
      else fails.push(`[${snap}] dpr ${c.dpr} width ${c.width} ${scaling}: k ${m.k} (${m.canvasPx} backing in a ${(m.rect.w * c.dpr).toFixed(2)}×${(m.rect.h * c.dpr).toFixed(2)} box at ${(m.rect.x * c.dpr).toFixed(2)},${(m.rect.y * c.dpr).toFixed(2)}, x0 ${m.info.x0}, origin ${m.origin}, snap ${(m.snap ?? []).map((v) => v.toFixed(3)).join('/')}, ${m.info.emulated ? 'emulated ratio' : 'observer'}) bad ${m.bad}/${m.checked} blended ${m.blended} ${m.samples.join(' | ')}${m.errs.length ? ` errors: ${m.errs.join(' | ')}` : ''}`);
      if (scaling === 'integer' && snap === SNAPS[0]) notes.push(`--  ${name} dpr ${c.dpr} width ${c.width}: k ${m.k}, ${m.info.tilePx} device px per tile (${(m.info.tilePx / c.dpr).toFixed(1)} css px), ${m.canvasPx} canvas px, x0 ${m.info.x0}${m.info.emulated ? ' (emulated ratio)' : ''}`);
    }
  }
  for (const pg of Object.values(pages)) await pg.ctx.close();
  await browser.close();
  for (const [snap, t] of Object.entries(tally)) {
    const f = fails.filter((x) => x.startsWith(`[${snap}]`));
    expect(t.exact === t.n, `${name} snap=${snap}: the blit lands 1:1 on the device grid in ${t.exact}/${t.n} cases (${cases.length} ratio × width cases, integer + fill${name === 'chromium' ? '; ratio 1 only — see the header' : ''})${f.length ? `\n      ${f.join('\n      ')}` : ''}`);
  }
}

for (const name of which === 'all' ? ['chromium', 'firefox'] : [which]) await runBrowser(name);
server.close();
for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`SUMMARY: ${notes.filter((x) => x.startsWith('ok')).length} ok, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);

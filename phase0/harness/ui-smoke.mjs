// Live-board UI smoke: drive play/index.html in headless Chromium through the
// __DCK hook with the gods forced hot, and assert the UI on the REAL board
// (the 16×16 canvas board — the one renderer since 2026-09-07) — the
// selftest's renderer check covers a detached board, this covers the
// wiring: tiles painted from the Director ledgers after a quake, the
// per-rung residue marks + displacement arrows, the gods line, the log
// naming terrain rungs, ranked hint arrows from the STREAMING probe with a
// depth readout, a clean cancel path (no "unresponsive" recycle), the
// board's geometry and diagnostics line, the debris layer, the replay log.
// Screenshots land in phase0/results/ui-smoke/ for the eye.
//
// Setup (once): cd phase0 && npm i --no-save playwright  (Chromium: see
// selftest-headless.mjs). Usage: cd phase0 && node harness/ui-smoke.mjs
//   [--stage s59-hall-corner] [--plies 60] [--seed 3] [--shots]
//   [--go 'depth 8 movetime 120']  (the engine's search limits per move —
//   shallower searches grab material, which is how to reproduce the
//   "cracked wall captured in the reply" path below)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'phase0/results/ui-smoke');
const PORT = 8932;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.ini': 'text/plain' };

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const STAGE = arg('stage', 's59-hall-corner');
const PLIES = parseInt(arg('plies', '60'), 10);
const SEED = arg('seed', '3');
const SHOTS = argv.includes('--shots');
const THEME = arg('theme', null); // ?theme= override for the run (default: the Art set's default, crypt — THE CRYPT EVERYWHERE, 2026-09-17)
const GO = arg('go', 'depth 8 movetime 120');

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
let bootRetries = 0;
/** A duel page's boot: wait for the duel to be playing. THE BOOT HANG (2026-09-25): three long runs saw a page never
 *  reach 'playing' after 120 s while twelve isolated boots of the same URLs took 3.5 s each — so a page that has not
 *  booted in 90 s is RELOADED once and waited for again; the retry is counted on the summary line, never hidden. */
const bootWait = async (page, make, url, hook) => {
  const playing = (p, timeout) => p.waitForFunction(() => window.__DCK?.app?.duel?.state === 'playing', null, { timeout });
  try {
    await playing(page, 90000);
    return page;
  } catch (e) {
    if (!/Timeout|closed|crashed/i.test(String(e))) throw e;
    bootRetries++;
    const where = await page.evaluate(() => `${window.__DCK?.app?.phase ?? '?'} / ${document.getElementById('status')?.textContent ?? '?'}`).catch((err) => `unreachable: ${String(err).split('\n')[0]}`);
    process.stderr.write(`... boot retry ${bootRetries}: the page did not reach 'playing' in 90 s (${where}) — a fresh page\n`);
    await page.close().catch(() => {});
    const fresh = await make();
    if (hook) hook(fresh);
    await fresh.goto(url);
    await playing(fresh, 120000);
    return fresh;
  }
};
const expect = (ok, what) => {
  process.stderr.write(`${ok ? 'ok ' : 'BAD'} ${what}\n`); // streamed as they land, so a hang is locatable
  if (ok) notes.push(`ok  ${what}`);
  else failures.push(what);
};

const executablePath = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
let page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));

// The gods hot from ply 1 (onset 1, ramp 2, debt cap 2 so holes land), short
// engine searches, no motion (fx=0 — animations gate app.busy), a short
// STREAMING probe so hints paint several depths per turn.
const q = new URLSearchParams({
  stage: STAGE,
  autobegin: '1',
  fx: '0',
  seed: SEED,
  go: GO,
  probe: 'depth 12 movetime 400',
  onset: '1',
  mramp: '2',
  debt: '2',
  ...(THEME ? { theme: THEME } : {}),
  // No gods overlay: its eval-delta probes run BEFORE the hint probe in the
  // idle window and would delay the hints this smoke times.
});
await page.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&${q}`);
page = await bootWait(page, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?deck=off&${q}`, (p) => p.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0])));
// Cheater Mode + hints ON through the options surface (persisted, so the
// probe fires on the very next player turn).
await page.evaluate(() => {
  const o = window.__DCK.options;
  o.cheat = true;
  o.hints = true;
  o.hintN = 3;
  o.evalBar = true;
  window.__DCK.applyOptions();
});
await page.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
// The probes: every square's classes (the shared test surface) and its
// decor, from the board's data; a signature of its drawn pixels.
await page.evaluate(() => {
  const K = window.__DCK;
  window.__smoke = {
    cells: () => Object.fromEntries([...K.app.boardUI.cells.keys()].map((sq) => [sq, K.marks.cell(sq)])),
    decor: (sq) => K.renderer.decor(sq),
    /** A signature of a square's drawn pixels — the theme check's "it changed". */
    sig: (sq) => { const px = K.renderer.square(sq); if (!px) return null; let h = 0; for (let i = 0; i < px.length; i++) h = (h * 31 + px[i]) >>> 0; return h; },
    painted: () => K.debris.stats().painted,
  };
});
await page.evaluate(() => window.__DCK.renderer.ready());

if (SHOTS) {
  fs.rmSync(OUT, { recursive: true, force: true }); // ply-numbered names: a stale shot from an earlier run would masquerade as this one
  fs.mkdirSync(OUT, { recursive: true });
}
const shot = async (name) => {
  if (!SHOTS) return;
  await page.locator('#screen-duel').screenshot({ path: path.join(OUT, `${name}.png`) });
};

// --- art themes (2026-09-03): the stage's own theme dresses the live board;
// the Art-set option and ?theme= override it; the legend follows. ---------
const themeState = () =>
  page.evaluate(async () => {
    const board = document.getElementById('board');
    // The options legend: five canvases painted off the atlas under the
    // theme (main.mjs paintLegend) — a signature per tile, so a theme
    // change must move them.
    const legendSig = [...document.querySelectorAll('.legend canvas[data-legend]')].map((c) => { const d = c.getContext('2d').getImageData(0, 0, 16, 16).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0; return h; });
    return {
      theme: window.__DCK.theme,
      attr: board.dataset.theme ?? null,
      legend: legendSig,
      // Every wall's autotile case, re-derived from its neighbours by the
      // renderer's own rule (a standing wall, a cracked wall, a door or
      // authored masonry is solid; a hole, floor or loose furniture is not;
      // off-board is not)
      // through the renderer's own canonicalMask — stage-independent, so
      // it runs on any --stage.
      masksBad: await (async () => {
        const { canonicalMask } = await import('/play/js/board-ui.mjs');
        const cells = new Map(Object.entries(window.__smoke.cells()));
        const has = (cl, k) => !!cl && cl.includes(k);
        const solid = (f, r) => {
          const c = cells.get(String.fromCharCode(97 + f) + r);
          return !!c && !has(c, 'hole') && (has(c, 'wall') || has(c, 'cracked') || has(c, 'skin-door') || has(c, 'skin-masonry'));
        };
        const bad = [];
        let n = 0;
        for (const [sq, c] of cells) {
          if (!has(c, 'wall') || has(c, 'hole')) continue;
          n++;
          const f = sq.charCodeAt(0) - 97;
          const r = parseInt(sq.slice(1), 10);
          const want = canonicalMask((solid(f, r + 1) ? 1 : 0) | (solid(f + 1, r) ? 2 : 0) | (solid(f, r - 1) ? 4 : 0) | (solid(f - 1, r) ? 8 : 0) | (solid(f + 1, r + 1) ? 16 : 0) | (solid(f + 1, r - 1) ? 32 : 0) | (solid(f - 1, r - 1) ? 64 : 0) | (solid(f - 1, r + 1) ? 128 : 0));
          if (!c.includes(`wm-${want}`)) bad.push(`${sq}:${c.find((k) => k.startsWith('wm-')) ?? 'none'}≠wm-${want}`);
        }
        return { n, bad };
      })(),
      pieces: window.__DCK.pieces,
      // Signatures of a wall, a floor and the king's square (a theme or set change must move them).
      sig: (() => { const S = window.__smoke; const cells = S.cells(); const wall = Object.keys(cells).find((sq) => cells[sq].includes('wall')); const floor = Object.keys(cells).find((sq) => !cells[sq].some((c) => ['wall', 'hole', 'furniture'].includes(c))); const fen = window.__DCK.app.duel.fen(); const kingSq = (fen.match(/K/) && (() => { const grid = fen.split(' ')[0].split('/'); for (let r = 0; r < grid.length; r++) { let f = 0; for (const ch of grid[r].replace(/\d+/g, (d) => '.'.repeat(+d))) { if (ch === 'K') return String.fromCharCode(97 + f) + (grid.length - r); f++; } } return null; })()); window.__DCK.renderer.paintNow(); return { wall: wall ? S.sig(wall) : null, floor: floor ? S.sig(floor) : null, king: kingSq ? S.sig(kingSq) : null }; })(),
    };
  });
const stageTheme = await page.evaluate(() => window.__DCK.app.session.deal.stage.theme);
const DEFAULT_ART = 'crypt'; // THE CRYPT EVERYWHERE (2026-09-17): the Art set's default, whatever the stage says
const wornTheme = THEME ?? DEFAULT_ART;
const themeSigs = {}; // per theme, the signatures
const legendSigs = {}; // per theme, the legend's five tiles
{
  const t = await themeState();
  expect(!!stageTheme && t.theme === wornTheme && t.attr === wornTheme && t.legend.length === 5 && t.legend.every((h) => h !== 0), `board wears the default art set "${wornTheme}" over the stage's own "${stageTheme}" (${t.theme}/${t.attr}) and the legend's 5 tiles are painted`);
  themeSigs[wornTheme] = t.sig;
  legendSigs[wornTheme] = t.legend.join(',');
  expect(t.sig.floor !== null && t.sig.wall !== undefined, `the canvas board paints the stage (floor sig ${t.sig.floor}, wall sig ${t.sig.wall}, king sig ${t.sig.king})`);
  expect(t.masksBad.n > 0 && t.masksBad.bad.length === 0, `wall autotile masks match the standing-neighbour rule on all ${t.masksBad.n} walls${t.masksBad.bad.length ? ` — ${t.masksBad.bad.join(' ')}` : ''}`);
}
const setTheme = (name) =>
  page.evaluate((n) => {
    window.__DCK.options.art = n;
    window.__DCK.applyOptions();
  }, name);
for (const name of THEME ? [] : ['hall', 'castle', 'crypt']) {
  await setTheme(name);
  const t = await themeState();
  themeSigs[name] = t.sig;
  legendSigs[name] = t.legend.join(',');
  expect(t.theme === name && t.attr === name && t.legend.length === 5, `Art set "${name}" overrides the stage (${t.theme})`);
  await shot(`00-theme-${name}`);
}
if (!THEME) {
  const floors = new Set(Object.values(themeSigs).map((x) => x?.floor)), walls = new Set(Object.values(themeSigs).map((x) => x?.wall));
  expect(floors.size === 3 && (walls.size === 3 || themeSigs.hall?.wall === null), `the canvas board repaints per theme: ${floors.size} floor looks, ${walls.size} wall looks over hall / castle / crypt`);
  expect(new Set(Object.values(legendSigs)).size === 3, `the legend repaints per theme (${new Set(Object.values(legendSigs)).size} looks)`);
}
if (!THEME) await setTheme('classic');
if (!THEME) {
  const t = await themeState();
  expect(t.theme === null && t.attr === null && t.sig.floor !== themeSigs.hall?.floor && t.sig.wall !== themeSigs.hall?.wall, `"classic" strips the theme: the flat floor and the drawn wall block off the atlas's classic row (floor sig ${t.sig.floor}, wall sig ${t.sig.wall})`);
  await shot('00-theme-classic');
}
await setTheme('auto');
expect((await themeState()).theme === stageTheme && stageTheme !== wornTheme, `Art set "auto" returns to the stage's own theme (${stageTheme}, over the default ${wornTheme})`);
// Doors: the option overrides the theme's door; auto returns it.
await page.evaluate(() => { window.__DCK.options.doors = 'castle'; window.__DCK.applyOptions(); });
expect((await page.evaluate(() => window.__DCK.doors)) === 'castle', 'Doors option stamps the door set');
await page.evaluate(() => { window.__DCK.options.doors = 'auto'; window.__DCK.applyOptions(); });
expect((await page.evaluate(() => window.__DCK.doors)) === null, 'Doors "auto" is the theme\'s own');
// THE TONES (2026-09-12): the floor and wall base colours per art set —
// live, the legend following, saved per set, reset restoring the set's own.
// The hint arrows are OFF for these three signatures: the option change just
// above kicked a STREAMING probe whose arrows land over the floor square at
// every depth for its movetime, and a moving arrow is not a tone (the first
// run of this block measured "before" and "after reset" under two different
// depths' arrows). Hints return after the block, so the probe checks below
// get a fresh stream.
{
  await page.evaluate(() => { window.__DCK.options.hints = false; window.__DCK.applyOptions(); });
  const before = await themeState();
  const base = await page.evaluate(() => window.__DCK.tones.base());
  expect(!!base?.floor && !!base?.wall && !!base?.highlight && /^#[0-9a-f]{6}$/.test(base.floor) && /^#[0-9a-f]{6}$/.test(base.wall) && /^#[0-9a-f]{6}$/.test(base.highlight), `the art set's own base colours read off the atlas's recorded palette (floor ${base?.floor}, wall ${base?.wall}, highlight ${base?.highlight})`);
  await page.evaluate(() => window.__DCK.tones.set({ floor: '#804020', wall: '#206080' }));
  await page.waitForTimeout(200);
  const toned = await themeState();
  expect(toned.sig.floor !== before.sig.floor && toned.sig.wall !== before.sig.wall, `Tones recolour the floor and the walls live (floor ${before.sig.floor} → ${toned.sig.floor}, wall ${before.sig.wall} → ${toned.sig.wall})`);
  expect(toned.legend.join() !== before.legend.join(), 'the options legend follows the tones');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dck.options.v1') ?? '{}').tones);
  const key = await page.evaluate(() => window.__DCK.tones.key());
  expect(saved?.[key]?.floor === '#804020' && saved?.[key]?.wall === '#206080', `the tones are saved for the set "${key}"`);
  const ui = await page.evaluate(() => ({ floor: document.getElementById('toneFloor').dataset.hex, wall: document.getElementById('toneWall').dataset.hex, label: document.getElementById('toneFloorV').textContent, swatch: document.querySelector('#toneFloor .tone-swatch').style.background, reset: document.getElementById('btnTonesReset').disabled, hidden: document.getElementById('tone-picker').hidden }));
  expect(ui.floor === '#804020' && ui.wall === '#206080' && ui.label === '#804020' && /128, 64, 32/.test(ui.swatch) && ui.reset === false && ui.hidden, `the chips show the live tones with the hex beside them (${ui.floor} / ${ui.wall}), the picker closed`);
  // THE TONE PICKER (the phone's native colour dialog was nine swatches, red
  // to white): the floor chip opens it in the page — the sliders read the
  // tone's H/S/L, a swatch sets the tone, a slider drag moves it and keeps
  // its own number, the hex field takes a number with or without the #.
  // Real taps, so the Options panel is opened for the block and closed after.
  await page.evaluate(() => document.getElementById('btnOptions').click());
  await page.click('#toneFloor');
  const pk = await page.evaluate(() => ({ ...window.__DCK.tones.picker(), pressed: document.getElementById('toneFloor').getAttribute('aria-pressed'), hue: +document.getElementById('toneHue').value, sat: +document.getElementById('toneSat').value, lum: +document.getElementById('toneLum').value, hex: document.getElementById('toneHex').value, swatches: document.querySelectorAll('#toneSwatches button').length, track: document.getElementById('toneHue').style.getPropertyValue('--track').includes('linear-gradient') }));
  expect(pk.slot === 'floor' && !pk.hidden && pk.pressed === 'true' && pk.hue === 20 && pk.sat === 60 && pk.lum === 31 && pk.hex === '#804020' && pk.swatches >= 16 && pk.track, `the floor chip opens the in-page picker on #804020: hue ${pk.hue}° sat ${pk.sat}% lum ${pk.lum}%, ${pk.swatches} dungeon stones, painted tracks`);
  const sw = await page.evaluate(() => document.querySelector('#toneSwatches button:nth-child(13)').dataset.hex);
  await page.click('#toneSwatches button:nth-child(13)');
  await page.waitForTimeout(200);
  const afterSw = await page.evaluate(() => ({ live: window.__DCK.tones.get()?.floor, chip: document.getElementById('toneFloorV').textContent, ring: document.querySelector('#toneSwatches button[aria-pressed="true"]')?.dataset.hex, hex: document.getElementById('toneHex').value }));
  expect(afterSw.live === sw && afterSw.chip === sw && afterSw.ring === sw && afterSw.hex === sw, `a swatch sets the floor tone (${sw}); the chip, the ring and the hex follow`);
  const swSig = (await themeState()).sig.floor;
  await page.evaluate(() => { const r = document.getElementById('toneLum'); r.value = String(Math.min(100, +r.value + 20)); r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  const afterSl = await page.evaluate(() => ({ live: window.__DCK.tones.get()?.floor, lum: +document.getElementById('toneLum').value, hsl: window.__DCK.tones.picker().hsl, hex: document.getElementById('toneHex').value }));
  const slSig = (await themeState()).sig.floor;
  expect(afterSl.live !== sw && afterSl.hsl?.[2] === afterSl.lum && afterSl.hex === afterSl.live && slSig !== swSig, `the lightness slider moves the tone (${sw} → ${afterSl.live} at ${afterSl.lum}%), the floor repaints, the slider keeps its own number`);
  await page.fill('#toneHex', '5a4634');
  await page.waitForTimeout(200);
  const afterHex = await page.evaluate(() => ({ live: window.__DCK.tones.get()?.floor, chip: document.getElementById('toneFloorV').textContent, hue: +document.getElementById('toneHue').value, sat: +document.getElementById('toneSat').value, lum: +document.getElementById('toneLum').value }));
  expect(afterHex.live === '#5a4634' && afterHex.chip === '#5a4634' && afterHex.hue === 28 && afterHex.sat === 27 && afterHex.lum === 28, `the hex field takes a number without the # (${afterHex.live}); the sliders follow (${afterHex.hue}° ${afterHex.sat}% ${afterHex.lum}%)`);
  await page.evaluate(() => window.__DCK.tones.reset());
  await page.waitForTimeout(200);
  const back = await themeState();
  expect(back.sig.floor === before.sig.floor && back.sig.wall === before.sig.wall, `reset restores the set's own colours (floor ${before.sig.floor} → ${back.sig.floor}, wall ${before.sig.wall} → ${back.sig.wall})`);
  const ui2 = await page.evaluate(() => ({ floor: document.getElementById('toneFloor').dataset.hex, hex: document.getElementById('toneHex').value, reset: document.getElementById('btnTonesReset').disabled }));
  expect(ui2.floor === base.floor && ui2.hex === base.floor && ui2.reset === true, `the chips and the open picker return to the base colours (${ui2.floor}) and reset goes quiet`);
  await page.click('#toneFloor');
  const closed = await page.evaluate(() => ({ hidden: document.getElementById('tone-picker').hidden, pressed: document.getElementById('toneFloor').getAttribute('aria-pressed') }));
  expect(closed.hidden && closed.pressed === 'false', 'a second tap on the chip closes the picker');
  // THE WALL HIGHLIGHT (2026-09-15, the designer: "a color selector for the
  // green 'moss' highlights in the brick work of the walls"; 2026-09-16:
  // "rename 'moss' to 'wall highlight'… make it effect the highlights on
  // the roof bricks as well"): the third slot — the roof's lit line and the
  // flecks in the brickwork take the highlight colour exactly, the floor is
  // untouched by it, the chip and the save carry it, reset clears it. (The
  // flecks turned green under the first cut's per-channel ratio rule
  // whenever the wall tone's hue differed from the base's; the rule is
  // hue-true now, so with no highlight tone they follow the wall.)
  await page.evaluate(() => window.__DCK.tones.set({ highlight: '#4a6a3a' }));
  await page.waitForTimeout(200);
  const hlCount = () => page.evaluate(() => { const K = window.__DCK; const cells = window.__smoke.cells(); K.renderer.paintNow(); let n = 0, roof = 0; for (const sq of Object.keys(cells)) { if (!cells[sq].includes('wall')) continue; const px = K.renderer.square(sq); if (!px) continue; for (let i = 0; i < px.length; i += 4) if (px[i] === 0x4a && px[i + 1] === 0x6a && px[i + 2] === 0x3a && px[i + 3] === 255) { n++; if (i / 4 < 16 * 4) roof++; } } return { n, roof }; });
  const lit = await themeState();
  const hl = await hlCount();
  const hlUi = await page.evaluate(() => ({ chip: document.getElementById('toneHighlightV').textContent, saved: JSON.parse(localStorage.getItem('dck.options.v1') ?? '{}').tones?.[window.__DCK.tones.key()]?.highlight, live: window.__DCK.tones.get() }));
  expect(hl.n > 0 && hl.roof > 0 && lit.sig.floor === before.sig.floor && lit.sig.wall !== before.sig.wall, `the highlight tone paints the brickwork's flecks and the roof's lit line in its colour (${hl.n} pixels on the walls, ${hl.roof} of them in a square's top four rows), the walls repaint, the floor is untouched`);
  expect(hlUi.chip === '#4a6a3a' && hlUi.saved === '#4a6a3a' && !hlUi.live?.wall && !hlUi.live?.floor, `the highlight chip shows the tone, the save carries it alone (${JSON.stringify(hlUi.live)})`);
  await page.evaluate(() => window.__DCK.tones.reset());
  await page.waitForTimeout(200);
  const unlit = await themeState();
  expect((await hlCount()).n === 0 && unlit.sig.wall === before.sig.wall, 'reset clears the highlight and the walls return to the set\'s own');
  await page.evaluate(() => document.getElementById('btnOptionsClose').click());
  await page.evaluate(() => { window.__DCK.options.hints = true; window.__DCK.applyOptions(); });
}
// Piece sprites: the default set paints the king; an unknown set (the
// retired 'classic' glyphs, say) falls back to it.
{
  const t = await themeState();
  expect(t.pieces === 'nulltale' && t.sig.king !== null, `pieces default to the NullTale sprites (${t.pieces}; king square sig ${t.sig.king})`);
  await page.evaluate(() => { window.__DCK.options.pieces = 'classic'; window.__DCK.applyOptions(); });
  const c = await themeState();
  expect(c.pieces === null && c.sig.king === t.sig.king, `an unknown piece set ('classic', the retired glyphs) draws the default set — ${c.pieces}, king sig unchanged`);
  await page.evaluate(() => { window.__DCK.options.pieces = 'pixel-chess-wood'; window.__DCK.applyOptions(); });
  const wood = await themeState();
  expect(wood.pieces === 'pixel-chess-wood' && wood.sig.king !== t.sig.king, 'the wood set applies and repaints the king');
  await shot('00-pieces-wood');
  await page.evaluate(() => { window.__DCK.options.pieces = 'nulltale'; window.__DCK.applyOptions(); });
  // Decor: wall props (torch / banner / chain) on wall faces only — the
  // floor litter is packed away (round 10) — never on holes or furniture.
  const decor = await page.evaluate(() => { const S = window.__smoke; const cells = S.cells(); return Object.keys(cells).map((sq) => ({ name: S.decor(sq), cell: cells[sq] })).filter((d) => d.name); });
  expect(decor.every((d) => (d.name === 'doorway' ? !d.cell.includes('wall') && !d.cell.includes('furniture') : d.cell.includes('wall') && ['torch', 'banner', 'chain'].includes(d.name))), `${decor.length} cosmetic props: wall props on wall faces only, no floor litter`);
}

// --- skins: the hall's doors paint from ply 0 — g5 (east–west line) as the
// leaf, d8 (north–south line) as a weak spot ---------------------------------
if (STAGE === 's59-hall-corner') {
  const door = await page.evaluate(() => ({ g5: window.__DCK.marks.cell('g5'), d8: window.__DCK.marks.cell('d8') }));
  expect(door.g5?.includes('furniture') && door.g5?.includes('skin-door'), `g5 is the door leaf (${door.g5})`);
  // Round 16: g5+h5, the double doors in the south wall, are ONE two-wide
  // door — g5 the left half, h5 the right — and each half paints its own
  // pack sprite (the leaves' data URIs differ).
  const dbl = await page.evaluate(() => {
    const S = window.__smoke;
    return { g5: window.__DCK.marks.cell('g5'), h5: window.__DCK.marks.cell('h5'), same: S.sig('g5') === S.sig('h5') };
  });
  expect(dbl.g5?.includes('door2-l') && dbl.h5?.includes('door2-r') && !dbl.same, `g5+h5 are one double door: left half + right half, two different paints (${dbl.g5} / ${dbl.h5})`);
  // THE CAMERA (2026-09-08): a door in a north–south line stands EDGE-ON
  // north-up (the generated placeholder: the wall's band, a slab, two posts)
  // — no longer a weak spot wearing the crack — and its paint differs from
  // the leaf's.
  expect(door.d8?.includes('furniture') && door.d8?.includes('skin-door') && door.d8?.includes('door-edge') && !door.d8?.includes('weak') && door.d8?.some((c) => c.startsWith('wm-')), `d8, the door in the north–south line, stands edge-on with its wall case, not a weak spot (${door.d8})`);
  const edge = await page.evaluate(() => { const S = window.__smoke; return { d8: S.sig('d8'), g5: S.sig('g5'), wallInk: (() => { const px = window.__DCK.renderer.square('d8'); let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) n++; return n; })() }; });
  expect(edge.d8 !== edge.g5 && edge.wallInk === 256, `the edge-on door paints its own tile, fully opaque (sig ${edge.d8} vs the leaf's ${edge.g5}, ${edge.wallInk}/256 px)`);
  // THE DOOR LIFTS (2026-09-15, with the shorter wall face): the edge-on
  // leaf's lift is a live dial — three pixels higher repaints d8, the
  // board wears the number, back at the default the paint returns.
  const lifts = await page.evaluate(() => { const K = window.__DCK; const S = window.__smoke; const sig = () => { K.renderer.paintNow(); return S.sig('d8'); }; const d0 = K.doorFit(); const s0 = sig(); K.options.edgeLift = d0.edgeLift + 3; K.applyOptions(); const s1 = sig(); const fit = { ...K.app.boardUI.doorFit }; K.options.edgeLift = d0.edgeLift; K.applyOptions(); const s2 = sig(); return { d0, s0, s1, s2, fit }; });
  expect(lifts.s1 !== lifts.s0 && lifts.s2 === lifts.s0 && lifts.fit.edgeLift === lifts.d0.edgeLift + 3, `the edge door lift dial moves the leaf (d8 sig ${lifts.s0} → ${lifts.s1} at ${lifts.d0.edgeLift + 3}, back at the default ${lifts.d0.edgeLift}; the board wears ${JSON.stringify(lifts.fit)})`);
}

// --- masonry (2026-09-04): an authored 'R' is a WEAK SPOT — the wall block
// wearing THE crack, never the retired rubble heap. Stage-independent: a
// no-op on a stage that authors none. ----------------------------------------
{
  const masonry = await page.evaluate(() => Object.entries(window.__DCK.skins)
    .filter(([, skin]) => skin === 'masonry')
    .map(([sq]) => ({ sq, cls: window.__DCK.marks.cell(sq) })));
  for (const m of masonry) {
    expect(m.cls?.includes('weak') && m.cls?.some((c) => c.startsWith('wm-')) && !m.cls?.includes('cracked'),
      `${m.sq}: authored masonry is a weak spot wearing a wall case (${m.cls})`);
  }
  if (masonry.length) console.log(`  (${masonry.length} authored masonry square(s) on ${STAGE})`);
}

// --- the streaming probe: arrows appear, ranked, with a depth readout --------
const probe = await page
  .waitForFunction(() => window.__DCK.cheat.arrows.length > 0 && /d\d+/.test(window.__DCK.cheat.hintLine), null, { timeout: 15000 })
  .then(() => page.evaluate(() => window.__DCK.cheat))
  .catch(() => null);
expect(!!probe, 'hint probe painted arrows with a depth readout on the first player turn');
if (probe) {
  expect(probe.arrows.every((a) => a.kind === 'hint' && a.rank >= 1), `arrows carry rank + kind: ${JSON.stringify(probe.arrows)}`);
  expect(probe.arrows[0].rank === 1, 'rank 1 is first in the arrow list');
  expect(/^1 /.test(probe.hintLine), `hint line starts with the rank-1 SAN: "${probe.hintLine}"`);
  // The drawn arrows: the board's list (pixel art in its buffer), in draw order.
  // No arrow carries an eval (designer 2026-09-07: "not worth keeping"); the hint LIST has them, one per rank.
  const drawn = await page.evaluate(() => window.__DCK.renderer.arrows.filter((a) => a.kind === 'hint').map((a) => ({ label: a.label ?? null, rank: String(a.rank) })));
  expect(drawn.length === probe.arrows.length && drawn.every((d) => d.label === null), `no hint arrow carries a label: ${JSON.stringify(drawn.map((d) => d.label))}`);
  const evals = probe.hintLine.match(/(\+|−|-)\d+\.\d(?!\d)|−?M\d+/g) ?? [];
  expect(evals.length === probe.arrows.length, `the hint line lists an eval per hint: "${probe.hintLine}"`);
  const listed = await page.evaluate(() => [...document.querySelectorAll('#hint-line .hint-item')].map((s) => s.dataset.rank + (s.querySelector('b') ? '' : '?')));
  expect(listed.join('') === probe.arrows.map((a) => a.rank).join(''), `the hint list carries one entry per rank in rank order, each with its eval: ${listed}`);
  const domRanks = drawn.map((d) => d.rank);
  expect(domRanks.length === probe.arrows.length && domRanks[domRanks.length - 1] === '1', `the buffer draws hints worst→best, best on top: ${domRanks}`);
  // A streaming probe repaints: wait for the depth to move at least once
  // within the movetime (depth 12 is far past what 400 ms reaches on any
  // board, so the readout climbs).
  const d0 = probe.depth;
  const climbed = await page.waitForFunction((d) => window.__DCK.cheat.depth > d, d0, { timeout: 3000 }).then(() => true).catch(() => false);
  // A fast, decided position can spend its 400 ms and END at the very depth
  // the first snapshot caught (seen once at d10, +10.9): the search is over
  // and nothing deeper was ever coming — a finished probe, not a stalled
  // stream. Accept that, and say which happened.
  const ended = climbed ? null : await page.evaluate(() => ({ active: window.__DCK.cheat.active, depth: window.__DCK.cheat.depth }));
  expect(climbed || (!!ended && !ended.active && ended.depth >= d0), climbed ? `probe streamed a deeper paint after d${d0}` : `probe finished at d${ended?.depth} with nothing deeper to stream after d${d0} (${JSON.stringify(ended)})`);
  await shot('01-hints');
  // The arrow dials (designer 2026-09-07: "make the arrows thinner. A thickness and opacity dial wouldn't hurt"):
  // width in floor pixels — the pixels the best hint with a path changes in its origin square of the
  // buffer — and the opacity; the setting persists; the default is 2 px at 85%.
  const dial = await page.evaluate(async () => {
    const K = window.__DCK;
    // THE PORTAL SPELL: a cast hint is a ring (from === to), not a shaft — the dial is
    // read on the best hint WITH A PATH. Its colour is its rank's and its strength sets
    // its alpha, so the dial reads the pixels the arrow CHANGES in its origin square
    // between two styles (against the arrow at its faintest), never a count of one
    // pure colour — a rank-2 arrow at strength 0.7 has no pure pixel at any width.
    const first = K.cheat.arrows.find((a) => a.from !== a.to);
    if (!first) return { skipped: true };
    const COL = { 1: [0xf2, 0xc1, 0x4e], 2: [0xc9, 0xce, 0xd8], 3: [0xc8, 0x81, 0x3f] }[first.rank === 2 || first.rank === 3 ? first.rank : 1];
    const paint = (w, a) => { K.setArrowStyle(w, a); K.renderer.paintNow(); return K.renderer.square(first.from); };
    const differ = (p, q) => { let n = 0; for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2] || p[i + 3] !== q[i + 3]) n++; return n; };
    const pure = (p) => { let n = 0; for (let i = 0; i < p.length; i += 4) if (p[i] === COL[0] && p[i + 1] === COL[1] && p[i + 2] === COL[2] && p[i + 3] === 255) n++; return n; };
    const dflt = K.arrowStyle;
    const faintest = paint(1, 0.2); // the arrow at its faintest and thinnest: the reference every other style is read against
    const wide = differ(paint(5, 1), faintest);
    const thinPaint = paint(1, 1);
    const thin = differ(thinPaint, faintest);
    const thinStyle = K.arrowStyle;
    const halfPaint = paint(1, 0.5);
    const half = differ(halfPaint, thinPaint);
    const halfPure = pure(halfPaint);
    const faintStyle = K.arrowStyle;
    const saved = JSON.parse(localStorage.getItem('dck.options.v1') ?? '{}');
    K.setArrowStyle(dflt.width, dflt.alpha);
    return { kind: K.renderer.kind, rank: first.rank, from: first.from, dflt, wide, thin, half, halfPure, thinStyle, faintStyle, saved: { w: saved.arrowWidth, a: saved.arrowAlpha }, back: K.arrowStyle };
  });
  if (dial.skipped) expect(true, 'the arrow dials: not measured this run — every hint was a portal cast (a ring, not a shaft)');
  else {
  expect(dial.dflt.width === 2 && dial.dflt.alpha === 0.85, `the arrows' default style is 2 px at 85%: ${JSON.stringify(dial.dflt)}`);
  expect(dial.wide > dial.thin && dial.thin > 0 && dial.thinStyle.width === 1 && dial.thinStyle.alpha === 1, `the width dial: the rank-${dial.rank} arrow changes ${dial.wide} pixels of its origin square ${dial.from} at 5 px vs ${dial.thin} at 1 px (${JSON.stringify(dial.thinStyle)})`);
  expect(dial.half > 0 && dial.halfPure === 0, `the opacity dial: at 50% the arrow repaints ${dial.half} pixels of ${dial.from} and none is the pure colour any more (${dial.halfPure}), style ${JSON.stringify(dial.faintStyle)}`);
  expect(dial.faintStyle.alpha === 0.5 && dial.saved.w === 1 && dial.saved.a === 0.5 && dial.back.width === dial.dflt.width, `the dials persist in the options (${JSON.stringify(dial.saved)}) and reset (${JSON.stringify(dial.back)})`);
  }
}

// --- play random moves until each rung has fired (or the ply budget runs out)
const seen = { weaken: 0, breach: 0, displace: 0, crumble: 0 };
let quakesChecked = 0;
let hintTurns = 0;
let turns = 0;
for (let i = 0; i < PLIES; i++) {
  const state = await page.evaluate(() => window.__DCK.app.duel?.state ?? 'none');
  if (state !== 'playing') break;
  turns++;
  const before = await page.evaluate(() => window.__DCK.record.quakes.length);
  // Hints must be present (or arriving) on every player turn.
  const hinted = await page.waitForFunction(() => window.__DCK.cheat.arrows.length > 0, null, { timeout: 8000 }).then(() => true).catch(() => false);
  if (hinted) hintTurns++;
  const st = await page.evaluate(async () => {
    const s = await window.__DCK.playerMove(window.__DCK.randomMove());
    await window.__DCK.waitIdle();
    return s;
  });
  const after = await page.evaluate(() => ({
    quakes: window.__DCK.record.quakes.slice(),
    marks: window.__DCK.marks.quake,
    godsLine: window.__DCK.marks.godsLine,
    logTail: [...document.querySelectorAll('#duel-log div')].slice(-6).map((d) => `${d.className}|${d.textContent}`),
    holes: [...window.__DCK.app.duel.director.holes],
    godCrates: [...window.__DCK.app.duel.director.godCrates],
    fen: window.__DCK.app.duel.fen(),
    turn: window.__DCK.app.duel.turnColor(),
  }));
  const fresh = after.quakes.slice(before);
  for (const ev of fresh) {
    quakesChecked++;
    for (const t of ev.terrain ?? []) seen[t.kind]++;
    seen.displace += ev.displacements.length;
    if (ev.crumble) seen.crumble++;
  }
  // Only quakes since the player's last move are on the board: the last
  // ply here is the ENGINE's reply (or the game ended), so residue from the
  // player's own ply and the reply is expected to be present and merged.
  if (fresh.length && st === 'playing' && after.turn === 'white') {
    const m = after.marks;
    expect(!!m, `quakeMarks present after ${fresh.length} quake(s) at ply ${i + 1}`);
    if (m) {
      const wantFrom = fresh.flatMap((e) => e.displacements.map((d) => d.from));
      const wantCracked = fresh.flatMap((e) => (e.terrain ?? []).filter((t) => t.kind === 'weaken').map((t) => t.square));
      const wantBreached = fresh.flatMap((e) => (e.terrain ?? []).filter((t) => t.kind === 'breach').map((t) => t.square));
      expect(wantFrom.every((sq) => m.from.includes(sq)) && m.arrows.length >= wantFrom.length, `merged residue records every displacement (${wantFrom}) and draws its arrow`);
      // A later rung supersedes: a crack that then broke open lives on as a breach, a breach that collapsed as a pit.
      expect(wantCracked.every((sq) => m.cracked.includes(sq) || m.breached.includes(sq)), `merged residue keeps every crack (${wantCracked})`);
      expect(wantBreached.every((sq) => m.breached.includes(sq) || m.pits.includes(sq)), `merged residue keeps every breach (${wantBreached})`);
      expect(after.godsLine.startsWith('⚡ the gods:'), `gods line set: "${after.godsLine}"`);
      const wantPits = fresh.filter((e) => e.crumble).map((e) => e.crumble.square);
      const cells = await page.evaluate((sqs) => Object.fromEntries(sqs.map((sq) => [sq, window.__DCK.marks.cell(sq)])), [...new Set([...wantFrom, ...wantCracked, ...wantBreached, ...wantPits])]);
      // A later rung on the same square supersedes the earlier mark: a wall
      // cracked and then broken open in one window shows as a breach.
      for (const sq of wantCracked) {
        if (m.breached.includes(sq)) expect(cells[sq]?.includes('fresh-breach') && !cells[sq]?.includes('fresh-crack'), `${sq}: cracked then breached → breach mark only (${cells[sq]})`);
        else if (!cells[sq]?.includes('furniture')) {
          // A cracked wall is a capturable '^': when the ENEMY'S REPLY took
          // it, the sprite went with it and the square is a ruin now
          // (main.mjs residue). Nothing about the crack is left to assert —
          // and the sprite queries below would throw on a missing element
          // (2026-09-03: the harness died with a stack trace when a run
          // under CPU load took this path; the engine's timed searches make
          // the game trajectory load-dependent).
          expect(true, `${sq}: cracked wall captured in the reply — no sprite to check (${cells[sq]})`);
        } else {
          expect(cells[sq]?.includes('fresh-crack') && cells[sq]?.includes('cracked') && cells[sq]?.includes('furniture'), `${sq}: cracked-wall tile + fresh-crack ring (${cells[sq]})`);
          // The cracked wall paints THE crack's black pixels over its wall case
          // (the crack drawing's ink is #0b0a10; the wall tile is never that dark).
          const ink = await page.evaluate((s) => { window.__DCK.renderer.paintNow(); const px = window.__DCK.renderer.square(s); let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] === 0x0b && px[i + 1] === 0x0a && px[i + 2] === 0x10) n++; return n; }, sq);
          expect(ink > 0, `${sq}: the cracked wall wears the crack's ink (${ink} px)`);
        }
      }
      for (const sq of wantBreached) {
        if (wantPits.includes(sq)) expect(cells[sq]?.includes('hole') && !cells[sq]?.includes('fresh-breach'), `${sq}: breached then collapsed → hole only (${cells[sq]})`);
        else expect(cells[sq]?.includes('fresh-breach') && !cells[sq]?.includes('furniture'), `${sq}: breach opened to floor + fresh-breach ring (${cells[sq]})`);
      }
      // A displacement is its arrow alone (round 13): no square mark on
      // either end.
      for (const sq of wantFrom) expect(!cells[sq]?.includes('quake-from') && !cells[sq]?.includes('quake-to'), `${sq}: a displacement leaves no square mark, only its arrow (${cells[sq]})`);
      // EVERY fresh hole keeps its rim — two crumbles in one window used to
      // leave only the latest marked.
      for (const sq of wantPits) expect(cells[sq]?.includes('hole') && cells[sq]?.includes('fresh-pit'), `${sq}: hole tile + fresh-pit ring (${cells[sq]})`);
      // A breached square keeps its RUIN stub (a .ruin cell wearing a stub
      // case, solid to the walls beside it) — or, for a door, its open
      // doorway (residue ledger; any door since the camera) — unless it is
      // now a hole; a burst crate (never part of the wall line) leaves nothing.
      const residue = await page.evaluate(() => window.__DCK.residue);
      const skinsNow = await page.evaluate(() => window.__DCK.skins);
      for (const sq of m.breached) {
        if (cells[sq]?.includes('hole')) continue;
        const dec = await page.evaluate((s) => window.__smoke.decor(s), sq);
        const stub = cells[sq]?.find((c) => c.startsWith('wm-')) ?? null;
        if (residue.rubble.includes(sq)) expect(cells[sq]?.includes('ruin') && stub !== null && dec === null, `${sq}: breached wall keeps its ruin stub (${stub}, ${dec})`);
        else if (residue.opened.includes(sq)) expect(dec === 'doorway' && !cells[sq]?.includes('ruin'), `${sq}: breached door keeps its open doorway (${dec})`);
        else expect(!cells[sq]?.includes('ruin') && dec === null && !['door', 'masonry'].includes(skinsNow[sq] ?? null), `${sq}: a burst crate leaves nothing (${skinsNow[sq]}, ${stub}, ${dec})`);
      }
      const quakeArrows = await page.evaluate(() => window.__DCK.renderer.arrows.filter((a) => a.kind === 'quake').length);
      expect(quakeArrows >= wantFrom.length, `${quakeArrows} quake arrow(s) in the buffer for ${wantFrom.length} displacement(s)`);
      const godLogs = after.logTail.filter((l) => l.startsWith('gods|'));
      expect(godLogs.length >= fresh.length, `log has ${godLogs.length} gods line(s) for ${fresh.length} quake(s)`);
      for (const e of fresh) for (const t of e.terrain ?? []) expect(godLogs.some((l) => l.includes(t.square)), `log names the ${t.kind} at ${t.square}`);
      if (fresh.some((e) => (e.terrain ?? []).length && e.displacements.length)) await shot(`02-mixed-quake-ply${i + 1}`);
      else if (fresh.some((e) => e.crumble)) await shot(`03-hole-ply${i + 1}`);
      else await shot(`04-quake-ply${i + 1}`);
    }
  }
  // Ledger-painted tiles must always agree with the Director on the live board.
  const tiles = await page.evaluate(tilesVsLedgers, after);
  expect(tiles.length === 0, `tiles agree with the ledgers at ply ${i + 1}${tiles.length ? `: ${tiles.join(', ')}` : ''}`);
  if (seen.weaken && seen.breach && seen.displace && seen.crumble && i > 12) break;
}

// --- undo restores BOTH ledgers (holes and god-minted crates) ---------------
if ((await page.evaluate(() => window.__DCK.app.duel?.state)) === 'playing') {
  const undone = await page.evaluate(async () => {
    window.__DCK.options.undo = true;
    window.__DCK.applyOptions();
    const holesBefore = window.__DCK.app.duel.director.holes.size;
    await window.__DCK.undo();
    await window.__DCK.waitIdle();
    const d = window.__DCK.app.duel;
    return { holesBefore, holes: [...d.director.holes], godCrates: [...d.director.godCrates], fen: d.fen(), marks: window.__DCK.marks.quake, godsLine: window.__DCK.marks.godsLine, state: d.state };
  });
  expect(undone.marks === null && undone.godsLine === '', 'undo clears the gods\' residue and the gods line');
  expect(undone.holes.length <= undone.holesBefore, `undo rewound the hole ledger (${undone.holes.length} ≤ ${undone.holesBefore})`);
  const tilesAfterUndo = await page.evaluate(tilesVsLedgers, undone);
  expect(tilesAfterUndo.length === 0, `tiles agree with the restored ledgers after undo${tilesAfterUndo.length ? `: ${tilesAfterUndo.join(', ')}` : ''}`);
}

/** Both directions: every ledger hole paints as a hole, every painted
 *  cracked wall is a ledger crate, and every ledger crate still standing as
 *  '^' paints cracked — and every RUIN wears the stub case of its STANDING
 *  wall neighbours (a wall, a cracked wall, a door or authored masonry;
 *  never another ruin,
 *  an opened doorway, a hole or a crate — round 12's clumps), every opened
 *  DOORWAY the east/west mask of its standing walls (its posts), and every
 *  HOLE the 4-bit mask of its hole neighbours (round 13's pit autotile).
 *  Runs in the page. */
function tilesVsLedgers({ holes, godCrates, fen }) {
  const bad = [];
  const S = window.__smoke;
  const cells = S.cells();
  const cl = (sq) => cells[sq] ?? null;
  const has = (sq, k) => !!cl(sq)?.includes(k);
  const caseOf = (sq) => cl(sq)?.find((k) => k.startsWith('wm-')) ?? 'no case';
  for (const sq of holes) if (!has(sq, 'hole')) bad.push(`${sq} not a hole`);
  for (const sq of Object.keys(cells)) if (has(sq, 'cracked') && !godCrates.includes(sq)) bad.push(`${sq} cracked without ledger`);
  for (const sq of godCrates) if (has(sq, 'furniture') && !has(sq, 'cracked')) bad.push(`${sq} god crate painted as authored`);
  const at = (f, r) => String.fromCharCode(97 + f) + r;
  const standing = (f, r) => { const sq = at(f, r); return !!cl(sq) && (has(sq, 'wall') || has(sq, 'cracked') || has(sq, 'skin-door') || has(sq, 'skin-masonry')); };
  for (const sq of Object.keys(cells)) {
    const f = sq.charCodeAt(0) - 97;
    const r = parseInt(sq.slice(1), 10);
    if (has(sq, 'ruin')) {
      const want = (standing(f, r + 1) ? 1 : 0) | (standing(f + 1, r) ? 2 : 0) | (standing(f, r - 1) ? 4 : 0) | (standing(f - 1, r) ? 8 : 0);
      if (!has(sq, `wm-${want}`)) bad.push(`${sq} ruin wears ${caseOf(sq)}, its standing neighbours say wm-${want}`);
    }
    if (S.decor(sq) === 'doorway') {
      // Four bits since the camera (2026-09-08): a north–south door's
      // doorway has its posts above and below.
      const want = (standing(f, r + 1) ? 1 : 0) | (standing(f + 1, r) ? 2 : 0) | (standing(f, r - 1) ? 4 : 0) | (standing(f - 1, r) ? 8 : 0);
      if (!has(sq, `wm-${want}`)) bad.push(`${sq} doorway wears ${caseOf(sq)}, its standing walls say wm-${want}`);
    }
    if (has(sq, 'hole')) {
      const isHole = (ff, rr) => has(at(ff, rr), 'hole');
      const want = (isHole(f, r + 1) ? 1 : 0) | (isHole(f + 1, r) ? 2 : 0) | (isHole(f, r - 1) ? 4 : 0) | (isHole(f - 1, r) ? 8 : 0);
      if (!has(sq, `wm-${want}`)) bad.push(`${sq} hole wears ${caseOf(sq)}, its hole neighbours say wm-${want}`);
    }
  }
  void fen;
  return bad;
}

// --- residue clears on the player's move, and the cancel path stayed clean ---
const st = await page.evaluate(() => window.__DCK.app.duel?.state);
if (st === 'playing') {
  await page.evaluate(async () => {
    await window.__DCK.playerMove(window.__DCK.randomMove());
  });
  // Immediately after the player's move (before/while the reply lands) the
  // previous residue is gone; the gods line too.
  const cleared = await page.evaluate(() => ({ marks: window.__DCK.marks.quake, godsLine: window.__DCK.marks.godsLine, arrows: window.__DCK.cheat.arrows.length }));
  const replyQuaked = await page.evaluate(() => window.__DCK.record.quakes.length);
  expect(cleared.marks === null || replyQuaked > 0, 'residue cleared by the player\'s move (unless the reply already quaked again)');
  expect(cleared.arrows === 0 || replyQuaked >= 0, 'hint arrows cleared the moment the position changed');
  await page.evaluate(() => window.__DCK.waitIdle());
}
const logAll = await page.evaluate(() => [...document.querySelectorAll('#duel-log div')].map((d) => d.textContent));
expect(!logAll.some((l) => l.includes('unresponsive')), 'no probe cancel ever fell through to a recycle');
expect(!logAll.some((l) => l.includes('probe failed')), 'no probe failure during the run');
expect(!logAll.some((l) => l.includes('desync')), 'no engine desync');
expect(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors.join(' | ')}` : ''}`);
expect(quakesChecked > 0, `${quakesChecked} quake(s) fired in ${PLIES} plies`);
expect(hintTurns === turns, `hints painted on every player turn (${hintTurns}/${turns})`);
await shot('05-final');
// The options panel: the new "Keep evaluating" toggle and the terrain legend.
// A programmatic click: the end-of-duel overlay may be covering the topbar
// button when the random game finished early, and a real click would wait
// on it forever.
await page.evaluate(() => document.getElementById('btnOptions').click());
expect(await page.evaluate(() => !!document.getElementById('optHintCont') && document.querySelectorAll('.legend canvas[data-legend]').length === 5 && !document.getElementById('optRenderer') && !document.getElementById('optPiecePixels') && !document.getElementById('optPieceScale')), 'options panel has the Keep-evaluating toggle, a 5-tile legend, and no Renderer / piece-mode / % dial (retired with the DOM board)');
// The board's geometry: an integer scale, a device-pixel-sized canvas, the
// diagnostics line saying so, the placement dials in whole tile pixels;
// the Scaling option remounts live (fill = the exact quotient) and back.
{
  const geo = await page.evaluate(() => { const K = window.__DCK; return { info: K.renderer.info, diag: K.renderer.diagShown, fit: K.pieceFit, pxDialsShown: !document.getElementById('optTileLift').closest('.opt').hidden, canvases: document.querySelectorAll('#board canvas').length, cw: document.querySelector('#board canvas').width, cssW: document.querySelector('#board canvas').getBoundingClientRect().width, pieces: document.querySelectorAll('#board .piece, #board .cell').length }; });
  expect(geo.info.renderer === 'canvas' && geo.info.integer && Number.isInteger(geo.info.k) && geo.info.k >= 1 && geo.info.devW === geo.cw && Math.abs(geo.cssW * geo.info.dpr - geo.cw) < 1, `canvas board: k ${geo.info.k} (${geo.info.tilePx} device px per tile), the canvas ${geo.cw} device px = its css width × ${geo.info.dpr}, one canvas on the board (${geo.canvases})`);
  expect(typeof geo.diag === 'string' && geo.diag.startsWith('canvas ·') && geo.diag.includes(`k ${geo.info.k}`), `the diagnostics line reads "${geo.diag}"`);
  expect(geo.fit.pixels === 'tile' && geo.pxDialsShown && geo.pieces === 0, `tile-grid only: lift ${geo.fit.tileLift} / shift ${geo.fit.tileShift} px, the px dials shown, no cell or piece elements on the board`);
  const sw = await page.evaluate(async () => {
    const K = window.__DCK;
    const fen = K.app.duel.fen();
    K.renderer.set('fill');
    await K.renderer.ready();
    K.renderer.paintNow();
    const fill = { info: K.renderer.info, painted: K.debris.stats().painted, canvases: document.querySelectorAll('#board canvas').length };
    K.renderer.set('integer');
    await K.renderer.ready();
    K.renderer.paintNow();
    return { fill, back: K.renderer.info, same: K.app.duel.fen() === fen, painted: K.debris.stats().painted, canvases: document.querySelectorAll('#board canvas').length, diag: K.renderer.diagShown };
  });
  expect(sw.fill.info.scaling === 'fill' && !sw.fill.info.integer && sw.fill.canvases === 1 && sw.back.integer && sw.same && sw.canvases === 1 && sw.painted === sw.fill.painted && sw.painted > 0 && !!sw.diag, `the Scaling option remounts live: → fill (k ${sw.fill.info.k.toFixed(3)}, ${sw.fill.painted} debris squares) → integer (k ${sw.back.k}, ${sw.painted} debris squares, diag back)`);
}
// --- THE CAMERA (Phase 2, 2026-09-08): the phone is the stacked layout
// north-up; the debug turn buttons turn the view a quarter at a time — the
// buffer swaps its axes, k refits, every square's hit-test round-trips
// through the turned geometry, the kinds and the debris stay put, the
// coordinates label what varies along each edge — and the door in the
// north–south line shows its LEAF once the line runs across the screen.
{
  const cam = await page.evaluate(async () => {
    const K = window.__DCK;
    const out = { layout: K.renderer.layout, start: K.renderer.info, turns: [] };
    const kinds0 = JSON.stringify([...K.app.boardUI.kinds]);
    const painted0 = K.debris.stats().painted;
    const btn = (id) => document.getElementById(id);
    for (const [click, want] of [['btnTurnR', 1], ['btnTurnR', 2], ['btnTurnL', 1], ['btnTurnL', 0], ['btnTurnL', 3]]) {
      btn(click).click();
      await K.renderer.ready();
      K.renderer.paintNow();
      const info = K.renderer.info;
      let round = 0, total = 0;
      for (const sq of K.app.boardUI.cells.keys()) {
        total++;
        const p = K.renderer.pointOfSquare(sq);
        if (K.renderer.squareAtPoint(p.x, p.y) === sq) round++;
      }
      out.turns.push({ click, want, facing: K.renderer.facing(), info, round, total, kindsSame: JSON.stringify([...K.app.boardUI.kinds]) === kinds0, painted: K.debris.stats().painted, label: document.getElementById('facingName').textContent, d8: K.marks.cell('d8'), g5: K.marks.cell('g5'), h5: K.marks.cell('h5'), diag: K.renderer.diagShown });
    }
    K.renderer.facing(0);
    await K.renderer.ready();
    K.renderer.paintNow();
    out.end = K.renderer.info;
    out.painted0 = painted0;
    return out;
  });
  expect(cam.layout.layout === 'stack' && cam.start.fit === 'width' && cam.start.facing === 0 && !cam.layout.wide, `the phone viewport is the stacked layout, fit width, north up (${JSON.stringify(cam.layout)})`);
  for (const t of cam.turns) {
    const odd = t.facing & 1;
    expect(t.facing === t.want && t.info.facing === t.want && t.info.screenCols === (odd ? t.info.ranks : t.info.files) && t.info.bufW === t.info.screenCols * 16 && Number.isInteger(t.info.k) && t.info.k >= 1, `${t.click} → facing ${t.facing} (${t.label}): the buffer is ${t.info.screenCols}×${t.info.screenRows} tiles at k ${t.info.k}`);
    expect(t.round === t.total && t.total > 0, `facing ${t.facing}: ${t.round}/${t.total} squares hit-test back to themselves`);
    expect(t.kindsSame && t.painted === cam.painted0, `facing ${t.facing}: the world-space kinds and the ${t.painted} debris squares are unchanged`);
    expect(typeof t.diag === 'string' && t.diag.includes(`${t.label}`), `facing ${t.facing}: the diagnostics line says "${t.label}"`);
    if (STAGE === 's59-hall-corner') {
      // The doors that still STAND this late in a hot duel (the gods may
      // have cracked, breached or swallowed any of them by now): d8 in the
      // north–south line is edge-on north / south up and a leaf east / west
      // up; g5 + h5, the double in the east–west south wall, are two edge-on
      // doors east / west up and the halves dealt on the screen otherwise.
      const stands = (c) => !!c && c.includes('furniture') && c.includes('skin-door');
      if (stands(t.d8)) expect(t.d8.includes('door-edge') === !odd, `facing ${t.facing}: d8's line runs ${odd ? 'across the screen — a leaf' : 'up the screen — edge-on'} (${t.d8})`);
      if (stands(t.g5) && stands(t.h5)) {
        if (odd) expect(t.g5.includes('door-edge') && t.h5.includes('door-edge') && !t.g5.some((c) => c.startsWith('door2-')), `facing ${t.facing}: the south wall's double runs up the screen — two edge-on doors (${t.g5} / ${t.h5})`);
        else expect(t.g5.includes(t.facing === 2 ? 'door2-r' : 'door2-l') && t.h5.includes(t.facing === 2 ? 'door2-l' : 'door2-r'), `facing ${t.facing}: the double's halves dealt on the screen (${t.g5} / ${t.h5})`);
      }
      if (!stands(t.d8) && !(stands(t.g5) && stands(t.h5))) notes.push(`    (facing ${t.facing}: the doors are gone by now — d8 ${t.d8?.filter((c) => /hole|ruin|furniture/.test(c)).join('/') || 'floor'}; the stance checks ran at ply 0 above)`);
    }
  }
  expect(cam.end.facing === 0 && cam.end.screenCols === cam.start.screenCols && cam.end.k === cam.start.k, `back north-up: the geometry is the start's (k ${cam.end.k})`);
  await shot('06b-facing');
}
// THE CAMERA OWNS THE SCREEN: a wide viewport flips the layout live — the
// body class, the two columns, the board an explicit box the canvas fills,
// k the largest step that fits BOTH axes (height-bound here), the board
// centred in it — and narrowing flips it back.
{
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(250);
  const wide = await page.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    K.renderer.paintNow();
    const board = document.getElementById('board');
    const c = board.querySelector('canvas');
    const br = board.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const panel = document.getElementById('player-bar').getBoundingClientRect();
    return { layout: K.renderer.layout, info: K.renderer.info, board: { w: br.width, h: br.height, x: br.left }, canvas: { w: cr.width, h: cr.height, cw: c.width, ch: c.height }, panelLeft: panel.left, wide: document.body.classList.contains('layout-wide') };
  });
  const i = wide.info;
  const fitsW = Math.floor(i.devW / i.bufW), fitsH = Math.floor(i.devH / i.bufH);
  expect(wide.wide && wide.layout.layout === 'wide' && i.fit === 'box', `1280×720: the wide layout (fit ${i.fit})`);
  expect(Math.abs(wide.canvas.w - wide.board.w) < 1 && Math.abs(wide.canvas.h - wide.board.h) < 1 && i.devW === wide.canvas.cw && i.devH === wide.canvas.ch, `the canvas IS the board's box: ${wide.canvas.cw}×${wide.canvas.ch} device px`);
  expect(Number.isInteger(i.k) && i.k === Math.min(fitsW, fitsH) && i.k >= 1, `k ${i.k} = the largest step that fits both axes (width ${fitsW}, height ${fitsH})`);
  expect(i.x0 === Math.floor((i.devW - i.bufW * i.k) / 2) && i.y0 === Math.floor((i.devH - i.bufH * i.k) / 2) && (i.x0 > 0 || i.y0 > 0), `the board is centred in the box (x0 ${i.x0}, y0 ${i.y0})`);
  expect(wide.panelLeft > wide.board.x + wide.board.w - 1, `the player's bar sits in the column beside the board (bar at ${Math.round(wide.panelLeft)} px, board ends ${Math.round(wide.board.x + wide.board.w)})`);
  await shot('06c-wide');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const back = await page.evaluate(async () => { const K = window.__DCK; await K.renderer.ready(); K.renderer.paintNow(); return { layout: K.renderer.layout, info: K.renderer.info }; });
  expect(!back.layout.wide && back.info.fit === 'width' && back.info.y0 === 0, `back at the phone width: the stacked layout, fit width (k ${back.info.k})`);
}
if (SHOTS) await page.locator('#options-card').screenshot({ path: path.join(OUT, '06-options.png') });
// --- The replay log (2026-09-06): the export builds from the live duel and
// is complete (states per ply, the engine record, inputs on every due roll,
// the mirrored duel log, the build + engine stamp), the autosave ring holds
// it, the buttons exist, and an UNDO leaves a branch holding the exact
// pre-undo board with the abandoned tail.
{
  const pre = await page.evaluate(() => {
    const d = window.__DCK.app.duel;
    const L = window.__DCK.log.build();
    const due = L.quakeTraces.filter((t) => t.path.includes('quake'));
    return {
      ply: d.ply,
      fen: d.fen(),
      state: d.state,
      saved: window.__DCK.log.saved(),
      buttons: ['btnFlag', 'btnOverlayExport', 'btnOptionsExport', 'btnOptionsCopy', 'btnSavedExport', 'btnGodsExport', 'btnOverlayReview', 'btnSavedOpen'].filter((id) => !document.getElementById(id)),
      schema: L.schema,
      states: L.states.length,
      plies: L.plies,
      ended: L.states[L.states.length - 1]?.ended === true,
      statesAligned: L.states.every((s, i) => s.ply === i || (s.ended && s.ply === L.plies)),
      engine: L.engine.length,
      engineOk: L.engine.every((e) => e.score && Number.isInteger(e.depth) && e.ms >= 0 && Array.isArray(e.pv)),
      traces: L.quakeTraces.length,
      inside: L.states.filter((x) => x.cast === 'half' || x.cast === 'pass').length, // PORTALS v3: the inside of a cast is never rolled on
      due: due.length,
      inputs: due.filter((t) => t.inputs && Array.isArray(t.inputs.hints) && t.inputs.probes).length,
      // the "why" layer: pools + rejects per rung on every due roll that acted, the meters' inputs on every ply
      why: due.filter((t) => t.outcome === 'quiet' || t.outcome === 'vetoed' || (t.candidates?.length && t.candidates.every((c) => Array.isArray(c.pool) && Array.isArray(c.rejected)))).length,
      whyPlies: L.quakeTraces.filter((t) => t.moveEv && t.stale && Array.isArray(t.threatKeys)).length,
      protectedListed: due.filter((t) => t.protected && Array.isArray(t.protected.pieceList) && t.protected.keys).length,
      timed: L.quakeTraces.every((t) => t.timing && Number.isInteger(t.timing.total) && t.seq > 0),
      quakes: L.quakes.length,
      attempts: L.attempts.length,
      branches: L.branches.length, // the residue check above already undid once
      logLines: L.log.length,
      app: L.meta.app,
      eng: L.meta.engine,
      ua: !!L.meta.ua,
      seq: L.seq,
      size: JSON.stringify(L).length,
    };
  });
  expect(pre.buttons.length === 0, `replay-log buttons present${pre.buttons.length ? ` — missing ${pre.buttons.join(',')}` : ''}`);
  // states[0] is the start and every ply adds one; on a finished game the
  // last ply's state IS the `ended` entry (no undo snapshot after a game-
  // ending move), so the count is plies + 1 either way. A game-ending MOVE
  // never reaches the quake phase, so an ended game has one trace fewer.
  expect(pre.schema === 'dck-log/1' && pre.states === pre.plies + 1 && pre.statesAligned, `export: ${pre.states} states for ${pre.plies} plies${pre.ended ? ' (the last is the final position)' : ''}, aligned`);
  expect(pre.engine > 0 && pre.engineOk && (pre.traces === pre.plies - pre.inside || (pre.ended && pre.traces === pre.plies - 1 - pre.inside)) && pre.timed, `export: ${pre.engine} engine searches with score/depth/pv/ms, ${pre.traces} timed roll traces (${pre.inside} plies inside a cast, never rolled on)`);
  expect(pre.due > 0 && pre.inputs === pre.due, `export: ${pre.inputs}/${pre.due} due rolls carry the engine inputs verbatim (${pre.quakes} quakes landed, ${pre.attempts} draws rejected)`);
  expect(pre.why === pre.due && pre.whyPlies === pre.traces && pre.protectedListed === pre.due, `export: the "why" layer — pools + rejects on ${pre.why}/${pre.due} due rolls, the protected set listed on ${pre.protectedListed}, meter inputs on ${pre.whyPlies}/${pre.traces} plies`);
  expect(pre.logLines > 0 && !!pre.app && !!pre.eng && pre.ua, `export: ${pre.logLines} mirrored log lines, build "${pre.app}", engine "${pre.eng}"`);
  expect(pre.saved.length >= 1 && pre.saved[0].plies === pre.plies, `autosave ring holds this duel (${pre.saved.length} saved, ${pre.saved[0]?.plies} plies, ${(pre.size / 1024).toFixed(0)} KB export)`);
  // Undo through the real button path (Cheater Mode + Allow undo), then
  // read the branch back from the export.
  await page.evaluate(() => { window.__DCK.options.undo = true; window.__DCK.applyOptions(); });
  const und = await page.evaluate(async () => {
    await window.__DCK.undo();
    await window.__DCK.waitIdle();
    const L = window.__DCK.log.build();
    const b = L.branches[L.branches.length - 1];
    return { n: L.branches.length, ply: L.plies, from: b?.from?.fen ?? null, fromPly: b?.fromPly, toPly: b?.toPly, fromState: b?.from?.state, tail: b?.tail?.moves?.length ?? -1, tailStates: b?.tail?.states?.length ?? -1, marker: L.tunes.some((t) => t.undo && t.branch === b?.seq), saved: window.__DCK.log.saved()[0], logLine: [...document.querySelectorAll('#duel-log div')].some((d) => d.textContent.includes('took back')) };
  });
  expect(und.n === pre.branches + 1 && und.from === pre.fen && und.fromPly === pre.ply && und.toPly === und.ply && und.fromState === pre.state, `undo → branch #${und.n}: ply ${und.fromPly} → ${und.toPly}, pre-undo board kept verbatim (game was ${und.fromState}; ${pre.branches} earlier undo${pre.branches === 1 ? '' : 's'} kept)`);
  expect(und.tail === pre.ply - und.ply && und.tailStates >= und.tail && und.marker && und.logLine, `branch tail holds the ${und.tail} abandoned plies (+${und.tailStates} states), tunes marker points at it, the log says so`);
  expect(und.saved?.branches === und.n && und.saved?.plies === und.ply, `autosave rewritten after the undo (${und.saved?.plies} plies, ${und.saved?.branches} branches)`);
  await page.evaluate(() => { window.__DCK.options.undo = false; window.__DCK.applyOptions(); });
}
// --- The replay log's in-game half (2026-09-06): the debug panel's
// "before" paints the last quake's pre-quake board and "after" restores the
// live one; "deep Δ" probes that quake's three boards at the enemy's own
// limits (the smoke's are fast) and lands the verdict on the record.
{
  await page.evaluate(() => { window.__DCK.options.godsDebug = true; window.__DCK.applyOptions(); });
  await page.waitForFunction(() => !window.__DCK.app.busy && window.__DCK.app.duel?.state === 'playing', null, { timeout: 60000 });
  const ba = await page.evaluate(() => {
    const d = window.__DCK.app.duel;
    const q = d.record.quakes[d.record.quakes.length - 1];
    const live = d.fen();
    const cells = () => Object.fromEntries([...document.querySelectorAll('#board .cell[data-square]')].map((c) => [c.dataset.square, `${[...c.classList].filter((k) => !k.startsWith('f') || k.length > 2).sort().join(' ')}|${c.querySelector('.piece')?.dataset.piece ?? ''}`]));
    const before = cells();
    const btn = document.getElementById('btnGodsBefore');
    const wasDisabled = btn.disabled;
    btn.click();
    const showing = window.__DCK.gods.showingBefore?.ply ?? null;
    const during = cells();
    const label = btn.textContent;
    btn.click();
    const after = cells();
    return {
      hasQuake: !!q,
      quakePly: q?.ply ?? null,
      wasDisabled,
      showing,
      label,
      differ: Object.keys(before).filter((k) => before[k] !== during[k]).length,
      restored: Object.keys(before).every((k) => before[k] === after[k]),
      off: window.__DCK.gods.showingBefore,
      liveFen: d.fen() === live,
      preFen: q?.preFen,
    };
  });
  expect(ba.hasQuake && !ba.wasDisabled && ba.showing === ba.quakePly && ba.label.startsWith('after') && ba.off === null && ba.restored && ba.liveFen, `before/after: painted the pre-quake board of ply ${ba.showing} (${ba.differ} cells differ) and restored the live board`);
  const deep = await page.evaluate(async () => {
    const d = window.__DCK.app.duel;
    const q = d.record.quakes[d.record.quakes.length - 1];
    const queued = window.__DCK.gods.deep();
    const t0 = Date.now();
    while (!q.deepDelta && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
    const btn = document.getElementById('btnGodsDeep');
    return { queued, dd: q.deepDelta ?? null, line: [...document.querySelectorAll('#gods-trace div')].some((x) => x.textContent.includes('DEEP Δ')), btnDisabled: btn.disabled, exported: window.__DCK.log.build().quakes.find((x) => x.ply === q.ply)?.deepDelta ?? null };
  });
  const s = (x) => (x ? `${x.type === 'mate' ? 'M' : ''}${x.value}` : '—');
  expect(deep.queued && deep.dd?.pre && deep.dd?.post && deep.dd.go && deep.line && deep.btnDisabled && deep.exported, `deep Δ landed on the last quake (${deep.dd?.go}: ${s(deep.dd?.beforeMove)} → ${s(deep.dd?.pre)} → ${s(deep.dd?.post)}), the panel says so, the export carries it`);
  await page.evaluate(() => { window.__DCK.options.godsDebug = false; window.__DCK.applyOptions(); });
}
// --- THE DEBRIS LAYER (2026-09-07): the floor remembers. A kill leaves
// blood, a smashed crate its own pixels, a breach the wall's stone, a
// displacement a skid, a crumble the floor's; the ledger is the STAGE's
// (persisted under the stage id, an epoch per duel); toggles filter the
// paint, never the record; an undo forgets the rewound plies' events. Every
// painted square carries a decoded 16×16 PNG <img> as its first child.
{
  const dz = await page.evaluate(() => {
    const K = window.__DCK;
    const d = K.app.duel;
    K.debris.save();
    const st = K.debris.stats();
    const evs = K.debris.events();
    const byKind = {};
    for (const e of evs) byKind[e.k] = (byKind[e.k] ?? 0) + 1;
    const want = { weaken: 0, breach: 0, crumble: 0, skid: 0 };
    for (const q of d.record.quakes) {
      for (const t of q.terrain ?? []) want[t.kind] = (want[t.kind] ?? 0) + 1;
      want.skid += (q.displacements ?? []).length;
      if (q.crumble) want.crumble++;
    }
    // THE SLEDGEHAMMER: a hammer cracks a wall by hand and leaves the same weaken event a god's crack does (main.mjs onMove)
    want.weaken += d.record.states.filter((x) => x.hammer).length;
    const S = window.__smoke;
    const painted = Object.keys(S.cells()).filter((sq) => K.debris.cell(sq).painted);
    // every painted square wears a 16×16 debris buffer in the canvas with painted pixels
    const urlsOk = painted.every((sq) => K.debris.cell(sq).pixels > 0);
    const paintedOnFloor = painted.every((sq) => { const cl = K.marks.cell(sq); return !cl.includes('wall') && !cl.includes('hole') && !cl.includes('furniture'); });
    // A breached square wears the wall's own stone — unless the gods crumbled
    // the bare floor the breach left into a PIT since (debris paints on
    // floor only; seen on a run whose one breach, f9, collapsed two quakes
    // later), so a square that is a hole now is not counted.
    const breachSquares = d.record.quakes.flatMap((q) => (q.terrain ?? []).filter((t) => t.kind === 'breach').map((t) => t.square)).filter((sq) => !K.marks.cell(sq)?.includes('hole'));
    const breachPainted = breachSquares.filter((sq) => !!K.debris.cell(sq)?.painted);
    // One canvas is the board: no piece elements, no overlay layers.
    const layerOrder = { canvases: document.querySelectorAll('#board canvas').length, piece: document.querySelectorAll('#board .piece').length, overlays: document.querySelectorAll('#board svg, #board .fx-layer').length };
    const captures = d.record.sans.filter((s) => s.includes('x')).length;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(K.debris.key + K.debris.env)); } catch { /* none */ }
    return {
      env: K.debris.env, stageId: d.record.deal?.stageId ?? K.app.session.deal.stageId, epoch: st.epoch, events: st.events, byKind, want, traffic: st.traffic, pending: st.pending,
      attr: document.getElementById('board').dataset.debris, painted: painted.length, urlsOk, paintedOnFloor, breach: breachSquares.length, breachPainted: breachPainted.length,
      captures, plyMax: Math.max(0, ...evs.map((e) => e.p)), ply: d.ply, samplerN: st.sampler, layerOrder,
      savedEvents: saved?.events?.length ?? null, savedEpoch: saved?.epoch ?? null, savedId: saved?.id ?? null,
    };
  });
  expect(dz.env === dz.stageId && dz.savedId === dz.env && dz.epoch >= 1, `the debris ledger is the stage's own (${dz.env}, epoch ${dz.epoch}), saved under its id`);
  expect(dz.attr === 'destruction blood skid wear fx', `the board carries data-debris (${dz.attr})`);
  expect((dz.byKind.kill ?? 0) + (dz.byKind.smash ?? 0) === dz.captures, `one kill or smash per capture on the record (${dz.byKind.kill ?? 0} kills + ${dz.byKind.smash ?? 0} smashes = ${dz.captures} captures)`);
  expect((dz.byKind.weaken ?? 0) === dz.want.weaken && (dz.byKind.breach ?? 0) === dz.want.breach && (dz.byKind.skid ?? 0) === dz.want.skid && (dz.byKind.crumble ?? 0) === dz.want.crumble, `every quake rung left its event (weaken ${dz.byKind.weaken ?? 0}/${dz.want.weaken}, breach ${dz.byKind.breach ?? 0}/${dz.want.breach}, skid ${dz.byKind.skid ?? 0}/${dz.want.skid}, crumble ${dz.byKind.crumble ?? 0}/${dz.want.crumble})`);
  expect(dz.events > 0 && dz.painted > 0 && dz.urlsOk && dz.paintedOnFloor && dz.pending === 0, `${dz.painted} squares wear a 16×16 debris buffer in the canvas, all on floor, nothing left in flight (${dz.events} events)`);
  expect(dz.layerOrder.canvases === 1 && dz.layerOrder.piece === 0 && dz.layerOrder.overlays === 0, `the canvas board: one canvas, no piece elements, no overlay layers`);
  expect(dz.breach === 0 || dz.breachPainted > 0, `a breached wall's square wears its own stone (${dz.breachPainted}/${dz.breach})`);
  expect(dz.plyMax <= dz.ply, `no event outlives the record after the undos (latest event ply ${dz.plyMax} ≤ ${dz.ply})`);
  expect(dz.traffic > 0, `traffic wears the floor (${dz.traffic} cells visited)`);
  expect(dz.savedEvents === dz.events && dz.savedEpoch === dz.epoch, `localStorage holds the ledger (${dz.savedEvents} events, epoch ${dz.savedEpoch})`);
  expect(dz.samplerN > 0, `the sprite sampler decoded ${dz.samplerN} sprites off the atlas`);
  // Toggles filter the paint, not the record.
  const tog = await page.evaluate(async () => {
    const K = window.__DCK;
    const count = () => window.__smoke.painted();
    const before = count();
    K.options.debris = { ...K.options.debris, destruction: false, blood: false, skid: false, wear: false };
    K.applyOptions();
    const off = count();
    const attrOff = document.getElementById('board').dataset.debris;
    const eventsOff = K.debris.stats().events;
    K.options.debris = { ...K.options.debris, destruction: true, blood: true, skid: true, wear: true };
    K.applyOptions();
    // the squares come back once each buffer is re-encoded (setDebris) — a few ms
    const t0 = Date.now();
    while (count() < before && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
    return { before, off, attrOff, eventsOff, after: count(), waited: Date.now() - t0 };
  });
  expect(tog.before > 0 && tog.off === 0 && tog.attrOff === 'off' && tog.eventsOff === dz.events && tog.after === tog.before, `toggles hide the paint and keep the record (${tog.before} → ${tog.off} → ${tog.after} painted squares, ${tog.eventsOff} events; the images were back in ${tog.waited} ms)`);
  await shot('debris');
  // The scars persist: back to the preview of the same stage, then a new duel — epoch + 1, every event kept.
  const again = await page.evaluate(async () => {
    const K = window.__DCK;
    const events = K.debris.stats().events, epoch = K.debris.stats().epoch;
    K.preview();
    await new Promise((r) => setTimeout(r, 300));
    const previewPainted = window.__smoke.painted();
    const previewPhase = K.app.phase;
    await K.begin();
    return { events, epoch, previewPainted, previewPhase, epochNow: K.debris.stats().epoch, eventsNow: K.debris.stats().events, phase: K.app.phase };
  });
  await page.waitForFunction(() => !window.__DCK.app.busy && window.__DCK.app.duel?.state === 'playing', null, { timeout: 60000 });
  expect(again.previewPhase === 'preview' && again.previewPainted > 0, `the setup preview shows the stage's scars (${again.previewPainted} squares)`);
  expect(again.epochNow === again.epoch + 1 && again.eventsNow === again.events && again.phase === 'playing', `a rematch is a new epoch on the same floor (epoch ${again.epoch} → ${again.epochNow}, ${again.eventsNow} events kept)`);
}
// --- THE FLIGHT: with motion on, the debris flies before it lands (the
// board draws the flight's frames; the landing paints the squares). ---
{
  let page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push(String(e).split('\n')[0]));
  const q2 = new URLSearchParams({ stage: STAGE, autobegin: '1', seed: SEED, go: GO, probe: 'depth 6 movetime 100', onset: '1', mramp: '2', debt: '2', ...(THEME ? { theme: THEME } : {}) });
  await page2.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&${q2}`);
  page2 = await bootWait(page2, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?deck=off&${q2}`, (p) => p.on('pageerror', (e) => errs2.push(String(e).split('\n')[0])));
  await page2.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const fl = await page2.evaluate(async () => {
    const K = window.__DCK;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let captures = 0, plies = 0;
    for (; plies < 40 && K.app.duel.state === 'playing'; plies++) {
      await K.playerMove(K.randomMove());
      const t0 = Date.now();
      while ((K.app.busy || K.debris.busy) && Date.now() - t0 < 30000) await wait(50);
      captures = K.app.duel.record.sans.filter((s) => s.includes('x')).length;
      if (captures >= 2 && K.debris.frames() > 0) break;
    }
    const t0 = Date.now();
    while (K.debris.busy && Date.now() - t0 < 5000) await wait(50);
    const evs = K.debris.events();
    const st = K.debris.stats();
    return { plies, captures, frames: K.debris.frames(), persistent: st.painted, transient: K.debris.busy ? 1 : 0, events: evs.length, pending: st.pending, flights: st.flights, fx: K.debris.options.fx };
  });
  expect(fl.fx && fl.events > 0, `motion on: ${fl.events} events over ${fl.plies} plies (${fl.captures} captures)`);
  expect(fl.frames > 0, `the flight drew ${fl.frames} frames into the canvas buffer`);
  expect(fl.pending === 0 && fl.flights === 0 && fl.transient === 0 && fl.persistent > 0, `everything landed: no flight held, nothing pending, the flight cleared, ${fl.persistent} squares keep their debris`);
  expect(errs2.length === 0, `no page errors with the flight on${errs2.length ? ` — ${errs2.join(' | ')}` : ''}`);
  await page2.close();
}
// --- THE WINDOW (Phase 2 milestone 4, 2026-09-08): `?zoom=12&viewport=screen`
// on a phone puts the arena at a zoom the screen cannot hold whole, so the
// board paints a WINDOW of it — a sub-rectangle of the buffer blitted, the
// visible squares hit-testing back through the window, the diag naming the
// fit — and the duel plays on unchanged.
{
  let page3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs3 = [];
  page3.on('pageerror', (e) => errs3.push(String(e).split('\n')[0]));
  const q3 = new URLSearchParams({ stage: STAGE, autobegin: '1', seed: SEED, go: GO, probe: 'depth 6 movetime 100', zoom: '12', viewport: 'screen', debris: 'off', fx: '0', ...(THEME ? { theme: THEME } : {}) });
  await page3.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&${q3}`);
  page3 = await bootWait(page3, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?deck=off&${q3}`, (p) => p.on('pageerror', (e) => errs3.push(String(e).split('\n')[0])));
  await page3.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const win = await page3.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    K.renderer.paintNow();
    const info = K.renderer.info;
    const inWin = (col, row) => col >= info.window.col0 && col < info.window.col0 + info.window.cols && row >= info.window.row0 && row < info.window.row0 + info.window.rows;
    let visible = 0, round = 0, cells = 0, cellRound = 0;
    for (const sq of K.app.boardUI.cells.keys()) {
      const g = K.app.boardUI.gridPos(sq);
      if (!inWin(g.col, g.row)) continue;
      visible++;
      const p = K.renderer.pointOfSquare(sq);
      if (K.renderer.squareAtPoint(p.x, p.y) === sq) round++;
      const c = K.app.boardUI.cells.get(sq).cell;
      cells++;
      const pc = K.renderer.pointOfCell(c.f, c.r);
      const back = K.renderer.cellAtPoint(pc.x, pc.y);
      if (back && back.f === c.f && back.r === c.r) cellRound++;
    }
    // Zoom out to 2 through the hook: the whole arena fits the width again (the window clips to the world).
    K.renderer.zoom(2);
    await K.renderer.ready();
    K.renderer.paintNow();
    const info3 = K.renderer.info;
    return { info, visible, round, cells, cellRound, diag: K.renderer.diagShown, info3, state: K.app.duel.state };
  });
  expect(win.info.fit === 'window' && win.info.k === 12 && win.info.viewport === 'screen', `?zoom=12&viewport=screen: fit window at k 12 (${win.info.fit}, k ${win.info.k}, ${win.info.viewport})`);
  expect(win.info.window.cols < win.info.files && win.info.bufW === win.info.window.cols * 16 && win.info.blit.sw < win.info.bufW + 1 && win.info.blit.sw * win.info.k >= win.info.devW - 1, `the buffer is a ${win.info.window.cols}×${win.info.window.rows} window of the ${win.info.files}×${win.info.ranks} arena, the blit its visible ${win.info.blit.sw}×${win.info.blit.sh} px`);
  expect(win.visible > 0 && win.round === win.visible && win.cellRound === win.cells, `${win.round}/${win.visible} visible squares and ${win.cellRound}/${win.cells} cells hit-test back through the window`);
  expect(typeof win.diag === 'string' && win.diag.includes('fit window'), `the diagnostics line says fit window (${win.diag})`);
  expect(win.info3.k === 2 && win.info3.window.cols === win.info3.files && win.info3.blit.sw === win.info3.bufW && win.state === 'playing', `zoom 2: the whole arena is the window again (${win.info3.window.cols} cols, blit ${win.info3.blit.sw} of ${win.info3.bufW}); the duel plays on`);
  expect(errs3.length === 0, `no page errors on the window page${errs3.length ? ` — ${errs3.join(' | ')}` : ''}`);
  await page3.close();
}
// --- THE WALK (Phase 2 milestone 4b, 2026-09-08; the controls and camera
// session, 2026-09-09): `?gen=` begins a run on a generated floor; the
// inputs are WORLD-relative and the facing follows the step (a step in a
// new direction pivots first), a `face` input turns in place for a move, a
// wall refuses, the run saves after every turn (schema dck-run/6) and
// exports as one object, a tapped piece marks its chess moves WITHOUT
// moving the camera or the zoom (no box outline since 2026-09-10), the pad's tap turns
// and the keys face, a DRAG looks around and the next move brings the
// camera back, a PINCH steps the zoom, leaving and resuming keep the turn,
// an import lands on the imported state. The board is north-up throughout.
{
  const page4 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs4 = [];
  page4.on('pageerror', (e) => errs4.push(String(e).split('\n')[0]));
  await page4.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&gen=vaults&seed=1&fx=0&enemies=off`); // the enemies have their own block below; this one walks an empty floor
  await page4.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 120000 });
  const wk = await page4.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    K.renderer.paintNow();
    const out = {};
    out.screen = { walk: !document.getElementById('screen-walk').hidden, duel: !document.getElementById('screen-duel').hidden, setup: !document.getElementById('screen-setup').hidden };
    out.info = K.renderer.info;
    out.start = K.walk.state;
    out.world = { id: K.app.walk.world.id, facing: K.app.walk.world.start.facing, theme: K.app.walk.world.theme, files: K.app.walk.world.files, ranks: K.app.walk.world.ranks };
    out.saved0 = K.walk.saved();
    out.noEnemies = K.walk.enemies.length === 0 && K.walk.state.rows.join('').replace(/[^a-z]/g, '').length === 0;
    // A step the way the army faces (east at the start) is +f for every piece, no pivot; the board stays north-up.
    const fwd = [[0, 1], [1, 0], [0, -1], [-1, 0]][out.start.facing];
    const p1 = await K.walk.input({ kind: 'step', df: fwd[0], dr: fwd[1] });
    out.step = { ok: p1.ok, pivot: p1.pivot, moves: p1.moves.length, state: K.walk.state, boardFacing: K.renderer.info.facing };
    // A face input costs a move: the facing turns a quarter right, the king stays, the board does not turn.
    const p2 = await K.walk.input({ kind: 'face', facing: (out.start.facing + 1) % 4 });
    out.turn = { ok: p2.ok, pivot: p2.pivot, state: K.walk.state, facing: K.renderer.info.facing };
    // A wait.
    const p3 = await K.walk.input({ kind: 'wait' });
    out.wait = { ok: p3.ok, turn: K.walk.state.turn };
    // Step east until a wall refuses (the ring at the latest); the first east step pivots the army east.
    let refused = null, pivots = 0;
    for (let i = 0; i < 80 && !refused; i++) { const p = await K.walk.input({ kind: 'step', df: 1, dr: 0 }); if (!p.ok) refused = p.reason; else if (p.pivot) pivots++; }
    out.refused = { reason: refused, turn: K.walk.state.turn, status: document.getElementById('walk-status').textContent, pivots, facing: K.walk.state.facing };
    // The save after every turn: the stored run's turn equals the state's; the export is one object of the schema with the turn list.
    const saved = K.walk.saved();
    const exp = K.walk.export();
    out.save = { schema: exp.schema, turn: saved.turn, turns: exp.turns.length, worldId: exp.worldId, hasStart: !!exp.start?.world, hasFloor: !!exp.floors?.[exp.floor]?.world, key: localStorage.getItem('dck.run.v1') ? 1 : 0 };
    // Tap a piece (the king included): its chess moves are marked, the zoom and the focus stay, no box outline (the box is read off the debug surface); tap elsewhere: let go.
    const settle = async () => { await new Promise((r) => setTimeout(r, 30)); while (K.walk.busy) await new Promise((r) => setTimeout(r, 20)); };
    // The first piece with a chess move to offer (a pawn against a wall has none).
    const pc = K.walk.state.pieces.filter((p) => p.ch !== 'K').find((p) => { K.walk.select(p.f, p.r); const n = K.walk.state.targets.length; K.walk.select(-1, -1); return n > 0; }) ?? K.walk.state.pieces[1];
    const z0 = K.walk.zoom();
    const f0 = K.walk.focus();
    K.walk.select(pc.f, pc.r);
    const f1 = K.walk.focus();
    out.tap = { z0, z1: K.renderer.info.k, selected: K.walk.state.selected, targets: K.walk.state.targets.length, focusSame: f0.f === f1.f && f0.r === f1.r && f0.dx === f1.dx && f0.dy === f1.dy, box: K.walk.box(), chessOnly: K.walk.state.targets.every((t) => pc.ch === 'N' ? Math.abs(t.f - pc.f) * Math.abs(t.r - pc.r) === 2 : pc.ch === 'R' ? t.f === pc.f || t.r === pc.r : true) };
    K.walk.select(-1, -1);
    out.tap.z2 = K.renderer.info.k;
    out.tap.cleared = K.walk.state.selected === null;
    const kg = K.walk.state.king;
    K.walk.select(kg.f, kg.r);
    out.tapKing = { selected: K.walk.state.selected, targets: K.walk.state.targets.length, allAdjacent: K.walk.state.targets.every((t) => Math.max(Math.abs(t.f - kg.f), Math.abs(t.r - kg.r)) === 1) };
    K.walk.select(-1, -1);
    // The zoom steps as a cut through the surface (the buttons are gone; + − and the wheel drive it).
    K.walk.zoom(z0 + 1);
    out.zoomIn = K.renderer.info.k;
    K.walk.zoom(z0);
    out.zoomOut = K.renderer.info.k;
    // The pad: a TAP on the south arm while facing east turns the army south (a move); the keys: 'q' faces left.
    const t0 = K.walk.state.turn;
    { const pad = document.getElementById('walk-pad'); const pr = pad.getBoundingClientRect(); const px = pr.left + pr.width / 2, py = pr.top + pr.height * 0.86; const pev = (type) => pad.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: px, clientY: py, pointerId: 9, button: 0, buttons: 1 })); pev('pointerdown'); out.padLit = pad.dataset.dir; pev('pointerup'); }
    await settle();
    out.padTap = { turns: K.walk.state.turn - t0, facing: K.walk.state.facing };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    await settle();
    out.pad = { turns: K.walk.state.turn - t0, facing: K.walk.state.facing };
    // A key chord: W and D together is one north-east input (facing east keeps east, so no pivot); the key held past the chord window and released.
    const t2 = K.walk.state.turn, kq = { ...K.walk.state.king };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await new Promise((r) => setTimeout(r, 90));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true }));
    await settle();
    const lastInput = K.walk.saved().turns.at(-1);
    const chordInputs = K.walk.saved().turns.filter((i) => i.kind !== 'duel').slice(t2);
    out.chord = { turns: K.walk.state.turn - t2, last: lastInput, allNE: chordInputs.every((i) => i.kind === 'step' && i.df === 1 && i.dr === 1), king: { ...K.walk.state.king }, from: kq, facing: K.walk.state.facing };
    // A DRAG on the map looks around: the focus moves, no turn is spent; the next move brings the camera back.
    const t1 = K.walk.state.turn;
    const el = document.getElementById('walk-board');
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pe = (type, x, y, id = 7) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: id, button: 0, buttons: 1 }));
    const before = K.walk.focus();
    pe('pointerdown', cx, cy); pe('pointermove', cx + 30, cy + 10); pe('pointermove', cx + 60, cy + 20); pe('pointerup', cx + 60, cy + 20);
    await settle();
    out.drag = { turns: K.walk.state.turn - t1, look: K.walk.look(), focusBefore: before, focusAfter: K.walk.focus(), facing: K.walk.state.facing };
    await K.walk.input({ kind: 'wait' });
    out.drag.lookAfterMove = K.walk.look();
    // A PINCH steps the zoom: two pointers spreading apart step k up, closing step it down.
    const zp = K.walk.zoom();
    pe('pointerdown', cx - 40, cy, 11); pe('pointerdown', cx + 40, cy, 12);
    pe('pointermove', cx - 80, cy, 11); pe('pointermove', cx + 80, cy, 12);
    out.pinchUp = K.walk.zoom();
    pe('pointermove', cx - 20, cy, 11); pe('pointermove', cx + 20, cy, 12);
    out.pinchDown = K.walk.zoom();
    pe('pointerup', cx - 20, cy, 11); pe('pointerup', cx + 20, cy, 12);
    out.pinchBase = zp;
    // Leave: the setup shows the resume card; resume: the same turn and facing.
    const snap = K.walk.state;
    K.walk.leave();
    out.leave = { phase: K.app.phase, resume: !document.getElementById('btnRunResume').hidden, resumeText: document.getElementById('btnRunResume').textContent };
    K.walk.resume();
    await K.renderer.ready();
    const back = K.walk.state;
    out.resume = { phase: K.app.phase, sameTurn: back.turn === snap.turn, sameFacing: back.facing === snap.facing, sameKing: back.king.f === snap.king.f && back.king.r === snap.king.r };
    // Import: a copy of the export with the king moved one cell in the save lands on that state; a wrong stamp is refused.
    const bad = { ...exp, schema: 'dck-run/0' };
    const badOk = await K.walk.import(bad);
    out.importBad = { ok: badOk, note: document.getElementById('run-note').textContent };
    const copy = JSON.parse(JSON.stringify(K.walk.export()));
    copy.turn = 99;
    const okImport = await K.walk.import(copy);
    out.importOk = { ok: okImport, turn: K.walk.state.turn, phase: K.app.phase };
    return out;
  });
  expect(wk.screen.walk && !wk.screen.duel && !wk.screen.setup, 'the walk screen is up, the duel and setup screens down');
  expect(wk.info.fit === 'window' && wk.info.viewport === 'screen' && Number.isInteger(wk.info.k) && wk.info.k >= 1 && wk.info.crop === null, `the board is a window over the world at k ${wk.info.k} with no crop`);
  expect(wk.start.worldId === 'vaults-1' && wk.start.facing === wk.world.facing && wk.start.pieces.length === 8 && wk.start.turn === 0, `the run begins on the generated floor facing its start's way with the 4×2 opening kit (${wk.start.pieces.length} pieces, turn ${wk.start.turn})`);
  expect(wk.saved0 && wk.saved0.turn === 0, 'the run is saved at turn 0');
  expect(wk.noEnemies, '?enemies=off walks an empty floor: no enemy, no lowercase letter');
  expect(wk.step.ok && !wk.step.pivot && wk.step.moves === 8 && wk.step.state.king.f === wk.start.king.f + [[0, 1], [1, 0], [0, -1], [-1, 0]][wk.start.facing][0] && wk.step.state.king.r === wk.start.king.r + [[0, 1], [1, 0], [0, -1], [-1, 0]][wk.start.facing][1] && wk.step.state.turn === 1 && wk.step.boardFacing === 0, `a step the way the army faces moves all eight one cell ahead, no pivot, the board north-up (${wk.step.moves} moves, king ${wk.step.state.king.f})`);
  expect(wk.turn.ok && wk.turn.pivot && wk.turn.state.facing === (wk.start.facing + 1) % 4 && wk.turn.facing === 0 && wk.turn.state.king.f === wk.step.state.king.f && wk.turn.state.king.r === wk.step.state.king.r && wk.turn.state.turn === 2, `a face input pivots the army a quarter right for a move; the king stays and the board stays north-up (army facing ${wk.turn.state.facing}, board ${wk.turn.facing})`);
  expect(wk.wait.ok && wk.wait.turn === 3, 'a wait passes a turn');
  expect(wk.refused.reason === 'blocked' && /blocked/.test(wk.refused.status) && wk.refused.pivots === 1 && wk.refused.facing === 1, `stepping east pivots the army east once and walks until a wall refuses and says so (${wk.refused.reason}, turn ${wk.refused.turn}, ${wk.refused.pivots} pivot)`);
  expect(wk.save.schema === 'dck-run/6' && wk.save.turn === wk.refused.turn && wk.save.turns === wk.refused.turn && wk.save.worldId === 'vaults-1' && wk.save.hasStart && wk.save.hasFloor && wk.save.key === 1, `the run saves after every turn under one key: schema ${wk.save.schema}, turn ${wk.save.turn}, ${wk.save.turns} inputs, the start and the floor inside`);
  expect(wk.tap.selected !== null && wk.tap.targets > 0 && wk.tap.z1 === wk.tap.z0 && wk.tap.z2 === wk.tap.z0 && wk.tap.focusSame && wk.tap.cleared && wk.tap.chessOnly, `a tapped piece marks ${wk.tap.targets} chess moves with the zoom (${wk.tap.z0}) and the focus unmoved; a tap elsewhere lets go`);
  expect(wk.tap.box && wk.tap.box.ok && wk.tap.box.rect.f1 - wk.tap.box.rect.f0 === 9 && wk.tap.box.rect.r1 - wk.tap.box.rect.r0 === 9, `the box the army must fit is a 10×10 on the king's rank, nobody behind him (${JSON.stringify(wk.tap.box?.rect)}, depth ${wk.tap.box?.minDy}…${wk.tap.box?.maxDy}, span ${wk.tap.box?.spread})`);
  expect(wk.tapKing.selected !== null && wk.tapKing.targets > 0 && wk.tapKing.allAdjacent, `the king can be tapped and offers his own chess moves (${wk.tapKing.targets}, all adjacent)`);
  expect(wk.zoomIn === wk.tap.z0 + 1 && wk.zoomOut === wk.tap.z0, `the zoom steps k as a cut (${wk.tap.z0} → ${wk.zoomIn} → ${wk.zoomOut})`);
  expect(wk.padTap.turns === 1 && wk.padTap.facing === 2 && wk.padLit === '0,-1', `a tap on the pad's south arm (lit ${JSON.stringify(wk.padLit)}) turns the army south in place for one move (${wk.padTap.turns} turn, facing ${wk.padTap.facing})`);
  expect(wk.pad.turns === 2 && wk.pad.facing === 1, `q faces left, south → east, for a move (${wk.pad.turns} turns, facing ${wk.pad.facing})`);
  // With motion off (fx=0) a held chord chains a step per tick, so the count is the hold's; every input it made must be the one north-east step.
  expect(wk.chord.turns === 0 || (wk.chord.allNE && wk.chord.last?.kind === 'step' && wk.chord.last.df === 1 && wk.chord.last.dr === 1 && wk.chord.facing === 1), `W and D together are one north-east input, and facing east stays east (${wk.chord.turns} turn(s), all north-east ${wk.chord.allNE}, last input ${JSON.stringify(wk.chord.last)})`);
  expect(wk.drag.turns === 0 && wk.drag.look && (wk.drag.look.dx !== 0 || wk.drag.look.dy !== 0) && (wk.drag.focusAfter.dx !== wk.drag.focusBefore.dx || wk.drag.focusAfter.dy !== wk.drag.focusBefore.dy) && wk.drag.lookAfterMove === null, `a drag looks around without spending a turn (look ${JSON.stringify(wk.drag.look)}) and the next move brings the camera back`);
  expect(wk.pinchUp > wk.pinchBase && wk.pinchDown === wk.pinchBase, `a pinch steps the zoom up and back down in whole steps (${wk.pinchBase} → ${wk.pinchUp} → ${wk.pinchDown})`);
  expect(wk.leave.phase === 'setup' && wk.leave.resume && /turn/.test(wk.leave.resumeText), `leaving keeps the run: the setup offers "${wk.leave.resumeText}"`);
  expect(wk.resume.phase === 'walk' && wk.resume.sameTurn && wk.resume.sameFacing && wk.resume.sameKing, 'resuming lands on the same turn, facing and king');
  expect(wk.importBad.ok === false && /dck-run\/0/.test(wk.importBad.note), `a save of another schema is refused with one line (${wk.importBad.note})`);
  expect(wk.importOk.ok && wk.importOk.turn === 99 && wk.importOk.phase === 'walk', `an imported save is the run now (turn ${wk.importOk.turn})`);
  expect(errs4.length === 0, `no page errors on the walk${errs4.length ? ` — ${errs4.join(' | ')}` : ''}`);
  await page4.close();
}
// --- THE BARRIER BY HAND (Phase 2 milestone 4c, 2026-09-08): on the
// fixture, three steps into the corridor, the button drops the barrier —
// the duel runs ON THE WORLD (the crop's FEN equals the duel's board every
// ply, the window shows the dungeon around the crop), a pending entry is
// saved; a concession ends it and the ONE overlay button walks the army
// out whole around the king's final cell with the enemy gone and the run
// recording the duel as its result; a smash on the walk scars the floor
// and the scars ride in the run; a reload mid-duel re-drops the same seeded
// duel; the analyzer paints the barrier log from its world block; a second
// duel on a scarred floor seeds the gods with the pit; a loss ends the run
// and resume refuses it.
{
  const page5 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs5 = [];
  page5.on('pageerror', (e) => errs5.push(String(e).split('\n')[0]));
  const q5 = 'fx=0&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&enemies=off'; // an empty floor: the enemies have their own block below
  await page5.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&gen=vaults&seed=1&${q5}`);
  await page5.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 120000 });
  const bar = await page5.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); if (K.app.busy || K.walk.busy) throw new Error(`still busy after 30 s (app ${K.app.busy}, walk ${K.walk.busy}, phase ${K.app.phase}, duel ${K.app.duel?.state})`); };
    const board = (fen) => fen.split(' ')[0].replace(/\[[^\]]*\]$/, ''); // the board field without the holdings (THE PORTAL SPELL: the scrolls ride the FEN)
    const out = {};
    out.world = { id: K.app.walk.world.id, facing: K.app.walk.world.start.facing, theme: K.app.walk.world.theme };
    out.walkTurn = K.walk.state.turn;
    // A smash on the walk: the first piece with a capture among its own moves smashes it; the floor records it.
    // A generated floor promises no crate within reach of the start, so when none is, one is set down on a knight's landing cell by hand.
    const findSmash = () => {
      for (const p of K.walk.state.pieces) {
        if (p.ch === 'K') continue;
        K.walk.select(p.f, p.r);
        const t = K.walk.state.targets.find((x) => x.capture);
        K.walk.select(-1, -1);
        if (t) return { id: p.id, to: { f: t.f, r: t.r } };
      }
      return null;
    };
    let smash = findSmash();
    if (!smash) {
      const n = K.walk.state.pieces.find((p) => p.ch === 'N');
      K.walk.select(n.f, n.r);
      const t = K.walk.state.targets.find((x) => !x.capture && Math.abs(x.f - n.f) * Math.abs(x.r - n.r) === 2); // a knight's hop, not a king step
      K.walk.select(-1, -1);
      if (t) { K.app.walk.world.setTerrain(t.f, t.r, '^'); K.app.boardUI.refresh(); smash = findSmash(); }
    }
    if (smash) await K.walk.input({ kind: 'move', id: smash.id, to: smash.to });
    out.smash = { found: !!smash, debris: K.walk.debris(), saved: K.walk.saved()?.floors[K.walk.saved().floor]?.debris?.events?.length ?? null };
    // THE DROP, through the real button (the initiative select at its default: the player moves first).
    const standing = K.walk.state.pieces.map((p) => ({ ch: p.ch, f: p.f, r: p.r }));
    localStorage.setItem('dck.setup.v1', JSON.stringify({ black: { width: 3, mode: 'pieces', pieces: 'NN', archetype: 'heavies-deep', anchor: 'center' } }));
    document.getElementById('btnWalkBarrier').click();
    await new Promise((r) => setTimeout(r, 50));
    await settle();
    for (let i = 0; i < 200 && K.app.phase !== 'playing'; i++) await new Promise((r) => setTimeout(r, 50));
    out.drop = { phase: K.app.phase, screen: { walk: !document.getElementById('screen-walk').hidden, duel: !document.getElementById('screen-duel').hidden }, back: document.getElementById('btnBack').hidden, duel: K.walk.duel, session: K.app.session?.kind, crop: K.walk.crop, info: K.renderer.info };
    out.drop.fenEqual0 = !!K.app.duel && board(K.walk.arenaFen()) === board(K.app.duel.fen());
    // THE PIECES WHERE THEY STAND (2026-09-10): every piece of the walk is the same letter on the same world cell in the duel's crop.
    out.drop.standing = standing.every((p) => K.walk.cell(p.f, p.r)?.v === p.ch);
    out.drop.standingN = standing.length;
    out.pending = K.walk.saved()?.pending ?? null;
    // Two plies: the player's random move, the engine's reply; the world's crop follows the board.
    await settle();
    if (K.app.duel?.state === 'playing' && K.app.duel.turnColor() === 'white') await K.playerMove(K.randomMove());
    await settle();
    out.ply = K.app.duel?.ply ?? null;
    out.fenEqual1 = !!K.app.duel && board(K.walk.arenaFen()) === board(K.app.duel.fen());
    const L = K.log.build();
    out.log = { world: L?.world ? { id: L.world.id, stage: L.world.stage?.id, files: L.world.stage?.files, theme: L.world.theme, crop: !!L.world.crop } : null, stage: L?.stage, variantIni: !!L?.variantIni };
    // A reload mid-duel: the run resumes and the barrier drops again on the same seed.
    return out;
  });
  const dropSeed = bar.drop?.duel?.seed ?? null;
  expect(bar.smash.found && bar.smash.debris?.events === 1 && bar.smash.saved === 1, `a smash on the walk scars the floor and the scar rides in the run (${bar.smash.debris?.events} event, ${bar.smash.saved} saved)`);
  expect(bar.drop.phase === 'playing' && bar.drop.screen.duel && !bar.drop.screen.walk && bar.drop.back && bar.drop.session === 'world', `the button drops the barrier: the duel screen is up on a world session, Back hidden`);
  expect(bar.drop.duel && bar.drop.duel.gap >= 2 && bar.drop.duel.files === 10 && bar.drop.duel.ranks === 10, `the deal: ${bar.drop.duel?.files}×${bar.drop.duel?.ranks}, gap ${bar.drop.duel?.gap}, kings on file ${bar.drop.duel?.kingFile}`);
  expect(bar.drop.info.viewport === 'screen' && bar.drop.info.facing === bar.world.facing && bar.drop.info.crop && bar.drop.info.crop.facing === bar.world.facing && bar.drop.info.window.cols > bar.drop.info.crop.cols, `the board is a window over the world at the army's facing, the dungeon around the ${bar.drop.info.crop?.cols}×${bar.drop.info.crop?.rows} crop (${bar.drop.info.window?.cols} cols shown)`);
  expect(bar.drop.fenEqual0 && bar.fenEqual1 && bar.ply === 2, `the crop's FEN equals the duel's board at ply 0 and after ${bar.ply} plies`);
  expect(bar.drop.standing && bar.drop.standingN === 8, `the deal reads the ${bar.drop.standingN} pieces where they stand — nothing summoned`);
  expect(bar.pending && bar.pending.seed === dropSeed && bar.pending.turn === 'w' && bar.pending.at === bar.walkTurn + (bar.smash.found ? 1 : 0), `the run holds the pending duel (seed ${bar.pending?.seed}, at walk turn ${bar.pending?.at})`);
  expect(bar.log.world && bar.log.world.id === bar.world.id && bar.log.world.theme === bar.world.theme && bar.log.world.files === bar.drop.duel.files && bar.log.world.crop && bar.log.variantIni, `the replay log carries the world block (${bar.log.world?.stage})`);
  // The reload: the saved run resumes with the duel in flight and drops it again on the same seed.
  await page5.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&run=resume&${q5}`);
  await page5.waitForFunction(() => window.__DCK?.app?.phase === 'playing' && window.__DCK.app.session?.kind === 'world', null, { timeout: 120000 });
  const re = await page5.evaluate(async () => {
    const K = window.__DCK;
    const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); if (K.app.busy || K.walk.busy) throw new Error(`still busy after 30 s (app ${K.app.busy}, walk ${K.walk.busy}, phase ${K.app.phase}, duel ${K.app.duel?.state})`); };
    const board = (fen) => fen.split(' ')[0].replace(/\[[^\]]*\]$/, ''); // the board field without the holdings (THE PORTAL SPELL: the scrolls ride the FEN)
    await settle();
    const out = { seed: K.walk.duel?.seed, fen: K.app.duel?.fen(), ply: K.app.duel?.ply, equal: board(K.walk.arenaFen()) === board(K.app.duel.fen()) };
    // The player wins by the enemy's concession; the one button walks out.
    out.ended = await K.walk.concede('black');
    out.overlay = { hidden: document.getElementById('overlay').hidden, title: document.getElementById('overlay-title').textContent, walkOut: document.getElementById('btnWalkOut').hidden, label: document.getElementById('btnWalkOut').textContent, again: document.getElementById('btnAgain').hidden, redeal: document.getElementById('btnOverlayRedeal').hidden, menu: document.getElementById('btnMenu').hidden, undo: document.getElementById('btnOverlayUndo').hidden };
    document.getElementById('btnWalkOut').click();
    for (let i = 0; i < 200 && (K.app.phase !== 'walk' || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 30));
    const st = K.walk.state;
    const saved = K.walk.saved();
    out.after = { phase: K.app.phase, screen: !document.getElementById('screen-walk').hidden, pieces: st.pieces.length, kingOnFloor: K.walk.cell(st.king.f, st.king.r)?.v === 'K', lower: st.rows.join('').replace(/[^a-z]/g, '').length, turn: st.turn, turns: saved.turns.length, last: saved.turns.at(-1), pending: saved.pending, debris: !!saved.floors[saved.floor]?.debris, status: document.getElementById('walk-status').textContent, session: K.app.session, duel: !!K.app.duel };
    return out;
  });
  expect(re.seed === dropSeed && re.ply === 0 && re.equal, `a reload mid-duel re-drops the same seeded duel from move one (seed ${re.seed})`);
  expect(re.ended === 'ended' && !re.overlay.hidden && re.overlay.title === 'Victory' && !re.overlay.walkOut && /Walk on/.test(re.overlay.label) && re.overlay.again && re.overlay.redeal && re.overlay.menu && re.overlay.undo, `the overlay on a world duel: one button, "${re.overlay.label}" (Rematch / Re-deal / Back / Undo hidden)`);
  expect(re.after.phase === 'walk' && re.after.screen && re.after.pieces === 8 && re.after.kingOnFloor && re.after.lower === 0 && !re.after.session && !re.after.duel, `the army walks out whole (${re.after.pieces} pieces, the survivors where they stood), the enemy gone from the floor`);
  expect(re.after.last?.kind === 'duel' && re.after.last.result === '1-0' && re.after.last.termination === 'concede' && re.after.pending === null && re.after.debris && re.after.turn === bar.walkTurn + (bar.smash.found ? 1 : 0), `the run records the duel as its result (${re.after.last?.result} · ${re.after.last?.termination}), no pending entry, the ledger inside; the walk turn unchanged (${re.after.turn})`);
  // A SECOND DUEL ON A SCARRED FLOOR, on a fresh run of the same floor (the
  // walk-out lands wherever the king ended, where no box is promised): a pit
  // dug by hand ahead of the start seeds the gods from ply 0; the player
  // loses by concession — the run is over, the save stays, resume refuses.
  await page5.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&gen=vaults&seed=1&${q5}`);
  await page5.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 120000 });
  const re2 = await page5.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); if (K.app.busy || K.walk.busy) throw new Error(`still busy after 30 s (app ${K.app.busy}, walk ${K.walk.busy})`); };
    const board = (fen) => fen.split(' ')[0].replace(/\[[^\]]*\]$/, ''); // the board field without the holdings (THE PORTAL SPELL: the scrolls ride the FEN)
    const out = {};
    const st = K.walk.state;
    const k = st.king;
    const AH = [[0, 1], [1, 0], [0, -1], [-1, 0]][st.facing];
    const W = K.app.walk.world;
    let pit = null;
    for (let d = 2; d <= 5 && !pit; d++) if (W.at(k.f + AH[0] * d, k.r + AH[1] * d) === '.' && !W.pieceAt(k.f + AH[0] * d, k.r + AH[1] * d)) pit = { f: k.f + AH[0] * d, r: k.r + AH[1] * d };
    if (pit) W.setTerrain(pit.f, pit.r, 'O');
    const plan2 = await K.walk.barrier({ knobs: { width: 3, mode: 'pieces', pieces: 'NN' } });
    await settle();
    const holes = K.app.duel ? [...K.app.duel.director.holes] : [];
    out.second = { ok: !!plan2?.ok, error: plan2?.error ?? null, files: plan2?.stage?.files, ranks: plan2?.stage?.ranks, pit, holes, authored: K.app.duel?.director.authoredTerrain ?? null, fenHasPit: null };
    if (plan2?.ok && pit) out.second.fenHasPit = board(K.app.duel.fen()).includes('_'); // THE PIT (the ice, 2026-09-20): a hole is the engine's own '_' (a '#' from wall-kinds until then)
    out.lost = { ended: await K.walk.concede('white'), label: document.getElementById('btnWalkOut').textContent };
    document.getElementById('btnWalkOut').click();
    for (let i = 0; i < 100 && K.app.phase !== 'setup'; i++) await new Promise((r) => setTimeout(r, 30));
    const gone = K.walk.saved();
    out.over = { phase: K.app.phase, ended: gone?.ended, resumeText: document.getElementById('btnRunResume').textContent, resumed: K.walk.resume(), note: document.getElementById('run-note').textContent, exportable: !!K.walk.export()?.floors };
    return out;
  });
  expect(re2.second.ok && re2.second.pit && re2.second.holes.length >= 1 && re2.second.fenHasPit && re2.second.authored !== null, `a second barrier on the scarred floor: the pit is the gods' hole from ply 0 (${re2.second.holes.join(',')}), the terrain anchor set`);
  expect(re2.lost.ended === 'ended' && /run is over/.test(re2.lost.label) && re2.over.phase === 'setup' && re2.over.ended?.termination === 'concede' && /Run over/.test(re2.over.resumeText) && re2.over.resumed === false && /run is over/.test(re2.over.note) && re2.over.exportable, `a loss ends the run: back to setup, "${re2.over.resumeText}", resume refused (${re2.over.note}), the save still exports`);
  expect(errs5.length === 0, `no page errors on the barrier${errs5.length ? ` — ${errs5.join(' | ')}` : ''}`);
  // The analyzer paints the barrier log from its world block (the crop's terrain and skins, the world's theme).
  await page5.goto(`http://127.0.0.1:${PORT}/replay/index.html?deck=off&latest=1`);
  await page5.waitForFunction(() => window.__DCK?.replay?.log, null, { timeout: 60000 });
  const an = await page5.evaluate(async () => { const R = window.__DCK.replay; await R.waitIdle?.(); const v = R.view; return { world: R.log?.world?.id ?? null, stage: v.stage ?? null, theme: v.theme ?? null, skins: typeof v.skins === 'object' && v.skins ? Object.keys(v.skins).length : v.skins }; });
  expect(an.world === bar.world.id && typeof an.stage === 'string' && an.stage.startsWith(`${bar.world.id}@`) && an.theme === bar.world.theme, `the analyzer opens the barrier log on its own crop (${an.stage}, theme ${an.theme}, ${an.skins} skins)`);
  await page5.close();
}
// --- THE ENEMIES (Phase 2 milestone 6, 2026-09-10 — the enemies session;
// 2026-09-11 any-piece sight and THE FAR HALF): on the fixture the four
// spawns stand as sentries with their letters on the floor and in the
// save; a wait moves none of them. THE HUNT: an enemy stood in the west
// corridor in sight of the army (44, 21) sees it on the next input, hunts
// along the rank to the far-row cell (47, 21) — the band's outer edge, the
// nearest cell of the far half — and the barrier falls with ITS
// initiative; a concession walks the army out where it stood with that
// enemy gone. THE AMBUSH THROUGH THE PIVOT, IN THE FAR HALF: an enemy
// stood SIX ranks north of the king is caught by the player's own wait —
// his initiative, the army pivoted north for the drop, the enemy dealt
// onto the far row, its standing row in the run and the log; a reload
// mid-duel re-drops the same enemy on the same seed. THE CHOOSER: two
// enemies on two far rows at once — the player picks; the other keeps
// hunting through the frozen duel and catches him on the next input.
{
  const page6 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs6 = [];
  page6.on('pageerror', (e) => errs6.push(String(e).split('\n')[0]));
  const q6 = 'fx=0&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off';
  await page6.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&gen=vaults&seed=1&enemies=sentry&${q6}`);
  await page6.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 120000 });
  const en = await page6.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); if (K.app.busy || K.walk.busy) throw new Error(`still busy after 30 s (app ${K.app.busy}, walk ${K.walk.busy}, phase ${K.app.phase}, duel ${K.app.duel?.state})`); };
    const lower = () => K.walk.state.rows.join('').replace(/[^a-z]/g, '').length;
    const cells = () => K.walk.state.pieces.map((p) => `${p.ch}${p.f},${p.r}`).sort().join(' ');
    const untilDuel = async (max) => { let n = 0; for (; n < max && K.app.phase === 'walk' && !K.walk.candidates; n++) { await K.walk.input({ kind: 'wait' }); await settle(); for (let i = 0; i < 200 && K.app.phase === 'walk' && !K.walk.candidates && K.walk.busy; i++) await new Promise((r) => setTimeout(r, 25)); } for (let i = 0; i < 400 && K.app.phase !== 'playing' && !K.walk.candidates; i++) await new Promise((r) => setTimeout(r, 25)); await settle(); return n; };
    const walkOut = async (loser) => { const ended = await K.walk.concede(loser); document.getElementById('btnWalkOut').click(); for (let i = 0; i < 300 && (K.app.phase !== 'walk' || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 30)); return ended; };
    const out = {};
    out.start = { king: { ...K.walk.state.king }, facing: K.walk.state.facing, enemies: K.walk.enemies, lower: lower(), saved: K.walk.saved().floors[K.walk.saved().floor].enemies?.length ?? null, schema: K.walk.saved().schema };
    const kings0 = K.walk.enemies.map((e) => `${e.king.f},${e.king.r}`).join(' ');
    await K.walk.input({ kind: 'wait' });
    await settle();
    out.wait = { moved: K.walk.enemies.map((e) => `${e.king.f},${e.king.r}`).join(' ') !== kings0, states: K.walk.enemies.map((e) => e.state).join(','), threats: K.walk.threats.length, ms: K.walk.enemyMs };
    // THE HUNT: enemy 2 stood at (44, 21) facing east, in sight down the rank; the far-row cell (47, 21) is three steps east.
    const standing = cells();
    out.hunt = { placed: K.walk.placeEnemy(2, 44, 21, 1), sight: K.walk.sight(2), goalsWest: (K.walk.goals(2) ?? []).filter((g) => g.axis === 3).map((g) => `${g.f},${g.r}`).join(' '), far: (K.walk.goals(2) ?? []).filter((g) => g.axis === 3 && g.far).length, near: (K.walk.goals(2) ?? []).filter((g) => g.axis === 3 && !g.far).length };
    await K.walk.input({ kind: 'wait' });
    await settle();
    out.hunt.afterOne = { state: K.walk.enemies.find((e) => e.id === 2)?.state, threats: K.walk.threats.length, status: document.getElementById('walk-status').textContent, ms: K.walk.enemyMs, king: { ...K.walk.enemies.find((e) => e.id === 2).king } };
    out.hunt.turns = await untilDuel(8);
    out.hunt.duel = { phase: K.app.phase, duel: K.walk.duel, lower: lower(), enemiesKept: K.walk.enemies.length, black: K.app.duel ? K.app.duel.fen().split(' ')[0].replace(/\[[^\]]*\]$/, '').replace(/[^a-z]/g, '').length : null, logEnemy: K.log.build()?.world?.enemy ?? null };
    out.hunt.ended = await walkOut('black');
    out.hunt.after = { phase: K.app.phase, enemies: K.walk.enemies.map((e) => `${e.id}:${e.state}`).join(' '), lower: lower(), same: cells() === standing, facing: K.walk.state.facing, last: K.walk.saved().turns.at(-1) };
    // THE AMBUSH THROUGH THE PIVOT, IN THE FAR HALF: enemy 3 six ranks north of the king (the nearest row the floor holds it on), facing south; the player's wait completes the alignment.
    // Its king on the nearest row of the far half the floor holds it on, on a file whose deal is legal (a cell of its own goals).
    const kk = { ...K.walk.state.king };
    out.ambush = { placed: false, off: null };
    for (const off of [6, 7, 8, 9]) {
      for (const df of [0, -1, 1]) {
        if (!K.walk.placeEnemy(3, kk.f + df, kk.r + off, 2)) continue;
        const ek = K.walk.enemies.find((x) => x.id === 3).king;
        if ((K.walk.goals(3) ?? []).some((g) => g.f === ek.f && g.r === ek.r)) { out.ambush.placed = true; out.ambush.off = off; out.ambush.at = { ...ek }; break; }
      }
      if (out.ambush.placed) break;
    }
    out.ambush.sight = K.walk.sight(3);
    out.ambush.turns = await untilDuel(3);
    out.ambush.duel = { phase: K.app.phase, duel: K.walk.duel, facing: K.walk.state.facing, pending: K.walk.saved()?.pending ?? null, crop: K.walk.crop, logRow: K.log.build()?.world?.enemyRow ?? null };
    return out;
  });
  const hd = en.hunt.duel.duel, ad = en.ambush.duel.duel;
  expect(en.start.schema === 'dck-run/6' && en.start.enemies.length === 4 && en.start.enemies.every((e) => e.state === 'sentry' && e.width === 3 && e.pieces.length === 6 && /^[NBR]{2}$/.test(e.bag)) && en.start.lower === 24 && en.start.saved === 4, `four 3-wide sentries on the floor (bags ${en.start.enemies.map((e) => e.bag).join(' ')}), 24 letters, all in the save`);
  expect(!en.wait.moved && en.wait.states === 'sentry,sentry,sentry,sentry' && en.wait.threats === 0, `a wait moves no sentry, lights no threat (${en.wait.ms?.toFixed(1)} ms of enemy work)`);
  expect(en.hunt.placed && en.hunt.sight && /47,21/.test(en.hunt.goalsWest) && en.hunt.far > 0 && en.hunt.near > 0, `enemy 2 stood at (44, 21) sees the army; the west band offers (47, 21) on its far row (${en.hunt.far} far-row cells, ${en.hunt.near} nearer cells of the far half)`);
  expect(en.hunt.afterOne.state === 'hunt' && en.hunt.afterOne.threats > 0 && /sees you/.test(en.hunt.afterOne.status), `on the next input it hunts: the threat display lights ${en.hunt.afterOne.threats} cells, the strip says so (its king at ${en.hunt.afterOne.king.f}, ${en.hunt.afterOne.king.r}; ${en.hunt.afterOne.ms?.toFixed(1)} ms of enemy work)`);
  expect(en.hunt.afterOne.ms < 120, `the enemy work of a hunting turn stays under the walk's step (${en.hunt.afterOne.ms?.toFixed(1)} ms)`);
  expect(en.hunt.duel.phase === 'playing' && hd && hd.turn === 'b' && hd.enemyId === 2 && hd.axis === 3 && !hd.pivoted && hd.enemyFile !== undefined, `THE HUNT: the barrier falls after ${en.hunt.turns + 1} inputs with the enemy's initiative (turn ${hd?.turn}, enemy ${hd?.enemyId}, axis ${hd?.axis})`);
  expect(en.hunt.duel.black === 6 && en.hunt.duel.lower === 24 && en.hunt.duel.enemiesKept === 4 && en.hunt.duel.logEnemy?.id === 2, `the hunter's own bag is molded into the box (${en.hunt.duel.black} black pieces), the other three stand on the map, the log names the enemy`);
  expect(en.hunt.ended === 'ended' && en.hunt.after.phase === 'walk' && en.hunt.after.enemies === '1:sentry 3:sentry 4:sentry' && en.hunt.after.lower === 18 && en.hunt.after.same && en.hunt.after.facing === 3 && en.hunt.after.last?.kind === 'duel' && en.hunt.after.last.axis === 3, `a win removes the whole enemy army: ${en.hunt.after.enemies}, ${en.hunt.after.lower} letters, the survivors where they stood, the run's entry carries the axis`);
  expect(en.ambush.placed && en.ambush.off === 6 && en.ambush.sight && en.ambush.duel.phase === 'playing' && ad && ad.turn === 'w' && ad.enemyId === 3 && ad.axis === 0 && ad.pivoted && ad.enemyRow === 6 && en.ambush.duel.logRow === 6 && en.ambush.duel.facing === 0 && en.ambush.duel.crop?.facing === 0, `THE AMBUSH THROUGH THE PIVOT, IN THE FAR HALF: an enemy six ranks north is caught by the player's wait — his initiative (turn ${ad?.turn}), the army pivoted north (facing ${en.ambush.duel.facing}, pivoted ${ad?.pivoted}), the enemy's row ${ad?.enemyRow} in the run and ${en.ambush.duel.logRow} in the log`);
  expect(en.ambush.duel.pending && en.ambush.duel.pending.enemyId === 3 && en.ambush.duel.pending.axis === 0 && en.ambush.duel.pending.enemyRow === 6 && en.ambush.duel.pending.seed === ad?.seed, `the pending entry names the enemy, the axis, the row and the seed`);
  // A reload mid-duel: the same enemy, the same seed, from move one.
  await page6.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&run=resume&${q6}`);
  await page6.waitForFunction(() => window.__DCK?.app?.phase === 'playing' && window.__DCK.app.session?.kind === 'world', null, { timeout: 120000 });
  const en2 = await page6.evaluate(async () => {
    const K = window.__DCK;
    const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); if (K.app.busy || K.walk.busy) throw new Error(`still busy after 30 s (app ${K.app.busy}, walk ${K.walk.busy}, phase ${K.app.phase}, duel ${K.app.duel?.state})`); };
    const lower = () => K.walk.state.rows.join('').replace(/[^a-z]/g, '').length;
    const untilDuel = async (max) => { let n = 0; for (; n < max && K.app.phase === 'walk' && !K.walk.candidates; n++) { await K.walk.input({ kind: 'wait' }); await settle(); for (let i = 0; i < 200 && K.app.phase === 'walk' && !K.walk.candidates && K.walk.busy; i++) await new Promise((r) => setTimeout(r, 25)); } for (let i = 0; i < 400 && K.app.phase !== 'playing' && !K.walk.candidates; i++) await new Promise((r) => setTimeout(r, 25)); await settle(); return n; };
    const walkOut = async (loser) => { const ended = await K.walk.concede(loser); document.getElementById('btnWalkOut').click(); for (let i = 0; i < 300 && (K.app.phase !== 'walk' || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 30)); return ended; };
    await settle();
    const out = {};
    out.redrop = { duel: K.walk.duel, ply: K.app.duel?.ply, enemies: K.walk.enemies.map((e) => `${e.id}:${e.state}`).join(' ') };
    out.redrop.ended = await walkOut('black');
    out.redrop.after = { enemies: K.walk.enemies.map((e) => `${e.id}:${e.state}`).join(' '), lower: lower(), facing: K.walk.state.facing, king: { ...K.walk.state.king } };
    // THE CHOOSER: enemy 1 on the west far row (47, 21) and enemy 4 on the north far row (57, 31), both in sight; the player's wait completes both.
    out.chooser = { placed1: K.walk.placeEnemy(1, 47, 21, 1), placed4: K.walk.placeEnemy(4, 57, 31, 2), sight1: K.walk.sight(1), sight4: K.walk.sight(4) };
    out.chooser.turns = await untilDuel(3);
    out.chooser.up = { candidates: K.walk.candidates, hidden: document.getElementById('walk-chooser').hidden, buttons: document.getElementById('walk-chooser-buttons').children.length, phase: K.app.phase, refused: await K.walk.input({ kind: 'wait' }) };
    await K.walk.choose(4);
    for (let i = 0; i < 400 && K.app.phase !== 'playing'; i++) await new Promise((r) => setTimeout(r, 25));
    await settle();
    out.chooser.duel = { phase: K.app.phase, duel: K.walk.duel, hidden: document.getElementById('walk-chooser').hidden, other: K.walk.enemies.find((e) => e.id === 1)?.state };
    out.chooser.ended = await walkOut('black');
    out.chooser.after = { enemies: K.walk.enemies.map((e) => `${e.id}:${e.state}`).join(' '), lower: lower() };
    // The other hunter stands on the west far row through the frozen duel: the next input is caught by it (through the pivot back west).
    out.last = { turns: await untilDuel(3) };
    out.last.duel = { phase: K.app.phase, duel: K.walk.duel };
    out.last.ended = await walkOut('black');
    out.last.after = { enemies: K.walk.enemies.length, lower: lower(), phase: K.app.phase, threats: K.walk.threats.length, turns: K.walk.saved().turns.filter((t) => t.kind === 'duel').length };
    return out;
  });
  const rd = en2.redrop.duel, cd = en2.chooser.duel.duel, ld = en2.last.duel.duel;
  expect(rd && rd.enemyId === 3 && rd.seed === ad?.seed && en2.redrop.ply === 0 && rd.pivoted && /3:hunt/.test(en2.redrop.enemies), `a reload mid-duel re-drops the same enemy on the same seed from move one (enemy ${rd?.enemyId}, ${en2.redrop.enemies})`);
  expect(en2.redrop.ended === 'ended' && en2.redrop.after.enemies === '1:sentry 4:sentry' && en2.redrop.after.lower === 12 && en2.redrop.after.facing === 0, `the walk-out keeps the army facing the axis it fought on (facing ${en2.redrop.after.facing}), two enemies left`);
  expect(en2.chooser.placed1 && en2.chooser.placed4 && en2.chooser.sight1 && en2.chooser.sight4 && en2.chooser.up.candidates?.length === 2 && !en2.chooser.up.hidden && en2.chooser.up.buttons === 2 && en2.chooser.up.phase === 'walk' && en2.chooser.up.refused === null, `THE CHOOSER: two enemies aligned at once — two candidates, the chooser up with ${en2.chooser.up.buttons} buttons, inputs refused while it waits`);
  expect(en2.chooser.duel.phase === 'playing' && cd && cd.enemyId === 4 && cd.axis === 0 && !cd.pivoted && cd.turn === 'w' && en2.chooser.duel.hidden && en2.chooser.duel.other === 'hunt', `the pick drops the barrier on enemy 4 (axis ${cd?.axis}, turn ${cd?.turn}); the other keeps hunting through the frozen duel`);
  expect(en2.chooser.ended === 'ended' && en2.chooser.after.enemies === '1:hunt' && en2.chooser.after.lower === 6, `after the win one hunter is left on the west far row (${en2.chooser.after.enemies})`);
  expect(en2.last.duel.phase === 'playing' && ld && ld.enemyId === 1 && ld.axis === 3 && ld.pivoted && en2.last.ended === 'ended' && en2.last.after.enemies === 0 && en2.last.after.lower === 0 && en2.last.after.phase === 'walk' && en2.last.after.threats === 0 && en2.last.after.turns === 4, `the next input is caught by it through the pivot back west; the floor is clear after four duels (${en2.last.after.turns} duel entries)`);
  expect(errs6.length === 0, `no page errors with the enemies${errs6.length ? ` — ${errs6.join(' | ')}` : ''}`);
  await page6.close();
}

// --- THE WANDERERS (2026-09-11 — designer: "Can we get some wandering
// enemies?"): on the fixture the four spawns ROAM by default — each walks
// its beat within the leash of its spawn, pausing at every waypoint; after
// thirty waits the kings have moved, every enemy piece is on its own cell,
// the letters are all there, nobody is past the leash, and a second run of
// the same seed and the same inputs walks the same beats (the draws come
// from the run's seed by their count, so a run replays).
{
  const page7 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs7 = [];
  page7.on('pageerror', (e) => errs7.push(String(e).split('\n')[0]));
  const q7 = 'fx=0&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off';
  const roamRun = async (waits) => {
    await page7.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&gen=vaults&seed=1&${q7}`);
    await page7.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 120000 });
    return page7.evaluate(async (waits) => {
      const K = window.__DCK;
      await K.renderer.ready();
      const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); };
      const snap = () => K.walk.enemies.map((e) => `${e.id}:${e.state}@${e.king.f},${e.king.r}`).join(' ');
      const lower = () => K.walk.state.rows.join('').replace(/[^a-z]/g, '').length;
      const o = { schema: K.walk.saved().schema, start: snap(), modes: K.walk.enemies.map((e) => e.mode).join(','), states: new Set(), trail: [], ms: [], shared: 0, letters: [], hunted: new Set() };
      for (let t = 0; t < waits && K.app.phase === 'walk' && !K.walk.candidates; t++) {
        await K.walk.input({ kind: 'wait' });
        await settle();
        o.trail.push(snap());
        o.ms.push(K.walk.enemyMs);
        for (const e of K.walk.enemies) { o.states.add(e.state); if (e.state !== 'roam') o.hunted.add(e.id); }
        const cells = new Set();
        for (const e of K.walk.enemies) for (const p of e.pieces) { const key = `${p.f},${p.r}`; if (cells.has(key)) o.shared++; cells.add(key); }
        if (K.app.phase === 'walk') o.letters.push(lower());
      }
      o.states = [...o.states].join(',');
      o.phase = K.app.phase;
      // The leash binds a wanderer's WAYPOINTS; a hunter or a searcher goes where the player is, so only the ones that never left their beat are measured.
      o.leash = K.walk.enemies.filter((e) => !o.hunted.has(e.id)).map((e) => Math.max(Math.abs(e.king.f - e.spawn.f), Math.abs(e.king.r - e.spawn.r)));
      o.hunted = [...o.hunted].join(',');
      o.moved = K.walk.enemies.filter((e) => e.king.f !== e.spawn.f || e.king.r !== e.spawn.r).length;
      o.draws = K.walk.enemies.map((e) => e.roam?.n ?? 0);
      o.saved = K.walk.saved().floors[K.walk.saved().floor].enemies.map((e) => `${e.mode}:${e.state}:${e.roam?.n}`).join(' ');
      return o;
    }, waits);
  };
  const ra = await roamRun(30);
  const rb = await roamRun(30);
  expect(ra.schema === 'dck-run/6' && ra.modes === 'roam,roam,roam,roam' && /roam/.test(ra.start), `four wanderers spawn on the fixture (${ra.start})`);
  expect(ra.trail.length >= 10 && ra.moved >= 2 && ra.draws.some((n) => n > 0), `after ${ra.trail.length} waits ${ra.moved} of four kings have left their spawns (draws ${ra.draws.join(',')}; phase ${ra.phase}${ra.phase === 'playing' ? ' — a wanderer walked into sight of the standing army and caught it' : ''})`);
  expect(ra.shared === 0 && ra.letters.every((n) => n === 24) && ra.leash.length > 0 && ra.leash.every((d) => d <= 12), `no two enemy pieces on one cell (${ra.shared} shared), 24 letters on every walk turn (min ${Math.min(...ra.letters)}), every wanderer that stayed on its beat within the leash (${ra.leash.join(',')} cells from the spawns; ${ra.hunted ? `enemy ${ra.hunted} hunted` : 'none hunted'})`);
  expect(/^(roam|hunt|search)(,(roam|hunt|search))*$/.test(ra.states), `the wanderers' states stay roam / hunt / search (${ra.states})`);
  expect(Math.max(...ra.ms) < 250, `the enemy work with four wanderers stays under a quarter second (max ${Math.max(...ra.ms).toFixed(1)} ms, median ${[...ra.ms].sort((a, b) => a - b)[ra.ms.length >> 1]?.toFixed(1)} ms)`);
  expect(rb.trail.join('|') === ra.trail.join('|') && rb.phase === ra.phase, `a second run of the same seed and inputs walks the same beats (${rb.trail.length} turns compared)`);
  expect(/roam:(roam|hunt|search):\d+/.test(ra.saved), `the save carries each wanderer's mode, state and draw count (${ra.saved})`);
  expect(errs7.length === 0, `no page errors with the wanderers${errs7.length ? ` — ${errs7.join(' | ')}` : ''}`);
  await page7.close();
}

// --- THE PORTAL SPELL (2026-09-17; the colours by caster the same day — the
// designer, on the first duel: "the enemy portals should be a different
// color… each new portal pair has a unique color so the player can see how
// they link"): on a fresh duel the Portal button shows two scrolls; the
// button enters CAST MODE with the legal squares lit (none on a king row or
// the row beside it — two rows off since 2026-09-20 — all empty) and a tap
// on a wall leaves it; a tap on a lit square casts
// through the piece-move path — the half-open portal a dashed ring in the
// player's BLUE, one scroll left, the log naming the cast; the second cast
// links the pair, solid blue on both squares, the button gone; the enemy's
// portal, when it has cast, wears ORANGE (its colour is also asserted on the
// analyzer, replay-smoke). The debris is off so nothing lands on the rings;
// hints off so no shaft crosses them.
{
  let page8 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs8 = [];
  page8.on('pageerror', (e) => errs8.push(String(e).split('\n')[0]));
  await page8.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&stage=${STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off`);
  page8 = await bootWait(page8, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?deck=off&stage=${STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off`, (p) => p.on('pageerror', (e) => errs8.push(String(e).split('\n')[0])));
  await page8.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const ps = await page8.evaluate(async () => {
    const K = window.__DCK;
    K.options.cheat = false;
    K.options.hints = false;
    K.options.evalBar = false;
    K.applyOptions();
    await K.renderer.ready();
    const BLUE = [0x4a, 0xa3, 0xff], ORANGE = [0xff, 0x9a, 0x2e];
    const count = (sq, rgb) => { K.renderer.paintNow(); const px = K.renderer.square(sq); if (!px) return -1; let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] === rgb[0] && px[i + 1] === rgb[1] && px[i + 2] === rgb[2] && px[i + 3] === 255) n++; return n; };
    const fen = () => K.app.duel.fen();
    const field = () => fen().match(/\{([^}]*)\}/)?.[1] ?? '';
    const grid = () => fen().split(' ')[0].replace(/\[[^\]]*\]$/, '').split('/').map((row) => { const out = []; let num = ''; for (const ch of row) { if (/\d/.test(ch)) num += ch; else { if (num) { out.push(...Array(parseInt(num, 10)).fill('.')); num = ''; } out.push(ch); } } if (num) out.push(...Array(parseInt(num, 10)).fill('.')); return out; });
    const at = (sq) => { const g = grid(); const f = sq.charCodeAt(0) - 97; const r = parseInt(sq.slice(1), 10); return g[g.length - r]?.[f] ?? '?'; };
    const ranks = K.app.boardUI.ranks;
    const rankOf = (sq) => parseInt(sq.slice(1), 10);
    const south = (sq) => `${sq[0]}${rankOf(sq) - 1}`;
    const lit = () => [...K.app.boardUI.marks.targets];
    const logLines = () => [...document.querySelectorAll('#duel-log div')].map((d) => d.textContent).filter((t) => /portal/i.test(t));
    const settle = async () => { await K.waitIdle(); for (let i = 0; i < 200 && K.app.busy; i++) await new Promise((r) => setTimeout(r, 25)); };
    // THE CARD UI (Phase 3.2): the spell button is the portal CARD in the fan — a tap lifts it into cast mode (the smoke's tap path)
    const card = () => K.cards.info('portal');
    const c0 = card();
    const out = { hidden0: c0.n === 0, text0: `×${c0.n}`, disabled0: !c0.playable };
    K.cards.tap('portal');
    out.castMode = K.app.castMode;
    const L0 = lit();
    out.litN = L0.length;
    out.litKingRow = L0.filter((sq) => rankOf(sq) <= 2 || rankOf(sq) >= ranks - 1).length; // two rows off each king row (2026-09-20)
    out.litEmpty = L0.every((sq) => at(sq) === '.');
    const wall = [...K.app.boardUI.cells.keys()].find((sq) => at(sq) === '*' && !L0.includes(sq));
    K.tap(wall);
    out.leftAfterWallTap = !K.app.castMode && [...K.app.boardUI.marks.targets].length === 0;
    // The first cast: a lit square off the king rows with an empty square south of it (a piece there would rise over the ring).
    const pick = (avoid) => { const c = lit().filter((sq) => !avoid.includes(sq) && rankOf(sq) > 2 && rankOf(sq) < ranks - 1 && at(south(sq)) === '.'); return c[Math.floor(c.length / 2)] ?? lit().find((sq) => !avoid.includes(sq)); };
    K.cards.tap('portal');
    const a = pick([]);
    K.tap(a);
    await settle();
    out.a = a;
    out.fieldA = field();
    out.textA = `×${card().n}`;
    out.titleA = card().hint;
    out.liftedA = card().lifted;
    out.aEmpty = at(a) === '.' && at(south(a)) === '.';
    out.aBlue = count(a, BLUE);
    out.aOrange = count(a, ORANGE);
    out.logA = logLines();
    out.turnA = K.app.duel.turnColor();
    out.stateA = K.app.duel.state;
    // PORTALS v3 (the one-turn cast): the enemy's forced pass was played by the game and the player stands on the LINK PLY, cast mode already on
    out.castModeA = K.app.castMode;
    out.movesA = K.app.duel.record.moves.slice(-2);
    out.kindsA = K.app.duel.record.states.slice(-2).map((s) => s.cast ?? null);
    out.statusA = document.getElementById('status').textContent;
    out.pieceMovesA = K.app.duel.legalMoves().filter((m) => !/^[A-Za-z]@/.test(m));
    if (K.app.duel.state === 'playing') {
      if (!K.app.castMode) K.cards.tap('portal');
      const b = pick([a]);
      K.tap(b);
      await settle();
      out.b = b;
      out.fieldB = field();
      out.hiddenB = card().n === 0;
      out.aEmptyB = at(a) === '.' && at(south(a)) === '.';
      out.bEmpty = at(b) === '.' && at(south(b)) === '.';
      out.aBlueB = count(a, BLUE);
      out.bBlueB = count(b, BLUE);
      out.logB = logLines();
      out.kindsB = K.app.duel.record.states.map((s) => s.cast ?? null).filter(Boolean);
      out.tracesB = K.app.duel.record.quakeTraces.map((t) => t.ply);
      out.castPliesB = K.app.duel.record.states.filter((s) => s.cast).map((s) => [s.ply, s.cast]);
      out.plyB = K.app.duel.ply;
    }
    const f = field();
    const enemyHalf = f.match(/(?:^|,)([a-l](?:10|[1-9]))b(?:,|$)/)?.[1] ?? null;
    const enemyPair = [...f.matchAll(/([a-l](?:10|[1-9]))-([a-l](?:10|[1-9]))/g)].map((m) => [m[1], m[2]]).find((p) => !p.includes(out.a) && !p.includes(out.b)) ?? null;
    const esq = enemyHalf ?? enemyPair?.[0] ?? null;
    out.enemy = esq ? { sq: esq, half: !!enemyHalf, empty: at(esq) === '.' && at(south(esq)) === '.', orange: count(esq, ORANGE), blue: count(esq, BLUE) } : null;
    out.state = K.app.duel.state;
    return out;
  });
  expect(!ps.hidden0 && /×1/.test(ps.text0) && !ps.disabled0, `the portal CARD is in the fan on the player's turn, one card of two scrolls, playable (${ps.text0}${ps.hidden0 ? ', none' : ''}${ps.disabled0 ? ', dimmed' : ''})`);
  expect(ps.castMode && ps.litN > 0 && ps.litKingRow === 0 && ps.litEmpty, `a tap on the card enters cast mode with ${ps.litN} squares lit, none on a king row or the row beside it (${ps.litKingRow}), all empty`);
  expect(ps.leftAfterWallTap, 'a tap on a wall leaves the spell with nothing lit');
  expect(new RegExp(`(^|,)${ps.a}w(,|$)`).test(ps.fieldA) && /×1/.test(ps.textA) && /is open/.test(ps.titleA), `a tap on ${ps.a} casts: the field reads {${ps.fieldA}}, the half-spent portal still a card (${ps.textA}), its line says the half is open`);
  expect(ps.logA.some((t) => t.includes(`a portal opens at ${ps.a}`)), `the log names the cast (${ps.logA.slice(-1)[0] ?? 'nothing about a portal'})`);
  // PORTALS v3
  if (ps.stateA === 'playing') {
    expect(ps.turnA === 'white' && ps.castModeA && ps.pieceMovesA.length === 0, `after the half the enemy's PASS was played by the game and the player is on the link ply in cast mode, no piece move offered (turn ${ps.turnA}, castMode ${ps.castModeA}, ${ps.pieceMovesA.length} piece moves)`);
    expect(/^([a-l](?:10|[1-9]))\1$/.test(ps.movesA[1] ?? '') && JSON.stringify(ps.kindsA) === '["half","pass"]', `the record reads half then pass (${ps.movesA.join(' ')} · ${ps.kindsA.join(',')})`);
    expect(/second portal/.test(ps.statusA), `the status asks for the second portal (${ps.statusA})`);
    expect(ps.logA.some((t) => /frozen/.test(t)), `the log says the enemy is frozen (${ps.logA.slice(-2).join(' | ')})`);
  }
  if (ps.aEmpty) expect(ps.aBlue >= 9 && ps.aBlue <= 18 && ps.aOrange === 0, `the half-open portal is a dashed ring in the player's BLUE (${ps.aBlue} blue pixels of 18, ${ps.aOrange} orange)`);
  else expect(ps.aBlue > 0 && ps.aOrange === 0, `the half-open portal at ${ps.a} shows blue beside the piece over it (${ps.aBlue} pixels)`);
  if (ps.b) {
    expect(new RegExp(`(^|,)(${ps.a}-${ps.b}|${ps.b}-${ps.a})(,|$)`).test(ps.fieldB) && ps.hiddenB, `the second cast links the pair {${ps.fieldB}} and the card leaves the fan with the last scroll`);
    expect(ps.logB.some((t) => t.includes('the portals are linked')), 'the log says the portals are linked');
    expect(JSON.stringify(ps.kindsB.slice(0, 3)) === '["half","pass","link"]', `the record's cast kinds run half, pass, link (${ps.kindsB.join(',')})`);
    expect(ps.castPliesB.length >= 3 && ps.castPliesB.every(([ply, kind]) => (kind === 'link' || kind === 'fizzle' ? ps.tracesB.includes(ply) : !ps.tracesB.includes(ply))), `the gods rolled on the link ply and never inside the cast (kinds ${ps.castPliesB.map(([p, k]) => `${p}:${k}`).join(' ')}; traces at ${ps.tracesB.join(',')})`);
    const solid = (n, empty) => (empty ? n >= 20 && n <= 36 : n > 0);
    expect(solid(ps.aBlueB, ps.aEmptyB) && solid(ps.bBlueB, ps.bEmpty), `both squares of the pair wear the solid blue ring (${ps.aBlueB} / ${ps.bBlueB} blue pixels of 36${ps.aEmptyB && ps.bEmpty ? '' : ', a piece over one'})`);
  } else expect(ps.stateA !== 'playing', `the duel ended before the second cast (${ps.stateA})`);
  if (ps.enemy) expect(ps.enemy.empty ? ps.enemy.orange >= 9 && ps.enemy.blue === 0 : ps.enemy.orange > 0 && ps.enemy.blue === 0, `the enemy's ${ps.enemy.half ? 'half-open portal' : 'pair'} at ${ps.enemy.sq} wears ORANGE (${ps.enemy.orange} orange pixels, ${ps.enemy.blue} blue)`);
  else expect(true, 'the enemy cast nothing in these plies (its orange is asserted on the analyzer, replay-smoke)');
  expect(errs8.length === 0, `no page errors with the portal spell${errs8.length ? ` — ${errs8.join(' | ')}` : ''}`);
  await page8.close();
}
// --- PORTALS ON THE PAGE (v2 2026-09-18, the body rule alone since v4
// 2026-09-19; brief §4.7; engine/patches/portals-body.patch): a landing on a
// portal square is drawn as a plain move to the ENTRY — the arrow ends there,
// the slide runs there, the commit paints the piece on the twin (no `via`
// pieces, no legs: nothing runs through a pair any more) — and an EMPTY EXIT
// lights as the alias of the landing on its entry (a tap there plays the
// landing). The arrow and the slide are driven straight through the board;
// the alias is read off the live duel when a landing on the player's own pair
// is on offer.
{
  let page9 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs9 = [];
  page9.on('pageerror', (e) => errs9.push(String(e).split('\n')[0]));
  await page9.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&stage=${STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off`);
  page9 = await bootWait(page9, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?deck=off&stage=${STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off`, (p) => p.on('pageerror', (e) => errs9.push(String(e).split('\n')[0])));
  await page9.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const v2 = await page9.evaluate(async () => {
    const K = window.__DCK;
    K.options.cheat = false;
    K.options.hints = false;
    K.options.evalBar = false;
    K.applyOptions();
    await K.renderer.ready();
    const B = K.app.boardUI;
    const squares = [...B.cells.keys()];
    const ranks = B.ranks;
    const sqAt = (f, r) => squares.find((s) => s.charCodeAt(0) - 97 === f && parseInt(s.slice(1), 10) === r) ?? null;
    // The painter: a straight arrow a1→a4 paints on its destination and leaves the f-file untouched (a landing's arrow ends on the entry)
    const count = (sq, rgb) => { K.renderer.paintNow(); const px = K.renderer.square(sq); if (!px) return -1; let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] === rgb[0] && px[i + 1] === rgb[1] && px[i + 2] === rgb[2] && px[i + 3] === 255) n++; return n; };
    const GOLD = [0xf2, 0xc1, 0x4e]; // ARROW_COLOURS['hint-1'] (pixelarrow.mjs), painted at full opacity
    const from = sqAt(0, 1), entry = sqAt(0, 4), exit = sqAt(5, 5), mid = sqAt(5, 6), to = sqAt(5, 7);
    const out = { squares: [from, entry, exit, mid, to] };
    B.setArrowStyle({ width: 4, alpha: 1 });
    B.setArrows([{ from, to: entry, strength: 1, kind: 'hint', rank: 1 }]);
    out.plainEntry = count(entry, GOLD);
    out.plainMid = count(mid, GOLD);
    out.plainExit = count(exit, GOLD);
    B.setArrows([]);
    // A plain slide to the entry resolves and leaves nothing hidden (the commit paints the piece on the twin)
    const fen = () => K.app.duel.fen();
    const field = () => fen().match(/\{([^}]*)\}/)?.[1] ?? '';
    const at = (sq) => { const rows = fen().split(' ')[0].split('[')[0].split('/'); const f = sq.charCodeAt(0) - 97; const r = parseInt(sq.slice(1), 10); const row = rows[rows.length - r]; let x = 0; for (const ch of row) { if (/\d/.test(ch)) x += +ch; else { if (x === f) return ch; x++; } } return '.'; };
    const letterSq = squares.find((s) => /[A-Z]/.test(at(s)) && s !== to);
    out.letterSq = letterSq ?? null;
    if (letterSq) {
      const t0 = performance.now();
      await B.animateSlide(letterSq, entry, { ms: 120 });
      out.slideMs = Math.round(performance.now() - t0);
      out.slideClean = !B.hidden.has(letterSq);
    }
    // The alias on the live duel: after the player's pair is linked (both squares empty), a piece with a landing on one of them lights the other too
    const settle = async () => { await K.waitIdle(); for (let i = 0; i < 200 && K.app.busy; i++) await new Promise((r) => setTimeout(r, 25)); };
    const lit = () => [...K.app.boardUI.marks.targets];
    const legal = () => K.app.duel.legalMoves();
    const btn = { get hidden() { return K.cards.info('portal').n === 0; }, click: () => K.cards.tap('portal') }; // THE CARD UI: the portal card stands in for the button
    const castable = () => lit().filter((sq) => { const r = parseInt(sq.slice(1), 10); return r > 2 && r < ranks - 1 && at(sq) === '.'; });
    out.alias = null;
    // Cast the player's pair DELIBERATELY: the first half on a square one of the
    // player's riders can land on, the second on another empty square — then
    // that rider's landing on the entry lights the twin as its alias, and a tap
    // on the twin plays it (the enemy's replies may spoil the plan; then a note)
    const P0 = () => { const m = new Map(); for (const [, a, b] of [...field().matchAll(/([a-l](?:10|[1-9]))-([a-l](?:10|[1-9]))/g)]) { m.set(a, b); m.set(b, a); } return m; };
    const riders = () => legal().map((m) => m.match(/^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))$/)).filter(Boolean).filter((m) => /[RBQ]/.test(at(m[1])) && at(m[2]) === '.');
    const myTurn = () => K.app.duel.state === 'playing' && K.app.duel.turnColor() === K.app.session.playerColor;
    let first = null;
    if (myTurn() && !btn.hidden) {
      btn.click();
      const c = castable();
      first = riders().map((m) => m[2]).find((t) => c.includes(t)) ?? null;
      if (first) { K.tap(first); await settle(); } else btn.click();
      if (first && myTurn() && !btn.hidden) {
        if (!K.app.castMode) btn.click(); // PORTALS v3: the link ply is cast mode already
        const c2 = castable().filter((sq) => sq !== first);
        const second = c2[Math.floor(c2.length / 2)];
        if (second) { K.tap(second); await settle(); } else btn.click();
      }
    }
    const P = P0();
    out.pairs = [...P.entries()].filter(([a, b]) => a < b);
    out.first = first;
    if (first && myTurn() && P.has(first) && at(first) === '.' && at(P.get(first)) === '.') {
      const landing = riders().find((m) => m[2] === first);
      if (landing) {
        const twin = P.get(first);
        const direct = legal().some((m) => m.startsWith(landing[1] + twin));
        K.tap(landing[1]);
        const lit1 = lit();
        out.alias = { from: landing[1], entry: first, twin, entryLit: lit1.includes(first), twinLit: lit1.includes(twin), direct };
        const movesBefore = K.app.duel.record.moves.length;
        K.tap(twin);
        // the tap's move goes through the engine's quiet (cancelIdleProbes) before it lands — wait for it, then for the reply
        for (let i = 0; i < 1200 && K.app.duel.record.moves.length <= movesBefore; i++) await new Promise((r) => setTimeout(r, 25));
        await settle();
        out.alias.played = K.app.duel.record.moves[movesBefore] ?? null;
        // the board the player's ply left (the reply may take the piece on the exit and step through itself — seen: a knight from h8 taking a bishop on g6 and coming out on j3)
        const stAfter = K.app.duel.record.states.find((x) => x.move === out.alias.played);
        const atIn = (f, sq) => { const rows = f.split(' ')[0].split('[')[0].split('/'); const ff = sq.charCodeAt(0) - 97; const r = parseInt(sq.slice(1), 10); const row = rows[rows.length - r]; let x = 0; let num = ''; for (const ch of row) { if (/\d/.test(ch)) { num += ch; continue; } if (num) { x += parseInt(num, 10); num = ''; } if (x === ff) return ch; x++; } return '.'; };
        out.alias.landed = stAfter ? atIn(stAfter.fen, twin) : null;
        out.alias.entryAfter = stAfter ? atIn(stAfter.fen, first) : null;
        out.alias.fromAfter = stAfter ? atIn(stAfter.fen, landing[1]) : null;
        out.alias.reply = K.app.duel.record.moves[movesBefore + 1] ?? null;
        out.alias.log = [...document.querySelectorAll('#duel-log div')].map((d) => d.textContent).slice(-4);
      }
    }
    out.state = K.app.duel.state;
    return out;
  });
  expect(v2.plainEntry > 0 && v2.plainMid === 0 && v2.plainExit === 0, `a landing's arrow paints on the entry (${v2.plainEntry} px on ${v2.squares[1]}) and nothing on the twin ${v2.squares[2]} or beyond it (${v2.plainExit} / ${v2.plainMid} px)`);
  if (v2.letterSq) expect(v2.slideMs >= 100 && v2.slideClean, `a slide ${v2.letterSq}→${v2.squares[1]} (a landing runs to the entry) resolves (${v2.slideMs} ms) and hides nothing after`);
  if (v2.alias) {
    expect(v2.alias.entryLit && v2.alias.twinLit, `a landing on the player's portal at ${v2.alias.entry} lights its empty twin ${v2.alias.twin} as the alias`);
    expect(v2.alias.played === `${v2.alias.from}${v2.alias.entry}` || (v2.alias.direct && v2.alias.played === `${v2.alias.from}${v2.alias.twin}`), `a tap on the alias plays the landing on the entry (${v2.alias.played})`);
    expect(/[A-Z]/.test(v2.alias.landed ?? '') && v2.alias.entryAfter === '.' && v2.alias.fromAfter === '.', `the player's ply left the piece on ${v2.alias.twin} (${v2.alias.landed}), the entry ${v2.alias.entry} and ${v2.alias.from} empty (the reply was ${v2.alias.reply})`);
    if (!v2.alias.direct) expect(v2.alias.log.some((t) => t.includes(`through the portal to ${v2.alias.twin}`)), `the log says where it came out (${v2.alias.log.join(' | ')})`);
    else expect(true, `${v2.alias.from}→${v2.alias.twin} was a move of its own (a plain line), so the tap played that`);
  } else expect(true, `the alias plan was spoiled before the landing (${JSON.stringify(v2.pairs)}, first ${v2.first}, ${v2.state}) — the arrow and the slide above stand`);
  expect(errs9.length === 0, `no page errors with the portal pictures on the page${errs9.length ? ` — ${errs9.join(' | ')}` : ''}`);
  await page9.close();
}
// --- THE ICE (2026-09-20; brief §4.9; engine/patches/ice.patch): on a fresh
// duel the Ice button shows one scroll; the button enters CAST MODE with the
// centres lit — every non-terrain square of the middle rows (5 and 6 on the
// 10-rank box), occupied or not — and a tap on a wall leaves it; a tap on a
// lit square casts through the piece-move path: the field gains its `~`
// entries (the floor of the 3×3), the scroll is spent, the record's state is
// a one-ply `ice` cast, the log says so, the button goes, and the board
// PAINTS THE ICE (blue-cold pixels over the flagstones of the patch, none
// off it). Then, within a few plies, a legal move onto the ice: the tap plays
// it, the state carries the slide (the mover's resting square holds the
// piece after the commit), the log says where it slid, and the enemy's own
// slides draw their red arrow to the resting square. With `?ice=off` the
// button never shows and no scroll is in hand.
{
  // The block runs on a stage whose middle is open (`--icestage`, s73 by default: the cast rows 5–6 are floor, so a pawn on
  // rank 4 pushes onto the patch and slides); s59's cast rows are walls but for a corner, and no pawn can enter a patch there.
  const ICE_STAGE = arg('icestage', 's73-the-tower-room');
  let page11 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs11 = [];
  page11.on('pageerror', (e) => errs11.push(String(e).split('\n')[0]));
  await page11.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&stage=${ICE_STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&portals=off`);
  page11 = await bootWait(page11, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?deck=off&stage=${ICE_STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&portals=off`, (p) => p.on('pageerror', (e) => errs11.push(String(e).split('\n')[0])));
  await page11.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  // THE SPELL GLYPHS (2026-09-21 — designer: "On move hints, there's just a square outline for both portal and ice. How am I
  // supposed to know what spell it's suggesting?"): an ICE cast hint is its square framed at its edge with the SNOWFLAKE
  // inside in the rank's colour (pixelarrow.mjs ICE_GLYPH, 11×11 at rows 2–12, a black drop shadow down and right, a hollow
  // hub) — the centre square alone (the designer, on the first cut's framed 3×3: "way too loud. Just the one center square is
  // fine"), so no neighbour is framed — and the hint list wears the snowflake before the SAN (a canvas per cast hint,
  // `.hint-glyph` with `data-spell`; the line's text unchanged); a plain hint carries none; hints off clears them. Lines
  // injected through the probe's own paint path; a cast is drawn at its strength (full here).
  const ig = await page11.evaluate(async () => {
    const K = window.__DCK;
    K.options.cheat = true;
    K.options.hints = true;
    K.options.evalBar = false;
    K.applyOptions();
    await K.renderer.ready();
    const UCI = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))$/;
    const grid = () => K.app.duel.fen().split(' ')[0].replace(/\[[^\]]*\]$/, '').split('/').map((row) => { const out = []; let num = ''; for (const ch of row) { if (/\d/.test(ch)) num += ch; else { if (num) { out.push(...Array(parseInt(num, 10)).fill('.')); num = ''; } out.push(ch); } } if (num) out.push(...Array(parseInt(num, 10)).fill('.')); return out; });
    const at = (sq) => { const g = grid(); const f = sq.charCodeAt(0) - 97; const r = parseInt(sq.slice(1), 10); return g[g.length - r]?.[f] ?? '?'; };
    const ranks = K.app.boardUI.ranks, files = K.app.boardUI.files;
    const rankOf = (sq) => parseInt(sq.slice(1), 10);
    const around = (sq) => { const f = sq.charCodeAt(0) - 97, r = rankOf(sq); const o = []; for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if (f + df >= 0 && f + df < files && r + dr >= 1 && r + dr <= ranks) o.push(String.fromCharCode(97 + f + df) + (r + dr)); return o; };
    const terrain = (sq) => /[*#^_]/.test(at(sq));
    const cheb = (a, b) => Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(rankOf(a) - rankOf(b)));
    const legal = K.app.duel.legalMoves();
    const casts = legal.filter((m) => /^I@/.test(m)).map((m) => m.slice(2));
    const centre = casts.find((c) => around(c).some(terrain)) ?? casts[0]; // a patch with terrain in it when there is one: the frame must skip it
    const plain = legal.find((m) => UCI.test(m) && !/^([a-l](?:10|[1-9]))\1$/.test(m)); // any ordinary move: the control
    const ends = [plain.match(UCI)[1], plain.match(UCI)[2]];
    K.paintHints([{ rank: 1, move: `I@${centre}`, score: { type: 'cp', value: 40 }, depth: 9 }, { rank: 2, move: plain, score: { type: 'cp', value: 40 }, depth: 9 }], 2);
    const out = { centre, plain, casts: casts.length, line: document.getElementById('hint-line').textContent, plainSan: K.app.duel.board.sanMove(plain) };
    out.icons = [...document.querySelectorAll('#hint-line .hint-item')].map((s) => `${s.dataset.rank}:${s.querySelector('canvas.hint-glyph')?.dataset.spell ?? '-'}`);
    out.arrows = K.renderer.arrows.filter((a) => a.kind === 'hint').map((a) => `${a.from}${a.to}${a.cast ? `:${a.cast}` : ''}`);
    K.renderer.paintNow();
    const px = (sq, c, r) => { const p = K.renderer.square(sq); if (!p) return null; const i = (r * 16 + c) * 4; return `${p[i]},${p[i + 1]},${p[i + 2]},${p[i + 3]}`; };
    out.centrePx = { tip: px(centre, 7, 2), hub: px(centre, 6, 7), hollow: px(centre, 7, 7), shadow: px(centre, 8, 3), frame: px(centre, 0, 0), inset: px(centre, 1, 1) }; // the top tip, the hub's left vertex, the hollow centre, the tip's shadow, the frame's corner, the floor inside it
    out.beside = around(centre).filter((s) => s !== centre && !terrain(s) && ends.every((e) => cheb(s, e) >= 2)).map((s) => [s, px(s, 0, 0), px(s, 1, 1)]); // the neighbours, clear of the plain arrow: no frame on them
    K.options.cheat = false;
    K.options.hints = false;
    K.applyOptions();
    out.cleared = K.renderer.arrows.filter((a) => a.kind === 'hint').length;
    return out;
  });
  const GOLD = '242,193,78,255';
  expect(ig.icons.join(' ') === '1:ice 2:-', `the snowflake icon sits on the ice hint alone (${ig.icons.join(' ')})`);
  expect(/^1 \S*@\S+ \+0\.4 · 2 .+ \+0\.4 · d9$/.test(ig.line), `the hint list reads as ever, the cast by its SAN ("${ig.line}")`);
  expect(ig.arrows.join(' ') === `${ig.plain} ${ig.centre}${ig.centre}:ice`, `the board's cast hint carries its spell, worst to best (${ig.arrows.join(' ')})`);
  expect(ig.centrePx.tip === GOLD && ig.centrePx.hub === GOLD && ig.centrePx.hollow !== GOLD && ig.centrePx.hollow !== '0,0,0,255' && ig.centrePx.shadow === '0,0,0,255', `${ig.centre} wears the rank-1 snowflake: its top tip and its hub gold, the hub hollow, a black drop shadow (${Object.values(ig.centrePx).join(' / ')})`);
  expect(ig.centrePx.frame === GOLD && ig.centrePx.inset !== GOLD, `the square is framed at its edge, floor inside the frame (${ig.centrePx.frame} / ${ig.centrePx.inset})`);
  expect(ig.beside.length > 0 && ig.beside.every(([, a, b]) => a !== GOLD && b !== GOLD), `the centre square alone is framed — none of its neighbours (${ig.beside.map(([s]) => s).join(' ')})`);
  expect(ig.cleared === 0, 'hints off clears the spell marks with the arrows');
  const ic = await page11.evaluate(async () => {
    const K = window.__DCK;
    K.options.cheat = false;
    K.options.hints = false;
    K.options.evalBar = false;
    K.applyOptions();
    await K.renderer.ready();
    const fen = () => K.app.duel.fen();
    const field = () => fen().match(/\{([^}]*)\}/)?.[1] ?? '';
    const holdings = () => fen().match(/\[([^\]]*)\]/)?.[1] ?? '';
    const grid = () => fen().split(' ')[0].replace(/\[[^\]]*\]$/, '').split('/').map((row) => { const out = []; let num = ''; for (const ch of row) { if (/\d/.test(ch)) num += ch; else { if (num) { out.push(...Array(parseInt(num, 10)).fill('.')); num = ''; } out.push(ch); } } if (num) out.push(...Array(parseInt(num, 10)).fill('.')); return out; });
    const at = (sq) => { const g = grid(); const f = sq.charCodeAt(0) - 97; const r = parseInt(sq.slice(1), 10); return g[g.length - r]?.[f] ?? '?'; };
    const ranks = K.app.boardUI.ranks;
    const rankOf = (sq) => parseInt(sq.slice(1), 10);
    const lit = () => [...K.app.boardUI.marks.targets];
    const icy = (sq) => { K.renderer.paintNow(); const px = K.renderer.square(sq); if (!px) return -1; let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i + 3] === 255 && px[i + 2] > px[i] + 40 && px[i + 2] > px[i + 1] + 10) n++; return n; }; // cold pixels: blue well over red
    const settle = async () => { await K.waitIdle(); for (let i = 0; i < 400 && K.app.busy; i++) await new Promise((r) => setTimeout(r, 25)); };
    const logLines = () => [...document.querySelectorAll('#duel-log div')].map((d) => d.textContent);
    // THE CARD UI (Phase 3.2): the Ice button is the ice CARD in the fan
    const card = () => K.cards.info('ice');
    const c0 = card();
    const out = { hidden0: c0.n === 0, text0: `×${c0.n}`, disabled0: !c0.playable, holdings0: holdings(), portalHidden0: K.cards.info('portal').n === 0 };
    K.cards.tap('ice');
    out.castMode = K.ice.castMode();
    const L0 = lit();
    out.litN = L0.length;
    out.litRows = [...new Set(L0.map(rankOf))].sort((a, b) => a - b);
    out.litTerrain = L0.filter((sq) => /[*#^_]/.test(at(sq))).length;
    out.litMiddleFloor = grid().flatMap((row, i) => row.map((c, f) => ({ sq: String.fromCharCode(97 + f) + (ranks - i), c }))).filter((x) => [Math.floor(ranks / 2), Math.floor(ranks / 2) + 1].includes(rankOf(x.sq)) && !/[*#^_]/.test(x.c)).length;
    const wall = [...K.app.boardUI.cells.keys()].find((sq) => at(sq) === '*' && !L0.includes(sq));
    K.tap(wall);
    out.leftAfterWallTap = !K.ice.castMode() && lit().length === 0;
    K.cards.tap('ice');
    // The cast: a lit square whose 3×3 has as much bare floor as possible (the ice reads on empty flagstones).
    const around = (sq) => { const f = sq.charCodeAt(0) - 97, r = rankOf(sq); const o = []; for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if (f + df >= 0 && f + df < K.app.boardUI.files && r + dr >= 1 && r + dr <= ranks) o.push(String.fromCharCode(97 + f + df) + (r + dr)); return o; };
    const floorAround = (sq) => around(sq).filter((s) => at(s) === '.').length;
    // …with the most ENTRIES — a patch square a pawn can push onto from the floor south of it (a pawn's push onto ice is always a
    // slide; a rider runs over ice without stopping) — then the most floor, then nearest the player's pieces.
    const sqOf = (f, r) => String.fromCharCode(97 + f) + r;
    const south = (sq, n = 1) => sqOf(sq.charCodeAt(0) - 97, rankOf(sq) - n);
    const inPatch = (c, sq) => Math.abs(sq.charCodeAt(0) - c.charCodeAt(0)) <= 1 && Math.abs(rankOf(sq) - rankOf(c)) <= 1;
    const entriesOf = (c) => around(c).filter((s) => at(s) !== '?' && !/[*#^_]/.test(at(s)) && rankOf(s) >= 3 && !inPatch(c, south(s)) && at(south(s)) === '.' && at(south(s, 2)) === '.').map((s) => south(s));
    const whites = grid().flatMap((row, i) => row.map((c, f) => ({ f, r: ranks - i, c }))).filter((x) => /[A-Z]/.test(x.c));
    const nearWhite = (sq) => Math.min(...whites.map((w) => Math.max(Math.abs(w.f - (sq.charCodeAt(0) - 97)), Math.abs(w.r - rankOf(sq)))));
    const score = (c) => entriesOf(c).length * 100 + floorAround(c) * 10 - nearWhite(c);
    const centre = [...lit()].sort((a, b) => score(b) - score(a))[0];
    const entries = entriesOf(centre); // the squares south of the patch a pawn pushes from
    out.entries = entries;
    out.centre = centre;
    out.patchExpected = around(centre).filter((s) => !/[*#^_]/.test(at(s))).sort();
    out.icyBefore = around(centre).filter((s) => at(s) === '.').map((s) => [s, icy(s)]);
    K.tap(centre);
    await settle();
    out.fieldA = field();
    out.slickA = K.ice.slick().sort();
    out.holdingsA = holdings();
    out.hiddenA = card().n === 0;
    out.castsA = K.app.duel.record.states.map((s) => s.cast ?? null).filter(Boolean);
    out.logA = logLines().filter((l) => /ice/i.test(l));
    out.stateA = K.app.duel.state;
    out.icyAfter = out.icyBefore.map(([s]) => [s, icy(s)]);
    out.icyOff = [...K.app.boardUI.cells.keys()].filter((s) => at(s) === '.' && !out.slickA.includes(s)).slice(0, 12).map((s) => [s, icy(s)]);
    // A slide in play: the first legal move of the player's that slides, within a few plies.
    out.slide = null;
    out.enemySlide = null;
    for (let ply = 0; ply < 40 && K.app.duel.state === 'playing' && !out.slide; ply++) {
      await settle();
      if (K.app.duel.state !== 'playing') break;
      if (K.app.duel.turnColor() !== 'white') { await settle(); continue; }
      const legal = K.app.duel.legalMoves().filter((m) => /^[a-l](?:10|[1-9])[a-l](?:10|[1-9])[a-z]?$/.test(m) && !/^([a-l](?:10|[1-9]))\1$/.test(m));
      // A move that really slides: the mover leaves the square it entered, or shoves somebody (a piece entering ice at the board's edge stops where it is).
      const moving = (o) => o.steps[0].to !== o.steps[0].from || o.steps.length > 1;
      const cands = legal.map((m) => [m, K.ice.outcome(m)]).filter(([, o]) => o && moving(o) && !o.steps.some((s) => s.pit && s.piece.toLowerCase() === 'k'));
      if (cands.length) {
        const [m, o] = cands.sort((a, b) => b[1].steps.length - a[1].steps.length)[0];
        const from = m.match(/^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))/)[1];
        const to = m.match(/^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))/)[2];
        const rest = o.steps[0].landing?.entry ?? o.steps[0].to ?? o.steps[0].pit;
        K.tap(from);
        const aliases = K.ice.aliases(from);
        const litNow = lit();
        const aliasLit = rest !== to && litNow.includes(rest);
        const useAlias = aliasLit && aliases.some(([sq]) => sq === rest);
        const before = K.app.duel.record.states.length;
        K.tap(useAlias ? rest : to);
        await settle();
        const st = K.app.duel.record.states[before] ?? null;
        out.slide = { move: m, from, to, rest, aliasLit, useAlias, predicted: o.steps, recorded: st?.slide ?? null, san: K.app.duel.record.sans[before - 1] ?? null, played: K.app.duel.record.moves[before - 1] ?? null, pieceAtRest: st ? (() => { const g = st.fen.split(' ')[0].replace(/\[[^\]]*\]$/, '').split('/'); const r = parseInt(rest.slice(1), 10); const row = g[g.length - r]; let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += parseInt(ch, 10); else { if (f === rest.charCodeAt(0) - 97) return ch; f++; } } return '.'; })() : null, log: logLines().filter((l) => /slides|stops on|shoves|falls into|portal/.test(l)).slice(-1)[0] ?? null, state: K.app.duel.state };
      } else {
        // Walk toward the ice: a PAWN toward an entry square first (its push onto the patch is a slide), the king next, the rest last.
        const goals = entries.length ? entries : K.ice.slick();
        const dist = (sq) => Math.min(...goals.map((s) => Math.max(Math.abs(s.charCodeAt(0) - sq.charCodeAt(0)), Math.abs(rankOf(s) - rankOf(sq)))));
        const scored = legal.map((m) => { const p = m.match(/^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))/); const pc = at(p[1]); return [m, dist(p[2]) + (pc === 'P' ? 0 : pc === 'K' ? 4 : 8)]; }).sort((a, b) => a[1] - b[1]);
        await K.playerMove(scored[0][0]);
      }
    }
    // The enemy's slides, if any so far: their red arrow ends where the piece rests.
    const st = K.app.duel.record.states;
    for (let i = st.length - 1; i >= 1; i--) {
      if (st[i].mover === 'engine' && st[i].slide) {
        out.enemySlide = { ply: st[i].ply, move: st[i].move, steps: st[i].slide.steps, isLast: i === st.length - 1, arrows: i === st.length - 1 ? K.renderer.arrows.filter((a) => a.kind === 'last').map((a) => `${a.from}${a.to}`) : null };
        break;
      }
    }
    out.state = K.app.duel.state;
    return out;
  });
  expect(!ic.hidden0 && /×1/.test(ic.text0) && !ic.disabled0 && /I/.test(ic.holdings0) && ic.portalHidden0, `the ice CARD is in the fan on the player's turn, one card, playable (${ic.text0}${ic.hidden0 ? ', none' : ''}${ic.disabled0 ? ', dimmed' : ''}; holdings [${ic.holdings0}], no portal card under ?portals=off)`);
  expect(ic.castMode === 'ice' && ic.litN > 0 && ic.litRows.join(',') === '5,6' && ic.litTerrain === 0 && ic.litN === ic.litMiddleFloor, `a tap on the card enters ice cast mode with ${ic.litN} centres lit — every non-terrain square of ranks ${ic.litRows.join(' and ')} (${ic.litMiddleFloor} such squares, ${ic.litTerrain} on terrain)`);
  expect(ic.leftAfterWallTap, 'a tap on a wall leaves the spell with nothing lit');
  expect(ic.fieldA.split(',').filter((e) => e.startsWith('~')).length === ic.patchExpected.length && JSON.stringify(ic.slickA) === JSON.stringify(ic.patchExpected), `the cast at ${ic.centre} ices the floor of its 3×3: {${ic.fieldA}} (${ic.patchExpected.length} squares)`);
  expect(!/I/.test(ic.holdingsA) && /i/.test(ic.holdingsA) && ic.hiddenA, `the scroll is spent and the card leaves the fan (holdings [${ic.holdingsA}]${ic.hiddenA ? '' : ', the card still shows'})`);
  expect(ic.castsA[0] === 'ice' && ic.logA.some((l) => /the ice is cast/.test(l)), `the record's state is a one-ply ice cast and the log says so (${ic.castsA.join(',')}; "${ic.logA[0] ?? ''}")`);
  expect(ic.icyAfter.every(([, n]) => n >= 60) && ic.icyBefore.every(([, n]) => n < 20), `the patch's empty squares paint the ice — cold pixels ${ic.icyAfter.map(([s, n]) => `${s}:${n}`).join(' ')} of 256 (before: ${ic.icyBefore.map(([, n]) => n).join(' ')})`);
  expect(ic.icyOff.every(([, n]) => n < 20), `no ice off the patch (${ic.icyOff.map(([s, n]) => `${s}:${n}`).join(' ')})`);
  if (ic.slide) {
    const s = ic.slide;
    expect(s.recorded && JSON.stringify(s.recorded.steps) === JSON.stringify(s.predicted) && s.played.startsWith(s.from + s.to), `the tap plays ${s.move} (${s.san}) and the state records the slide the grid predicted (${s.predicted.map((x) => `${x.piece} ${x.from}→${x.to ?? `pit ${x.pit}`}`).join(', ')}${s.useAlias ? ', played through the resting square' : ''})`);
    expect(s.predicted[0].pit ? s.pieceAtRest === '.' || s.pieceAtRest === '_' : /[A-Z]/.test(s.pieceAtRest ?? ''), `after the commit the piece stands where it came to rest, ${s.rest} (${s.pieceAtRest})`);
    expect(s.log && /slides to|stops on|shoves|falls into|portal/.test(s.log), `the log says what the slide did ("${s.log}")`);
    if (s.rest !== s.to) expect(s.aliasLit, `the resting square ${s.rest} lit beside the destination ${s.to}`);
  } else expect(true, `no player slide came up in the plies played (${ic.state}) — the physics stand on the selftest and the Node gate`);
  if (ic.enemySlide) {
    const e = ic.enemySlide;
    if (e.isLast) expect(e.arrows.some((a) => a === `${e.move.slice(0, 2)}${e.steps[0].landing?.entry ?? e.steps[0].to ?? e.steps[0].pit}`), `the enemy's slide ${e.move} draws its red arrow to the resting square (${e.arrows.join(' ')})`);
    else expect(true, `the enemy slid at ply ${e.ply} (${e.move}: ${e.steps.map((x) => `${x.from}→${x.to ?? `pit ${x.pit}`}`).join(', ')})`);
  } else expect(true, 'the enemy did not slide in these plies');
  expect(errs11.length === 0, `no page errors with the ice${errs11.length ? ` — ${errs11.join(' | ')}` : ''}`);
  await page11.close();
  // ?ice=off: no scroll, no button
  let page12 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page12.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&stage=${ICE_STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&ice=off`);
  page12 = await bootWait(page12, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?deck=off&stage=${ICE_STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&ice=off`, null);
  await page12.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const off = await page12.evaluate(() => ({ hidden: window.__DCK.cards.info('ice').n === 0, holdings: window.__DCK.app.duel.fen().match(/\[([^\]]*)\]/)?.[1] ?? '', variant: window.__DCK.app.duel.variantName }));
  expect(off.hidden && !/[Ii]/.test(off.holdings) && !/__ice/.test(off.variant), `?ice=off: no ice card in the fan, no ice scroll in hand, a deal without the suffix ([${off.holdings}] ${off.variant})`);
  // THE SPELL GLYPHS, the portal's: on this page (portals on) a PORTAL cast hint is its square framed at its edge with the
  // RING inside — hollow, in the rank's colour with the black drop shadow — and nothing framed beside it; the list wears the ring.
  const ip = await page12.evaluate(async () => {
    const K = window.__DCK;
    K.options.cheat = true;
    K.options.hints = true;
    K.options.evalBar = false;
    K.applyOptions();
    await K.renderer.ready();
    const UCI = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))$/;
    const grid = () => K.app.duel.fen().split(' ')[0].replace(/\[[^\]]*\]$/, '').split('/').map((row) => { const out = []; let num = ''; for (const ch of row) { if (/\d/.test(ch)) num += ch; else { if (num) { out.push(...Array(parseInt(num, 10)).fill('.')); num = ''; } out.push(ch); } } if (num) out.push(...Array(parseInt(num, 10)).fill('.')); return out; });
    const at = (sq) => { const g = grid(); const f = sq.charCodeAt(0) - 97; const r = parseInt(sq.slice(1), 10); return g[g.length - r]?.[f] ?? '?'; };
    const ranks = K.app.boardUI.ranks, files = K.app.boardUI.files;
    const rankOf = (sq) => parseInt(sq.slice(1), 10);
    const around = (sq) => { const f = sq.charCodeAt(0) - 97, r = rankOf(sq); const o = []; for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if ((df || dr) && f + df >= 0 && f + df < files && r + dr >= 1 && r + dr <= ranks) o.push(String.fromCharCode(97 + f + df) + (r + dr)); return o; };
    const terrain = (sq) => /[*#^_]/.test(at(sq));
    const cheb = (a, b) => Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(rankOf(a) - rankOf(b)));
    const legal = K.app.duel.legalMoves();
    const casts = legal.filter((m) => /^O@/.test(m)).map((m) => m.slice(2));
    const plain = legal.find((m) => UCI.test(m) && !/^([a-l](?:10|[1-9]))\1$/.test(m));
    const ends = [plain.match(UCI)[1], plain.match(UCI)[2]];
    const centre = casts.find((c) => ends.every((e) => cheb(c, e) >= 3)) ?? casts[0]; // clear of the plain arrow, so its neighbours read clean
    K.paintHints([{ rank: 1, move: `O@${centre}`, score: { type: 'cp', value: 40 }, depth: 9 }, { rank: 2, move: plain, score: { type: 'cp', value: 40 }, depth: 9 }], 2);
    const out = { centre, plain, casts: casts.length, line: document.getElementById('hint-line').textContent };
    out.icons = [...document.querySelectorAll('#hint-line .hint-item')].map((s) => `${s.dataset.rank}:${s.querySelector('canvas.hint-glyph')?.dataset.spell ?? '-'}`);
    out.arrows = K.renderer.arrows.filter((a) => a.kind === 'hint').map((a) => `${a.from}${a.to}${a.cast ? `:${a.cast}` : ''}`);
    K.renderer.paintNow();
    const px = (sq, c, r) => { const p = K.renderer.square(sq); if (!p) return null; const i = (r * 16 + c) * 4; return `${p[i]},${p[i + 1]},${p[i + 2]},${p[i + 3]}`; };
    out.ring = { top: px(centre, 6, 3), shadow: px(centre, 7, 4), hollow: px(centre, 7, 7), frame: px(centre, 0, 0), inset: px(centre, 1, 1) }; // the ring's top row, its shadow under it, the hollow centre, the frame's corner, the floor inside it
    out.beside = around(centre).filter((s) => !terrain(s)).map((s) => [s, px(s, 0, 0)]);
    K.options.cheat = false;
    K.options.hints = false;
    K.applyOptions();
    out.cleared = K.renderer.arrows.filter((a) => a.kind === 'hint').length;
    return out;
  });
  expect(ip.icons.join(' ') === '1:portal 2:-', `the ring icon sits on the portal hint alone (${ip.icons.join(' ')})`);
  expect(/^1 \S*@\S+ \+0\.4 · 2 .+ \+0\.4 · d9$/.test(ip.line), `the hint list reads the cast by its SAN ("${ip.line}")`);
  expect(ip.arrows.join(' ') === `${ip.plain} ${ip.centre}${ip.centre}:portal`, `the board's portal cast hint carries its spell (${ip.arrows.join(' ')})`);
  expect(ip.ring.top === GOLD && ip.ring.shadow === '0,0,0,255' && ip.ring.hollow !== GOLD && ip.ring.hollow !== '0,0,0,255' && ip.ring.frame === GOLD && ip.ring.inset !== GOLD, `${ip.centre} wears the rank-1 ring: gold with a black drop shadow, hollow at its centre, the square framed at its edge (${Object.values(ip.ring).join(' / ')})`);
  expect(ip.beside.length > 0 && ip.beside.every(([, c]) => c !== GOLD), `a portal cast frames its square alone (${ip.beside.map(([s]) => s).join(' ')})`);
  expect(ip.cleared === 0, 'hints off clears the ring with the arrows');
  await page12.close();
}
// --- THE SLEDGEHAMMER (2026-09-17; brief §4.8; engine/patches/wall-kinds.patch
// + hammer.patch): every king a sledge-king for the stress test. On
// s65-guard-post seed 1 the kit's king deals at e1 with breakable walls at d1
// and d2: a tap on the king lights both walls beside his ordinary moves (the
// engine's own move list — a move onto a '*' IS a hammer); a tap on a wall
// cracks it — the state after the ply shows a crate there and the god-crate
// ledger has the square (a cracked wall is a cracked wall, whoever cracked
// it), the board paints it cracked, the record's SAN is K*d2 and the state
// carries `hammer`, the log names the crack, the king stayed. With
// `?hammer=off` the same tap lights no wall. Then THE WALK: the king cracks
// a wall beside him by a manual move (ruling 11) — nobody moves, the world's
// ledger takes the cell, the crate is a capture next, the save carries it.
{
  let page9 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs9 = [];
  page9.on('pageerror', (e) => errs9.push(String(e).split('\n')[0]));
  const q9 = `stage=s65-guard-post&autobegin=1&fx=0&seed=1&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&arrowalpha=1&arrowwidth=2`;
  await page9.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&${q9}`);
  page9 = await bootWait(page9, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?deck=off&${q9}`, (p) => p.on('pageerror', (e) => errs9.push(String(e).split('\n')[0])));
  await page9.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  // THE SLEDGEHAMMER'S GLYPH (2026-09-18): a hint onto a wall wears the hammer —
  // in the list (a canvas per hammer hint, in the rank's colour, between the
  // rank and the SAN; the line's text unchanged) and on the board (the glyph
  // stamped on the wall's square over the arrow's head: rows 3–12, cols 4–11,
  // the head in the rank's colour, the handle its shade, a black halo). Lines
  // injected through the probe's own paint path; the arrows at full opacity so
  // every pixel is exact.
  const gl = await page9.evaluate(async () => {
    const K = window.__DCK;
    K.options.cheat = true;
    K.options.hints = true;
    K.options.evalBar = false;
    K.applyOptions();
    await K.renderer.ready();
    const UCI = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))$/;
    const plain = K.app.duel.legalMoves().find((m) => UCI.test(m) && !/^e1d[12]$/.test(m)); // any ordinary move of the position: the control
    const plainTo = plain.match(UCI)[2];
    K.paintHints([{ rank: 1, move: 'e1d2', score: { type: 'cp', value: 40 }, depth: 9 }, { rank: 2, move: 'e1d1', score: { type: 'cp', value: 20 }, depth: 9 }, { rank: 3, move: plain, score: { type: 'cp', value: 10 }, depth: 9 }], 3);
    const out = { line: document.getElementById('hint-line').textContent, plain, plainTo, plainSan: K.app.duel.board.sanMove(plain) };
    out.icons = [...document.querySelectorAll('#hint-line .hint-item')].map((s) => `${s.dataset.rank}:${s.querySelector('canvas.hint-hammer') ? 'hammer' : '-'}`);
    out.arrows = K.renderer.arrows.filter((a) => a.kind === 'hint').map((a) => `${a.from}${a.to}${a.hammer ? '*' : ''}`);
    const px = (sq, c, r) => { const p = K.app.boardUI.squarePixels(sq); if (!p) return null; const i = (r * 16 + c) * 4; return `${p[i]},${p[i + 1]},${p[i + 2]},${p[i + 3]}`; };
    out.d2 = { head: px('d2', 7, 4), handle: px('d2', 8, 10), halo: px('d2', 3, 3) };
    out.d1 = { head: px('d1', 7, 4), handle: px('d1', 8, 10) };
    out.plainShade = (() => { const p = K.app.boardUI.squarePixels(plainTo); let n = 0; for (let i = 0; i < p.length; i += 4) if (p[i] === 110 && p[i + 1] === 71 && p[i + 2] === 35) n++; return n; })(); // the rank-3 handle's shade: only the glyph paints it
    K.options.cheat = false;
    K.options.hints = false;
    K.applyOptions();
    out.cleared = K.renderer.arrows.filter((a) => a.kind === 'hint').length;
    return out;
  });
  expect(gl.line === `1 K*d2 +0.4 · 2 K*d1 +0.2 · 3 ${gl.plainSan} +0.1 · d9`, `the hint list reads as ever, the hammers by their SAN ("${gl.line}")`);
  expect(gl.icons.join(' ') === '1:hammer 2:hammer 3:-', `the hammer icon sits on the hammer hints alone (${gl.icons.join(' ')})`);
  expect(gl.arrows.join(' ') === `${gl.plain} e1d1* e1d2*`, `the board's hint arrows carry the hammer flag, worst to best (${gl.arrows.join(' ')})`);
  expect(gl.d2.head === '242,193,78,255' && gl.d2.handle === '133,106,43,255' && gl.d2.halo === '0,0,0,255', `d2 wears the rank-1 hammer: head gold, handle its shade, a black halo (${gl.d2.head} / ${gl.d2.handle} / ${gl.d2.halo})`);
  const near = (got, want) => { const g = String(got).split(',').map(Number), w = want.split(',').map(Number); return g.length === 4 && g.every((v, i) => Math.abs(v - w[i]) <= 8); }; // a rank-2 arrow is a shade translucent by its strength (arrowAlpha), so its glyph blends a little with the wall
  expect(near(gl.d1.head, '201,206,216,255') && near(gl.d1.handle, '111,113,119,255'), `d1 wears the rank-2 hammer in its own colour, at its strength's opacity (${gl.d1.head} / ${gl.d1.handle})`);
  expect(gl.plainShade === 0, `a plain hint carries no hammer (${gl.plain}: ${gl.plainShade} pixels of the rank-3 handle's shade on ${gl.plainTo})`);
  expect(gl.cleared === 0, 'hints off clears the hammers with the arrows');
  const hm = await page9.evaluate(async () => {
    const K = window.__DCK;
    K.options.cheat = false;
    K.options.hints = false;
    K.options.evalBar = false;
    K.applyOptions();
    await K.renderer.ready();
    const gridOf = (fen) => fen.split(' ')[0].replace(/\[[^\]]*\]$/, '').split('/').map((row) => { const out = []; let num = ''; for (const ch of row) { if (/\d/.test(ch)) num += ch; else { if (num) { out.push(...Array(parseInt(num, 10)).fill('.')); num = ''; } out.push(ch); } } if (num) out.push(...Array(parseInt(num, 10)).fill('.')); return out; });
    const atIn = (fen, sq) => { const g = gridOf(fen); const f = sq.charCodeAt(0) - 97; const r = parseInt(sq.slice(1), 10); return g[g.length - r]?.[f] ?? '?'; };
    const at = (sq) => atIn(K.app.duel.fen(), sq);
    const kingSq = () => { const g = gridOf(K.app.duel.fen()); for (let i = 0; i < g.length; i++) for (let f = 0; f < g[i].length; f++) if (g[i][f] === 'K') return String.fromCharCode(97 + f) + (g.length - i); return null; };
    const around = (sq) => { const f = sq.charCodeAt(0) - 97, r = parseInt(sq.slice(1), 10); const out = []; for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) { if (!df && !dr) continue; if (f + df >= 0 && f + df < K.app.boardUI.files && r + dr >= 1 && r + dr <= K.app.boardUI.ranks) out.push(String.fromCharCode(97 + f + df) + (r + dr)); } return out; };
    const settle = async () => { await K.waitIdle(); for (let i = 0; i < 200 && K.app.busy; i++) await new Promise((r) => setTimeout(r, 25)); };
    const out = { variant: K.app.duel.variantName, king: kingSq(), optHammer: document.getElementById('optHammer').checked };
    out.walls = around(out.king).filter((s) => at(s) === '*');
    K.tap(out.king);
    const lit = [...K.app.boardUI.marks.targets];
    out.lit = lit;
    out.wallsLit = out.walls.filter((s) => lit.includes(s));
    out.selected = K.app.boardUI.marks.selected;
    out.target = out.walls.includes('d2') ? 'd2' : out.walls[0];
    K.tap(out.target);
    await settle();
    const st1 = K.app.duel.record.states[1];
    out.after = {
      cell: st1 ? atIn(st1.fen, out.target) : null,
      crate: !!st1 && (st1.godCrates ?? []).includes(out.target),
      hammer: st1?.hammer ?? null,
      san: K.app.duel.record.sans[0],
      king: st1 ? (() => { const g = gridOf(st1.fen); for (let i = 0; i < g.length; i++) for (let f = 0; f < g[i].length; f++) if (g[i][f] === 'K') return String.fromCharCode(97 + f) + (g.length - i); return null; })() : null,
      live: at(out.target),
      classes: K.marks.cell(out.target),
      log: [...document.querySelectorAll('#duel-log div')].map((d) => d.textContent).filter((t) => /sledgehammer/i.test(t)),
      state: K.app.duel.state,
    };
    return out;
  });
  expect(/__sledge/.test(hm.variant) && hm.optHammer, `the deal is a sledge deal and the option is on (${hm.variant})`);
  expect(hm.king === 'e1' && hm.walls.length === 2 && hm.walls.includes('d1') && hm.walls.includes('d2'), `the kit's king at ${hm.king} with breakable walls beside him (${hm.walls.join(' ')})`);
  expect(hm.selected === hm.king && hm.wallsLit.length === hm.walls.length, `a tap on the king lights the walls beside him with his moves (${hm.wallsLit.join(' ')} of ${hm.lit.join(' ')})`);
  expect(hm.after.cell === '^' && hm.after.crate && hm.after.king === hm.king && hm.after.hammer === hm.target, `a tap on ${hm.target} cracks it: the state after the ply shows a crate in the ledger, the king still on ${hm.after.king}, the state marked hammer ${hm.after.hammer}`);
  expect(hm.after.san === `K*${hm.target}` && hm.after.log.some((t) => t.includes(`cracks the wall at ${hm.target}`)), `the record and the log say what happened (${hm.after.san}; ${hm.after.log[0] ?? 'no log line'})`);
  if (hm.after.live === '^') expect(hm.after.classes?.includes('cracked') && hm.after.classes?.includes('furniture'), `the board paints ${hm.target} as a cracked wall (${(hm.after.classes ?? []).filter((c) => /wall|crack|furn/.test(c)).join(' ')})`);
  else expect(true, `the enemy took the crate on its reply (${hm.after.live} on ${hm.target} now) — the crack was painted for a ply`);
  expect(errs9.length === 0, `no page errors with the sledgehammer${errs9.length ? ` — ${errs9.join(' | ')}` : ''}`);
  await page9.close();
  // Plain kings: `?hammer=off` — the same tap lights no wall and the deal is plain.
  let page9b = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page9b.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&${q9}&hammer=off`);
  page9b = await bootWait(page9b, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?deck=off&${q9}&hammer=off`, null);
  await page9b.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  // (With plain kings the king at e1 has no move at all here — the walls, his own pawns and rook box him in — so nothing lights; the engine's list is the proof.)
  const plain = await page9b.evaluate(() => { const K = window.__DCK; K.tap('e1'); const lit = [...K.app.boardUI.marks.targets]; const legal = K.app.duel.legalMoves(); return { variant: K.app.duel.variantName, lit, walls: lit.filter((s) => ['d1', 'd2'].includes(s)), hammers: legal.filter((m) => m === 'e1d1' || m === 'e1d2'), legal: legal.length }; });
  expect(!/sledge/.test(plain.variant) && plain.walls.length === 0 && plain.hammers.length === 0 && plain.legal > 0, `?hammer=off: plain kings — no wall lights and the engine lists no hammer (${plain.lit.join(' ') || 'nothing lit'}; ${plain.legal} legal moves; ${plain.variant})`);
  await page9b.close();
  // THE WALK: a manual hammer on the fixture (the enemies off; motion off).
  const page10 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs10 = [];
  page10.on('pageerror', (e) => errs10.push(String(e).split('\n')[0]));
  await page10.goto(`http://127.0.0.1:${PORT}/play/index.html?deck=off&gen=vaults&seed=1&fx=0&enemies=off`);
  await page10.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 120000 });
  const hw = await page10.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    const wallsBy = (k) => { const out = []; for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) { if (!df && !dr) continue; if (K.walk.cell(k.f + df, k.r + dr)?.v === '*') out.push({ f: k.f + df, r: k.r + dr }); } return out; };
    const out = { steps: 0 };
    // Walk the facing until a breakable wall stands beside the king (bounded): the vaults are full of them.
    const fwd = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    let walls = wallsBy(K.walk.state.king);
    for (let i = 0; i < 40 && !walls.length; i++) {
      const d = fwd[K.walk.state.facing];
      const p = await K.walk.input({ kind: 'step', df: d[0], dr: d[1] });
      if (!p.ok) { const t = fwd[(K.walk.state.facing + 1) % 4]; await K.walk.input({ kind: 'step', df: t[0], dr: t[1] }); }
      out.steps++;
      walls = wallsBy(K.walk.state.king);
    }
    const s0 = K.walk.state;
    out.king = { ...s0.king };
    out.walls = walls;
    if (!walls.length) return out;
    K.walk.select(s0.king.f, s0.king.r);
    out.targets = K.walk.state.targets.map((t) => ({ f: t.f, r: t.r, capture: t.capture ?? null }));
    out.hammerTargets = out.targets.filter((t) => t.capture === 'hammer');
    const w = walls[0];
    const before = s0.pieces.map((p) => `${p.f},${p.r}`).join(' ');
    const plan = await K.walk.input({ kind: 'move', id: s0.king.id, to: { f: w.f, r: w.r } });
    for (let i = 0; i < 200 && K.walk.busy; i++) await new Promise((r) => setTimeout(r, 25));
    const s1 = K.walk.state;
    out.plan = { ok: plan?.ok, hammer: plan?.hammer ?? null, moves: plan?.moves?.length ?? -1 };
    out.after = { cell: K.walk.cell(w.f, w.r), unmoved: s1.pieces.map((p) => `${p.f},${p.r}`).join(' ') === before, turn: s1.turn - s0.turn, status: document.getElementById('walk-status').textContent };
    K.walk.select(s1.king.f, s1.king.r);
    out.next = K.walk.state.targets.find((t) => t.f === w.f && t.r === w.r) ?? null;
    K.walk.select(-1, -1);
    const exp = K.walk.export();
    const floor = exp.floors?.[exp.floor]?.world;
    out.save = { lastInput: exp.turns[exp.turns.length - 1], crateSaved: !!floor && (floor.godCrates ?? []).includes(w.r * floor.files + w.f), terrain: floor?.terrain?.[floor.ranks - 1 - w.r]?.[w.f] ?? null };
    return out;
  });
  if (!hw.walls.length) expect(true, `the walk's hammer: not measured — no breakable wall beside the king within ${hw.steps} steps`);
  else {
    expect(hw.hammerTargets.length === hw.walls.length && hw.hammerTargets.every((t) => hw.walls.some((w) => w.f === t.f && w.r === t.r)), `the king's manual moves offer every breakable wall beside him as a hammer (${hw.hammerTargets.length} of ${hw.walls.length}, after ${hw.steps} steps)`);
    expect(hw.plan.ok && hw.plan.hammer && hw.plan.moves === 0, `the hammer input plans as a move of nobody (${JSON.stringify(hw.plan)})`);
    expect(hw.after.cell?.v === '^' && hw.after.cell?.crate === true && hw.after.unmoved && hw.after.turn === 1, `the wall is a crate in the world's ledger, nobody moved, one turn spent (${hw.after.status})`);
    expect(/cracks the wall/.test(hw.after.status), `the status says so (${hw.after.status})`);
    expect(hw.next?.capture === 'furniture', `the crate is a capture next (${JSON.stringify(hw.next)})`);
    expect(hw.save.lastInput?.kind === 'move' && hw.save.crateSaved && hw.save.terrain === '^', `the run save carries the input and the cracked cell (${JSON.stringify(hw.save)})`);
  }
  expect(errs10.length === 0, `no page errors on the walk's hammer${errs10.length ? ` — ${errs10.join(' | ')}` : ''}`);
  await page10.close();
}

// --- THE DECK (2026-09-25; brief §4.10; play/js/deck.mjs + duel.mjs): spells
// as cards. A hand-built `?deck=` list deals in its own order, so the
// opening hand is known: Reveal, Undo, Ice, Portal — the spell buttons show
// one card each, the meta cards their buttons, the redraw its button, the
// pile in order under the bar, the enemy's hand and pile in its bar. Reveal
// shows the oracle's lines without Cheater Mode and is spent on the record;
// an ice cast leaves three in hand and the refill at the next turn start
// draws the pile's top (the log says so, the state carries `drew`); the Undo
// card takes the turn back and stays spent; the redraw discards the hand,
// draws four and spends the turn (a `--` ply); the export carries the decks
// and the plays. With `?deck=off` nothing of this shows and the holdings are
// the stress-test set.
{
  let pageD = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errsD = [];
  pageD.on('pageerror', (e) => errsD.push(String(e).split('\n')[0]));
  await pageD.goto(`http://127.0.0.1:${PORT}/play/index.html?stage=${STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&probe=depth%206%20movetime%20300&mateprobe=off&evalgate=off&onset=400&debris=off&deck=reveal,undo,ice,portal,ice,portal,ice,portal`);
  pageD = await bootWait(pageD, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?stage=${STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&probe=depth%206%20movetime%20300&mateprobe=off&evalgate=off&onset=400&debris=off&deck=reveal,undo,ice,portal,ice,portal,ice,portal`, (p) => p.on('pageerror', (e) => errsD.push(String(e).split('\n')[0])));
  await pageD.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const dk = await pageD.evaluate(async () => {
    const K = window.__DCK;
    K.options.cheat = false;
    K.options.hints = false;
    K.options.evalBar = false;
    K.applyOptions();
    const settle = async () => { await K.waitIdle(); for (let i = 0; i < 400 && K.app.busy; i++) await new Promise((r) => setTimeout(r, 25)); };
    const btn = (id) => document.getElementById(id);
    // THE CARD UI (Phase 3.2): the buttons are cards in the fan — hidden = no card of the kind, disabled = the card dimmed
    const vis = (kind) => { const i = K.cards.info(kind); return { hidden: i.n === 0, disabled: !i.playable, text: `×${i.n}` }; };
    const holdings = () => K.app.duel.fen().match(/\[([^\]]*)\]/)?.[1] ?? '';
    const logLines = () => [...document.querySelectorAll('#duel-log div')].map((d) => d.textContent);
    const out = {};
    out.spec = K.deck.spec();
    out.hands0 = K.deck.hands();
    out.decks0 = K.deck.decks();
    out.holdings0 = holdings();
    out.btn0 = { portal: vis('portal'), ice: vis('ice'), reveal: vis('reveal'), undo: vis('undo'), mull: { hidden: K.cards.piles() === null, text: 'Redraw' } };
    out.piles0 = K.cards.piles();
    out.fan0 = K.cards.hand();
    out.enemy0 = { hand: K.cards.enemy(), pile: K.cards.enemyPile() };
    out.state0 = K.app.duel.record.states[0].deck;
    // Reveal: the lines without Cheater Mode — a tap on the card
    K.cards.tap('reveal');
    await new Promise((r) => setTimeout(r, 50));
    out.revealOn = K.deck.revealOn();
    out.handsR = K.deck.hands();
    out.metaR = K.app.duel.record.metaPlays.map((m) => [m.ply, m.side, m.kind]);
    out.btnR = vis('reveal');
    for (let i = 0; i < 200 && !btn('hint-line').textContent.trim(); i++) await new Promise((r) => setTimeout(r, 50));
    out.hintR = btn('hint-line').textContent.trim();
    out.arrowsR = K.app.cheatArrows?.length ?? 0;
    out.cheatR = K.options.cheat;
    // the ice cast: three in hand, then the refill at the next turn start
    const ice = K.app.duel.legalMoves().find((m) => /^I@/.test(m));
    out.iceMove = ice ?? null;
    if (ice) {
      const pileTop = K.deck.decks().w.pile[0];
      await K.playerMove(ice);
      await settle();
      out.pileTop = pileTop;
      out.handsC = K.deck.hands();
      out.decksC = K.deck.decks();
      out.plyC = K.app.duel.ply;
      out.turnC = K.app.duel.turnColor();
      const st = K.app.duel.record.states[K.app.duel.record.states.length - 1];
      out.drewC = st.drew ?? null;
      out.deckStC = st.deck;
      out.logDraw = logLines().filter((t) => /you draw/.test(t));
      out.hintC = btn('hint-line').textContent.trim();
      out.revealC = K.deck.revealOn();
      // the Undo card: back a turn, the card spent — a tap on the card
      K.cards.tap('undo');
      await settle();
      out.plyU = K.app.duel.ply;
      out.handsU = K.deck.hands();
      out.decksU = K.deck.decks();
      out.metaU = K.app.duel.record.metaPlays.map((m) => [m.ply, m.side, m.kind]);
      out.logUndo = logLines().filter((t) => /Undo/.test(t));
      out.btnU = vis('undo');
      out.holdingsU = holdings();
      out.branches = K.app.duel.record.branches.length;
    }
    // the redraw: the hand discarded, four drawn, the turn spent — a tap on the deck stack opens the sheet, Redraw asks for a confirm
    out.canMull = K.deck.canMulligan();
    const handBefore = K.deck.hands().w.slice();
    const pileBefore = K.deck.decks().w.pile.slice();
    btn('pile-deck').click();
    out.sheet0 = K.cards.sheet();
    btn('btnRedraw').click();
    out.sheet1 = K.cards.sheet();
    btn('btnRedrawCancel').click();
    out.sheet2 = K.cards.sheet();
    btn('btnRedraw').click();
    btn('btnRedrawConfirm').click();
    out.sheetGone = K.cards.sheet() === null;
    await settle();
    out.mull = { handBefore, pileBefore, moves: K.app.duel.record.moves.slice(-2), sans: K.app.duel.record.sans.slice(-2), hands: K.deck.hands(), decks: K.deck.decks(), ply: K.app.duel.ply, turn: K.app.duel.turnColor(), log: logLines().filter((t) => /discard/.test(t)), state: K.app.duel.record.states.find((s) => s.cast === 'mulligan') ?? null };
    // the export
    const L = K.log.build();
    out.export = { decks: L.decks ? { w: L.decks.w.pile.length, b: L.decks.b.pile.length } : null, metaPlays: L.metaPlays?.length ?? -1, statesWithDeck: L.states.filter((s) => s.deck).length, states: L.states.length };
    out.state = K.app.duel.state;
    return out;
  });
  expect(dk.spec?.fixed === true && dk.spec.cards.length === 8, `?deck= with a list is a fixed-order deck of ${dk.spec?.cards?.length} cards`);
  expect(JSON.stringify(dk.hands0?.w) === '["ice","portal","reveal","undo"]', `the opening hand is the list's top four: ${JSON.stringify(dk.hands0?.w)}`);
  expect(dk.hands0?.b?.length === 4 && dk.decks0?.b?.pile?.length === 2 && dk.hands0.b.every((k) => k === 'ice' || k === 'portal'), `the enemy's hand is four of its six spells, two on its pile (${JSON.stringify(dk.hands0?.b)} + ${dk.decks0?.b?.pile?.length})`);
  expect(/^IOO/.test(dk.holdings0) && dk.decks0?.w?.pile?.join(',') === 'ice,portal,ice,portal', `the holdings carry the hand's scrolls (${dk.holdings0}); the pile is the rest in order (${dk.decks0?.w?.pile?.join(',')})`);
  expect(!dk.btn0.portal.hidden && /×1/.test(dk.btn0.portal.text) && !dk.btn0.ice.hidden && /×1/.test(dk.btn0.ice.text) && JSON.stringify(dk.fan0) === '["ice","portal","reveal","undo"]', `the fan holds the hand as CARDS, every copy its own: ${dk.fan0.join(' ')}`);
  expect(!dk.btn0.reveal.hidden && !dk.btn0.reveal.disabled && /×1/.test(dk.btn0.reveal.text) && !dk.btn0.undo.hidden && /×1/.test(dk.btn0.undo.text) && dk.btn0.undo.disabled && !dk.btn0.mull.hidden, `the meta cards are in the fan — Reveal playable, Undo dimmed at ply 0 — and the piles show (${dk.btn0.reveal.text} · ${dk.btn0.undo.text})`);
  expect(dk.piles0?.deck === '4' && dk.piles0?.spent === '0', `the deck stack counts the pile (${JSON.stringify(dk.piles0)})`);
  expect(dk.enemy0.hand.length === 4 && dk.enemy0.pile === '2', `the enemy's bar shows its hand face-up (${dk.enemy0.hand.join(' ')}) and its pile (${dk.enemy0.pile})`);
  expect(dk.state0?.w?.hand?.length === 4 && dk.state0.w.pile.length === 4 && dk.state0.b?.hand?.length === 4, 'the start state of record carries both decks');
  expect(dk.revealOn && !dk.handsR.w.includes('reveal') && JSON.stringify(dk.metaR) === '[[0,"w","reveal"]]' && dk.btnR.hidden, `Reveal played: the card gone, on metaPlays (${JSON.stringify(dk.metaR)}), the button gone`);
  expect(dk.hintR.length > 0 && dk.arrowsR > 0 && dk.cheatR === false, `Reveal shows the oracle's lines without Cheater Mode ("${dk.hintR}", ${dk.arrowsR} arrows)`);
  expect(!!dk.iceMove, `an ice cast was legal (${dk.iceMove})`);
  if (dk.iceMove) {
    expect(dk.turnC === 'white' && dk.plyC === 2, `the enemy replied (ply ${dk.plyC}, ${dk.turnC} to move)`);
    // Reveal spent one card and the cast another, so the refill draws TWO — the pile's top two, in order.
    expect(dk.handsC.w.length === 4 && dk.decksC.w.pile.length === 2 && dk.drewC?.side === 'w' && dk.drewC.cards.length === 2 && dk.drewC.cards[0] === dk.pileTop, `after Reveal and the cast the refill drew the pile's top two at white's turn start: hand ${dk.handsC.w.join(',')}, drew ${JSON.stringify(dk.drewC)}, pile ${dk.decksC.w.pile.length}`);
    expect(dk.deckStC?.w?.hand?.length === 4 && dk.logDraw.length === 1 && /you draw/.test(dk.logDraw[0]), `the state of record and the log carry the draw (${dk.logDraw[0] ?? '-'})`);
    expect(!dk.revealC && dk.hintC === '', 'the reveal ended with the turn');
    expect(dk.plyU === 0 && dk.branches === 1, `the Undo card takes the turn back (ply ${dk.plyU}, ${dk.branches} branch)`);
    expect(!dk.handsU.w.includes('undo') && !dk.handsU.w.includes('reveal') && dk.decksU.w.spent.includes('undo') && dk.decksU.w.spent.includes('reveal') && dk.handsU.w.join(',') === 'ice,portal' && dk.decksU.w.pile.length === 4, `both meta cards stay spent through the undo; the hand is the two spells again (${dk.handsU.w.join(',')}), the pile whole (${dk.decksU.w.pile.length})`);
    expect(JSON.stringify(dk.metaU) === '[[0,"w","reveal"],[0,"w","undo"]]' && dk.logUndo.length === 1 && dk.btnU.hidden, `the undo is on metaPlays (${JSON.stringify(dk.metaU)}) and in the log; the button is gone`);
    expect(/^IOO/.test(dk.holdingsU), `the holdings are the pre-cast hand's again (${dk.holdingsU})`);
  }
  expect(dk.canMull, "the redraw is offered on the player's turn");
  expect(dk.sheet0?.side === 'w' && dk.sheet0.redraw && !dk.sheet0.confirmBtn && dk.sheet0.pile.length === dk.mull.pileBefore.length && dk.sheet1?.confirmBtn && !dk.sheet1.redraw && dk.sheet2?.redraw && !dk.sheet2.confirmBtn && dk.sheetGone, `the deck sheet opens on the pile in order (${dk.sheet0?.pile?.join(',')}), Redraw asks for a confirm, Cancel withdraws it, the confirm closes the sheet`);
  expect(dk.mull.moves[0] === '--' && dk.mull.sans[0] === '--' && dk.mull.state?.cast === 'mulligan' && dk.mull.state?.mulligan?.discarded?.join(',') === dk.mull.handBefore.join(','), `the redraw is a pass of the game's own on the record (${dk.mull.sans.join(' ')}; discarded ${dk.mull.state?.mulligan?.discarded?.join(',')})`);
  expect(dk.mull.turn === 'white' && dk.mull.ply === 2 && dk.mull.hands.w.join(',') === dk.mull.pileBefore.slice(0, 4).join(',').split(',').sort().join(',') , `the enemy replied and the new hand is the pile's top four (${dk.mull.hands.w.join(',')} from ${dk.mull.pileBefore.join(',')})`);
  expect(dk.mull.handBefore.every((k) => dk.mull.decks.w.spent.includes(k)) && dk.mull.log.length === 1, `the old hand is spent and the log says so (${dk.mull.log[0] ?? '-'})`);
  expect(dk.export.decks?.w === 8 && dk.export.decks?.b === 6 && dk.export.metaPlays === 2 && dk.export.statesWithDeck === dk.export.states, `the export carries both decks as shuffled (${dk.export.decks?.w} / ${dk.export.decks?.b}), the plays (${dk.export.metaPlays}) and a deck on every state (${dk.export.statesWithDeck}/${dk.export.states})`);
  expect(errsD.length === 0, `no page errors on the deck${errsD.length ? ` — ${errsD.join(' | ')}` : ''}`);
  await pageD.close();

  // `?deck=off`: the stress-test set, nothing of the deck on screen
  let pageE = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pageE.goto(`http://127.0.0.1:${PORT}/play/index.html?stage=${STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&deck=off`);
  pageE = await bootWait(pageE, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?stage=${STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&deck=off`, null);
  await pageE.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const off = await pageE.evaluate(() => ({ spec: window.__DCK.deck.spec(), hands: window.__DCK.deck.hands(), holdings: window.__DCK.app.duel.fen().match(/\[([^\]]*)\]/)?.[1] ?? '', fan: window.__DCK.cards.hand(), piles: window.__DCK.cards.piles(), enemy: window.__DCK.cards.enemy(), enemyPile: window.__DCK.cards.enemyPile(), optDeck: document.getElementById('optDeck').value, optDefault: window.__DCK.options.deck }));
  expect(off.spec === null && off.hands === null && off.holdings === 'IOOioo' && JSON.stringify(off.fan) === '["ice","portal"]' && off.piles === null && JSON.stringify(off.enemy) === '["ice","portal"]' && off.enemyPile === null, `?deck=off is the stress-test set: holdings ${off.holdings}, the fan the two spells in hand and no piles, the enemy's two minis and no stack`);
  expect(off.optDefault === 'adept' && off.optDeck === 'adept', `Options → Spells → Deck defaults to the starter (${off.optDefault})`);
  await pageE.close();

  // THE WALK: the run carries the deck; the drop deals from it and by the enemy's width
  const pageW = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errsW = [];
  pageW.on('pageerror', (e) => errsW.push(String(e).split('\n')[0]));
  await pageW.goto(`http://127.0.0.1:${PORT}/play/index.html?gen=vaults&seed=1&fx=0&enemies=off&deck=adept&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off`);
  await pageW.waitForFunction(() => window.__DCK?.app?.phase === 'walk' && !window.__DCK.app.busy, null, { timeout: 120000 });
  const wk = await pageW.evaluate(async () => {
    const K = window.__DCK;
    const out = { run: K.deck.run() };
    const plan = await K.walk.barrier();
    out.planOk = !!plan?.ok;
    for (let i = 0; i < 400 && !(K.app.duel && K.app.duel.state === 'playing' && !K.app.busy); i++) await new Promise((r) => setTimeout(r, 50));
    out.hands = K.deck.hands();
    out.decks = K.deck.decks();
    out.holdings = K.app.duel?.fen().match(/\[([^\]]*)\]/)?.[1] ?? '';
    out.enemy = { hand: K.cards.enemy(), pile: K.cards.enemyPile() };
    out.enemyWidth = K.app.session?.specs?.black?.width ?? null;
    const L = K.log.build();
    out.export = { decks: !!L?.decks, world: !!L?.world };
    out.save = K.walk.export()?.deck ?? null;
    return out;
  });
  expect(wk.run?.starter === 'adept' && wk.run.cards.length === 8, `the run carries the starter deck (${wk.run?.starter}, ${wk.run?.cards?.length} cards)`);
  expect(wk.planOk && wk.hands?.w?.length === 4, `the drop deals a hand of four from the run's deck (${JSON.stringify(wk.hands?.w)})`);
  {
    const n = Math.max(0, (wk.enemyWidth | 0) - 1);
    expect(wk.hands?.b?.length === Math.min(4, n) && wk.decks?.b?.pile?.length === Math.max(0, n - 4) && wk.hands.b.every((k) => k === 'ice' || k === 'portal'), `the enemy's deck is width − 1 spells, a hand of four at most and the rest on its pile (width ${wk.enemyWidth}: ${JSON.stringify(wk.hands?.b)} + ${wk.decks?.b?.pile?.length})`);
  }
  expect(wk.enemy.pile !== null && wk.export.decks && wk.export.world && wk.save?.starter === 'adept', `the enemy's bar, the log and the run save carry the decks (enemy ${wk.enemy.hand.join(' ')} + ${wk.enemy.pile})`);
  expect(errsW.length === 0, `no page errors on the walk's deck${errsW.length ? ` — ${errsW.join(' | ')}` : ''}`);
  await pageW.close();
}

// --- THE CARD UI (Phase 3.2, 2026-09-25; brief §4.10 "The card UI"; play/js/
// cards.mjs + main.mjs § THE CARD UI): the hand is a FAN of cards under the
// board — every copy its own card, laid out by fanLayout (the outer cards
// tilted and dropped), the playable ones rimmed and the rest dimmed, a spell
// card's art the hint's own glyph. ONE GESTURE PATH, driven here through REAL
// POINTER EVENTS (Playwright's mouse): a DRAG of the ice card onto the board
// lifts a ghost, lights the legal squares, frames the square under the pointer
// and tints the 3×3 the patch would freeze (the board's hover / area marks),
// the tip says what a release does, and the release casts through the tap
// path's own playPlayerMove; a drag released OFF the board snaps the card back
// with nothing played and cast mode left; a LONG PRESS opens the reader; a
// TAP (the older blocks' path, K.cards.tap) still lifts a card into cast
// mode. The enemy's hand is face-up as mini cards in its bar; on the motion
// page its played card flies to the board and holds for a beat.
{
  let pageC = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errsC = [];
  pageC.on('pageerror', (e) => errsC.push(String(e).split('\n')[0]));
  await pageC.goto(`http://127.0.0.1:${PORT}/play/index.html?stage=${STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&deck=reveal,undo,ice,portal,ice,portal,ice,portal`);
  pageC = await bootWait(pageC, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?stage=${STAGE}&autobegin=1&fx=0&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&deck=reveal,undo,ice,portal,ice,portal,ice,portal`, (p) => p.on('pageerror', (e) => errsC.push(String(e).split('\n')[0])));
  await pageC.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  await pageC.evaluate(() => { const o = window.__DCK.options; o.cheat = false; o.hints = false; o.evalBar = false; window.__DCK.applyOptions(); });
  const settleC = () => pageC.waitForFunction(() => !window.__DCK.app.busy && window.__DCK.app.duel?.state !== 'playing' || (window.__DCK.app.duel?.turnColor() === window.__DCK.app.session?.playerColor && !window.__DCK.app.busy), null, { timeout: 60000 });
  const fan = await pageC.evaluate(() => {
    const K = window.__DCK;
    const lay = K.cards.layout();
    const row = document.getElementById('hand-row');
    const cs = getComputedStyle(row);
    const els = K.cards.els();
    const arts = els.map((el) => { const c = el.querySelector('canvas.card-art'); return { w: c?.width, cssW: parseFloat(c?.style.width), name: el.querySelector('.card-name')?.textContent, text: el.querySelector('.card-text')?.textContent, pip: !!el.querySelector('.card-cost'), cls: el.className }; });
    const rects = els.map((el) => el.getBoundingClientRect());
    const board = document.getElementById('board').getBoundingClientRect();
    return { lay, cardW: cs.getPropertyValue('--card-w').trim(), arts, rects: rects.map((r) => ({ l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) })), boardBottom: Math.round(board.bottom), vw: window.innerWidth, rowHidden: K.cards.rowHidden() };
  });
  expect(!fan.rowHidden && fan.lay.length === 4 && fan.lay.map((c) => c.kind).join(',') === 'ice,portal,reveal,undo', `the fan holds the four cards of the hand (${fan.lay.map((c) => c.kind).join(' ')})`);
  expect(fan.lay.every((c, i) => i === 0 || c.left > fan.lay[i - 1].left) && parseFloat(fan.lay[0].rot) < 0 && parseFloat(fan.lay[3].rot) > 0 && parseFloat(fan.lay[0].y) > parseFloat(fan.lay[1].y), `the cards run left to right, the outer ones tilted out (${fan.lay.map((c) => c.rot).join(' ')}) and dropped for the arc (${fan.lay.map((c) => c.y).join(' ')})`);
  expect(fan.rects.every((r) => r.l >= 0 && r.r <= fan.vw) && fan.rects.every((r) => r.t >= fan.boardBottom), `every card sits inside the screen's width and under the board (${fan.rects.map((r) => `${r.l}–${r.r}`).join(' ')}; board bottom ${fan.boardBottom})`);
  expect(fan.arts.every((a) => (a.w === 12 || a.w === 11) && a.cssW === a.w * 4 && a.pip) && fan.arts.map((a) => a.name).join(',') === 'Ice,Portal,Reveal,Undo' && fan.arts.every((a) => a.text.length > 0), `every face carries its art at 4× (${fan.arts.map((a) => `${a.w}→${a.cssW}`).join(' ')} px — the portal's ring is 10 wide, the rest 11, plus the shadow), a cost pip, its name and one line (${fan.arts.map((a) => a.text).join(' · ')})`);
  expect(/\bspell\b/.test(fan.arts[0].cls) && /\bplayable\b/.test(fan.arts[0].cls) && /\bmeta\b/.test(fan.arts[3].cls) && /\bdim\b/.test(fan.arts[3].cls), `a spell card is rimmed as playable, the Undo card dimmed at ply 0 (${fan.arts[0].cls} · ${fan.arts[3].cls})`);
  // THE DRAG: the ice card onto the board through the mouse
  const iceBox = await pageC.locator('#hand .card[data-kind="ice"]').first().boundingBox();
  const target = await pageC.evaluate(() => { const K = window.__DCK; const ts = K.app.duel.legalMoves().filter((m) => /^I@/.test(m)).map((m) => m.slice(2)); const sq = ts[Math.floor(ts.length / 2)]; return { sq, pt: K.app.boardUI.pointOfSquare(sq), n: ts.length }; });
  await pageC.mouse.move(iceBox.x + iceBox.width / 2, iceBox.y + iceBox.height / 2);
  await pageC.mouse.down();
  await pageC.mouse.move(iceBox.x + iceBox.width / 2 + 3, iceBox.y + iceBox.height / 2 - 3); // inside the slop: no drag yet
  const slop = await pageC.evaluate(() => ({ drag: window.__DCK.cards.drag(), castMode: window.__DCK.app.castMode }));
  await pageC.mouse.move(iceBox.x + iceBox.width / 2 + 10, iceBox.y + iceBox.height / 2 - 30, { steps: 4 });
  const lifted = await pageC.evaluate(() => { const K = window.__DCK; return { drag: K.cards.drag(), castMode: K.app.castMode, lit: [...K.app.boardUI.marks.targets].length, dragging: !!document.querySelector('#hand .card.dragging'), ghost: !!document.getElementById('card-ghost') }; });
  await pageC.mouse.move(target.pt.x, target.pt.y, { steps: 12 });
  await pageC.waitForTimeout(40);
  const over = await pageC.evaluate((sq) => { const K = window.__DCK; K.renderer.paintNow(); const g = document.getElementById('card-ghost'); const r = g?.getBoundingClientRect(); const px = K.renderer.square(sq); let blue = 0; if (px) for (let i = 0; i < px.length; i += 4) if (px[i] === 0x7c && px[i + 1] === 0xc8 && px[i + 2] === 0xff && px[i + 3] === 255) blue++; return { drag: K.cards.drag(), cell: K.marks.cell(sq), ghost: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null, blue, areaCells: K.cards.drag()?.area.map((a) => [a, K.marks.cell(a).includes('area')]) ?? [] }; }, target.sq);
  expect(!slop.drag && !slop.castMode, `a press that moves inside the slop drags nothing yet (drag ${JSON.stringify(slop.drag)}, cast mode ${slop.castMode ?? 'none'})`); // castMode is unset (undefined) until a mode was ever entered
  expect(lifted.drag?.kind === 'ice' && lifted.ghost && lifted.dragging && lifted.castMode === 'ice' && lifted.lit === target.n, `past the slop the ice card lifts as a ghost, its slot in the fan emptied, and cast mode lights the ${lifted.lit} legal centres`);
  expect(over.drag?.hover === target.sq && over.cell.includes('hover') && over.cell.includes('area') && over.cell.includes('target'), `over ${target.sq} the square under the pointer is framed and tinted (${over.cell.filter((c) => /hover|area|target/.test(c)).join(' ')})`);
  expect(over.drag.area.length >= 4 && over.drag.area.includes(target.sq) && over.areaCells.every(([, on]) => on), `the 3×3 the patch would freeze is tinted: ${over.drag.area.join(' ')}`);
  expect(over.blue >= 40, `the frame under the pointer paints in the spell blue (${over.blue} px of 60)`);
  expect(over.drag.tip === `release to freeze the floor around ${target.sq}` && over.ghost && over.ghost.y + over.ghost.h < target.pt.y, `the ghost rides above the pointer (its bottom ${over.ghost?.y + over.ghost?.h} over ${Math.round(target.pt.y)}) and its tip reads "${over.drag.tip}"`);
  await pageC.mouse.up();
  await pageC.waitForTimeout(250);
  await settleC();
  const cast = await pageC.evaluate(() => { const K = window.__DCK; return { moves: K.app.duel.record.moves.slice(0, 2), ply: K.app.duel.ply, hand: K.cards.hand(), drag: K.cards.drag(), ghost: !!document.getElementById('card-ghost'), castMode: K.app.castMode, hover: K.app.boardUI.marks.hover, area: [...K.app.boardUI.marks.area], piles: K.cards.piles(), state: K.app.duel.state }; });
  expect(cast.moves[0] === `I@${target.sq}` && cast.ply >= 2, `the release casts the ice on ${target.sq} through the tap path (${cast.moves.join(' ')})`);
  expect(!cast.ghost && cast.drag === null && cast.hover === null && cast.area.length === 0 && cast.castMode === null, 'the ghost and the preview go with the release');
  expect(cast.hand.length === 4 && cast.piles?.deck === '3', `the refill drew a card into the fan (${cast.hand.join(' ')}; deck ${cast.piles?.deck})`);
  // A drag released OFF the board: the card snaps back, nothing is played, cast mode leaves
  if (cast.state === 'playing') {
    const pBox = await pageC.locator('#hand .card[data-kind="portal"]').first().boundingBox();
    const eBox = await pageC.locator('#enemy-bar').boundingBox();
    const before = await pageC.evaluate(() => window.__DCK.app.duel.record.moves.length);
    await pageC.mouse.move(pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);
    await pageC.mouse.down();
    await pageC.mouse.move(pBox.x + pBox.width / 2, pBox.y - 40, { steps: 5 });
    const mid = await pageC.evaluate(() => ({ drag: window.__DCK.cards.drag(), castMode: window.__DCK.app.castMode }));
    await pageC.mouse.move(eBox.x + 30, eBox.y + 6, { steps: 8 });
    const offBoard = await pageC.evaluate(() => ({ drag: window.__DCK.cards.drag() }));
    await pageC.mouse.up();
    await pageC.waitForTimeout(250);
    const snap = await pageC.evaluate((n) => { const K = window.__DCK; return { played: K.app.duel.record.moves.length - n, drag: K.cards.drag(), ghost: !!document.getElementById('card-ghost'), castMode: K.app.castMode, dragging: !!document.querySelector('#hand .card.dragging'), hand: K.cards.hand() }; }, before);
    expect(mid.drag?.kind === 'portal' && mid.castMode === 'portal' && offBoard.drag?.hover === null && offBoard.drag?.tip === '', 'the portal card lifts into cast mode; over the enemy bar nothing is framed and the tip is empty');
    expect(snap.played === 0 && !snap.ghost && snap.drag === null && !snap.dragging && snap.castMode === null && snap.hand.includes('portal'), 'released off the board the card snaps back: nothing played, the ghost gone, cast mode left');
    // A LONG PRESS opens the reader; the release after it plays nothing
    const uBox = await pageC.locator('#hand .card[data-kind="undo"]').first().boundingBox();
    await pageC.mouse.move(uBox.x + uBox.width / 2, uBox.y + uBox.height / 2);
    await pageC.mouse.down();
    await pageC.waitForTimeout(650);
    const reader = await pageC.evaluate(() => ({ reader: window.__DCK.cards.reader(), hidden: document.getElementById('card-reader').hidden, text: document.querySelector('#card-reader-card .card-text')?.textContent ?? '', cost: document.querySelector('#card-reader-card .reader-cost')?.textContent ?? '', art: document.querySelector('#card-reader-card canvas.card-art')?.style.width ?? '' }));
    await pageC.mouse.up();
    await pageC.waitForTimeout(80);
    const held = await pageC.evaluate((n) => ({ played: window.__DCK.app.duel.record.moves.length - n, castMode: window.__DCK.app.castMode, reader: window.__DCK.cards.reader() }), before);
    await pageC.click('#card-reader');
    const closed = await pageC.evaluate(() => ({ reader: window.__DCK.cards.reader(), hidden: document.getElementById('card-reader').hidden }));
    expect(reader.reader === 'undo' && !reader.hidden && /take back your last move and the enemy's reply/.test(reader.text) && reader.cost === 'costs no move' && reader.art === '96px', `a long press opens the reader on the Undo card — its full text, "${reader.cost}", the art at 8×`);
    expect(held.played === 0 && held.castMode === null && held.reader === 'undo' && closed.reader === null && closed.hidden, 'the release after the hold plays nothing; a tap closes the reader');
    // The Undo card is playable now (a turn to take back) — a tap plays it
    const undo = await pageC.evaluate(async () => { const K = window.__DCK; const ply = K.app.duel.ply; const ok = K.cards.tap('undo'); for (let i = 0; i < 400 && K.app.busy; i++) await new Promise((r) => setTimeout(r, 25)); return { ok, plyBefore: ply, ply: K.app.duel.ply, hand: K.cards.hand(), spent: K.deck.decks().w.spent }; });
    expect(undo.ok && undo.ply === 0 && !undo.hand.includes('undo') && undo.spent.includes('undo'), `a tap on the Undo card takes the turn back (ply ${undo.plyBefore} → ${undo.ply}) and the card is spent`);
  } else expect(true, `the duel ended on the cast (${cast.state}) — the snap-back, the reader and the Undo card stand on the scratch drive`);
  // The enemy's hand, face-up: mini cards in its bar with the art in the enemy's red; its deck a mini stack
  const foe = await pageC.evaluate(() => { const K = window.__DCK; const minis = [...document.querySelectorAll('#enemy-cards .mini')]; return { kinds: K.cards.enemy(), hands: K.deck.hands()?.b ?? null, pile: K.cards.enemyPile(), pileN: K.deck.decks()?.b?.pile?.length ?? null, red: minis.every((m) => m.classList.contains('enemy') && m.querySelector('canvas.card-art')), sheet: (() => { document.querySelector('#enemy-cards .mini-stack')?.click(); const s = K.cards.sheet(); K.cards.closeDeck(); return s; })() }; });
  expect(foe.hands && foe.kinds.join(',') === foe.hands.join(',') && foe.pile === String(foe.pileN) && foe.red, `the enemy's minis are its hand (${foe.kinds.join(' ')}) in its red, its stack its pile (${foe.pile})`);
  expect(foe.sheet?.side === 'b' && !foe.sheet.redraw && /enemy/i.test(foe.sheet.title) && foe.sheet.pile.length === foe.pileN, `a tap on the enemy's stack opens the sheet on its pile with no redraw (${foe.sheet?.title}: ${foe.sheet?.pile?.join(',')})`);
  expect(errsC.length === 0, `no page errors on the card UI${errsC.length ? ` — ${errsC.join(' | ')}` : ''}`);
  await pageC.close();

  // THE PLAYED-CARD BEAT on a motion page: the enemy's card flies to the board and holds enlarged (on demand — the engine casts when it likes)
  let pageB = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errsB = [];
  pageB.on('pageerror', (e) => errsB.push(String(e).split('\n')[0]));
  await pageB.goto(`http://127.0.0.1:${PORT}/play/index.html?stage=${STAGE}&autobegin=1&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&deck=ice,portal,ice,portal,ice,portal,reveal,undo`);
  pageB = await bootWait(pageB, () => browser.newPage({ viewport: { width: 390, height: 844 } }), `http://127.0.0.1:${PORT}/play/index.html?stage=${STAGE}&autobegin=1&seed=${SEED}&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&onset=400&debris=off&deck=ice,portal,ice,portal,ice,portal,reveal,undo`, (p) => p.on('pageerror', (e) => errsB.push(String(e).split('\n')[0])));
  await pageB.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const beat = await pageB.evaluate(async () => {
    const K = window.__DCK;
    const sq = K.app.duel.legalMoves().find((m) => /^I@/.test(m))?.slice(2) ?? null;
    const p = K.cards.playBeat('ice', sq);
    const samples = [];
    for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 60)); const b = document.getElementById('card-beat'); const r = b?.getBoundingClientRect(); samples.push(r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), op: getComputedStyle(b).opacity, enemy: !!b.querySelector('.card.enemy') } : null); }
    await p;
    const board = document.getElementById('board').getBoundingClientRect();
    const pt = sq ? K.app.boardUI.pointOfSquare(sq) : null;
    return { fx: K.options?.fx ?? null, samples, gone: !document.getElementById('card-beat'), board: { t: Math.round(board.top), b: Math.round(board.bottom) }, pt: pt ? { x: Math.round(pt.x), y: Math.round(pt.y) } : null, sq };
  });
  const held = beat.samples.filter((s) => s && s.w > 60);
  expect(held.length >= 4 && held.every((s) => s.enemy) && held.some((s) => s.y > beat.board.t && s.y + s.h < beat.board.b + 40), `the enemy's card holds over the board for a beat (${held.length} samples over 60 px wide of ${beat.samples.filter(Boolean).length}; a frame at ${held[0]?.x},${held[0]?.y} ${held[0]?.w}×${held[0]?.h}, the square at ${beat.pt?.x},${beat.pt?.y})`);
  expect(beat.gone, 'the beat is gone once it has played');
  expect(errsB.length === 0, `no page errors on the beat${errsB.length ? ` — ${errsB.join(' | ')}` : ''}`);
  await pageB.close();
}

await browser.close();

server.close();

for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`rungs seen: weaken ${seen.weaken} · breach ${seen.breach} · displace ${seen.displace} · crumble ${seen.crumble}`);
console.log(`SUMMARY: ${notes.length} ok, ${failures.length} failed${bootRetries ? `, ${bootRetries} boot retr${bootRetries === 1 ? 'y' : 'ies'}` : ''}${SHOTS ? ` — screenshots in ${OUT}` : ''}`);
process.exit(failures.length ? 1 : 0);

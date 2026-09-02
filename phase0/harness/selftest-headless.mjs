// Run play/selftest.html in headless Chromium and exit 0 iff every check
// passes — the browser half of the rule-16 gate, scripted (Node exercises
// neither SharedArrayBuffer nor the pthread path, so this is the only
// automated way to prove a Director/engine change in a REAL browser).
//
// Serves the repo root with COOP/COEP headers so SharedArrayBuffer is live
// without the service worker, loads the page, and polls the
// `window.__SELFTEST.done` flag selftest.mjs sets for exactly this purpose.
//
// Setup (once): cd phase0 && npm i --no-save playwright
//   Chromium: the web environment ships one at /opt/pw-browsers/chromium
//   (used automatically); elsewhere `npx playwright install chromium` or
//   point CHROMIUM at a binary.
// Usage: cd phase0 && node harness/selftest-headless.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8931;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.ini': 'text/plain' };

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

const executablePath = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${PORT}/play/selftest.html`);
await page.waitForFunction(() => window.__SELFTEST?.done, null, { timeout: 300000 });
const s = await page.evaluate(() => window.__SELFTEST);
for (const l of s.lines) console.log(l);
console.log(`SUMMARY: ${s.passed} passed, ${s.failed} failed`);
await browser.close();
server.close();
process.exit(s.failed === 0 ? 0 : 1);

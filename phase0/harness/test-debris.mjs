// THE DEBRIS LAYER's Node gate (2026-09-07): play/js/debris.mjs (the
// ledger, the transform, the chunks, the painter), play/js/pngmini.mjs
// (the deterministic PNG) and the ruin tiles' chip strip. No DOM, no
// engine. Usage: cd phase0 && node harness/test-debris.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decodePng } from '../lib/png.mjs';
import * as D from '../../play/js/debris.mjs';
import { encodePng, pngDataUrl, base64 } from '../../play/js/pngmini.mjs';
import { run as stripCheck } from './strip-ruin-chips.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];
const notes = [];
const expect = (ok, what) => (ok ? notes.push(`ok  ${what}`) : failures.push(what));
const T = D.T;

// --- the transform: arena ↔ env under flip, crop and auto-crop ---------------
{
  const base = { files: 10, ranks: 10 };
  const deals = [
    { flip: false, cropTop: 0, cropBottom: 0, autoCrop: { top: 0, bottom: 0 }, files: 10, ranks: 10 },
    { flip: true, cropTop: 0, cropBottom: 0, autoCrop: { top: 0, bottom: 0 }, files: 10, ranks: 10 },
    { flip: false, cropTop: 1, cropBottom: 2, autoCrop: { top: 1, bottom: 0 }, files: 10, ranks: 6 },
    { flip: true, cropTop: 2, cropBottom: 1, autoCrop: { top: 0, bottom: 1 }, files: 10, ranks: 6 },
  ];
  for (const deal of deals) {
    const tx = D.envTransform(deal, base);
    let ok = true, seen = new Set();
    for (let r = 1; r <= deal.ranks && ok; r++) for (let f = 0; f < 10; f++) {
      const sq = String.fromCharCode(97 + f) + r;
      const { ef, er } = D.toEnvCell(tx, sq);
      if (ef < 0 || ef >= 10 || er < 0 || er >= 10) { ok = false; break; }
      const key = ef * 100 + er;
      if (seen.has(key)) { ok = false; break; }
      seen.add(key);
      if (D.fromEnvCell(tx, ef, er) !== sq) { ok = false; break; }
      const px = D.toEnvPx(tx, sq, 3, 5);
      const back = D.toArenaPx(tx, px.x, px.y);
      if (!back || back.sq !== sq || back.x !== f * T + 3 || back.y !== (deal.ranks - r) * T + 5) { ok = false; break; }
    }
    expect(ok, `transform round-trips every arena square (flip ${deal.flip}, crop ${deal.cropTop}t/${deal.cropBottom}b + auto ${deal.autoCrop.top}t/${deal.autoCrop.bottom}b)`);
    // Outside the arena is null, not a wrong square.
    const outside = deal.ranks < 10 ? D.fromEnvCell(tx, 0, deal.flip ? 9 - (deal.cropBottom + deal.autoCrop.bottom - 1) : 0) : null;
    if (deal.ranks < 10) expect(outside === null, 'a cropped-away env cell maps to no arena square');
  }
  const tx = D.envTransform(deals[0], base), txf = D.envTransform(deals[1], base);
  expect(D.toEnvCell(tx, 'a1').er === 0 && D.toEnvCell(tx, 'a10').er === 9, 'unflipped: arena rank 1 is env rank 0');
  expect(D.toEnvCell(txf, 'a1').er === 9 && D.toEnvCell(txf, 'a10').er === 0, 'flipped: arena rank 1 is env rank 9');
  expect(D.envDir(txf, 1, 1).dy === -1 && D.envDir(tx, 1, 1).dy === 1, 'a direction flips its dy under a flipped stage');
  expect(D.toEnvPx(tx, 'a10', 0, 0).y === 0 && D.toEnvPx(tx, 'a1', 0, 0).y === 9 * T, 'env pixel rows run from the top of the stage');
}

// --- the ledger: add, buckets, cap, undo, traffic, serialize ------------------
{
  const L = new D.DebrisLedger({ id: 'test', files: 10, ranks: 10 });
  L.beginEpoch();
  const ev = L.add({ k: 'smash', x: 5 * T + 8, y: 4 * T + 8, dx: 1, dy: 0, p: 3, s: 1, src: { role: 'crate', v: 2, mask: -1 } });
  expect(ev.id === 1 && ev.e === 1 && ev.m === 'wood', 'an event gets an id, the epoch and its material from the role');
  expect(L.eventsAt(5, 5).length === 1 && L.eventsAt(6, 5).length === 1 && L.eventsAt(9, 9).length === 0, 'a smash is bucketed on its cell and its neighbours only');
  expect((() => { try { L.add({ k: 'nope', x: 0, y: 0 }); return false; } catch { return true; } })(), 'an unknown kind throws');
  for (let i = 0; i < 20; i++) L.add({ k: 'kill', x: 5 * T + 8, y: 4 * T + 8, dx: 0, dy: 1, p: 4 + i, s: i });
  expect(L.eventsAt(5, 5).length === D.CELL_CAP, `a cell keeps at most CELL_CAP events (${L.eventsAt(5, 5).length})`);
  expect(L.eventsAt(5, 5)[0].id > 1, 'the oldest event was evicted from a full cell');
  const before = L.events.length;
  const dropped = L.dropAfter(10);
  expect(dropped > 0 && L.events.every((e) => e.p <= 10) && L.events.length === before - dropped, `undo drops this epoch's events past the ply (${dropped})`);
  L.visit(2, 2);
  L.visit(2, 2, 5);
  expect(L.trafficAt(2, 2) === 6 && D.wearLevel(6) === 1 && D.wearLevel(5) === 0 && D.wearLevel(40) === 3, 'traffic counts and the wear thresholds');
  L.resetEpochTraffic();
  expect(L.trafficAt(2, 2) === 0, 'an undo can recount the epoch\'s traffic from nothing');
  L.visit(2, 2, 7);
  const json = JSON.stringify(L.serialize());
  const M = D.DebrisLedger.load(JSON.parse(json));
  expect(M.events.length === L.events.length && M.epoch === 1 && M.trafficAt(2, 2) === 7 && M.eventsAt(5, 5).length === L.eventsAt(5, 5).length, `serialize → load keeps events, epoch, traffic and buckets (${json.length} B)`);
  M.beginEpoch();
  expect(M.epoch === 2 && M.trafficAt(2, 2) === 7 && M.trafficEpoch.size === 0, 'a new epoch settles the traffic');
  const skid = L.add({ k: 'skid', x: 1 * T + 8, y: 8 * T + 8, x2: 4 * T + 8, y2: 5 * T + 8, p: 11, s: 9 });
  expect(L.eventsAt(1, 1).some((e) => e.id === skid.id) && L.eventsAt(4, 4).some((e) => e.id === skid.id) && L.eventsAt(2, 2).some((e) => e.id === skid.id), 'a skid is bucketed along its whole path');
  L.clear();
  expect(L.events.length === 0 && L.buckets.size === 0 && L.trafficAt(2, 2) === 0, 'clear() forgets everything');
}

// --- the chunks and the painter ---------------------------------------------
{
  const sprite = { w: 16, h: 16, data: new Uint8Array(16 * 16 * 4) };
  for (let i = 0; i < 256; i++) { sprite.data[i * 4] = 200; sprite.data[i * 4 + 1] = 120 + (i % 7) * 10; sprite.data[i * 4 + 2] = 40; sprite.data[i * 4 + 3] = 255; }
  const sprites = { get: (name) => (name === '--sprite-crate-2' ? sprite : null) };
  const L = new D.DebrisLedger({ id: 't', files: 10, ranks: 10 });
  L.beginEpoch();
  const ev = L.add({ k: 'smash', x: 5 * T + 8, y: 4 * T + 8, dx: 1, dy: 0, p: 1, s: 1, src: { role: 'crate', v: 2, mask: -1 } });
  const a = D.chunksOf(ev, sprites, { intensity: 1, epoch: 1, ply: 1 });
  const b = D.chunksOf(ev, sprites, { intensity: 1, epoch: 1, ply: 1 });
  expect(a.length === D.MATERIALS.wood.n && JSON.stringify(a.map((c) => [c.x, c.y, c.w, c.h, [...c.px]])) === JSON.stringify(b.map((c) => [c.x, c.y, c.w, c.h, [...c.px]])), `chunks are deterministic (${a.length} wood chunks)`);
  expect(a.every((c) => c.px[0] === 200 && c.px[2] === 40), 'chunks are sampled from the sprite\'s own pixels');
  expect(a.every((c) => c.x + c.w / 2 >= ev.x - 4), 'a cone away from the attacker throws nothing back at it');
  expect(a.filter((c) => c.sz >= 3).every((c) => Math.hypot(c.x + c.w / 2 - ev.x, c.y + c.h / 2 - ev.y) <= D.MATERIALS.wood.reach * 0.6 + 2), 'big chunks land near, flecks far');
  const c2 = D.chunksOf(ev, { get: () => null }, { intensity: 1, epoch: 1, ply: 1 });
  expect(c2.length === a.length && c2.every((c) => c.px[3] === 255), 'without a sprite the material palette stands in');
  expect(D.chunksOf(ev, sprites, { intensity: 2, epoch: 1, ply: 1 }).length === 2 * D.MATERIALS.wood.n, 'intensity scales the count');
  const aged = D.chunksOf(ev, sprites, { intensity: 1, epoch: 2, ply: 1 });
  expect(aged.length < a.length && aged.every((c) => c.sz >= 2), 'after an epoch the 1-px flecks have settled');
  const old = D.chunksOf(ev, sprites, { intensity: 1, epoch: 5, ply: 1 });
  expect(old.every((c) => c.sz >= 3) && old.length < aged.length, 'after three epochs only the big chunks remain');
  // Blood: a pool, droplets, drying.
  const kill = L.add({ k: 'kill', x: 2 * T + 8, y: 2 * T + 8, dx: 0, dy: -1, p: 2, s: 2 });
  const fresh = D.chunksOf(kill, sprites, { intensity: 1, epoch: 1, ply: 5 });
  const dried = D.chunksOf(kill, sprites, { intensity: 1, epoch: 1, ply: 2 + D.DRY_PLIES });
  const isRed = (c) => c.px[0] > 100 && c.px[1] < 60;
  expect(fresh.some((c) => c.pool) && fresh.filter((c) => !c.pool).length >= D.MATERIALS.blood.n && fresh.every(isRed), `blood: a pool and droplets, red while fresh (${fresh.length} px)`);
  expect(dried.length === fresh.length && dried.every((c) => c.px[0] < 120), 'blood dries to maroon after DRY_PLIES');
  expect(D.chunksOf(kill, sprites, { intensity: 1, epoch: 2, ply: 3 }).every((c) => c.px[0] < 120), 'blood is dry by the next epoch');
  // Weaken: chips on the floor to the south.
  const weak = L.add({ k: 'weaken', x: 3 * T + 8, y: 3 * T + 8, p: 3, s: 3, src: { role: 'wall', v: 0, mask: 10 } });
  const chips = D.chunksOf(weak, sprites, { intensity: 1, epoch: 1, ply: 3 });
  expect(chips.length >= 1 && chips.every((c) => c.y > weak.y + T / 2 && c.y < weak.y + T + T / 2), 'a weaken drops its chips onto the square south of the wall');
  // Skid: a scuff along the line, denser at the landing.
  const skid = L.add({ k: 'skid', x: 1 * T + 8, y: 8 * T + 8, x2: 4 * T + 8, y2: 5 * T + 8, p: 4, s: 4 });
  const scuff = D.chunksOf(skid, sprites, { intensity: 1, epoch: 1, ply: 4 });
  const late = scuff.filter((c) => c.t > 0.7), early = scuff.filter((c) => c.t <= 0.7);
  expect(scuff.length > 10 && scuff.every((c) => c.px[3] < 255) && late.length / 0.3 > early.length / 0.7, `a skid is translucent and denser at the landing (${early.length} + ${late.length} px)`);
  // The shatter: every opaque 2×2 block of the sprite, flying and fading.
  const eph = D.shatterOf(ev, sprite, { intensity: 1 });
  expect(eph.length === 64 && eph.every((c) => c.eph && c.fade > 0 && c.t >= 0.5), `the shatter cuts a 16×16 sprite into 64 flying blocks`);
  const implode = D.shatterOf(ev, sprite, { intensity: 1, inward: true });
  expect(implode.every((c) => Math.abs(c.tx - ev.x) <= 3 && Math.abs(c.ty - ev.y) <= 3), 'an inward shatter falls into the pit');
  // The painter.
  const ctx = { sprites, intensity: 1, epoch: 1, ply: 5 };
  const buf = D.paintCell(L, 5, 5, ctx);
  const buf2 = D.paintCell(L, 5, 5, ctx);
  expect(buf && buf.length === T * T * 4 && Buffer.from(buf).equals(Buffer.from(buf2)), 'a cell paints deterministically');
  const opaque = (b) => { let n = 0; for (let i = 3; i < b.length; i += 4) if (b[i] === 255) n++; return n; };
  expect(opaque(buf) > 0 && opaque(buf) <= D.PIXEL_CAP, `the smash's origin cell carries ${opaque(buf)} opaque px (≤ PIXEL_CAP ${D.PIXEL_CAP})`);
  expect(D.paintCell(L, 9, 9, ctx) === null, 'a clean cell paints null');
  expect(D.paintCell(L, 5, 5, { ...ctx, toggles: { destruction: false } }) === null, 'the destruction toggle hides the smash');
  expect(D.paintCell(L, 5, 5, { ...ctx, pending: new Set([ev.id]) }) === null, 'an event in flight is not painted yet');
  expect(D.paintCell(L, 5, 5, { ...ctx, isFloor: () => false }) === null, 'debris paints on floor only');
  // The cap: many events on one cell stay under it, newest on top.
  for (let i = 0; i < 10; i++) L.add({ k: 'smash', x: 7 * T + 8, y: 7 * T + 8, dx: 0, dy: 0, p: 10 + i, s: 20 + i, src: { role: 'crate', v: 2, mask: -1 } });
  const crowded = D.paintCell(L, 7, 2, ctx);
  expect(crowded && opaque(crowded) <= D.PIXEL_CAP, `a crowded cell stays under the cap (${opaque(crowded)})`);
  // Wear.
  L.visit(8, 8, 50);
  const worn = D.paintCell(L, 8, 8, ctx);
  expect(worn && [...worn].filter((v, i) => i % 4 === 3 && v > 0 && v < 255).length >= 30, 'a worn cell wears translucent scuff pixels');
  expect(D.paintCell(L, 8, 8, { ...ctx, toggles: { wear: false } }) === null, 'the wear toggle hides it');
  // Blit clipping.
  const win = new Uint8ClampedArray(T * T * 4);
  D.blitChunk(win, { x: 14, y: 14, w: 3, h: 3, px: new Uint8Array(36).fill(255) }, 0, 0);
  expect(win[(15 * T + 15) * 4 + 3] === 255 && win.filter((v, i) => i % 4 === 3 && v).length === 4, 'a chunk is clipped to the cell window');
}

// --- the PNG ----------------------------------------------------------------
{
  const buf = new Uint8ClampedArray(T * T * 4);
  for (let i = 0; i < T * T; i++) { buf[i * 4] = i; buf[i * 4 + 1] = 255 - i; buf[i * 4 + 2] = (i * 7) & 255; buf[i * 4 + 3] = i % 3 ? 255 : 0x60; }
  const png = encodePng(T, T, buf);
  const back = decodePng(Buffer.from(png));
  expect(back.width === T && back.height === T && Buffer.from(buf).equals(back.data), 'pngmini encodes what png.mjs decodes, byte for byte');
  const url = pngDataUrl(T, T, buf);
  expect(url.startsWith('data:image/png;base64,') && url === pngDataUrl(T, T, buf), `the data URL is deterministic (${url.length} chars)`);
  expect(base64(new Uint8Array([77, 97, 110])) === 'TWFu' && base64(new Uint8Array([77, 97])) === 'TWE=' && base64(new Uint8Array([77])) === 'TQ==', 'base64 pads like the standard');
}

// --- the ruin tiles carry no chips any more -----------------------------------
{
  const clean = stripCheck({ check: true });
  expect(clean, 'every --tile-ruin-<mask> in tiles.css is free of isolated chips');
  const css = fs.readFileSync(path.join(ROOT, 'play/tiles.css'), 'utf8');
  const m = css.match(/--tile-ruin-0: url\("data:image\/png;base64,([^"]+)"\)/);
  const img = decodePng(Buffer.from(m[1], 'base64'));
  expect([...img.data].filter((v, i) => i % 4 === 3 && v).length === 0, 'the lone-break ruin case (mask 0) is fully transparent — the chips were all it had');
  const repack = fs.readFileSync(path.join(ROOT, 'phase0/harness/repack-tiles.mjs'), 'utf8');
  expect(/const RUIN = \{[^}]*chips: 0/.test(repack), 'the repack tool generates chip-free ruins');
}

for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`\n${notes.length} ok, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);

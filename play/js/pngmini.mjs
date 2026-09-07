// A tiny, DETERMINISTIC PNG encoder for the debris layer (2026-09-07): a
// 16×16 RGBA buffer becomes a data URL without a canvas — the same bytes in
// every browser and in Node (a canvas stores premultiplied alpha and rounds
// translucent pixels on the way out; toDataURL's bytes differ per engine).
// Store-only zlib (no compression: a tile is 1 KB raw, ~1.4 KB as base64,
// and only touched cells carry one), CRC-32 and Adler-32 by hand.
// No dependencies, no Buffer, no btoa.

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, from, to) {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function be32(out, at, v) {
  out[at] = (v >>> 24) & 255; out[at + 1] = (v >>> 16) & 255; out[at + 2] = (v >>> 8) & 255; out[at + 3] = v & 255;
}

/** RGBA (row-major, 4 bytes per pixel) → PNG bytes. */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height); // filter byte 0 per row
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  // zlib, stored blocks of at most 65535 bytes.
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78; z[1] = 0x01;
  let p = 2;
  for (let i = 0; i < blocks; i++) {
    const from = i * 65535, to = Math.min(raw.length, from + 65535), len = to - from;
    z[p++] = i === blocks - 1 ? 1 : 0;
    z[p++] = len & 255; z[p++] = (len >>> 8) & 255;
    z[p++] = ~len & 255; z[p++] = (~len >>> 8) & 255;
    z.set(raw.subarray(from, to), p);
    p += len;
  }
  be32(z, p, adler32(raw));
  p += 4;
  const idat = z.subarray(0, p);
  const out = new Uint8Array(8 + 25 + 12 + idat.length + 12);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let q = 8;
  const chunk = (type, data) => {
    be32(out, q, data.length);
    out[q + 4] = type.charCodeAt(0); out[q + 5] = type.charCodeAt(1); out[q + 6] = type.charCodeAt(2); out[q + 7] = type.charCodeAt(3);
    out.set(data, q + 8);
    be32(out, q + 8 + data.length, crc32(out, q + 4, q + 8 + data.length));
    q += 12 + data.length;
  };
  const ihdr = new Uint8Array(13);
  be32(ihdr, 0, width); be32(ihdr, 4, height);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk('IHDR', ihdr);
  chunk('IDAT', idat);
  chunk('IEND', new Uint8Array(0));
  return out.subarray(0, q);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes) {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    s += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + (i + 1 < bytes.length ? B64[(n >>> 6) & 63] : '=') + '=';
  }
  return s;
}

/** A 16×16 (or any) RGBA buffer as a CSS-ready data URL. */
export function pngDataUrl(width, height, rgba) {
  return `data:image/png;base64,${base64(encodePng(width, height, rgba))}`;
}

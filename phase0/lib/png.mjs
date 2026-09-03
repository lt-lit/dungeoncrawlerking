// Minimal PNG codec for the asset tools (no npm dep): decodes 8-bit
// non-interlaced greyscale / RGB / palette / grey+alpha / RGBA into RGBA,
// encodes RGBA. Enough to crop 16×16 tiles out of a tilesheet and write an
// atlas — not a general-purpose reader (16-bit and interlaced files throw).
import { inflateSync, deflateSync } from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @returns {{width:number, height:number, data:Buffer}} RGBA, row-major. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('png: bad signature');
  let p = 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  let plte = null, trns = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (depth !== 8) throw new Error(`png: bit depth ${depth} unsupported`);
  if (interlace) throw new Error('png: interlaced files unsupported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`png: colour type ${ctype} unsupported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const x = line[i];
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`png: filter ${filter} at row ${y}`);
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      if (ctype === 6) { rgba[o] = cur[s]; rgba[o + 1] = cur[s + 1]; rgba[o + 2] = cur[s + 2]; rgba[o + 3] = cur[s + 3]; }
      else if (ctype === 2) { rgba[o] = cur[s]; rgba[o + 1] = cur[s + 1]; rgba[o + 2] = cur[s + 2]; rgba[o + 3] = 255; }
      else if (ctype === 3) { const i = cur[s]; rgba[o] = plte[i * 3]; rgba[o + 1] = plte[i * 3 + 1]; rgba[o + 2] = plte[i * 3 + 2]; rgba[o + 3] = trns && i < trns.length ? trns[i] : 255; }
      else if (ctype === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = cur[s]; rgba[o + 3] = 255; }
      else { rgba[o] = rgba[o + 1] = rgba[o + 2] = cur[s]; rgba[o + 3] = cur[s + 1]; }
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: rgba };
}

/** RGBA → PNG bytes (8-bit RGBA, filter 0, max deflate). */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export const blank = (width, height) => ({ width, height, data: Buffer.alloc(width * height * 4) });

export function crop(img, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > img.width || y + h > img.height) throw new Error(`png: crop ${x},${y} ${w}×${h} outside ${img.width}×${img.height}`);
  const out = blank(w, h);
  for (let yy = 0; yy < h; yy++) img.data.copy(out.data, yy * w * 4, ((y + yy) * img.width + x) * 4, ((y + yy) * img.width + x + w) * 4);
  return out;
}

export function blit(dst, src, x, y) {
  for (let yy = 0; yy < src.height; yy++) src.data.copy(dst.data, ((y + yy) * dst.width + x) * 4, yy * src.width * 4, (yy + 1) * src.width * 4);
}

/** Round-trip sanity used by the repack tool's self-check. */
export function samePixels(a, b) {
  return a.width === b.width && a.height === b.height && a.data.equals(b.data);
}

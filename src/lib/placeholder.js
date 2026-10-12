import zlib from 'node:zlib';

/**
 * Pembuat gambar PNG sederhana tanpa dependency eksternal.
 * Dipakai oleh seeder untuk membuat contoh "foto" bukti kerusakan & denah,
 * supaya alur lampiran gambar bisa langsung dilihat saat demo.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Membuat PNG RGB dengan gradien lembut + grid halus, sehingga terlihat
 * seperti placeholder foto (bukan blok warna polos).
 *
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {[number,number,number]} opts.base warna dasar RGB
 */
export function makePlaceholderPng({ width = 640, height = 420, base = [90, 110, 140] } = {}) {
  const [br, bg, bb] = base;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;

  for (let y = 0; y < height; y += 1) {
    raw[p] = 0; // filter type: none
    p += 1;
    for (let x = 0; x < width; x += 1) {
      // Gradien diagonal.
      const gx = x / width;
      const gy = y / height;
      let r = br + (1 - gy) * 55 + gx * 18;
      let g = bg + (1 - gy) * 55 + gx * 12;
      let b = bb + (1 - gy) * 55 + gx * 8;

      // Garis grid tipis setiap 40px agar terlihat bertekstur.
      if (x % 40 === 0 || y % 40 === 0) {
        r -= 16; g -= 16; b -= 16;
      }
      // Sapuan terang diagonal.
      if (Math.abs((x + y) % 160 - 80) < 6) {
        r += 14; g += 14; b += 14;
      }

      raw[p] = Math.max(0, Math.min(255, Math.round(r)));
      raw[p + 1] = Math.max(0, Math.min(255, Math.round(g)));
      raw[p + 2] = Math.max(0, Math.min(255, Math.round(b)));
      p += 3;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

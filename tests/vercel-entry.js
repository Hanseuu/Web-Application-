/**
 * Memastikan titik masuk serverless (api/index.js) berperilaku seperti di Vercel.
 *
 * Vercel memanggil handler yang diekspor dengan (req, res) untuk setiap
 * permintaan, tanpa pernah menjalankan app.listen(). Pengujian ini membungkus
 * handler itu dengan server HTTP biasa, lalu memeriksa:
 *   • handler berupa fungsi (req, res) yang bisa dipakai langsung
 *   • penyiapan skema + data demo berjalan lazy pada permintaan pertama
 *   • berkas statis, API, login, dan gambar dari database semuanya terlayani
 *   • endpoint cron terlindungi oleh CRON_SECRET
 *
 * Jalankan: node tests/vercel-entry.js
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'komen-vercel-entry-'));
process.env.DB_PATH = path.join(tmp, 'entry.db');
process.env.NODE_ENV = 'test';
process.env.WA_PROVIDER = 'mock';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.CRON_SECRET = 'rahasia-cron';

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  d: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

let passed = 0;
let failed = 0;
const failures = [];

const check = (label, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  ${C.g('✓')} ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ${C.r('✗')} ${label}${detail ? C.d(` — ${detail}`) : ''}`);
  }
};

console.log(C.b('\nKomen — Pengujian titik masuk serverless Vercel'));
console.log(C.d(`  database sementara: ${process.env.DB_PATH}\n`));

// Impor handler persis seperti yang dilakukan Vercel.
const mod = await import('../api/index.js');
const handler = mod.default;

check('api/index.js mengekspor handler', typeof handler === 'function', typeof handler);
check('Handler menerima (req, res) seperti yang dipanggil Vercel',
  handler.length >= 2, `arity ${handler.length}`);

// Bungkus handler dengan server HTTP biasa — persis peran runtime Vercel.
const server = http.createServer((req, res) => handler(req, res));
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const req = async (method, url, body, cookie) => {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${url}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data, headers: res.headers, text };
};

try {
  // Permintaan pertama memicu migrate() + ensureSeed() secara lazy.
  const health = await req('GET', '/api/health');
  check('Permintaan pertama menyiapkan database (migrate + seed) lalu merespons',
    health.status === 200 && health.data.ok === true, `status ${health.status}`);

  const meta = await req('GET', '/api/auth/meta');
  check('Endpoint publik bekerja', meta.status === 200 && meta.data.roles.length === 2);

  const index = await req('GET', '/');
  check('Halaman login dilayani sebagai berkas statis',
    index.status === 200 && index.text.includes('Kos Manajemen'), `status ${index.status}`);

  const css = await req('GET', '/css/style.css');
  check('Aset statis (CSS) dilayani', css.status === 200, `status ${css.status}`);

  const js = await req('GET', '/js/core.js');
  check('Modul JavaScript frontend dilayani', js.status === 200, `status ${js.status}`);

  // Login + sesi (sesi disimpan di database, bukan memori instance).
  const login = await req('POST', '/api/auth/login', {
    email: 'owner@komen.id', password: 'owner123', role: 'owner',
  });
  check('Login owner berhasil', login.status === 200 && login.data.user.role === 'owner',
    login.data?.error);

  const cookie = (login.headers.getSetCookie?.() || [])
    .find((c) => c.startsWith('komen_session='))?.split(';')[0];
  check('Cookie sesi diterbitkan', Boolean(cookie), String(cookie));

  const me = await req('GET', '/api/auth/me', null, cookie);
  check('Sesi dari database dikenali pada permintaan berikutnya',
    me.status === 200 && me.data.user.email === 'owner@komen.id', `status ${me.status}`);

  const tenants = await req('GET', '/api/owner/tenants', null, cookie);
  check('Area owner terlindungi & mengembalikan data',
    tenants.status === 200 && tenants.data.tenants.length > 0, `status ${tenants.status}`);

  const codes = tenants.data.tenants.filter((t) => t.roomCode).map((t) => t.roomCode);
  check('Kode kamar tetap berformat XYY',
    codes.length > 0 && codes.every((c) => /^[1-3](0[1-9]|[12]\d|30)$/.test(c)),
    codes.slice(0, 5).join(','));

  // Gambar dari database (pengganti berkas di disk).
  const plans = await req('GET', '/api/owner/floorplans', null, cookie);
  const imgPath = plans.data.floorplans.find((f) => f.imagePath)?.imagePath;
  check('Denah memakai URL gambar dari database',
    /^\/api\/images\/\d+$/.test(imgPath || ''), imgPath);

  const img = await fetch(`${base}${imgPath}`);
  const bytes = Buffer.from(await img.arrayBuffer());
  check('Gambar terlayani dari database dengan benar',
    img.ok && bytes.length > 100 && (img.headers.get('content-type') || '').startsWith('image/'),
    `status ${img.status}, ${bytes.length} bytes, ${img.headers.get('content-type')}`);
  check('Gambar PNG utuh (signature cocok)',
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    bytes.subarray(0, 8).toString('hex'));
  check('Gambar boleh di-cache lama oleh browser',
    (img.headers.get('cache-control') || '').includes('immutable'),
    img.headers.get('cache-control'));

  const missingImg = await req('GET', '/api/images/999999');
  check('Gambar tidak ada -> 404 yang rapi', missingImg.status === 404, `status ${missingImg.status}`);

  // Endpoint cron yang dipanggil Vercel Cron.
  const cronNoAuth = await req('GET', '/api/cron/tick');
  check('Endpoint cron menolak tanpa CRON_SECRET', cronNoAuth.status === 401,
    `status ${cronNoAuth.status}`);

  const cronRes = await fetch(`${base}/api/cron/tick`, {
    headers: { authorization: 'Bearer rahasia-cron' },
  });
  const cronData = await cronRes.json();
  check('Endpoint cron berjalan dengan CRON_SECRET yang benar',
    cronRes.ok && cronData.ok === true, JSON.stringify(cronData).slice(0, 120));
  check('Tugas berkala melaporkan hasilnya',
    'published' in cronData && 'overdueBills' in cronData,
    Object.keys(cronData).join(','));

  // SPA fallback untuk rute yang tidak dikenal.
  const spa = await req('GET', '/rute/yang/tidak/ada');
  check('Rute tak dikenal jatuh ke halaman SPA', spa.status === 200 && spa.text.includes('<!DOCTYPE html>'));

  const api404 = await req('GET', '/api/tidak-ada');
  check('Endpoint API tak dikenal -> 404 JSON',
    api404.status === 404 && Boolean(api404.data.error), `status ${api404.status}`);
} catch (err) {
  failed += 1;
  failures.push('Pengujian terhenti karena error');
  console.log(C.r(`\n  Error: ${err.message}`));
  console.log(C.d(String(err.stack).split('\n').slice(0, 5).join('\n')));
}

server.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${C.g(`${passed} lulus`)}   ${failed ? C.r(`${failed} gagal`) : C.d('0 gagal')}   dari ${passed + failed} pemeriksaan`);
if (failures.length) {
  console.log(C.r('\n  Gagal:'));
  failures.forEach((f) => console.log(C.r(`    • ${f}`)));
}
console.log(`${'─'.repeat(60)}\n`);

process.exit(failed ? 1 : 0);

/* ==========================================================================
   Smoke test end-to-end untuk Komen.
   Menjalankan server pada database sementara, lalu menguji alur utama:
   login 2 peran, daftar penyewa + kode kamar, denah & fasilitas, pengumuman
   (target lantai + jadwal), komplain + upload foto, tagihan + QRIS/VA,
   webhook pembayaran, chat, notifikasi, dan proteksi peran.

   Jalankan: npm run smoke
   ========================================================================== */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4765;
const BASE = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = 'smoke-secret';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'komen-smoke-'));
const DB_PATH = path.join(tmp, 'test.db');

let passed = 0;
let failed = 0;
const failures = [];

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  d: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
};

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ${C.g('✓')} ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ${C.r('✗')} ${label}${detail ? C.d(` — ${detail}`) : ''}`);
  }
}

const section = (title) => console.log(`\n${C.b(title)}`);

/* ------------------------------------------------------- HTTP helper ---- */

class Client {
  constructor(name) {
    this.name = name;
    this.cookie = '';
  }

  async req(method, url, body, { form = false } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    let payload;
    if (form) {
      payload = body;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(`${BASE}${url}`, { method, headers, body: payload, redirect: 'manual' });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) {
      if (c.startsWith('komen_session=')) this.cookie = c.split(';')[0];
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { status: res.status, data, headers: res.headers };
  }

  get = (u) => this.req('GET', u);
  post = (u, b) => this.req('POST', u, b);
  put = (u, b) => this.req('PUT', u, b);
  patch = (u, b) => this.req('PATCH', u, b);
  del = (u, b) => this.req('DELETE', u, b);
  postForm = (u, fd) => this.req('POST', u, fd, { form: true });
  putForm = (u, fd) => this.req('PUT', u, fd, { form: true });
}

/* --------------------------------------------------------- server boot -- */

async function waitForServer(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** PNG 1x1 valid untuk menguji unggah gambar. */
const tinyPng = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
  );

/* ------------------------------------------------------------- the test - */

async function run() {
  const owner = new Client('owner');
  const tenant = new Client('tenant');

  /* ===================================================== AUTH / PERAN == */
  section('1. Autentikasi & dua peran (owner / tenant)');

  const health = await owner.get('/api/health');
  check('GET /api/health merespons ok', health.status === 200 && health.data.ok === true);

  const meta = await owner.get('/api/auth/meta');
  check('Halaman login mendapat 2 pilihan peran', meta.data?.roles?.length === 2,
    JSON.stringify(meta.data?.roles));

  const badLogin = await owner.post('/api/auth/login', {
    email: 'owner@komen.id', password: 'salah', role: 'owner',
  });
  check('Password salah ditolak (401)', badLogin.status === 401, `status ${badLogin.status}`);

  const wrongRole = await owner.post('/api/auth/login', {
    email: 'owner@komen.id', password: 'owner123', role: 'tenant',
  });
  check('Login dengan peran yang salah ditolak (403)', wrongRole.status === 403,
    `status ${wrongRole.status}: ${wrongRole.data?.error}`);

  const ownerLogin = await owner.post('/api/auth/login', {
    email: 'owner@komen.id', password: 'owner123', role: 'owner',
  });
  check('Owner berhasil login', ownerLogin.status === 200 && ownerLogin.data.user.role === 'owner');
  check('Owner diarahkan ke beranda owner',
    ownerLogin.data?.redirect?.includes('/owner/beranda'), ownerLogin.data?.redirect);

  const tenantLogin = await tenant.post('/api/auth/login', {
    email: 'penyewa@komen.id', password: 'penyewa123', role: 'tenant',
  });
  check('Penyewa berhasil login', tenantLogin.status === 200 && tenantLogin.data.user.role === 'tenant');
  check('Penyewa diarahkan ke beranda penyewa',
    tenantLogin.data?.redirect?.includes('/penyewa/beranda'), tenantLogin.data?.redirect);

  const tenantRoom = tenantLogin.data.user.roomCode;
  check('Penyewa punya kode kamar format XYY', /^[1-3]\d{2}$/.test(tenantRoom || ''), `kode: ${tenantRoom}`);

  const noAuth = await new Client('anon').get('/api/owner/tenants');
  check('Endpoint owner menolak tanpa login (401)', noAuth.status === 401, `status ${noAuth.status}`);

  const crossRole = await tenant.get('/api/owner/tenants');
  check('Penyewa tidak bisa akses area owner (403)', crossRole.status === 403, `status ${crossRole.status}`);

  const crossRole2 = await owner.get('/api/tenant/bills');
  check('Owner tidak bisa akses area penyewa (403)', crossRole2.status === 403, `status ${crossRole2.status}`);

  /* ================================================== DAFTAR PENYEWA === */
  section('2. Daftar Penyewa (fitur owner #1)');

  const tenants = await owner.get('/api/owner/tenants');
  check('Daftar penyewa aktif terisi', tenants.data.tenants.length > 0,
    `${tenants.data.tenants.length} penyewa`);

  const allCodesValid = tenants.data.tenants
    .filter((t) => t.roomCode)
    .every((t) => /^[1-3](0[1-9]|[12]\d|30)$/.test(t.roomCode));
  check('Semua kode kamar sesuai format XYY (lantai 1-3, kamar 01-30)', allCodesValid,
    tenants.data.tenants.map((t) => t.roomCode).join(','));

  const singleDigitRoom = tenants.data.tenants.find((t) => t.room?.number < 10);
  check('Nomor kamar 1 digit diberi awalan 0 (mis. kamar 1 -> X01)',
    singleDigitRoom && singleDigitRoom.roomCode === `${singleDigitRoom.room.floor}0${singleDigitRoom.room.number}`,
    singleDigitRoom ? `kamar ${singleDigitRoom.room.number} -> ${singleDigitRoom.roomCode}` : 'tidak ditemukan');

  const floor2 = await owner.get('/api/owner/tenants?floor=2');
  check('Filter lantai bekerja',
    floor2.data.tenants.length > 0 && floor2.data.tenants.every((t) => t.roomCode.startsWith('2')),
    floor2.data.tenants.map((t) => t.roomCode).join(','));

  const searchRes = await owner.get('/api/owner/tenants?search=Maya');
  check('Pencarian penyewa bekerja', searchRes.data.tenants.some((t) => t.name.includes('Maya')));

  // Rename / edit penyewa
  const target = tenants.data.tenants.find((t) => t.name === 'Rizky Pratama');
  const renamed = await owner.put(`/api/owner/tenants/${target.id}`, { name: 'Rizky Pratama Putra' });
  check('Owner dapat mengubah nama penyewa (rename)',
    renamed.status === 200 && renamed.data.tenant.name === 'Rizky Pratama Putra',
    renamed.data?.error);

  // Tambah penyewa baru di kamar kosong
  const rooms = await owner.get('/api/owner/rooms');
  check('Daftar kamar tersedia', rooms.data.rooms.length > 0, `${rooms.data.rooms.length} kamar`);
  check('Batas maksimum 30 kamar per lantai dilaporkan',
    rooms.data.limits.maxRoomsPerFloor === 30, String(rooms.data.limits.maxRoomsPerFloor));

  const emptyRoom = rooms.data.rooms.find((r) => !r.occupied);
  const created = await owner.post('/api/owner/tenants', {
    name: 'Uji Coba Penyewa',
    email: `uji.${Date.now()}@mail.com`,
    password: 'rahasia123',
    roomId: emptyRoom.id,
    phone: '081200009999',
  });
  check('Owner dapat menambah penyewa baru', created.status === 201, created.data?.error);
  check('Penyewa baru menempati kamar yang dipilih',
    created.data?.tenant?.roomCode === emptyRoom.code,
    `${created.data?.tenant?.roomCode} vs ${emptyRoom.code}`);

  // Kamar yang sudah dihuni tidak boleh ditimpa
  const occupiedRoom = rooms.data.rooms.find((r) => r.occupied);
  const conflict = await owner.post('/api/owner/tenants', {
    name: 'Bentrok', email: `bentrok.${Date.now()}@mail.com`,
    password: 'rahasia123', roomId: occupiedRoom.id,
  });
  check('Kamar yang sudah dihuni tidak bisa diisi dua orang (409)', conflict.status === 409,
    `status ${conflict.status}`);

  // Kode kamar dibentuk otomatis saat menambah kamar
  const usedOnFloor3 = new Set(rooms.data.rooms.filter((r) => r.floor === 3).map((r) => r.number));
  const freeNumber = [...Array(30).keys()].map((i) => i + 1).find((n) => !usedOnFloor3.has(n));
  const newRoom = await owner.post('/api/owner/rooms', { floor: 3, number: freeNumber, price: 1500000 });
  check('Kode kamar dibuat otomatis dengan format XYY',
    newRoom.data?.room?.code === `3${String(freeNumber).padStart(2, '0')}`,
    newRoom.data?.room?.code);

  const badRoom = await owner.post('/api/owner/rooms', { floor: 3, number: 31 });
  check('Nomor kamar di atas 30 ditolak', badRoom.status === 400, `status ${badRoom.status}`);

  const badFloor = await owner.post('/api/owner/rooms', { floor: 4, number: 1 });
  check('Lantai di luar 1-3 ditolak', badFloor.status === 400, `status ${badFloor.status}`);

  /* ================================================ DENAH & FASILITAS == */
  section('3. Denah & Fasilitas (fitur owner #2)');

  const plans = await owner.get('/api/owner/floorplans');
  check('Denah tersedia untuk 3 lantai', plans.data.floorplans.length === 3);
  check('Denah berisi susunan kamar + statistik hunian',
    plans.data.floorplans[0].rooms.length > 0 && typeof plans.data.floorplans[0].stats.occupied === 'number');

  const planForm = new FormData();
  planForm.set('title', 'Lantai 1 — Diperbarui Smoke Test');
  planForm.set('description', 'Keterangan denah hasil pengujian otomatis.');
  planForm.set('image', new Blob([tinyPng()], { type: 'image/png' }), 'denah.png');
  const planSaved = await owner.putForm('/api/owner/floorplans/1', planForm);
  check('Owner dapat menyimpan denah + gambar', planSaved.status === 200, planSaved.data?.error);
  const plan1 = planSaved.data?.floorplans?.find((f) => f.floor === 1);
  check('Gambar denah tersimpan di database dan dapat diakses',
    /^\/api\/images\/\d+$/.test(plan1?.imagePath || ''), plan1?.imagePath);

  if (plan1?.imagePath) {
    const img = await fetch(`${BASE}${plan1.imagePath}`);
    check('File gambar denah dilayani lewat /api/images', img.ok, `status ${img.status}`);
  }

  const facForm = new FormData();
  facForm.set('name', 'Ruang Gym Mini');
  facForm.set('description', 'Alat olahraga dasar di lantai 1.');
  facForm.set('category', 'umum');
  facForm.set('icon', '🏋️');
  facForm.set('isPublished', '1');
  const facCreated = await owner.postForm('/api/owner/facilities', facForm);
  check('Owner dapat menambah fasilitas', facCreated.status === 201, facCreated.data?.error);
  const facilityId = facCreated.data?.facility?.id;

  const facUpdate = new FormData();
  facUpdate.set('name', 'Ruang Gym Mini (24 jam)');
  const facUpdated = await owner.putForm(`/api/owner/facilities/${facilityId}`, facUpdate);
  check('Owner dapat mengubah fasilitas',
    facUpdated.data?.facility?.name === 'Ruang Gym Mini (24 jam)', facUpdated.data?.error);

  const placeCreated = await owner.post('/api/owner/places', {
    name: 'Laundry Uji', category: 'laundry', address: 'Jl. Uji No. 1', distanceM: 200,
  });
  check('Owner dapat menambah tempat sekitar', placeCreated.status === 201, placeCreated.data?.error);
  check('Tautan Google Maps dibuat untuk tempat sekitar',
    placeCreated.data?.place?.mapsUrl?.includes('google.com/maps'),
    placeCreated.data?.place?.mapsUrl);

  /* ===================================================== PENGUMUMAN === */
  section('4. Buat Pengumuman (fitur owner #3)');

  const annMeta = await owner.get('/api/owner/announcements');
  check('Tersedia 4 pilihan target pengumuman', annMeta.data.targets.length === 4,
    annMeta.data.targets.map((t) => t.code).join(','));
  check('Pilihan target memakai bahasa Indonesia',
    annMeta.data.targets.map((t) => t.label).join('|').toLowerCase().includes('semua penyewa') &&
    annMeta.data.targets.some((t) => t.label.toLowerCase().includes('lantai 1')),
    annMeta.data.targets.map((t) => t.label).join(' | '));

  const tenantFloor = Number(tenantRoom[0]);
  const otherFloor = tenantFloor === 1 ? 2 : 1;

  const annAll = await owner.post('/api/owner/announcements', {
    title: 'Uji Pengumuman Semua',
    body: 'Pengumuman pengujian untuk seluruh penyewa.',
    target: 'semua',
  });
  check('Pengumuman untuk semua penyewa langsung terbit',
    annAll.status === 201 && annAll.data.announcement.status === 'terbit', annAll.data?.error);
  check('Jumlah penerima dilaporkan', annAll.data?.delivery?.recipients > 0,
    String(annAll.data?.delivery?.recipients));

  const annMyFloor = await owner.post('/api/owner/announcements', {
    title: `Uji Pengumuman Lantai ${tenantFloor}`,
    body: `Khusus penghuni lantai ${tenantFloor}.`,
    target: `lantai_${tenantFloor}`,
  });
  check('Pengumuman per lantai berhasil dibuat', annMyFloor.status === 201, annMyFloor.data?.error);

  const annOtherFloor = await owner.post('/api/owner/announcements', {
    title: `Uji Pengumuman Lantai ${otherFloor}`,
    body: `Khusus penghuni lantai ${otherFloor}.`,
    target: `lantai_${otherFloor}`,
  });
  check('Pengumuman lantai lain berhasil dibuat', annOtherFloor.status === 201, annOtherFloor.data?.error);

  const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
  const annScheduled = await owner.post('/api/owner/announcements', {
    title: 'Uji Pengumuman Terjadwal',
    body: 'Akan terbit satu jam dari sekarang.',
    target: 'semua',
    scheduledAt,
  });
  check('Pengumuman dapat dijadwalkan',
    annScheduled.data?.announcement?.status === 'terjadwal', annScheduled.data?.error);

  const badTarget = await owner.post('/api/owner/announcements', {
    title: 'x', body: 'y', target: 'lantai_9',
  });
  check('Target pengumuman tidak valid ditolak', badTarget.status === 400, `status ${badTarget.status}`);

  // Sisi penyewa
  const annTenant = await tenant.get('/api/tenant/announcements');
  const titles = annTenant.data.announcements.map((a) => a.title);
  check('Penyewa menerima pengumuman "semua"', titles.includes('Uji Pengumuman Semua'));
  check('Penyewa menerima pengumuman lantainya', titles.includes(`Uji Pengumuman Lantai ${tenantFloor}`));
  check('Penyewa TIDAK menerima pengumuman lantai lain',
    !titles.includes(`Uji Pengumuman Lantai ${otherFloor}`), titles.join(' | '));
  check('Penyewa tidak melihat pengumuman terjadwal',
    !titles.includes('Uji Pengumuman Terjadwal'));
  check('Pengumuman terbaru belum dibaca tersedia untuk pop-up',
    Boolean(annTenant.data.latestUnread), JSON.stringify(annTenant.data.summary));

  const annId = annTenant.data.announcements.find((a) => a.title === 'Uji Pengumuman Semua')?.id;
  const markRead = await tenant.post(`/api/tenant/announcements/${annId}/read`, {});
  check('Penyewa dapat menandai pengumuman sudah dibaca', markRead.status === 200);

  const readers = await owner.get(`/api/owner/announcements/${annId}/readers`);
  check('Owner dapat melihat siapa yang sudah membaca',
    readers.data.readers.some((r) => r.roomCode === tenantRoom),
    readers.data.readers.map((r) => r.roomCode).join(','));

  /* ==================================== KOMPLAIN / LAPOR KERUSAKAN ==== */
  section('5. Lapor Kerusakan (penyewa) → Pusat Komplain (owner)');

  const reportForm = new FormData();
  reportForm.set('title', 'Uji Laporan Kerusakan');
  reportForm.set('description', 'Deskripsi kerusakan untuk pengujian otomatis.');
  reportForm.set('category', 'listrik');
  reportForm.set('location', 'kamar');
  reportForm.set('priority', 'tinggi');
  reportForm.append('photos', new Blob([tinyPng()], { type: 'image/png' }), 'bukti-1.png');
  reportForm.append('photos', new Blob([tinyPng()], { type: 'image/png' }), 'bukti-2.png');

  const reported = await tenant.postForm('/api/tenant/complaints', reportForm);
  check('Penyewa dapat mengirim laporan kerusakan', reported.status === 201, reported.data?.error);
  check('Laporan baru berstatus "baru"', reported.data?.complaint?.status === 'baru');
  check('Dua foto bukti terlampir', reported.data?.complaint?.photos?.length === 2,
    String(reported.data?.complaint?.photos?.length));

  const complaintId = reported.data.complaint.id;
  const photoUrl = reported.data.complaint.photos[0].url;

  const ownerBoard = await owner.get('/api/owner/complaints');
  check('Papan komplain punya 3 kolom status (baru/diproses/selesai)',
    ['baru', 'diproses', 'selesai'].every((k) => Array.isArray(ownerBoard.data.board[k])));
  check('Label status memakai bahasa Indonesia',
    ownerBoard.data.statuses.map((s) => s.label).join(',') === 'Baru,Sedang Diproses,Selesai',
    ownerBoard.data.statuses.map((s) => s.label).join(','));

  const ownerSeesIt = ownerBoard.data.board.baru.find((c) => c.id === complaintId);
  check('Laporan penyewa tampil di sisi owner', Boolean(ownerSeesIt));
  check('Foto penyewa terlihat di sisi owner', ownerSeesIt?.photos?.length === 2,
    String(ownerSeesIt?.photos?.length));

  check('URL foto mengarah ke penyimpanan database', /^\/api\/images\/\d+$/.test(photoUrl), photoUrl);

  const photoRes = await fetch(`${BASE}${photoUrl}`, { headers: { cookie: owner.cookie } });
  check('Owner dapat membuka file foto bukti',
    photoRes.ok && Number(photoRes.headers.get('content-length')) > 0, `status ${photoRes.status}`);
  check('Foto dilayani dengan content-type gambar',
    (photoRes.headers.get('content-type') || '').startsWith('image/'),
    photoRes.headers.get('content-type'));

  const toProcess = await owner.patch(`/api/owner/complaints/${complaintId}/status`, {
    status: 'diproses', note: 'Teknisi dijadwalkan besok.', sendWhatsapp: true,
  });
  check('Owner dapat mengubah status ke "diproses"',
    toProcess.data?.complaint?.status === 'diproses', toProcess.data?.error);
  check('Notifikasi WhatsApp update komplain tercatat',
    Boolean(toProcess.data?.whatsapp), JSON.stringify(toProcess.data?.whatsapp));

  const toDone = await owner.patch(`/api/owner/complaints/${complaintId}/status`, {
    status: 'selesai', note: 'Sudah diperbaiki.',
  });
  check('Owner dapat menyelesaikan laporan',
    toDone.data?.complaint?.status === 'selesai' && Boolean(toDone.data?.complaint?.resolvedAt));

  const badStatus = await owner.patch(`/api/owner/complaints/${complaintId}/status`, { status: 'entah' });
  check('Status komplain tidak valid ditolak', badStatus.status === 400, `status ${badStatus.status}`);

  const tenantComplaints = await tenant.get('/api/tenant/complaints');
  check('Penyewa melihat riwayat & tanggapan laporannya',
    tenantComplaints.data.complaints.some(
      (c) => c.id === complaintId && c.updates.some((u) => u.note === 'Sudah diperbaiki.')
    ));

  /* ============================================ KEUANGAN & PEMBAYARAN = */
  section('6. Keuangan (owner #5) & Tagihan Saya (penyewa #1)');

  const finance = await owner.get('/api/owner/finance');
  check('Ringkasan keuangan tersedia', typeof finance.data.summary.piutang === 'number');
  check('Status gateway WhatsApp dilaporkan', Boolean(finance.data.whatsapp.provider),
    finance.data.whatsapp.provider);

  const billIssued = await owner.post('/api/owner/bills', {
    title: 'Uji Tagihan Smoke',
    scope: 'pilih',
    tenantIds: [tenantLogin.data.user.id],
    period: new Date().toISOString().slice(0, 7),
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    amount: 750000,
    useRoomPrice: false,
    sendWhatsapp: true,
  });
  check('Owner dapat menerbitkan tagihan', billIssued.status === 201 && billIssued.data.created === 1,
    billIssued.data?.error || JSON.stringify(billIssued.data));
  check('Tagihan dikirim lewat WhatsApp (tercatat)',
    billIssued.data?.whatsapp?.attempted === 1, JSON.stringify(billIssued.data?.whatsapp));

  const dupBill = await owner.post('/api/owner/bills', {
    title: 'Uji Tagihan Smoke',
    scope: 'pilih',
    tenantIds: [tenantLogin.data.user.id],
    period: new Date().toISOString().slice(0, 7),
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    amount: 750000,
  });
  check('Tagihan duplikat dilewati, bukan digandakan',
    dupBill.data?.created === 0 && dupBill.data?.skipped?.length === 1,
    JSON.stringify(dupBill.data));

  const byFloor = await owner.post('/api/owner/bills', {
    title: 'Uji Tagihan Per Lantai',
    scope: 'lantai_3',
    period: new Date().toISOString().slice(0, 7),
    dueDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
    useRoomPrice: true,
  });
  check('Tagihan dapat diterbitkan per lantai', byFloor.data?.created > 0,
    JSON.stringify({ created: byFloor.data?.created, skipped: byFloor.data?.skipped?.length }));

  const myBills = await tenant.get('/api/tenant/bills');
  check('Penyewa melihat tagihan belum dibayar', myBills.data.bills.length > 0);
  check('Tagihan dipisah: terlambat vs akan datang',
    Array.isArray(myBills.data.overdue) && Array.isArray(myBills.data.upcoming));
  check('Tersedia metode QRIS dan Virtual Account',
    myBills.data.methods.some((m) => m.type === 'qris') &&
    myBills.data.methods.filter((m) => m.type === 'va').length >= 3,
    myBills.data.methods.map((m) => m.code).join(','));

  const payableBill = myBills.data.bills.find((b) => b.title === 'Uji Tagihan Smoke');

  // --- QRIS
  const qris = await tenant.post('/api/tenant/payments', { billId: payableBill.id, method: 'qris' });
  check('Transaksi QRIS dapat dibuat', qris.status === 201, qris.data?.error);
  check('QRIS menghasilkan gambar QR (data URL)',
    qris.data?.payment?.qrImage?.startsWith('data:image/png;base64,'),
    String(qris.data?.payment?.qrImage).slice(0, 30));
  check('Payload QRIS berformat EMVCo (diawali 0002 01)',
    qris.data?.payment?.qrPayload?.startsWith('000201'),
    String(qris.data?.payment?.qrPayload).slice(0, 20));
  check('Tagihan berubah menjadi menunggu pembayaran',
    qris.data?.bill?.status === 'menunggu_pembayaran', qris.data?.bill?.status);

  // Simulasi gagal
  const failed1 = await tenant.post(`/api/tenant/payments/${qris.data.payment.reference}/simulate`, {
    outcome: 'gagal', reason: 'Saldo tidak cukup',
  });
  check('Transaksi dapat berakhir GAGAL dan terlihat penyewa',
    failed1.data?.payment?.status === 'gagal' &&
    failed1.data?.payment?.failureReason === 'Saldo tidak cukup', failed1.data?.error);
  check('Tagihan kembali belum dibayar setelah transaksi gagal',
    failed1.data?.bill?.status !== 'lunas', failed1.data?.bill?.status);

  // --- Virtual Account + webhook
  const va = await tenant.post('/api/tenant/payments', { billId: payableBill.id, method: 'va_bca' });
  check('Transaksi Virtual Account dapat dibuat', va.status === 201, va.data?.error);
  check('Nomor Virtual Account dibuat', /^\d{12,16}$/.test(va.data?.payment?.vaNumber || ''),
    va.data?.payment?.vaNumber);
  check('Biaya layanan VA diterapkan pada total',
    va.data.payment.total === va.data.payment.amount + va.data.payment.fee,
    `${va.data.payment.amount} + ${va.data.payment.fee} = ${va.data.payment.total}`);

  // Webhook dengan signature salah
  const anon = new Client('webhook');
  const badSig = await anon.req('POST', '/api/webhooks/payment',
    { reference: va.data.payment.reference, status: 'berhasil' });
  const badSigRes = await fetch(`${BASE}/api/webhooks/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-komen-signature': 'deadbeef' },
    body: JSON.stringify({ reference: va.data.payment.reference, status: 'berhasil' }),
  });
  check('Webhook menolak signature tidak valid', badSigRes.status === 401, `status ${badSigRes.status}`);

  // Webhook dengan signature benar
  const payload = JSON.stringify({ reference: va.data.payment.reference, status: 'settlement' });
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  const hookRes = await fetch(`${BASE}/api/webhooks/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-komen-signature': signature },
    body: payload,
  });
  const hookData = await hookRes.json();
  check('Webhook pembayaran valid diterima', hookRes.ok && hookData.status === 'berhasil',
    JSON.stringify(hookData));

  // Idempotensi
  const hookRes2 = await fetch(`${BASE}/api/webhooks/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-komen-signature': signature },
    body: payload,
  });
  const hookData2 = await hookRes2.json();
  check('Webhook yang terkirim ulang bersifat idempoten',
    hookRes2.ok && hookData2.idempotent === true, JSON.stringify(hookData2));

  const afterPay = await tenant.get('/api/tenant/bills');
  const paidBill = afterPay.data.paid.find((b) => b.id === payableBill.id);
  check('Tagihan menjadi LUNAS setelah pembayaran berhasil', Boolean(paidBill),
    afterPay.data.bills.find((b) => b.id === payableBill.id)?.status);
  check('Metode pembayaran tercatat pada tagihan',
    paidBill?.paidMethod?.includes('BCA'), paidBill?.paidMethod);
  check('Riwayat transaksi memuat yang berhasil dan yang gagal',
    afterPay.data.payments.some((p) => p.status === 'berhasil') &&
    afterPay.data.payments.some((p) => p.status === 'gagal'));

  // Reminder
  const unpaid = (await owner.get('/api/owner/finance?status=belum_bayar')).data.bills[0];
  if (unpaid) {
    const reminder = await owner.post(`/api/owner/bills/${unpaid.id}/reminder`, { sendWhatsapp: true });
    check('Owner dapat mengirim pengingat (notifikasi + WhatsApp)',
      reminder.status === 200 && Boolean(reminder.data.whatsapp), reminder.data?.error);
    check('Jumlah pengingat bertambah', reminder.data?.bill?.reminderCount >= 1,
      String(reminder.data?.bill?.reminderCount));
  } else {
    check('Owner dapat mengirim pengingat (notifikasi + WhatsApp)', false, 'tidak ada tagihan belum bayar');
  }

  const bulk = await owner.post('/api/owner/bills/reminders', { onlyOverdue: true, sendWhatsapp: true });
  check('Pengingat massal untuk tagihan terlambat berjalan', bulk.status === 200,
    JSON.stringify({ sent: bulk.data?.sent }));

  const waLogs = await owner.get('/api/owner/wa-logs');
  check('Log WhatsApp berisi bukti pengiriman', waLogs.data.logs.length > 0,
    `${waLogs.data.logs.length} log`);
  check('Template WhatsApp memuat nominal tagihan',
    waLogs.data.logs.some((l) => l.message.includes('Rp')),
    waLogs.data.logs[0]?.message?.slice(0, 60));

  const payments = await owner.get('/api/owner/payments');
  check('Owner melihat riwayat transaksi penyewa', payments.data.payments.length > 0);

  /* ============================================ FASILITAS SISI PENYEWA = */
  section('7. Fasilitas (penyewa #4)');

  const facTenant = await tenant.get('/api/tenant/facilities');
  check('Penyewa melihat fasilitas milik owner', facTenant.data.facilities.length > 0,
    `${facTenant.data.facilities.length} fasilitas`);
  check('Fasilitas baru dari owner ikut tampil',
    facTenant.data.facilities.some((f) => f.name.includes('Ruang Gym Mini')));
  check('Penyewa melihat denah lantai', facTenant.data.floorplans.length === 3);
  check('Denah penyewa tidak membocorkan nama penghuni lain',
    facTenant.data.floorplans.every((f) => f.rooms.every((r) => !r.tenant || r.tenant.name === 'Terisi')));

  const categories = facTenant.data.nearby.map((n) => n.code);
  check('Kategori tempat sekitar memuat laundry, minimarket, dan SPBU',
    ['laundry', 'minimarket', 'spbu'].every((c) => categories.includes(c)), categories.join(','));
  check('Setiap kategori punya tautan pencarian Google Maps',
    facTenant.data.nearby.every((n) => n.searchUrl?.includes('google.com/maps')));

  const laundry = facTenant.data.nearby.find((n) => n.code === 'laundry');
  check('Tempat sekitar punya tautan Maps per lokasi',
    laundry.places.length > 0 && laundry.places.every((p) => p.mapsUrl.includes('google.com/maps')),
    laundry.places[0]?.mapsUrl);
  check('Tersedia tautan rute (directions) ke lokasi',
    laundry.places[0]?.directionsUrl?.includes('/maps/dir/'), laundry.places[0]?.directionsUrl);

  /* ========================================================== CHAT ==== */
  section('8. Chat (navigasi kiri atas)');

  const ownerThreads = await owner.get('/api/chat/threads');
  check('Owner melihat daftar percakapan semua penyewa', ownerThreads.data.threads.length > 0,
    `${ownerThreads.data.threads.length} thread`);

  const tenantThreads = await tenant.get('/api/chat/threads');
  check('Penyewa hanya punya satu percakapan (dengan pemilik)',
    tenantThreads.data.threads.length === 1, String(tenantThreads.data.threads.length));

  const ownerId = tenantThreads.data.threads[0].partnerId;
  const sent = await tenant.post('/api/chat/messages', {
    receiverId: ownerId, body: 'Pesan uji dari penyewa.',
  });
  check('Penyewa dapat mengirim pesan ke owner', sent.status === 201, sent.data?.error);

  const reply = await owner.post('/api/chat/messages', {
    receiverId: tenantLogin.data.user.id, body: 'Balasan uji dari pemilik.',
  });
  check('Owner dapat membalas pesan', reply.status === 201, reply.data?.error);

  const convo = await tenant.get(`/api/chat/messages/${ownerId}`);
  check('Riwayat percakapan memuat kedua pesan',
    convo.data.messages.some((m) => m.body === 'Pesan uji dari penyewa.') &&
    convo.data.messages.some((m) => m.body === 'Balasan uji dari pemilik.'));
  check('Arah pesan (fromMe) benar',
    convo.data.messages.find((m) => m.body === 'Pesan uji dari penyewa.')?.fromMe === true &&
    convo.data.messages.find((m) => m.body === 'Balasan uji dari pemilik.')?.fromMe === false);

  const selfChat = await tenant.post('/api/chat/messages', {
    receiverId: tenantLogin.data.user.id, body: 'ke diri sendiri',
  });
  check('Penyewa tidak dapat chat ke penyewa lain / diri sendiri',
    selfChat.status >= 400, `status ${selfChat.status}`);

  /* ================================================== NOTIFIKASI ====== */
  section('9. Notifikasi & Profil');

  const notifs = await tenant.get('/api/notifications');
  check('Penyewa menerima notifikasi (tagihan/pengumuman/chat)', notifs.data.notifications.length > 0,
    `${notifs.data.notifications.length} notifikasi`);
  check('Jumlah notifikasi belum dibaca dihitung', typeof notifs.data.unread === 'number',
    String(notifs.data.unread));

  const types = new Set(notifs.data.notifications.map((n) => n.type));
  check('Notifikasi tagihan terkirim ke penyewa', types.has('bill') || types.has('success'),
    [...types].join(','));

  const poll = await tenant.get('/api/notifications/poll?after=0');
  check('Endpoint polling notifikasi bekerja',
    poll.status === 200 && typeof poll.data.latestId === 'number');
  check('Polling juga membawa jumlah chat belum dibaca',
    typeof poll.data.chatUnread === 'number', String(poll.data.chatUnread));

  const readNotif = await tenant.post('/api/notifications/read', {});
  check('Notifikasi dapat ditandai sudah dibaca', readNotif.data?.unread === 0,
    String(readNotif.data?.unread));

  const ownerNotifs = await owner.get('/api/notifications');
  check('Owner menerima notifikasi laporan baru dari penyewa',
    ownerNotifs.data.notifications.some((n) => n.title.includes('Laporan baru')),
    ownerNotifs.data.notifications.map((n) => n.title).slice(0, 3).join(' | '));

  const profileUpdate = await tenant.put('/api/auth/profile', {
    name: tenantLogin.data.user.name, email: tenantLogin.data.user.email, phone: '081200001234',
  });
  check('Penyewa dapat memperbarui profil',
    profileUpdate.data?.user?.phone === '081200001234', profileUpdate.data?.error);

  const badPass = await tenant.put('/api/auth/password', {
    currentPassword: 'salah', newPassword: 'barubaru123',
  });
  check('Ganti password dengan password lama salah ditolak', badPass.status === 400,
    `status ${badPass.status}`);

  const dashOwner = await owner.get('/api/owner/dashboard');
  check('Beranda owner memuat statistik lengkap',
    typeof dashOwner.data.stats.occupancyRate === 'number' &&
    typeof dashOwner.data.stats.complaints.baru === 'number');

  const dashTenant = await tenant.get('/api/tenant/dashboard');
  check('Beranda penyewa memuat kamar & tagihan',
    dashTenant.data.room?.code === tenantRoom && 'nextBill' in dashTenant.data);

  const logout = await tenant.post('/api/auth/logout', {});
  check('Logout berhasil', logout.status === 200);
  const afterLogout = await tenant.get('/api/tenant/bills');
  check('Sesi tidak bisa dipakai setelah logout', afterLogout.status === 401,
    `status ${afterLogout.status}`);
}

/* ------------------------------------------------------------------ main */

console.log(C.b('\n╔══════════════════════════════════════════════════════════╗'));
console.log(C.b('║  Komen — Smoke Test End-to-End                           ║'));
console.log(C.b('╚══════════════════════════════════════════════════════════╝'));
console.log(C.d(`  database sementara : ${DB_PATH}`));

const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    DB_PATH,
    TURSO_DATABASE_URL: '',
    TURSO_AUTH_TOKEN: '',
    WA_PROVIDER: 'mock',
    WA_TOKEN: '',
    PAYMENT_PROVIDER: 'mock',
    PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    DOTENV_CONFIG_QUIET: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });

const cleanup = () => {
  try { server.kill('SIGKILL'); } catch { /* ignore */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
};

try {
  const ready = await waitForServer();
  if (!ready) {
    console.log(C.r('\n  Server gagal dijalankan.'));
    console.log(C.d(serverLog));
    cleanup();
    process.exit(1);
  }

  await run();
} catch (err) {
  failed += 1;
  console.log(C.r(`\n  Error tak tertangani: ${err.message}`));
  console.log(C.d(err.stack));
  if (serverLog.includes('[error]')) {
    console.log(C.d('\n--- log server ---\n' + serverLog.split('[error]').slice(-1)[0].slice(0, 1500)));
  }
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${C.g(`${passed} lulus`)}   ${failed ? C.r(`${failed} gagal`) : C.d('0 gagal')}   dari ${passed + failed} pemeriksaan`);
if (failures.length) {
  console.log(C.r('\n  Pemeriksaan yang gagal:'));
  failures.forEach((f) => console.log(C.r(`    • ${f}`)));
}
if (serverLog.includes('[error]')) {
  console.log(C.y('\n  Catatan: server mencatat error 5xx selama pengujian.'));
}
console.log(`${'─'.repeat(60)}\n`);

cleanup();
process.exit(failed ? 1 : 0);

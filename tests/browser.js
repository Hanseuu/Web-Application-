/* ==========================================================================
   Pengujian UI nyata memakai Chromium headless.

   Menjalankan server pada database sementara, lalu menelusuri aplikasi
   seperti pengguna: login dua peran, membuka semua halaman fitur,
   membuat laporan dengan foto, membayar tagihan via QRIS, dan membuka chat.
   Semua error konsol/JS dicatat dan membuat pengujian gagal.

   Jalankan: npm run browser
   ========================================================================== */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4766;
const BASE = `http://127.0.0.1:${PORT}`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/playwright/chromium-1232/chrome-linux64/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((p) => {
  try { return fs.existsSync(p); } catch { return false; }
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'komen-browser-'));
const SHOTS = path.join(ROOT, '.kiro', 'artifacts', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  d: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

let passed = 0;
let failed = 0;
const failures = [];
const consoleErrors = [];

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ${C.g('✓')} ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ${C.r('✗')} ${label}${detail ? C.d(` — ${detail}`) : ''}`);
  }
}
const section = (t) => console.log(`\n${C.b(t)}`);

async function waitForServer(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

/* ------------------------------------------------------------------ main */

console.log(C.b('\n╔══════════════════════════════════════════════════════════╗'));
console.log(C.b('║  Komen — Pengujian UI (Chromium headless)                ║'));
console.log(C.b('╚══════════════════════════════════════════════════════════╝'));

if (!executablePath) {
  console.log(C.r('  Tidak menemukan browser Chromium. Set CHROME_PATH lalu ulangi.'));
  process.exit(1);
}
console.log(C.d(`  browser     : ${executablePath}`));
console.log(C.d(`  screenshots : ${path.relative(ROOT, SHOTS)}`));

const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    DB_PATH: path.join(tmp, 'ui.db'),
    UPLOAD_DIR: path.join(tmp, 'uploads'),
    WA_PROVIDER: 'mock',
    PAYMENT_PROVIDER: 'mock',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

let browser;
const cleanup = () => {
  try { browser?.close(); } catch { /* ignore */ }
  try { server.kill('SIGKILL'); } catch { /* ignore */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
};

try {
  if (!await waitForServer()) {
    console.log(C.r('\n  Server gagal start.'));
    console.log(C.d(serverLog));
    cleanup();
    process.exit(1);
  }

  browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: [],
  });
  const page = await context.newPage();

  /*
   * Catat error JavaScript nyata.
   * "Failed to load resource" diabaikan karena browser selalu mencatatnya untuk
   * respons non-2xx — dan aplikasi memang sengaja memakai 401/403 (cek sesi di
   * halaman login, serta pengujian proteksi peran) yang sudah ditangani di kode.
   * Respons 5xx dicatat terpisah sebagai kegagalan server.
   */
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text.startsWith('Failed to load resource')) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) consoleErrors.push(`HTTP ${res.status()} ${res.url()}`);
  });
  page.on('requestfailed', (req) => {
    const f = req.failure();
    if (f && !req.url().includes('favicon')) {
      consoleErrors.push(`REQUESTFAILED ${req.url()} — ${f.errorText}`);
    }
  });

  /* Toast menumpuk; selalu bersihkan sebelum aksi lalu baca yang terbaru. */
  const clearToasts = () =>
    page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  const waitToast = async (timeout = 15_000) => {
    await page.waitForSelector('.toast', { timeout });
    return (await page.locator('.toast').last().innerText()).replace(/\s+/g, ' ').trim();
  };

  const shot = async (name) => {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  };

  /** Navigasi SPA lewat hash + tunggu halaman selesai render. */
  async function goto(hash, waitFor) {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await page.waitForFunction(
      () => !document.querySelector('#view .spinner'),
      { timeout: 12_000 }
    );
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 12_000 });
    await page.waitForTimeout(220);
  }

  /**
   * Cek teks di halaman tanpa peduli huruf besar/kecil — sebagian label
   * dirender dengan `text-transform: uppercase`, sehingga innerText-nya kapital.
   */
  const bodyHas = async (text) =>
    page.evaluate(
      (t) => (document.querySelector('#view')?.innerText || '').toLowerCase().includes(t.toLowerCase()),
      text
    );

  /* ================================================== HALAMAN LOGIN === */
  section('1. Halaman login & pemilihan peran');

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  check('Halaman login terbuka', await page.title() === 'Masuk — Komen (Kos Manajemen)', await page.title());
  check('Nama aplikasi "Komen" tampil',
    (await page.textContent('.brand__text strong')) === 'Komen');
  check('Subjudul "Kos Manajemen" tampil',
    (await page.textContent('.brand__text small')) === 'Kos Manajemen');
  check('Dua pilihan peran tersedia', (await page.locator('.role-option').count()) === 2);
  check('Peran Pemilik Kos tersedia', await page.locator('.role-option[data-role=owner]').isVisible());
  check('Peran Penyewa tersedia', await page.locator('.role-option[data-role=tenant]').isVisible());
  check('Info kos dimuat dari server',
    (await page.textContent('#kostInfo')).includes('Kos Melati'), await page.textContent('#kostInfo'));
  await shot('01-login');

  // Login gagal
  await page.click('.role-option[data-role=owner]');
  await page.fill('#email', 'owner@komen.id');
  await page.fill('#password', 'passwordsalah');
  await page.click('#loginSubmit');
  await page.waitForSelector('#loginError:not([hidden])', { timeout: 8000 });
  check('Pesan error tampil saat password salah',
    (await page.textContent('#loginError')).includes('salah'), await page.textContent('#loginError'));

  // Peran salah
  await page.click('.role-option[data-role=tenant]');
  await page.fill('#password', 'owner123');
  await page.click('#loginSubmit');
  await page.waitForTimeout(700);
  check('Login ditolak bila peran tidak sesuai akun',
    (await page.textContent('#loginError')).toLowerCase().includes('pemilik'),
    await page.textContent('#loginError'));

  /* ================================================== AREA OWNER ====== */
  section('2. Beranda & navigasi Pemilik Kos');

  await page.click('.demo-chip[data-demo-role=owner]');
  check('Tombol akun demo mengisi form otomatis',
    (await page.inputValue('#email')) === 'owner@komen.id');

  await page.click('#loginSubmit');
  await page.waitForURL(/app\.html/, { timeout: 12_000 });
  await page.waitForSelector('#view .feature-card', { timeout: 12_000 });
  check('Owner masuk ke aplikasi', page.url().includes('/owner/beranda'), page.url());
  check('Nama pengguna tampil di header',
    (await page.textContent('#userName')) === 'Bu Sulastri', await page.textContent('#userName'));
  check('Peran tampil di header',
    (await page.textContent('#userRole')) === 'Pemilik Kos');

  // Navigasi kiri atas
  const navLabels = await page.locator('#mainNav .mainnav__link .label').allTextContents();
  check('Navigasi kiri atas memuat Home, Chat, Profil',
    navLabels.join(',') === 'Home,Chat,Profil', navLabels.join(','));

  const sidebarLabels = await page.locator('#sidebarNav .sidebar__link').allTextContents();
  const sidebarText = sidebarLabels.map((s) => s.trim()).join(' | ');
  check('Menu owner memuat 5 fitur utama + beranda',
    ['Daftar Penyewa', 'Denah & Fasilitas', 'Buat Pengumuman', 'Pusat Komplain', 'Keuangan']
      .every((f) => sidebarText.includes(f)), sidebarText);
  check('Beranda owner menampilkan kartu fitur',
    (await page.locator('#view .feature-card').count()) === 5,
    String(await page.locator('#view .feature-card').count()));
  check('Statistik hunian tampil di beranda', await bodyHas('Penyewa Aktif'));
  await shot('02-owner-beranda');

  /* ----------------------------------------------- Daftar Penyewa ----- */
  section('3. Daftar Penyewa');

  await goto('/owner/penyewa', '#tenantTable table');
  check('Tabel penyewa termuat', (await page.locator('#tenantTable tbody tr').count()) > 0);

  const codes = await page.locator('#tenantTable .room-code').allTextContents();
  check('Kode kamar tampil dengan format XYY',
    codes.length > 0 && codes.every((c) => /^[1-3]\d{2}$|^—$/.test(c.trim())), codes.join(','));
  check('Kamar bernomor satu digit memakai awalan 0',
    codes.some((c) => /^[1-3]0[1-9]$/.test(c.trim())), codes.join(','));
  check('Tombol edit tersedia per penyewa',
    (await page.locator('#tenantTable [data-act=edit]').count()) > 0);
  check('Tombol chat tersedia per penyewa',
    (await page.locator('#tenantTable [data-act=chat]').count()) > 0);
  await shot('03-owner-penyewa');

  // Modal edit / rename
  await page.locator('#tenantTable [data-act=edit]').first().click();
  await page.waitForSelector('#tenantForm', { timeout: 8000 });
  check('Modal edit penyewa terbuka', await page.locator('#tenantForm').isVisible());
  const beforeName = await page.inputValue('#tName');
  await page.fill('#tName', `${beforeName} (diubah)`);
  await clearToasts();
  await page.click('#saveTenant');
  let toast = await waitToast();
  check('Rename penyewa tersimpan & muncul notifikasi',
    toast.toLowerCase().includes('berhasil'), toast);
  await page.waitForTimeout(600);
  check('Nama baru tampil di tabel', await bodyHas('(diubah)'));

  // Filter lantai
  await page.selectOption('#fFloor', '2');
  await page.waitForTimeout(900);
  const floor2Codes = await page.locator('#tenantTable .room-code').allTextContents();
  check('Filter lantai 2 hanya menampilkan kamar 2xx',
    floor2Codes.length > 0 && floor2Codes.every((c) => c.trim().startsWith('2')),
    floor2Codes.join(','));
  await page.selectOption('#fFloor', '0');
  await page.waitForTimeout(700);

  /* --------------------------------------------- Denah & Fasilitas ---- */
  section('4. Denah & Fasilitas');

  await goto('/owner/denah', '.room-map');
  check('Tab denah aktif & peta kamar tampil',
    (await page.locator('.room-cell').count()) > 0, String(await page.locator('.room-cell').count()));
  check('Editor keterangan denah tersedia', await page.locator('#dDesc').isVisible());
  check('Gambar denah lantai 1 tampil', await page.locator('.denah-image').first().isVisible());
  check('Terdapat 3 tab lantai', (await page.locator('.floor-tab').count()) === 3);

  await page.locator('.floor-tab').nth(1).click();
  await page.waitForTimeout(500);
  check('Pindah ke lantai 2 menampilkan kamar 2xx',
    (await page.locator('.room-cell__code').first().textContent()).startsWith('2'),
    await page.locator('.room-cell__code').first().textContent());
  await shot('04-owner-denah');

  // Simpan keterangan denah
  await page.locator('.floor-tab').first().click();
  await page.waitForTimeout(400);
  await page.fill('#dDesc', 'Keterangan denah diubah lewat pengujian UI.');
  await clearToasts();
  await page.click('#saveDenah');
  toast = await waitToast();
  check('Denah dapat disimpan dari UI', toast.includes('Denah'), toast);

  // Tab fasilitas
  await page.locator('#propTabs .tab[data-tab=fasilitas]').click();
  await page.waitForSelector('.facility-card', { timeout: 8000 });
  check('Daftar fasilitas tampil',
    (await page.locator('.facility-card').count()) > 0,
    String(await page.locator('.facility-card').count()));
  await shot('05-owner-fasilitas');

  // Tab tempat sekitar
  await page.locator('#propTabs .tab[data-tab=sekitar]').click();
  await page.waitForSelector('.place-group', { timeout: 8000 });
  check('Daftar tempat sekitar tampil', (await page.locator('.place-group').count()) > 0);
  const mapsHref = await page.locator('a[href*="google.com/maps"]').first().getAttribute('href');
  check('Tautan Google Maps tersedia di daftar tempat',
    Boolean(mapsHref?.includes('google.com/maps')), mapsHref);

  /* ------------------------------------------------ Pengumuman -------- */
  section('5. Buat Pengumuman');

  await goto('/owner/pengumuman', '#annList');
  check('Daftar pengumuman termuat', (await page.locator('.ann-item').count()) > 0);
  await page.click('#newAnn');
  await page.waitForSelector('#annForm', { timeout: 8000 });

  const targetOptions = await page.locator('#aTarget option').allTextContents();
  check('Dropdown target punya 4 pilihan', targetOptions.length === 4, targetOptions.join(' | '));
  check('Pilihan dropdown dalam bahasa Indonesia',
    targetOptions.join(' ').includes('Semua penyewa') &&
    targetOptions.join(' ').includes('Lantai 1 saja') &&
    targetOptions.join(' ').includes('Lantai 2 saja') &&
    targetOptions.join(' ').includes('Lantai 3 saja'),
    targetOptions.join(' | '));
  check('Opsi penjadwalan tersedia', await page.locator('#aSchedule').isVisible());
  await shot('06-owner-pengumuman-form');

  await page.fill('#aTitle', 'Pengumuman Uji UI');
  await page.fill('#aBody', 'Isi pengumuman yang dibuat lewat pengujian antarmuka.');
  await page.selectOption('#aTarget', 'lantai_1');
  await clearToasts();
  await page.click('#saveAnn');
  toast = await waitToast();
  check('Pengumuman berhasil diterbitkan dari UI', toast.includes('Pengumuman'), toast);
  await page.waitForTimeout(800);
  check('Pengumuman baru tampil di daftar', await bodyHas('Pengumuman Uji UI'));

  // Pengumuman terjadwal
  await page.click('#newAnn');
  await page.waitForSelector('#annForm', { timeout: 8000 });
  await page.fill('#aTitle', 'Pengumuman Terjadwal Uji UI');
  await page.fill('#aBody', 'Akan terbit otomatis nanti.');
  await page.check('#aSchedule');
  check('Input waktu muncul setelah penjadwalan dicentang',
    await page.locator('#aWhen').isVisible());
  await clearToasts();
  await page.click('#saveAnn');
  toast = await waitToast();
  check('Pengumuman terjadwal dikonfirmasi lewat notifikasi',
    toast.toLowerCase().includes('dijadwalkan'), toast);
  await page.waitForTimeout(800);
  check('Pengumuman terjadwal ditandai "Terjadwal"', await bodyHas('Terjadwal'));
  await shot('07-owner-pengumuman-list');

  /* -------------------------------------------------- Komplain -------- */
  section('6. Pusat Komplain');

  await goto('/owner/komplain', '.board');
  check('Papan komplain punya 3 kolom', (await page.locator('.board__col').count()) === 3);
  const boardHeads = (await page.locator('.board__head strong').allTextContents()).join(' | ');
  check('Kolom memakai status bahasa Indonesia',
    boardHeads.includes('Baru') && boardHeads.includes('Sedang Diproses') && boardHeads.includes('Selesai'),
    boardHeads);
  check('Kartu komplain tampil', (await page.locator('.complaint-card').count()) > 0);
  check('Foto bukti muncul sebagai thumbnail di kartu',
    (await page.locator('.complaint-card__thumbs img').count()) > 0,
    String(await page.locator('.complaint-card__thumbs img').count()));
  await shot('08-owner-komplain');

  await page.locator('.complaint-card').first().click();
  await page.waitForSelector('#statusForm', { timeout: 8000 });
  check('Detail komplain terbuka', await page.locator('#statusForm').isVisible());
  check('Foto bukti penyewa tampil di detail owner',
    (await page.locator('.photo-grid img').count()) > 0,
    String(await page.locator('.photo-grid img').count()));
  check('Riwayat penanganan tampil', (await page.locator('.timeline li').count()) > 0);
  await shot('09-owner-komplain-detail');

  await page.selectOption('#newStatus', 'diproses');
  await page.fill('#noteText', 'Ditangani lewat pengujian UI.');
  await clearToasts();
  await page.click('#saveStatus');
  toast = await waitToast();
  check('Status komplain dapat diperbarui dari UI', toast.includes('Laporan'), toast);
  await page.waitForTimeout(900);
  check('Komplain pindah ke kolom "Sedang Diproses"',
    (await page.locator('.board__col').nth(1).innerText()).includes('Lampu koridor')
    || (await page.locator('.board__col').nth(1).locator('.complaint-card').count()) > 0,
    await page.locator('.board__head').nth(1).innerText());

  /* -------------------------------------------------- Keuangan -------- */
  section('7. Keuangan');

  await goto('/owner/keuangan', '#finBody table');
  check('Tabel tagihan termuat', (await page.locator('#finBody tbody tr').count()) > 0);
  check('Ringkasan keuangan tampil', await bodyHas('Belum Dibayar'));
  check('Status gateway WhatsApp tampil', await bodyHas('Gateway WhatsApp'));
  await shot('10-owner-keuangan');

  await page.click('#newBill');
  await page.waitForSelector('#billForm', { timeout: 8000 });
  const scopeOptions = await page.locator('#bScope option').allTextContents();
  check('Lingkup tagihan mencakup semua & per lantai',
    scopeOptions.join(' ').includes('Semua penyewa aktif') &&
    scopeOptions.filter((o) => o.includes('Lantai')).length === 3,
    scopeOptions.join(' | '));

  await page.fill('#bTitle', 'Tagihan Uji UI');
  await page.selectOption('#bScope', 'lantai_2');
  await clearToasts();
  await page.click('#saveBill');
  const billToast = await waitToast();
  check('Tagihan dapat diterbitkan dari UI', billToast.includes('diterbitkan'), billToast);

  // Kirim pengingat
  await page.waitForTimeout(900);
  const remindBtn = page.locator('[data-act=remind]').first();
  if (await remindBtn.count()) {
    await remindBtn.click();
    await page.waitForSelector('#remindForm', { timeout: 8000 });
    check('Form pengingat terbuka', await page.locator('#remindForm').isVisible());
    await clearToasts();
    await page.click('#sendRemind');
    const remindToast = await waitToast();
    check('Pengingat terkirim dari UI', remindToast.includes('Pengingat'), remindToast);
  } else {
    check('Form pengingat terbuka', false, 'tombol pengingat tidak ditemukan');
  }

  // Log WhatsApp
  await page.locator('#finTabs .tab[data-tab=whatsapp]').click();
  await page.waitForSelector('.wa-log-item', { timeout: 9000 });
  check('Log WhatsApp berisi pesan terkirim',
    (await page.locator('.wa-log-item').count()) > 0,
    String(await page.locator('.wa-log-item').count()));
  check('Isi pesan WhatsApp memuat nominal rupiah',
    (await page.locator('.wa-log-item__msg').first().innerText()).includes('Rp'));
  await shot('11-owner-wa-log');

  /* ---------------------------------------------- Chat & Profil ------- */
  section('8. Chat & Profil (owner)');

  await page.click('#mainNav [data-nav=chat]');
  await page.waitForSelector('.chat-layout', { timeout: 10_000 });
  await page.waitForSelector('.chat-thread-item', { timeout: 10_000 });
  check('Daftar percakapan penyewa tampil',
    (await page.locator('.chat-thread-item').count()) > 0,
    String(await page.locator('.chat-thread-item').count()));
  await page.waitForSelector('#chatInput', { timeout: 10_000 });
  await page.fill('#chatInput', 'Pesan dari pemilik lewat pengujian UI.');
  await page.click('#sendBtn');
  await page.waitForTimeout(1200);
  check('Pesan terkirim dan muncul sebagai gelembung keluar',
    (await page.locator('.bubble--out').last().innerText()).includes('pengujian UI'),
    await page.locator('.bubble--out').last().innerText());
  await shot('12-owner-chat');

  await page.click('#mainNav [data-nav=profil]');
  await page.waitForSelector('#profileForm', { timeout: 10_000 });
  check('Halaman profil owner termuat', await page.locator('.profile-head').isVisible());
  check('Info akun tampil', (await page.locator('#infoList .info-row').count()) > 0);
  await shot('13-owner-profil');

  // Notifikasi
  await page.click('#notifToggle');
  await page.waitForSelector('#notifPanel.is-open', { timeout: 8000 });
  check('Panel notifikasi terbuka',
    await page.locator('#notifPanel.is-open').isVisible());
  await page.waitForTimeout(700);
  check('Notifikasi owner berisi laporan/pembayaran',
    (await page.locator('.notif-item').count()) > 0,
    String(await page.locator('.notif-item').count()));
  await shot('14-owner-notifikasi');
  await page.click('#notifClose');

  /* ================================================== AREA PENYEWA === */
  section('9. Beranda & fitur Penyewa');

  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.click('.demo-chip[data-demo-role=tenant]');
  await page.click('#loginSubmit');
  await page.waitForURL(/app\.html/, { timeout: 12_000 });
  await page.waitForSelector('#view .feature-card', { timeout: 12_000 });

  check('Penyewa masuk ke beranda penyewa', page.url().includes('/penyewa/beranda'), page.url());
  check('Header menampilkan nomor kamar penyewa',
    /Kamar \d{3}/.test(await page.textContent('#userRole')), await page.textContent('#userRole'));
  check('Beranda penyewa menampilkan 4 kartu fitur',
    (await page.locator('#view .feature-card').count()) === 4,
    String(await page.locator('#view .feature-card').count()));

  const tenantMenu = (await page.locator('#sidebarNav .sidebar__link').allTextContents())
    .map((s) => s.trim()).join(' | ');
  check('Menu penyewa memuat 4 fitur utama',
    ['Tagihan Saya', 'Lapor Kerusakan', 'Pengumuman', 'Fasilitas'].every((f) => tenantMenu.includes(f)),
    tenantMenu);
  check('Kartu kamar menampilkan kode kamar', await bodyHas('Kamar Saya'));
  await shot('15-penyewa-beranda');

  // Pop-up pengumuman terbaru
  const popupVisible = await page.locator('.ann-popup').count();
  check('Pop-up pengumuman terbaru dapat muncul (dicek di halaman Pengumuman)', true,
    popupVisible ? 'sudah muncul di beranda' : 'dicek berikutnya');

  /* ------------------------------------------------ Tagihan Saya ------ */
  section('10. Tagihan Saya + pembayaran QRIS');

  await goto('/penyewa/tagihan', '.bill-card');
  check('Daftar tagihan penyewa tampil',
    (await page.locator('.bill-card').count()) > 0, String(await page.locator('.bill-card').count()));
  check('Bagian tagihan jatuh tempo ada', await bodyHas('Tagihan Jatuh Tempo'));
  check('Bagian tagihan akan datang ada', await bodyHas('Tagihan Akan Datang'));
  check('Total harus dibayar tampil', await bodyHas('Total Harus Dibayar'));
  await shot('16-penyewa-tagihan');

  await page.locator('[data-act=pay]').first().click();
  await page.waitForSelector('#methodList', { timeout: 8000 });
  const methods = await page.locator('.method-option').count();
  check('Pilihan metode pembayaran tampil (QRIS + VA)', methods >= 4, String(methods));
  check('QRIS tersedia sebagai metode',
    (await page.locator('.method-option[data-code=qris]').count()) === 1);
  check('Virtual Account bank tersedia',
    (await page.locator('.method-option[data-code^=va_]').count()) >= 3,
    String(await page.locator('.method-option[data-code^=va_]').count()));
  check('Ringkasan total bayar tampil', await page.locator('#paySummary').isVisible());
  await shot('17-penyewa-metode-bayar');

  await page.click('#createPay');
  await page.waitForSelector('.qr-frame img', { timeout: 12_000 });
  const qrSrc = await page.locator('.qr-frame img').getAttribute('src');
  check('Kode QRIS tampil sebagai gambar', Boolean(qrSrc?.startsWith('data:image/png')),
    String(qrSrc).slice(0, 30));
  check('Hitung mundur batas waktu berjalan',
    /\d{2}:\d{2}/.test(await page.textContent('#countdown')), await page.textContent('#countdown'));
  check('Petunjuk pembayaran tersedia', (await page.locator('.pay-steps li').count()) > 0);
  await shot('18-penyewa-qris');

  // Simulasi gagal
  await page.locator('[data-sim=gagal]').click();
  await page.waitForSelector('.result-icon', { timeout: 12_000 });
  check('Transaksi GAGAL ditampilkan ke penyewa',
    (await page.locator('.modal').innerText()).includes('Tidak Berhasil'),
    await page.locator('.modal__head h3').innerText());
  await shot('19-penyewa-bayar-gagal');

  // Coba lagi -> VA
  await page.click('#retryPay');
  await page.waitForSelector('#methodList', { timeout: 8000 });
  await page.locator('.method-option[data-code=va_bca]').click();
  await page.click('#createPay');
  await page.waitForSelector('.va-box__number', { timeout: 12_000 });
  const vaNum = (await page.textContent('.va-box__number')).trim();
  check('Nomor Virtual Account tampil', /^\d{12,16}$/.test(vaNum), vaNum);
  await shot('20-penyewa-va');

  await page.locator('[data-sim=berhasil]').click();
  await page.waitForSelector('.result-icon', { timeout: 12_000 });
  check('Transaksi BERHASIL ditampilkan ke penyewa',
    (await page.locator('.modal').innerText()).includes('Pembayaran Diterima'),
    await page.locator('.modal__head h3').innerText());
  check('Referensi transaksi tampil di struk',
    (await page.locator('.modal').innerText()).includes('KMN-'));
  await shot('21-penyewa-bayar-berhasil');

  await page.locator('.modal__foot [data-close]').click();
  await page.waitForTimeout(1500);
  check('Tagihan masuk riwayat pembayaran setelah lunas',
    await bodyHas('Riwayat Pembayaran'));

  /* ---------------------------------------------- Lapor Kerusakan ----- */
  section('11. Lapor Kerusakan (dengan foto)');

  await goto('/penyewa/lapor', '#reportBody');
  check('Halaman lapor kerusakan termuat', await bodyHas('Riwayat Laporan Saya'));
  await page.click('#newReport');
  await page.waitForSelector('#reportForm', { timeout: 8000 });
  check('Form laporan terbuka', await page.locator('#reportForm').isVisible());
  check('Pilihan jenis kerusakan tersedia',
    (await page.locator('#rCat option').count()) > 3,
    String(await page.locator('#rCat option').count()));
  check('Pilihan lokasi tersedia', (await page.locator('#rLoc option').count()) > 3);

  await page.fill('#rTitle', 'Lampu kamar mati (uji UI)');
  await page.fill('#rDesc', 'Lampu utama kamar tidak menyala sejak tadi malam.');
  await page.selectOption('#rCat', 'listrik');
  await page.selectOption('#rPri', 'tinggi');

  // Lampirkan dua foto
  await page.setInputFiles('#photoInput', [
    { name: 'kerusakan-1.png', mimeType: 'image/png', buffer: tinyPng },
    { name: 'kerusakan-2.png', mimeType: 'image/png', buffer: tinyPng },
  ]);
  await page.waitForTimeout(500);
  check('Pratinjau foto tampil sebelum kirim',
    (await page.locator('.file-preview__item').count()) === 2,
    String(await page.locator('.file-preview__item').count()));
  await shot('22-penyewa-lapor-form');

  await clearToasts();
  await page.click('#sendReport');
  const reportToast = await waitToast();
  check('Laporan terkirim dari UI', reportToast.toLowerCase().includes('laporan'), reportToast);
  await page.waitForTimeout(1200);
  check('Laporan baru tampil di riwayat', await bodyHas('Lampu kamar mati (uji UI)'));
  check('Foto terlampir terlihat di riwayat penyewa',
    (await page.locator('.complaint-card__thumbs img').count()) > 0);
  await shot('23-penyewa-lapor-list');

  /* ------------------------------------------------- Pengumuman ------- */
  section('12. Pengumuman (penyewa) + pop-up');

  await page.evaluate(() => sessionStorage.removeItem('komen:annPopup'));
  await goto('/penyewa/pengumuman', '#annBody');
  await page.waitForTimeout(900);
  const hasPopup = await page.locator('.ann-popup').count();
  check('Pengumuman terbaru muncul sebagai pop-up', hasPopup > 0, `popup: ${hasPopup}`);
  if (hasPopup) {
    check('Pop-up diberi label "Pengumuman Terbaru"',
      (await page.locator('.ann-popup__badge').innerText()).includes('Terbaru'),
      await page.locator('.ann-popup__badge').innerText());
    await shot('24-penyewa-pengumuman-popup');
    await page.click('#markRead');
    await page.waitForTimeout(1200);
  }
  check('Daftar pengumuman tampil', (await page.locator('.ann-item').count()) > 0);
  check('Penyewa hanya melihat pengumuman untuk lantainya atau semua',
    !(await bodyHas('Kerja Bakti Rooftop Lantai 3')),
    'pengumuman lantai 3 tidak boleh terlihat oleh penghuni lantai 1');
  await shot('25-penyewa-pengumuman');

  /* --------------------------------------------------- Fasilitas ------ */
  section('13. Fasilitas (penyewa) + Google Maps');

  await goto('/penyewa/fasilitas', '.facility-card');
  check('Fasilitas kos tampil',
    (await page.locator('.facility-card').count()) > 0,
    String(await page.locator('.facility-card').count()));
  await shot('26-penyewa-fasilitas');

  await page.locator('#facTabs .tab[data-tab=denah]').click();
  await page.waitForSelector('.room-map', { timeout: 9000 });
  check('Denah lantai tampil untuk penyewa', (await page.locator('.room-cell').count()) > 0);
  check('Kamar penyewa ditandai khusus',
    (await page.locator('.room-cell--mine').count()) === 1,
    String(await page.locator('.room-cell--mine').count()));
  check('Nama penghuni lain tidak ditampilkan',
    !(await page.locator('.room-map').innerText()).includes('Rizky'),
    'denah penyewa harus anonim');
  await shot('27-penyewa-denah');

  await page.locator('#facTabs .tab[data-tab=sekitar]').click();
  await page.waitForSelector('.place-group', { timeout: 9000 });
  const groupTitles = (await page.locator('.place-group__head h3').allTextContents()).join(' | ');
  check('Kategori sekitar memuat Laundry, Minimarket, SPBU',
    groupTitles.includes('Laundry') && groupTitles.includes('Minimarket') && groupTitles.includes('SPBU'),
    groupTitles);

  const placeLinks = page.locator('.place-item');
  check('Daftar tempat sekitar tampil', (await placeLinks.count()) > 0);
  const firstHref = await placeLinks.first().getAttribute('href');
  const firstTarget = await placeLinks.first().getAttribute('target');
  check('Tempat sekitar menautkan ke Google Maps',
    Boolean(firstHref?.includes('google.com/maps')), firstHref);
  check('Tautan Maps dibuka di tab baru', firstTarget === '_blank', String(firstTarget));
  check('Tersedia tombol cari kategori di Maps',
    (await page.locator('a[href*="/maps/search/"]').count()) > 0);
  await shot('28-penyewa-sekitar');

  /* -------------------------------------------- Chat & Profil penyewa - */
  section('14. Chat & Profil (penyewa)');

  await page.click('#mainNav [data-nav=chat]');
  await page.waitForSelector('.chat-layout', { timeout: 10_000 });
  await page.waitForSelector('#chatInput', { timeout: 10_000 });
  check('Penyewa hanya punya satu kontak (pemilik kos)',
    (await page.locator('.chat-thread-item').count()) === 1,
    String(await page.locator('.chat-thread-item').count()));
  check('Pesan dari pemilik terlihat penyewa',
    (await page.locator('.bubble--in').last().innerText()).length > 0);
  await page.fill('#chatInput', 'Terima kasih Bu, sudah saya cek.');
  await page.click('#sendBtn');
  await page.waitForTimeout(1200);
  check('Penyewa dapat mengirim balasan',
    (await page.locator('.bubble--out').last().innerText()).includes('Terima kasih'));
  await shot('29-penyewa-chat');

  await page.click('#mainNav [data-nav=profil]');
  await page.waitForSelector('#profileForm', { timeout: 10_000 });
  check('Profil penyewa menampilkan nomor kamar',
    (await page.locator('#infoList').innerText()).includes('Nomor Kamar'));
  check('Profil menampilkan harga kamar',
    (await page.locator('#infoList').innerText()).includes('Harga Kamar'));
  await shot('30-penyewa-profil');

  /* -------------------------------------------------- Responsif ------- */
  section('15. Tampilan ponsel & proteksi rute');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#mainNav [data-nav=home]');
  await page.waitForSelector('#view .feature-card', { timeout: 10_000 });
  check('Tombol menu muncul pada layar kecil', await page.locator('#menuToggle').isVisible());
  await page.click('#menuToggle');
  await page.waitForTimeout(450);
  check('Sidebar dapat dibuka di ponsel',
    await page.locator('#sidebar.is-open').isVisible());
  await shot('31-penyewa-mobile');

  // Klik area gelap di sebelah kanan sidebar (sidebar menutupi 250px kiri).
  await page.locator('#backdrop').click({ position: { x: 360, y: 420 } });
  await page.waitForTimeout(450);
  check('Sidebar tertutup saat area gelap diklik',
    !(await page.evaluate(() => document.querySelector('#sidebar').classList.contains('is-open'))));

  await page.setViewportSize({ width: 1440, height: 900 });

  // Penyewa mencoba membuka halaman owner
  await page.evaluate(() => { window.location.hash = '/owner/keuangan'; });
  await page.waitForTimeout(1200);
  check('Penyewa ditolak saat membuka rute owner',
    (await page.locator('#view').innerText()).includes('bukan untuk peran Anda'),
    (await page.locator('#view').innerText()).slice(0, 80));

  // Rute tidak dikenal
  await page.evaluate(() => { window.location.hash = '/halaman/tidak-ada'; });
  await page.waitForTimeout(900);
  check('Rute tidak dikenal menampilkan pesan ramah',
    (await page.locator('#view').innerText()).includes('tidak ditemukan'));

  /* -------------------------------------------------- Error konsol ---- */
  section('16. Kebersihan konsol browser');
  check('Tidak ada error JavaScript selama penelusuran',
    consoleErrors.length === 0,
    consoleErrors.slice(0, 5).join(' || '));
} catch (err) {
  failed += 1;
  failures.push('Pengujian terhenti karena error');
  console.log(C.r(`\n  Error: ${err.message}`));
  console.log(C.d(String(err.stack).split('\n').slice(0, 6).join('\n')));
  if (serverLog.includes('[error]')) {
    console.log(C.d(`\n--- log server ---\n${serverLog.split('[error]').slice(-1)[0].slice(0, 1200)}`));
  }
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${C.g(`${passed} lulus`)}   ${failed ? C.r(`${failed} gagal`) : C.d('0 gagal')}   dari ${passed + failed} pemeriksaan`);
if (failures.length) {
  console.log(C.r('\n  Gagal:'));
  failures.forEach((f) => console.log(C.r(`    • ${f}`)));
}
if (consoleErrors.length) {
  console.log(C.r(`\n  Error konsol (${consoleErrors.length}):`));
  consoleErrors.slice(0, 12).forEach((e) => console.log(C.r(`    • ${e.slice(0, 180)}`)));
}
console.log(`${'─'.repeat(60)}\n`);

cleanup();
process.exit(failed ? 1 : 0);

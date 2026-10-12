import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const here = path.dirname(fileURLToPath(import.meta.url));

/** Root folder of the project (one level above /src). */
export const ROOT = path.resolve(here, '..');

const resolveFromRoot = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),

  // Dipakai hanya saat mode berkas lokal (pengembangan & pengujian).
  // Di Vercel, database berada di Turso lewat TURSO_DATABASE_URL.
  dbPath: resolveFromRoot(process.env.DB_PATH || 'data/komen.db'),
  publicDir: path.join(ROOT, 'public'),

  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 7),
  sessionCookie: 'komen_session',

  // Gambar disimpan di database, dibatasi agar aman untuk dikirim lewat
  // koneksi HTTP milik Turso. Browser sudah mengecilkan gambar sebelum
  // mengunggah (lihat public/js/core.js -> shrinkImage).
  maxImageBytes: Number(process.env.MAX_IMAGE_BYTES || 1_500_000),
  maxImagesPerReport: 5,

  kost: {
    name: process.env.KOST_NAME || 'Kos Melati Residence',
    address: process.env.KOST_ADDRESS || 'Jl. Melati No. 12, Yogyakarta',
    lat: Number(process.env.KOST_LAT || -7.7829),
    lng: Number(process.env.KOST_LNG || 110.367),
  },

  // Batas fisik gedung: 3 lantai, maksimal 30 kamar per lantai.
  building: {
    floors: [1, 2, 3],
    maxRoomsPerFloor: 30,
  },

  wa: {
    provider: (process.env.WA_PROVIDER || 'mock').toLowerCase(),
    token: process.env.WA_TOKEN || '',
    phoneId: process.env.WA_PHONE_ID || '',
    templateLang: process.env.WA_TEMPLATE_LANG || 'id',
  },

  payment: {
    provider: (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase(),
    apiUrl: process.env.PAYMENT_API_URL || '',
    apiKey: process.env.PAYMENT_API_KEY || '',
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || 'komen-dev-webhook-secret',
    expiryMinutes: Number(process.env.PAYMENT_EXPIRY_MINUTES || 60),
    merchantName: process.env.PAYMENT_MERCHANT_NAME || 'KOS MELATI RESIDENCE',
    merchantCity: process.env.PAYMENT_MERCHANT_CITY || 'YOGYAKARTA',
    merchantId: process.env.PAYMENT_MERCHANT_ID || 'ID1024336612345',
  },

  // Rahasia untuk endpoint /api/cron/tick yang dipanggil Vercel Cron.
  cronSecret: process.env.CRON_SECRET || '',
};

/** Metode pembayaran yang didukung di halaman "Tagihan Saya". */
export const PAYMENT_METHODS = [
  { code: 'qris', label: 'QRIS', type: 'qris', fee: 0, issuer: 'Semua e-wallet & m-banking' },
  { code: 'va_bca', label: 'Virtual Account BCA', type: 'va', fee: 4000, issuer: 'BCA', prefix: '39081' },
  { code: 'va_bni', label: 'Virtual Account BNI', type: 'va', fee: 4000, issuer: 'BNI', prefix: '88810' },
  { code: 'va_mandiri', label: 'Virtual Account Mandiri', type: 'va', fee: 4000, issuer: 'Mandiri', prefix: '89508' },
  { code: 'va_bri', label: 'Virtual Account BRI', type: 'va', fee: 4000, issuer: 'BRI', prefix: '26215' },
];

/** Target pengumuman (dropdown di halaman "Buat Pengumuman"). */
export const ANNOUNCEMENT_TARGETS = [
  { code: 'semua', label: 'Semua penyewa' },
  { code: 'lantai_1', label: 'Lantai 1 saja' },
  { code: 'lantai_2', label: 'Lantai 2 saja' },
  { code: 'lantai_3', label: 'Lantai 3 saja' },
];

/** Status komplain pada "Pusat Komplain". */
export const COMPLAINT_STATUSES = [
  { code: 'baru', label: 'Baru' },
  { code: 'diproses', label: 'Sedang Diproses' },
  { code: 'selesai', label: 'Selesai' },
];

export default config;

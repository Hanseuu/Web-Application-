import { config } from '../config.js';

/* -------------------------------------------------------------------------- */
/* Kode kamar: format XYY  (X = lantai, YY = nomor kamar dengan leading zero) */
/* -------------------------------------------------------------------------- */

/**
 * Bentuk kode kamar sesuai aturan: lantai + nomor 2 digit.
 * Contoh: lantai 1 kamar 5  -> "105"
 *         lantai 2 kamar 12 -> "212"
 *         lantai 3 kamar 30 -> "330"
 */
export function buildRoomCode(floor, number) {
  const f = Number(floor);
  const n = Number(number);
  if (!config.building.floors.includes(f)) {
    throw new HttpError(400, `Lantai tidak valid. Pilih salah satu dari: ${config.building.floors.join(', ')}`);
  }
  if (!Number.isInteger(n) || n < 1 || n > config.building.maxRoomsPerFloor) {
    throw new HttpError(400, `Nomor kamar harus antara 1 sampai ${config.building.maxRoomsPerFloor}`);
  }
  return `${f}${String(n).padStart(2, '0')}`;
}

/** Ambil nomor lantai dari kode kamar "XYY". */
export const floorFromCode = (code) => Number(String(code).charAt(0));

/** Target pengumuman untuk lantai tertentu, mis. 2 -> "lantai_2". */
export const floorTarget = (floor) => `lantai_${floor}`;

/* -------------------------------------------------------------------------- */
/* Error & async wrapper                                                      */
/* -------------------------------------------------------------------------- */

export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Bungkus handler async agar error otomatis diteruskan ke error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* -------------------------------------------------------------------------- */
/* Validasi & sanitasi                                                        */
/* -------------------------------------------------------------------------- */

export function requireFields(body, fields) {
  const missing = fields.filter((f) => {
    const v = body?.[f];
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (missing.length) {
    throw new HttpError(400, `Data wajib belum lengkap: ${missing.join(', ')}`);
  }
}

export const str = (v, max = 5000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));

export const int = (v, fallback = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
};

export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());

/**
 * Normalisasi nomor telepon Indonesia ke format internasional tanpa "+".
 * "0812-3456-7890" -> "6281234567890"
 */
export function normalizePhone(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (!p) return '';
  p = p.replace(/^\+/, '');
  if (p.startsWith('0')) p = `62${p.slice(1)}`;
  else if (p.startsWith('8')) p = `62${p}`;
  return p;
}

/* -------------------------------------------------------------------------- */
/* Format tanggal & uang                                                      */
/* -------------------------------------------------------------------------- */

/** Waktu sekarang dalam format SQLite "YYYY-MM-DD HH:MM:SS" (UTC). */
export const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** Konversi string tanggal apa pun menjadi format SQLite. */
export function toSqlDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export const todaySql = () => new Date().toISOString().slice(0, 10);

export function addDays(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

/** Selisih hari antara tanggal jatuh tempo dan hari ini (negatif = lewat). */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  const today = new Date(`${todaySql()}T00:00:00Z`);
  return Math.round((target - today) / 86400000);
}

export const formatRupiah = (amount) =>
  `Rp${Number(amount || 0).toLocaleString('id-ID')}`;

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** "2026-03-05" -> "5 Maret 2026" */
export function formatTanggal(dateStr) {
  if (!dateStr) return '-';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(dateStr);
  return `${d} ${BULAN[m - 1]} ${y}`;
}

/** "2026-03" -> "Maret 2026" */
export function formatPeriode(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m) return String(period || '-');
  return `${BULAN[m - 1]} ${y}`;
}

/** Kode acak untuk referensi pembayaran. */
export function randomCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** Potong teks panjang untuk preview/notifikasi. */
export const excerpt = (text, len = 120) => {
  const t = str(text).replace(/\s+/g, ' ');
  return t.length > len ? `${t.slice(0, len - 1)}…` : t;
};

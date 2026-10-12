import { publishDueAnnouncements } from './services/announcements.js';
import { expireStalePayments } from './services/payments.js';
import { refreshOverdueBills } from './routes/owner.finance.routes.js';
import { purgeExpiredSessions } from './lib/auth.js';

/**
 * Tugas berkala:
 *  1. Menerbitkan pengumuman yang sudah tiba waktu jadwalnya.
 *  2. Menandai transaksi pembayaran yang kedaluwarsa.
 *  3. Menandai tagihan yang melewati jatuh tempo menjadi "terlambat".
 *  4. Membersihkan sesi login yang sudah kedaluwarsa.
 *
 * Di Vercel tidak ada proses yang hidup terus, sehingga tugas ini dijalankan
 * dengan dua cara yang saling melengkapi:
 *
 *   • maybeRunTick() — dipanggil saat ada kunjungan, dibatasi paling sering
 *     sekali per TICK_THROTTLE_MS. Inilah yang membuat pengumuman terjadwal
 *     terbit tepat waktu selama ada pengunjung.
 *   • GET /api/cron/tick — dipanggil Vercel Cron sekali sehari sebagai jaring
 *     pengaman bila situs sedang sepi (paket Hobby membatasi cron 1x/hari).
 */

const TICK_THROTTLE_MS = 30_000;

let lastRun = 0;
let inFlight = null;

export async function runTick() {
  const result = {
    published: [],
    expiredPayments: 0,
    overdueBills: 0,
    purgedSessions: 0,
  };

  try {
    result.published = await publishDueAnnouncements();
    result.expiredPayments = await expireStalePayments();
    result.overdueBills = await refreshOverdueBills();
    result.purgedSessions = await purgeExpiredSessions();
  } catch (err) {
    console.error('[scheduler] gagal menjalankan tugas berkala:', err.message);
    result.error = err.message;
  }

  return result;
}

/**
 * Jalankan tugas berkala bila sudah waktunya. Aman dipanggil pada setiap
 * request: ada throttle berbasis waktu dan penjaga agar tidak berjalan ganda.
 */
export async function maybeRunTick() {
  if (Date.now() - lastRun < TICK_THROTTLE_MS) return null;
  if (inFlight) return inFlight;

  lastRun = Date.now();
  inFlight = runTick().finally(() => { inFlight = null; });
  return inFlight;
}

/** Middleware Express: menjalankan tugas berkala tanpa menggagalkan request. */
export const schedulerMiddleware = async (_req, _res, next) => {
  try {
    await maybeRunTick();
  } catch (err) {
    console.error('[scheduler] diabaikan:', err.message);
  }
  next();
};

/**
 * Dipakai hanya saat dijalankan sebagai server biasa (npm start / pengujian),
 * bukan di Vercel.
 */
export function startScheduler() {
  runTick();
  const timer = setInterval(runTick, TICK_THROTTLE_MS);
  timer.unref?.();
  return timer;
}

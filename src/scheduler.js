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
 */

const TICK_MS = 30_000;

export async function runTick({ verbose = false } = {}) {
  const result = {
    published: [],
    expiredPayments: 0,
    overdueBills: 0,
    purgedSessions: 0,
  };

  try {
    result.published = await publishDueAnnouncements();
    result.expiredPayments = expireStalePayments();
    result.overdueBills = refreshOverdueBills();
    result.purgedSessions = purgeExpiredSessions();
  } catch (err) {
    console.error('[scheduler] gagal menjalankan tugas berkala:', err.message);
  }

  if (verbose && result.published.length) {
    for (const p of result.published) {
      console.log(`[scheduler] pengumuman #${p.id} terbit ke ${p.recipients} penyewa`);
    }
  }
  return result;
}

export function startScheduler() {
  // Jalankan sekali saat start agar jadwal yang terlewat saat server mati ikut terbit.
  runTick({ verbose: true });
  const timer = setInterval(() => runTick({ verbose: true }), TICK_MS);
  timer.unref?.();
  return timer;
}

/**
 * Server biasa untuk pengembangan lokal dan pengujian otomatis.
 * Di Vercel, yang dipakai adalah api/index.js (fungsi serverless).
 */
import path from 'node:path';
import { config, ROOT } from './config.js';
import { isRemote } from './db.js';
import { createApp, ensureReady } from './app.js';
import { startScheduler } from './scheduler.js';

const app = createApp();

const server = app.listen(config.port, async () => {
  // Siapkan skema & data demo lebih dulu agar log "data demo" muncul rapi.
  let seeded = false;
  try {
    await ensureReady();
    const { wasSeeded } = await import('./seed.js');
    seeded = wasSeeded();
  } catch (err) {
    console.error('[start] gagal menyiapkan database:', err.message);
  }

  const line = '─'.repeat(58);
  console.log(`\n${line}`);
  console.log('  Komen — Kos Manajemen');
  console.log(line);
  console.log(`  Kos        : ${config.kost.name}`);
  console.log(`  URL        : http://localhost:${config.port}`);
  console.log(`  Database   : ${isRemote ? 'Turso (remote)' : path.relative(ROOT, config.dbPath)}`);
  console.log(`  WhatsApp   : ${config.wa.provider}${config.wa.token ? '' : ' (simulasi)'}`);
  console.log(`  Pembayaran : ${config.payment.provider}`);
  if (seeded) console.log('  Data demo  : baru dibuat (lihat README untuk akun login)');
  console.log(`${line}\n`);

  startScheduler();
});

const shutdown = (signal) => {
  console.log(`\n[${signal}] menutup server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;

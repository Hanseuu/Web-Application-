import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, ROOT } from './config.js';
import { db } from './db.js';
import { attachUser, requireAuth, requireRole } from './lib/auth.js';
import { HttpError } from './lib/helpers.js';
import { startScheduler } from './scheduler.js';
import { ensureSeed } from './seed.js';

import authRoutes from './routes/auth.routes.js';
import ownerTenantsRoutes from './routes/owner.tenants.routes.js';
import ownerPropertyRoutes from './routes/owner.property.routes.js';
import ownerAnnouncementsRoutes from './routes/owner.announcements.routes.js';
import ownerComplaintsRoutes from './routes/owner.complaints.routes.js';
import ownerFinanceRoutes from './routes/owner.finance.routes.js';
import tenantBillsRoutes from './routes/tenant.bills.routes.js';
import tenantComplaintsRoutes from './routes/tenant.complaints.routes.js';
import tenantInfoRoutes from './routes/tenant.info.routes.js';
import chatRoutes from './routes/chat.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import webhookRoutes from './routes/webhooks.routes.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// rawBody disimpan untuk verifikasi signature webhook.
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

/* -------------------------------------------------------------------------- */
/* File statis                                                                */
/* -------------------------------------------------------------------------- */
app.use(express.static(config.publicDir, { extensions: ['html'] }));
// Foto bukti kerusakan, denah, dan foto fasilitas.
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'Komen (Kos Manajemen)',
    kost: config.kost.name,
    time: new Date().toISOString(),
    database: path.relative(ROOT, config.dbPath),
    providers: { whatsapp: config.wa.provider, payment: config.payment.provider },
  });
});

app.use('/api/auth', authRoutes);

// Webhook payment gateway (tanpa sesi login, diamankan dengan signature).
app.use('/api/webhooks', webhookRoutes);

// Area pemilik kos
app.use('/api/owner', requireRole('owner'), ownerTenantsRoutes);
app.use('/api/owner', requireRole('owner'), ownerPropertyRoutes);
app.use('/api/owner', requireRole('owner'), ownerAnnouncementsRoutes);
app.use('/api/owner', requireRole('owner'), ownerComplaintsRoutes);
app.use('/api/owner', requireRole('owner'), ownerFinanceRoutes);

// Area penyewa
app.use('/api/tenant', requireRole('tenant'), tenantBillsRoutes);
app.use('/api/tenant', requireRole('tenant'), tenantComplaintsRoutes);
app.use('/api/tenant', requireRole('tenant'), tenantInfoRoutes);

// Fitur bersama (navigasi: Home, Chat, Profil)
app.use('/api/chat', requireAuth, chatRoutes);
app.use('/api/notifications', requireAuth, notificationsRoutes);

/* -------------------------------------------------------------------------- */
/* Fallback                                                                   */
/* -------------------------------------------------------------------------- */
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

// Semua rute non-API diarahkan ke halaman login (SPA memakai hash routing).
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return res.sendFile(path.join(config.publicDir, 'index.html'));
});

/* -------------------------------------------------------------------------- */
/* Error handler                                                              */
/* -------------------------------------------------------------------------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err instanceof HttpError ? err.status : err.status || 500;

  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, '\n', err);
  }

  // Pelanggaran constraint SQLite diterjemahkan ke pesan yang ramah.
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'Data tersebut sudah ada (duplikat).' });
  }
  if (err.code?.startsWith?.('SQLITE_CONSTRAINT')) {
    return res.status(400).json({ error: 'Data tidak memenuhi aturan database.', detail: err.message });
  }

  return res.status(status).json({
    error: status >= 500 ? 'Terjadi kesalahan pada server.' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
});

/* -------------------------------------------------------------------------- */
/* Start                                                                      */
/* -------------------------------------------------------------------------- */
const seeded = ensureSeed();
startScheduler();

const server = app.listen(config.port, () => {
  const line = '─'.repeat(58);
  console.log(`\n${line}`);
  console.log('  Komen — Kos Manajemen');
  console.log(line);
  console.log(`  Kos        : ${config.kost.name}`);
  console.log(`  URL        : http://localhost:${config.port}`);
  console.log(`  Database   : ${path.relative(ROOT, config.dbPath)}`);
  console.log(`  WhatsApp   : ${config.wa.provider}${config.wa.token ? '' : ' (simulasi)'}`);
  console.log(`  Pembayaran : ${config.payment.provider}`);
  if (seeded) console.log('  Data demo  : baru dibuat (lihat README untuk akun login)');
  console.log(`${line}\n`);
});

const shutdown = (signal) => {
  console.log(`\n[${signal}] menutup server...`);
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;

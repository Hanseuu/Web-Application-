import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, ROOT } from './config.js';
import { migrate, isRemote } from './db.js';
import { attachUser, requireAuth, requireRole } from './lib/auth.js';
import { HttpError, asyncHandler } from './lib/helpers.js';
import { schedulerMiddleware } from './scheduler.js';
import { ensureSeed } from './seed.js';

import authRoutes from './routes/auth.routes.js';
import imagesRoutes from './routes/images.routes.js';
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

/* -------------------------------------------------------------------------- */
/* Inisialisasi sekali per instance                                           */
/* -------------------------------------------------------------------------- */

let readyPromise = null;

/**
 * Menyiapkan skema dan data demo. Fungsi serverless bisa dimulai berkali-kali,
 * jadi hasilnya di-cache per instance dan seeding dijaga agar tidak dobel.
 */
export function ensureReady() {
  readyPromise ??= (async () => {
    await migrate();
    await ensureSeed();
  })().catch((err) => {
    // Reset agar percobaan berikutnya bisa mencoba lagi (mis. kedip jaringan).
    readyPromise = null;
    throw err;
  });
  return readyPromise;
}

/* -------------------------------------------------------------------------- */
/* App                                                                        */
/* -------------------------------------------------------------------------- */

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // rawBody disimpan untuk verifikasi signature webhook.
  app.use(express.json({
    limit: '2mb',
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());

  // Berkas statis (HTML, CSS, JS frontend).
  app.use(express.static(config.publicDir, { extensions: ['html'] }));

  // Siapkan database sebelum rute apa pun menyentuhnya.
  app.use(asyncHandler(async (_req, _res, next) => {
    await ensureReady();
    next();
  }));

  app.use(attachUser);

  /* ---------------------------------------------------------------- health */
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'Komen (Kos Manajemen)',
      kost: config.kost.name,
      time: new Date().toISOString(),
      database: isRemote ? 'turso' : path.relative(ROOT, config.dbPath),
      providers: { whatsapp: config.wa.provider, payment: config.payment.provider },
    });
  });

  /* ------------------------------------------------------------------ api */
  app.use('/api/auth', authRoutes);

  // Gambar (foto komplain, denah, fasilitas) tersimpan di database.
  app.use('/api/images', imagesRoutes);

  // Webhook payment gateway + endpoint cron (tanpa sesi login).
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/cron', webhookRoutes);

  // Tugas berkala dijalankan hemat saat ada kunjungan ke area aplikasi.
  app.use('/api/owner', schedulerMiddleware);
  app.use('/api/tenant', schedulerMiddleware);

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

  /* ------------------------------------------------------------- fallback */
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
  });

  // Semua rute non-API diarahkan ke halaman login (SPA memakai hash routing).
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    return res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  /* -------------------------------------------------------- error handler */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err instanceof HttpError ? err.status : err.status || 500;

    if (status >= 500) {
      console.error('[error]', req.method, req.originalUrl, '\n', err);
    }

    // Pelanggaran constraint SQLite diterjemahkan ke pesan yang ramah.
    const message = String(err.message || '');
    if (/UNIQUE constraint failed/i.test(message)) {
      return res.status(409).json({ error: 'Data tersebut sudah ada (duplikat).' });
    }
    if (/constraint failed/i.test(message)) {
      return res.status(400).json({ error: 'Data tidak memenuhi aturan database.', detail: message });
    }

    return res.status(status).json({
      error: status >= 500 ? 'Terjadi kesalahan pada server.' : err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  });

  return app;
}

export default createApp;

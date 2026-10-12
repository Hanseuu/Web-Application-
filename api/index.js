/**
 * Titik masuk fungsi serverless Vercel.
 *
 * Seluruh permintaan diarahkan ke berkas ini lewat `rewrites` di vercel.json,
 * lalu ditangani oleh aplikasi Express yang sama seperti saat dijalankan lokal.
 * Aplikasi Express adalah fungsi (req, res), sehingga bisa langsung dipakai
 * sebagai handler.
 */
import { createApp } from '../src/app.js';

const app = createApp();

export default app;

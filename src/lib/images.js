import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { HttpError, str } from './helpers.js';

/**
 * Penyimpanan gambar di database.
 *
 * Vercel menjalankan fungsi serverless dengan filesystem sementara, sehingga
 * berkas yang diunggah tidak dapat disimpan di disk. Gambar karena itu
 * disimpan sebagai base64 di tabel `images` dan dilayani lewat
 * GET /api/images/:id
 *
 * Ukuran dijaga kecil dari dua sisi:
 *   1. Browser mengecilkan gambar sebelum mengunggah (public/js/core.js)
 *   2. Server menolak gambar di atas config.maxImageBytes
 */

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED.has(file.mimetype)) {
    return cb(new HttpError(400, 'Format gambar harus JPG, PNG, WEBP, atau GIF.'));
  }
  return cb(null, true);
};

// Semua unggahan ditahan di memori lalu dipindahkan ke database.
const memory = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: config.maxImageBytes, files: config.maxImagesPerReport },
});

export const uploadComplaintPhotos = memory.array('photos', config.maxImagesPerReport);
export const uploadFloorplanImage = memory.single('image');
export const uploadFacilityPhoto = memory.single('photo');

/** Bungkus middleware multer agar pesan error-nya ramah. */
export const handleUpload = (mw) => (req, res, next) =>
  mw(req, res, (err) => {
    if (!err) return next();
    if (err instanceof HttpError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      const mb = (config.maxImageBytes / 1_000_000).toFixed(1);
      return next(new HttpError(400, `Ukuran gambar maksimal ${mb} MB setelah dikecilkan browser.`));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(new HttpError(400, `Maksimal ${config.maxImagesPerReport} gambar per laporan.`));
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new HttpError(400, `Field file tidak dikenali: ${err.field}`));
    }
    return next(new HttpError(400, `Gagal mengunggah gambar: ${err.message}`));
  });

/**
 * Simpan berkas hasil multer ke database.
 * @returns {Promise<string|null>} URL publik, mis. "/api/images/12"
 */
export async function saveImage(file, kind = 'umum') {
  if (!file?.buffer?.length) return null;

  if (file.buffer.length > config.maxImageBytes) {
    const mb = (config.maxImageBytes / 1_000_000).toFixed(1);
    throw new HttpError(400, `Ukuran gambar maksimal ${mb} MB.`);
  }

  const info = await db
    .prepare(
      'INSERT INTO images (kind, mime, bytes, data, original_name) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      kind,
      file.mimetype,
      file.buffer.length,
      file.buffer.toString('base64'),
      str(file.originalname, 160)
    );

  return `/api/images/${info.lastInsertRowid}`;
}

/** Simpan banyak gambar sekaligus. */
export const saveImages = (files, kind) =>
  Promise.all((files || []).map((f) => saveImage(f, kind)));

/** Ambil id dari URL "/api/images/12". */
export const imageIdFromUrl = (url) => {
  const m = /^\/api\/images\/(\d+)$/.exec(String(url || ''));
  return m ? Number(m[1]) : null;
};

/** Hapus gambar saat diganti atau dibuang; aman bila URL bukan gambar DB. */
export async function removeImage(url) {
  const id = imageIdFromUrl(url);
  if (!id) return;
  await db.prepare('DELETE FROM images WHERE id = ?').run(id);
}

/** Data gambar untuk dilayani ke browser. */
export async function getImage(id) {
  const row = await db
    .prepare('SELECT mime, data, bytes FROM images WHERE id = ?')
    .get(Number(id));
  if (!row) return null;
  return { mime: row.mime, buffer: Buffer.from(row.data, 'base64'), bytes: row.bytes };
}

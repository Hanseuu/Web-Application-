import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { HttpError } from './helpers.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']);
const MAX_SIZE = 6 * 1024 * 1024; // 6 MB per gambar

const ensureDir = (sub) => {
  const dir = path.join(config.uploadDir, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const storageFor = (sub) =>
  multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureDir(sub)),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 10);
      const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
    },
  });

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED.has(file.mimetype)) {
    return cb(new HttpError(400, 'Format gambar harus JPG, PNG, WEBP, atau GIF.'));
  }
  return cb(null, true);
};

/** Upload beberapa foto bukti kerusakan (field: "photos"). */
export const uploadComplaintPhotos = multer({
  storage: storageFor('complaints'),
  fileFilter,
  limits: { fileSize: MAX_SIZE, files: 5 },
}).array('photos', 5);

/** Upload satu gambar denah lantai (field: "image"). */
export const uploadFloorplanImage = multer({
  storage: storageFor('floorplans'),
  fileFilter,
  limits: { fileSize: MAX_SIZE, files: 1 },
}).single('image');

/** Upload satu foto fasilitas (field: "photo"). */
export const uploadFacilityPhoto = multer({
  storage: storageFor('facilities'),
  fileFilter,
  limits: { fileSize: MAX_SIZE, files: 1 },
}).single('photo');

/** Ubah path absolut hasil multer menjadi URL publik (/uploads/...). */
export const toPublicPath = (file) => {
  if (!file) return null;
  const rel = path.relative(config.uploadDir, file.path).split(path.sep).join('/');
  return `/uploads/${rel}`;
};

/** Hapus file lama saat diganti/di-delete; aman bila file tidak ada. */
export function removeUpload(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const rel = publicPath.replace('/uploads/', '');
  const full = path.resolve(config.uploadDir, rel);
  // Jaga-jaga terhadap path traversal.
  if (!full.startsWith(path.resolve(config.uploadDir))) return;
  fs.promises.unlink(full).catch(() => {});
}

/** Bungkus middleware multer agar error-nya rapi (mis. ukuran terlalu besar). */
export const handleUpload = (mw) => (req, res, next) =>
  mw(req, res, (err) => {
    if (!err) return next();
    if (err instanceof HttpError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'Ukuran gambar maksimal 6 MB.'));
    if (err.code === 'LIMIT_FILE_COUNT') return next(new HttpError(400, 'Maksimal 5 gambar per laporan.'));
    if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(new HttpError(400, `Field file tidak dikenali: ${err.field}`));
    return next(new HttpError(400, `Gagal mengunggah gambar: ${err.message}`));
  });

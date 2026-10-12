import { Router } from 'express';
import { asyncHandler, HttpError, int } from '../lib/helpers.js';
import { getImage } from '../lib/images.js';

const router = Router();

/**
 * GET /api/images/:id
 *
 * Melayani gambar yang tersimpan di database (foto bukti kerusakan, denah,
 * dan foto fasilitas). Di Vercel berkas tidak bisa disimpan di disk, jadi
 * gambar disimpan sebagai base64 di tabel `images`.
 *
 * Gambar bersifat tetap setelah diunggah, sehingga boleh di-cache lama.
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, 0);
    if (!id) throw new HttpError(400, 'Id gambar tidak valid.');

    const image = await getImage(id);
    if (!image) throw new HttpError(404, 'Gambar tidak ditemukan.');

    res.set({
      'Content-Type': image.mime,
      'Content-Length': String(image.buffer.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(image.buffer);
  })
);

export default router;

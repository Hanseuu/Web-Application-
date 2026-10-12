import { Router } from 'express';
import { db } from '../db.js';
import { config, COMPLAINT_STATUSES } from '../config.js';
import { asyncHandler, HttpError, requireFields, str, int, excerpt, nowSql } from '../lib/helpers.js';
import { handleUpload, uploadComplaintPhotos, saveImages } from '../lib/images.js';
import { notifyOwners } from '../services/notifications.js';
import { shapeComplaints, shapeOne, COMPLAINT_CATEGORIES } from './owner.complaints.routes.js';

const router = Router();

const MY_COMPLAINT_SELECT = `
  SELECT c.*, u.name AS tenant_name, u.phone AS tenant_phone, u.avatar_color,
         r.code AS room_code, r.floor AS room_floor
    FROM complaints c
    JOIN users u ON u.id = c.tenant_id
    LEFT JOIN rooms r ON r.id = c.room_id
`;

const LOCATIONS = [
  { code: 'kamar', label: 'Di dalam kamar saya' },
  { code: 'kamar_mandi', label: 'Kamar mandi' },
  { code: 'dapur', label: 'Dapur bersama' },
  { code: 'koridor', label: 'Koridor / tangga' },
  { code: 'parkir', label: 'Area parkir' },
  { code: 'umum', label: 'Area umum kos' },
];

/* -------------------------------------------------------------------------- */
/* GET /api/tenant/complaints - riwayat laporan saya                          */
/* -------------------------------------------------------------------------- */
router.get(
  '/complaints',
  asyncHandler(async (req, res) => {
    const rows = await db
      .prepare(`${MY_COMPLAINT_SELECT} WHERE c.tenant_id = ? ORDER BY c.id DESC`)
      .all(req.user.id);
    const complaints = await shapeComplaints(rows);

    res.json({
      complaints,
      summary: {
        baru: complaints.filter((c) => c.status === 'baru').length,
        diproses: complaints.filter((c) => c.status === 'diproses').length,
        selesai: complaints.filter((c) => c.status === 'selesai').length,
        total: complaints.length,
      },
      categories: COMPLAINT_CATEGORIES,
      locations: LOCATIONS,
      statuses: COMPLAINT_STATUSES,
      room: req.user.room_code ? { code: req.user.room_code, floor: req.user.room_floor } : null,
      maxPhotos: config.maxImagesPerReport,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/tenant/complaints  (multipart/form-data)                         */
/* Field: title, description, category, location, priority, photos[] (max 5)  */
/* Foto yang diunggah akan tampil di "Pusat Komplain" milik owner.            */
/* -------------------------------------------------------------------------- */
router.post(
  '/complaints',
  handleUpload(uploadComplaintPhotos),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['title', 'description']);

    const title = str(req.body.title, 160);
    const description = str(req.body.description, 3000);
    const category = str(req.body.category, 40) || 'lainnya';
    const location = str(req.body.location, 40) || 'kamar';
    const priority = ['rendah', 'sedang', 'tinggi'].includes(req.body.priority) ? req.body.priority : 'sedang';

    const info = await db
      .prepare(
        `INSERT INTO complaints (tenant_id, room_id, title, description, category, location, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'baru')`
      )
      .run(req.user.id, req.user.room_id, title, description, category, location, priority);

    const complaintId = Number(info.lastInsertRowid);

    // Simpan lampiran foto bukti kerusakan ke database.
    const files = req.files || [];
    const urls = await saveImages(files, 'complaint');

    const statements = urls
      .filter(Boolean)
      .map((url, i) => ({
        sql: 'INSERT INTO complaint_photos (complaint_id, file_path, original_name) VALUES (?, ?, ?)',
        args: [complaintId, url, str(files[i]?.originalname, 160)],
      }));

    statements.push({
      sql: 'INSERT INTO complaint_updates (complaint_id, author_id, status, note) VALUES (?, ?, ?, ?)',
      args: [
        complaintId, req.user.id, 'baru',
        `Laporan dibuat oleh penyewa${files.length ? ` dengan ${files.length} foto` : ''}.`,
      ],
    });

    await db.batch(statements);

    await notifyOwners({
      title: `Laporan baru dari kamar ${req.user.room_code || '-'}`,
      body: `${title} — ${excerpt(description, 120)}${files.length ? ` (${files.length} foto terlampir)` : ''}`,
      type: priority === 'tinggi' ? 'error' : 'warning',
      link: `#/owner/komplain?id=${complaintId}`,
    });

    const row = await db.prepare(`${MY_COMPLAINT_SELECT} WHERE c.id = ?`).get(complaintId);
    res.status(201).json({
      complaint: await shapeOne(row),
      message: `Laporan terkirim ke pemilik kos${files.length ? ` beserta ${files.length} foto` : ''}. Status: Baru.`,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/tenant/complaints/:id                                             */
/* -------------------------------------------------------------------------- */
router.get(
  '/complaints/:id',
  asyncHandler(async (req, res) => {
    const row = await db
      .prepare(`${MY_COMPLAINT_SELECT} WHERE c.id = ? AND c.tenant_id = ?`)
      .get(int(req.params.id), req.user.id);
    if (!row) throw new HttpError(404, 'Laporan tidak ditemukan.');
    res.json({ complaint: await shapeOne(row) });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/tenant/complaints/:id/notes - tambah keterangan susulan          */
/* -------------------------------------------------------------------------- */
router.post(
  '/complaints/:id/notes',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['note']);
    const id = int(req.params.id);
    const complaint = await db
      .prepare('SELECT * FROM complaints WHERE id = ? AND tenant_id = ?')
      .get(id, req.user.id);
    if (!complaint) throw new HttpError(404, 'Laporan tidak ditemukan.');

    const note = str(req.body.note, 1000);
    await db.batch([
      {
        sql: 'INSERT INTO complaint_updates (complaint_id, author_id, status, note) VALUES (?, ?, NULL, ?)',
        args: [id, req.user.id, note],
      },
      { sql: 'UPDATE complaints SET updated_at = ? WHERE id = ?', args: [nowSql(), id] },
    ]);

    await notifyOwners({
      title: `Keterangan tambahan pada laporan #${id}`,
      body: `${req.user.name} (kamar ${req.user.room_code || '-'}): ${excerpt(note, 140)}`,
      type: 'info',
      link: `#/owner/komplain?id=${id}`,
    });

    const row = await db.prepare(`${MY_COMPLAINT_SELECT} WHERE c.id = ?`).get(id);
    res.json({ complaint: await shapeOne(row), message: 'Keterangan tambahan terkirim.' });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/tenant/complaints/:id/photos - tambah foto ke laporan lama       */
/* -------------------------------------------------------------------------- */
router.post(
  '/complaints/:id/photos',
  handleUpload(uploadComplaintPhotos),
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const complaint = await db
      .prepare('SELECT * FROM complaints WHERE id = ? AND tenant_id = ?')
      .get(id, req.user.id);
    if (!complaint) throw new HttpError(404, 'Laporan tidak ditemukan.');

    const files = req.files || [];
    if (!files.length) throw new HttpError(400, 'Tidak ada gambar yang diunggah.');

    const urls = await saveImages(files, 'complaint');
    const statements = urls
      .filter(Boolean)
      .map((url, i) => ({
        sql: 'INSERT INTO complaint_photos (complaint_id, file_path, original_name) VALUES (?, ?, ?)',
        args: [id, url, str(files[i]?.originalname, 160)],
      }));
    statements.push({ sql: 'UPDATE complaints SET updated_at = ? WHERE id = ?', args: [nowSql(), id] });
    await db.batch(statements);

    await notifyOwners({
      title: `Foto baru pada laporan #${id}`,
      body: `${req.user.name} (kamar ${req.user.room_code || '-'}) menambahkan ${files.length} foto pada "${complaint.title}".`,
      type: 'info',
      link: `#/owner/komplain?id=${id}`,
    });

    const row = await db.prepare(`${MY_COMPLAINT_SELECT} WHERE c.id = ?`).get(id);
    res.json({ complaint: await shapeOne(row), message: `${files.length} foto ditambahkan.` });
  })
);

export default router;

import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler, HttpError, requireFields, str, int, excerpt } from '../lib/helpers.js';
import { handleUpload, uploadComplaintPhotos, toPublicPath } from '../lib/upload.js';
import { notifyOwners } from '../services/notifications.js';
import { shapeComplaint, COMPLAINT_CATEGORIES } from './owner.complaints.routes.js';
import { COMPLAINT_STATUSES } from '../config.js';

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
    const rows = db
      .prepare(`${MY_COMPLAINT_SELECT} WHERE c.tenant_id = ? ORDER BY c.id DESC`)
      .all(req.user.id);
    const complaints = rows.map((r) => shapeComplaint(r));

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

    const info = db
      .prepare(
        `INSERT INTO complaints (tenant_id, room_id, title, description, category, location, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'baru')`
      )
      .run(req.user.id, req.user.room_id, title, description, category, location, priority);

    const complaintId = Number(info.lastInsertRowid);

    // Simpan lampiran foto bukti kerusakan.
    const files = req.files || [];
    if (files.length) {
      const insertPhoto = db.prepare(
        'INSERT INTO complaint_photos (complaint_id, file_path, original_name) VALUES (?, ?, ?)'
      );
      db.transaction(() => {
        for (const f of files) {
          insertPhoto.run(complaintId, toPublicPath(f), str(f.originalname, 160));
        }
      })();
    }

    db.prepare('INSERT INTO complaint_updates (complaint_id, author_id, status, note) VALUES (?, ?, ?, ?)')
      .run(complaintId, req.user.id, 'baru', `Laporan dibuat oleh penyewa${files.length ? ` dengan ${files.length} foto` : ''}.`);

    notifyOwners({
      title: `Laporan baru dari kamar ${req.user.room_code || '-'}`,
      body: `${title} — ${excerpt(description, 120)}${files.length ? ` (${files.length} foto terlampir)` : ''}`,
      type: priority === 'tinggi' ? 'error' : 'warning',
      link: `#/owner/komplain?id=${complaintId}`,
    });

    const row = db.prepare(`${MY_COMPLAINT_SELECT} WHERE c.id = ?`).get(complaintId);
    res.status(201).json({
      complaint: shapeComplaint(row),
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
    const row = db
      .prepare(`${MY_COMPLAINT_SELECT} WHERE c.id = ? AND c.tenant_id = ?`)
      .get(int(req.params.id), req.user.id);
    if (!row) throw new HttpError(404, 'Laporan tidak ditemukan.');
    res.json({ complaint: shapeComplaint(row) });
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
    const complaint = db
      .prepare('SELECT * FROM complaints WHERE id = ? AND tenant_id = ?')
      .get(id, req.user.id);
    if (!complaint) throw new HttpError(404, 'Laporan tidak ditemukan.');

    const note = str(req.body.note, 1000);
    db.prepare('INSERT INTO complaint_updates (complaint_id, author_id, status, note) VALUES (?, ?, NULL, ?)')
      .run(id, req.user.id, note);
    db.prepare("UPDATE complaints SET updated_at = datetime('now') WHERE id = ?").run(id);

    notifyOwners({
      title: `Keterangan tambahan pada laporan #${id}`,
      body: `${req.user.name} (kamar ${req.user.room_code || '-'}): ${excerpt(note, 140)}`,
      type: 'info',
      link: `#/owner/komplain?id=${id}`,
    });

    res.json({
      complaint: shapeComplaint(db.prepare(`${MY_COMPLAINT_SELECT} WHERE c.id = ?`).get(id)),
      message: 'Keterangan tambahan terkirim.',
    });
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
    const complaint = db
      .prepare('SELECT * FROM complaints WHERE id = ? AND tenant_id = ?')
      .get(id, req.user.id);
    if (!complaint) throw new HttpError(404, 'Laporan tidak ditemukan.');

    const files = req.files || [];
    if (!files.length) throw new HttpError(400, 'Tidak ada gambar yang diunggah.');

    const insertPhoto = db.prepare(
      'INSERT INTO complaint_photos (complaint_id, file_path, original_name) VALUES (?, ?, ?)'
    );
    db.transaction(() => {
      for (const f of files) insertPhoto.run(id, toPublicPath(f), str(f.originalname, 160));
    })();
    db.prepare("UPDATE complaints SET updated_at = datetime('now') WHERE id = ?").run(id);

    notifyOwners({
      title: `Foto baru pada laporan #${id}`,
      body: `${req.user.name} (kamar ${req.user.room_code || '-'}) menambahkan ${files.length} foto pada "${complaint.title}".`,
      type: 'info',
      link: `#/owner/komplain?id=${id}`,
    });

    res.json({
      complaint: shapeComplaint(db.prepare(`${MY_COMPLAINT_SELECT} WHERE c.id = ?`).get(id)),
      message: `${files.length} foto ditambahkan.`,
    });
  })
);

export default router;

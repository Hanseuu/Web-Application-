import { Router } from 'express';
import { db } from '../db.js';
import { COMPLAINT_STATUSES } from '../config.js';
import { asyncHandler, HttpError, requireFields, str, int, bool, nowSql } from '../lib/helpers.js';
import { notify } from '../services/notifications.js';
import { sendWhatsApp, templates } from '../services/whatsapp.js';

const router = Router();

export const statusLabel = (code) =>
  COMPLAINT_STATUSES.find((s) => s.code === code)?.label || code;

export const COMPLAINT_CATEGORIES = [
  { code: 'listrik', label: 'Listrik', icon: '💡' },
  { code: 'air', label: 'Air & Saluran', icon: '🚰' },
  { code: 'furnitur', label: 'Furnitur', icon: '🪑' },
  { code: 'ac', label: 'AC / Kipas', icon: '❄️' },
  { code: 'internet', label: 'Internet / WiFi', icon: '📶' },
  { code: 'kunci', label: 'Kunci & Pintu', icon: '🔑' },
  { code: 'kebersihan', label: 'Kebersihan', icon: '🧹' },
  { code: 'keamanan', label: 'Keamanan', icon: '🔒' },
  { code: 'lainnya', label: 'Lainnya', icon: '🧰' },
];

const COMPLAINT_SELECT = `
  SELECT c.*, u.name AS tenant_name, u.phone AS tenant_phone, u.avatar_color,
         r.code AS room_code, r.floor AS room_floor
    FROM complaints c
    JOIN users u ON u.id = c.tenant_id
    LEFT JOIN rooms r ON r.id = c.room_id
`;

/** Lampiran foto bukti kerusakan -> ditampilkan di sisi owner. */
export const photosOf = (complaintId) =>
  db
    .prepare('SELECT id, file_path, original_name, uploaded_at FROM complaint_photos WHERE complaint_id = ? ORDER BY id')
    .all(complaintId)
    .map((p) => ({ id: p.id, url: p.file_path, originalName: p.original_name, uploadedAt: p.uploaded_at }));

export const updatesOf = (complaintId) =>
  db
    .prepare(
      `SELECT cu.id, cu.status, cu.note, cu.created_at, u.name AS author_name, u.role AS author_role
         FROM complaint_updates cu
    LEFT JOIN users u ON u.id = cu.author_id
        WHERE cu.complaint_id = ?
        ORDER BY cu.id`
    )
    .all(complaintId)
    .map((u) => ({
      id: u.id,
      status: u.status,
      statusLabel: u.status ? statusLabel(u.status) : null,
      note: u.note,
      createdAt: u.created_at,
      authorName: u.author_name || 'Sistem',
      authorRole: u.author_role || 'system',
    }));

export const shapeComplaint = (row, { withDetail = true } = {}) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  category: row.category,
  categoryIcon: COMPLAINT_CATEGORIES.find((c) => c.code === row.category)?.icon || '🧰',
  location: row.location,
  priority: row.priority,
  status: row.status,
  statusLabel: statusLabel(row.status),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  resolvedAt: row.resolved_at,
  tenant: {
    id: row.tenant_id,
    name: row.tenant_name,
    phone: row.tenant_phone || '',
    avatarColor: row.avatar_color,
  },
  roomCode: row.room_code || null,
  roomFloor: row.room_floor || null,
  photos: photosOf(row.id),
  updates: withDetail ? updatesOf(row.id) : [],
});

/* -------------------------------------------------------------------------- */
/* GET /api/owner/complaints - papan Baru / Diproses / Selesai               */
/* -------------------------------------------------------------------------- */
router.get(
  '/complaints',
  asyncHandler(async (req, res) => {
    const status = str(req.query.status, 20);
    const floor = int(req.query.floor, 0);
    const search = str(req.query.search, 60);

    const where = [];
    const params = [];
    if (status && status !== 'semua') {
      if (!COMPLAINT_STATUSES.some((s) => s.code === status)) {
        throw new HttpError(400, 'Status komplain tidak valid.');
      }
      where.push('c.status = ?');
      params.push(status);
    }
    if (floor) {
      where.push('r.floor = ?');
      params.push(floor);
    }
    if (search) {
      where.push('(c.title LIKE ? OR c.description LIKE ? OR u.name LIKE ? OR r.code LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const sql =
      `${COMPLAINT_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ` +
      `ORDER BY CASE c.status WHEN 'baru' THEN 0 WHEN 'diproses' THEN 1 ELSE 2 END, ` +
      `CASE c.priority WHEN 'tinggi' THEN 0 WHEN 'sedang' THEN 1 ELSE 2 END, c.created_at DESC`;

    const rows = db.prepare(sql).all(...params);
    const complaints = rows.map((r) => shapeComplaint(r));

    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'baru'     THEN 1 ELSE 0 END) AS baru,
           SUM(CASE WHEN status = 'diproses' THEN 1 ELSE 0 END) AS diproses,
           SUM(CASE WHEN status = 'selesai'  THEN 1 ELSE 0 END) AS selesai
         FROM complaints`
      )
      .get();

    res.json({
      complaints,
      board: {
        baru: complaints.filter((c) => c.status === 'baru'),
        diproses: complaints.filter((c) => c.status === 'diproses'),
        selesai: complaints.filter((c) => c.status === 'selesai'),
      },
      summary: {
        baru: counts.baru || 0,
        diproses: counts.diproses || 0,
        selesai: counts.selesai || 0,
        total: (counts.baru || 0) + (counts.diproses || 0) + (counts.selesai || 0),
      },
      statuses: COMPLAINT_STATUSES,
      categories: COMPLAINT_CATEGORIES,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/owner/complaints/:id                                              */
/* -------------------------------------------------------------------------- */
router.get(
  '/complaints/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare(`${COMPLAINT_SELECT} WHERE c.id = ?`).get(int(req.params.id));
    if (!row) throw new HttpError(404, 'Laporan tidak ditemukan.');
    res.json({ complaint: shapeComplaint(row) });
  })
);

/* -------------------------------------------------------------------------- */
/* PATCH /api/owner/complaints/:id/status                                     */
/* Body: status (baru|diproses|selesai), note?, sendWhatsapp?                 */
/* -------------------------------------------------------------------------- */
router.patch(
  '/complaints/:id/status',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['status']);
    const id = int(req.params.id);
    const status = str(req.body.status, 20);
    const note = str(req.body.note, 1000);

    if (!COMPLAINT_STATUSES.some((s) => s.code === status)) {
      throw new HttpError(400, 'Status harus salah satu dari: baru, diproses, selesai.');
    }

    const current = db.prepare(`${COMPLAINT_SELECT} WHERE c.id = ?`).get(id);
    if (!current) throw new HttpError(404, 'Laporan tidak ditemukan.');

    const stamp = nowSql();
    db.prepare(
      `UPDATE complaints
          SET status = ?, updated_at = ?, resolved_at = CASE WHEN ? = 'selesai' THEN ? ELSE NULL END
        WHERE id = ?`
    ).run(status, stamp, status, stamp, id);

    db.prepare('INSERT INTO complaint_updates (complaint_id, author_id, status, note) VALUES (?, ?, ?, ?)')
      .run(id, req.user.id, status, note || `Status diubah menjadi "${statusLabel(status)}".`);

    notify({
      userId: current.tenant_id,
      title: `Laporan #${id}: ${statusLabel(status)}`,
      body: note || `Laporan "${current.title}" sekarang berstatus ${statusLabel(status)}.`,
      type: status === 'selesai' ? 'success' : 'info',
      link: `#/penyewa/lapor?id=${id}`,
    });

    let wa = null;
    if (bool(req.body.sendWhatsapp) && current.tenant_phone) {
      wa = await sendWhatsApp({
        userId: current.tenant_id,
        phone: current.tenant_phone,
        kind: 'komplain',
        message: templates.komplainUpdate({
          tenant: { name: current.tenant_name },
          complaint: current,
          statusLabel: statusLabel(status),
          note,
        }),
      });
    }

    const fresh = db.prepare(`${COMPLAINT_SELECT} WHERE c.id = ?`).get(id);
    res.json({
      complaint: shapeComplaint(fresh),
      whatsapp: wa,
      message: `Laporan #${id} diperbarui ke status "${statusLabel(status)}".`,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/owner/complaints/:id/notes - tambah catatan tanpa ubah status    */
/* -------------------------------------------------------------------------- */
router.post(
  '/complaints/:id/notes',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['note']);
    const id = int(req.params.id);
    const current = db.prepare(`${COMPLAINT_SELECT} WHERE c.id = ?`).get(id);
    if (!current) throw new HttpError(404, 'Laporan tidak ditemukan.');

    const note = str(req.body.note, 1000);
    db.prepare('INSERT INTO complaint_updates (complaint_id, author_id, status, note) VALUES (?, ?, NULL, ?)')
      .run(id, req.user.id, note);
    db.prepare('UPDATE complaints SET updated_at = ? WHERE id = ?').run(nowSql(), id);

    notify({
      userId: current.tenant_id,
      title: `Catatan baru pada laporan #${id}`,
      body: note,
      type: 'info',
      link: `#/penyewa/lapor?id=${id}`,
    });

    res.json({ complaint: shapeComplaint(db.prepare(`${COMPLAINT_SELECT} WHERE c.id = ?`).get(id)), message: 'Catatan ditambahkan.' });
  })
);

export default router;

import { Router } from 'express';
import { db } from '../db.js';
import { ANNOUNCEMENT_TARGETS } from '../config.js';
import {
  asyncHandler, HttpError, requireFields, str, int, bool, toSqlDateTime, nowSql,
} from '../lib/helpers.js';
import {
  publishAnnouncement, recipientsFor, shapeAnnouncement, targetLabel,
} from '../services/announcements.js';

const router = Router();

const ANN_SELECT = `
  SELECT a.*, u.name AS author_name,
         (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count
    FROM announcements a
    LEFT JOIN users u ON u.id = a.created_by
`;

const CATEGORIES = [
  { code: 'informasi', label: 'Informasi', icon: 'ℹ️' },
  { code: 'pembayaran', label: 'Pembayaran', icon: '💰' },
  { code: 'perbaikan', label: 'Perbaikan & Maintenance', icon: '🔧' },
  { code: 'kebersihan', label: 'Kebersihan', icon: '🧹' },
  { code: 'keamanan', label: 'Keamanan', icon: '🔒' },
  { code: 'acara', label: 'Acara / Kegiatan', icon: '🎉' },
  { code: 'penting', label: 'Penting', icon: '⚠️' },
];

/** Jumlah penerima untuk setiap target, dihitung sekali lalu dipakai ulang. */
async function recipientCounts() {
  const entries = await Promise.all(
    ANNOUNCEMENT_TARGETS.map(async (t) => [t.code, (await recipientsFor(t.code)).length])
  );
  return Object.fromEntries(entries);
}

/* -------------------------------------------------------------------------- */
/* GET /api/owner/announcements                                               */
/* -------------------------------------------------------------------------- */
router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const status = str(req.query.status, 20); // terjadwal | terbit | arsip
    const where = status ? ' WHERE a.status = ?' : '';

    const [rows, counts, perTarget] = await Promise.all([
      db
        .prepare(
          `${ANN_SELECT}${where} ORDER BY a.is_pinned DESC, COALESCE(a.published_at, a.scheduled_at, a.created_at) DESC`
        )
        .all(...(status ? [status] : [])),
      db
        .prepare(
          `SELECT
             SUM(CASE WHEN status = 'terbit'    THEN 1 ELSE 0 END) AS terbit,
             SUM(CASE WHEN status = 'terjadwal' THEN 1 ELSE 0 END) AS terjadwal,
             SUM(CASE WHEN status = 'arsip'     THEN 1 ELSE 0 END) AS arsip
           FROM announcements`
        )
        .get(),
      recipientCounts(),
    ]);

    res.json({
      announcements: rows.map((row) => ({
        ...shapeAnnouncement(row),
        recipientCount: perTarget[row.target] ?? 0,
      })),
      targets: ANNOUNCEMENT_TARGETS.map((t) => ({ ...t, recipientCount: perTarget[t.code] ?? 0 })),
      categories: CATEGORIES,
      summary: {
        terbit: counts.terbit || 0,
        terjadwal: counts.terjadwal || 0,
        arsip: counts.arsip || 0,
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/owner/announcements                                              */
/* Body: title, body, target, category, scheduledAt?, sendWhatsapp?, isPinned?*/
/* Tanpa scheduledAt -> langsung terbit. Dengan scheduledAt -> terjadwal.     */
/* -------------------------------------------------------------------------- */
router.post(
  '/announcements',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['title', 'body', 'target']);

    const title = str(req.body.title, 160);
    const body = str(req.body.body, 5000);
    const target = str(req.body.target, 20);
    if (!ANNOUNCEMENT_TARGETS.some((t) => t.code === target)) {
      throw new HttpError(
        400,
        `Target pengumuman tidak valid. Pilihan: ${ANNOUNCEMENT_TARGETS.map((t) => t.code).join(', ')}.`
      );
    }

    // Jadwal: kosong = terbitkan sekarang.
    let scheduledAt = null;
    let status = 'terbit';
    if (str(req.body.scheduledAt, 40)) {
      scheduledAt = toSqlDateTime(req.body.scheduledAt);
      if (!scheduledAt) throw new HttpError(400, 'Format tanggal jadwal tidak valid.');
      if (scheduledAt > nowSql()) {
        status = 'terjadwal';
      } else {
        // Jadwal di masa lalu -> langsung terbitkan.
        scheduledAt = null;
      }
    }

    const recipients = await recipientsFor(target);
    if (!recipients.length) {
      throw new HttpError(400, `Tidak ada penyewa aktif pada target "${targetLabel(target)}".`);
    }

    const info = await db
      .prepare(
        `INSERT INTO announcements
           (title, body, target, category, status, is_pinned, send_whatsapp, scheduled_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        title, body, target,
        str(req.body.category, 40) || 'informasi',
        status,
        bool(req.body.isPinned) ? 1 : 0,
        bool(req.body.sendWhatsapp) ? 1 : 0,
        scheduledAt,
        req.user.id
      );

    const id = Number(info.lastInsertRowid);
    let delivery = null;
    if (status === 'terbit') {
      delivery = await publishAnnouncement(id);
    }

    const row = await db.prepare(`${ANN_SELECT} WHERE a.id = ?`).get(id);
    res.status(201).json({
      announcement: { ...shapeAnnouncement(row), recipientCount: recipients.length },
      delivery,
      message: status === 'terjadwal'
        ? `Pengumuman dijadwalkan dan akan otomatis terbit untuk ${recipients.length} penyewa (${targetLabel(target)}).`
        : `Pengumuman terbit ke ${recipients.length} penyewa (${targetLabel(target)}).`,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* PUT /api/owner/announcements/:id                                           */
/* -------------------------------------------------------------------------- */
router.put(
  '/announcements/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const current = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Pengumuman tidak ditemukan.');

    const target = str(req.body.target, 20) || current.target;
    if (!ANNOUNCEMENT_TARGETS.some((t) => t.code === target)) {
      throw new HttpError(400, 'Target pengumuman tidak valid.');
    }

    let scheduledAt = current.scheduled_at;
    let status = current.status;
    if (req.body.scheduledAt !== undefined) {
      if (!str(req.body.scheduledAt, 40)) {
        scheduledAt = null;
      } else {
        scheduledAt = toSqlDateTime(req.body.scheduledAt);
        if (!scheduledAt) throw new HttpError(400, 'Format tanggal jadwal tidak valid.');
      }
    }
    if (req.body.status && ['terjadwal', 'terbit', 'arsip'].includes(req.body.status)) {
      status = req.body.status;
    }

    await db
      .prepare(
        `UPDATE announcements
            SET title = ?, body = ?, target = ?, category = ?, status = ?, is_pinned = ?,
                send_whatsapp = ?, scheduled_at = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(
        str(req.body.title, 160) || current.title,
        req.body.body !== undefined ? str(req.body.body, 5000) : current.body,
        target,
        str(req.body.category, 40) || current.category,
        status,
        req.body.isPinned === undefined ? current.is_pinned : (bool(req.body.isPinned) ? 1 : 0),
        req.body.sendWhatsapp === undefined ? current.send_whatsapp : (bool(req.body.sendWhatsapp) ? 1 : 0),
        scheduledAt,
        nowSql(),
        id
      );

    const [row, recipients] = await Promise.all([
      db.prepare(`${ANN_SELECT} WHERE a.id = ?`).get(id),
      recipientsFor(target),
    ]);

    res.json({
      announcement: { ...shapeAnnouncement(row), recipientCount: recipients.length },
      message: 'Pengumuman berhasil diperbarui.',
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/owner/announcements/:id/publish - terbitkan sekarang             */
/* -------------------------------------------------------------------------- */
router.post(
  '/announcements/:id/publish',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const current = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Pengumuman tidak ditemukan.');
    if (current.status === 'terbit') throw new HttpError(409, 'Pengumuman ini sudah terbit.');

    const delivery = await publishAnnouncement(id);
    const row = await db.prepare(`${ANN_SELECT} WHERE a.id = ?`).get(id);

    res.json({
      announcement: { ...shapeAnnouncement(row), recipientCount: delivery.recipients },
      delivery,
      message: `Pengumuman diterbitkan ke ${delivery.recipients} penyewa.`,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/owner/announcements/:id/readers - siapa yang sudah membaca        */
/* -------------------------------------------------------------------------- */
router.get(
  '/announcements/:id/readers',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const ann = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (!ann) throw new HttpError(404, 'Pengumuman tidak ditemukan.');

    const [readers, all] = await Promise.all([
      db
        .prepare(
          `SELECT u.id, u.name, r.code AS room_code, ar.read_at
             FROM announcement_reads ar
             JOIN users u ON u.id = ar.user_id
        LEFT JOIN rooms r ON r.id = u.room_id
            WHERE ar.announcement_id = ?
            ORDER BY ar.read_at DESC`
        )
        .all(id),
      recipientsFor(ann.target),
    ]);

    const readIds = new Set(readers.map((r) => r.id));
    const pending = all.filter((r) => !readIds.has(r.id));

    res.json({
      readers: readers.map((r) => ({ id: r.id, name: r.name, roomCode: r.room_code, readAt: r.read_at })),
      pending: pending.map((r) => ({ id: r.id, name: r.name, roomCode: r.room_code })),
    });
  })
);

/* -------------------------------------------------------------------------- */
/* DELETE /api/owner/announcements/:id                                        */
/* -------------------------------------------------------------------------- */
router.delete(
  '/announcements/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const current = await db.prepare('SELECT title FROM announcements WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Pengumuman tidak ditemukan.');
    await db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
    res.json({ ok: true, message: `Pengumuman "${current.title}" dihapus.` });
  })
);

export default router;

import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import {
  asyncHandler, HttpError, str, int, daysUntil, formatRupiah, formatPeriode, formatTanggal,
} from '../lib/helpers.js';
import { shapeAnnouncement, isRecipient } from '../services/announcements.js';
import { buildFloorplans, listFacilities, listPlaces } from './owner.property.routes.js';
import { PLACE_CATEGORIES, nearbySearchUrl, categoryMeta } from '../services/maps.js';
import { refreshOverdueBills, BILL_STATUS_META } from './owner.finance.routes.js';

const router = Router();

/* ========================================================================== */
/* PENGUMUMAN                                                                 */
/* ========================================================================== */

/** Filter SQL: pengumuman terbit yang menyasar lantai penyewa ini. */
const targetClause = (user) => {
  const floor = user.room_floor;
  return {
    sql: "a.status = 'terbit' AND (a.target = 'semua'" + (floor ? ' OR a.target = ?' : '') + ')',
    params: floor ? [`lantai_${floor}`] : [],
  };
};

/* GET /api/tenant/announcements */
router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const { sql, params } = targetClause(req.user);

    const rows = db
      .prepare(
        `SELECT a.*, u.name AS author_name,
                EXISTS(SELECT 1 FROM announcement_reads ar
                        WHERE ar.announcement_id = a.id AND ar.user_id = ?) AS is_read
           FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
          WHERE ${sql}
          ORDER BY a.is_pinned DESC, a.published_at DESC`
      )
      .all(req.user.id, ...params);

    const announcements = rows.map(shapeAnnouncement);
    const unread = announcements.filter((a) => !a.isRead);

    res.json({
      announcements,
      unread,
      // Pengumuman terbaru yang belum dibaca -> dipakai untuk pop-up notifikasi.
      latestUnread: unread[0] || null,
      summary: { total: announcements.length, belumDibaca: unread.length },
    });
  })
);

/* POST /api/tenant/announcements/:id/read */
router.post(
  '/announcements/:id/read',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const ann = db.prepare("SELECT * FROM announcements WHERE id = ? AND status = 'terbit'").get(id);
    if (!ann) throw new HttpError(404, 'Pengumuman tidak ditemukan.');
    if (!isRecipient(req.user, ann.target)) {
      throw new HttpError(403, 'Pengumuman ini bukan untuk lantai Anda.');
    }

    db.prepare(
      `INSERT INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)
       ON CONFLICT(announcement_id, user_id) DO NOTHING`
    ).run(id, req.user.id);

    res.json({ ok: true });
  })
);

/* POST /api/tenant/announcements/read-all */
router.post(
  '/announcements/read-all',
  asyncHandler(async (req, res) => {
    const { sql, params } = targetClause(req.user);
    const ids = db.prepare(`SELECT a.id FROM announcements a WHERE ${sql}`).all(...params);
    const stmt = db.prepare(
      `INSERT INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)
       ON CONFLICT(announcement_id, user_id) DO NOTHING`
    );
    db.transaction(() => ids.forEach((r) => stmt.run(r.id, req.user.id)))();
    res.json({ ok: true, marked: ids.length });
  })
);

/* ========================================================================== */
/* FASILITAS (milik kos) + TEMPAT UMUM SEKITAR (Google Maps)                  */
/* ========================================================================== */

/* GET /api/tenant/facilities */
router.get(
  '/facilities',
  asyncHandler(async (req, res) => {
    const places = listPlaces({ onlyActive: true });

    // Kelompokkan tempat sekitar per kategori; tiap kategori juga punya
    // tautan pencarian Google Maps generik sebagai fallback.
    const nearby = PLACE_CATEGORIES.map((cat) => ({
      ...cat,
      searchUrl: nearbySearchUrl(cat.keyword),
      places: places.filter((p) => p.category === cat.code),
    })).filter((c) => c.places.length || true);

    // Kategori di luar daftar standar (bila owner menambah kategori sendiri).
    const extraCats = [...new Set(places.map((p) => p.category))].filter(
      (c) => !PLACE_CATEGORIES.some((pc) => pc.code === c)
    );
    for (const code of extraCats) {
      const meta = categoryMeta(code);
      nearby.push({ ...meta, searchUrl: nearbySearchUrl(meta.keyword), places: places.filter((p) => p.category === code) });
    }

    res.json({
      // Fasilitas yang dimiliki owner (dikelola di menu "Denah & Fasilitas")
      facilities: listFacilities({ onlyPublished: true }),
      // Denah lantai: penyewa melihat denah tanpa nama penghuni lain
      floorplans: buildFloorplans({ includeTenantNames: false }),
      myFloor: req.user.room_floor || null,
      myRoom: req.user.room_code || null,
      nearby,
      kost: config.kost,
    });
  })
);

/* GET /api/tenant/places - daftar datar tempat sekitar */
router.get(
  '/places',
  asyncHandler(async (req, res) => {
    const category = str(req.query.category, 40);
    const places = listPlaces({ onlyActive: true });
    res.json({
      places: category ? places.filter((p) => p.category === category) : places,
      categories: PLACE_CATEGORIES.map((c) => ({ ...c, searchUrl: nearbySearchUrl(c.keyword) })),
    });
  })
);

/* ========================================================================== */
/* BERANDA PENYEWA                                                            */
/* ========================================================================== */

/* GET /api/tenant/dashboard */
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    refreshOverdueBills();

    const bills = db
      .prepare(
        `SELECT * FROM bills
          WHERE tenant_id = ? AND status <> 'lunas'
          ORDER BY due_date LIMIT 5`
      )
      .all(req.user.id);

    const totals = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status <> 'lunas' THEN amount END), 0) AS belum,
           SUM(CASE WHEN status = 'terlambat' THEN 1 ELSE 0 END) AS jml_terlambat,
           SUM(CASE WHEN status = 'lunas' THEN 1 ELSE 0 END) AS jml_lunas
         FROM bills WHERE tenant_id = ?`
      )
      .get(req.user.id);

    const complaints = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'baru'     THEN 1 ELSE 0 END) AS baru,
           SUM(CASE WHEN status = 'diproses' THEN 1 ELSE 0 END) AS diproses,
           SUM(CASE WHEN status = 'selesai'  THEN 1 ELSE 0 END) AS selesai
         FROM complaints WHERE tenant_id = ?`
      )
      .get(req.user.id);

    const { sql, params } = targetClause(req.user);
    const announcements = db
      .prepare(
        `SELECT a.*, u.name AS author_name,
                EXISTS(SELECT 1 FROM announcement_reads ar
                        WHERE ar.announcement_id = a.id AND ar.user_id = ?) AS is_read
           FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
          WHERE ${sql}
          ORDER BY a.is_pinned DESC, a.published_at DESC LIMIT 5`
      )
      .all(req.user.id, ...params)
      .map(shapeAnnouncement);

    const unreadChats = db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE receiver_id = ? AND read_at IS NULL')
      .get(req.user.id).n;

    const nextBill = bills[0] || null;

    res.json({
      kost: config.kost,
      room: req.user.room_code
        ? {
          code: req.user.room_code,
          floor: req.user.room_floor,
          number: req.user.room_number,
          price: req.user.room_price,
          priceLabel: formatRupiah(req.user.room_price),
        }
        : null,
      checkInDate: req.user.check_in_date,
      checkInLabel: formatTanggal(req.user.check_in_date),
      nextBill: nextBill
        ? {
          id: nextBill.id,
          title: nextBill.title,
          amount: nextBill.amount,
          amountLabel: formatRupiah(nextBill.amount),
          period: nextBill.period,
          periodLabel: formatPeriode(nextBill.period),
          dueDate: nextBill.due_date,
          dueDateLabel: formatTanggal(nextBill.due_date),
          daysToDue: daysUntil(nextBill.due_date),
          status: nextBill.status,
          statusLabel: BILL_STATUS_META[nextBill.status]?.label || nextBill.status,
          statusTone: BILL_STATUS_META[nextBill.status]?.tone || 'muted',
        }
        : null,
      stats: {
        totalBelumBayar: totals.belum,
        totalBelumBayarLabel: formatRupiah(totals.belum),
        jumlahTerlambat: totals.jml_terlambat || 0,
        jumlahLunas: totals.jml_lunas || 0,
        complaints: {
          baru: complaints.baru || 0,
          diproses: complaints.diproses || 0,
          selesai: complaints.selesai || 0,
        },
        unreadChats,
        belumDibacaPengumuman: announcements.filter((a) => !a.isRead).length,
      },
      announcements,
      facilitiesCount: listFacilities({ onlyPublished: true }).length,
    });
  })
);

export default router;

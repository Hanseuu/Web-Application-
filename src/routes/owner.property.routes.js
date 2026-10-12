import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import {
  asyncHandler, HttpError, requireFields, str, int, bool, nowSql,
} from '../lib/helpers.js';
import {
  handleUpload, uploadFloorplanImage, uploadFacilityPhoto, saveImage, removeImage,
} from '../lib/images.js';
import { PLACE_CATEGORIES, placeUrl, directionsUrl, formatDistance } from '../services/maps.js';
import { notifyMany } from '../services/notifications.js';

const router = Router();

/* ========================================================================== */
/* DENAH                                                                      */
/* ========================================================================== */

/** Susunan kamar per lantai, dipakai untuk menggambar denah interaktif. */
async function roomLayout(floor) {
  const rows = await db
    .prepare(
      `SELECT r.id, r.code, r.number, r.price, r.size, r.notes,
              u.id AS tenant_id, u.name AS tenant_name, u.avatar_color
         FROM rooms r
    LEFT JOIN users u ON u.room_id = r.id AND u.role = 'tenant' AND u.status = 'aktif'
        WHERE r.floor = ?
        ORDER BY r.number`
    )
    .all(floor);

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    number: r.number,
    price: r.price,
    size: r.size || '',
    notes: r.notes || '',
    occupied: Boolean(r.tenant_id),
    tenant: r.tenant_id ? { id: r.tenant_id, name: r.tenant_name, avatarColor: r.avatar_color } : null,
  }));
}

/** Gabungan data denah: metadata yang diisi owner + susunan kamar dari DB. */
export async function buildFloorplans({ includeTenantNames = true } = {}) {
  return Promise.all(
    config.building.floors.map(async (floor) => {
      const [meta, layout] = await Promise.all([
        db.prepare('SELECT * FROM floorplans WHERE floor = ?').get(floor),
        roomLayout(floor),
      ]);

      const rooms = layout.map((r) =>
        includeTenantNames ? r : { ...r, tenant: r.occupied ? { name: 'Terisi' } : null }
      );

      return {
        floor,
        title: meta?.title || `Lantai ${floor}`,
        description: meta?.description || '',
        imagePath: meta?.image_path || null,
        updatedAt: meta?.updated_at || null,
        rooms,
        stats: {
          total: rooms.length,
          occupied: rooms.filter((r) => r.occupied).length,
          available: rooms.filter((r) => !r.occupied).length,
        },
      };
    })
  );
}

/* GET /api/owner/floorplans */
router.get(
  '/floorplans',
  asyncHandler(async (_req, res) => {
    res.json({
      floorplans: await buildFloorplans(),
      limits: { floors: config.building.floors, maxRoomsPerFloor: config.building.maxRoomsPerFloor },
    });
  })
);

/* PUT /api/owner/floorplans/:floor  (multipart/form-data, field gambar: "image") */
router.put(
  '/floorplans/:floor',
  handleUpload(uploadFloorplanImage),
  asyncHandler(async (req, res) => {
    const floor = int(req.params.floor);
    if (!config.building.floors.includes(floor)) {
      throw new HttpError(400, `Lantai tidak valid. Pilih ${config.building.floors.join(', ')}.`);
    }

    const existing = await db.prepare('SELECT * FROM floorplans WHERE floor = ?').get(floor);
    const title = str(req.body.title, 120) || existing?.title || `Lantai ${floor}`;
    const description = req.body.description !== undefined
      ? str(req.body.description, 3000)
      : existing?.description || '';

    let imagePath = existing?.image_path || null;
    if (req.file) {
      const saved = await saveImage(req.file, 'floorplan');
      if (imagePath) await removeImage(imagePath);
      imagePath = saved;
    } else if (bool(req.body.removeImage) && imagePath) {
      await removeImage(imagePath);
      imagePath = null;
    }

    if (existing) {
      await db
        .prepare('UPDATE floorplans SET title = ?, description = ?, image_path = ?, updated_at = ? WHERE floor = ?')
        .run(title, description, imagePath, nowSql(), floor);
    } else {
      await db
        .prepare('INSERT INTO floorplans (floor, title, description, image_path, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(floor, title, description, imagePath, nowSql());
    }

    res.json({
      floorplans: await buildFloorplans(),
      message: `Denah lantai ${floor} berhasil disimpan.`,
    });
  })
);

/* ========================================================================== */
/* FASILITAS                                                                  */
/* ========================================================================== */

const shapeFacility = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description || '',
  category: row.category,
  icon: row.icon,
  location: row.location || '',
  photoPath: row.photo_path || null,
  isPublished: Boolean(row.is_published),
  sortOrder: row.sort_order,
  updatedAt: row.updated_at,
});

export const listFacilities = async ({ onlyPublished = false } = {}) => {
  const rows = await db
    .prepare(
      `SELECT * FROM facilities${onlyPublished ? ' WHERE is_published = 1' : ''}
        ORDER BY sort_order, name`
    )
    .all();
  return rows.map(shapeFacility);
};

export const FACILITY_CATEGORIES = [
  { code: 'umum', label: 'Area Umum' },
  { code: 'kamar', label: 'Dalam Kamar' },
  { code: 'keamanan', label: 'Keamanan' },
  { code: 'parkir', label: 'Parkir' },
  { code: 'dapur', label: 'Dapur & Makan' },
  { code: 'kebersihan', label: 'Kebersihan' },
  { code: 'internet', label: 'Internet' },
];

/* GET /api/owner/facilities */
router.get(
  '/facilities',
  asyncHandler(async (_req, res) => {
    res.json({ facilities: await listFacilities(), categories: FACILITY_CATEGORIES });
  })
);

/* POST /api/owner/facilities  (field foto: "photo") */
router.post(
  '/facilities',
  handleUpload(uploadFacilityPhoto),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['name']);
    const maxRow = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM facilities').get();
    const photoPath = await saveImage(req.file, 'facility');

    const info = await db
      .prepare(
        `INSERT INTO facilities (name, description, category, icon, location, photo_path, is_published, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        str(req.body.name, 100),
        str(req.body.description, 1000),
        str(req.body.category, 40) || 'umum',
        str(req.body.icon, 10) || '🏠',
        str(req.body.location, 120),
        photoPath,
        req.body.isPublished === undefined ? 1 : (bool(req.body.isPublished) ? 1 : 0),
        maxRow.m + 1
      );

    const row = await db.prepare('SELECT * FROM facilities WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ facility: shapeFacility(row), message: 'Fasilitas berhasil ditambahkan.' });
  })
);

/* PUT /api/owner/facilities/:id */
router.put(
  '/facilities/:id',
  handleUpload(uploadFacilityPhoto),
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const current = await db.prepare('SELECT * FROM facilities WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Fasilitas tidak ditemukan.');

    let photoPath = current.photo_path;
    if (req.file) {
      const saved = await saveImage(req.file, 'facility');
      if (photoPath) await removeImage(photoPath);
      photoPath = saved;
    } else if (bool(req.body.removePhoto) && photoPath) {
      await removeImage(photoPath);
      photoPath = null;
    }

    await db
      .prepare(
        `UPDATE facilities
            SET name = ?, description = ?, category = ?, icon = ?, location = ?,
                photo_path = ?, is_published = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(
        str(req.body.name, 100) || current.name,
        req.body.description !== undefined ? str(req.body.description, 1000) : current.description,
        str(req.body.category, 40) || current.category,
        str(req.body.icon, 10) || current.icon,
        req.body.location !== undefined ? str(req.body.location, 120) : current.location,
        photoPath,
        req.body.isPublished === undefined ? current.is_published : (bool(req.body.isPublished) ? 1 : 0),
        nowSql(),
        id
      );

    const row = await db.prepare('SELECT * FROM facilities WHERE id = ?').get(id);
    res.json({ facility: shapeFacility(row), message: 'Fasilitas berhasil diperbarui.' });
  })
);

/* DELETE /api/owner/facilities/:id */
router.delete(
  '/facilities/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const current = await db.prepare('SELECT * FROM facilities WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Fasilitas tidak ditemukan.');
    if (current.photo_path) await removeImage(current.photo_path);
    await db.prepare('DELETE FROM facilities WHERE id = ?').run(id);
    res.json({ ok: true, message: `Fasilitas "${current.name}" dihapus.` });
  })
);

/* PUT /api/owner/facilities-order - body: { order: [id, id, ...] } */
router.put(
  '/facilities-order',
  asyncHandler(async (req, res) => {
    const order = Array.isArray(req.body.order) ? req.body.order.map((v) => int(v)) : [];
    if (!order.length) throw new HttpError(400, 'Daftar urutan kosong.');

    await db.batch(
      order.map((id, idx) => ({
        sql: 'UPDATE facilities SET sort_order = ? WHERE id = ?',
        args: [idx + 1, id],
      }))
    );

    res.json({ facilities: await listFacilities(), message: 'Urutan fasilitas disimpan.' });
  })
);

/* POST /api/owner/facilities/publish - kabari penyewa bahwa info diperbarui */
router.post(
  '/facilities/publish',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .prepare("SELECT id FROM users WHERE role = 'tenant' AND status = 'aktif'")
      .all();
    const tenants = rows.map((t) => t.id);

    await notifyMany(tenants, {
      title: 'Info denah & fasilitas diperbarui',
      body: 'Pemilik kos memperbarui denah dan daftar fasilitas. Lihat di menu Fasilitas.',
      type: 'info',
      link: '#/penyewa/fasilitas',
    });

    res.json({ ok: true, notified: tenants.length, message: `${tenants.length} penyewa aktif diberi tahu.` });
  })
);

/* ========================================================================== */
/* TEMPAT UMUM DI SEKITAR KOS (muncul di halaman Fasilitas penyewa)           */
/* ========================================================================== */

const shapePlace = (row) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  address: row.address || '',
  distanceM: row.distance_m,
  distanceLabel: formatDistance(row.distance_m),
  lat: row.lat,
  lng: row.lng,
  isActive: Boolean(row.is_active),
  mapsUrl: placeUrl(row),
  directionsUrl: directionsUrl(row),
});

export const listPlaces = async ({ onlyActive = false } = {}) => {
  const rows = await db
    .prepare(
      `SELECT * FROM nearby_places${onlyActive ? ' WHERE is_active = 1' : ''}
        ORDER BY category, distance_m, name`
    )
    .all();
  return rows.map(shapePlace);
};

/* GET /api/owner/places */
router.get(
  '/places',
  asyncHandler(async (_req, res) => {
    res.json({ places: await listPlaces(), categories: PLACE_CATEGORIES });
  })
);

/* POST /api/owner/places */
router.post(
  '/places',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['name', 'category']);
    const info = await db
      .prepare(
        `INSERT INTO nearby_places (name, category, address, distance_m, lat, lng, maps_query, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        str(req.body.name, 120),
        str(req.body.category, 40),
        str(req.body.address, 240),
        req.body.distanceM ? int(req.body.distanceM) : null,
        req.body.lat ? Number(req.body.lat) : null,
        req.body.lng ? Number(req.body.lng) : null,
        str(req.body.mapsQuery, 240) || null,
        bool(req.body.isActive ?? true) ? 1 : 0
      );

    const row = await db.prepare('SELECT * FROM nearby_places WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ place: shapePlace(row), message: 'Tempat sekitar berhasil ditambahkan.' });
  })
);

/* PUT /api/owner/places/:id */
router.put(
  '/places/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const current = await db.prepare('SELECT * FROM nearby_places WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Tempat tidak ditemukan.');

    await db
      .prepare(
        `UPDATE nearby_places
            SET name = ?, category = ?, address = ?, distance_m = ?, lat = ?, lng = ?, maps_query = ?, is_active = ?
          WHERE id = ?`
      )
      .run(
        str(req.body.name, 120) || current.name,
        str(req.body.category, 40) || current.category,
        req.body.address !== undefined ? str(req.body.address, 240) : current.address,
        req.body.distanceM !== undefined
          ? (req.body.distanceM === '' ? null : int(req.body.distanceM))
          : current.distance_m,
        req.body.lat !== undefined ? (req.body.lat === '' ? null : Number(req.body.lat)) : current.lat,
        req.body.lng !== undefined ? (req.body.lng === '' ? null : Number(req.body.lng)) : current.lng,
        req.body.mapsQuery !== undefined ? str(req.body.mapsQuery, 240) : current.maps_query,
        req.body.isActive === undefined ? current.is_active : (bool(req.body.isActive) ? 1 : 0),
        id
      );

    const row = await db.prepare('SELECT * FROM nearby_places WHERE id = ?').get(id);
    res.json({ place: shapePlace(row), message: 'Tempat sekitar diperbarui.' });
  })
);

/* DELETE /api/owner/places/:id */
router.delete(
  '/places/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const current = await db.prepare('SELECT name FROM nearby_places WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Tempat tidak ditemukan.');
    await db.prepare('DELETE FROM nearby_places WHERE id = ?').run(id);
    res.json({ ok: true, message: `"${current.name}" dihapus.` });
  })
);

export default router;

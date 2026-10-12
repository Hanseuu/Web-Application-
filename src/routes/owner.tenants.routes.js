import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import { hashPassword, publicUser } from '../lib/auth.js';
import {
  asyncHandler, HttpError, requireFields, str, int, isEmail,
  buildRoomCode, daysUntil, normalizePhone,
} from '../lib/helpers.js';
import { notify } from '../services/notifications.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/* Query dasar daftar penyewa                                                 */
/* -------------------------------------------------------------------------- */

const TENANT_SELECT = `
  SELECT u.id, u.name, u.email, u.phone, u.status, u.occupation, u.emergency_contact,
         u.check_in_date, u.check_out_date, u.avatar_color, u.created_at,
         u.room_id, r.code AS room_code, r.floor AS room_floor, r.number AS room_number, r.price AS room_price,
         (SELECT COUNT(*) FROM bills b
           WHERE b.tenant_id = u.id AND b.status IN ('belum_bayar','terlambat','menunggu_pembayaran')) AS unpaid_bills,
         (SELECT COALESCE(SUM(b.amount), 0) FROM bills b
           WHERE b.tenant_id = u.id AND b.status IN ('belum_bayar','terlambat','menunggu_pembayaran')) AS unpaid_total,
         (SELECT MIN(b.due_date) FROM bills b
           WHERE b.tenant_id = u.id AND b.status IN ('belum_bayar','terlambat','menunggu_pembayaran')) AS next_due_date,
         (SELECT COUNT(*) FROM complaints c
           WHERE c.tenant_id = u.id AND c.status <> 'selesai') AS open_complaints,
         (SELECT COUNT(*) FROM messages m
           WHERE m.sender_id = u.id AND m.read_at IS NULL) AS unread_messages
    FROM users u
    LEFT JOIN rooms r ON r.id = u.room_id
   WHERE u.role = 'tenant'
`;

const shapeTenant = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone || '',
  waPhone: normalizePhone(row.phone),
  status: row.status,
  occupation: row.occupation || '',
  emergencyContact: row.emergency_contact || '',
  checkInDate: row.check_in_date,
  checkOutDate: row.check_out_date,
  avatarColor: row.avatar_color,
  room: row.room_id
    ? { id: row.room_id, code: row.room_code, floor: row.room_floor, number: row.room_number, price: row.room_price }
    : null,
  // "roomCode" mengikuti format XYY: X = lantai, YY = nomor kamar (01-30)
  roomCode: row.room_code || null,
  finance: {
    unpaidBills: row.unpaid_bills,
    unpaidTotal: row.unpaid_total,
    nextDueDate: row.next_due_date,
    daysToDue: daysUntil(row.next_due_date),
  },
  openComplaints: row.open_complaints,
  unreadMessages: row.unread_messages,
});

/* -------------------------------------------------------------------------- */
/* GET /api/owner/tenants - siapa yang sedang menghuni                        */
/* -------------------------------------------------------------------------- */
router.get(
  '/tenants',
  asyncHandler(async (req, res) => {
    const status = str(req.query.status, 20) || 'aktif'; // aktif | nonaktif | semua
    const floor = int(req.query.floor, 0);
    const search = str(req.query.search, 60);

    const where = [];
    const params = [];

    if (status !== 'semua') {
      where.push('u.status = ?');
      params.push(status);
    }
    if (floor) {
      where.push('r.floor = ?');
      params.push(floor);
    }
    if (search) {
      where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR r.code LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const sql =
      `${TENANT_SELECT}${where.length ? ` AND ${where.join(' AND ')}` : ''} ` +
      'ORDER BY (r.code IS NULL), r.floor, r.number, u.name';

    const [rows, counts, perFloor, roomCount] = await Promise.all([
      db.prepare(sql).all(...params),
      db
        .prepare(
          `SELECT
              SUM(CASE WHEN status = 'aktif' THEN 1 ELSE 0 END)    AS aktif,
              SUM(CASE WHEN status = 'nonaktif' THEN 1 ELSE 0 END) AS nonaktif
             FROM users WHERE role = 'tenant'`
        )
        .get(),
      db
        .prepare(
          `SELECT r.floor, COUNT(u.id) AS total
             FROM rooms r
        LEFT JOIN users u ON u.room_id = r.id AND u.role = 'tenant' AND u.status = 'aktif'
            GROUP BY r.floor ORDER BY r.floor`
        )
        .all(),
      db.prepare('SELECT COUNT(*) AS n FROM rooms').get(),
    ]);

    res.json({
      tenants: rows.map(shapeTenant),
      summary: {
        aktif: counts.aktif || 0,
        nonaktif: counts.nonaktif || 0,
        totalRooms: roomCount.n,
        perFloor,
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/owner/tenants/:id - detail satu penyewa                           */
/* -------------------------------------------------------------------------- */
router.get(
  '/tenants/:id',
  asyncHandler(async (req, res) => {
    const row = await db.prepare(`${TENANT_SELECT} AND u.id = ?`).get(int(req.params.id));
    if (!row) throw new HttpError(404, 'Penyewa tidak ditemukan.');

    const [bills, complaints] = await Promise.all([
      db.prepare('SELECT * FROM bills WHERE tenant_id = ? ORDER BY due_date DESC LIMIT 12').all(row.id),
      db
        .prepare('SELECT id, title, status, created_at FROM complaints WHERE tenant_id = ? ORDER BY id DESC LIMIT 10')
        .all(row.id),
    ]);

    res.json({ tenant: shapeTenant(row), bills, complaints });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/owner/tenants - tambah penyewa baru                              */
/* -------------------------------------------------------------------------- */
router.post(
  '/tenants',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['name', 'email', 'password', 'roomId']);
    const name = str(req.body.name, 100);
    const email = str(req.body.email, 160).toLowerCase();
    const password = String(req.body.password);
    const roomId = int(req.body.roomId);

    if (!isEmail(email)) throw new HttpError(400, 'Format email tidak valid.');
    if (password.length < 6) throw new HttpError(400, 'Password minimal 6 karakter.');
    if (await db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)) {
      throw new HttpError(409, 'Email tersebut sudah terdaftar.');
    }

    const room = await db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    if (!room) throw new HttpError(404, 'Kamar tidak ditemukan.');

    const occupant = await db
      .prepare("SELECT name FROM users WHERE room_id = ? AND status = 'aktif' AND role = 'tenant'")
      .get(roomId);
    if (occupant) throw new HttpError(409, `Kamar ${room.code} masih dihuni oleh ${occupant.name}.`);

    const info = await db
      .prepare(
        `INSERT INTO users
           (name, email, phone, password_hash, role, room_id, status, occupation,
            emergency_contact, check_in_date, avatar_color)
         VALUES (?, ?, ?, ?, 'tenant', ?, 'aktif', ?, ?, ?, ?)`
      )
      .run(
        name, email, str(req.body.phone, 30), hashPassword(password), roomId,
        str(req.body.occupation, 100), str(req.body.emergencyContact, 100),
        str(req.body.checkInDate, 10) || new Date().toISOString().slice(0, 10),
        str(req.body.avatarColor, 20) || '#2563eb'
      );

    await notify({
      userId: info.lastInsertRowid,
      title: `Selamat datang di ${config.kost.name}!`,
      body: `Akun Anda untuk kamar ${room.code} sudah aktif. Silakan lengkapi profil dan cek tagihan Anda.`,
      type: 'info',
      link: '#/penyewa/beranda',
    });

    const fresh = await db.prepare(`${TENANT_SELECT} AND u.id = ?`).get(info.lastInsertRowid);
    res.status(201).json({
      tenant: shapeTenant(fresh),
      message: `Penyewa ${name} berhasil ditambahkan ke kamar ${room.code}.`,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* PUT /api/owner/tenants/:id - edit / rename penyewa, pindah kamar           */
/* -------------------------------------------------------------------------- */
router.put(
  '/tenants/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const current = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'tenant'").get(id);
    if (!current) throw new HttpError(404, 'Penyewa tidak ditemukan.');

    const name = str(req.body.name, 100) || current.name;
    const email = (str(req.body.email, 160) || current.email).toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'Format email tidak valid.');
    if (await db.prepare('SELECT id FROM users WHERE lower(email) = ? AND id <> ?').get(email, id)) {
      throw new HttpError(409, 'Email tersebut sudah dipakai akun lain.');
    }

    const status = ['aktif', 'nonaktif'].includes(req.body.status) ? req.body.status : current.status;

    let roomId = current.room_id;
    if (req.body.roomId !== undefined) {
      roomId = req.body.roomId === null || req.body.roomId === '' ? null : int(req.body.roomId);
      if (roomId) {
        const room = await db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
        if (!room) throw new HttpError(404, 'Kamar tidak ditemukan.');
        const occupant = await db
          .prepare("SELECT name FROM users WHERE room_id = ? AND id <> ? AND status = 'aktif' AND role = 'tenant'")
          .get(roomId, id);
        if (occupant) {
          throw new HttpError(409, `Kamar ${room.code} masih dihuni oleh ${occupant.name}.`);
        }
      }
    }

    const phone = req.body.phone !== undefined ? str(req.body.phone, 30) : current.phone;
    const occupation = req.body.occupation !== undefined ? str(req.body.occupation, 100) : current.occupation;
    const emergency = req.body.emergencyContact !== undefined
      ? str(req.body.emergencyContact, 100) : current.emergency_contact;
    const checkIn = req.body.checkInDate !== undefined ? str(req.body.checkInDate, 10) : current.check_in_date;
    const checkOut = status === 'nonaktif'
      ? (str(req.body.checkOutDate, 10) || current.check_out_date || new Date().toISOString().slice(0, 10))
      : null;
    const avatarColor = str(req.body.avatarColor, 20) || current.avatar_color;

    await db
      .prepare(
        `UPDATE users
            SET name = ?, email = ?, phone = ?, room_id = ?, status = ?, occupation = ?,
                emergency_contact = ?, check_in_date = ?, check_out_date = ?, avatar_color = ?,
                updated_at = datetime('now')
          WHERE id = ?`
      )
      .run(name, email, phone, roomId, status, occupation, emergency, checkIn, checkOut, avatarColor, id);

    // Penyewa nonaktif tidak boleh punya sesi aktif.
    if (status === 'nonaktif' && current.status === 'aktif') {
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }

    // Beri tahu penyewa bila ada perubahan data penting.
    const changes = [];
    if (name !== current.name) changes.push(`nama menjadi "${name}"`);
    if (roomId !== current.room_id) {
      const newRoom = roomId ? await db.prepare('SELECT code FROM rooms WHERE id = ?').get(roomId) : null;
      changes.push(newRoom ? `kamar menjadi ${newRoom.code}` : 'kamar dikosongkan');
    }
    if (changes.length && status === 'aktif') {
      await notify({
        userId: id,
        title: 'Data penghunian diperbarui',
        body: `Pemilik kos memperbarui ${changes.join(' dan ')}.`,
        type: 'info',
        link: '#/profil',
      });
    }

    const fresh = await db.prepare(`${TENANT_SELECT} AND u.id = ?`).get(id);
    res.json({ tenant: shapeTenant(fresh), message: `Data ${name} berhasil disimpan.` });
  })
);

/* -------------------------------------------------------------------------- */
/* PUT /api/owner/tenants/:id/password - reset password penyewa               */
/* -------------------------------------------------------------------------- */
router.put(
  '/tenants/:id/password',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['newPassword']);
    const id = int(req.params.id);
    const tenant = await db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'tenant'").get(id);
    if (!tenant) throw new HttpError(404, 'Penyewa tidak ditemukan.');
    if (String(req.body.newPassword).length < 6) throw new HttpError(400, 'Password minimal 6 karakter.');

    await db
      .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hashPassword(req.body.newPassword), id);
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);

    await notify({
      userId: id,
      title: 'Password direset',
      body: 'Pemilik kos mereset password akun Anda. Silakan login dengan password baru.',
      type: 'warning',
    });

    res.json({ ok: true, message: `Password ${tenant.name} berhasil direset.` });
  })
);

/* -------------------------------------------------------------------------- */
/* DELETE /api/owner/tenants/:id - keluarkan penyewa (soft delete)            */
/* -------------------------------------------------------------------------- */
router.delete(
  '/tenants/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const tenant = await db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'tenant'").get(id);
    if (!tenant) throw new HttpError(404, 'Penyewa tidak ditemukan.');

    await db
      .prepare(
        `UPDATE users SET status = 'nonaktif', room_id = NULL, check_out_date = date('now'),
                          updated_at = datetime('now')
          WHERE id = ?`
      )
      .run(id);
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);

    res.json({ ok: true, message: `${tenant.name} ditandai sudah tidak menghuni.` });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/owner/rooms - daftar kamar + status hunian                        */
/* -------------------------------------------------------------------------- */
router.get(
  '/rooms',
  asyncHandler(async (_req, res) => {
    const rooms = await db
      .prepare(
        `SELECT r.*, u.id AS tenant_id, u.name AS tenant_name, u.avatar_color, u.check_in_date
           FROM rooms r
      LEFT JOIN users u
             ON u.room_id = r.id AND u.role = 'tenant' AND u.status = 'aktif'
          ORDER BY r.floor, r.number`
      )
      .all();

    res.json({
      rooms: rooms.map((r) => ({
        id: r.id,
        code: r.code,
        floor: r.floor,
        number: r.number,
        price: r.price,
        size: r.size || '',
        notes: r.notes || '',
        occupied: Boolean(r.tenant_id),
        tenant: r.tenant_id
          ? { id: r.tenant_id, name: r.tenant_name, avatarColor: r.avatar_color, checkInDate: r.check_in_date }
          : null,
      })),
      limits: { floors: config.building.floors, maxRoomsPerFloor: config.building.maxRoomsPerFloor },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/owner/rooms - tambah kamar (kode otomatis format XYY)            */
/* -------------------------------------------------------------------------- */
router.post(
  '/rooms',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['floor', 'number']);
    const floor = int(req.body.floor);
    const number = int(req.body.number);
    const code = buildRoomCode(floor, number); // validasi lantai & rentang 1-30

    if (await db.prepare('SELECT id FROM rooms WHERE code = ?').get(code)) {
      throw new HttpError(409, `Kamar ${code} sudah ada.`);
    }

    const info = await db
      .prepare('INSERT INTO rooms (floor, number, code, price, size, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(floor, number, code, int(req.body.price, 0), str(req.body.size, 40), str(req.body.notes, 300));

    res.status(201).json({
      room: await db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid),
      message: `Kamar ${code} berhasil ditambahkan.`,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* PUT /api/owner/rooms/:id - ubah harga / catatan kamar                      */
/* -------------------------------------------------------------------------- */
router.put(
  '/rooms/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const room = await db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room) throw new HttpError(404, 'Kamar tidak ditemukan.');

    await db.prepare('UPDATE rooms SET price = ?, size = ?, notes = ? WHERE id = ?').run(
      req.body.price !== undefined ? int(req.body.price, room.price) : room.price,
      req.body.size !== undefined ? str(req.body.size, 40) : room.size,
      req.body.notes !== undefined ? str(req.body.notes, 300) : room.notes,
      id
    );

    res.json({
      room: await db.prepare('SELECT * FROM rooms WHERE id = ?').get(id),
      message: `Kamar ${room.code} diperbarui.`,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* DELETE /api/owner/rooms/:id                                                */
/* -------------------------------------------------------------------------- */
router.delete(
  '/rooms/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const room = await db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room) throw new HttpError(404, 'Kamar tidak ditemukan.');

    const occupant = await db.prepare("SELECT name FROM users WHERE room_id = ? AND status = 'aktif'").get(id);
    if (occupant) {
      throw new HttpError(409, `Kamar ${room.code} masih dihuni ${occupant.name}. Pindahkan penyewa terlebih dahulu.`);
    }

    await db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    res.json({ ok: true, message: `Kamar ${room.code} dihapus.` });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/owner/profile - data owner untuk halaman profil                   */
/* -------------------------------------------------------------------------- */
router.get('/profile', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;

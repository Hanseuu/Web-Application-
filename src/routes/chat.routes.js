import { Router } from 'express';
import { db } from '../db.js';
import { getPrimaryOwner } from '../lib/auth.js';
import { asyncHandler, HttpError, requireFields, str, int, excerpt } from '../lib/helpers.js';
import { notify } from '../services/notifications.js';

const router = Router();

/**
 * Chat sederhana 1-1 antara owner dan penyewa.
 * - Owner melihat daftar percakapan dengan semua penyewa.
 * - Penyewa hanya punya satu percakapan, yaitu dengan pemilik kos.
 */

/** Pastikan pasangan chat diizinkan (owner <-> tenant saja). */
async function assertPartner(user, partnerId) {
  const partner = await db
    .prepare('SELECT u.*, r.code AS room_code FROM users u LEFT JOIN rooms r ON r.id = u.room_id WHERE u.id = ?')
    .get(partnerId);
  if (!partner) throw new HttpError(404, 'Pengguna tidak ditemukan.');
  if (partner.id === user.id) throw new HttpError(400, 'Tidak bisa mengirim pesan ke diri sendiri.');
  if (user.role === partner.role) {
    throw new HttpError(403, 'Percakapan hanya tersedia antara pemilik kos dan penyewa.');
  }
  if (user.role === 'tenant' && partner.role !== 'owner') {
    throw new HttpError(403, 'Penyewa hanya dapat menghubungi pemilik kos.');
  }
  return partner;
}

/* -------------------------------------------------------------------------- */
/* GET /api/chat/threads                                                      */
/* -------------------------------------------------------------------------- */
router.get(
  '/threads',
  asyncHandler(async (req, res) => {
    const me = req.user;

    if (me.role === 'owner') {
      const rows = await db
        .prepare(
          `SELECT u.id, u.name, u.status, u.avatar_color, r.code AS room_code, r.floor AS room_floor,
                  (SELECT m.body FROM messages m
                    WHERE (m.sender_id = u.id AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = u.id)
                    ORDER BY m.id DESC LIMIT 1) AS last_body,
                  (SELECT m.created_at FROM messages m
                    WHERE (m.sender_id = u.id AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = u.id)
                    ORDER BY m.id DESC LIMIT 1) AS last_at,
                  (SELECT m.sender_id FROM messages m
                    WHERE (m.sender_id = u.id AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = u.id)
                    ORDER BY m.id DESC LIMIT 1) AS last_sender,
                  (SELECT COUNT(*) FROM messages m
                    WHERE m.sender_id = u.id AND m.receiver_id = ? AND m.read_at IS NULL) AS unread
             FROM users u
        LEFT JOIN rooms r ON r.id = u.room_id
            WHERE u.role = 'tenant'
            ORDER BY (last_at IS NULL), last_at DESC, r.floor, r.number`
        )
        .all(me.id, me.id, me.id, me.id, me.id, me.id, me.id);

      return res.json({
        threads: rows.map((r) => ({
          partnerId: r.id,
          name: r.name,
          roomCode: r.room_code,
          roomFloor: r.room_floor,
          status: r.status,
          avatarColor: r.avatar_color,
          lastMessage: r.last_body ? excerpt(r.last_body, 70) : null,
          lastAt: r.last_at,
          lastFromMe: r.last_sender === me.id,
          unread: r.unread,
        })),
        totalUnread: rows.reduce((s, r) => s + r.unread, 0),
      });
    }

    // Penyewa: satu percakapan dengan owner.
    const owner = await getPrimaryOwner();
    if (!owner) return res.json({ threads: [], totalUnread: 0 });

    const [last, unreadRow] = await Promise.all([
      db
        .prepare(
          `SELECT body, created_at, sender_id FROM messages
            WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
            ORDER BY id DESC LIMIT 1`
        )
        .get(owner.id, me.id, me.id, owner.id),
      db
        .prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL')
        .get(owner.id, me.id),
    ]);

    return res.json({
      threads: [
        {
          partnerId: owner.id,
          name: owner.name,
          roomCode: null,
          roleLabel: 'Pemilik Kos',
          status: owner.status,
          avatarColor: owner.avatar_color,
          lastMessage: last ? excerpt(last.body, 70) : null,
          lastAt: last?.created_at || null,
          lastFromMe: last?.sender_id === me.id,
          unread: unreadRow.n,
        },
      ],
      totalUnread: unreadRow.n,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/chat/messages/:partnerId                                          */
/* -------------------------------------------------------------------------- */
router.get(
  '/messages/:partnerId',
  asyncHandler(async (req, res) => {
    const partner = await assertPartner(req.user, int(req.params.partnerId));
    const me = req.user;

    const messages = await db
      .prepare(
        `SELECT id, sender_id, receiver_id, body, created_at, read_at
           FROM messages
          WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
          ORDER BY id
          LIMIT 500`
      )
      .all(me.id, partner.id, partner.id, me.id);

    // Tandai pesan masuk sebagai sudah dibaca.
    await db
      .prepare(
        "UPDATE messages SET read_at = datetime('now') WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL"
      )
      .run(partner.id, me.id);

    res.json({
      partner: {
        id: partner.id,
        name: partner.name,
        role: partner.role,
        roleLabel: partner.role === 'owner' ? 'Pemilik Kos' : 'Penyewa',
        roomCode: partner.room_code || null,
        avatarColor: partner.avatar_color,
        phone: partner.phone || '',
      },
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        fromMe: m.sender_id === me.id,
        createdAt: m.created_at,
        readAt: m.read_at,
      })),
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/chat/messages                                                    */
/* -------------------------------------------------------------------------- */
router.post(
  '/messages',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['receiverId', 'body']);
    const partner = await assertPartner(req.user, int(req.body.receiverId));
    const body = str(req.body.body, 2000);
    if (!body) throw new HttpError(400, 'Pesan tidak boleh kosong.');

    const info = await db
      .prepare('INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)')
      .run(req.user.id, partner.id, body);

    const senderLabel = req.user.role === 'owner'
      ? 'Pemilik Kos'
      : `${req.user.name}${req.user.room_code ? ` (kamar ${req.user.room_code})` : ''}`;

    await notify({
      userId: partner.id,
      title: `💬 Pesan dari ${senderLabel}`,
      body: excerpt(body, 140),
      type: 'chat',
      link: `#/chat?partner=${req.user.id}`,
    });

    const row = await db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({
      message: {
        id: row.id,
        body: row.body,
        fromMe: true,
        createdAt: row.created_at,
        readAt: null,
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/chat/unread - badge jumlah pesan belum dibaca                     */
/* -------------------------------------------------------------------------- */
router.get(
  '/unread',
  asyncHandler(async (req, res) => {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE receiver_id = ? AND read_at IS NULL')
      .get(req.user.id);
    res.json({ unread: row.n });
  })
);

export default router;

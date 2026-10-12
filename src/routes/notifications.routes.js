import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler, int } from '../lib/helpers.js';
import {
  listNotifications, unreadCount, markRead, markAllRead,
} from '../services/notifications.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/* GET /api/notifications                                                     */
/* -------------------------------------------------------------------------- */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [notifications, unread] = await Promise.all([
      listNotifications(req.user.id, { limit: int(req.query.limit, 30) }),
      unreadCount(req.user.id),
    ]);
    res.json({ notifications, unread });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/notifications/poll?after=<id>                                     */
/* Dipanggil berkala oleh browser; hasilnya ditampilkan sebagai Web           */
/* Notification + toast. Juga membawa badge chat agar hemat request.          */
/* -------------------------------------------------------------------------- */
router.get(
  '/poll',
  asyncHandler(async (req, res) => {
    const after = int(req.query.after, 0);

    const [fresh, latestRow, chatRow, unread] = await Promise.all([
      listNotifications(req.user.id, { limit: 10, afterId: after }),
      db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM notifications WHERE user_id = ?').get(req.user.id),
      db.prepare('SELECT COUNT(*) AS n FROM messages WHERE receiver_id = ? AND read_at IS NULL').get(req.user.id),
      unreadCount(req.user.id),
    ]);

    res.json({
      // Dikirim dari lama ke baru supaya urutan toast masuk akal.
      notifications: fresh.reverse(),
      latestId: latestRow.id,
      unread,
      chatUnread: chatRow.n,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/notifications/read                                               */
/* -------------------------------------------------------------------------- */
router.post(
  '/read',
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((v) => int(v)).filter(Boolean) : [];
    const changed = ids.length ? await markRead(req.user.id, ids) : await markAllRead(req.user.id);
    res.json({ ok: true, changed, unread: await unreadCount(req.user.id) });
  })
);

/* -------------------------------------------------------------------------- */
/* DELETE /api/notifications - bersihkan notifikasi yang sudah dibaca         */
/* -------------------------------------------------------------------------- */
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const result = await db
      .prepare('DELETE FROM notifications WHERE user_id = ? AND is_read = 1')
      .run(req.user.id);
    res.json({ ok: true, deleted: result.changes });
  })
);

export default router;

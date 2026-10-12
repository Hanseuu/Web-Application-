import { db } from '../db.js';
import { excerpt } from '../lib/helpers.js';

/**
 * Notifikasi disimpan di DB lalu di-poll oleh browser (/api/notifications/poll).
 * Client memunculkannya sebagai Web Notification + toast in-app.
 */
export async function notify({ userId, title, body, type = 'info', link = null }) {
  if (!userId) return null;
  const info = await db
    .prepare('INSERT INTO notifications (user_id, title, body, type, link) VALUES (?, ?, ?, ?, ?)')
    .run(userId, excerpt(title, 120), excerpt(body, 400), type, link);
  return info.lastInsertRowid;
}

/** Kirim notifikasi ke banyak user sekaligus (satu batch, satu perjalanan jaringan). */
export async function notifyMany(userIds, payload) {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  if (!unique.length) return 0;

  await db.batch(
    unique.map((id) => ({
      sql: 'INSERT INTO notifications (user_id, title, body, type, link) VALUES (?, ?, ?, ?, ?)',
      args: [
        id,
        excerpt(payload.title, 120),
        excerpt(payload.body, 400),
        payload.type || 'info',
        payload.link || null,
      ],
    }))
  );
  return unique.length;
}

/** Notifikasi ke semua owner (biasanya hanya satu). */
export async function notifyOwners(payload) {
  const owners = await db
    .prepare("SELECT id FROM users WHERE role = 'owner' AND status = 'aktif'")
    .all();
  return notifyMany(owners.map((o) => o.id), payload);
}

export const listNotifications = (userId, { limit = 30, afterId = 0 } = {}) =>
  db
    .prepare(
      `SELECT id, title, body, type, link, is_read, created_at
         FROM notifications
        WHERE user_id = ? AND id > ?
        ORDER BY id DESC
        LIMIT ?`
    )
    .all(userId, afterId, limit);

export const unreadCount = async (userId) =>
  (await db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(userId)).n;

export const markRead = async (userId, ids) => {
  if (!ids?.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const res = await db
    .prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`)
    .run(userId, ...ids);
  return res.changes;
};

export const markAllRead = async (userId) => {
  const res = await db
    .prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
    .run(userId);
  return res.changes;
};

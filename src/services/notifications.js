import { db } from '../db.js';
import { excerpt } from '../lib/helpers.js';

/**
 * Notifikasi disimpan di DB lalu di-poll oleh browser (/api/notifications/stream).
 * Client memunculkannya sebagai Web Notification + toast in-app.
 */
export function notify({ userId, title, body, type = 'info', link = null }) {
  if (!userId) return null;
  const info = db
    .prepare(
      'INSERT INTO notifications (user_id, title, body, type, link) VALUES (?, ?, ?, ?, ?)'
    )
    .run(userId, excerpt(title, 120), excerpt(body, 400), type, link);
  return info.lastInsertRowid;
}

/** Kirim notifikasi ke banyak user sekaligus (dalam 1 transaksi). */
export function notifyMany(userIds, payload) {
  const stmt = db.prepare(
    'INSERT INTO notifications (user_id, title, body, type, link) VALUES (?, ?, ?, ?, ?)'
  );
  const run = db.transaction((ids) => {
    for (const id of ids) {
      stmt.run(id, excerpt(payload.title, 120), excerpt(payload.body, 400), payload.type || 'info', payload.link || null);
    }
  });
  const unique = [...new Set(userIds.filter(Boolean))];
  run(unique);
  return unique.length;
}

/** Notifikasi ke semua owner (biasanya hanya satu). */
export function notifyOwners(payload) {
  const owners = db.prepare("SELECT id FROM users WHERE role = 'owner' AND status = 'aktif'").all();
  return notifyMany(owners.map((o) => o.id), payload);
}

export function listNotifications(userId, { limit = 30, afterId = 0 } = {}) {
  return db
    .prepare(
      `SELECT id, title, body, type, link, is_read, created_at
         FROM notifications
        WHERE user_id = ? AND id > ?
        ORDER BY id DESC
        LIMIT ?`
    )
    .all(userId, afterId, limit);
}

export const unreadCount = (userId) =>
  db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).n;

export const markRead = (userId, ids) => {
  if (!ids?.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`)
    .run(userId, ...ids).changes;
};

export const markAllRead = (userId) =>
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId).changes;

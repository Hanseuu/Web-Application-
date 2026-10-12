import { db } from '../db.js';
import { ANNOUNCEMENT_TARGETS } from '../config.js';
import { nowSql, excerpt, floorFromCode } from '../lib/helpers.js';
import { notifyMany } from './notifications.js';
import { sendWhatsApp, templates } from './whatsapp.js';

export const targetLabel = (code) =>
  ANNOUNCEMENT_TARGETS.find((t) => t.code === code)?.label || code;

/**
 * Penerima pengumuman: hanya penyewa AKTIF, difilter sesuai target.
 * target: 'semua' | 'lantai_1' | 'lantai_2' | 'lantai_3'
 */
export function recipientsFor(target) {
  if (target === 'semua') {
    return db
      .prepare(
        `SELECT u.id, u.name, u.phone, r.code AS room_code
           FROM users u LEFT JOIN rooms r ON r.id = u.room_id
          WHERE u.role = 'tenant' AND u.status = 'aktif'`
      )
      .all();
  }
  const floor = Number(String(target).replace('lantai_', ''));
  return db
    .prepare(
      `SELECT u.id, u.name, u.phone, r.code AS room_code
         FROM users u JOIN rooms r ON r.id = u.room_id
        WHERE u.role = 'tenant' AND u.status = 'aktif' AND r.floor = ?`
    )
    .all(floor);
}

/** Apakah seorang penyewa termasuk penerima pengumuman tertentu. */
export function isRecipient(user, target) {
  if (target === 'semua') return true;
  if (!user.room_code) return false;
  return floorFromCode(user.room_code) === Number(String(target).replace('lantai_', ''));
}

/**
 * Terbitkan pengumuman: ubah status, kirim notifikasi in-app,
 * dan (opsional) kirim WhatsApp ke seluruh penerima.
 */
export async function publishAnnouncement(id) {
  const ann = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!ann) return { ok: false, reason: 'Pengumuman tidak ditemukan' };

  const publishedAt = nowSql();
  db.prepare("UPDATE announcements SET status = 'terbit', published_at = ?, updated_at = ? WHERE id = ?")
    .run(publishedAt, publishedAt, id);

  const recipients = recipientsFor(ann.target);

  notifyMany(recipients.map((r) => r.id), {
    title: `📢 ${ann.title}`,
    body: excerpt(ann.body, 180),
    type: 'announcement',
    link: `#/penyewa/pengumuman?id=${id}`,
  });

  let waSent = 0;
  let waFailed = 0;
  if (ann.send_whatsapp) {
    const results = await Promise.all(
      recipients
        .filter((r) => r.phone)
        .map((r) =>
          sendWhatsApp({
            userId: r.id,
            phone: r.phone,
            kind: 'pengumuman',
            message: templates.pengumuman({ tenant: r, announcement: ann }),
          })
        )
    );
    waSent = results.filter((r) => r.ok).length;
    waFailed = results.length - waSent;
  }

  return { ok: true, recipients: recipients.length, waSent, waFailed, publishedAt };
}

/** Dijalankan periodik oleh scheduler untuk pengumuman terjadwal. */
export async function publishDueAnnouncements() {
  const due = db
    .prepare(
      `SELECT id FROM announcements
        WHERE status = 'terjadwal' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')
        ORDER BY scheduled_at`
    )
    .all();

  const published = [];
  for (const row of due) {
    // Sekuensial supaya pengiriman WhatsApp tidak membanjiri gateway.
    // eslint-disable-next-line no-await-in-loop
    const result = await publishAnnouncement(row.id);
    if (result.ok) published.push({ id: row.id, ...result });
  }
  return published;
}

export const shapeAnnouncement = (row) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  target: row.target,
  targetLabel: targetLabel(row.target),
  category: row.category,
  status: row.status,
  isPinned: Boolean(row.is_pinned),
  sendWhatsapp: Boolean(row.send_whatsapp),
  scheduledAt: row.scheduled_at,
  publishedAt: row.published_at,
  createdAt: row.created_at,
  authorName: row.author_name || null,
  readCount: row.read_count ?? null,
  recipientCount: row.recipient_count ?? null,
  isRead: row.is_read === undefined ? undefined : Boolean(row.is_read),
});

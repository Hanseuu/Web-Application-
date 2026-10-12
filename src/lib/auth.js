import crypto from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import { HttpError, addDays, toSqlDateTime, nowSql } from './helpers.js';

const KEY_LEN = 64;

/** Hash password memakai scrypt (tersedia di core Node, tanpa dependency native). */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.scryptSync(String(password), salt, KEY_LEN);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Sesi disimpan di database (Turso), sehingga tetap berlaku di semua
 * instance fungsi serverless — bukan hanya di instance yang memproses login.
 */
export async function createSession(userId, userAgent = '') {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = toSqlDateTime(addDays(config.sessionTtlDays));
  await db
    .prepare('INSERT INTO sessions (token, user_id, user_agent, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, String(userAgent).slice(0, 255), expiresAt);
  return { token, expiresAt };
}

export async function destroySession(token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export async function purgeExpiredSessions() {
  const res = await db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return res.changes;
}

/** Ambil user dari token sesi, beserta data kamar bila penyewa. */
export async function userFromToken(token) {
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.*, r.code AS room_code, r.floor AS room_floor, r.number AS room_number, r.price AS room_price
         FROM sessions s
         JOIN users u ON u.id = s.user_id
    LEFT JOIN rooms r ON r.id = u.room_id
        WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token);
}

/* -------------------------------------------------------------------------- */
/* Middleware                                                                 */
/* -------------------------------------------------------------------------- */

const readToken = (req) =>
  req.cookies?.[config.sessionCookie] ||
  (req.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
  null;

/** Menempelkan req.user bila ada sesi valid (tidak memblokir request). */
export async function attachUser(req, _res, next) {
  try {
    req.sessionToken = readToken(req);
    req.user = await userFromToken(req.sessionToken);
    next();
  } catch (err) {
    next(err);
  }
}

/** Wajib login. */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sesi berakhir. Silakan login kembali.'));
  if (req.user.status !== 'aktif') {
    return next(new HttpError(403, 'Akun Anda sudah tidak aktif. Hubungi pemilik kos.'));
  }
  return next();
}

/** Wajib login dengan peran tertentu ('owner' / 'tenant'). */
export function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Sesi berakhir. Silakan login kembali.'));
    if (req.user.status !== 'aktif') {
      return next(new HttpError(403, 'Akun Anda sudah tidak aktif. Hubungi pemilik kos.'));
    }
    if (req.user.role !== role) {
      return next(new HttpError(403, 'Anda tidak punya akses ke halaman ini.'));
    }
    return next();
  };
}

export function setSessionCookie(res, token) {
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Vercel selalu melayani lewat HTTPS.
    secure: config.env === 'production',
    maxAge: config.sessionTtlDays * 86400 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.sessionCookie, { path: '/' });
}

/** Bentuk data user yang aman dikirim ke client. */
export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    role: row.role,
    status: row.status,
    roomId: row.room_id || null,
    roomCode: row.room_code || null,
    roomFloor: row.room_floor || null,
    roomPrice: row.room_price || null,
    occupation: row.occupation || '',
    emergencyContact: row.emergency_contact || '',
    checkInDate: row.check_in_date || null,
    avatarColor: row.avatar_color || '#2563eb',
    createdAt: row.created_at,
  };
}

/** Owner utama (dipakai sebagai lawan bicara default di chat penyewa). */
export const getPrimaryOwner = () =>
  db.prepare("SELECT * FROM users WHERE role = 'owner' ORDER BY id LIMIT 1").get();

export const touchUser = (id) =>
  db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(nowSql(), id);

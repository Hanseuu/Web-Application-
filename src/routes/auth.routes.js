import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import {
  verifyPassword, hashPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, publicUser, requireAuth,
} from '../lib/auth.js';
import { asyncHandler, HttpError, requireFields, str, isEmail } from '../lib/helpers.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/* Info publik untuk halaman login                                            */
/* -------------------------------------------------------------------------- */
router.get('/meta', (_req, res) => {
  res.json({
    kost: { name: config.kost.name, address: config.kost.address },
    roles: [
      { code: 'owner', label: 'Pemilik Kos', description: 'Kelola penyewa, tagihan, komplain & pengumuman' },
      { code: 'tenant', label: 'Penyewa', description: 'Bayar tagihan, lapor kerusakan & lihat pengumuman' },
    ],
  });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/login                                                       */
/* Peran dipilih di halaman login dan diverifikasi terhadap peran asli akun.  */
/* -------------------------------------------------------------------------- */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['email', 'password', 'role']);
    const email = str(req.body.email, 160).toLowerCase();
    const password = String(req.body.password);
    const role = str(req.body.role, 20);

    if (!['owner', 'tenant'].includes(role)) {
      throw new HttpError(400, 'Peran harus "owner" (pemilik) atau "tenant" (penyewa).');
    }

    const user = db
      .prepare(
        `SELECT u.*, r.code AS room_code, r.floor AS room_floor, r.number AS room_number, r.price AS room_price
           FROM users u
      LEFT JOIN rooms r ON r.id = u.room_id
          WHERE lower(u.email) = ?`
      )
      .get(email);

    // Pesan error sengaja seragam agar tidak membocorkan email terdaftar.
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Email atau password salah.');
    }
    if (user.role !== role) {
      const label = user.role === 'owner' ? 'Pemilik Kos' : 'Penyewa';
      throw new HttpError(403, `Akun ini terdaftar sebagai ${label}. Silakan pilih peran yang sesuai.`);
    }
    if (user.status !== 'aktif') {
      throw new HttpError(403, 'Akun Anda sudah tidak aktif. Silakan hubungi pemilik kos.');
    }

    const { token } = createSession(user.id, req.get('user-agent') || '');
    setSessionCookie(res, token);

    res.json({
      user: publicUser(user),
      token,
      redirect: user.role === 'owner' ? '/app.html#/owner/beranda' : '/app.html#/penyewa/beranda',
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/auth/me                                                           */
/* -------------------------------------------------------------------------- */
router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Belum login.' });
  res.json({ user: publicUser(req.user) });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/logout                                                      */
/* -------------------------------------------------------------------------- */
router.post('/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* PUT /api/auth/password - ganti password sendiri                            */
/* -------------------------------------------------------------------------- */
router.put(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['currentPassword', 'newPassword']);
    const { currentPassword, newPassword } = req.body;

    if (!verifyPassword(currentPassword, req.user.password_hash)) {
      throw new HttpError(400, 'Password lama tidak sesuai.');
    }
    if (String(newPassword).length < 6) {
      throw new HttpError(400, 'Password baru minimal 6 karakter.');
    }

    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hashPassword(newPassword), req.user.id);

    // Logout dari perangkat lain, sesi aktif saat ini tetap dipertahankan.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.sessionToken);

    res.json({ ok: true, message: 'Password berhasil diperbarui.' });
  })
);

/* -------------------------------------------------------------------------- */
/* PUT /api/auth/profile - ubah data profil sendiri                           */
/* -------------------------------------------------------------------------- */
router.put(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = str(req.body.name, 100) || req.user.name;
    const email = str(req.body.email, 160).toLowerCase() || req.user.email;
    const phone = str(req.body.phone, 30);
    const occupation = str(req.body.occupation, 100);
    const emergencyContact = str(req.body.emergencyContact, 100);

    if (!isEmail(email)) throw new HttpError(400, 'Format email tidak valid.');

    const taken = db.prepare('SELECT id FROM users WHERE lower(email) = ? AND id <> ?').get(email, req.user.id);
    if (taken) throw new HttpError(409, 'Email tersebut sudah dipakai akun lain.');

    db.prepare(
      `UPDATE users
          SET name = ?, email = ?, phone = ?, occupation = ?, emergency_contact = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(name, email, phone, occupation, emergencyContact, req.user.id);

    const fresh = db
      .prepare(
        `SELECT u.*, r.code AS room_code, r.floor AS room_floor, r.price AS room_price
           FROM users u LEFT JOIN rooms r ON r.id = u.room_id WHERE u.id = ?`
      )
      .get(req.user.id);

    res.json({ user: publicUser(fresh), message: 'Profil berhasil diperbarui.' });
  })
);

export default router;

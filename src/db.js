import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { config } from './config.js';

/**
 * Lapisan database berbasis libSQL (Turso).
 *
 * Turso memakai dialek SQLite yang sama, jadi seluruh SQL aplikasi ini tidak
 * berubah. Yang berbeda hanya sifatnya: koneksi remote bekerja lewat HTTP
 * sehingga semua query menjadi asinkron (perlu `await`).
 *
 * Mode koneksi:
 *   • TURSO_DATABASE_URL diisi  -> database Turso (dipakai di Vercel)
 *   • tidak diisi               -> berkas SQLite lokal (dipakai saat
 *                                  pengembangan dan pengujian)
 */

const remoteUrl = (process.env.TURSO_DATABASE_URL || '').trim();
const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim();

export const isRemote = Boolean(remoteUrl) && !remoteUrl.startsWith('file:');

let url;
if (remoteUrl) {
  url = remoteUrl;
} else {
  // Berkas lokal: pastikan foldernya ada lebih dulu.
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  url = `file:${config.dbPath}`;
}

export const client = createClient(
  isRemote ? { url, authToken } : { url }
);

/* -------------------------------------------------------------------------- */
/* Normalisasi argumen                                                        */
/* -------------------------------------------------------------------------- */

/**
 * libSQL hanya menerima null, number, bigint, string, Uint8Array.
 * `undefined` dan boolean perlu diterjemahkan agar perilakunya sama seperti
 * better-sqlite3 sebelumnya.
 */
const toArg = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
};

const toArgs = (args) => {
  // Mendukung pemanggilan .get(a, b) maupun .get([a, b]).
  const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  return flat.map(toArg);
};

const num = (v) => (typeof v === 'bigint' ? Number(v) : v);

/** Baris dari libSQL berupa objek array-like; jadikan objek biasa. */
const toRow = (row) => (row ? { ...row } : row);

/* -------------------------------------------------------------------------- */
/* API bergaya better-sqlite3, tetapi asinkron                                */
/* -------------------------------------------------------------------------- */

const runner = (exec) => (sql) => ({
  /** Satu baris pertama, atau null. */
  get: async (...args) => {
    const res = await exec({ sql, args: toArgs(args) });
    return res.rows.length ? toRow(res.rows[0]) : null;
  },
  /** Semua baris. */
  all: async (...args) => {
    const res = await exec({ sql, args: toArgs(args) });
    return res.rows.map(toRow);
  },
  /** INSERT/UPDATE/DELETE -> { changes, lastInsertRowid } */
  run: async (...args) => {
    const res = await exec({ sql, args: toArgs(args) });
    return {
      changes: num(res.rowsAffected) ?? 0,
      lastInsertRowid: num(res.lastInsertRowid) ?? null,
    };
  },
});

export const db = {
  prepare: runner((stmt) => client.execute(stmt)),

  /** Menjalankan beberapa pernyataan sekaligus (dipakai untuk skema). */
  exec: (sql) => client.executeMultiple(sql),

  /** Banyak pernyataan dalam satu transaksi implisit — jauh lebih cepat. */
  batch: (statements) =>
    client.batch(
      statements.map((s) =>
        typeof s === 'string' ? { sql: s, args: [] } : { sql: s.sql, args: toArgs([s.args || []]) }
      ),
      'write'
    ),

  /**
   * Transaksi eksplisit. Callback menerima objek dengan API yang sama
   * (prepare/get/all/run); commit otomatis, rollback bila terjadi error.
   */
  tx: async (fn) => {
    const t = await client.transaction('write');
    try {
      const result = await fn({ prepare: runner((stmt) => t.execute(stmt)) });
      await t.commit();
      return result;
    } catch (err) {
      try { await t.rollback(); } catch { /* sudah tertutup */ }
      throw err;
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Skema                                                                      */
/* -------------------------------------------------------------------------- */

const SCHEMA = `
-- ---------------------------------------------------------------------------
-- Kamar: kode kamar memakai format XYY (X = lantai, YY = nomor kamar 01-30)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  floor      INTEGER NOT NULL CHECK (floor BETWEEN 1 AND 3),
  number     INTEGER NOT NULL CHECK (number BETWEEN 1 AND 30),
  code       TEXT    NOT NULL UNIQUE,
  price      INTEGER NOT NULL DEFAULT 0,
  size       TEXT,
  notes      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (floor, number)
);

-- ---------------------------------------------------------------------------
-- Pengguna: hanya dua peran -> owner (pemilik) & tenant (penyewa)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  email             TEXT    NOT NULL UNIQUE,
  phone             TEXT,
  password_hash     TEXT    NOT NULL,
  role              TEXT    NOT NULL CHECK (role IN ('owner','tenant')),
  room_id           INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  status            TEXT    NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','nonaktif')),
  occupation        TEXT,
  emergency_contact TEXT,
  check_in_date     TEXT,
  check_out_date    TEXT,
  avatar_color      TEXT    NOT NULL DEFAULT '#2563eb',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, status);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- Gambar disimpan di database (base64), bukan di disk.
-- Vercel memakai filesystem sementara, jadi berkas unggahan tidak bisa
-- bertahan di disk. Gambar dilayani lewat GET /api/images/:id
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL,
  mime          TEXT    NOT NULL,
  bytes         INTEGER NOT NULL,
  data          TEXT    NOT NULL,
  original_name TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Denah & Fasilitas (dikelola owner, ditampilkan ke penyewa)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS floorplans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  floor       INTEGER NOT NULL UNIQUE CHECK (floor BETWEEN 1 AND 3),
  title       TEXT    NOT NULL,
  description TEXT,
  image_path  TEXT,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS facilities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  description  TEXT,
  category     TEXT    NOT NULL DEFAULT 'umum',
  icon         TEXT    NOT NULL DEFAULT '🏠',
  location     TEXT,
  photo_path   TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nearby_places (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  address     TEXT,
  distance_m  INTEGER,
  lat         REAL,
  lng         REAL,
  maps_query  TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Pengumuman: target semua / per lantai, bisa dijadwalkan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  target        TEXT    NOT NULL DEFAULT 'semua'
                CHECK (target IN ('semua','lantai_1','lantai_2','lantai_3')),
  category      TEXT    NOT NULL DEFAULT 'informasi',
  status        TEXT    NOT NULL DEFAULT 'terbit'
                CHECK (status IN ('terjadwal','terbit','arsip')),
  is_pinned     INTEGER NOT NULL DEFAULT 0,
  send_whatsapp INTEGER NOT NULL DEFAULT 0,
  scheduled_at  TEXT,
  published_at  TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ann_status ON announcements(status, scheduled_at);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (announcement_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Pusat Komplain / Lapor Kerusakan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id     INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'lainnya',
  location    TEXT    NOT NULL DEFAULT 'kamar',
  priority    TEXT    NOT NULL DEFAULT 'sedang' CHECK (priority IN ('rendah','sedang','tinggi')),
  status      TEXT    NOT NULL DEFAULT 'baru'  CHECK (status IN ('baru','diproses','selesai')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status, created_at);

CREATE TABLE IF NOT EXISTS complaint_photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id  INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  file_path     TEXT    NOT NULL,
  original_name TEXT,
  uploaded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS complaint_updates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT,
  note         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Keuangan: tagihan & pembayaran
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bills (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id    INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  title      TEXT    NOT NULL,
  period     TEXT    NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  due_date   TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'belum_bayar'
             CHECK (status IN ('belum_bayar','menunggu_pembayaran','lunas','terlambat')),
  note       TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  paid_at    TEXT,
  reminder_count    INTEGER NOT NULL DEFAULT 0,
  last_reminder_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_bills_tenant ON bills(tenant_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id        INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  tenant_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference      TEXT    NOT NULL UNIQUE,
  method         TEXT    NOT NULL,
  method_label   TEXT    NOT NULL,
  amount         INTEGER NOT NULL,
  fee            INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','berhasil','gagal','kedaluwarsa')),
  qr_payload     TEXT,
  qr_image       TEXT,
  va_number      TEXT,
  instructions   TEXT,
  failure_reason TEXT,
  expires_at     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  settled_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_bill ON payments(bill_id, status);

-- ---------------------------------------------------------------------------
-- Chat 1-1 antara owner & penyewa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id, id);

-- ---------------------------------------------------------------------------
-- Notifikasi in-app (dipakai juga untuk Web Notification API di browser)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  type       TEXT    NOT NULL DEFAULT 'info',
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, id);

CREATE TABLE IF NOT EXISTS wa_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  phone      TEXT    NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'umum',
  message    TEXT    NOT NULL,
  provider   TEXT    NOT NULL,
  status     TEXT    NOT NULL,
  response   TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

export async function migrate() {
  await db.exec(SCHEMA);
}

/* -------------------------------------------------------------------------- */
/* Helper setting                                                             */
/* -------------------------------------------------------------------------- */

export const getSetting = async (key, fallback = null) => {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
};

export const setSetting = (key, value) =>
  db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));

export default db;

import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import {
  asyncHandler, HttpError, requireFields, str, int, bool,
  daysUntil, formatRupiah, formatPeriode, formatTanggal, nowSql, todaySql,
} from '../lib/helpers.js';
import { notify } from '../services/notifications.js';
import { sendWhatsApp, templates, listWaLogs, waStatus } from '../services/whatsapp.js';
import { recipientsFor } from '../services/announcements.js';

const router = Router();

export const BILL_STATUS_META = {
  belum_bayar: { label: 'Belum Dibayar', tone: 'warn' },
  menunggu_pembayaran: { label: 'Menunggu Pembayaran', tone: 'info' },
  terlambat: { label: 'Terlambat', tone: 'bad' },
  lunas: { label: 'Lunas', tone: 'ok' },
};

const BILL_SELECT = `
  SELECT b.*, u.name AS tenant_name, u.phone AS tenant_phone, u.avatar_color,
         r.code AS room_code, r.floor AS room_floor,
         (SELECT p.status FROM payments p WHERE p.bill_id = b.id ORDER BY p.id DESC LIMIT 1) AS last_payment_status,
         (SELECT p.method_label FROM payments p WHERE p.bill_id = b.id AND p.status = 'berhasil' ORDER BY p.id DESC LIMIT 1) AS paid_method
    FROM bills b
    JOIN users u ON u.id = b.tenant_id
    LEFT JOIN rooms r ON r.id = b.room_id
`;

export const shapeBill = (row) => ({
  id: row.id,
  title: row.title,
  period: row.period,
  periodLabel: formatPeriode(row.period),
  amount: row.amount,
  amountLabel: formatRupiah(row.amount),
  dueDate: row.due_date,
  dueDateLabel: formatTanggal(row.due_date),
  daysToDue: daysUntil(row.due_date),
  status: row.status,
  statusLabel: BILL_STATUS_META[row.status]?.label || row.status,
  statusTone: BILL_STATUS_META[row.status]?.tone || 'muted',
  note: row.note || '',
  createdAt: row.created_at,
  paidAt: row.paid_at,
  paidMethod: row.paid_method || null,
  lastPaymentStatus: row.last_payment_status || null,
  reminderCount: row.reminder_count,
  lastReminderAt: row.last_reminder_at,
  tenant: {
    id: row.tenant_id,
    name: row.tenant_name,
    phone: row.tenant_phone || '',
    avatarColor: row.avatar_color,
    roomCode: row.room_code || null,
    roomFloor: row.room_floor || null,
  },
});

/* -------------------------------------------------------------------------- */
/* Tandai tagihan yang sudah lewat jatuh tempo                                */
/* -------------------------------------------------------------------------- */
export function refreshOverdueBills() {
  return db
    .prepare(
      `UPDATE bills SET status = 'terlambat'
        WHERE status = 'belum_bayar' AND due_date < date('now')`
    )
    .run().changes;
}

/* -------------------------------------------------------------------------- */
/* GET /api/owner/finance - ringkasan keuangan + daftar tagihan               */
/* -------------------------------------------------------------------------- */
router.get(
  '/finance',
  asyncHandler(async (req, res) => {
    refreshOverdueBills();

    const status = str(req.query.status, 30);
    const floor = int(req.query.floor, 0);
    const period = str(req.query.period, 10);

    const where = [];
    const params = [];
    if (status && status !== 'semua') {
      where.push('b.status = ?');
      params.push(status);
    }
    if (floor) {
      where.push('r.floor = ?');
      params.push(floor);
    }
    if (period) {
      where.push('b.period = ?');
      params.push(period);
    }

    const rows = db
      .prepare(
        `${BILL_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ` +
        `ORDER BY CASE b.status WHEN 'terlambat' THEN 0 WHEN 'belum_bayar' THEN 1 ` +
        `WHEN 'menunggu_pembayaran' THEN 2 ELSE 3 END, b.due_date`
      )
      .all(...params);

    const totals = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'lunas' THEN amount END), 0) AS lunas,
           COALESCE(SUM(CASE WHEN status IN ('belum_bayar','menunggu_pembayaran') THEN amount END), 0) AS belum,
           COALESCE(SUM(CASE WHEN status = 'terlambat' THEN amount END), 0) AS terlambat,
           COUNT(*) AS total_tagihan,
           SUM(CASE WHEN status = 'lunas' THEN 1 ELSE 0 END) AS jml_lunas,
           SUM(CASE WHEN status = 'terlambat' THEN 1 ELSE 0 END) AS jml_terlambat,
           SUM(CASE WHEN status IN ('belum_bayar','menunggu_pembayaran') THEN 1 ELSE 0 END) AS jml_belum
         FROM bills`
      )
      .get();

    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthly = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'lunas' THEN amount END), 0) AS masuk,
           COALESCE(SUM(CASE WHEN status <> 'lunas' THEN amount END), 0) AS tertunggak
         FROM bills WHERE period = ?`
      )
      .get(thisMonth);

    const periods = db.prepare('SELECT DISTINCT period FROM bills ORDER BY period DESC LIMIT 12').all();

    res.json({
      bills: rows.map(shapeBill),
      summary: {
        totalLunas: totals.lunas,
        totalBelum: totals.belum,
        totalTerlambat: totals.terlambat,
        piutang: totals.belum + totals.terlambat,
        jumlahTagihan: totals.total_tagihan,
        jumlahLunas: totals.jml_lunas || 0,
        jumlahBelum: totals.jml_belum || 0,
        jumlahTerlambat: totals.jml_terlambat || 0,
        bulanIni: { period: thisMonth, periodLabel: formatPeriode(thisMonth), ...monthly },
      },
      periods: periods.map((p) => ({ period: p.period, label: formatPeriode(p.period) })),
      statuses: Object.entries(BILL_STATUS_META).map(([code, m]) => ({ code, ...m })),
      whatsapp: waStatus(),
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/owner/bills - terbitkan tagihan (kirim notifikasi + WhatsApp)    */
/* Body: scope = 'semua' | 'lantai_1' | 'lantai_2' | 'lantai_3' | 'pilih'     */
/*       tenantIds[] (untuk scope 'pilih'), title, period, dueDate,           */
/*       amount | useRoomPrice, note, sendWhatsapp, sendNotification          */
/* -------------------------------------------------------------------------- */
router.post(
  '/bills',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['title', 'period', 'dueDate', 'scope']);

    const title = str(req.body.title, 120);
    const period = str(req.body.period, 10);
    const dueDate = str(req.body.dueDate, 10);
    const note = str(req.body.note, 500);
    const scope = str(req.body.scope, 20);
    const useRoomPrice = bool(req.body.useRoomPrice);
    const amount = int(req.body.amount, 0);
    const sendWa = bool(req.body.sendWhatsapp);

    if (!/^\d{4}-\d{2}$/.test(period)) throw new HttpError(400, 'Periode harus format YYYY-MM, contoh 2026-03.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new HttpError(400, 'Tanggal jatuh tempo harus format YYYY-MM-DD.');
    if (!useRoomPrice && amount <= 0) throw new HttpError(400, 'Nominal tagihan harus lebih dari 0, atau pilih "pakai harga kamar".');

    // Tentukan daftar penyewa penerima tagihan.
    let targets;
    if (scope === 'pilih') {
      const ids = Array.isArray(req.body.tenantIds) ? req.body.tenantIds.map((v) => int(v)).filter(Boolean) : [];
      if (!ids.length) throw new HttpError(400, 'Pilih minimal satu penyewa.');
      const placeholders = ids.map(() => '?').join(',');
      targets = db
        .prepare(
          `SELECT u.id, u.name, u.phone, u.room_id, r.code AS room_code, r.price AS room_price
             FROM users u LEFT JOIN rooms r ON r.id = u.room_id
            WHERE u.role = 'tenant' AND u.status = 'aktif' AND u.id IN (${placeholders})`
        )
        .all(...ids);
    } else {
      const scopeCode = scope === 'semua' ? 'semua' : scope;
      if (!['semua', 'lantai_1', 'lantai_2', 'lantai_3'].includes(scopeCode)) {
        throw new HttpError(400, 'Lingkup penerima tidak valid.');
      }
      const base = recipientsFor(scopeCode);
      const ids = base.map((b) => b.id);
      targets = ids.length
        ? db
          .prepare(
            `SELECT u.id, u.name, u.phone, u.room_id, r.code AS room_code, r.price AS room_price
               FROM users u LEFT JOIN rooms r ON r.id = u.room_id
              WHERE u.id IN (${ids.map(() => '?').join(',')})`
          )
          .all(...ids)
        : [];
    }

    if (!targets.length) throw new HttpError(400, 'Tidak ada penyewa aktif pada lingkup yang dipilih.');

    const created = [];
    const skipped = [];

    const insert = db.prepare(
      `INSERT INTO bills (tenant_id, room_id, title, period, amount, due_date, status, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'belum_bayar', ?, ?)`
    );

    const createAll = db.transaction(() => {
      for (const t of targets) {
        const billAmount = useRoomPrice ? int(t.room_price, 0) : amount;
        if (billAmount <= 0) {
          skipped.push({ tenant: t.name, reason: 'Harga kamar belum diisi' });
          continue;
        }
        const duplicate = db
          .prepare('SELECT id FROM bills WHERE tenant_id = ? AND period = ? AND title = ?')
          .get(t.id, period, title);
        if (duplicate) {
          skipped.push({ tenant: t.name, reason: `Tagihan "${title}" periode ${formatPeriode(period)} sudah ada` });
          continue;
        }
        const info = insert.run(t.id, t.room_id, title, period, billAmount, dueDate, note, req.user.id);
        created.push({ billId: Number(info.lastInsertRowid), tenant: t, amount: billAmount });
      }
    });
    createAll();

    // Notifikasi web untuk setiap tagihan baru.
    for (const item of created) {
      notify({
        userId: item.tenant.id,
        title: `Tagihan baru: ${title}`,
        body: `${formatRupiah(item.amount)} untuk periode ${formatPeriode(period)}. Jatuh tempo ${formatTanggal(dueDate)}.`,
        type: 'bill',
        link: '#/penyewa/tagihan',
      });
    }

    // Kirim WhatsApp (paralel, kegagalan per-nomor tidak membatalkan yang lain).
    let whatsapp = { attempted: 0, sent: 0, failed: 0, simulated: 0, details: [] };
    if (sendWa && created.length) {
      const withPhone = created.filter((c) => c.tenant.phone);
      const results = await Promise.all(
        withPhone.map(async (item) => {
          const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(item.billId);
          const result = await sendWhatsApp({
            userId: item.tenant.id,
            phone: item.tenant.phone,
            kind: 'tagihan',
            message: templates.tagihanBaru({ tenant: item.tenant, bill }),
          });
          return { tenant: item.tenant.name, ...result };
        })
      );
      whatsapp = {
        attempted: results.length,
        sent: results.filter((r) => r.status === 'terkirim').length,
        simulated: results.filter((r) => r.status === 'simulasi').length,
        failed: results.filter((r) => r.status === 'gagal').length,
        noPhone: created.length - withPhone.length,
        details: results.map((r) => ({ tenant: r.tenant, status: r.status, reason: r.reason || null })),
      };
    }

    res.status(201).json({
      created: created.length,
      skipped,
      whatsapp,
      message:
        `${created.length} tagihan diterbitkan` +
        (skipped.length ? `, ${skipped.length} dilewati` : '') +
        (sendWa ? `, WhatsApp: ${whatsapp.sent + whatsapp.simulated}/${whatsapp.attempted} terkirim` : '') + '.',
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/owner/bills/:id/reminder - pengingat via notifikasi + WhatsApp   */
/* -------------------------------------------------------------------------- */
router.post(
  '/bills/:id/reminder',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const bill = db.prepare(`${BILL_SELECT} WHERE b.id = ?`).get(id);
    if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan.');
    if (bill.status === 'lunas') throw new HttpError(409, 'Tagihan ini sudah lunas, tidak perlu pengingat.');

    const dueInDays = daysUntil(bill.due_date);
    const customMessage = str(req.body.message, 1000);

    notify({
      userId: bill.tenant_id,
      title: `Pengingat: ${bill.title}`,
      body: customMessage ||
        `${formatRupiah(bill.amount)} periode ${formatPeriode(bill.period)} belum dibayar. ` +
        (dueInDays < 0
          ? `Terlambat ${Math.abs(dueInDays)} hari.`
          : dueInDays === 0 ? 'Jatuh tempo hari ini.' : `Jatuh tempo dalam ${dueInDays} hari.`),
      type: 'bill',
      link: '#/penyewa/tagihan',
    });

    let whatsapp = null;
    if (bool(req.body.sendWhatsapp ?? true)) {
      whatsapp = await sendWhatsApp({
        userId: bill.tenant_id,
        phone: bill.tenant_phone,
        kind: 'reminder',
        message: customMessage
          ? `*${config.kost.name}*\n\n${customMessage}`
          : templates.reminderTagihan({
            tenant: { name: bill.tenant_name, room_code: bill.room_code },
            bill,
            dueInDays,
          }),
      });
    }

    db.prepare('UPDATE bills SET reminder_count = reminder_count + 1, last_reminder_at = ? WHERE id = ?')
      .run(nowSql(), id);

    const fresh = db.prepare(`${BILL_SELECT} WHERE b.id = ?`).get(id);
    res.json({
      bill: shapeBill(fresh),
      whatsapp,
      message: `Pengingat terkirim ke ${bill.tenant_name}` +
        (whatsapp ? ` (WhatsApp: ${whatsapp.status})` : ' (notifikasi web)') + '.',
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/owner/bills/reminders - pengingat massal untuk yang menunggak    */
/* -------------------------------------------------------------------------- */
router.post(
  '/bills/reminders',
  asyncHandler(async (req, res) => {
    refreshOverdueBills();
    const onlyOverdue = bool(req.body.onlyOverdue);
    const sendWa = bool(req.body.sendWhatsapp ?? true);

    const statuses = onlyOverdue ? ['terlambat'] : ['terlambat', 'belum_bayar', 'menunggu_pembayaran'];
    const bills = db
      .prepare(`${BILL_SELECT} WHERE b.status IN (${statuses.map(() => '?').join(',')}) ORDER BY b.due_date`)
      .all(...statuses);

    if (!bills.length) {
      return res.json({ sent: 0, message: 'Tidak ada tagihan yang perlu diingatkan. 🎉' });
    }

    const results = [];
    for (const bill of bills) {
      const dueInDays = daysUntil(bill.due_date);
      notify({
        userId: bill.tenant_id,
        title: `Pengingat: ${bill.title}`,
        body: `${formatRupiah(bill.amount)} periode ${formatPeriode(bill.period)} belum dibayar.`,
        type: 'bill',
        link: '#/penyewa/tagihan',
      });

      let wa = null;
      if (sendWa && bill.tenant_phone) {
        // eslint-disable-next-line no-await-in-loop
        wa = await sendWhatsApp({
          userId: bill.tenant_id,
          phone: bill.tenant_phone,
          kind: 'reminder',
          message: templates.reminderTagihan({
            tenant: { name: bill.tenant_name, room_code: bill.room_code },
            bill,
            dueInDays,
          }),
        });
      }
      db.prepare('UPDATE bills SET reminder_count = reminder_count + 1, last_reminder_at = ? WHERE id = ?')
        .run(nowSql(), bill.id);
      results.push({ billId: bill.id, tenant: bill.tenant_name, roomCode: bill.room_code, whatsapp: wa?.status || 'tidak dikirim' });
    }

    return res.json({
      sent: results.length,
      results,
      message: `Pengingat terkirim untuk ${results.length} tagihan.`,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* PUT /api/owner/bills/:id                                                   */
/* -------------------------------------------------------------------------- */
router.put(
  '/bills/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const current = db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Tagihan tidak ditemukan.');
    if (current.status === 'lunas') throw new HttpError(409, 'Tagihan lunas tidak dapat diubah.');

    const amount = req.body.amount !== undefined ? int(req.body.amount, current.amount) : current.amount;
    if (amount <= 0) throw new HttpError(400, 'Nominal tagihan harus lebih dari 0.');
    const dueDate = str(req.body.dueDate, 10) || current.due_date;

    db.prepare('UPDATE bills SET title = ?, amount = ?, due_date = ?, note = ? WHERE id = ?').run(
      str(req.body.title, 120) || current.title,
      amount,
      dueDate,
      req.body.note !== undefined ? str(req.body.note, 500) : current.note,
      id
    );
    refreshOverdueBills();

    notify({
      userId: current.tenant_id,
      title: 'Tagihan diperbarui',
      body: `${str(req.body.title, 120) || current.title} kini ${formatRupiah(amount)}, jatuh tempo ${formatTanggal(dueDate)}.`,
      type: 'bill',
      link: '#/penyewa/tagihan',
    });

    res.json({ bill: shapeBill(db.prepare(`${BILL_SELECT} WHERE b.id = ?`).get(id)), message: 'Tagihan diperbarui.' });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/owner/bills/:id/mark-paid - pembayaran manual (tunai/transfer)   */
/* -------------------------------------------------------------------------- */
router.post(
  '/bills/:id/mark-paid',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const bill = db.prepare(`${BILL_SELECT} WHERE b.id = ?`).get(id);
    if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan.');
    if (bill.status === 'lunas') throw new HttpError(409, 'Tagihan ini sudah lunas.');

    const methodLabel = str(req.body.methodLabel, 60) || 'Tunai / Transfer Manual';
    const stamp = nowSql();

    db.transaction(() => {
      db.prepare("UPDATE bills SET status = 'lunas', paid_at = ? WHERE id = ?").run(stamp, id);
      db.prepare(
        `INSERT INTO payments (bill_id, tenant_id, reference, method, method_label, amount, fee, total, status, settled_at)
         VALUES (?, ?, ?, 'manual', ?, ?, 0, ?, 'berhasil', ?)`
      ).run(id, bill.tenant_id, `MAN-${id}-${Date.now().toString(36).toUpperCase()}`, methodLabel, bill.amount, bill.amount, stamp);
      db.prepare("UPDATE payments SET status = 'kedaluwarsa', settled_at = ? WHERE bill_id = ? AND status = 'pending'")
        .run(stamp, id);
    })();

    notify({
      userId: bill.tenant_id,
      title: 'Pembayaran tercatat ✅',
      body: `${bill.title} periode ${formatPeriode(bill.period)} sebesar ${formatRupiah(bill.amount)} sudah dilunasi (${methodLabel}).`,
      type: 'success',
      link: '#/penyewa/tagihan',
    });

    res.json({ bill: shapeBill(db.prepare(`${BILL_SELECT} WHERE b.id = ?`).get(id)), message: 'Tagihan ditandai lunas.' });
  })
);

/* -------------------------------------------------------------------------- */
/* DELETE /api/owner/bills/:id                                                */
/* -------------------------------------------------------------------------- */
router.delete(
  '/bills/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id);
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
    if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan.');
    if (bill.status === 'lunas') throw new HttpError(409, 'Tagihan yang sudah lunas tidak dapat dihapus.');
    db.prepare('DELETE FROM bills WHERE id = ?').run(id);
    res.json({ ok: true, message: 'Tagihan dihapus.' });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/owner/payments - riwayat transaksi penyewa                        */
/* -------------------------------------------------------------------------- */
router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT p.*, u.name AS tenant_name, r.code AS room_code, b.title AS bill_title, b.period
           FROM payments p
           JOIN users u ON u.id = p.tenant_id
           JOIN bills b ON b.id = p.bill_id
      LEFT JOIN rooms r ON r.id = u.room_id
          ORDER BY p.id DESC LIMIT ?`
      )
      .all(int(req.query.limit, 100));

    res.json({
      payments: rows.map((p) => ({
        id: p.id,
        reference: p.reference,
        tenantName: p.tenant_name,
        roomCode: p.room_code,
        billTitle: p.bill_title,
        period: p.period,
        periodLabel: formatPeriode(p.period),
        method: p.method,
        methodLabel: p.method_label,
        amount: p.amount,
        fee: p.fee,
        total: p.total,
        totalLabel: formatRupiah(p.total),
        status: p.status,
        failureReason: p.failure_reason,
        createdAt: p.created_at,
        settledAt: p.settled_at,
      })),
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/owner/wa-logs - bukti pengiriman WhatsApp                         */
/* -------------------------------------------------------------------------- */
router.get(
  '/wa-logs',
  asyncHandler(async (req, res) => {
    res.json({
      logs: listWaLogs({ limit: int(req.query.limit, 50) }).map((l) => ({
        id: l.id,
        userName: l.user_name,
        phone: l.phone,
        kind: l.kind,
        message: l.message,
        provider: l.provider,
        status: l.status,
        response: l.response,
        createdAt: l.created_at,
      })),
      status: waStatus(),
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/owner/dashboard - ringkasan beranda owner                         */
/* -------------------------------------------------------------------------- */
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    refreshOverdueBills();

    const tenants = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'tenant' AND status = 'aktif'")
      .get().n;
    const rooms = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
    const complaints = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'baru'     THEN 1 ELSE 0 END) AS baru,
           SUM(CASE WHEN status = 'diproses' THEN 1 ELSE 0 END) AS diproses,
           SUM(CASE WHEN status = 'selesai'  THEN 1 ELSE 0 END) AS selesai
         FROM complaints`
      )
      .get();
    const finance = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'lunas' AND period = ? THEN amount END), 0) AS masuk_bulan_ini,
           COALESCE(SUM(CASE WHEN status IN ('belum_bayar','menunggu_pembayaran','terlambat') THEN amount END), 0) AS piutang,
           SUM(CASE WHEN status = 'terlambat' THEN 1 ELSE 0 END) AS jml_terlambat
         FROM bills`
      )
      .get(new Date().toISOString().slice(0, 7));

    const upcoming = db
      .prepare(
        `SELECT a.id, a.title, a.target, a.scheduled_at FROM announcements a
          WHERE a.status = 'terjadwal' ORDER BY a.scheduled_at LIMIT 5`
      )
      .all();

    const unreadChats = db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages m
           JOIN users u ON u.id = m.sender_id
          WHERE m.receiver_id = ? AND m.read_at IS NULL`
      )
      .get(req.user.id).n;

    const recentComplaints = db
      .prepare(
        `SELECT c.id, c.title, c.status, c.created_at, u.name AS tenant_name, r.code AS room_code
           FROM complaints c JOIN users u ON u.id = c.tenant_id
      LEFT JOIN rooms r ON r.id = c.room_id
          WHERE c.status <> 'selesai'
          ORDER BY c.created_at DESC LIMIT 5`
      )
      .all();

    const dueSoon = db
      .prepare(
        `${BILL_SELECT} WHERE b.status <> 'lunas' AND b.due_date <= date('now', '+7 day')
          ORDER BY b.due_date LIMIT 8`
      )
      .all();

    res.json({
      kost: config.kost,
      stats: {
        tenantsActive: tenants,
        rooms,
        occupancyRate: rooms ? Math.round((tenants / rooms) * 100) : 0,
        complaints: {
          baru: complaints.baru || 0,
          diproses: complaints.diproses || 0,
          selesai: complaints.selesai || 0,
        },
        finance: {
          masukBulanIni: finance.masuk_bulan_ini,
          piutang: finance.piutang,
          jumlahTerlambat: finance.jml_terlambat || 0,
        },
        unreadChats,
      },
      scheduledAnnouncements: upcoming,
      recentComplaints,
      dueSoon: dueSoon.map(shapeBill),
      today: todaySql(),
    });
  })
);

export default router;

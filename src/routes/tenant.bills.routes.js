import { Router } from 'express';
import { db } from '../db.js';
import { config, PAYMENT_METHODS } from '../config.js';
import {
  asyncHandler, HttpError, requireFields, str, int,
  daysUntil, formatRupiah, formatPeriode, formatTanggal,
} from '../lib/helpers.js';
import {
  createPayment, getPaymentByRef, settlePayment, expireStalePayments, paymentStatusMeta,
} from '../services/payments.js';
import { notify, notifyOwners } from '../services/notifications.js';
import { sendWhatsApp, templates } from '../services/whatsapp.js';
import { BILL_STATUS_META, refreshOverdueBills } from './owner.finance.routes.js';

const router = Router();

const shapeMyBill = (row) => {
  const days = daysUntil(row.due_date);
  return {
    id: row.id,
    title: row.title,
    period: row.period,
    periodLabel: formatPeriode(row.period),
    amount: row.amount,
    amountLabel: formatRupiah(row.amount),
    dueDate: row.due_date,
    dueDateLabel: formatTanggal(row.due_date),
    daysToDue: days,
    isOverdue: row.status !== 'lunas' && days !== null && days < 0,
    status: row.status,
    statusLabel: BILL_STATUS_META[row.status]?.label || row.status,
    statusTone: BILL_STATUS_META[row.status]?.tone || 'muted',
    note: row.note || '',
    paidAt: row.paid_at,
    paidMethod: row.paid_method || null,
    createdAt: row.created_at,
    // Tagihan dapat dibayar bila belum lunas.
    payable: row.status !== 'lunas',
    pendingReference: row.pending_reference || null,
  };
};

const MY_BILL_SELECT = `
  SELECT b.*,
         (SELECT p.method_label FROM payments p
           WHERE p.bill_id = b.id AND p.status = 'berhasil' ORDER BY p.id DESC LIMIT 1) AS paid_method,
         (SELECT p.reference FROM payments p
           WHERE p.bill_id = b.id AND p.status = 'pending' ORDER BY p.id DESC LIMIT 1) AS pending_reference
    FROM bills b
`;

const shapePayment = (p) => ({
  id: p.id,
  reference: p.reference,
  billId: p.bill_id,
  method: p.method,
  methodLabel: p.method_label,
  type: PAYMENT_METHODS.find((m) => m.code === p.method)?.type || 'manual',
  amount: p.amount,
  fee: p.fee,
  total: p.total,
  amountLabel: formatRupiah(p.amount),
  feeLabel: formatRupiah(p.fee),
  totalLabel: formatRupiah(p.total),
  status: p.status,
  statusLabel: paymentStatusMeta[p.status]?.label || p.status,
  statusTone: paymentStatusMeta[p.status]?.tone || 'muted',
  qrImage: p.qr_image || null,
  qrPayload: p.qr_payload || null,
  vaNumber: p.va_number || null,
  instructions: p.instructions || '',
  failureReason: p.failure_reason || null,
  expiresAt: p.expires_at,
  createdAt: p.created_at,
  settledAt: p.settled_at,
  // Mode mock memperbolehkan simulasi hasil transaksi dari UI.
  canSimulate: config.payment.provider === 'mock' && p.status === 'pending',
});

/* -------------------------------------------------------------------------- */
/* GET /api/tenant/bills - tagihan jatuh tempo & yang akan datang             */
/* -------------------------------------------------------------------------- */
router.get(
  '/bills',
  asyncHandler(async (req, res) => {
    refreshOverdueBills();
    expireStalePayments();

    const rows = db
      .prepare(`${MY_BILL_SELECT} WHERE b.tenant_id = ? ORDER BY b.due_date DESC`)
      .all(req.user.id);
    const bills = rows.map(shapeMyBill);

    const unpaid = bills.filter((b) => b.status !== 'lunas');
    const overdue = unpaid.filter((b) => b.isOverdue);
    const upcoming = unpaid.filter((b) => !b.isOverdue);

    const payments = db
      .prepare('SELECT * FROM payments WHERE tenant_id = ? ORDER BY id DESC LIMIT 20')
      .all(req.user.id)
      .map(shapePayment);

    res.json({
      bills,
      overdue,
      upcoming,
      paid: bills.filter((b) => b.status === 'lunas'),
      summary: {
        totalTagihan: unpaid.reduce((s, b) => s + b.amount, 0),
        totalTagihanLabel: formatRupiah(unpaid.reduce((s, b) => s + b.amount, 0)),
        jumlahBelumBayar: unpaid.length,
        jumlahTerlambat: overdue.length,
        tagihanTerdekat: upcoming[upcoming.length - 1] || null,
        totalDibayar: bills.filter((b) => b.status === 'lunas').reduce((s, b) => s + b.amount, 0),
      },
      methods: PAYMENT_METHODS.map((m) => ({
        code: m.code,
        label: m.label,
        type: m.type,
        issuer: m.issuer,
        fee: m.fee,
        feeLabel: m.fee ? formatRupiah(m.fee) : 'Gratis',
      })),
      payments,
      room: req.user.room_code ? { code: req.user.room_code, floor: req.user.room_floor, price: req.user.room_price } : null,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/tenant/payments - buat transaksi QRIS / Virtual Account          */
/* Body: billId, method                                                       */
/* -------------------------------------------------------------------------- */
router.post(
  '/payments',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['billId', 'method']);
    const billId = int(req.body.billId);

    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND tenant_id = ?').get(billId, req.user.id);
    if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan.');
    if (bill.status === 'lunas') throw new HttpError(409, 'Tagihan ini sudah lunas.');

    const payment = await createPayment({
      bill,
      tenant: req.user,
      methodCode: str(req.body.method, 20),
    });

    res.status(201).json({
      payment: shapePayment(payment),
      bill: shapeMyBill(db.prepare(`${MY_BILL_SELECT} WHERE b.id = ?`).get(billId)),
      message: payment.va_number
        ? `Virtual Account dibuat: ${payment.va_number}. Selesaikan pembayaran sebelum batas waktu.`
        : 'Kode QRIS siap. Silakan scan untuk membayar.',
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/tenant/payments/:reference - cek status transaksi                 */
/* -------------------------------------------------------------------------- */
router.get(
  '/payments/:reference',
  asyncHandler(async (req, res) => {
    expireStalePayments();
    const payment = getPaymentByRef(str(req.params.reference, 40));
    if (!payment || payment.tenant_id !== req.user.id) {
      throw new HttpError(404, 'Transaksi tidak ditemukan.');
    }
    const bill = db.prepare(`${MY_BILL_SELECT} WHERE b.id = ?`).get(payment.bill_id);
    res.json({ payment: shapePayment(payment), bill: shapeMyBill(bill) });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/tenant/payments/:reference/simulate                              */
/* Khusus PAYMENT_PROVIDER=mock: mensimulasikan hasil dari payment gateway    */
/* supaya alur "berhasil / gagal" bisa dicoba tanpa akun gateway asli.        */
/* -------------------------------------------------------------------------- */
router.post(
  '/payments/:reference/simulate',
  asyncHandler(async (req, res) => {
    if (config.payment.provider !== 'mock') {
      throw new HttpError(400, 'Simulasi hanya tersedia pada mode PAYMENT_PROVIDER=mock.');
    }
    const reference = str(req.params.reference, 40);
    const outcome = str(req.body.outcome, 20) || 'berhasil';

    const existing = getPaymentByRef(reference);
    if (!existing || existing.tenant_id !== req.user.id) {
      throw new HttpError(404, 'Transaksi tidak ditemukan.');
    }

    const payment = settlePayment(reference, outcome, str(req.body.reason, 200) || null);
    const result = await handleSettlement(payment);

    res.json({
      payment: shapePayment(payment),
      bill: shapeMyBill(db.prepare(`${MY_BILL_SELECT} WHERE b.id = ?`).get(payment.bill_id)),
      ...result,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/tenant/payments/:reference/cancel                                */
/* -------------------------------------------------------------------------- */
router.post(
  '/payments/:reference/cancel',
  asyncHandler(async (req, res) => {
    const reference = str(req.params.reference, 40);
    const payment = getPaymentByRef(reference);
    if (!payment || payment.tenant_id !== req.user.id) throw new HttpError(404, 'Transaksi tidak ditemukan.');
    if (payment.status !== 'pending') throw new HttpError(409, 'Transaksi ini sudah selesai diproses.');

    db.prepare(
      `UPDATE payments SET status = 'kedaluwarsa', failure_reason = 'Dibatalkan oleh penyewa', settled_at = datetime('now')
        WHERE id = ?`
    ).run(payment.id);
    db.prepare(
      `UPDATE bills SET status = CASE WHEN due_date < date('now') THEN 'terlambat' ELSE 'belum_bayar' END
        WHERE id = ? AND status = 'menunggu_pembayaran'`
    ).run(payment.bill_id);

    res.json({
      payment: shapePayment(getPaymentByRef(reference)),
      bill: shapeMyBill(db.prepare(`${MY_BILL_SELECT} WHERE b.id = ?`).get(payment.bill_id)),
      message: 'Transaksi dibatalkan. Anda dapat memilih metode pembayaran lain.',
    });
  })
);

/**
 * Efek samping setelah transaksi final: notifikasi untuk penyewa & owner,
 * plus struk WhatsApp bila berhasil. Dipakai juga oleh webhook gateway.
 */
export async function handleSettlement(payment) {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(payment.bill_id);
  const tenant = db
    .prepare('SELECT u.*, r.code AS room_code FROM users u LEFT JOIN rooms r ON r.id = u.room_id WHERE u.id = ?')
    .get(payment.tenant_id);

  if (payment.status === 'berhasil') {
    notify({
      userId: tenant.id,
      title: 'Pembayaran berhasil ✅',
      body: `${bill.title} (${formatPeriode(bill.period)}) sebesar ${formatRupiah(payment.total)} via ${payment.method_label}. Ref: ${payment.reference}`,
      type: 'success',
      link: '#/penyewa/tagihan',
    });
    notifyOwners({
      title: `Pembayaran masuk: ${tenant.room_code || tenant.name}`,
      body: `${tenant.name} membayar ${bill.title} ${formatPeriode(bill.period)} sebesar ${formatRupiah(payment.total)} via ${payment.method_label}.`,
      type: 'success',
      link: '#/owner/keuangan',
    });

    const wa = await sendWhatsApp({
      userId: tenant.id,
      phone: tenant.phone,
      kind: 'struk',
      message: templates.pembayaranBerhasil({ tenant, bill, payment }),
    });
    return { message: 'Pembayaran berhasil. Struk dikirim ke WhatsApp Anda.', whatsapp: wa };
  }

  notify({
    userId: tenant.id,
    title: 'Pembayaran gagal ❌',
    body: `${payment.failure_reason || 'Transaksi tidak berhasil'}. Ref: ${payment.reference}. Silakan coba lagi.`,
    type: 'error',
    link: '#/penyewa/tagihan',
  });
  return { message: `Pembayaran gagal: ${payment.failure_reason || 'transaksi ditolak'}.` };
}

export default router;

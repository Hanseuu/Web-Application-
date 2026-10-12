import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { db } from '../db.js';
import { config, PAYMENT_METHODS } from '../config.js';
import { HttpError, randomCode, toSqlDateTime, addDays, nowSql } from '../lib/helpers.js';

/**
 * Layanan pembayaran untuk halaman "Tagihan Saya".
 *
 * PAYMENT_PROVIDER=mock (default)
 *   - QRIS: payload EMVCo dibuat lokal + di-render jadi gambar QR (data URL)
 *   - VA  : nomor virtual account dibuat lokal dengan prefix bank
 *   - Status transaksi berubah lewat webhook /api/webhooks/payment
 *     atau tombol simulasi di UI (POST /api/tenant/payments/:ref/simulate)
 *
 * PAYMENT_PROVIDER=custom
 *   - Request pembuatan transaksi diteruskan ke PAYMENT_API_URL, lalu
 *     gateway asli memanggil webhook kita untuk update status.
 */

export const getMethod = (code) => PAYMENT_METHODS.find((m) => m.code === code) || null;

/* -------------------------------------------------------------------------- */
/* QRIS (EMVCo) payload                                                       */
/* -------------------------------------------------------------------------- */

const tlv = (tag, value) => `${tag}${String(value.length).padStart(2, '0')}${value}`;

/** CRC16/CCITT-FALSE sesuai spesifikasi EMVCo tag 63. */
function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildQrisPayload({ amount, reference }) {
  const merchantAccount =
    tlv('00', 'ID.CO.QRIS.WWW') +
    tlv('01', config.payment.merchantId) +
    tlv('02', String(reference).slice(0, 20)) +
    tlv('03', 'UMI');

  let payload =
    tlv('00', '01') +                                       // format indicator
    tlv('01', '12') +                                       // dynamic QR (sekali pakai)
    tlv('26', merchantAccount) +                            // merchant account info
    tlv('52', '5999') +                                     // merchant category code
    tlv('53', '360') +                                      // mata uang: IDR
    tlv('54', String(Math.round(amount))) +                 // nominal transaksi
    tlv('58', 'ID') +                                       // negara
    tlv('59', config.payment.merchantName.slice(0, 25)) +
    tlv('60', config.payment.merchantCity.slice(0, 15)) +
    tlv('62', tlv('01', String(reference).slice(0, 25)));    // additional data: bill ref

  payload += '6304';
  return payload + crc16(payload);
}

const vaNumber = (method, billId) => {
  const prefix = method.prefix || '88888';
  const tail = String(billId).padStart(4, '0') + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}${tail}`.slice(0, 16);
};

const instructionsFor = (method, va) => {
  if (method.type === 'qris') {
    return [
      'Buka aplikasi m-banking atau e-wallet Anda (GoPay, OVO, DANA, ShopeePay, dll).',
      'Pilih menu Bayar / Scan QRIS.',
      'Scan kode QR di atas, lalu pastikan nama merchant dan nominal sudah sesuai.',
      'Selesaikan pembayaran. Status tagihan akan otomatis diperbarui.',
    ].join('\n');
  }
  return [
    `Buka aplikasi m-banking ${method.issuer} atau ATM.`,
    'Pilih menu Transfer > Virtual Account.',
    `Masukkan nomor Virtual Account: ${va}`,
    'Pastikan nama penerima dan nominal sudah sesuai, lalu konfirmasi pembayaran.',
    'Status tagihan akan otomatis diperbarui setelah pembayaran diterima.',
  ].join('\n');
};

/* -------------------------------------------------------------------------- */
/* Pembuatan transaksi                                                        */
/* -------------------------------------------------------------------------- */

export async function createPayment({ bill, tenant, methodCode }) {
  const method = getMethod(methodCode);
  if (!method) throw new HttpError(400, 'Metode pembayaran tidak dikenali.');
  if (bill.status === 'lunas') throw new HttpError(409, 'Tagihan ini sudah lunas.');

  // Batalkan transaksi pending sebelumnya untuk tagihan yang sama.
  db.prepare(
    `UPDATE payments SET status = 'kedaluwarsa', failure_reason = 'Diganti transaksi baru', settled_at = ?
      WHERE bill_id = ? AND status = 'pending'`
  ).run(nowSql(), bill.id);

  const reference = `KMN-${new Date().getFullYear()}-${randomCode(8)}`;
  const fee = method.fee || 0;
  const total = bill.amount + fee;
  const expiresAt = toSqlDateTime(new Date(Date.now() + config.payment.expiryMinutes * 60000));

  let qrPayload = null;
  let qrImage = null;
  let va = null;

  if (method.type === 'qris') {
    qrPayload = buildQrisPayload({ amount: total, reference });
    qrImage = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  } else {
    va = vaNumber(method, bill.id);
  }

  // Provider nyata: teruskan ke gateway. Bila gagal, lempar error agar user tahu.
  if (config.payment.provider === 'custom' && config.payment.apiUrl) {
    const res = await fetch(config.payment.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.payment.apiKey}`,
      },
      body: JSON.stringify({
        reference,
        amount: total,
        method: method.code,
        customer: { name: tenant.name, email: tenant.email, phone: tenant.phone },
        description: `${bill.title} - ${bill.period} - kamar ${tenant.room_code || '-'}`,
        expires_at: expiresAt,
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(502, `Payment gateway menolak transaksi: ${text.slice(0, 200)}`);
    try {
      const data = JSON.parse(text);
      if (data.qr_string) {
        qrPayload = data.qr_string;
        qrImage = await QRCode.toDataURL(data.qr_string, { margin: 1, width: 320 });
      }
      if (data.va_number) va = data.va_number;
    } catch {
      /* respons non-JSON: pakai data lokal sebagai fallback */
    }
  }

  const info = db
    .prepare(
      `INSERT INTO payments
         (bill_id, tenant_id, reference, method, method_label, amount, fee, total,
          status, qr_payload, qr_image, va_number, instructions, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    )
    .run(
      bill.id, tenant.id, reference, method.code, method.label,
      bill.amount, fee, total,
      qrPayload, qrImage, va, instructionsFor(method, va), expiresAt
    );

  db.prepare("UPDATE bills SET status = 'menunggu_pembayaran' WHERE id = ? AND status <> 'lunas'").run(bill.id);

  return getPaymentById(info.lastInsertRowid);
}

export const getPaymentById = (id) =>
  db.prepare('SELECT * FROM payments WHERE id = ?').get(id);

export const getPaymentByRef = (reference) =>
  db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);

/** Tandai transaksi pending yang sudah melewati batas waktu. */
export function expireStalePayments() {
  const stale = db
    .prepare("SELECT id, bill_id FROM payments WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < datetime('now')").all();
  if (!stale.length) return 0;
  const run = db.transaction((rows) => {
    for (const row of rows) {
      db.prepare(
        `UPDATE payments SET status = 'kedaluwarsa', failure_reason = 'Batas waktu pembayaran terlampaui', settled_at = ?
          WHERE id = ?`
      ).run(nowSql(), row.id);
      db.prepare(
        `UPDATE bills SET status = CASE WHEN due_date < date('now') THEN 'terlambat' ELSE 'belum_bayar' END
          WHERE id = ? AND status = 'menunggu_pembayaran'`
      ).run(row.bill_id);
    }
  });
  run(stale);
  return stale.length;
}

/**
 * Finalisasi transaksi: 'berhasil' atau 'gagal'.
 * Dipakai oleh webhook gateway maupun tombol simulasi pada mode mock.
 */
export function settlePayment(reference, outcome, reason = null) {
  const payment = getPaymentByRef(reference);
  if (!payment) throw new HttpError(404, 'Transaksi tidak ditemukan.');
  if (payment.status !== 'pending') {
    throw new HttpError(409, `Transaksi ${reference} sudah berstatus "${payment.status}".`);
  }
  if (!['berhasil', 'gagal'].includes(outcome)) {
    throw new HttpError(400, 'Hasil transaksi harus "berhasil" atau "gagal".');
  }

  const settledAt = nowSql();
  const apply = db.transaction(() => {
    db.prepare('UPDATE payments SET status = ?, failure_reason = ?, settled_at = ? WHERE id = ?')
      .run(outcome, outcome === 'gagal' ? (reason || 'Pembayaran tidak berhasil diproses') : null, settledAt, payment.id);

    if (outcome === 'berhasil') {
      db.prepare("UPDATE bills SET status = 'lunas', paid_at = ? WHERE id = ?").run(settledAt, payment.bill_id);
    } else {
      db.prepare(
        `UPDATE bills SET status = CASE WHEN due_date < date('now') THEN 'terlambat' ELSE 'belum_bayar' END
          WHERE id = ? AND status <> 'lunas'`
      ).run(payment.bill_id);
    }
  });
  apply();

  return getPaymentById(payment.id);
}

/** Verifikasi signature webhook (HMAC-SHA256 dari raw body). */
export function verifyWebhookSignature(rawBody, signature) {
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', config.payment.webhookSecret)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).replace(/^sha256=/, ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const paymentStatusMeta = {
  pending: { label: 'Menunggu Pembayaran', tone: 'warn' },
  berhasil: { label: 'Berhasil', tone: 'ok' },
  gagal: { label: 'Gagal', tone: 'bad' },
  kedaluwarsa: { label: 'Kedaluwarsa', tone: 'muted' },
};

import { Router } from 'express';
import { config } from '../config.js';
import { asyncHandler, HttpError, str } from '../lib/helpers.js';
import { settlePayment, verifyWebhookSignature, getPaymentByRef } from '../services/payments.js';
import { handleSettlement } from './tenant.bills.routes.js';

const router = Router();

/**
 * POST /api/webhooks/payment
 *
 * Endpoint callback untuk payment gateway (QRIS / Virtual Account).
 * Body JSON:
 *   { "reference": "KMN-2026-ABCD1234", "status": "berhasil" | "gagal", "reason": "..." }
 *
 * Keamanan: header `x-komen-signature` berisi HMAC-SHA256 dari raw body
 * menggunakan PAYMENT_WEBHOOK_SECRET.
 *
 *   signature = HMAC_SHA256(rawBody, PAYMENT_WEBHOOK_SECRET)  // hex
 *
 * Pada mode PAYMENT_PROVIDER=mock signature bersifat opsional agar mudah diuji
 * dengan curl; di mode lain signature wajib valid.
 */
router.post(
  '/payment',
  asyncHandler(async (req, res) => {
    const signature = req.get('x-komen-signature');
    const raw = req.rawBody || JSON.stringify(req.body || {});

    const mustVerify = config.payment.provider !== 'mock';
    if (mustVerify || signature) {
      if (!verifyWebhookSignature(raw, signature)) {
        throw new HttpError(401, 'Signature webhook tidak valid.');
      }
    }

    const reference = str(req.body.reference, 60);
    const statusRaw = str(req.body.status, 20).toLowerCase();
    if (!reference) throw new HttpError(400, 'Field "reference" wajib diisi.');

    // Terima beberapa penamaan status yang umum dipakai gateway.
    const SUCCESS = ['berhasil', 'success', 'paid', 'settlement', 'capture', 'completed'];
    const FAILED = ['gagal', 'failed', 'deny', 'cancel', 'expire', 'expired'];
    const outcome = SUCCESS.includes(statusRaw) ? 'berhasil' : FAILED.includes(statusRaw) ? 'gagal' : null;
    if (!outcome) throw new HttpError(400, `Status "${statusRaw}" tidak dikenali.`);

    const existing = getPaymentByRef(reference);
    if (!existing) throw new HttpError(404, 'Transaksi tidak ditemukan.');
    // Idempoten: webhook yang terkirim dua kali tidak menimbulkan error.
    if (existing.status !== 'pending') {
      return res.json({ ok: true, idempotent: true, status: existing.status });
    }

    const payment = settlePayment(reference, outcome, str(req.body.reason, 200) || null);
    const result = await handleSettlement(payment);

    return res.json({
      ok: true,
      reference,
      status: payment.status,
      billId: payment.bill_id,
      ...result,
    });
  })
);

export default router;

import { db } from '../db.js';
import { config } from '../config.js';
import { normalizePhone, formatRupiah, formatTanggal, formatPeriode } from '../lib/helpers.js';

/**
 * Gateway WhatsApp dengan 3 mode (lihat .env.example):
 *  - mock   : tidak keluar ke internet, pesan dicatat di tabel wa_logs (default/demo)
 *  - fonnte : https://api.fonnte.com/send
 *  - meta   : WhatsApp Cloud API (graph.facebook.com)
 *
 * Semua pengiriman selalu dicatat ke wa_logs supaya owner punya bukti kirim.
 */

const logWa = ({ userId, phone, kind, message, provider, status, response }) => {
  const info = db
    .prepare(
      `INSERT INTO wa_logs (user_id, phone, kind, message, provider, status, response)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId || null,
      phone,
      kind,
      message,
      provider,
      status,
      response ? String(response).slice(0, 2000) : null
    );
  return info.lastInsertRowid;
};

async function sendViaFonnte(phone, message) {
  const res = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: {
      Authorization: config.wa.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target: phone, message, countryCode: '62' }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Fonnte HTTP ${res.status}: ${text}`);
  return text;
}

async function sendViaMeta(phone, message) {
  const url = `https://graph.facebook.com/v21.0/${config.wa.phoneId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.wa.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: { preview_url: false, body: message },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Meta HTTP ${res.status}: ${text}`);
  return text;
}

/**
 * Kirim pesan WhatsApp.
 * Selalu resolve (tidak pernah throw) supaya kegagalan gateway tidak
 * membatalkan aksi utama owner (mis. penerbitan tagihan).
 */
export async function sendWhatsApp({ userId = null, phone, message, kind = 'umum' }) {
  const target = normalizePhone(phone);
  const provider = config.wa.provider;

  if (!target) {
    return {
      ok: false,
      status: 'gagal',
      provider,
      reason: 'Nomor WhatsApp belum diisi',
      logId: logWa({ userId, phone: String(phone || '-'), kind, message, provider, status: 'gagal', response: 'Nomor kosong' }),
    };
  }

  // Mode demo: tidak memanggil API eksternal.
  if (provider === 'mock' || !config.wa.token) {
    const note = provider === 'mock'
      ? 'Mode simulasi (WA_PROVIDER=mock)'
      : 'Token WhatsApp belum dikonfigurasi, pesan hanya dicatat';
    return {
      ok: true,
      status: 'simulasi',
      provider,
      reason: note,
      logId: logWa({ userId, phone: target, kind, message, provider, status: 'simulasi', response: note }),
    };
  }

  try {
    const response = provider === 'meta'
      ? await sendViaMeta(target, message)
      : await sendViaFonnte(target, message);
    return {
      ok: true,
      status: 'terkirim',
      provider,
      logId: logWa({ userId, phone: target, kind, message, provider, status: 'terkirim', response }),
    };
  } catch (err) {
    return {
      ok: false,
      status: 'gagal',
      provider,
      reason: err.message,
      logId: logWa({ userId, phone: target, kind, message, provider, status: 'gagal', response: err.message }),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Template pesan                                                             */
/* -------------------------------------------------------------------------- */

export const templates = {
  tagihanBaru: ({ tenant, bill }) =>
    `*${config.kost.name}*\n\n` +
    `Halo ${tenant.name}, tagihan baru untuk kamar *${tenant.room_code || '-'}* sudah diterbitkan.\n\n` +
    `Tagihan : ${bill.title}\n` +
    `Periode : ${formatPeriode(bill.period)}\n` +
    `Nominal : *${formatRupiah(bill.amount)}*\n` +
    `Jatuh tempo : ${formatTanggal(bill.due_date)}\n\n` +
    `Pembayaran dapat dilakukan lewat QRIS atau Virtual Account di menu "Tagihan Saya" pada aplikasi Komen.\n` +
    `Terima kasih 🙏`,

  reminderTagihan: ({ tenant, bill, dueInDays }) => {
    const waktu =
      dueInDays === null ? ''
        : dueInDays < 0 ? `Tagihan ini sudah *terlambat ${Math.abs(dueInDays)} hari*.`
          : dueInDays === 0 ? 'Tagihan ini *jatuh tempo hari ini*.'
            : `Jatuh tempo dalam *${dueInDays} hari* lagi.`;
    return (
      `*${config.kost.name}* - Pengingat Pembayaran\n\n` +
      `Halo ${tenant.name} (kamar ${tenant.room_code || '-'}),\n` +
      `${bill.title} periode ${formatPeriode(bill.period)} sebesar *${formatRupiah(bill.amount)}* belum terbayar.\n` +
      `Jatuh tempo : ${formatTanggal(bill.due_date)}\n${waktu}\n\n` +
      `Silakan lakukan pembayaran melalui aplikasi Komen (QRIS / Virtual Account).\n` +
      `Abaikan pesan ini bila Anda sudah membayar. Terima kasih 🙏`
    );
  },

  pembayaranBerhasil: ({ tenant, bill, payment }) =>
    `*${config.kost.name}* - Pembayaran Diterima ✅\n\n` +
    `Terima kasih ${tenant.name}, pembayaran Anda sudah kami terima.\n\n` +
    `Tagihan : ${bill.title} (${formatPeriode(bill.period)})\n` +
    `Kamar   : ${tenant.room_code || '-'}\n` +
    `Nominal : *${formatRupiah(payment.total)}*\n` +
    `Metode  : ${payment.method_label}\n` +
    `Ref     : ${payment.reference}\n\n` +
    `Simpan pesan ini sebagai bukti pembayaran.`,

  pengumuman: ({ tenant, announcement }) =>
    `*${config.kost.name}* - Pengumuman 📢\n\n` +
    `*${announcement.title}*\n\n${announcement.body}\n\n` +
    `— Untuk: ${tenant.room_code ? `kamar ${tenant.room_code}` : 'penyewa'}`,

  komplainUpdate: ({ tenant, complaint, statusLabel, note }) =>
    `*${config.kost.name}* - Update Laporan 🔧\n\n` +
    `Halo ${tenant.name}, laporan "${complaint.title}" (#${complaint.id}) kini berstatus *${statusLabel}*.\n` +
    (note ? `\nCatatan pemilik: ${note}\n` : '') +
    `\nDetail lengkap bisa dilihat di menu "Lapor Kerusakan".`,
};

export const listWaLogs = ({ limit = 50 } = {}) =>
  db
    .prepare(
      `SELECT w.*, u.name AS user_name
         FROM wa_logs w
    LEFT JOIN users u ON u.id = w.user_id
        ORDER BY w.id DESC
        LIMIT ?`
    )
    .all(limit);

export const waStatus = () => ({
  provider: config.wa.provider,
  configured: config.wa.provider === 'mock' ? true : Boolean(config.wa.token),
  simulated: config.wa.provider === 'mock' || !config.wa.token,
});

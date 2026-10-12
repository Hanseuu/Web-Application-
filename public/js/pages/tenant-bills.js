/* Tagihan Saya — tagihan jatuh tempo & mendatang, bayar via QRIS / Virtual Account,
   lalu lihat hasil transaksi (berhasil / gagal). */

import {
  api, esc, rupiah, tanggal, tanggalJam, relatif, badge, emptyState, handleError,
  openModal, confirmDialog, busy, toastOk, dueText, copyText, countdown, $, $$, isLive,
} from '../core.js';

const state = { data: null, pollTimer: null, stopCountdown: null };

export async function render(view, ctx) {
  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Tagihan Saya</h1>
        <p>Tagihan yang sudah jatuh tempo maupun yang akan datang. Pembayaran dapat
           dilakukan langsung lewat QRIS atau Virtual Account bank.</p>
      </div>
    </div>
    <div id="billBody"></div>
  `;

  await load(ctx);
}

async function load(ctx) {
  const body = $('#billBody');
  if (!isLive(body)) return; // pengguna sudah berpindah halaman
  body.innerHTML = '<div class="empty"><span class="spinner spinner--dark"></span></div>';

  try {
    state.data = await api.get('/api/tenant/bills');
  } catch (err) {
    handleError(err);
    if (!isLive(body)) return;
    body.innerHTML = emptyState('⚠️', 'Gagal memuat tagihan');
    return;
  }

  if (!isLive(body)) return;
  const d = state.data;
  const s = d.summary;

  body.innerHTML = `
    <section class="grid grid--3 mb-2">
      <div class="stat">
        <div class="stat__icon ${s.jumlahTerlambat ? 'stat__icon--bad' : 'stat__icon--warn'}">💳</div>
        <div>
          <div class="stat__label">Total Harus Dibayar</div>
          <div class="stat__value stat__value--sm">${esc(s.totalTagihanLabel)}</div>
          <div class="stat__hint">${s.jumlahBelumBayar} tagihan belum dibayar</div>
        </div>
      </div>
      <div class="stat">
        <div class="stat__icon stat__icon--bad">⚠️</div>
        <div>
          <div class="stat__label">Jatuh Tempo / Terlambat</div>
          <div class="stat__value">${s.jumlahTerlambat}</div>
          <div class="stat__hint">${s.jumlahTerlambat ? 'Segera lakukan pembayaran' : 'Tidak ada keterlambatan 🎉'}</div>
        </div>
      </div>
      <div class="stat">
        <div class="stat__icon stat__icon--ok">✅</div>
        <div>
          <div class="stat__label">Total Sudah Dibayar</div>
          <div class="stat__value stat__value--sm">${esc(rupiah(s.totalDibayar))}</div>
          <div class="stat__hint">Riwayat lunas</div>
        </div>
      </div>
    </section>

    ${d.overdue.length
      ? `<div class="alert alert--error mb-2">
          <strong>⚠️ Anda memiliki ${d.overdue.length} tagihan yang sudah melewati jatuh tempo.</strong>
          Mohon segera melakukan pembayaran untuk menghindari denda keterlambatan.
         </div>`
      : ''}

    <!-- Jatuh tempo / terlambat -->
    ${section('Tagihan Jatuh Tempo', '⚠️', d.overdue, 'Tidak ada tagihan yang terlambat.')}

    <!-- Akan datang -->
    ${section('Tagihan Akan Datang', '📅', d.upcoming, 'Belum ada tagihan baru.')}

    <!-- Riwayat -->
    <div class="card mt-2">
      <div class="card__head">
        <div><h3>Riwayat Pembayaran</h3><p>Tagihan yang sudah lunas dan transaksi Anda</p></div>
      </div>
      <div class="card__body card__body--flush">
        ${d.paid.length
      ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Tagihan</th><th>Periode</th><th class="right">Nominal</th><th>Metode</th><th>Dibayar</th></tr></thead>
            <tbody>
              ${d.paid
        .map(
          (b) => `<tr>
                    <td><strong style="font-size:.88rem">${esc(b.title)}</strong></td>
                    <td><small>${esc(b.periodLabel)}</small></td>
                    <td class="right nowrap"><strong>${esc(b.amountLabel)}</strong></td>
                    <td><small>${esc(b.paidMethod || 'Manual')}</small></td>
                    <td class="nowrap"><small class="muted">${esc(tanggal(b.paidAt))}</small></td>
                  </tr>`
        )
        .join('')}
            </tbody></table></div>`
      : emptyState('📭', 'Belum ada pembayaran', 'Riwayat pembayaran Anda akan tampil di sini.')}
      </div>
    </div>

    ${d.payments.length
      ? `<div class="card mt-2">
          <div class="card__head"><div><h3>Transaksi Terakhir</h3>
            <p>Termasuk transaksi yang gagal atau kedaluwarsa</p></div></div>
          <div class="card__body card__body--flush">
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Referensi</th><th>Metode</th><th class="right">Total</th><th>Status</th><th>Waktu</th><th></th></tr></thead>
              <tbody>
                ${d.payments
        .slice(0, 10)
        .map(
          (p) => `<tr>
                      <td><small class="mono">${esc(p.reference)}</small></td>
                      <td><small>${esc(p.methodLabel)}</small></td>
                      <td class="right nowrap">${esc(p.totalLabel)}</td>
                      <td>${badge(p.statusLabel, p.statusTone)}
                        ${p.failureReason ? `<br /><small class="muted">${esc(p.failureReason)}</small>` : ''}</td>
                      <td class="nowrap"><small class="muted">${esc(relatif(p.settledAt || p.createdAt))}</small></td>
                      <td class="right">
                        ${p.status === 'pending'
            ? `<button class="btn btn--primary btn--sm" data-act="resume" data-ref="${esc(p.reference)}">Lanjutkan</button>`
            : ''}
                      </td>
                    </tr>`
        )
        .join('')}
              </tbody></table></div>
          </div>
        </div>`
      : ''}
  `;

  $$('[data-act=pay]', body).forEach((btn) =>
    btn.addEventListener('click', () => openMethodPicker(Number(btn.dataset.id), ctx))
  );
  $$('[data-act=resume]', body).forEach((btn) =>
    btn.addEventListener('click', () => resumePayment(btn.dataset.ref, ctx))
  );
  $$('[data-act=detail-bill]', body).forEach((btn) =>
    btn.addEventListener('click', () => openBillDetail(Number(btn.dataset.id)))
  );
}

function section(title, icon, bills, emptyText) {
  return `
    <div class="card mb-2">
      <div class="card__head">
        <div><h3>${icon} ${esc(title)}</h3><p>${bills.length} tagihan</p></div>
      </div>
      <div class="card__body">
        ${bills.length
      ? `<div class="col">${bills.map(billCard).join('')}</div>`
      : `<p class="muted center" style="margin:10px 0">${esc(emptyText)}</p>`}
      </div>
    </div>`;
}

function billCard(b) {
  const cls = b.isOverdue ? 'bill-card--overdue' : b.status === 'lunas' ? 'bill-card--paid' : 'bill-card--due';
  return `
    <div class="bill-card ${cls}">
      <div class="bill-card__main">
        <div class="bill-card__title">
          <strong>${esc(b.title)}</strong>
          ${badge(b.statusLabel, b.statusTone)}
          ${b.pendingReference ? badge('Transaksi menunggu', 'info') : ''}
        </div>
        <div class="bill-card__meta">
          <span>📅 Periode ${esc(b.periodLabel)}</span>
          <span>⏰ Jatuh tempo ${esc(b.dueDateLabel)}</span>
          <span class="${b.isOverdue ? 'badge badge--bad' : ''}">${esc(dueText(b.daysToDue))}</span>
        </div>
        ${b.note ? `<p class="muted mt-1" style="font-size:.83rem;margin-bottom:0">📝 ${esc(b.note)}</p>` : ''}
      </div>

      <div class="bill-card__amount">
        <div class="value">${esc(b.amountLabel)}</div>
        <div class="bill-card__actions mt-1">
          <button class="btn btn--light btn--sm" data-act="detail-bill" data-id="${b.id}">Detail</button>
          ${b.payable
      ? `<button class="btn btn--primary btn--sm" data-act="${b.pendingReference ? 'resume' : 'pay'}"
                  data-id="${b.id}" data-ref="${esc(b.pendingReference || '')}">
                 ${b.pendingReference ? 'Lanjutkan Pembayaran' : '💳 Bayar Sekarang'}
               </button>`
      : ''}
        </div>
      </div>
    </div>`;
}

function openBillDetail(id) {
  const b = state.data.bills.find((x) => x.id === id);
  if (!b) return;
  openModal({
    title: b.title,
    subtitle: `Periode ${b.periodLabel}`,
    body: `
      <div class="kv-grid">
        <div class="kv"><div class="kv__label">Nominal</div><div class="kv__value">${esc(b.amountLabel)}</div></div>
        <div class="kv"><div class="kv__label">Jatuh Tempo</div><div class="kv__value">${esc(b.dueDateLabel)}</div></div>
        <div class="kv"><div class="kv__label">Status</div><div class="kv__value">${esc(b.statusLabel)}</div></div>
        <div class="kv"><div class="kv__label">Diterbitkan</div><div class="kv__value">${esc(tanggal(b.createdAt))}</div></div>
        ${b.paidAt ? `<div class="kv"><div class="kv__label">Dibayar</div><div class="kv__value">${esc(tanggalJam(b.paidAt))}</div></div>` : ''}
        ${b.paidMethod ? `<div class="kv"><div class="kv__label">Metode</div><div class="kv__value">${esc(b.paidMethod)}</div></div>` : ''}
      </div>
      ${b.note ? `<p class="mt-2"><strong>Catatan:</strong> ${esc(b.note)}</p>` : ''}`,
    footer: '<button class="btn btn--light" data-close>Tutup</button>',
  });
}

/* ================================================= PILIH METODE BAYAR === */

function openMethodPicker(billId, ctx) {
  const bill = state.data.bills.find((b) => b.id === billId);
  if (!bill) return;

  const methods = state.data.methods;
  let selected = methods[0].code;

  const { root, close } = openModal({
    title: 'Pilih Metode Pembayaran',
    subtitle: `${bill.title} · ${bill.periodLabel} · ${bill.amountLabel}`,
    body: `
      <div class="method-list" id="methodList">
        ${methods
      .map(
        (m) => `
          <button type="button" class="method-option ${m.code === selected ? 'is-active' : ''}" data-code="${m.code}">
            <span class="method-option__icon">${m.type === 'qris' ? 'QR' : esc(m.issuer)}</span>
            <span class="method-option__text">
              <strong>${esc(m.label)}</strong>
              <small>${esc(m.issuer)} · Biaya layanan ${esc(m.feeLabel)}</small>
            </span>
            <span>${m.code === selected ? '●' : '○'}</span>
          </button>`
      )
      .join('')}
      </div>

      <div class="pay-summary" id="paySummary"></div>
      <p class="alert alert--error" id="payErr" hidden></p>`,
    footer: `
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="createPay">Lanjutkan Pembayaran</button>`,
  });

  const renderSummary = () => {
    const m = methods.find((x) => x.code === selected);
    root.querySelector('#paySummary').innerHTML = `
      <div class="pay-summary__row"><span>Tagihan</span><span>${esc(bill.amountLabel)}</span></div>
      <div class="pay-summary__row"><span>Biaya layanan</span><span>${esc(m.feeLabel)}</span></div>
      <div class="pay-summary__row pay-summary__row--total">
        <span>Total bayar</span><span>${esc(rupiah(bill.amount + m.fee))}</span>
      </div>`;
  };
  renderSummary();

  root.querySelector('#methodList').addEventListener('click', (e) => {
    const btn = e.target.closest('.method-option');
    if (!btn) return;
    selected = btn.dataset.code;
    root.querySelectorAll('.method-option').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.lastElementChild.textContent = active ? '●' : '○';
    });
    renderSummary();
  });

  root.querySelector('#createPay').addEventListener('click', async (e) => {
    const done = busy(e.currentTarget, 'Membuat transaksi…');
    try {
      const res = await api.post('/api/tenant/payments', { billId, method: selected });
      close();
      openPaymentFlow(res.payment, bill, ctx);
    } catch (err) {
      const box = root.querySelector('#payErr');
      box.textContent = err.message;
      box.hidden = false;
      done();
    }
  });
}

async function resumePayment(reference, ctx) {
  if (!reference) return;
  try {
    const { payment, bill } = await api.get(`/api/tenant/payments/${reference}`);
    if (payment.status !== 'pending') {
      showResult(payment, bill, ctx);
      return;
    }
    openPaymentFlow(payment, bill, ctx);
  } catch (err) { handleError(err); }
}

/* ================================================ QRIS / VA + STATUS ==== */

function openPaymentFlow(payment, bill, ctx) {
  stopWatchers();

  const isQris = Boolean(payment.qrImage);

  const { root, close } = openModal({
    title: isQris ? 'Bayar dengan QRIS' : payment.methodLabel,
    subtitle: `${bill.title} · ${bill.periodLabel}`,
    body: `
      <div class="pay-box">
        ${isQris
      ? `<div class="qr-frame"><img src="${esc(payment.qrImage)}" alt="Kode QRIS pembayaran" /></div>
             <p class="muted mt-1" style="font-size:.82rem">
               Scan dengan GoPay, OVO, DANA, ShopeePay, atau m-banking apa pun yang mendukung QRIS.
             </p>`
      : `<div class="va-box">
               <div class="va-box__label">Nomor Virtual Account ${esc(payment.methodLabel.replace('Virtual Account ', ''))}</div>
               <div class="va-box__number" id="vaNumber">${esc(payment.vaNumber)}</div>
               <button class="btn btn--light btn--sm" id="copyVa">📋 Salin Nomor</button>
             </div>`}

        <div class="pay-summary">
          <div class="pay-summary__row"><span>Tagihan</span><span>${esc(payment.amountLabel)}</span></div>
          <div class="pay-summary__row"><span>Biaya layanan</span><span>${esc(payment.feeLabel)}</span></div>
          <div class="pay-summary__row pay-summary__row--total">
            <span>Total bayar</span><span>${esc(payment.totalLabel)}</span>
          </div>
        </div>

        <div class="alert alert--warn" id="expiryBox">
          ⏳ Selesaikan pembayaran dalam <span class="countdown" id="countdown">--:--</span>
        </div>

        <div class="row" style="justify-content:center;gap:8px;margin:14px 0">
          <span class="spinner spinner--dark"></span>
          <small class="muted">Menunggu pembayaran… status diperbarui otomatis.</small>
        </div>

        <details style="text-align:left">
          <summary style="cursor:pointer;font-size:.88rem;font-weight:600;color:var(--c-primary)">
            Cara pembayaran
          </summary>
          <ol class="pay-steps mt-1">
            ${esc(payment.instructions || '')
      .split('\n')
      .filter(Boolean)
      .map((line) => `<li>${line}</li>`)
      .join('')}
          </ol>
        </details>

        <p class="muted mt-2" style="font-size:.78rem">
          Referensi transaksi: <span class="mono">${esc(payment.reference)}</span>
        </p>

        ${payment.canSimulate
      ? `<div class="card mt-2" style="box-shadow:none;background:var(--c-warn-soft);border-color:#fde68a">
               <div class="card__body" style="padding:13px">
                 <strong style="font-size:.85rem">🧪 Mode demo</strong>
                 <p class="muted" style="font-size:.8rem;margin:4px 0 9px">
                   Payment gateway berjalan dalam mode simulasi. Pilih hasil transaksi untuk
                   mencoba alur berhasil maupun gagal.
                 </p>
                 <div class="row" style="justify-content:center;gap:8px">
                   <button class="btn btn--ok btn--sm" data-sim="berhasil">Simulasikan Berhasil</button>
                   <button class="btn btn--danger btn--sm" data-sim="gagal">Simulasikan Gagal</button>
                 </div>
               </div>
             </div>`
      : ''}
      </div>`,
    footer: `
      <button class="btn btn--light" id="cancelPay">Batalkan Transaksi</button>
      <button class="btn btn--light" data-close>Tutup</button>
      <button class="btn btn--primary" id="checkStatus">🔄 Cek Status</button>`,
  });

  // Hitung mundur batas waktu.
  state.stopCountdown = countdown(
    payment.expiresAt,
    (text) => { const el = root.querySelector('#countdown'); if (el) el.textContent = text; },
    () => {
      const box = root.querySelector('#expiryBox');
      if (box) {
        box.className = 'alert alert--error';
        box.textContent = '⌛ Batas waktu pembayaran sudah terlampaui. Silakan buat transaksi baru.';
      }
    }
  );

  root.querySelector('#copyVa')?.addEventListener('click', () => copyText(payment.vaNumber));

  // Polling status transaksi (mensimulasikan notifikasi dari gateway).
  const check = async ({ silent = true } = {}) => {
    try {
      const res = await api.get(`/api/tenant/payments/${payment.reference}`);
      if (res.payment.status !== 'pending') {
        stopWatchers();
        close();
        showResult(res.payment, res.bill, ctx);
        return true;
      }
      if (!silent) toastOk('Transaksi masih menunggu pembayaran.', 'Status');
    } catch (err) {
      if (!silent) handleError(err);
    }
    return false;
  };

  state.pollTimer = setInterval(check, 5000);

  root.querySelector('#checkStatus').addEventListener('click', async (e) => {
    const done = busy(e.currentTarget, 'Memeriksa…');
    const settled = await check({ silent: false });
    if (!settled) done();
  });

  root.querySelectorAll('[data-sim]').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      const outcome = e.currentTarget.dataset.sim;
      const done = busy(e.currentTarget, 'Memproses…');
      try {
        const res = await api.post(`/api/tenant/payments/${payment.reference}/simulate`, {
          outcome,
          reason: outcome === 'gagal' ? 'Saldo tidak cukup (simulasi)' : null,
        });
        stopWatchers();
        close();
        showResult(res.payment, res.bill, ctx);
      } catch (err) { handleError(err); done(); }
    })
  );

  root.querySelector('#cancelPay').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Batalkan transaksi?',
      message: 'Transaksi ini akan dibatalkan dan Anda dapat memilih metode pembayaran lain.',
      confirmText: 'Ya, batalkan',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.post(`/api/tenant/payments/${payment.reference}/cancel`, {});
      stopWatchers();
      close();
      toastOk(res.message);
      await load(ctx);
    } catch (err) { handleError(err); }
  });

  // Hentikan polling saat modal ditutup lewat tombol/Escape.
  root.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => { stopWatchers(); load(ctx); })
  );
}

function stopWatchers() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  state.stopCountdown?.();
  state.stopCountdown = null;
}

/* ------------------------------------------------------- hasil transaksi */

function showResult(payment, bill, ctx) {
  const ok = payment.status === 'berhasil';

  const { root, close } = openModal({
    title: ok ? 'Pembayaran Berhasil' : 'Pembayaran Gagal',
    size: 'sm',
    body: `
      <div class="center">
        <div class="result-icon">${ok ? '✅' : '❌'}</div>
        <h3 style="margin-bottom:6px">${ok ? 'Pembayaran Diterima' : 'Transaksi Tidak Berhasil'}</h3>
        <p class="muted" style="font-size:.88rem">
          ${ok
      ? 'Terima kasih! Tagihan Anda sudah ditandai lunas dan struk dikirim ke WhatsApp.'
      : esc(payment.failureReason || 'Pembayaran tidak dapat diproses.')}
        </p>

        <div class="pay-summary" style="text-align:left">
          <div class="pay-summary__row"><span>Tagihan</span><span>${esc(bill.title)}</span></div>
          <div class="pay-summary__row"><span>Periode</span><span>${esc(bill.periodLabel)}</span></div>
          <div class="pay-summary__row"><span>Metode</span><span>${esc(payment.methodLabel)}</span></div>
          <div class="pay-summary__row"><span>Referensi</span><span class="mono">${esc(payment.reference)}</span></div>
          <div class="pay-summary__row"><span>Waktu</span><span>${esc(tanggalJam(payment.settledAt))}</span></div>
          <div class="pay-summary__row pay-summary__row--total">
            <span>Total</span><span>${esc(payment.totalLabel)}</span>
          </div>
        </div>

        ${ok ? '' : '<p class="muted" style="font-size:.82rem">Anda dapat mencoba lagi dengan metode pembayaran yang sama atau berbeda.</p>'}
      </div>`,
    footer: ok
      ? '<button class="btn btn--primary" data-close>Selesai</button>'
      : `<button class="btn btn--light" data-close>Tutup</button>
         <button class="btn btn--primary" id="retryPay">Coba Lagi</button>`,
  });

  root.querySelector('#retryPay')?.addEventListener('click', () => {
    close();
    openMethodPicker(bill.id, ctx);
  });

  root.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', async () => {
      await load(ctx);
      ctx.refreshBadges?.();
    })
  );
}

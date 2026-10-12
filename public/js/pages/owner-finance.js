/* Keuangan — terbitkan tagihan & kirim pengingat via notifikasi web + WhatsApp */

import {
  api, esc, rupiah, tanggal, tanggalJam, relatif, roomChip, avatar, badge, emptyState,
  handleError, openModal, confirmDialog, busy, toastOk, dueText, monthInput, $, $$, isLive,
} from '../core.js';

const state = {
  tab: 'tagihan',
  status: 'semua',
  floor: 0,
  period: '',
  data: null,
  tenants: [],
};

export async function render(view, ctx) {
  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Keuangan</h1>
        <p>Terbitkan tagihan, pantau pembayaran, dan kirim pengingat melalui
           notifikasi web maupun WhatsApp.</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--light" id="bulkRemind">🔔 Ingatkan Semua</button>
        <button class="btn btn--primary" id="newBill">＋ Terbitkan Tagihan</button>
      </div>
    </div>

    <section class="grid grid--4 mb-2" id="finStats"></section>

    <div class="tabs" id="finTabs">
      <button class="tab is-active" data-tab="tagihan">📄 Tagihan</button>
      <button class="tab" data-tab="transaksi">💳 Transaksi</button>
      <button class="tab" data-tab="whatsapp">📱 Log WhatsApp</button>
    </div>

    <div id="finBody"></div>
  `;

  $('#finTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    $$('#finTabs .tab').forEach((t) => t.classList.toggle('is-active', t === btn));
    renderBody(ctx);
  });

  $('#newBill').addEventListener('click', () => openBillForm(ctx));
  $('#bulkRemind').addEventListener('click', () => openBulkRemind(ctx));

  // Daftar penyewa untuk pilihan penerima tagihan.
  try {
    const { tenants } = await api.get('/api/owner/tenants?status=aktif');
    state.tenants = tenants;
  } catch (err) { handleError(err); }

  await load(ctx);
}

async function load(ctx) {
  const qs = new URLSearchParams();
  if (state.status !== 'semua') qs.set('status', state.status);
  if (state.floor) qs.set('floor', String(state.floor));
  if (state.period) qs.set('period', state.period);

  try {
    state.data = await api.get(`/api/owner/finance?${qs}`);
  } catch (err) {
    handleError(err);
    const box = $('#finBody');
    if (isLive(box)) box.innerHTML = emptyState('⚠️', 'Gagal memuat data keuangan');
    return;
  }

  // Halaman mungkin sudah ditinggalkan saat request selesai.
  if (!isLive($('#finBody'))) return;

  renderStats();
  renderBody(ctx);
}

function renderStats() {
  const host = $('#finStats');
  if (!isLive(host)) return;
  const s = state.data.summary;
  const wa = state.data.whatsapp;
  host.innerHTML = `
    <div class="stat">
      <div class="stat__icon stat__icon--ok">💰</div>
      <div>
        <div class="stat__label">Masuk ${esc(s.bulanIni.periodLabel)}</div>
        <div class="stat__value stat__value--sm">${esc(rupiah(s.bulanIni.masuk))}</div>
        <div class="stat__hint">${s.jumlahLunas} tagihan lunas</div>
      </div>
    </div>
    <div class="stat">
      <div class="stat__icon stat__icon--warn">⏳</div>
      <div>
        <div class="stat__label">Belum Dibayar</div>
        <div class="stat__value stat__value--sm">${esc(rupiah(s.totalBelum))}</div>
        <div class="stat__hint">${s.jumlahBelum} tagihan</div>
      </div>
    </div>
    <div class="stat">
      <div class="stat__icon stat__icon--bad">⚠️</div>
      <div>
        <div class="stat__label">Terlambat</div>
        <div class="stat__value stat__value--sm">${esc(rupiah(s.totalTerlambat))}</div>
        <div class="stat__hint">${s.jumlahTerlambat} tagihan lewat jatuh tempo</div>
      </div>
    </div>
    <div class="stat">
      <div class="stat__icon stat__icon--info">📱</div>
      <div>
        <div class="stat__label">Gateway WhatsApp</div>
        <div class="stat__value stat__value--sm">${esc(wa.provider)}</div>
        <div class="stat__hint">${wa.simulated ? 'Mode simulasi (dicatat saja)' : 'Terhubung & siap kirim'}</div>
      </div>
    </div>`;
}

function renderBody(ctx) {
  const body = $('#finBody');
  if (!isLive(body)) return; // pengguna sudah berpindah halaman
  if (state.tab === 'tagihan') renderBills(body, ctx);
  else if (state.tab === 'transaksi') renderPayments(body);
  else renderWaLogs(body);
}

/* ============================================================== TAGIHAN == */

function renderBills(body, ctx) {
  const bills = state.data.bills;

  body.innerHTML = `
    <div class="filters">
      <div class="field">
        <label for="bStatus">Status</label>
        <select id="bStatus">
          <option value="semua">Semua status</option>
          ${state.data.statuses
      .map((s) => `<option value="${s.code}" ${state.status === s.code ? 'selected' : ''}>${esc(s.label)}</option>`)
      .join('')}
        </select>
      </div>
      <div class="field">
        <label for="bPeriod">Periode</label>
        <select id="bPeriod">
          <option value="">Semua periode</option>
          ${state.data.periods
      .map((p) => `<option value="${p.period}" ${state.period === p.period ? 'selected' : ''}>${esc(p.label)}</option>`)
      .join('')}
        </select>
      </div>
      <div class="field">
        <label for="bFloor">Lantai</label>
        <select id="bFloor">
          <option value="0">Semua lantai</option>
          <option value="1" ${state.floor === 1 ? 'selected' : ''}>Lantai 1</option>
          <option value="2" ${state.floor === 2 ? 'selected' : ''}>Lantai 2</option>
          <option value="3" ${state.floor === 3 ? 'selected' : ''}>Lantai 3</option>
        </select>
      </div>
    </div>

    <div class="card">
      <div class="card__body card__body--flush">
        ${bills.length
      ? `<div class="table-wrap"><table class="table">
              <thead>
                <tr>
                  <th>Kamar</th><th>Penyewa</th><th>Tagihan</th>
                  <th>Jatuh Tempo</th><th class="right">Nominal</th>
                  <th>Status</th><th class="right">Aksi</th>
                </tr>
              </thead>
              <tbody>${bills.map(billRow).join('')}</tbody>
            </table></div>`
      : emptyState('📄', 'Belum ada tagihan', 'Klik "Terbitkan Tagihan" untuk membuat tagihan baru.')}
      </div>
    </div>`;

  $('#bStatus').addEventListener('change', (e) => { state.status = e.target.value; load(ctx); });
  $('#bPeriod').addEventListener('change', (e) => { state.period = e.target.value; load(ctx); });
  $('#bFloor').addEventListener('change', (e) => { state.floor = Number(e.target.value); load(ctx); });

  $$('[data-act=remind]', body).forEach((btn) =>
    btn.addEventListener('click', () => openRemind(bills.find((b) => b.id === Number(btn.dataset.id)), ctx))
  );
  $$('[data-act=paid]', body).forEach((btn) =>
    btn.addEventListener('click', async () => {
      const b = bills.find((x) => x.id === Number(btn.dataset.id));
      const ok = await confirmDialog({
        title: 'Tandai tagihan lunas?',
        message: `${b.title} (${b.periodLabel}) milik ${b.tenant.name} sebesar ${b.amountLabel} akan ditandai lunas sebagai pembayaran manual.`,
        confirmText: 'Ya, tandai lunas',
      });
      if (!ok) return;
      try {
        const res = await api.post(`/api/owner/bills/${b.id}/mark-paid`, {});
        toastOk(res.message);
        await load(ctx);
      } catch (err) { handleError(err); }
    })
  );
  $$('[data-act=edit-bill]', body).forEach((btn) =>
    btn.addEventListener('click', () => openEditBill(bills.find((b) => b.id === Number(btn.dataset.id)), ctx))
  );
}

function billRow(b) {
  return `
    <tr>
      <td>${roomChip(b.tenant.roomCode)}</td>
      <td>
        <div class="person">
          ${avatar(b.tenant.name, b.tenant.avatarColor, 'avatar--sm')}
          <div class="person__text">
            <strong>${esc(b.tenant.name)}</strong>
            <small>${esc(b.tenant.phone || 'tanpa WhatsApp')}</small>
          </div>
        </div>
      </td>
      <td>
        <strong style="font-size:.88rem">${esc(b.title)}</strong><br />
        <small class="muted">${esc(b.periodLabel)}</small>
      </td>
      <td class="nowrap">
        <small>${esc(b.dueDateLabel)}</small><br />
        <small class="${b.daysToDue < 0 && b.status !== 'lunas' ? 'badge badge--bad' : 'muted'}">
          ${esc(b.status === 'lunas' ? `Dibayar ${relatif(b.paidAt)}` : dueText(b.daysToDue))}
        </small>
      </td>
      <td class="right nowrap"><strong>${esc(b.amountLabel)}</strong></td>
      <td>
        ${badge(b.statusLabel, b.statusTone)}
        ${b.reminderCount ? `<br /><small class="muted">🔔 ${b.reminderCount}x diingatkan</small>` : ''}
      </td>
      <td class="actions">
        ${b.status !== 'lunas'
      ? `<button class="btn btn--light btn--sm" data-act="remind" data-id="${b.id}" title="Kirim pengingat">🔔</button>
           <button class="btn btn--light btn--sm" data-act="edit-bill" data-id="${b.id}" title="Edit tagihan">✏️</button>
           <button class="btn btn--ok btn--sm" data-act="paid" data-id="${b.id}" title="Tandai lunas">✓ Lunas</button>`
      : `<span class="badge badge--ok">${esc(b.paidMethod || 'Lunas')}</span>`}
      </td>
    </tr>`;
}

/* ------------------------------------------------------ terbitkan tagihan */

function openBillForm(ctx) {
  const nextMonth = new Date();
  nextMonth.setDate(5);

  const { root, close } = openModal({
    title: 'Terbitkan Tagihan',
    subtitle: 'Tagihan akan dikirim sebagai notifikasi web, dan opsional lewat WhatsApp.',
    size: 'lg',
    body: `
      <form id="billForm" class="form">
        <div class="form-grid">
          <div class="field span-2">
            <label for="bTitle">Nama tagihan *</label>
            <input type="text" id="bTitle" name="title" required value="Sewa Kamar"
                   placeholder="Sewa Kamar / Tambahan Listrik" />
          </div>
          <div class="field">
            <label for="bScope">Tagih untuk *</label>
            <select id="bScope" name="scope" required>
              <option value="semua">Semua penyewa aktif</option>
              <option value="lantai_1">Lantai 1 saja</option>
              <option value="lantai_2">Lantai 2 saja</option>
              <option value="lantai_3">Lantai 3 saja</option>
              <option value="pilih">Pilih penyewa tertentu…</option>
            </select>
          </div>
          <div class="field">
            <label for="bPer">Periode *</label>
            <input type="month" id="bPer" name="period" required value="${monthInput()}" />
          </div>
          <div class="field">
            <label for="bDue">Jatuh tempo *</label>
            <input type="date" id="bDue" name="dueDate" required value="${nextMonth.toISOString().slice(0, 10)}" />
          </div>
          <div class="field">
            <label for="bAmount">Nominal (Rp)</label>
            <input type="number" id="bAmount" name="amount" min="0" step="50000" value="" placeholder="1200000" />
          </div>
          <div class="field span-2" id="tenantPickWrap" hidden>
            <label>Pilih penyewa</label>
            <div class="card" style="box-shadow:none;max-height:210px;overflow-y:auto">
              <div class="card__body" style="padding:12px">
                ${state.tenants
      .map(
        (t) => `
                    <label class="check mb-1">
                      <input type="checkbox" class="tenantPick" value="${t.id}" />
                      <span class="check__text">
                        <strong>${esc(t.roomCode || '—')} · ${esc(t.name)}</strong>
                        <small>${esc(t.room ? rupiah(t.room.price) : 'harga kamar belum diisi')}</small>
                      </span>
                    </label>`
      )
      .join('')}
              </div>
            </div>
          </div>
          <div class="field span-2">
            <label class="check">
              <input type="checkbox" name="useRoomPrice" value="1" id="useRoomPrice" checked />
              <span class="check__text">
                <strong>Pakai harga kamar masing-masing</strong>
                <small>Nominal diambil dari harga kamar penyewa (Rp1.200.000–Rp1.500.000 sesuai lantai).</small>
              </span>
            </label>
          </div>
          <div class="field span-2">
            <label for="bNote">Catatan (opsional)</label>
            <input type="text" id="bNote" name="note" placeholder="Contoh: pemakaian AC di atas kuota" />
          </div>
          <div class="field span-2">
            <label class="check">
              <input type="checkbox" name="sendWhatsapp" value="1" checked />
              <span class="check__text">
                <strong>📱 Kirim juga lewat WhatsApp</strong>
                <small>${state.data.whatsapp.simulated
      ? 'Gateway dalam mode simulasi — pesan dicatat di tab Log WhatsApp.'
      : `Terhubung ke gateway "${esc(state.data.whatsapp.provider)}".`}</small>
              </span>
            </label>
          </div>
        </div>
        <p class="alert alert--error" id="billErr" hidden></p>
      </form>`,
    footer: `
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="saveBill">Terbitkan Tagihan</button>`,
  });

  const scope = root.querySelector('#bScope');
  const pickWrap = root.querySelector('#tenantPickWrap');
  const useRoomPrice = root.querySelector('#useRoomPrice');
  const amountInput = root.querySelector('#bAmount');

  scope.addEventListener('change', () => { pickWrap.hidden = scope.value !== 'pilih'; });
  const syncAmount = () => {
    amountInput.disabled = useRoomPrice.checked;
    amountInput.required = !useRoomPrice.checked;
  };
  useRoomPrice.addEventListener('change', syncAmount);
  syncAmount();

  root.querySelector('#saveBill').addEventListener('click', async (e) => {
    const form = root.querySelector('#billForm');
    const errBox = root.querySelector('#billErr');
    errBox.hidden = true;

    if (!form.reportValidity()) return;

    const payload = {
      title: form.querySelector('[name=title]').value,
      scope: scope.value,
      period: form.querySelector('[name=period]').value,
      dueDate: form.querySelector('[name=dueDate]').value,
      note: form.querySelector('[name=note]').value,
      useRoomPrice: useRoomPrice.checked,
      amount: Number(amountInput.value || 0),
      sendWhatsapp: form.querySelector('[name=sendWhatsapp]').checked,
    };

    if (scope.value === 'pilih') {
      payload.tenantIds = $$('.tenantPick', root).filter((c) => c.checked).map((c) => Number(c.value));
      if (!payload.tenantIds.length) {
        errBox.textContent = 'Pilih minimal satu penyewa.';
        errBox.hidden = false;
        return;
      }
    }

    const done = busy(e.currentTarget, 'Menerbitkan…');
    try {
      const res = await api.post('/api/owner/bills', payload);
      close();
      toastOk(res.message);
      if (res.skipped?.length) {
        setTimeout(
          () => openModal({
            title: 'Beberapa tagihan dilewati',
            size: 'sm',
            body: `<ul style="margin:0;padding-left:18px">${res.skipped
              .map((s) => `<li><strong>${esc(s.tenant)}</strong>: ${esc(s.reason)}</li>`)
              .join('')}</ul>`,
            footer: '<button class="btn btn--light" data-close>Tutup</button>',
          }),
          450
        );
      }
      await load(ctx);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      done();
    }
  });
}

/* ------------------------------------------------------------- edit bill */

function openEditBill(bill, ctx) {
  const { root, close } = openModal({
    title: `Edit Tagihan — ${bill.tenant.name}`,
    subtitle: `${bill.title} · ${bill.periodLabel}`,
    body: `
      <form id="editBillForm" class="form">
        <div class="form-grid">
          <div class="field span-2">
            <label for="eTitle">Nama tagihan</label>
            <input type="text" id="eTitle" name="title" value="${esc(bill.title)}" />
          </div>
          <div class="field">
            <label for="eAmount">Nominal (Rp)</label>
            <input type="number" id="eAmount" name="amount" min="1" step="10000" value="${bill.amount}" />
          </div>
          <div class="field">
            <label for="eDue">Jatuh tempo</label>
            <input type="date" id="eDue" name="dueDate" value="${esc(bill.dueDate)}" />
          </div>
          <div class="field span-2">
            <label for="eNote">Catatan</label>
            <input type="text" id="eNote" name="note" value="${esc(bill.note)}" />
          </div>
        </div>
        <p class="alert alert--error" id="editErr" hidden></p>
      </form>`,
    footer: `
      <button class="btn btn--danger" id="delBill">🗑 Hapus Tagihan</button>
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="saveEdit">Simpan</button>`,
  });

  root.querySelector('#saveEdit').addEventListener('click', async (e) => {
    const done = busy(e.currentTarget, 'Menyimpan…');
    try {
      const payload = Object.fromEntries(new FormData(root.querySelector('#editBillForm')).entries());
      const res = await api.put(`/api/owner/bills/${bill.id}`, payload);
      close();
      toastOk(res.message);
      await load(ctx);
    } catch (err) {
      const box = root.querySelector('#editErr');
      box.textContent = err.message;
      box.hidden = false;
      done();
    }
  });

  root.querySelector('#delBill').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Hapus tagihan?',
      message: `${bill.title} (${bill.periodLabel}) milik ${bill.tenant.name} akan dihapus.`,
      confirmText: 'Ya, hapus',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.del(`/api/owner/bills/${bill.id}`);
      close();
      toastOk(res.message);
      await load(ctx);
    } catch (err) { handleError(err); }
  });
}

/* ---------------------------------------------------------- pengingat 1x */

function openRemind(bill, ctx) {
  const { root, close } = openModal({
    title: 'Kirim Pengingat Pembayaran',
    subtitle: `${bill.tenant.name} · Kamar ${bill.tenant.roomCode || '-'}`,
    body: `
      <div class="kv-grid mb-2">
        <div class="kv"><div class="kv__label">Tagihan</div><div class="kv__value">${esc(bill.title)}</div></div>
        <div class="kv"><div class="kv__label">Periode</div><div class="kv__value">${esc(bill.periodLabel)}</div></div>
        <div class="kv"><div class="kv__label">Nominal</div><div class="kv__value">${esc(bill.amountLabel)}</div></div>
        <div class="kv"><div class="kv__label">Jatuh Tempo</div><div class="kv__value">${esc(bill.dueDateLabel)}</div></div>
      </div>

      <form id="remindForm" class="form">
        <div class="field">
          <label for="rMsg">Pesan khusus (opsional)</label>
          <textarea id="rMsg" name="message" rows="4"
                    placeholder="Biarkan kosong untuk memakai template otomatis berisi nominal dan jatuh tempo."></textarea>
        </div>
        <label class="check">
          <input type="checkbox" name="sendWhatsapp" value="1" ${bill.tenant.phone ? 'checked' : 'disabled'} />
          <span class="check__text">
            <strong>📱 Kirim via WhatsApp</strong>
            <small>${bill.tenant.phone ? esc(bill.tenant.phone) : 'Nomor WhatsApp penyewa belum diisi'}</small>
          </span>
        </label>
        <p class="field__hint">Notifikasi web selalu dikirim ke aplikasi penyewa.</p>
      </form>`,
    footer: `
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="sendRemind">🔔 Kirim Pengingat</button>`,
  });

  root.querySelector('#sendRemind').addEventListener('click', async (e) => {
    const form = root.querySelector('#remindForm');
    const done = busy(e.currentTarget, 'Mengirim…');
    try {
      const res = await api.post(`/api/owner/bills/${bill.id}/reminder`, {
        message: form.querySelector('[name=message]').value,
        sendWhatsapp: form.querySelector('[name=sendWhatsapp]').checked,
      });
      close();
      toastOk(res.message);
      await load(ctx);
    } catch (err) { handleError(err); done(); }
  });
}

/* ---------------------------------------------------------- pengingat massal */

function openBulkRemind(ctx) {
  const { root, close } = openModal({
    title: 'Kirim Pengingat ke Semua',
    subtitle: 'Pengingat dikirim untuk setiap tagihan yang belum lunas.',
    body: `
      <form id="bulkForm" class="form">
        <label class="check">
          <input type="checkbox" name="onlyOverdue" value="1" />
          <span class="check__text">
            <strong>Hanya yang sudah terlambat</strong>
            <small>Bila tidak dicentang, semua tagihan belum lunas akan diingatkan.</small>
          </span>
        </label>
        <label class="check">
          <input type="checkbox" name="sendWhatsapp" value="1" checked />
          <span class="check__text">
            <strong>📱 Sertakan WhatsApp</strong>
            <small>Penyewa tanpa nomor hanya menerima notifikasi web.</small>
          </span>
        </label>
      </form>`,
    footer: `
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="doBulk">Kirim Pengingat</button>`,
  });

  root.querySelector('#doBulk').addEventListener('click', async (e) => {
    const form = root.querySelector('#bulkForm');
    const done = busy(e.currentTarget, 'Mengirim…');
    try {
      const res = await api.post('/api/owner/bills/reminders', {
        onlyOverdue: form.querySelector('[name=onlyOverdue]').checked,
        sendWhatsapp: form.querySelector('[name=sendWhatsapp]').checked,
      });
      close();
      toastOk(res.message);
      await load(ctx);
    } catch (err) { handleError(err); done(); }
  });
}

/* ============================================================ TRANSAKSI = */

async function renderPayments(body) {
  body.innerHTML = `<div class="card"><div class="card__body"><div class="empty">
      <span class="spinner spinner--dark"></span></div></div></div>`;

  try {
    const { payments } = await api.get('/api/owner/payments?limit=100');
    body.innerHTML = `
      <div class="card">
        <div class="card__head">
          <div><h3>Riwayat Transaksi</h3><p>Pembayaran QRIS, Virtual Account, dan manual</p></div>
        </div>
        <div class="card__body card__body--flush">
          ${payments.length
      ? `<div class="table-wrap"><table class="table">
                <thead><tr>
                  <th>Referensi</th><th>Penyewa</th><th>Tagihan</th>
                  <th>Metode</th><th class="right">Total</th><th>Status</th><th>Waktu</th>
                </tr></thead>
                <tbody>
                  ${payments
        .map(
          (p) => `
                      <tr>
                        <td><small class="mono">${esc(p.reference)}</small></td>
                        <td>
                          <div class="row" style="gap:7px">${roomChip(p.roomCode)}
                            <small>${esc(p.tenantName)}</small></div>
                        </td>
                        <td><small>${esc(p.billTitle)}<br /><span class="muted">${esc(p.periodLabel)}</span></small></td>
                        <td><small>${esc(p.methodLabel)}</small></td>
                        <td class="right nowrap"><strong>${esc(p.totalLabel)}</strong></td>
                        <td>${paymentBadge(p)}</td>
                        <td class="nowrap"><small class="muted">${esc(relatif(p.settledAt || p.createdAt))}</small></td>
                      </tr>`
        )
        .join('')}
                </tbody></table></div>`
      : emptyState('💳', 'Belum ada transaksi', 'Transaksi muncul saat penyewa membayar lewat aplikasi.')}
        </div>
      </div>`;
  } catch (err) {
    handleError(err);
    if (!isLive(body)) return;
    body.innerHTML = emptyState('⚠️', 'Gagal memuat transaksi');
  }
}

const paymentBadge = (p) => {
  const map = {
    berhasil: ['Berhasil', 'ok'],
    pending: ['Menunggu', 'warn'],
    gagal: ['Gagal', 'bad'],
    kedaluwarsa: ['Kedaluwarsa', 'muted'],
  };
  const [label, tone] = map[p.status] || [p.status, 'muted'];
  return badge(label, tone) + (p.failureReason ? `<br /><small class="muted">${esc(p.failureReason)}</small>` : '');
};

/* ========================================================= LOG WHATSAPP = */

async function renderWaLogs(body) {
  body.innerHTML = `<div class="card"><div class="card__body"><div class="empty">
      <span class="spinner spinner--dark"></span></div></div></div>`;

  try {
    const { logs, status } = await api.get('/api/owner/wa-logs?limit=50');
    body.innerHTML = `
      <div class="alert ${status.simulated ? 'alert--warn' : 'alert--ok'} mb-2">
        <strong>Gateway: ${esc(status.provider)}</strong> —
        ${status.simulated
      ? 'mode simulasi. Pesan tidak dikirim keluar, tetapi dicatat lengkap di bawah. Atur WA_PROVIDER dan WA_TOKEN pada file .env untuk mengirim sungguhan.'
      : 'terhubung dan siap mengirim pesan WhatsApp.'}
      </div>

      <div class="card">
        <div class="card__head">
          <div><h3>Log Pengiriman WhatsApp</h3><p>Bukti kirim tagihan, pengingat, struk &amp; pengumuman</p></div>
        </div>
        <div class="card__body">
          ${logs.length
      ? logs
        .map(
          (l) => `
              <div class="wa-log-item">
                <div class="wa-log-item__head">
                  <div class="row" style="gap:8px">
                    ${badge(l.kind, 'muted')}
                    <strong style="font-size:.88rem">${esc(l.userName || l.phone)}</strong>
                    <small class="muted mono">${esc(l.phone)}</small>
                  </div>
                  <div class="row" style="gap:8px">
                    ${badge(
            l.status,
            l.status === 'terkirim' ? 'ok' : l.status === 'simulasi' ? 'info' : 'bad'
          )}
                    <small class="muted">${esc(relatif(l.createdAt))}</small>
                  </div>
                </div>
                <div class="wa-log-item__msg">${esc(l.message)}</div>
              </div>`
        )
        .join('')
      : emptyState('📱', 'Belum ada pesan terkirim', 'Log muncul setelah Anda mengirim tagihan atau pengingat.')}
        </div>
      </div>`;
  } catch (err) {
    handleError(err);
    body.innerHTML = emptyState('⚠️', 'Gagal memuat log WhatsApp');
  }
}

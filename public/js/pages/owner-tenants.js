/* Daftar Penyewa — lihat penghuni + nomor kamar (XYY), edit/rename, chat */

import {
  api, esc, rupiah, tanggal, roomChip, avatar, badge, emptyState, handleError,
  openModal, confirmDialog, busy, toastOk, debounce, dueText, $, $$, showLoading, todayInput, isLive,
} from '../core.js';

const state = {
  status: 'aktif',
  floor: 0,
  search: '',
  rooms: [],
};

export async function render(view, ctx) {
  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Daftar Penyewa</h1>
        <p>Siapa yang sedang menghuni kos beserta nomor kamarnya. Nomor kamar memakai format
           <strong>XYY</strong> — X nomor lantai, YY nomor kamar (01–30).</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--primary" id="addTenant">＋ Tambah Penyewa</button>
      </div>
    </div>

    <section class="grid grid--4 mb-2" id="tenantStats"></section>

    <div class="filters">
      <div class="field field--grow">
        <label for="fSearch">Cari penyewa</label>
        <input type="search" id="fSearch" placeholder="Nama, email, telepon, atau nomor kamar…" />
      </div>
      <div class="field">
        <label for="fFloor">Lantai</label>
        <select id="fFloor">
          <option value="0">Semua lantai</option>
          <option value="1">Lantai 1</option>
          <option value="2">Lantai 2</option>
          <option value="3">Lantai 3</option>
        </select>
      </div>
      <div class="field">
        <label for="fStatus">Status</label>
        <select id="fStatus">
          <option value="aktif">Sedang menghuni</option>
          <option value="nonaktif">Sudah keluar</option>
          <option value="semua">Semua</option>
        </select>
      </div>
    </div>

    <div class="card">
      <div class="card__body card__body--flush" id="tenantTable"></div>
    </div>
  `;

  // Daftar kamar dipakai untuk dropdown penempatan kamar.
  try {
    const { rooms } = await api.get('/api/owner/rooms');
    state.rooms = rooms;
  } catch (err) { handleError(err); }

  $('#fSearch').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim();
    load(ctx);
  }));
  $('#fFloor').addEventListener('change', (e) => { state.floor = Number(e.target.value); load(ctx); });
  $('#fStatus').addEventListener('change', (e) => { state.status = e.target.value; load(ctx); });
  $('#addTenant').addEventListener('click', () => openTenantForm(null, ctx));

  await load(ctx);
}

/* -------------------------------------------------------------------- data */

async function load(ctx) {
  const target = $('#tenantTable');
  if (!isLive(target)) return; // pengguna sudah berpindah halaman
  showLoading(target, 'Memuat daftar penyewa…');

  const qs = new URLSearchParams({ status: state.status });
  if (state.floor) qs.set('floor', String(state.floor));
  if (state.search) qs.set('search', state.search);

  let data;
  try {
    data = await api.get(`/api/owner/tenants?${qs}`);
  } catch (err) {
    handleError(err);
    if (!isLive(target)) return;
    target.innerHTML = emptyState('⚠️', 'Gagal memuat data penyewa');
    return;
  }

  if (!isLive(target)) return;
  renderStats(data.summary);
  renderTable(target, data.tenants, ctx);
}

function renderStats(sum) {
  const perFloorText = sum.perFloor.map((f) => `L${f.floor}: ${f.total}`).join(' · ');
  $('#tenantStats').innerHTML = `
    <div class="stat">
      <div class="stat__icon">👥</div>
      <div>
        <div class="stat__label">Sedang Menghuni</div>
        <div class="stat__value">${sum.aktif}</div>
        <div class="stat__hint">${esc(perFloorText || '-')}</div>
      </div>
    </div>
    <div class="stat">
      <div class="stat__icon stat__icon--info">🚪</div>
      <div>
        <div class="stat__label">Kamar Tersedia</div>
        <div class="stat__value">${Math.max(0, sum.totalRooms - sum.aktif)}</div>
        <div class="stat__hint">dari ${sum.totalRooms} kamar</div>
      </div>
    </div>
    <div class="stat">
      <div class="stat__icon stat__icon--warn">📦</div>
      <div>
        <div class="stat__label">Sudah Keluar</div>
        <div class="stat__value">${sum.nonaktif}</div>
        <div class="stat__hint">Riwayat penyewa</div>
      </div>
    </div>
    <div class="stat">
      <div class="stat__icon stat__icon--ok">📊</div>
      <div>
        <div class="stat__label">Tingkat Hunian</div>
        <div class="stat__value">${sum.totalRooms ? Math.round((sum.aktif / sum.totalRooms) * 100) : 0}%</div>
        <div class="stat__hint">Kamar terisi</div>
      </div>
    </div>`;
}

function renderTable(target, tenants, ctx) {
  if (!tenants.length) {
    target.innerHTML = emptyState(
      '🔍',
      'Tidak ada penyewa yang cocok',
      'Coba ubah kata kunci atau filter lantai/status.'
    );
    return;
  }

  target.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Kamar</th>
            <th>Penyewa</th>
            <th>Kontak</th>
            <th>Mulai Sewa</th>
            <th>Tagihan</th>
            <th>Status</th>
            <th class="right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${tenants.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>`;

  // Aksi per baris
  $$('[data-act=edit]', target).forEach((btn) =>
    btn.addEventListener('click', () => {
      const t = tenants.find((x) => x.id === Number(btn.dataset.id));
      openTenantForm(t, ctx);
    })
  );
  $$('[data-act=chat]', target).forEach((btn) =>
    btn.addEventListener('click', () => ctx.navigate(`/chat?partner=${btn.dataset.id}`))
  );
  $$('[data-act=detail]', target).forEach((btn) =>
    btn.addEventListener('click', () => openDetail(Number(btn.dataset.id), ctx))
  );
}

function rowHtml(t) {
  const fin = t.finance;
  const tagihan = fin.unpaidBills
    ? `<strong>${esc(rupiah(fin.unpaidTotal))}</strong><br />
       <small class="${fin.daysToDue !== null && fin.daysToDue < 0 ? 'badge badge--bad' : 'muted'}">
         ${esc(fin.unpaidBills)} tagihan · ${esc(dueText(fin.daysToDue))}
       </small>`
    : '<span class="badge badge--ok">Lunas</span>';

  return `
    <tr>
      <td>${roomChip(t.roomCode)}</td>
      <td>
        <div class="person">
          ${avatar(t.name, t.avatarColor, 'avatar--sm')}
          <div class="person__text">
            <strong>${esc(t.name)}</strong>
            <small>${esc(t.occupation || '—')}</small>
          </div>
        </div>
      </td>
      <td>
        <small class="soft">${esc(t.email)}</small><br />
        <small class="muted">${esc(t.phone || 'Nomor belum diisi')}</small>
      </td>
      <td class="nowrap"><small>${esc(tanggal(t.checkInDate))}</small></td>
      <td class="nowrap">${tagihan}</td>
      <td>
        ${t.status === 'aktif' ? badge('Menghuni', 'ok') : badge('Keluar', 'muted')}
        ${t.openComplaints ? `<br /><small class="badge badge--warn mt-1">${t.openComplaints} komplain</small>` : ''}
      </td>
      <td class="actions">
        <button class="btn btn--light btn--sm" data-act="detail" data-id="${t.id}" title="Lihat detail">Detail</button>
        <button class="btn btn--light btn--sm" data-act="edit" data-id="${t.id}" title="Edit / ubah nama">✏️ Edit</button>
        <button class="btn btn--primary btn--sm" data-act="chat" data-id="${t.id}" title="Chat penyewa">
          💬${t.unreadMessages ? ` <span class="pill-count">${t.unreadMessages}</span>` : ''}
        </button>
      </td>
    </tr>`;
}

/* ------------------------------------------------------- form tambah/edit */

function roomOptions(selectedId, currentTenantId) {
  const occupiedBy = new Map();
  state.rooms.forEach((r) => {
    if (r.tenant && r.tenant.id !== currentTenantId) occupiedBy.set(r.id, r.tenant.name);
  });

  const byFloor = [1, 2, 3].map((floor) => {
    const opts = state.rooms
      .filter((r) => r.floor === floor)
      .map((r) => {
        const taken = occupiedBy.get(r.id);
        return `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''} ${taken ? 'disabled' : ''}>
                  ${esc(r.code)} — ${esc(rupiah(r.price))}${taken ? ` (dihuni ${esc(taken)})` : ''}
                </option>`;
      })
      .join('');
    return opts ? `<optgroup label="Lantai ${floor}">${opts}</optgroup>` : '';
  }).join('');

  return `<option value="">— Belum menempati kamar —</option>${byFloor}`;
}

function openTenantForm(tenant, ctx) {
  const isEdit = Boolean(tenant);

  const { root, close } = openModal({
    title: isEdit ? `Edit Penyewa — ${tenant.name}` : 'Tambah Penyewa Baru',
    subtitle: isEdit
      ? 'Ubah nama, kontak, atau pindahkan ke kamar lain.'
      : 'Buat akun penyewa baru dan tempatkan pada kamar yang kosong.',
    size: 'lg',
    body: `
      <form id="tenantForm" class="form">
        <div class="form-grid">
          <div class="field span-2">
            <label for="tName">Nama lengkap *</label>
            <input type="text" id="tName" name="name" required value="${esc(tenant?.name || '')}" />
          </div>
          <div class="field">
            <label for="tEmail">Email * <span class="field__hint">(untuk login)</span></label>
            <input type="email" id="tEmail" name="email" required value="${esc(tenant?.email || '')}" />
          </div>
          <div class="field">
            <label for="tPhone">Nomor WhatsApp</label>
            <input type="tel" id="tPhone" name="phone" placeholder="08123456789" value="${esc(tenant?.phone || '')}" />
            <span class="field__hint">Dipakai untuk kirim tagihan &amp; pengingat.</span>
          </div>
          <div class="field">
            <label for="tRoom">Kamar</label>
            <select id="tRoom" name="roomId">${roomOptions(tenant?.room?.id || null, tenant?.id)}</select>
            <span class="field__hint">Kamar yang sudah dihuni tidak dapat dipilih.</span>
          </div>
          <div class="field">
            <label for="tJob">Pekerjaan / aktivitas</label>
            <input type="text" id="tJob" name="occupation" value="${esc(tenant?.occupation || '')}" />
          </div>
          <div class="field">
            <label for="tEmergency">Kontak darurat</label>
            <input type="tel" id="tEmergency" name="emergencyContact" value="${esc(tenant?.emergencyContact || '')}" />
          </div>
          <div class="field">
            <label for="tCheckin">Tanggal mulai sewa</label>
            <input type="date" id="tCheckin" name="checkInDate" value="${esc(tenant?.checkInDate || todayInput())}" />
          </div>
          ${isEdit
      ? `<div class="field">
                 <label for="tStatus">Status penghunian</label>
                 <select id="tStatus" name="status">
                   <option value="aktif" ${tenant.status === 'aktif' ? 'selected' : ''}>Sedang menghuni</option>
                   <option value="nonaktif" ${tenant.status === 'nonaktif' ? 'selected' : ''}>Sudah keluar</option>
                 </select>
               </div>`
      : `<div class="field">
                 <label for="tPassword">Password awal *</label>
                 <input type="text" id="tPassword" name="password" required minlength="6" value="penyewa123" />
                 <span class="field__hint">Minimal 6 karakter. Beri tahu penyewa untuk menggantinya.</span>
               </div>`}
        </div>
        <p class="alert alert--error" id="formError" hidden></p>
      </form>`,
    footer: `
      ${isEdit ? '<button class="btn btn--light" id="resetPass">🔑 Reset Password</button>' : ''}
      ${isEdit ? '<button class="btn btn--danger" id="checkout">Tandai Keluar</button>' : ''}
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="saveTenant">${isEdit ? 'Simpan Perubahan' : 'Tambah Penyewa'}</button>`,
  });

  const errBox = root.querySelector('#formError');
  const showErr = (m) => { errBox.textContent = m; errBox.hidden = false; };

  root.querySelector('#saveTenant').addEventListener('click', async (e) => {
    errBox.hidden = true;
    const form = root.querySelector('#tenantForm');
    if (!form.reportValidity()) return;

    const payload = Object.fromEntries(new FormData(form).entries());
    payload.roomId = payload.roomId === '' ? null : Number(payload.roomId);

    const done = busy(e.currentTarget, 'Menyimpan…');
    try {
      const res = isEdit
        ? await api.put(`/api/owner/tenants/${tenant.id}`, payload)
        : await api.post('/api/owner/tenants', payload);
      close();
      toastOk(res.message);
      const { rooms } = await api.get('/api/owner/rooms');
      state.rooms = rooms;
      await load(ctx);
    } catch (err) {
      showErr(err.message);
      done();
    }
  });

  root.querySelector('#resetPass')?.addEventListener('click', async () => {
    const { root: r2, close: c2 } = openModal({
      title: 'Reset Password Penyewa',
      size: 'sm',
      body: `
        <p class="soft">Password baru untuk <strong>${esc(tenant.name)}</strong>. Semua sesi login
           penyewa akan dikeluarkan.</p>
        <div class="field">
          <label for="newPass">Password baru</label>
          <input type="text" id="newPass" value="penyewa123" minlength="6" />
        </div>`,
      footer: `
        <button class="btn btn--light" data-close>Batal</button>
        <button class="btn btn--primary" id="doReset">Reset Password</button>`,
    });
    r2.querySelector('#doReset').addEventListener('click', async (ev) => {
      const done = busy(ev.currentTarget, 'Memproses…');
      try {
        const res = await api.put(`/api/owner/tenants/${tenant.id}/password`, {
          newPassword: r2.querySelector('#newPass').value,
        });
        c2();
        toastOk(res.message);
      } catch (err) { handleError(err); done(); }
    });
  });

  root.querySelector('#checkout')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Tandai penyewa keluar?',
      message: `${tenant.name} akan ditandai sudah tidak menghuni dan kamar ${tenant.roomCode || '-'} menjadi kosong. Riwayat tagihan & laporan tetap tersimpan.`,
      confirmText: 'Ya, tandai keluar',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.del(`/api/owner/tenants/${tenant.id}`);
      close();
      toastOk(res.message);
      const { rooms } = await api.get('/api/owner/rooms');
      state.rooms = rooms;
      await load(ctx);
    } catch (err) { handleError(err); }
  });
}

/* ----------------------------------------------------------------- detail */

async function openDetail(id, ctx) {
  const { root, close } = openModal({
    title: 'Detail Penyewa',
    size: 'lg',
    body: '<div class="empty"><span class="spinner spinner--dark"></span></div>',
  });

  try {
    const { tenant, bills, complaints } = await api.get(`/api/owner/tenants/${id}`);
    root.querySelector('.modal__head h3').textContent = tenant.name;

    root.querySelector('.modal__body').innerHTML = `
      <div class="row row--wrap mb-2" style="gap:14px">
        ${avatar(tenant.name, tenant.avatarColor, 'avatar--lg')}
        <div class="grow">
          <h3 style="margin:0">${esc(tenant.name)}</h3>
          <p class="muted" style="margin:2px 0 0">${esc(tenant.occupation || '—')}</p>
          <div class="row row--wrap mt-1" style="gap:7px">
            ${roomChip(tenant.roomCode)}
            ${tenant.status === 'aktif' ? badge('Menghuni', 'ok') : badge('Sudah keluar', 'muted')}
          </div>
        </div>
      </div>

      <div class="kv-grid mb-2">
        <div class="kv"><div class="kv__label">Email</div><div class="kv__value">${esc(tenant.email)}</div></div>
        <div class="kv"><div class="kv__label">WhatsApp</div><div class="kv__value">${esc(tenant.phone || '—')}</div></div>
        <div class="kv"><div class="kv__label">Kontak Darurat</div><div class="kv__value">${esc(tenant.emergencyContact || '—')}</div></div>
        <div class="kv"><div class="kv__label">Mulai Sewa</div><div class="kv__value">${esc(tanggal(tenant.checkInDate))}</div></div>
        <div class="kv"><div class="kv__label">Harga Kamar</div><div class="kv__value">${esc(tenant.room ? rupiah(tenant.room.price) : '—')}</div></div>
        <div class="kv"><div class="kv__label">Tunggakan</div><div class="kv__value">${esc(rupiah(tenant.finance.unpaidTotal))}</div></div>
      </div>

      <h4>Riwayat Tagihan</h4>
      ${bills.length
      ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Tagihan</th><th>Periode</th><th>Jatuh Tempo</th><th class="right">Nominal</th><th>Status</th></tr></thead>
            <tbody>${bills
        .map(
          (b) => `<tr>
                  <td>${esc(b.title)}</td>
                  <td class="nowrap"><small>${esc(b.period)}</small></td>
                  <td class="nowrap"><small>${esc(tanggal(b.due_date))}</small></td>
                  <td class="right nowrap">${esc(rupiah(b.amount))}</td>
                  <td>${b.status === 'lunas' ? badge('Lunas', 'ok')
            : b.status === 'terlambat' ? badge('Terlambat', 'bad') : badge('Belum bayar', 'warn')}</td>
                </tr>`
        )
        .join('')}</tbody></table></div>`
      : '<p class="muted">Belum ada tagihan.</p>'}

      <h4 class="mt-3">Laporan Kerusakan</h4>
      ${complaints.length
      ? `<div class="col">${complaints
        .map(
          (c) => `<div class="row row--between" style="padding:8px 0;border-bottom:1px solid var(--c-border)">
                  <div class="grow"><strong style="font-size:.9rem">${esc(c.title)}</strong><br />
                    <small class="muted">${esc(tanggal(c.created_at))}</small></div>
                  ${badge(
            c.status === 'baru' ? 'Baru' : c.status === 'diproses' ? 'Diproses' : 'Selesai',
            c.status === 'baru' ? 'bad' : c.status === 'diproses' ? 'warn' : 'ok'
          )}
                </div>`
        )
        .join('')}</div>`
      : '<p class="muted">Belum ada laporan.</p>'}
    `;

    const foot = document.createElement('div');
    foot.className = 'modal__foot';
    foot.innerHTML = `
      <button class="btn btn--light" data-close>Tutup</button>
      <button class="btn btn--primary" id="detailChat">💬 Chat ${esc(tenant.name.split(' ')[0])}</button>`;
    root.appendChild(foot);
    foot.querySelector('[data-close]').addEventListener('click', close);
    foot.querySelector('#detailChat').addEventListener('click', () => {
      close();
      ctx.navigate(`/chat?partner=${tenant.id}`);
    });
  } catch (err) {
    handleError(err);
    close();
  }
}

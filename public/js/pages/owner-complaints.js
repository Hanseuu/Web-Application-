/* Pusat Komplain — papan Baru / Sedang Diproses / Selesai + foto bukti dari penyewa */

import {
  api, esc, tanggalJam, relatif, roomChip, avatar, badge, emptyState, handleError,
  openModal, busy, toastOk, bindZoom, debounce, isLive, $, $$,
} from '../core.js';

const state = {
  floor: 0,
  search: '',
  data: null,
};

const TONE = { baru: 'bad', diproses: 'warn', selesai: 'ok' };
const PRIORITY = {
  tinggi: { label: 'Prioritas tinggi', tone: 'bad' },
  sedang: { label: 'Prioritas sedang', tone: 'warn' },
  rendah: { label: 'Prioritas rendah', tone: 'muted' },
};

export async function render(view, ctx) {
  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Pusat Komplain</h1>
        <p>Laporan kerusakan dari penyewa, dikelompokkan berdasarkan status penanganan.</p>
      </div>
    </div>

    <section class="grid grid--4 mb-2" id="cStats"></section>

    <div class="filters">
      <div class="field field--grow">
        <label for="cSearch">Cari laporan</label>
        <input type="search" id="cSearch" placeholder="Judul, keterangan, nama penyewa, atau nomor kamar…" />
      </div>
      <div class="field">
        <label for="cFloor">Lantai</label>
        <select id="cFloor">
          <option value="0">Semua lantai</option>
          <option value="1">Lantai 1</option>
          <option value="2">Lantai 2</option>
          <option value="3">Lantai 3</option>
        </select>
      </div>
    </div>

    <div id="cBoard"></div>
  `;

  $('#cSearch').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim();
    load(ctx);
  }));
  $('#cFloor').addEventListener('change', (e) => {
    state.floor = Number(e.target.value);
    load(ctx);
  });

  await load(ctx);

  // Buka detail langsung bila datang dari notifikasi (#/owner/komplain?id=12)
  const id = ctx.params.get('id');
  if (id) openDetail(Number(id), ctx);
}

async function load(ctx) {
  const board = $('#cBoard');
  // Halaman sudah ditinggalkan (mis. aksi dari modal lalu pindah menu).
  if (!isLive(board)) return;

  board.innerHTML = `<div class="card"><div class="card__body"><div class="empty">
      <span class="spinner spinner--dark"></span></div></div></div>`;

  const qs = new URLSearchParams();
  if (state.floor) qs.set('floor', String(state.floor));
  if (state.search) qs.set('search', state.search);

  try {
    state.data = await api.get(`/api/owner/complaints?${qs}`);
  } catch (err) {
    handleError(err);
    if (isLive(board)) board.innerHTML = emptyState('⚠️', 'Gagal memuat laporan');
    return;
  }

  if (!isLive(board)) return;

  const s = state.data.summary;
  $('#cStats').innerHTML = `
    <div class="stat">
      <div class="stat__icon stat__icon--bad">🆕</div>
      <div><div class="stat__label">Baru</div><div class="stat__value">${s.baru}</div>
        <div class="stat__hint">Perlu ditinjau</div></div>
    </div>
    <div class="stat">
      <div class="stat__icon stat__icon--warn">🔧</div>
      <div><div class="stat__label">Sedang Diproses</div><div class="stat__value">${s.diproses}</div>
        <div class="stat__hint">Dalam penanganan</div></div>
    </div>
    <div class="stat">
      <div class="stat__icon stat__icon--ok">✅</div>
      <div><div class="stat__label">Selesai</div><div class="stat__value">${s.selesai}</div>
        <div class="stat__hint">Sudah ditangani</div></div>
    </div>
    <div class="stat">
      <div class="stat__icon">📋</div>
      <div><div class="stat__label">Total Laporan</div><div class="stat__value">${s.total}</div></div>
    </div>`;

  const cols = [
    { key: 'baru', label: 'Baru', icon: '🆕' },
    { key: 'diproses', label: 'Sedang Diproses', icon: '🔧' },
    { key: 'selesai', label: 'Selesai', icon: '✅' },
  ];

  board.innerHTML = `
    <div class="board">
      ${cols
      .map((col) => {
        const items = state.data.board[col.key] || [];
        return `
          <div class="board__col">
            <div class="board__head">
              <strong>${col.icon} ${esc(col.label)}</strong>
              <span class="badge badge--${TONE[col.key]}">${items.length}</span>
            </div>
            <div class="board__body">
              ${items.length
            ? items.map(cardHtml).join('')
            : `<p class="muted center" style="padding:16px 8px;font-size:.85rem;margin:0">
                     ${col.key === 'baru' ? 'Tidak ada laporan baru.' : col.key === 'diproses' ? 'Tidak ada yang sedang diproses.' : 'Belum ada yang selesai.'}
                   </p>`}
            </div>
          </div>`;
      })
      .join('')}
    </div>`;

  $$('.complaint-card', board).forEach((card) =>
    card.addEventListener('click', () => openDetail(Number(card.dataset.id), ctx))
  );
}

function cardHtml(c) {
  const pri = PRIORITY[c.priority] || PRIORITY.sedang;
  return `
    <button class="complaint-card" data-id="${c.id}">
      <div class="complaint-card__top">
        <div class="row" style="gap:8px;min-width:0">
          ${roomChip(c.roomCode)}
          <span style="font-size:1.1rem">${esc(c.categoryIcon)}</span>
        </div>
        <span class="badge badge--${pri.tone}">#${c.id}</span>
      </div>
      <div class="complaint-card__title">${esc(c.title)}</div>
      <div class="complaint-card__desc">${esc(c.description)}</div>
      ${c.photos.length
      ? `<div class="complaint-card__thumbs">
             ${c.photos.slice(0, 4).map((p) => `<img src="${esc(p.url)}" alt="" loading="lazy" />`).join('')}
             ${c.photos.length > 4 ? `<span class="badge badge--muted">+${c.photos.length - 4}</span>` : ''}
           </div>`
      : ''}
      <div class="complaint-card__foot">
        <div class="person">
          ${avatar(c.tenant.name, c.tenant.avatarColor, 'avatar--sm')}
          <div class="person__text"><small>${esc(c.tenant.name)}</small></div>
        </div>
        <small class="muted">${esc(relatif(c.createdAt))}</small>
      </div>
    </button>`;
}

/* ----------------------------------------------------------------- detail */

async function openDetail(id, ctx) {
  const { root, close } = openModal({
    title: `Laporan #${id}`,
    size: 'lg',
    body: '<div class="empty"><span class="spinner spinner--dark"></span></div>',
  });

  let complaint;
  try {
    ({ complaint } = await api.get(`/api/owner/complaints/${id}`));
  } catch (err) {
    handleError(err);
    close();
    return;
  }

  const c = complaint;
  const pri = PRIORITY[c.priority] || PRIORITY.sedang;

  root.querySelector('.modal__head h3').textContent = c.title;
  root.querySelector('.modal__body').innerHTML = `
    <div class="row row--wrap row--between mb-2" style="gap:10px">
      <div class="row row--wrap" style="gap:8px">
        ${roomChip(c.roomCode)}
        ${badge(c.statusLabel, TONE[c.status])}
        ${badge(pri.label, pri.tone)}
        ${badge(`${c.categoryIcon} ${c.category}`, 'muted')}
      </div>
      <small class="muted">Dilaporkan ${esc(tanggalJam(c.createdAt))}</small>
    </div>

    <div class="row mb-2" style="gap:11px">
      ${avatar(c.tenant.name, c.tenant.avatarColor)}
      <div class="grow">
        <strong>${esc(c.tenant.name)}</strong><br />
        <small class="muted">${esc(c.tenant.phone || 'Nomor belum diisi')} · Lokasi: ${esc(c.location.replace('_', ' '))}</small>
      </div>
      <button class="btn btn--light btn--sm" id="chatTenant">💬 Chat</button>
    </div>

    <h4>Keterangan Penyewa</h4>
    <p class="pre-wrap soft">${esc(c.description)}</p>

    <h4 class="mt-3">Foto Bukti ${c.photos.length ? `(${c.photos.length})` : ''}</h4>
    ${c.photos.length
      ? `<div class="photo-grid">
           ${c.photos
        .map(
          (p) => `<img src="${esc(p.url)}" alt="${esc(p.originalName || 'Foto kerusakan')}"
                              data-zoom="${esc(p.url)}" loading="lazy" title="Klik untuk memperbesar" />`
        )
        .join('')}
         </div>`
      : '<p class="muted">Penyewa tidak melampirkan foto.</p>'}

    <h4 class="mt-3">Riwayat Penanganan</h4>
    <ul class="timeline">
      ${c.updates
      .map(
        (u) => `
        <li>
          <span class="timeline__dot ${u.status === 'selesai' ? 'timeline__dot--ok' : u.status === 'diproses' ? 'timeline__dot--warn' : ''}"></span>
          <div class="timeline__meta">
            <strong>${esc(u.authorName)}</strong>
            <span>${esc(u.authorRole === 'owner' ? 'Pemilik' : 'Penyewa')}</span>
            <span>${esc(tanggalJam(u.createdAt))}</span>
            ${u.statusLabel ? badge(u.statusLabel, TONE[u.status] || 'muted') : ''}
          </div>
          <p class="timeline__note">${esc(u.note)}</p>
        </li>`
      )
      .join('')}
    </ul>

    <hr class="divider" />

    <h4>Perbarui Status</h4>
    <form id="statusForm" class="form">
      <div class="form-grid">
        <div class="field">
          <label for="newStatus">Status penanganan</label>
          <select id="newStatus" name="status">
            <option value="baru" ${c.status === 'baru' ? 'selected' : ''}>Baru</option>
            <option value="diproses" ${c.status === 'diproses' ? 'selected' : ''}>Sedang Diproses</option>
            <option value="selesai" ${c.status === 'selesai' ? 'selected' : ''}>Selesai</option>
          </select>
        </div>
        <div class="field">
          <label>Kirim ke WhatsApp penyewa</label>
          <label class="check" style="padding-top:8px">
            <input type="checkbox" name="sendWhatsapp" value="1" ${c.tenant.phone ? 'checked' : 'disabled'} />
            <span class="check__text">
              <strong>Ya, kabari lewat WhatsApp</strong>
              <small>${c.tenant.phone ? esc(c.tenant.phone) : 'Nomor penyewa belum diisi'}</small>
            </span>
          </label>
        </div>
      </div>
      <div class="field">
        <label for="noteText">Catatan untuk penyewa</label>
        <textarea id="noteText" name="note" rows="3"
                  placeholder="Contoh: Tukang akan datang besok pukul 10.00."></textarea>
      </div>
    </form>`;

  const foot = document.createElement('div');
  foot.className = 'modal__foot';
  foot.innerHTML = `
    <button class="btn btn--light" id="addNote">💬 Kirim Catatan Saja</button>
    <button class="btn btn--light" data-close>Tutup</button>
    <button class="btn btn--primary" id="saveStatus">Simpan Status</button>`;
  root.appendChild(foot);
  foot.querySelector('[data-close]').addEventListener('click', close);
  bindZoom(root);

  root.querySelector('#chatTenant').addEventListener('click', () => {
    close();
    ctx.navigate(`/chat?partner=${c.tenant.id}`);
  });

  foot.querySelector('#saveStatus').addEventListener('click', async (e) => {
    const form = root.querySelector('#statusForm');
    const payload = {
      status: form.querySelector('[name=status]').value,
      note: form.querySelector('[name=note]').value,
      sendWhatsapp: form.querySelector('[name=sendWhatsapp]').checked,
    };
    const done = busy(e.currentTarget, 'Menyimpan…');
    try {
      const res = await api.patch(`/api/owner/complaints/${c.id}/status`, payload);
      close();
      toastOk(res.message);
      if (res.whatsapp) {
        setTimeout(() => toastOk(`WhatsApp: ${res.whatsapp.status}`, 'Notifikasi WhatsApp'), 350);
      }
      await load(ctx);
      ctx.refreshBadges?.();
    } catch (err) { handleError(err); done(); }
  });

  foot.querySelector('#addNote').addEventListener('click', async (e) => {
    const note = root.querySelector('[name=note]').value.trim();
    if (!note) {
      toastOk('Tulis catatan terlebih dahulu.', 'Catatan kosong');
      return;
    }
    const done = busy(e.currentTarget, 'Mengirim…');
    try {
      const res = await api.post(`/api/owner/complaints/${c.id}/notes`, { note });
      close();
      toastOk(res.message);
      await load(ctx);
    } catch (err) { handleError(err); done(); }
  });
}

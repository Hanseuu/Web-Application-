/* Lapor Kerusakan — penyewa melaporkan anomali di kamar / area kos + foto bukti */

import {
  api, esc, tanggalJam, relatif, badge, emptyState, handleError, openModal,
  busy, toastOk, bindZoom, roomChip, $, $$, isLive,
} from '../core.js';

const state = { data: null, files: [] };

const TONE = { baru: 'bad', diproses: 'warn', selesai: 'ok' };
const MAX_FILES = 5;
const MAX_SIZE = 6 * 1024 * 1024;

export async function render(view, ctx) {
  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Lapor Kerusakan</h1>
        <p>Laporkan kerusakan atau hal tidak wajar di kamar maupun area kos.
           Lampirkan foto agar pemilik lebih mudah menilai kondisinya.</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--primary" id="newReport">＋ Buat Laporan</button>
      </div>
    </div>
    <div id="reportBody"></div>
  `;

  $('#newReport').addEventListener('click', () => openForm(ctx));
  await load(ctx);

  const id = ctx.params.get('id');
  if (id) openDetail(Number(id));
}

async function load(ctx) {
  const body = $('#reportBody');
  if (!isLive(body)) return; // pengguna sudah berpindah halaman
  body.innerHTML = '<div class="empty"><span class="spinner spinner--dark"></span></div>';

  try {
    state.data = await api.get('/api/tenant/complaints');
  } catch (err) {
    handleError(err);
    if (!isLive(body)) return;
    body.innerHTML = emptyState('⚠️', 'Gagal memuat laporan');
    return;
  }

  if (!isLive(body)) return;
  const s = state.data.summary;

  body.innerHTML = `
    <section class="grid grid--4 mb-2">
      <div class="stat">
        <div class="stat__icon stat__icon--bad">🆕</div>
        <div><div class="stat__label">Baru</div><div class="stat__value">${s.baru}</div>
          <div class="stat__hint">Menunggu ditinjau</div></div>
      </div>
      <div class="stat">
        <div class="stat__icon stat__icon--warn">🔧</div>
        <div><div class="stat__label">Sedang Diproses</div><div class="stat__value">${s.diproses}</div>
          <div class="stat__hint">Sedang ditangani</div></div>
      </div>
      <div class="stat">
        <div class="stat__icon stat__icon--ok">✅</div>
        <div><div class="stat__label">Selesai</div><div class="stat__value">${s.selesai}</div></div>
      </div>
      <div class="stat">
        <div class="stat__icon">🚪</div>
        <div><div class="stat__label">Kamar Saya</div>
          <div class="stat__value">${esc(state.data.room?.code || '—')}</div></div>
      </div>
    </section>

    <div class="card">
      <div class="card__head">
        <div><h3>Riwayat Laporan Saya</h3><p>${s.total} laporan</p></div>
      </div>
      <div class="card__body">
        ${state.data.complaints.length
      ? `<div class="col">${state.data.complaints.map(cardHtml).join('')}</div>`
      : emptyState(
        '🧰', 'Belum ada laporan',
        'Bila ada kerusakan di kamar atau area kos, klik "Buat Laporan" untuk memberitahu pemilik.'
      )}
      </div>
    </div>`;

  bindZoom(body);
  $$('[data-act=detail]', body).forEach((btn) =>
    btn.addEventListener('click', () => openDetail(Number(btn.dataset.id)))
  );
}

function cardHtml(c) {
  return `
    <div class="ann-item">
      <div class="ann-item__head">
        <div class="grow">
          <div class="ann-item__title">
            <span>${esc(c.categoryIcon)}</span>
            ${esc(c.title)}
            <small class="muted">#${c.id}</small>
          </div>
          <div class="ann-item__meta mt-1">
            <span>📅 ${esc(tanggalJam(c.createdAt))}</span>
            <span>📍 ${esc(c.location.replace('_', ' '))}</span>
            ${c.photos.length ? `<span>📷 ${c.photos.length} foto</span>` : ''}
            ${c.updates.length > 1 ? `<span>💬 ${c.updates.length - 1} tanggapan</span>` : ''}
          </div>
        </div>
        ${badge(c.statusLabel, TONE[c.status])}
      </div>

      <div class="ann-item__body ann-item__body--clamp">${esc(c.description)}</div>

      ${c.photos.length
      ? `<div class="complaint-card__thumbs">
           ${c.photos
        .slice(0, 5)
        .map((p) => `<img src="${esc(p.url)}" alt="" data-zoom="${esc(p.url)}" loading="lazy" style="cursor:zoom-in" />`)
        .join('')}
         </div>`
      : ''}

      ${c.updates.length > 1
      ? `<div class="alert alert--info" style="font-size:.84rem">
           <strong>Tanggapan terakhir:</strong> ${esc(c.updates[c.updates.length - 1].note)}
         </div>`
      : ''}

      <div class="row">
        <button class="btn btn--light btn--sm" data-act="detail" data-id="${c.id}">Lihat Detail</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------ buat laporan */

function openForm(ctx) {
  state.files = [];

  const { root, close } = openModal({
    title: 'Buat Laporan Kerusakan',
    subtitle: `Kamar ${state.data.room?.code || '—'} · Laporan akan langsung diterima pemilik kos`,
    size: 'lg',
    body: `
      <form id="reportForm" class="form">
        <div class="field">
          <label for="rTitle">Judul laporan *</label>
          <input type="text" id="rTitle" name="title" required maxlength="160"
                 placeholder="Contoh: Keran kamar mandi bocor" />
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="rCat">Jenis kerusakan *</label>
            <select id="rCat" name="category" required>
              ${state.data.categories
      .map((c) => `<option value="${c.code}">${c.icon} ${esc(c.label)}</option>`)
      .join('')}
            </select>
          </div>
          <div class="field">
            <label for="rLoc">Lokasi *</label>
            <select id="rLoc" name="location" required>
              ${state.data.locations.map((l) => `<option value="${l.code}">${esc(l.label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="rPri">Tingkat urgensi</label>
            <select id="rPri" name="priority">
              <option value="rendah">Rendah — bisa menunggu</option>
              <option value="sedang" selected>Sedang — mohon segera</option>
              <option value="tinggi">Tinggi — mengganggu / berbahaya</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label for="rDesc">Keterangan lengkap *</label>
          <textarea id="rDesc" name="description" rows="5" required
                    placeholder="Jelaskan sejak kapan terjadi, seberapa parah, dan apa yang sudah Anda coba."></textarea>
        </div>

        <div class="field">
          <label>Foto bukti <span class="field__hint">(maksimal ${MAX_FILES} foto, masing-masing ≤ 6 MB)</span></label>
          <div class="denah-drop" id="photoDrop">
            <strong>📷 Pilih atau jatuhkan foto di sini</strong>
            <p style="margin:4px 0 0;font-size:.82rem">Foto akan tampil di Pusat Komplain milik pemilik kos</p>
            <input type="file" id="photoInput" accept="image/*" multiple hidden />
          </div>
          <div class="file-preview" id="photoPreview"></div>
        </div>

        <p class="alert alert--error" id="reportErr" hidden></p>
      </form>`,
    footer: `
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="sendReport">Kirim Laporan</button>`,
  });

  const drop = root.querySelector('#photoDrop');
  const input = root.querySelector('#photoInput');
  const preview = root.querySelector('#photoPreview');
  const errBox = root.querySelector('#reportErr');
  const showErr = (m) => { errBox.textContent = m; errBox.hidden = false; };

  drop.addEventListener('click', () => input.click());
  ['dragover', 'dragenter'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-drag')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => addFiles(input.files));

  function addFiles(fileList) {
    errBox.hidden = true;
    for (const f of Array.from(fileList || [])) {
      if (state.files.length >= MAX_FILES) {
        showErr(`Maksimal ${MAX_FILES} foto per laporan.`);
        break;
      }
      if (!f.type.startsWith('image/')) {
        showErr(`"${f.name}" bukan file gambar.`);
        continue;
      }
      if (f.size > MAX_SIZE) {
        showErr(`"${f.name}" melebihi 6 MB.`);
        continue;
      }
      state.files.push(f);
    }
    input.value = '';
    renderPreview();
  }

  function renderPreview() {
    preview.innerHTML = state.files
      .map(
        (f, i) => `
        <div class="file-preview__item">
          <img src="${URL.createObjectURL(f)}" alt="${esc(f.name)}" />
          <button type="button" class="file-preview__remove" data-i="${i}" aria-label="Hapus foto">×</button>
        </div>`
      )
      .join('');
    preview.querySelectorAll('.file-preview__remove').forEach((b) =>
      b.addEventListener('click', () => {
        state.files.splice(Number(b.dataset.i), 1);
        renderPreview();
      })
    );
  }

  root.querySelector('#sendReport').addEventListener('click', async (e) => {
    const form = root.querySelector('#reportForm');
    if (!form.reportValidity()) return;

    const done = busy(e.currentTarget, 'Mengirim…');
    try {
      const fd = new FormData();
      fd.append('title', form.querySelector('[name=title]').value);
      fd.append('description', form.querySelector('[name=description]').value);
      fd.append('category', form.querySelector('[name=category]').value);
      fd.append('location', form.querySelector('[name=location]').value);
      fd.append('priority', form.querySelector('[name=priority]').value);
      state.files.forEach((f) => fd.append('photos', f, f.name));

      const res = await api.postForm('/api/tenant/complaints', fd);
      close();
      toastOk(res.message, 'Laporan Terkirim');
      state.files = [];
      await load(ctx);
      ctx.refreshBadges?.();
    } catch (err) {
      showErr(err.message);
      done();
    }
  });
}

/* ----------------------------------------------------------------- detail */

async function openDetail(id) {
  const { root, close } = openModal({
    title: `Laporan #${id}`,
    size: 'lg',
    body: '<div class="empty"><span class="spinner spinner--dark"></span></div>',
    footer: '<button class="btn btn--light" data-close>Tutup</button>',
  });

  let c;
  try {
    ({ complaint: c } = await api.get(`/api/tenant/complaints/${id}`));
  } catch (err) {
    handleError(err);
    close();
    return;
  }

  root.querySelector('.modal__head h3').textContent = c.title;
  root.querySelector('.modal__body').innerHTML = `
    <div class="row row--wrap row--between mb-2" style="gap:10px">
      <div class="row row--wrap" style="gap:8px">
        ${roomChip(c.roomCode)}
        ${badge(c.statusLabel, TONE[c.status])}
        ${badge(`${c.categoryIcon} ${c.category}`, 'muted')}
      </div>
      <small class="muted">Dilaporkan ${esc(tanggalJam(c.createdAt))}</small>
    </div>

    <h4>Keterangan</h4>
    <p class="pre-wrap soft">${esc(c.description)}</p>

    ${c.photos.length
      ? `<h4 class="mt-3">Foto yang Anda Lampirkan (${c.photos.length})</h4>
         <div class="photo-grid">
           ${c.photos
        .map((p) => `<img src="${esc(p.url)}" alt="" data-zoom="${esc(p.url)}" loading="lazy" />`)
        .join('')}
         </div>`
      : ''}

    <h4 class="mt-3">Riwayat Penanganan</h4>
    <ul class="timeline">
      ${c.updates
      .map(
        (u) => `
        <li>
          <span class="timeline__dot ${u.status === 'selesai' ? 'timeline__dot--ok' : u.status === 'diproses' ? 'timeline__dot--warn' : ''}"></span>
          <div class="timeline__meta">
            <strong>${esc(u.authorRole === 'owner' ? 'Pemilik Kos' : 'Anda')}</strong>
            <span>${esc(tanggalJam(u.createdAt))}</span>
            ${u.statusLabel ? badge(u.statusLabel, TONE[u.status] || 'muted') : ''}
          </div>
          <p class="timeline__note">${esc(u.note)}</p>
        </li>`
      )
      .join('')}
    </ul>

    ${c.status !== 'selesai'
      ? `<hr class="divider" />
         <h4>Tambah Keterangan</h4>
         <div class="field">
           <textarea id="extraNote" rows="3" placeholder="Informasi tambahan untuk pemilik kos…"></textarea>
         </div>
         <div class="row row--end mt-1" style="gap:8px">
           <button class="btn btn--light btn--sm" id="addPhotos">📷 Tambah Foto</button>
           <button class="btn btn--primary btn--sm" id="sendNote">Kirim</button>
           <input type="file" id="extraPhotos" accept="image/*" multiple hidden />
         </div>`
      : ''}
  `;

  bindZoom(root);

  root.querySelector('#sendNote')?.addEventListener('click', async (e) => {
    const note = root.querySelector('#extraNote').value.trim();
    if (!note) { toastOk('Tulis keterangan terlebih dahulu.', 'Kosong'); return; }
    const done = busy(e.currentTarget, 'Mengirim…');
    try {
      const res = await api.post(`/api/tenant/complaints/${id}/notes`, { note });
      toastOk(res.message);
      close();
      await load({ params: new URLSearchParams() });
    } catch (err) { handleError(err); done(); }
  });

  const extraInput = root.querySelector('#extraPhotos');
  root.querySelector('#addPhotos')?.addEventListener('click', () => extraInput.click());
  extraInput?.addEventListener('change', async () => {
    if (!extraInput.files?.length) return;
    try {
      const fd = new FormData();
      Array.from(extraInput.files).slice(0, MAX_FILES).forEach((f) => fd.append('photos', f, f.name));
      const res = await api.postForm(`/api/tenant/complaints/${id}/photos`, fd);
      toastOk(res.message);
      close();
      await load({ params: new URLSearchParams() });
    } catch (err) { handleError(err); }
  });
}

/* Denah & Fasilitas — owner mengatur denah tiap lantai, fasilitas, dan tempat sekitar */

import {
  api, esc, rupiah, tanggalJam, badge, emptyState, handleError, openModal, confirmDialog,
  busy, toastOk, bindZoom, shrinkImage, formatBytes, $, $$, isLive,
} from '../core.js';

const state = {
  tab: 'denah',
  floor: 1,
  floorplans: [],
  facilities: [],
  categories: [],
  places: [],
  placeCategories: [],
};

export async function render(view, ctx) {
  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Denah &amp; Fasilitas</h1>
        <p>Atur denah setiap lantai dan daftar fasilitas. Semua perubahan langsung tampil
           di halaman <strong>Fasilitas</strong> milik penyewa.</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--light" id="notifyTenants">🔔 Kabari Penyewa</button>
      </div>
    </div>

    <div class="tabs" id="propTabs">
      <button class="tab is-active" data-tab="denah">🗺️ Denah Lantai</button>
      <button class="tab" data-tab="fasilitas">🏢 Fasilitas Kos</button>
      <button class="tab" data-tab="sekitar">📍 Tempat Sekitar</button>
    </div>

    <div id="propBody"></div>
  `;

  $('#propTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    $$('#propTabs .tab').forEach((t) => t.classList.toggle('is-active', t === btn));
    renderBody(ctx);
  });

  $('#notifyTenants').addEventListener('click', async (e) => {
    const ok = await confirmDialog({
      title: 'Kabari semua penyewa?',
      message: 'Semua penyewa aktif akan menerima notifikasi bahwa info denah & fasilitas telah diperbarui.',
      confirmText: 'Ya, kirim notifikasi',
    });
    if (!ok) return;
    const done = busy(e.currentTarget, 'Mengirim…');
    try {
      const res = await api.post('/api/owner/facilities/publish', {});
      toastOk(res.message);
    } catch (err) { handleError(err); }
    done();
  });

  await loadAll();
  renderBody(ctx);
}

async function loadAll() {
  try {
    const [fp, fac, pl] = await Promise.all([
      api.get('/api/owner/floorplans'),
      api.get('/api/owner/facilities'),
      api.get('/api/owner/places'),
    ]);
    state.floorplans = fp.floorplans;
    state.facilities = fac.facilities;
    state.categories = fac.categories;
    state.places = pl.places;
    state.placeCategories = pl.categories;
  } catch (err) { handleError(err); }
}

function renderBody(ctx) {
  const body = $('#propBody');
  if (!isLive(body)) return; // pengguna sudah berpindah halaman
  if (state.tab === 'denah') renderDenah(body, ctx);
  else if (state.tab === 'fasilitas') renderFacilities(body, ctx);
  else renderPlaces(body, ctx);
}

/* ========================================================== DENAH LANTAI = */

function renderDenah(body) {
  const fp = state.floorplans.find((f) => f.floor === state.floor) || state.floorplans[0];
  if (!fp) {
    body.innerHTML = emptyState('🗺️', 'Belum ada data lantai');
    return;
  }

  if (!isLive(body)) return;
  body.innerHTML = `
    <div class="floor-tabs" id="floorTabs">
      ${state.floorplans
      .map(
        (f) => `<button class="floor-tab ${f.floor === state.floor ? 'is-active' : ''}" data-floor="${f.floor}">
                  Lantai ${f.floor}
                  <span class="muted" style="font-weight:500"> · ${f.stats.occupied}/${f.stats.total}</span>
                </button>`
      )
      .join('')}
    </div>

    <div class="grid grid--2">
      <!-- Editor denah -->
      <div class="card">
        <div class="card__head">
          <div>
            <h3>Keterangan Denah</h3>
            <p>${fp.updatedAt ? `Diperbarui ${esc(tanggalJam(fp.updatedAt))}` : 'Belum pernah disimpan'}</p>
          </div>
        </div>
        <div class="card__body">
          <form id="denahForm" class="form">
            <div class="field">
              <label for="dTitle">Judul denah</label>
              <input type="text" id="dTitle" name="title" value="${esc(fp.title)}" />
            </div>
            <div class="field">
              <label for="dDesc">Keterangan / tata letak</label>
              <textarea id="dDesc" name="description" rows="11"
                        placeholder="Jelaskan tata letak kamar, posisi tangga, jalur evakuasi, dll.">${esc(fp.description)}</textarea>
              <span class="field__hint">Teks ini dibaca penyewa di halaman Fasilitas.</span>
            </div>

            <div class="field">
              <label>Gambar denah</label>
              ${fp.imagePath
      ? `<img src="${esc(fp.imagePath)}" alt="Denah lantai ${fp.floor}" class="denah-image mb-1"
                        data-zoom="${esc(fp.imagePath)}" style="cursor:zoom-in" />
                   <label class="check mb-1">
                     <input type="checkbox" name="removeImage" value="1" />
                     <span class="check__text">Hapus gambar denah ini</span>
                   </label>`
      : ''}
              <div class="denah-drop" id="denahDrop">
                <strong>📤 ${fp.imagePath ? 'Ganti gambar denah' : 'Unggah gambar denah'}</strong>
                <p style="margin:4px 0 0;font-size:.82rem">Klik untuk memilih file (JPG/PNG/WEBP, maks 6 MB)</p>
                <input type="file" id="denahFile" name="image" accept="image/*" hidden />
              </div>
              <div id="denahPreview"></div>
            </div>

            <button type="submit" class="btn btn--primary" id="saveDenah">Simpan Denah Lantai ${fp.floor}</button>
          </form>
        </div>
      </div>

      <!-- Peta kamar -->
      <div class="card">
        <div class="card__head">
          <div>
            <h3>Susunan Kamar Lantai ${fp.floor}</h3>
            <p>Dibentuk otomatis dari data kamar &amp; penghuni</p>
          </div>
          <button class="btn btn--light btn--sm" id="addRoom">＋ Kamar</button>
        </div>
        <div class="card__body">
          <div class="legend">
            <span><i style="background:#f0fdf4;border-color:#bbf7d0"></i> Terisi</span>
            <span><i style="background:var(--c-surface-2);border-style:dashed"></i> Kosong</span>
          </div>
          <div class="kv-grid mb-2">
            <div class="kv"><div class="kv__label">Total Kamar</div><div class="kv__value">${fp.stats.total}</div></div>
            <div class="kv"><div class="kv__label">Terisi</div><div class="kv__value">${fp.stats.occupied}</div></div>
            <div class="kv"><div class="kv__label">Kosong</div><div class="kv__value">${fp.stats.available}</div></div>
          </div>
          <div class="room-map">
            ${fp.rooms
      .map(
        (r) => `
                <div class="room-cell ${r.occupied ? 'room-cell--occupied' : 'room-cell--empty'}"
                     title="${esc(r.code)} — ${esc(rupiah(r.price))}${r.size ? ` — ${esc(r.size)}` : ''}">
                  <span class="room-cell__code">${esc(r.code)}</span>
                  <span class="room-cell__tenant">${esc(r.tenant?.name || 'Kosong')}</span>
                  <span class="room-cell__status">
                    <i class="dot ${r.occupied ? 'dot--ok' : 'dot--muted'}"></i>
                    ${r.occupied ? 'Terisi' : 'Tersedia'}
                  </span>
                </div>`
      )
      .join('')}
          </div>
          <p class="muted mt-2" style="font-size:.8rem">
            Kode kamar memakai format <strong>XYY</strong>: digit pertama adalah lantai,
            dua digit berikutnya nomor kamar (01–30). Contoh: kamar 7 di lantai 3 → <strong>307</strong>.
          </p>
        </div>
      </div>
    </div>
  `;

  bindZoom(body);

  $('#floorTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.floor-tab');
    if (!btn) return;
    state.floor = Number(btn.dataset.floor);
    renderDenah(body);
  });

  // Pemilihan file + pratinjau
  const drop = $('#denahDrop');
  const fileInput = $('#denahFile');
  drop.addEventListener('click', () => fileInput.click());
  ['dragover', 'dragenter'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, () => drop.classList.remove('is-drag'))
  );
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) {
      fileInput.files = e.dataTransfer.files;
      previewFile();
    }
  });
  fileInput.addEventListener('change', previewFile);

  function previewFile() {
    const prev = $('#denahPreview');
    const f = fileInput.files?.[0];
    if (!f) { prev.innerHTML = ''; return; }
    prev.innerHTML = `
      <div class="file-preview">
        <div class="file-preview__item">
          <img src="${URL.createObjectURL(f)}" alt="Pratinjau" />
        </div>
      </div>
      <p class="muted" style="font-size:.8rem;margin:6px 0 0">${esc(f.name)} — ${esc(formatBytes(f.size))} (akan dikecilkan otomatis)</p>`;
  }

  $('#denahForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#saveDenah');
    const done = busy(btn, 'Menyimpan…');
    try {
      const fd = new FormData(e.currentTarget);
      fd.delete('image');
      if (fileInput.files?.length) {
        const shrunk = await shrinkImage(fileInput.files[0], { maxDim: 2000 });
        fd.append('image', shrunk, shrunk.name);
      }
      const res = await api.putForm(`/api/owner/floorplans/${state.floor}`, fd);
      state.floorplans = res.floorplans;
      toastOk(res.message);
      renderDenah(body);
    } catch (err) {
      handleError(err);
      done();
    }
  });

  $('#addRoom').addEventListener('click', () => openRoomForm(body));
}

function openRoomForm(body) {
  const used = new Set(
    state.floorplans.find((f) => f.floor === state.floor)?.rooms.map((r) => r.number) || []
  );
  const available = Array.from({ length: 30 }, (_, i) => i + 1).filter((n) => !used.has(n));

  const { root, close } = openModal({
    title: `Tambah Kamar di Lantai ${state.floor}`,
    subtitle: 'Kode kamar dibuat otomatis dengan format XYY (maksimal 30 kamar per lantai).',
    body: `
      <form id="roomForm" class="form">
        <div class="form-grid">
          <div class="field">
            <label for="rNumber">Nomor kamar</label>
            <select id="rNumber" name="number">
              ${available
      .map((n) => `<option value="${n}">${n} → kode ${state.floor}${String(n).padStart(2, '0')}</option>`)
      .join('')}
            </select>
            ${available.length ? '' : '<span class="field__hint">Semua 30 nomor kamar di lantai ini sudah terpakai.</span>'}
          </div>
          <div class="field">
            <label for="rPrice">Harga per bulan</label>
            <input type="number" id="rPrice" name="price" min="0" step="50000" value="1200000" />
          </div>
          <div class="field">
            <label for="rSize">Ukuran kamar</label>
            <input type="text" id="rSize" name="size" placeholder="3 x 4 m" />
          </div>
          <div class="field">
            <label for="rNotes">Catatan</label>
            <input type="text" id="rNotes" name="notes" placeholder="Kamar sudut, jendela ganda…" />
          </div>
        </div>
        <p class="alert alert--error" id="roomErr" hidden></p>
      </form>`,
    footer: `
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="saveRoom" ${available.length ? '' : 'disabled'}>Tambah Kamar</button>`,
  });

  root.querySelector('#saveRoom').addEventListener('click', async (e) => {
    const done = busy(e.currentTarget, 'Menyimpan…');
    try {
      const payload = Object.fromEntries(new FormData(root.querySelector('#roomForm')).entries());
      const res = await api.post('/api/owner/rooms', { ...payload, floor: state.floor });
      close();
      toastOk(res.message);
      await loadAll();
      renderDenah(body);
    } catch (err) {
      const box = root.querySelector('#roomErr');
      box.textContent = err.message;
      box.hidden = false;
      done();
    }
  });
}

/* ============================================================= FASILITAS = */

function renderFacilities(body, ctx) {
  body.innerHTML = `
    <div class="row row--between row--wrap mb-2">
      <p class="muted" style="margin:0">
        ${state.facilities.length} fasilitas terdaftar ·
        ${state.facilities.filter((f) => f.isPublished).length} tampil ke penyewa
      </p>
      <button class="btn btn--primary" id="addFacility">＋ Tambah Fasilitas</button>
    </div>

    ${state.facilities.length
      ? `<div class="grid grid--cards">${state.facilities.map(facilityCard).join('')}</div>`
      : `<div class="card"><div class="card__body">${emptyState(
        '🏢', 'Belum ada fasilitas',
        'Tambahkan fasilitas seperti WiFi, dapur bersama, atau parkir agar tampil di halaman penyewa.'
      )}</div></div>`}
  `;

  bindZoom(body);
  $('#addFacility').addEventListener('click', () => openFacilityForm(null, body, ctx));
  $$('[data-act=edit-fac]', body).forEach((btn) =>
    btn.addEventListener('click', () => {
      const f = state.facilities.find((x) => x.id === Number(btn.dataset.id));
      openFacilityForm(f, body, ctx);
    })
  );
  $$('[data-act=del-fac]', body).forEach((btn) =>
    btn.addEventListener('click', async () => {
      const f = state.facilities.find((x) => x.id === Number(btn.dataset.id));
      const ok = await confirmDialog({
        title: 'Hapus fasilitas?',
        message: `"${f.name}" akan dihapus dan tidak lagi tampil di halaman penyewa.`,
        confirmText: 'Ya, hapus',
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await api.del(`/api/owner/facilities/${f.id}`);
        toastOk(res.message);
        await loadAll();
        renderFacilities(body, ctx);
      } catch (err) { handleError(err); }
    })
  );
}

const facilityCard = (f) => `
  <div class="facility-card">
    ${f.photoPath
    ? `<img src="${esc(f.photoPath)}" alt="${esc(f.name)}" class="facility-card__photo"
             data-zoom="${esc(f.photoPath)}" style="cursor:zoom-in" />`
    : ''}
    <div class="facility-card__body">
      <div class="facility-card__title">
        <span>${esc(f.icon)}</span>
        <strong>${esc(f.name)}</strong>
      </div>
      ${f.location ? `<small class="muted">📍 ${esc(f.location)}</small>` : ''}
      <p>${esc(f.description || 'Belum ada keterangan.')}</p>
      <div class="row row--wrap" style="gap:6px;margin-top:auto;padding-top:6px">
        ${badge(f.category, 'muted')}
        ${f.isPublished ? badge('Tampil', 'ok') : badge('Disembunyikan', 'warn')}
      </div>
    </div>
    <div class="facility-card__foot">
      <button class="btn btn--light btn--sm" data-act="edit-fac" data-id="${f.id}">✏️ Edit</button>
      <button class="btn btn--light btn--sm" data-act="del-fac" data-id="${f.id}">🗑 Hapus</button>
    </div>
  </div>`;

const ICON_CHOICES = ['🏠', '📶', '🍳', '🛵', '📹', '🧺', '🛋️', '🚿', '🧹', '🔑', '❄️', '🅿️', '🛏️', '💡', '🚰', '🪑'];

function openFacilityForm(facility, body, ctx) {
  const isEdit = Boolean(facility);

  const { root, close } = openModal({
    title: isEdit ? `Edit Fasilitas — ${facility.name}` : 'Tambah Fasilitas',
    subtitle: 'Fasilitas yang ditandai "tampil" akan muncul di halaman Fasilitas penyewa.',
    body: `
      <form id="facForm" class="form">
        <div class="form-grid">
          <div class="field span-2">
            <label for="fName">Nama fasilitas *</label>
            <input type="text" id="fName" name="name" required value="${esc(facility?.name || '')}"
                   placeholder="WiFi 100 Mbps" />
          </div>
          <div class="field">
            <label for="fCat">Kategori</label>
            <select id="fCat" name="category">
              ${state.categories
      .map((c) => `<option value="${c.code}" ${facility?.category === c.code ? 'selected' : ''}>${esc(c.label)}</option>`)
      .join('')}
            </select>
          </div>
          <div class="field">
            <label for="fLoc">Lokasi</label>
            <input type="text" id="fLoc" name="location" value="${esc(facility?.location || '')}"
                   placeholder="Lantai 1 belakang" />
          </div>
          <div class="field span-2">
            <label>Ikon</label>
            <div class="chip-row" id="iconPicker">
              ${ICON_CHOICES
      .map(
        (i) => `<button type="button" class="chip ${(facility?.icon || '🏠') === i ? 'is-active' : ''}"
                           data-icon="${i}" style="font-size:1.1rem">${i}</button>`
      )
      .join('')}
            </div>
            <input type="hidden" name="icon" id="fIcon" value="${esc(facility?.icon || '🏠')}" />
          </div>
          <div class="field span-2">
            <label for="fDesc">Keterangan</label>
            <textarea id="fDesc" name="description" rows="3"
                      placeholder="Jelaskan aturan pakai, jam operasional, dsb.">${esc(facility?.description || '')}</textarea>
          </div>
          <div class="field span-2">
            <label for="fPhoto">Foto fasilitas</label>
            ${facility?.photoPath
      ? `<img src="${esc(facility.photoPath)}" alt="" class="denah-image mb-1" style="max-height:180px" />
                 <label class="check mb-1">
                   <input type="checkbox" name="removePhoto" value="1" />
                   <span class="check__text">Hapus foto saat ini</span>
                 </label>`
      : ''}
            <input type="file" id="fPhoto" name="photo" accept="image/*" />
          </div>
          <div class="field span-2">
            <label class="check">
              <input type="checkbox" name="isPublished" value="1" ${!facility || facility.isPublished ? 'checked' : ''} />
              <span class="check__text">
                <strong>Tampilkan ke penyewa</strong>
                <small>Muncul di halaman Fasilitas pada akun penyewa.</small>
              </span>
            </label>
          </div>
        </div>
        <p class="alert alert--error" id="facErr" hidden></p>
      </form>`,
    footer: `
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="saveFac">${isEdit ? 'Simpan' : 'Tambah Fasilitas'}</button>`,
  });

  root.querySelector('#iconPicker').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    root.querySelectorAll('#iconPicker .chip').forEach((c) => c.classList.toggle('is-active', c === chip));
    root.querySelector('#fIcon').value = chip.dataset.icon;
  });

  root.querySelector('#saveFac').addEventListener('click', async (e) => {
    const form = root.querySelector('#facForm');
    if (!form.reportValidity()) return;
    const done = busy(e.currentTarget, 'Menyimpan…');
    try {
      const fd = new FormData(form);
      // Checkbox yang tidak dicentang tidak terkirim; kirim eksplisit "0".
      if (!fd.get('isPublished')) fd.set('isPublished', '0');
      const photoInput = root.querySelector('#fPhoto');
      fd.delete('photo');
      if (photoInput.files?.length) {
        const shrunk = await shrinkImage(photoInput.files[0], { maxDim: 1400 });
        fd.append('photo', shrunk, shrunk.name);
      }

      const res = isEdit
        ? await api.putForm(`/api/owner/facilities/${facility.id}`, fd)
        : await api.postForm('/api/owner/facilities', fd);
      close();
      toastOk(res.message);
      await loadAll();
      renderFacilities(body, ctx);
    } catch (err) {
      const box = root.querySelector('#facErr');
      box.textContent = err.message;
      box.hidden = false;
      done();
    }
  });
}

/* ======================================================== TEMPAT SEKITAR = */

function renderPlaces(body, ctx) {
  const grouped = state.placeCategories
    .map((c) => ({ ...c, items: state.places.filter((p) => p.category === c.code) }))
    .filter((g) => g.items.length);

  const orphan = state.places.filter(
    (p) => !state.placeCategories.some((c) => c.code === p.category)
  );
  if (orphan.length) grouped.push({ code: 'lain', label: 'Lainnya', icon: '📍', items: orphan });

  body.innerHTML = `
    <div class="alert alert--info mb-2">
      Tempat umum di sekitar kos (laundry, minimarket, SPBU, dll) tampil di halaman
      <strong>Fasilitas</strong> penyewa. Saat diklik, penyewa langsung diarahkan ke Google Maps.
    </div>

    <div class="row row--between row--wrap mb-2">
      <p class="muted" style="margin:0">${state.places.length} tempat terdaftar</p>
      <button class="btn btn--primary" id="addPlace">＋ Tambah Tempat</button>
    </div>

    ${grouped.length
      ? grouped
        .map(
          (g) => `
          <div class="place-group">
            <div class="place-group__head">
              <h3><span>${g.icon}</span> ${esc(g.label)}</h3>
              <span class="badge badge--muted">${g.items.length}</span>
            </div>
            <div class="table-wrap card">
              <table class="table">
                <thead><tr><th>Nama</th><th>Alamat</th><th>Jarak</th><th>Status</th><th class="right">Aksi</th></tr></thead>
                <tbody>
                  ${g.items
              .map(
                (p) => `
                      <tr>
                        <td><strong>${esc(p.name)}</strong></td>
                        <td><small class="muted">${esc(p.address || '—')}</small></td>
                        <td class="nowrap"><small>${esc(p.distanceLabel || '—')}</small></td>
                        <td>${p.isActive ? badge('Aktif', 'ok') : badge('Nonaktif', 'muted')}</td>
                        <td class="actions">
                          <a class="btn btn--light btn--sm" href="${esc(p.mapsUrl)}" target="_blank" rel="noopener">🗺 Maps</a>
                          <button class="btn btn--light btn--sm" data-act="edit-place" data-id="${p.id}">✏️</button>
                          <button class="btn btn--light btn--sm" data-act="del-place" data-id="${p.id}">🗑</button>
                        </td>
                      </tr>`
              )
              .join('')}
                </tbody>
              </table>
            </div>
          </div>`
        )
        .join('')
      : `<div class="card"><div class="card__body">${emptyState(
        '📍', 'Belum ada tempat sekitar',
        'Tambahkan laundry, minimarket, atau SPBU terdekat agar memudahkan penyewa.'
      )}</div></div>`}
  `;

  $('#addPlace').addEventListener('click', () => openPlaceForm(null, body, ctx));
  $$('[data-act=edit-place]', body).forEach((btn) =>
    btn.addEventListener('click', () => {
      const p = state.places.find((x) => x.id === Number(btn.dataset.id));
      openPlaceForm(p, body, ctx);
    })
  );
  $$('[data-act=del-place]', body).forEach((btn) =>
    btn.addEventListener('click', async () => {
      const p = state.places.find((x) => x.id === Number(btn.dataset.id));
      const ok = await confirmDialog({
        title: 'Hapus tempat ini?',
        message: `"${p.name}" akan dihapus dari daftar tempat sekitar.`,
        confirmText: 'Ya, hapus',
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await api.del(`/api/owner/places/${p.id}`);
        toastOk(res.message);
        await loadAll();
        renderPlaces(body, ctx);
      } catch (err) { handleError(err); }
    })
  );
}

function openPlaceForm(place, body, ctx) {
  const isEdit = Boolean(place);

  const { root, close } = openModal({
    title: isEdit ? `Edit — ${place.name}` : 'Tambah Tempat Sekitar',
    subtitle: 'Koordinat opsional. Bila kosong, tautan Maps memakai nama + alamat sebagai pencarian.',
    body: `
      <form id="placeForm" class="form">
        <div class="form-grid">
          <div class="field span-2">
            <label for="pName">Nama tempat *</label>
            <input type="text" id="pName" name="name" required value="${esc(place?.name || '')}"
                   placeholder="Indomaret Melati" />
          </div>
          <div class="field">
            <label for="pCat">Kategori *</label>
            <select id="pCat" name="category" required>
              ${state.placeCategories
      .map((c) => `<option value="${c.code}" ${place?.category === c.code ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`)
      .join('')}
            </select>
          </div>
          <div class="field">
            <label for="pDist">Jarak (meter)</label>
            <input type="number" id="pDist" name="distanceM" min="0" step="10" value="${esc(place?.distanceM ?? '')}" />
          </div>
          <div class="field span-2">
            <label for="pAddr">Alamat</label>
            <input type="text" id="pAddr" name="address" value="${esc(place?.address || '')}" />
          </div>
          <div class="field">
            <label for="pLat">Latitude</label>
            <input type="text" id="pLat" name="lat" value="${esc(place?.lat ?? '')}" placeholder="-7.7829" />
          </div>
          <div class="field">
            <label for="pLng">Longitude</label>
            <input type="text" id="pLng" name="lng" value="${esc(place?.lng ?? '')}" placeholder="110.3670" />
          </div>
          <div class="field span-2">
            <label class="check">
              <input type="checkbox" name="isActive" value="1" ${!place || place.isActive ? 'checked' : ''} />
              <span class="check__text"><strong>Tampilkan ke penyewa</strong></span>
            </label>
          </div>
        </div>
        <p class="alert alert--error" id="placeErr" hidden></p>
      </form>`,
    footer: `
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="savePlace">${isEdit ? 'Simpan' : 'Tambah'}</button>`,
  });

  root.querySelector('#savePlace').addEventListener('click', async (e) => {
    const form = root.querySelector('#placeForm');
    if (!form.reportValidity()) return;
    const done = busy(e.currentTarget, 'Menyimpan…');
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.isActive = form.querySelector('[name=isActive]').checked;
      const res = isEdit
        ? await api.put(`/api/owner/places/${place.id}`, payload)
        : await api.post('/api/owner/places', payload);
      close();
      toastOk(res.message);
      await loadAll();
      renderPlaces(body, ctx);
    } catch (err) {
      const box = root.querySelector('#placeErr');
      box.textContent = err.message;
      box.hidden = false;
      done();
    }
  });
}

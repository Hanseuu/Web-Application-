/* Fasilitas (penyewa) — fasilitas milik kos, denah lantai, dan tempat umum
   di sekitar kos (laundry, minimarket, SPBU, dll) yang membuka Google Maps. */

import {
  api, esc, rupiah, badge, emptyState, handleError, bindZoom, openModal, $, $$, isLive,
} from '../core.js';

const state = { data: null, tab: 'fasilitas', floor: null };

export async function render(view, ctx) {
  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Fasilitas</h1>
        <p>Fasilitas yang tersedia di kos, denah lantai, serta tempat berguna di sekitar kos.</p>
      </div>
    </div>

    <div class="tabs" id="facTabs">
      <button class="tab is-active" data-tab="fasilitas">🏢 Fasilitas Kos</button>
      <button class="tab" data-tab="denah">🗺️ Denah Lantai</button>
      <button class="tab" data-tab="sekitar">📍 Di Sekitar Kos</button>
    </div>

    <div id="facBody"><div class="empty"><span class="spinner spinner--dark"></span></div></div>
  `;

  try {
    state.data = await api.get('/api/tenant/facilities');
    state.floor = state.data.myFloor || state.data.floorplans[0]?.floor || 1;
  } catch (err) {
    handleError(err);
    const box = $('#facBody');
    if (isLive(box)) box.innerHTML = emptyState('⚠️', 'Gagal memuat data fasilitas');
    return;
  }

  // Pengguna bisa berpindah halaman selagi data dimuat.
  if (!isLive($('#facBody'))) return;

  $('#facTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    $$('#facTabs .tab').forEach((t) => t.classList.toggle('is-active', t === btn));
    renderBody();
  });

  renderBody();
}

function renderBody() {
  const body = $('#facBody');
  if (!isLive(body)) return; // pengguna sudah berpindah halaman
  if (state.tab === 'fasilitas') renderFacilities(body);
  else if (state.tab === 'denah') renderDenah(body);
  else renderNearby(body);
}

/* ============================================================ FASILITAS = */

function renderFacilities(body) {
  const list = state.data.facilities;

  body.innerHTML = `
    <div class="alert alert--info mb-2">
      <strong>${esc(state.data.kost.name)}</strong> — ${esc(state.data.kost.address)}
    </div>

    ${list.length
      ? `<div class="grid grid--cards">
          ${list
        .map(
          (f) => `
            <div class="facility-card">
              ${f.photoPath
              ? `<img src="${esc(f.photoPath)}" alt="${esc(f.name)}" class="facility-card__photo"
                       data-zoom="${esc(f.photoPath)}" style="cursor:zoom-in" loading="lazy" />`
              : ''}
              <div class="facility-card__body">
                <div class="facility-card__title">
                  <span>${esc(f.icon)}</span>
                  <strong>${esc(f.name)}</strong>
                </div>
                ${f.location ? `<small class="muted">📍 ${esc(f.location)}</small>` : ''}
                <p>${esc(f.description || '')}</p>
              </div>
            </div>`
        )
        .join('')}
         </div>`
      : `<div class="card"><div class="card__body">${emptyState(
        '🏢', 'Belum ada fasilitas terdaftar',
        'Pemilik kos belum menambahkan daftar fasilitas.'
      )}</div></div>`}
  `;

  bindZoom(body);
}

/* ================================================================ DENAH = */

function renderDenah(body) {
  const fp = state.data.floorplans.find((f) => f.floor === state.floor) || state.data.floorplans[0];
  if (!fp) {
    body.innerHTML = emptyState('🗺️', 'Denah belum tersedia');
    return;
  }

  body.innerHTML = `
    <div class="floor-tabs" id="floorTabs">
      ${state.data.floorplans
      .map(
        (f) => `<button class="floor-tab ${f.floor === state.floor ? 'is-active' : ''}" data-floor="${f.floor}">
                  Lantai ${f.floor}${f.floor === state.data.myFloor ? ' (lantai saya)' : ''}
                </button>`
      )
      .join('')}
    </div>

    <div class="grid grid--2">
      <div class="card">
        <div class="card__head">
          <div><h3>${esc(fp.title)}</h3><p>${fp.stats.total} kamar · ${fp.stats.occupied} terisi</p></div>
        </div>
        <div class="card__body">
          ${fp.imagePath
      ? `<img src="${esc(fp.imagePath)}" alt="Denah ${esc(fp.title)}" class="denah-image mb-2"
                  data-zoom="${esc(fp.imagePath)}" style="cursor:zoom-in" />`
      : ''}
          ${fp.description
      ? `<div class="pre-wrap soft" style="font-size:.88rem">${esc(fp.description)}</div>`
      : '<p class="muted">Pemilik kos belum menambahkan keterangan untuk lantai ini.</p>'}
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <div><h3>Susunan Kamar</h3><p>Kode kamar: lantai + nomor kamar</p></div>
        </div>
        <div class="card__body">
          <div class="legend">
            <span><i style="background:#f0fdf4;border-color:#bbf7d0"></i> Terisi</span>
            <span><i style="background:var(--c-surface-2);border-style:dashed"></i> Kosong</span>
            ${state.data.myRoom ? '<span><i style="background:#eef3ff;border-color:#1d4ed8"></i> Kamar saya</span>' : ''}
          </div>
          <div class="room-map">
            ${fp.rooms
      .map((r) => {
        const mine = r.code === state.data.myRoom;
        return `
                  <div class="room-cell ${r.occupied ? 'room-cell--occupied' : 'room-cell--empty'} ${mine ? 'room-cell--mine' : ''}"
                       title="${esc(r.code)}${mine ? ' — kamar Anda' : ''}">
                    <span class="room-cell__code">${esc(r.code)}</span>
                    <span class="room-cell__tenant">${mine ? '⭐ Kamar Anda' : r.occupied ? 'Terisi' : 'Tersedia'}</span>
                    <span class="room-cell__status">
                      <i class="dot ${r.occupied ? 'dot--ok' : 'dot--muted'}"></i>
                      ${r.occupied ? 'Dihuni' : 'Kosong'}
                    </span>
                  </div>`;
      })
      .join('')}
          </div>
          <p class="muted mt-2" style="font-size:.8rem">
            Format kode kamar <strong>XYY</strong>: digit pertama menunjukkan lantai, dua digit
            berikutnya nomor kamar. Contoh: <strong>${state.data.myRoom || '205'}</strong> =
            lantai ${(state.data.myRoom || '205')[0]}, kamar ${(state.data.myRoom || '205').slice(1)}.
          </p>
        </div>
      </div>
    </div>`;

  bindZoom(body);
  $('#floorTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.floor-tab');
    if (!btn) return;
    state.floor = Number(btn.dataset.floor);
    renderDenah(body);
  });
}

/* ======================================================== DI SEKITAR KOS = */

function renderNearby(body) {
  const groups = state.data.nearby;

  body.innerHTML = `
    <div class="alert alert--info mb-2">
      📍 Tempat-tempat berguna di sekitar <strong>${esc(state.data.kost.name)}</strong>.
      Klik salah satu untuk membukanya di <strong>Google Maps</strong>.
    </div>

    ${groups
      .map(
        (g) => `
        <div class="place-group">
          <div class="place-group__head">
            <h3><span>${g.icon}</span> ${esc(g.label)}</h3>
            ${g.places.length ? badge(`${g.places.length} tempat`, 'muted') : ''}
            <a class="btn btn--light btn--sm" href="${esc(g.searchUrl)}" target="_blank" rel="noopener">
              🔍 Cari ${esc(g.label.toLowerCase())} terdekat di Maps
            </a>
          </div>

          ${g.places.length
          ? `<div class="place-list">
                ${g.places
            .map(
              (p) => `
                  <a class="place-item" href="${esc(p.mapsUrl)}" target="_blank" rel="noopener"
                     title="Buka ${esc(p.name)} di Google Maps">
                    <span class="place-item__icon">${g.icon}</span>
                    <span class="place-item__text">
                      <strong>${esc(p.name)}</strong>
                      <small>${esc(p.address || '')}${p.distanceLabel ? ` · ${esc(p.distanceLabel)}` : ''}</small>
                    </span>
                    <span class="place-item__go">🗺️</span>
                  </a>`
            )
            .join('')}
               </div>`
          : `<p class="muted" style="font-size:.85rem;margin:0">
                Belum ada daftar ${esc(g.label.toLowerCase())} dari pemilik kos — gunakan tombol
                pencarian di atas untuk mencari lewat Google Maps.
               </p>`}
        </div>`
      )
      .join('')}

    <div class="card mt-2">
      <div class="card__body">
        <div class="row row--between row--wrap" style="gap:12px">
          <div>
            <strong>Butuh tempat lain?</strong>
            <p class="muted" style="margin:3px 0 0;font-size:.85rem">
              Buka Google Maps pada posisi kos untuk mencari apa pun di sekitar.
            </p>
          </div>
          <a class="btn btn--primary"
             href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(state.data.kost.address)}"
             target="_blank" rel="noopener">🗺️ Buka Lokasi Kos di Maps</a>
        </div>
      </div>
    </div>`;
}

/* Buat Pengumuman — target semua/per lantai (dropdown) + penjadwalan */

import {
  api, esc, tanggalJam, relatif, badge, emptyState, handleError, openModal,
  confirmDialog, busy, toastOk, toLocalInput, roomChip, $, $$, isLive,
} from '../core.js';

const state = {
  filter: '',
  announcements: [],
  targets: [],
  categories: [],
  summary: {},
};

export async function render(view, ctx) {
  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Buat Pengumuman</h1>
        <p>Kirim informasi ke seluruh penyewa aktif atau khusus satu lantai.
           Pengumuman bisa diterbitkan sekarang atau dijadwalkan.</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--primary" id="newAnn">＋ Pengumuman Baru</button>
      </div>
    </div>

    <section class="grid grid--3 mb-2" id="annStats"></section>

    <div class="tabs" id="annTabs">
      <button class="tab is-active" data-status="">Semua</button>
      <button class="tab" data-status="terbit">Sudah Terbit</button>
      <button class="tab" data-status="terjadwal">Terjadwal</button>
      <button class="tab" data-status="arsip">Arsip</button>
    </div>

    <div id="annList"></div>
  `;

  $('#newAnn').addEventListener('click', () => openForm(null, ctx));
  $('#annTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    state.filter = btn.dataset.status;
    $$('#annTabs .tab').forEach((t) => t.classList.toggle('is-active', t === btn));
    load(ctx);
  });

  await load(ctx);
}

async function load(ctx) {
  const list = $('#annList');
  if (!isLive(list)) return; // pengguna sudah berpindah halaman
  list.innerHTML = `<div class="card"><div class="card__body"><div class="empty">
      <span class="spinner spinner--dark"></span></div></div></div>`;

  try {
    const qs = state.filter ? `?status=${state.filter}` : '';
    const data = await api.get(`/api/owner/announcements${qs}`);
    state.announcements = data.announcements;
    state.targets = data.targets;
    state.categories = data.categories;
    state.summary = data.summary;
  } catch (err) {
    handleError(err);
    if (!isLive(list)) return;
    list.innerHTML = emptyState('⚠️', 'Gagal memuat pengumuman');
    return;
  }

  if (!isLive(list)) return;
  $('#annStats').innerHTML = `
    <div class="stat">
      <div class="stat__icon stat__icon--ok">📢</div>
      <div><div class="stat__label">Sudah Terbit</div><div class="stat__value">${state.summary.terbit}</div></div>
    </div>
    <div class="stat">
      <div class="stat__icon stat__icon--info">⏰</div>
      <div><div class="stat__label">Terjadwal</div><div class="stat__value">${state.summary.terjadwal}</div>
        <div class="stat__hint">Terbit otomatis sesuai waktu</div></div>
    </div>
    <div class="stat">
      <div class="stat__icon">👥</div>
      <div><div class="stat__label">Penerima Aktif</div>
        <div class="stat__value">${state.targets.find((t) => t.code === 'semua')?.recipientCount ?? 0}</div>
        <div class="stat__hint">${state.targets.filter((t) => t.code !== 'semua').map((t) => `${t.label.replace(' saja', '')}: ${t.recipientCount}`).join(' · ')}</div>
      </div>
    </div>`;

  if (!state.announcements.length) {
    list.innerHTML = `<div class="card"><div class="card__body">${emptyState(
      '📢', 'Belum ada pengumuman',
      'Klik "Pengumuman Baru" untuk mengirim informasi ke penyewa.'
    )}</div></div>`;
    return;
  }

  list.innerHTML = `<div class="col">${state.announcements.map(itemHtml).join('')}</div>`;

  $$('[data-act=readers]', list).forEach((b) =>
    b.addEventListener('click', () => openReaders(Number(b.dataset.id)))
  );
  $$('[data-act=edit-ann]', list).forEach((b) =>
    b.addEventListener('click', () => {
      const a = state.announcements.find((x) => x.id === Number(b.dataset.id));
      openForm(a, ctx);
    })
  );
  $$('[data-act=publish]', list).forEach((b) =>
    b.addEventListener('click', async (e) => {
      const a = state.announcements.find((x) => x.id === Number(b.dataset.id));
      const ok = await confirmDialog({
        title: 'Terbitkan sekarang?',
        message: `"${a.title}" akan langsung dikirim ke ${a.recipientCount} penyewa (${a.targetLabel}).`,
        confirmText: 'Ya, terbitkan',
      });
      if (!ok) return;
      const done = busy(e.currentTarget, 'Menerbitkan…');
      try {
        const res = await api.post(`/api/owner/announcements/${a.id}/publish`, {});
        toastOk(res.message);
        await load(ctx);
      } catch (err) { handleError(err); done(); }
    })
  );
  $$('[data-act=del-ann]', list).forEach((b) =>
    b.addEventListener('click', async () => {
      const a = state.announcements.find((x) => x.id === Number(b.dataset.id));
      const ok = await confirmDialog({
        title: 'Hapus pengumuman?',
        message: `"${a.title}" akan dihapus permanen.`,
        confirmText: 'Ya, hapus',
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await api.del(`/api/owner/announcements/${a.id}`);
        toastOk(res.message);
        await load(ctx);
      } catch (err) { handleError(err); }
    })
  );
}

function itemHtml(a) {
  const cat = state.categories.find((c) => c.code === a.category);
  const statusBadge =
    a.status === 'terbit' ? badge('Terbit', 'ok')
      : a.status === 'terjadwal' ? badge('Terjadwal', 'info')
        : badge('Arsip', 'muted');

  const readInfo = a.status === 'terbit' && a.recipientCount
    ? `<span>👁 ${a.readCount}/${a.recipientCount} sudah baca</span>` : '';

  return `
    <div class="ann-item ${a.isPinned ? 'ann-item--pinned' : ''}">
      <div class="ann-item__head">
        <div class="grow">
          <div class="ann-item__title">
            ${a.isPinned ? '<span title="Disematkan">📌</span>' : ''}
            ${cat ? `<span>${cat.icon}</span>` : ''}
            ${esc(a.title)}
          </div>
          <div class="ann-item__meta mt-1">
            <span>🎯 ${esc(a.targetLabel)} (${a.recipientCount} penyewa)</span>
            ${a.status === 'terjadwal'
      ? `<span>⏰ ${esc(tanggalJam(a.scheduledAt))} · ${esc(relatif(a.scheduledAt))}</span>`
      : `<span>📅 ${esc(tanggalJam(a.publishedAt || a.createdAt))}</span>`}
            ${a.sendWhatsapp ? '<span>📱 WhatsApp</span>' : ''}
            ${readInfo}
          </div>
        </div>
        ${statusBadge}
      </div>

      <div class="ann-item__body ann-item__body--clamp">${esc(a.body)}</div>

      <div class="row row--wrap" style="gap:7px">
        ${a.status === 'terbit'
      ? `<button class="btn btn--light btn--sm" data-act="readers" data-id="${a.id}">👁 Siapa yang baca</button>`
      : ''}
        ${a.status !== 'terbit'
      ? `<button class="btn btn--ok btn--sm" data-act="publish" data-id="${a.id}">🚀 Terbitkan Sekarang</button>`
      : ''}
        <button class="btn btn--light btn--sm" data-act="edit-ann" data-id="${a.id}">✏️ Edit</button>
        <button class="btn btn--light btn--sm" data-act="del-ann" data-id="${a.id}">🗑 Hapus</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------- form */

function openForm(ann, ctx) {
  const isEdit = Boolean(ann);
  const defaultSchedule = toLocalInput(new Date(Date.now() + 3600_000));

  const { root, close } = openModal({
    title: isEdit ? 'Edit Pengumuman' : 'Pengumuman Baru',
    subtitle: 'Pilih penerima lewat dropdown, lalu terbitkan langsung atau atur jadwalnya.',
    size: 'lg',
    body: `
      <form id="annForm" class="form">
        <div class="field">
          <label for="aTitle">Judul pengumuman *</label>
          <input type="text" id="aTitle" name="title" required maxlength="160"
                 value="${esc(ann?.title || '')}" placeholder="Perbaikan Pompa Air Lantai 2" />
        </div>

        <div class="form-grid">
          <!-- Dropdown target: semua / lantai 1 / lantai 2 / lantai 3 -->
          <div class="field">
            <label for="aTarget">Tampilkan untuk *</label>
            <select id="aTarget" name="target" required>
              ${state.targets
      .map(
        (t) => `<option value="${t.code}" ${(ann?.target || 'semua') === t.code ? 'selected' : ''}>
                          ${esc(t.label)} — ${t.recipientCount} penyewa
                        </option>`
      )
      .join('')}
            </select>
            <span class="field__hint">Hanya penyewa aktif yang menerima pengumuman.</span>
          </div>

          <div class="field">
            <label for="aCat">Kategori</label>
            <select id="aCat" name="category">
              ${state.categories
      .map((c) => `<option value="${c.code}" ${(ann?.category || 'informasi') === c.code ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`)
      .join('')}
            </select>
          </div>
        </div>

        <div class="field">
          <label for="aBody">Isi pengumuman *</label>
          <textarea id="aBody" name="body" rows="8" required
                    placeholder="Tulis isi pengumuman di sini…">${esc(ann?.body || '')}</textarea>
        </div>

        <!-- Penjadwalan -->
        <div class="card" style="box-shadow:none;background:var(--c-surface-2)">
          <div class="card__body">
            <label class="check mb-2">
              <input type="checkbox" id="aSchedule" ${ann?.status === 'terjadwal' ? 'checked' : ''} />
              <span class="check__text">
                <strong>Jadwalkan pengumuman</strong>
                <small>Bila tidak dicentang, pengumuman langsung terbit sekarang.</small>
              </span>
            </label>
            <div class="field" id="scheduleWrap" ${ann?.status === 'terjadwal' ? '' : 'hidden'}>
              <label for="aWhen">Waktu terbit</label>
              <input type="datetime-local" id="aWhen" name="scheduledAt"
                     value="${esc(ann?.scheduledAt ? toLocalInput(new Date(`${ann.scheduledAt.replace(' ', 'T')}Z`)) : defaultSchedule)}" />
              <span class="field__hint">Sistem memeriksa jadwal setiap 30 detik dan menerbitkan otomatis.</span>
            </div>
          </div>
        </div>

        <div class="row row--wrap" style="gap:18px">
          <label class="check">
            <input type="checkbox" name="isPinned" value="1" ${ann?.isPinned ? 'checked' : ''} />
            <span class="check__text"><strong>📌 Sematkan di atas</strong></span>
          </label>
          <label class="check">
            <input type="checkbox" name="sendWhatsapp" value="1" ${ann?.sendWhatsapp ? 'checked' : ''} />
            <span class="check__text"><strong>📱 Kirim juga via WhatsApp</strong></span>
          </label>
        </div>

        <p class="alert alert--error" id="annErr" hidden></p>
      </form>`,
    footer: `
      <button class="btn btn--light" data-close>Batal</button>
      <button class="btn btn--primary" id="saveAnn">${isEdit ? 'Simpan Perubahan' : 'Terbitkan / Jadwalkan'}</button>`,
  });

  const scheduleCb = root.querySelector('#aSchedule');
  const scheduleWrap = root.querySelector('#scheduleWrap');
  scheduleCb.addEventListener('change', () => { scheduleWrap.hidden = !scheduleCb.checked; });

  root.querySelector('#saveAnn').addEventListener('click', async (e) => {
    const form = root.querySelector('#annForm');
    if (!form.reportValidity()) return;

    const payload = Object.fromEntries(new FormData(form).entries());
    payload.isPinned = Boolean(form.querySelector('[name=isPinned]').checked);
    payload.sendWhatsapp = Boolean(form.querySelector('[name=sendWhatsapp]').checked);

    if (scheduleCb.checked) {
      if (!payload.scheduledAt) {
        showErr('Tentukan waktu terbit untuk pengumuman terjadwal.');
        return;
      }
      // Kirim sebagai ISO agar zona waktu benar.
      payload.scheduledAt = new Date(payload.scheduledAt).toISOString();
    } else {
      payload.scheduledAt = '';
      if (isEdit && ann.status === 'terjadwal') payload.status = 'terbit';
    }

    const done = busy(e.currentTarget, 'Menyimpan…');
    try {
      const res = isEdit
        ? await api.put(`/api/owner/announcements/${ann.id}`, payload)
        : await api.post('/api/owner/announcements', payload);
      close();
      toastOk(res.message);
      if (res.delivery?.waFailed) {
        setTimeout(
          () => toastOk(`WhatsApp: ${res.delivery.waSent} terkirim, ${res.delivery.waFailed} gagal.`, 'Info WhatsApp'),
          400
        );
      }
      await load(ctx);
    } catch (err) {
      showErr(err.message);
      done();
    }
  });

  function showErr(msg) {
    const box = root.querySelector('#annErr');
    box.textContent = msg;
    box.hidden = false;
  }
}

/* --------------------------------------------------------------- pembaca */

async function openReaders(id) {
  const { root } = openModal({
    title: 'Status Dibaca',
    subtitle: 'Daftar penyewa yang sudah dan belum membaca pengumuman ini.',
    body: '<div class="empty"><span class="spinner spinner--dark"></span></div>',
    footer: '<button class="btn btn--light" data-close>Tutup</button>',
  });

  try {
    const { readers, pending } = await api.get(`/api/owner/announcements/${id}/readers`);
    root.querySelector('.modal__body').innerHTML = `
      <h4>✅ Sudah dibaca (${readers.length})</h4>
      ${readers.length
      ? `<div class="col mb-2">${readers
        .map(
          (r) => `<div class="row row--between" style="padding:7px 0;border-bottom:1px solid var(--c-border)">
                  <div class="row">${roomChip(r.roomCode)}<strong style="font-size:.9rem">${esc(r.name)}</strong></div>
                  <small class="muted">${esc(relatif(r.readAt))}</small>
                </div>`
        )
        .join('')}</div>`
      : '<p class="muted">Belum ada yang membaca.</p>'}

      <h4 class="mt-3">⏳ Belum dibaca (${pending.length})</h4>
      ${pending.length
      ? `<div class="col">${pending
        .map(
          (r) => `<div class="row" style="padding:7px 0;border-bottom:1px solid var(--c-border)">
                  ${roomChip(r.roomCode)}<strong style="font-size:.9rem">${esc(r.name)}</strong>
                </div>`
        )
        .join('')}</div>`
      : '<p class="badge badge--ok">Semua penyewa sudah membaca 🎉</p>'}
    `;
  } catch (err) {
    handleError(err);
  }
}

/* Pengumuman (penyewa) — daftar pengumuman; yang terbaru muncul sebagai pop-up */

import {
  api, esc, tanggalJam, relatif, badge, emptyState, handleError,
  openModal, busy, toastOk, $, $$, isLive,
} from '../core.js';

const state = { data: null };

/** Pengumuman yang pop-up-nya sudah ditampilkan pada sesi ini. */
const shownPopups = () => {
  try { return new Set(JSON.parse(sessionStorage.getItem('komen:annPopup') || '[]')); } catch { return new Set(); }
};
const rememberPopup = (id) => {
  const s = shownPopups();
  s.add(id);
  sessionStorage.setItem('komen:annPopup', JSON.stringify([...s]));
};

export async function render(view, ctx) {
  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Pengumuman</h1>
        <p>Semua informasi dari pemilik kos, baik untuk seluruh penyewa maupun khusus lantai Anda.</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--light" id="readAll">✓ Tandai Semua Dibaca</button>
      </div>
    </div>
    <div id="annBody"></div>
  `;

  $('#readAll').addEventListener('click', async (e) => {
    const done = busy(e.currentTarget, 'Menyimpan…');
    try {
      await api.post('/api/tenant/announcements/read-all', {});
      toastOk('Semua pengumuman ditandai sudah dibaca.');
      await load(ctx);
      ctx.refreshBadges?.();
    } catch (err) { handleError(err); }
    done();
  });

  await load(ctx);

  // Pop-up untuk pengumuman terbaru yang belum dibaca.
  const focusId = ctx.params.get('id');
  if (focusId) {
    const target = state.data.announcements.find((a) => a.id === Number(focusId));
    if (target) openPopup(target, ctx, { isLatest: false });
  } else {
    maybePopup(ctx);
  }
}

async function load(ctx) {
  const body = $('#annBody');
  if (!isLive(body)) return; // pengguna sudah berpindah halaman
  body.innerHTML = '<div class="empty"><span class="spinner spinner--dark"></span></div>';

  try {
    state.data = await api.get('/api/tenant/announcements');
  } catch (err) {
    handleError(err);
    if (!isLive(body)) return;
    body.innerHTML = emptyState('⚠️', 'Gagal memuat pengumuman');
    return;
  }

  if (!isLive(body)) return;
  const { announcements, summary } = state.data;

  body.innerHTML = `
    ${summary.belumDibaca
      ? `<div class="alert alert--info mb-2">
           📢 Anda memiliki <strong>${summary.belumDibaca} pengumuman baru</strong> yang belum dibaca.
         </div>`
      : ''}

    <div class="card">
      <div class="card__head">
        <div><h3>Daftar Pengumuman</h3><p>${summary.total} pengumuman</p></div>
      </div>
      <div class="card__body">
        ${announcements.length
      ? `<div class="col">${announcements.map(itemHtml).join('')}</div>`
      : emptyState('📭', 'Belum ada pengumuman', 'Pengumuman dari pemilik kos akan tampil di sini.')}
      </div>
    </div>`;

  $$('[data-act=open-ann]', body).forEach((btn) =>
    btn.addEventListener('click', () => {
      const a = announcements.find((x) => x.id === Number(btn.dataset.id));
      openPopup(a, ctx, { isLatest: false });
    })
  );
}

function itemHtml(a) {
  return `
    <div class="ann-item ${a.isRead ? '' : 'ann-item--unread'} ${a.isPinned ? 'ann-item--pinned' : ''}">
      <div class="ann-item__head">
        <div class="grow">
          <div class="ann-item__title">
            ${a.isPinned ? '<span title="Disematkan">📌</span>' : ''}
            ${esc(a.title)}
            ${a.isRead ? '' : '<span class="badge badge--primary">Baru</span>'}
          </div>
          <div class="ann-item__meta mt-1">
            <span>📅 ${esc(tanggalJam(a.publishedAt))}</span>
            <span>🎯 ${esc(a.targetLabel)}</span>
            <span>✍️ ${esc(a.authorName || 'Pemilik Kos')}</span>
          </div>
        </div>
        ${badge(relatif(a.publishedAt), 'muted')}
      </div>

      <div class="ann-item__body ann-item__body--clamp">${esc(a.body)}</div>

      <div class="row">
        <button class="btn btn--light btn--sm" data-act="open-ann" data-id="${a.id}">Baca Selengkapnya</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ pop-up */

/** Tampilkan pop-up untuk pengumuman terbaru yang belum dibaca & belum dipopupkan. */
function maybePopup(ctx) {
  const latest = state.data.latestUnread;
  if (!latest) return;
  if (shownPopups().has(latest.id)) return;
  openPopup(latest, ctx, { isLatest: true });
}

function openPopup(a, ctx, { isLatest }) {
  if (!a) return;
  rememberPopup(a.id);

  const { root, close } = openModal({
    title: a.title,
    size: isLatest ? '' : 'lg',
    body: `
      <div class="ann-popup">
        ${isLatest ? '<span class="ann-popup__badge">📢 Pengumuman Terbaru</span>' : ''}
        <div class="ann-item__meta mb-2">
          <span>📅 ${esc(tanggalJam(a.publishedAt))}</span>
          <span>🎯 ${esc(a.targetLabel)}</span>
          <span>✍️ ${esc(a.authorName || 'Pemilik Kos')}</span>
        </div>
        <div class="ann-popup__body">${esc(a.body)}</div>
      </div>`,
    footer: `
      ${a.isRead
      ? '<button class="btn btn--primary" data-close>Tutup</button>'
      : `<button class="btn btn--light" data-close>Nanti Saja</button>
           <button class="btn btn--primary" id="markRead">✓ Mengerti, Tandai Dibaca</button>`}`,
  });

  root.querySelector('#markRead')?.addEventListener('click', async (e) => {
    const done = busy(e.currentTarget, 'Menyimpan…');
    try {
      await api.post(`/api/tenant/announcements/${a.id}/read`, {});
      close();
      await load(ctx);
      ctx.refreshBadges?.();
    } catch (err) { handleError(err); done(); }
  });
}

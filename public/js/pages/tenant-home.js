/* Beranda Penyewa — ringkasan + pintasan ke 4 fitur utama */

import {
  api, esc, rupiah, tanggal, relatif, roomChip, badge, emptyState, handleError, dueText,
} from '../core.js';

const FEATURES = [
  {
    path: '/penyewa/tagihan', icon: '💳', title: 'Tagihan Saya',
    desc: 'Lihat tagihan jatuh tempo maupun yang akan datang, lalu bayar dengan QRIS atau Virtual Account.',
  },
  {
    path: '/penyewa/lapor', icon: '🧰', title: 'Lapor Kerusakan',
    desc: 'Laporkan kerusakan di kamar atau area kos, lengkap dengan foto bukti.',
  },
  {
    path: '/penyewa/pengumuman', icon: '📢', title: 'Pengumuman',
    desc: 'Semua informasi dari pemilik kos. Pengumuman terbaru muncul sebagai pop-up.',
  },
  {
    path: '/penyewa/fasilitas', icon: '🏢', title: 'Fasilitas',
    desc: 'Fasilitas kos, denah lantai, serta laundry, minimarket, dan SPBU di sekitar.',
  },
];

export async function render(view, ctx) {
  let data;
  try {
    data = await api.get('/api/tenant/dashboard');
  } catch (err) {
    handleError(err);
    view.innerHTML = emptyState('⚠️', 'Gagal memuat beranda');
    return;
  }

  const s = data.stats;
  const jam = new Date().getHours();
  const sapaan = jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 18 ? 'Selamat sore' : 'Selamat malam';
  const nb = data.nextBill;

  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>${esc(sapaan)}, ${esc(ctx.user.name.split(' ')[0])} 👋</h1>
        <p>${esc(data.kost.name)} — ${esc(tanggal(new Date(), { withDay: true }))}</p>
      </div>
      <div class="page-head__actions">
        ${nb ? '<a class="btn btn--primary" href="#/penyewa/tagihan">💳 Bayar Tagihan</a>' : ''}
        <a class="btn btn--light" href="#/penyewa/lapor">🧰 Lapor Kerusakan</a>
      </div>
    </div>

    <!-- Kartu kamar & tagihan terdekat -->
    <section class="grid grid--2 mb-2">
      <div class="card">
        <div class="card__body">
          <div class="row row--between row--wrap" style="gap:14px">
            <div>
              <div class="stat__label">Kamar Saya</div>
              <div class="row mt-1" style="gap:10px">
                ${data.room
      ? `<span class="room-code" style="font-size:1.5rem;min-width:70px;padding:7px 13px">${esc(data.room.code)}</span>`
      : '<span class="badge badge--warn">Belum ditempatkan</span>'}
                <div>
                  ${data.room
      ? `<strong>Lantai ${data.room.floor} · Kamar ${String(data.room.number).padStart(2, '0')}</strong><br />
                       <small class="muted">${esc(data.room.priceLabel)} / bulan</small>`
      : '<small class="muted">Hubungi pemilik kos</small>'}
                </div>
              </div>
              <p class="muted mt-2" style="font-size:.82rem;margin:0">
                Mulai menyewa ${esc(data.checkInLabel)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__body">
          <div class="stat__label">Tagihan Terdekat</div>
          ${nb
      ? `<div class="row row--between row--wrap mt-1" style="gap:12px">
                 <div>
                   <div class="stat__value">${esc(nb.amountLabel)}</div>
                   <small class="soft">${esc(nb.title)} · ${esc(nb.periodLabel)}</small>
                 </div>
                 <div class="right">
                   ${badge(nb.statusLabel, nb.statusTone)}
                   <p class="${nb.daysToDue < 0 ? 'badge badge--bad mt-1' : 'muted mt-1'}" style="margin-bottom:0;font-size:.82rem">
                     ${esc(dueText(nb.daysToDue))}
                   </p>
                 </div>
               </div>
               <a class="btn btn--primary btn--block mt-2" href="#/penyewa/tagihan">Bayar Sekarang</a>`
      : `<div class="row mt-1" style="gap:10px">
                 <span style="font-size:2rem">🎉</span>
                 <div>
                   <strong>Tidak ada tagihan tertunggak</strong><br />
                   <small class="muted">Semua pembayaran Anda sudah lunas.</small>
                 </div>
               </div>`}
        </div>
      </div>
    </section>

    <!-- Statistik ringkas -->
    <section class="grid grid--4 mb-2">
      <div class="stat">
        <div class="stat__icon stat__icon--warn">💳</div>
        <div>
          <div class="stat__label">Total Belum Dibayar</div>
          <div class="stat__value stat__value--sm">${esc(s.totalBelumBayarLabel)}</div>
          <div class="stat__hint">${s.jumlahTerlambat ? `${s.jumlahTerlambat} tagihan terlambat` : 'Tidak ada keterlambatan'}</div>
        </div>
      </div>
      <div class="stat">
        <div class="stat__icon stat__icon--ok">✅</div>
        <div>
          <div class="stat__label">Tagihan Lunas</div>
          <div class="stat__value">${s.jumlahLunas}</div>
          <div class="stat__hint">Riwayat pembayaran</div>
        </div>
      </div>
      <div class="stat">
        <div class="stat__icon stat__icon--info">🧰</div>
        <div>
          <div class="stat__label">Laporan Saya</div>
          <div class="stat__value">${s.complaints.baru + s.complaints.diproses}</div>
          <div class="stat__hint">${s.complaints.selesai} selesai ditangani</div>
        </div>
      </div>
      <div class="stat">
        <div class="stat__icon">📢</div>
        <div>
          <div class="stat__label">Pengumuman Baru</div>
          <div class="stat__value">${s.belumDibacaPengumuman}</div>
          <div class="stat__hint">Belum dibaca</div>
        </div>
      </div>
    </section>

    <!-- Fitur -->
    <h2 class="mt-3 mb-1">Fitur Utama</h2>
    <section class="grid grid--cards mb-2">
      ${FEATURES.map((f) => featureCard(f, s)).join('')}
    </section>

    <!-- Pengumuman terakhir -->
    <div class="card">
      <div class="card__head">
        <div><h3>Pengumuman Terbaru</h3><p>Informasi dari pemilik kos</p></div>
        <a class="btn btn--light btn--sm" href="#/penyewa/pengumuman">Lihat semua</a>
      </div>
      <div class="card__body">
        ${data.announcements.length
      ? `<div class="col">${data.announcements
        .map(
          (a) => `
              <div class="ann-item ${a.isRead ? '' : 'ann-item--unread'}">
                <div class="ann-item__head">
                  <div class="ann-item__title">
                    ${a.isPinned ? '📌' : ''} ${esc(a.title)}
                    ${a.isRead ? '' : '<span class="badge badge--primary">Baru</span>'}
                  </div>
                  <small class="muted nowrap">${esc(relatif(a.publishedAt))}</small>
                </div>
                <div class="ann-item__body ann-item__body--clamp">${esc(a.body)}</div>
                <div class="ann-item__meta">
                  <span>🎯 ${esc(a.targetLabel)}</span>
                  <span>✍️ ${esc(a.authorName || 'Pemilik Kos')}</span>
                </div>
              </div>`
        )
        .join('')}</div>`
      : emptyState('📭', 'Belum ada pengumuman', 'Pengumuman dari pemilik kos akan tampil di sini.')}
      </div>
    </div>
  `;
}

function featureCard(f, s) {
  let meta = '';
  if (f.path === '/penyewa/tagihan') {
    meta = s.totalBelumBayar
      ? `<span class="badge badge--warn">${esc(s.totalBelumBayarLabel)} belum dibayar</span>`
      : '<span class="badge badge--ok">Semua lunas</span>';
  }
  if (f.path === '/penyewa/lapor') {
    const open = s.complaints.baru + s.complaints.diproses;
    meta = open
      ? `<span class="badge badge--info">${open} laporan diproses</span>`
      : '<span class="badge badge--muted">Tidak ada laporan aktif</span>';
  }
  if (f.path === '/penyewa/pengumuman') {
    meta = s.belumDibacaPengumuman
      ? `<span class="badge badge--primary">${s.belumDibacaPengumuman} belum dibaca</span>`
      : '<span class="badge badge--muted">Semua sudah dibaca</span>';
  }
  if (f.path === '/penyewa/fasilitas') {
    meta = '<span class="badge badge--muted">Fasilitas kos & tempat sekitar</span>';
  }

  return `
    <a class="feature-card" href="#${f.path}">
      <div class="feature-card__icon">${f.icon}</div>
      <h3>${esc(f.title)}</h3>
      <p>${esc(f.desc)}</p>
      <div class="feature-card__meta">${meta}</div>
    </a>`;
}

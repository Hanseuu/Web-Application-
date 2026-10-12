/* Beranda Pemilik Kos — ringkasan + pintasan ke 5 fitur utama */

import {
  api, esc, rupiah, tanggal, relatif, roomChip, badge, emptyState, handleError, dueText,
} from '../core.js';

const FEATURES = [
  {
    path: '/owner/penyewa', icon: '👥', title: 'Daftar Penyewa',
    desc: 'Lihat siapa yang sedang menghuni beserta nomor kamarnya, ubah data, atau mulai percakapan.',
  },
  {
    path: '/owner/denah', icon: '🗺️', title: 'Denah & Fasilitas',
    desc: 'Atur denah tiap lantai dan daftar fasilitas yang tampil di halaman penyewa.',
  },
  {
    path: '/owner/pengumuman', icon: '📢', title: 'Buat Pengumuman',
    desc: 'Kirim pengumuman ke semua penyewa atau per lantai, bisa langsung maupun terjadwal.',
  },
  {
    path: '/owner/komplain', icon: '🧰', title: 'Pusat Komplain',
    desc: 'Pantau laporan kerusakan dari status Baru, Sedang Diproses, hingga Selesai.',
  },
  {
    path: '/owner/keuangan', icon: '💰', title: 'Keuangan',
    desc: 'Terbitkan tagihan dan kirim pengingat lewat notifikasi web maupun WhatsApp.',
  },
];

export async function render(view, ctx) {
  let data;
  try {
    data = await api.get('/api/owner/dashboard');
  } catch (err) {
    handleError(err);
    view.innerHTML = emptyState('⚠️', 'Gagal memuat beranda');
    return;
  }

  const s = data.stats;
  const jam = new Date().getHours();
  const sapaan = jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 18 ? 'Selamat sore' : 'Selamat malam';

  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>${esc(sapaan)}, ${esc(ctx.user.name)} 👋</h1>
        <p>${esc(data.kost.name)} — ${esc(tanggal(new Date(), { withDay: true }))}</p>
      </div>
      <div class="page-head__actions">
        <a class="btn btn--light" href="#/owner/pengumuman">📢 Buat Pengumuman</a>
        <a class="btn btn--primary" href="#/owner/keuangan">💰 Kirim Tagihan</a>
      </div>
    </div>

    <!-- Ringkasan -->
    <section class="grid grid--4 mb-2">
      <div class="stat">
        <div class="stat__icon">👥</div>
        <div>
          <div class="stat__label">Penyewa Aktif</div>
          <div class="stat__value">${s.tenantsActive}<span class="muted" style="font-size:.9rem;font-weight:500"> / ${s.rooms} kamar</span></div>
          <div class="stat__hint">Hunian ${s.occupancyRate}%</div>
          <div class="progress mt-1"><div class="progress__bar ${s.occupancyRate > 80 ? 'progress__bar--ok' : ''}" style="width:${s.occupancyRate}%"></div></div>
        </div>
      </div>

      <div class="stat">
        <div class="stat__icon stat__icon--ok">💰</div>
        <div>
          <div class="stat__label">Masuk Bulan Ini</div>
          <div class="stat__value stat__value--sm">${esc(rupiah(s.finance.masukBulanIni))}</div>
          <div class="stat__hint">Dari tagihan yang sudah lunas</div>
        </div>
      </div>

      <div class="stat">
        <div class="stat__icon stat__icon--warn">📄</div>
        <div>
          <div class="stat__label">Piutang</div>
          <div class="stat__value stat__value--sm">${esc(rupiah(s.finance.piutang))}</div>
          <div class="stat__hint">${s.finance.jumlahTerlambat} tagihan terlambat</div>
        </div>
      </div>

      <div class="stat">
        <div class="stat__icon stat__icon--bad">🧰</div>
        <div>
          <div class="stat__label">Komplain Terbuka</div>
          <div class="stat__value">${s.complaints.baru + s.complaints.diproses}</div>
          <div class="stat__hint">${s.complaints.baru} baru · ${s.complaints.diproses} diproses</div>
        </div>
      </div>
    </section>

    <!-- Fitur utama -->
    <h2 class="mt-3 mb-1">Fitur Utama</h2>
    <section class="grid grid--cards mb-2">
      ${FEATURES.map((f) => featureCard(f, s)).join('')}
    </section>

    <!-- Baris bawah -->
    <section class="grid grid--2">
      <div class="card">
        <div class="card__head">
          <div>
            <h3>Laporan Perlu Ditangani</h3>
            <p>Komplain yang belum selesai</p>
          </div>
          <a class="btn btn--light btn--sm" href="#/owner/komplain">Lihat semua</a>
        </div>
        <div class="card__body card__body--flush">
          ${data.recentComplaints.length
      ? `<div class="table-wrap"><table class="table">
                <tbody>
                  ${data.recentComplaints
        .map(
          (c) => `
                      <tr>
                        <td>${roomChip(c.room_code)}</td>
                        <td>
                          <strong style="font-size:.9rem">${esc(c.title)}</strong><br />
                          <small class="muted">${esc(c.tenant_name)} · ${esc(relatif(c.created_at))}</small>
                        </td>
                        <td class="right">${badge(c.status === 'baru' ? 'Baru' : 'Diproses', c.status === 'baru' ? 'bad' : 'warn')}</td>
                      </tr>`
        )
        .join('')}
                </tbody></table></div>`
      : emptyState('✅', 'Tidak ada komplain terbuka', 'Semua laporan penyewa sudah selesai ditangani.')}
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <div>
            <h3>Jatuh Tempo 7 Hari ke Depan</h3>
            <p>Tagihan yang belum terbayar</p>
          </div>
          <a class="btn btn--light btn--sm" href="#/owner/keuangan">Kelola</a>
        </div>
        <div class="card__body card__body--flush">
          ${data.dueSoon.length
      ? `<div class="table-wrap"><table class="table">
                <tbody>
                  ${data.dueSoon
        .map(
          (b) => `
                      <tr>
                        <td>${roomChip(b.tenant.roomCode)}</td>
                        <td>
                          <strong style="font-size:.9rem">${esc(b.tenant.name)}</strong><br />
                          <small class="muted">${esc(b.title)} · ${esc(b.periodLabel)}</small>
                        </td>
                        <td class="right nowrap">
                          <strong>${esc(b.amountLabel)}</strong><br />
                          <small class="${b.daysToDue < 0 ? 'badge badge--bad' : 'muted'}">${esc(dueText(b.daysToDue))}</small>
                        </td>
                      </tr>`
        )
        .join('')}
                </tbody></table></div>`
      : emptyState('🎉', 'Tidak ada tagihan jatuh tempo', 'Semua pembayaran dalam kondisi lancar.')}
        </div>
      </div>
    </section>

    ${data.scheduledAnnouncements.length
      ? `<div class="card mt-2">
          <div class="card__head">
            <div>
              <h3>Pengumuman Terjadwal</h3>
              <p>Akan terbit otomatis sesuai jadwal</p>
            </div>
            <a class="btn btn--light btn--sm" href="#/owner/pengumuman">Kelola</a>
          </div>
          <div class="card__body">
            <div class="col">
              ${data.scheduledAnnouncements
        .map(
          (a) => `
                  <div class="row row--between" style="padding:9px 0;border-bottom:1px solid var(--c-border)">
                    <div class="grow">
                      <strong style="font-size:.9rem">${esc(a.title)}</strong><br />
                      <small class="muted">Target: ${esc(targetText(a.target))}</small>
                    </div>
                    <span class="badge badge--info">⏰ ${esc(relatif(a.scheduled_at))}</span>
                  </div>`
        )
        .join('')}
            </div>
          </div>
        </div>`
      : ''}
  `;
}

const targetText = (t) =>
  ({ semua: 'Semua penyewa', lantai_1: 'Lantai 1', lantai_2: 'Lantai 2', lantai_3: 'Lantai 3' }[t] || t);

function featureCard(f, s) {
  let meta = '';
  if (f.path === '/owner/penyewa') meta = `<span class="badge badge--primary">${s.tenantsActive} penyewa aktif</span>`;
  if (f.path === '/owner/komplain') {
    meta =
      (s.complaints.baru ? `<span class="badge badge--bad">${s.complaints.baru} baru</span>` : '') +
      (s.complaints.diproses ? `<span class="badge badge--warn">${s.complaints.diproses} diproses</span>` : '') ||
      '<span class="badge badge--ok">Semua selesai</span>';
  }
  if (f.path === '/owner/keuangan') {
    meta = s.finance.piutang
      ? `<span class="badge badge--warn">Piutang ${esc(rupiah(s.finance.piutang))}</span>`
      : '<span class="badge badge--ok">Tidak ada piutang</span>';
  }

  return `
    <a class="feature-card" href="#${f.path}">
      <div class="feature-card__icon">${f.icon}</div>
      <h3>${esc(f.title)}</h3>
      <p>${esc(f.desc)}</p>
      <div class="feature-card__meta">${meta}</div>
    </a>`;
}

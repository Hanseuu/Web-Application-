/* Profil — data akun, ubah profil, ganti password (menu "Profil" di kiri atas) */

import {
  api, esc, rupiah, tanggal, avatar, roomChip, handleError,
  busy, toastOk, openModal, $,
} from '../core.js';
import { requestPermission } from '../notifications.js';

export async function render(view, ctx) {
  const u = ctx.user;

  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Profil</h1>
        <p>Data akun Anda dan pengaturan keamanan.</p>
      </div>
    </div>

    <div class="profile-head">
      ${avatar(u.name, u.avatarColor, 'avatar--lg')}
      <div class="profile-head__text grow">
        <h2>${esc(u.name)}</h2>
        <p>${esc(u.email)}</p>
        <div class="profile-head__badges">
          <span class="badge">${u.role === 'owner' ? '🔑 Pemilik Kos' : '🛏️ Penyewa'}</span>
          ${u.roomCode ? `<span class="badge">🚪 Kamar ${esc(u.roomCode)}</span>` : ''}
          <span class="badge">${u.status === 'aktif' ? '✅ Aktif' : '⏸ Nonaktif'}</span>
        </div>
      </div>
    </div>

    <div class="grid grid--2">
      <!-- Informasi akun -->
      <div class="card">
        <div class="card__head">
          <div><h3>Informasi Akun</h3><p>Data yang tercatat di sistem</p></div>
        </div>
        <div class="card__body">
          <dl class="info-list" id="infoList"></dl>
        </div>
      </div>

      <!-- Pengaturan -->
      <div class="col">
        <div class="card">
          <div class="card__head">
            <div><h3>Ubah Data Profil</h3><p>Perbarui nama, email, dan kontak</p></div>
          </div>
          <div class="card__body">
            <form id="profileForm" class="form">
              <div class="field">
                <label for="pName">Nama lengkap</label>
                <input type="text" id="pName" name="name" value="${esc(u.name)}" required />
              </div>
              <div class="field">
                <label for="pEmail">Email</label>
                <input type="email" id="pEmail" name="email" value="${esc(u.email)}" required />
              </div>
              <div class="field">
                <label for="pPhone">Nomor WhatsApp</label>
                <input type="tel" id="pPhone" name="phone" value="${esc(u.phone || '')}"
                       placeholder="08123456789" />
                <span class="field__hint">Dipakai untuk menerima ${u.role === 'owner' ? 'notifikasi' : 'tagihan dan pengingat'} lewat WhatsApp.</span>
              </div>
              <div class="field">
                <label for="pJob">${u.role === 'owner' ? 'Jabatan' : 'Pekerjaan / aktivitas'}</label>
                <input type="text" id="pJob" name="occupation" value="${esc(u.occupation || '')}" />
              </div>
              ${u.role === 'tenant'
      ? `<div class="field">
                   <label for="pEmergency">Kontak darurat</label>
                   <input type="tel" id="pEmergency" name="emergencyContact"
                          value="${esc(u.emergencyContact || '')}" />
                 </div>`
      : ''}
              <p class="alert alert--error" id="profileErr" hidden></p>
              <button type="submit" class="btn btn--primary" id="saveProfile">Simpan Perubahan</button>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card__head">
            <div><h3>Keamanan &amp; Notifikasi</h3><p>Password dan izin notifikasi browser</p></div>
          </div>
          <div class="card__body">
            <div class="row row--between row--wrap mb-2" style="gap:12px">
              <div>
                <strong style="font-size:.92rem">Password</strong>
                <p class="muted" style="margin:2px 0 0;font-size:.84rem">
                  Ganti secara berkala untuk menjaga keamanan akun.
                </p>
              </div>
              <button class="btn btn--light" id="changePass">🔑 Ganti Password</button>
            </div>

            <hr class="divider" />

            <div class="row row--between row--wrap" style="gap:12px">
              <div>
                <strong style="font-size:.92rem">Notifikasi Web</strong>
                <p class="muted" style="margin:2px 0 0;font-size:.84rem" id="notifStatus">Memeriksa izin…</p>
              </div>
              <button class="btn btn--light" id="enableNotif">🔔 Aktifkan</button>
            </div>

            <hr class="divider" />

            <div class="row row--between row--wrap" style="gap:12px">
              <div>
                <strong style="font-size:.92rem">Keluar dari Aplikasi</strong>
                <p class="muted" style="margin:2px 0 0;font-size:.84rem">
                  Mengakhiri sesi login di perangkat ini.
                </p>
              </div>
              <button class="btn btn--danger" id="logoutProfile">⎋ Keluar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  renderInfo(u);
  updateNotifStatus();

  /* ------------------------------------------------------- simpan profil */
  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#profileErr');
    errBox.hidden = true;

    const done = busy($('#saveProfile'), 'Menyimpan…');
    try {
      const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
      const res = await api.put('/api/auth/profile', payload);

      // Perbarui cache profil & header.
      sessionStorage.setItem('komen:user', JSON.stringify(res.user));
      ctx.user = res.user;
      $('#userName').textContent = res.user.name;
      toastOk(res.message);
      renderInfo(res.user);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    }
    done();
  });

  /* ----------------------------------------------------- ganti password */
  $('#changePass').addEventListener('click', () => {
    const { root, close } = openModal({
      title: 'Ganti Password',
      subtitle: 'Sesi di perangkat lain akan otomatis dikeluarkan.',
      size: 'sm',
      body: `
        <form id="passForm" class="form">
          <div class="field">
            <label for="curPass">Password saat ini</label>
            <input type="password" id="curPass" name="currentPassword" required autocomplete="current-password" />
          </div>
          <div class="field">
            <label for="newPass">Password baru</label>
            <input type="password" id="newPass" name="newPassword" required minlength="6" autocomplete="new-password" />
            <span class="field__hint">Minimal 6 karakter.</span>
          </div>
          <div class="field">
            <label for="confPass">Ulangi password baru</label>
            <input type="password" id="confPass" required minlength="6" autocomplete="new-password" />
          </div>
          <p class="alert alert--error" id="passErr" hidden></p>
        </form>`,
      footer: `
        <button class="btn btn--light" data-close>Batal</button>
        <button class="btn btn--primary" id="savePass">Ganti Password</button>`,
    });

    root.querySelector('#savePass').addEventListener('click', async (e) => {
      const form = root.querySelector('#passForm');
      const errBox = root.querySelector('#passErr');
      errBox.hidden = true;
      if (!form.reportValidity()) return;

      if (form.querySelector('#newPass').value !== form.querySelector('#confPass').value) {
        errBox.textContent = 'Konfirmasi password baru tidak sama.';
        errBox.hidden = false;
        return;
      }

      const done = busy(e.currentTarget, 'Menyimpan…');
      try {
        const res = await api.put('/api/auth/password', {
          currentPassword: form.querySelector('#curPass').value,
          newPassword: form.querySelector('#newPass').value,
        });
        close();
        toastOk(res.message);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        done();
      }
    });
  });

  /* ------------------------------------------------------ izin notifikasi */
  $('#enableNotif').addEventListener('click', async () => {
    await requestPermission();
    updateNotifStatus();
  });

  $('#logoutProfile').addEventListener('click', () => $('#logoutBtn').click());
}

function renderInfo(u) {
  const rows = [
    ['Nama', u.name],
    ['Email', u.email],
    ['Peran', u.role === 'owner' ? 'Pemilik Kos' : 'Penyewa'],
    ['WhatsApp', u.phone || '—'],
    [u.role === 'owner' ? 'Jabatan' : 'Pekerjaan', u.occupation || '—'],
  ];

  if (u.role === 'tenant') {
    rows.push(
      ['Nomor Kamar', u.roomCode ? `${u.roomCode} (lantai ${u.roomFloor})` : 'Belum ditempatkan'],
      ['Harga Kamar', u.roomPrice ? `${rupiah(u.roomPrice)} / bulan` : '—'],
      ['Mulai Sewa', tanggal(u.checkInDate)],
      ['Kontak Darurat', u.emergencyContact || '—']
    );
  }
  rows.push(['Akun Dibuat', tanggal(u.createdAt)]);

  $('#infoList').innerHTML = rows
    .map(
      ([label, value]) => `
      <div class="info-row">
        <dt>${esc(label)}</dt>
        <dd>${label === 'Nomor Kamar' && u.roomCode ? roomChip(u.roomCode) : esc(value)}</dd>
      </div>`
    )
    .join('');
}

function updateNotifStatus() {
  const statusEl = $('#notifStatus');
  const btn = $('#enableNotif');
  if (!statusEl) return;

  if (!('Notification' in window)) {
    statusEl.textContent = 'Browser ini tidak mendukung notifikasi web.';
    btn.disabled = true;
    return;
  }

  const perm = Notification.permission;
  if (perm === 'granted') {
    statusEl.innerHTML = '✅ Aktif — Anda akan menerima notifikasi tagihan, pengumuman, dan pesan baru.';
    btn.disabled = true;
    btn.textContent = 'Sudah Aktif';
  } else if (perm === 'denied') {
    statusEl.innerHTML = '🚫 Diblokir — aktifkan lewat pengaturan izin situs di browser Anda.';
    btn.disabled = true;
  } else {
    statusEl.textContent = 'Belum diaktifkan. Klik "Aktifkan" untuk menerima notifikasi langsung dari browser.';
    btn.disabled = false;
  }
}

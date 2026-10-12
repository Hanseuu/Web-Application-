/* ==========================================================================
   Shell aplikasi: autentikasi, navigasi, router hash, notifikasi
   ========================================================================== */

import { api, esc, initials, $, $$, toast, handleError, confirmDialog } from './core.js';
import * as notif from './notifications.js';

/* ------------------------------------------------------------------- state */

export const app = {
  user: null,
  route: { path: '', params: new URLSearchParams() },
};

/* --------------------------------------------------------- definisi menu */

const MENUS = {
  owner: [
    { path: '/owner/beranda', icon: '🏠', label: 'Beranda' },
    { path: '/owner/penyewa', icon: '👥', label: 'Daftar Penyewa' },
    { path: '/owner/denah', icon: '🗺️', label: 'Denah & Fasilitas' },
    { path: '/owner/pengumuman', icon: '📢', label: 'Buat Pengumuman' },
    { path: '/owner/komplain', icon: '🧰', label: 'Pusat Komplain', badge: 'complaints' },
    { path: '/owner/keuangan', icon: '💰', label: 'Keuangan' },
  ],
  tenant: [
    { path: '/penyewa/beranda', icon: '🏠', label: 'Beranda' },
    { path: '/penyewa/tagihan', icon: '💳', label: 'Tagihan Saya', badge: 'bills' },
    { path: '/penyewa/lapor', icon: '🧰', label: 'Lapor Kerusakan' },
    { path: '/penyewa/pengumuman', icon: '📢', label: 'Pengumuman', badge: 'announcements' },
    { path: '/penyewa/fasilitas', icon: '🏢', label: 'Fasilitas' },
  ],
};

const HOME = { owner: '/owner/beranda', tenant: '/penyewa/beranda' };

/* ---------------------------------------------------------------- routing */

/** path -> loader modul halaman (lazy import agar awal muat tetap ringan). */
const ROUTES = {
  '/owner/beranda': () => import('./pages/owner-home.js'),
  '/owner/penyewa': () => import('./pages/owner-tenants.js'),
  '/owner/denah': () => import('./pages/owner-property.js'),
  '/owner/pengumuman': () => import('./pages/owner-announcements.js'),
  '/owner/komplain': () => import('./pages/owner-complaints.js'),
  '/owner/keuangan': () => import('./pages/owner-finance.js'),

  '/penyewa/beranda': () => import('./pages/tenant-home.js'),
  '/penyewa/tagihan': () => import('./pages/tenant-bills.js'),
  '/penyewa/lapor': () => import('./pages/tenant-report.js'),
  '/penyewa/pengumuman': () => import('./pages/tenant-announcements.js'),
  '/penyewa/fasilitas': () => import('./pages/tenant-facilities.js'),

  '/chat': () => import('./pages/chat.js'),
  '/profil': () => import('./pages/profile.js'),
};

/** Halaman yang hanya boleh diakses peran tertentu. */
const roleOf = (path) =>
  path.startsWith('/owner/') ? 'owner' : path.startsWith('/penyewa/') ? 'tenant' : null;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path.replace(/\/$/, '') || '/', params: new URLSearchParams(query) };
}

export function navigate(path) {
  location.hash = path.startsWith('#') ? path : `#${path}`;
}

let renderToken = 0;

async function renderRoute() {
  const view = $('#view');
  const { path, params } = parseHash();
  app.route = { path, params };

  // "/" -> beranda sesuai peran
  if (path === '/' || path === '') {
    navigate(HOME[app.user.role]);
    return;
  }

  const required = roleOf(path);
  if (required && required !== app.user.role) {
    view.innerHTML = `
      <div class="card"><div class="card__body">
        <div class="empty">
          <span class="empty__icon">🚫</span>
          <strong>Halaman ini bukan untuk peran Anda</strong>
          <p>Anda login sebagai ${app.user.role === 'owner' ? 'Pemilik Kos' : 'Penyewa'}.</p>
          <button class="btn btn--primary mt-2" id="goHome">Ke Beranda</button>
        </div>
      </div></div>`;
    $('#goHome').addEventListener('click', () => navigate(HOME[app.user.role]));
    highlightNav(path);
    return;
  }

  const loader = ROUTES[path];
  if (!loader) {
    view.innerHTML = `
      <div class="card"><div class="card__body">
        <div class="empty">
          <span class="empty__icon">🔍</span>
          <strong>Halaman tidak ditemukan</strong>
          <p><code>${esc(path)}</code> tidak tersedia.</p>
          <button class="btn btn--primary mt-2" id="goHome">Ke Beranda</button>
        </div>
      </div></div>`;
    $('#goHome').addEventListener('click', () => navigate(HOME[app.user.role]));
    highlightNav(path);
    return;
  }

  highlightNav(path);
  closeSidebar();
  notif.closePanel();

  const token = ++renderToken;
  view.innerHTML = `
    <div class="empty">
      <span class="spinner spinner--dark" style="width:26px;height:26px;border-width:3px"></span>
      <strong style="margin-top:12px">Memuat halaman…</strong>
    </div>`;

  try {
    const mod = await loader();
    if (token !== renderToken) return; // navigasi lain sudah menyusul
    view.scrollTop = 0;
    window.scrollTo({ top: 0 });
    await mod.render(view, { user: app.user, params, navigate, refreshBadges });
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    view.innerHTML = `
      <div class="card"><div class="card__body">
        <div class="empty">
          <span class="empty__icon">⚠️</span>
          <strong>Gagal memuat halaman</strong>
          <p>${esc(err?.message || 'Terjadi kesalahan tak terduga.')}</p>
          <button class="btn btn--light mt-2" id="retry">Coba lagi</button>
        </div>
      </div></div>`;
    $('#retry')?.addEventListener('click', renderRoute);
  }
}

/* ------------------------------------------------------- navigasi & badge */

function highlightNav(path) {
  // Sidebar
  $$('#sidebarNav .sidebar__link').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.path === path);
  });

  // Nav atas: Home / Chat / Profil
  const navKey = path === '/chat' ? 'chat' : path === '/profil' ? 'profil' : 'home';
  $$('#mainNav .mainnav__link').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.nav === navKey);
  });
}

function buildSidebar() {
  const nav = $('#sidebarNav');
  const menu = MENUS[app.user.role] || [];
  $('#sidebarTitle').textContent = app.user.role === 'owner' ? 'Menu Pemilik' : 'Menu Penyewa';

  nav.innerHTML = menu
    .map(
      (m) => `
      <a class="sidebar__link" href="#${m.path}" data-path="${m.path}">
        <span class="sidebar__icon">${m.icon}</span>
        <span class="grow">${esc(m.label)}</span>
        ${m.badge ? `<span class="pill-count" data-badge="${m.badge}" hidden>0</span>` : ''}
      </a>`
    )
    .join('');
}

/** Angka di samping menu (komplain baru / tagihan belum bayar / pengumuman). */
export async function refreshBadges() {
  try {
    if (app.user.role === 'owner') {
      const data = await api.get('/api/owner/dashboard');
      setBadge('complaints', data.stats.complaints.baru);
    } else {
      const data = await api.get('/api/tenant/dashboard');
      setBadge('bills', data.stats.jumlahTerlambat || 0);
      setBadge('announcements', data.stats.belumDibacaPengumuman || 0);
    }
  } catch { /* badge bersifat kosmetik */ }
}

function setBadge(key, value) {
  const el = $(`#sidebarNav [data-badge="${key}"]`);
  if (!el) return;
  el.textContent = String(value);
  el.hidden = !value;
}

/* ------------------------------------------------------------- UI sidebar */

const openSidebar = () => {
  $('#sidebar').classList.add('is-open');
  $('#backdrop').classList.add('is-open');
};
const closeSidebar = () => {
  $('#sidebar').classList.remove('is-open');
  $('#backdrop').classList.remove('is-open');
};

/* ---------------------------------------------------------------- header */

function renderUser() {
  const u = app.user;
  $('#userName').textContent = u.name;
  $('#userRole').textContent = u.role === 'owner'
    ? 'Pemilik Kos'
    : `Penyewa${u.roomCode ? ` · Kamar ${u.roomCode}` : ''}`;
  const av = $('#userAvatar');
  av.textContent = initials(u.name);
  av.style.background = u.avatarColor || '#2563eb';
  $('#brandLink').setAttribute('href', `#${HOME[u.role]}`);
}

async function logout() {
  const ok = await confirmDialog({
    title: 'Keluar dari aplikasi?',
    message: 'Anda perlu login kembali untuk mengakses Komen.',
    confirmText: 'Ya, keluar',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.post('/api/auth/logout', {});
  } catch { /* lanjutkan walau gagal */ }
  notif.stopPolling();
  sessionStorage.clear();
  location.replace('/index.html');
}

/* ------------------------------------------------------------------- init */

function bindShell() {
  $('#menuToggle').addEventListener('click', () => {
    const open = $('#sidebar').classList.contains('is-open');
    if (open) closeSidebar(); else openSidebar();
  });
  $('#backdrop').addEventListener('click', closeSidebar);
  $('#logoutBtn').addEventListener('click', logout);

  $('#notifToggle').addEventListener('click', async () => {
    notif.togglePanel();
    // Minta izin Web Notification pada interaksi pertama pengguna.
    if ('Notification' in window && Notification.permission === 'default') {
      await notif.requestPermission();
    }
  });
  $('#notifClose').addEventListener('click', notif.closePanel);
  $('#notifReadAll').addEventListener('click', notif.markAllRead);

  // Klik di luar panel notifikasi menutupnya.
  document.addEventListener('click', (e) => {
    const panel = $('#notifPanel');
    if (!panel.classList.contains('is-open')) return;
    if (panel.contains(e.target) || $('#notifToggle').contains(e.target)) return;
    notif.closePanel();
  });

  window.addEventListener('hashchange', renderRoute);
}

(async function init() {
  // Profil dari sessionStorage dipakai agar header tidak berkedip.
  const cached = sessionStorage.getItem('komen:user');
  if (cached) {
    try { app.user = JSON.parse(cached); } catch { /* abaikan */ }
  }

  try {
    const { user } = await api.get('/api/auth/me');
    app.user = user;
    sessionStorage.setItem('komen:user', JSON.stringify(user));
  } catch {
    location.replace('/index.html');
    return;
  }

  renderUser();
  buildSidebar();
  bindShell();

  try {
    const meta = await api.get('/api/auth/meta');
    $('#sidebarKost').textContent = meta.kost.name;
  } catch { /* opsional */ }

  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = HOME[app.user.role];
  }

  await renderRoute();
  refreshBadges();

  notif.startPolling({
    onChatCount: () => {
      // Perbarui badge menu saat ada aktivitas baru.
      refreshBadges();
    },
  });

  // Pengumuman baru untuk penyewa -> halaman pengumuman ikut menyegarkan diri.
  document.addEventListener('komen:notification', (e) => {
    if (e.detail?.type === 'announcement' && app.route.path === '/penyewa/pengumuman') {
      renderRoute();
    }
  });
}());

window.addEventListener('error', (e) => {
  console.error('[komen] uncaught', e.error || e.message);
});

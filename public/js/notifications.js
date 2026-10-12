/* ==========================================================================
   Pusat notifikasi: polling ke server, toast in-app, dan Web Notification
   ========================================================================== */

import { api, esc, relatif, toast, handleError, $ } from './core.js';

const POLL_MS = 15_000;

const ICONS = {
  info: 'ℹ️', success: '✅', error: '⚠️', warning: '🔔',
  bill: '💳', announcement: '📢', chat: '💬',
};

const state = {
  latestId: Number(sessionStorage.getItem('komen:notifLastId') || 0),
  unread: 0,
  chatUnread: 0,
  timer: null,
  firstRun: true,
  onChatCount: null,
};

/* ------------------------------------------------- Web Notification (OS) */

/**
 * Minta izin Web Notification. Dipanggil setelah interaksi pengguna
 * (klik ikon lonceng) agar tidak diblokir browser.
 */
export async function requestPermission() {
  if (!('Notification' in window)) {
    toast('Browser ini tidak mendukung notifikasi web.', { type: 'warn' });
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') {
    toast('Notifikasi diblokir. Aktifkan lewat pengaturan situs di browser Anda.', { type: 'warn', timeout: 6000 });
    return 'denied';
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    toast('Notifikasi web aktif. Anda akan diberi tahu untuk tagihan, pengumuman, dan pesan baru.', { type: 'ok', timeout: 5000 });
  }
  return result;
}

function showWebNotification(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const notif = new Notification(n.title, {
      body: n.body,
      tag: `komen-${n.id}`,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
    });
    notif.onclick = () => {
      window.focus();
      if (n.link) location.hash = n.link.replace(/^#/, '');
      notif.close();
    };
  } catch {
    /* beberapa browser melarang konstruktor Notification langsung */
  }
}

/* ---------------------------------------------------------------- polling */

async function poll() {
  try {
    const data = await api.get(`/api/notifications/poll?after=${state.latestId}`);

    state.unread = data.unread;
    state.chatUnread = data.chatUnread;
    renderBadges();
    state.onChatCount?.(data.chatUnread);

    // Pada polling pertama jangan tampilkan ulang notifikasi lama.
    if (state.firstRun) {
      state.firstRun = false;
      state.latestId = data.latestId;
      sessionStorage.setItem('komen:notifLastId', String(data.latestId));
      return;
    }

    for (const n of data.notifications || []) {
      toast(n.body, { type: toneOf(n.type), title: n.title, timeout: 6500 });
      showWebNotification(n);
      document.dispatchEvent(new CustomEvent('komen:notification', { detail: n }));
    }

    if (data.latestId > state.latestId) {
      state.latestId = data.latestId;
      sessionStorage.setItem('komen:notifLastId', String(data.latestId));
    }
  } catch (err) {
    // Polling gagal tidak perlu mengganggu pengguna (mis. koneksi sesaat hilang).
    if (err?.status === 401) stopPolling();
  }
}

const toneOf = (type) => {
  if (type === 'success') return 'ok';
  if (type === 'error') return 'error';
  if (type === 'warning' || type === 'bill') return 'warn';
  return 'info';
};

export function startPolling({ onChatCount } = {}) {
  state.onChatCount = onChatCount;
  state.firstRun = true;
  poll();
  stopPolling();
  state.timer = setInterval(poll, POLL_MS);

  // Segarkan segera saat tab kembali aktif.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poll();
  });
}

export function stopPolling() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/** Dipakai setelah aksi yang memicu notifikasi, agar badge langsung segar. */
export const refreshNow = () => poll();

/* ----------------------------------------------------------------- badges */

function renderBadges() {
  const notifBadge = $('#notifBadge');
  if (notifBadge) {
    notifBadge.textContent = state.unread > 99 ? '99+' : String(state.unread);
    notifBadge.hidden = state.unread === 0;
  }
  const chatBadge = $('#chatBadge');
  if (chatBadge) {
    chatBadge.textContent = state.chatUnread > 99 ? '99+' : String(state.chatUnread);
    chatBadge.hidden = state.chatUnread === 0;
  }
}

export const getChatUnread = () => state.chatUnread;

/* ------------------------------------------------------------ panel daftar */

export async function openPanel() {
  const panel = $('#notifPanel');
  const list = $('#notifList');
  panel.classList.add('is-open');
  list.innerHTML = '<div class="empty"><span class="spinner spinner--dark"></span></div>';

  try {
    const { notifications } = await api.get('/api/notifications?limit=30');

    if (!notifications.length) {
      list.innerHTML = `
        <div class="empty">
          <span class="empty__icon">🔔</span>
          <strong>Belum ada notifikasi</strong>
          <p>Notifikasi tagihan, pengumuman, laporan, dan pesan akan muncul di sini.</p>
        </div>`;
      return;
    }

    list.innerHTML = notifications
      .map(
        (n) => `
        <button class="notif-item ${n.is_read ? '' : 'is-unread'}" data-id="${n.id}" data-link="${esc(n.link || '')}">
          <span class="notif-item__icon">${ICONS[n.type] || 'ℹ️'}</span>
          <span class="notif-item__body">
            <strong>${esc(n.title)}</strong>
            <p>${esc(n.body)}</p>
            <time>${esc(relatif(n.created_at))}</time>
          </span>
        </button>`
      )
      .join('');

    list.querySelectorAll('.notif-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = Number(item.dataset.id);
        const link = item.dataset.link;
        item.classList.remove('is-unread');
        try {
          await api.post('/api/notifications/read', { ids: [id] });
          await poll();
        } catch { /* tidak kritis */ }
        if (link) {
          closePanel();
          location.hash = link.replace(/^#/, '');
        }
      });
    });
  } catch (err) {
    list.innerHTML = '<div class="empty"><strong>Gagal memuat notifikasi</strong></div>';
    handleError(err);
  }
}

export function closePanel() {
  $('#notifPanel')?.classList.remove('is-open');
}

export function togglePanel() {
  const panel = $('#notifPanel');
  if (panel.classList.contains('is-open')) closePanel();
  else openPanel();
}

export async function markAllRead() {
  try {
    await api.post('/api/notifications/read', {});
    await poll();
    await openPanel();
    toast('Semua notifikasi ditandai sudah dibaca.', { type: 'ok', timeout: 2500 });
  } catch (err) {
    handleError(err);
  }
}

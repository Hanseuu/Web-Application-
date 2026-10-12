/* ==========================================================================
   Komen — utilitas inti: API client, format, DOM, toast, modal
   ========================================================================== */

/* ------------------------------------------------------------- API client */

export class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request(method, url, body, { isForm = false } = {}) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  };

  if (body !== undefined && body !== null) {
    if (isForm) {
      opts.body = body; // FormData: biarkan browser menentukan Content-Type
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError(0, 'Tidak dapat menghubungi server. Periksa koneksi Anda.');
  }

  // 401 di luar halaman login berarti sesi berakhir.
  if (res.status === 401 && !url.includes('/auth/login')) {
    if (!location.pathname.endsWith('/index.html') && location.pathname !== '/') {
      sessionStorage.setItem('komen:expired', '1');
      location.replace('/index.html');
    }
    throw new ApiError(401, 'Sesi Anda berakhir. Silakan login kembali.');
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Permintaan gagal (HTTP ${res.status}).`, data);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url, body) => request('DELETE', url, body),
  postForm: (url, formData) => request('POST', url, formData, { isForm: true }),
  putForm: (url, formData) => request('PUT', url, formData, { isForm: true }),
};

/* ----------------------------------------------------------------- format */

export const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const rupiah = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Tanggal dari DB (UTC "YYYY-MM-DD HH:MM:SS") -> objek Date lokal. */
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  // Nilai dari SQLite tidak punya zona waktu; perlakukan sebagai UTC.
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}${s.length <= 10 ? 'T00:00:00Z' : 'Z'}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function tanggal(value, { withDay = false } = {}) {
  const d = parseDate(value);
  if (!d) return '-';
  const base = `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
  return withDay ? `${HARI[d.getDay()]}, ${base}` : base;
}

export function tanggalJam(value) {
  const d = parseDate(value);
  if (!d) return '-';
  const jam = String(d.getHours()).padStart(2, '0');
  const menit = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}, ${jam}.${menit}`;
}

export function jam(value) {
  const d = parseDate(value);
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}

export function periodeLabel(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m) return String(period || '-');
  return `${BULAN[m - 1]} ${y}`;
}

/** "3 menit lalu", "2 hari lalu", dst. */
export function relatif(value) {
  const d = parseDate(value);
  if (!d) return '-';
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  if (diff < 0) {
    const f = Math.abs(diff);
    if (f < 3600) return `dalam ${Math.max(1, Math.round(f / 60))} menit`;
    if (f < 86400) return `dalam ${Math.round(f / 3600)} jam`;
    return `dalam ${Math.round(f / 86400)} hari`;
  }
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.round(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.round(diff / 3600)} jam lalu`;
  if (diff < 2592000) return `${Math.round(diff / 86400)} hari lalu`;
  return tanggal(value);
}

/** Teks ramah untuk jatuh tempo berdasarkan selisih hari. */
export function dueText(days) {
  if (days === null || days === undefined) return '-';
  if (days < 0) return `Terlambat ${Math.abs(days)} hari`;
  if (days === 0) return 'Jatuh tempo hari ini';
  if (days === 1) return 'Jatuh tempo besok';
  return `${days} hari lagi`;
}

export const initials = (name) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export const avatar = (name, color, cls = '') =>
  `<span class="avatar ${cls}" style="background:${esc(color || '#2563eb')}">${esc(initials(name))}</span>`;

/** Kode kamar XYY; tampilkan placeholder bila penyewa belum punya kamar. */
export const roomChip = (code) =>
  code
    ? `<span class="room-code" title="Lantai ${esc(String(code)[0])}, kamar ${esc(String(code).slice(1))}">${esc(code)}</span>`
    : '<span class="room-code room-code--empty" title="Belum menempati kamar">—</span>';

export const badge = (text, tone = 'muted') =>
  `<span class="badge badge--${esc(tone)}">${esc(text)}</span>`;

/* -------------------------------------------------------------------- DOM */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Apakah elemen masih terpasang di DOM?
 * Dipakai sebelum menulis hasil request: pengguna bisa berpindah halaman
 * selagi permintaan berjalan, sehingga container-nya sudah tidak ada.
 */
export const isLive = (el) => Boolean(el && el.isConnected);

/** Bangun elemen dari string HTML. */
export function fromHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const emptyState = (icon, title, text = '') => `
  <div class="empty">
    <span class="empty__icon">${icon}</span>
    <strong>${esc(title)}</strong>
    ${text ? `<p>${esc(text)}</p>` : ''}
  </div>`;

export const skeleton = (rows = 3) =>
  Array.from({ length: rows })
    .map((_, i) => `<div class="skeleton skeleton--text" style="width:${[100, 85, 70, 92][i % 4]}%"></div>`)
    .join('');

/** Tampilkan state loading di sebuah container. */
export const showLoading = (container, label = 'Memuat data…') => {
  container.innerHTML = `
    <div class="empty">
      <span class="spinner spinner--dark" style="width:26px;height:26px;border-width:3px"></span>
      <strong style="margin-top:12px">${esc(label)}</strong>
    </div>`;
};

/** Tombol dengan indikator proses; mengembalikan fungsi untuk mengakhiri. */
export function busy(button, label = 'Memproses…') {
  if (!button) return () => {};
  const original = button.innerHTML;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span> ${esc(label)}`;
  return () => {
    button.disabled = wasDisabled;
    button.innerHTML = original;
  };
}

/* ------------------------------------------------------------------ toast */

const TOAST_ICONS = { ok: '✅', error: '⚠️', warn: '🔔', info: 'ℹ️' };

function toastLayer() {
  let layer = $('#toastLayer');
  if (!layer) {
    layer = fromHtml('<div class="toast-layer" id="toastLayer" aria-live="polite"></div>');
    document.body.appendChild(layer);
  }
  return layer;
}

export function toast(message, { type = 'info', title = '', timeout = 4200 } = {}) {
  const node = fromHtml(`
    <div class="toast toast--${esc(type)}" role="status">
      <span class="toast__icon">${TOAST_ICONS[type] || 'ℹ️'}</span>
      <div class="toast__body">
        ${title ? `<strong>${esc(title)}</strong>` : ''}
        <span>${esc(message)}</span>
      </div>
      <button class="toast__close" aria-label="Tutup">×</button>
    </div>`);

  const remove = () => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 200);
  };
  node.querySelector('.toast__close').addEventListener('click', remove);
  toastLayer().appendChild(node);
  if (timeout) setTimeout(remove, timeout);
  return remove;
}

export const toastOk = (msg, title = 'Berhasil') => toast(msg, { type: 'ok', title });
export const toastErr = (msg, title = 'Gagal') => toast(msg, { type: 'error', title, timeout: 6000 });

/** Tangani error API secara konsisten. */
export function handleError(err, fallback = 'Terjadi kesalahan.') {
  if (err instanceof ApiError && err.status === 401) return;
  console.error(err);
  toastErr(err?.message || fallback);
}

/* ------------------------------------------------------------------ modal */

function modalLayer() {
  let layer = $('#modalLayer');
  if (!layer) {
    layer = fromHtml('<div class="modal-layer" id="modalLayer" role="dialog" aria-modal="true"></div>');
    document.body.appendChild(layer);
  }
  return layer;
}

let activeModalClose = null;

/**
 * Buka modal.
 * @returns {{ root: HTMLElement, close: Function }}
 */
export function openModal({ title, subtitle = '', body, footer = '', size = '' }) {
  const layer = modalLayer();
  layer.innerHTML = `
    <div class="modal ${size ? `modal--${esc(size)}` : ''}">
      <div class="modal__head">
        <div>
          <h3>${esc(title)}</h3>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        <button class="modal__close" data-close aria-label="Tutup">×</button>
      </div>
      <div class="modal__body">${body}</div>
      ${footer ? `<div class="modal__foot">${footer}</div>` : ''}
    </div>`;
  layer.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  const close = () => {
    layer.classList.remove('is-open');
    layer.innerHTML = '';
    document.body.style.overflow = '';
    activeModalClose = null;
  };
  activeModalClose = close;

  layer.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  layer.onclick = (e) => { if (e.target === layer) close(); };

  const firstInput = layer.querySelector('input:not([type=hidden]), textarea, select');
  if (firstInput) setTimeout(() => firstInput.focus(), 60);

  return { root: layer.querySelector('.modal'), close };
}

export const closeModal = () => activeModalClose?.();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('.lightbox.is-open')) return closeLightbox();
    activeModalClose?.();
  }
});

/** Dialog konfirmasi berbasis Promise. */
export function confirmDialog({
  title = 'Konfirmasi',
  message,
  confirmText = 'Ya, lanjutkan',
  cancelText = 'Batal',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const { root, close } = openModal({
      title,
      size: 'sm',
      body: `<p style="margin:0">${esc(message)}</p>`,
      footer: `
        <button class="btn btn--light" data-act="no">${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="yes">${esc(confirmText)}</button>`,
    });
    root.querySelector('[data-act=no]').addEventListener('click', () => { close(); resolve(false); });
    root.querySelector('[data-act=yes]').addEventListener('click', () => { close(); resolve(true); });
  });
}

/* -------------------------------------------------------------- lightbox */

export function openLightbox(src) {
  let box = $('#lightbox');
  if (!box) {
    box = fromHtml(`
      <div class="lightbox" id="lightbox">
        <button class="lightbox__close" aria-label="Tutup">×</button>
        <img alt="Pratinjau gambar" />
      </div>`);
    document.body.appendChild(box);
    box.addEventListener('click', () => closeLightbox());
  }
  box.querySelector('img').src = src;
  box.classList.add('is-open');
}

export function closeLightbox() {
  $('#lightbox')?.classList.remove('is-open');
}

/** Aktifkan klik-untuk-perbesar pada semua gambar [data-zoom] di container. */
export function bindZoom(root = document) {
  root.querySelectorAll('[data-zoom]').forEach((img) => {
    if (img.dataset.zoomBound) return;
    img.dataset.zoomBound = '1';
    img.addEventListener('click', () => openLightbox(img.dataset.zoom || img.src));
  });
}

/* ------------------------------------------------------------------ utils */

export const debounce = (fn, ms = 320) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

/** Ambil nilai form sebagai objek biasa. */
export const formData = (form) => Object.fromEntries(new FormData(form).entries());

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Disalin ke clipboard.', { type: 'ok', timeout: 2000 });
    return true;
  } catch {
    // Fallback untuk konteks non-secure (http).
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy');
    ta.remove();
    toast(ok ? 'Disalin ke clipboard.' : 'Gagal menyalin, silakan salin manual.', { type: ok ? 'ok' : 'error', timeout: 2500 });
    return ok;
  }
}

/** Nilai untuk <input type="datetime-local"> dari Date lokal. */
export function toLocalInput(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const todayInput = () => new Date().toISOString().slice(0, 10);
export const monthInput = () => new Date().toISOString().slice(0, 7);

/** Hitung mundur sampai waktu tertentu; memanggil onTick setiap detik. */
export function countdown(targetValue, onTick, onDone) {
  const target = parseDate(targetValue);
  if (!target) return () => {};
  const tick = () => {
    const left = Math.floor((target.getTime() - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(id);
      onDone?.();
      return;
    }
    const m = Math.floor(left / 60);
    const s = left % 60;
    onTick(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, left);
  };
  const id = setInterval(tick, 1000);
  tick();
  return () => clearInterval(id);
}

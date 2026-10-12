/* Chat — percakapan owner <-> penyewa (menu "Chat" di navigasi kiri atas) */

import {
  api, esc, jam, tanggal, relatif, avatar, roomChip, emptyState, handleError,
  debounce, parseDate, $, $$,
} from '../core.js';

const state = {
  threads: [],
  partnerId: null,
  messages: [],
  search: '',
  timer: null,
  lastMessageId: 0,
};

export async function render(view, ctx) {
  stopPolling();

  view.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Chat</h1>
        <p>${ctx.user.role === 'owner'
      ? 'Percakapan langsung dengan setiap penyewa.'
      : 'Hubungi pemilik kos untuk pertanyaan atau keperluan lain.'}</p>
      </div>
    </div>

    <div class="chat-layout">
      <div class="chat-list">
        <div class="chat-list__head">
          <strong>${ctx.user.role === 'owner' ? 'Penyewa' : 'Kontak'}</strong>
          <span class="muted" id="threadCount" style="font-size:.8rem"></span>
        </div>
        ${ctx.user.role === 'owner'
      ? `<div class="chat-list__search">
             <input type="search" id="threadSearch" placeholder="Cari nama atau nomor kamar…" />
           </div>`
      : ''}
        <div class="chat-list__items" id="threadList">
          <div class="empty"><span class="spinner spinner--dark"></span></div>
        </div>
      </div>

      <div class="chat-panel" id="chatPanel">
        <div class="empty" style="margin:auto">
          <span class="empty__icon">💬</span>
          <strong>Pilih percakapan</strong>
          <p>Pilih kontak di sebelah kiri untuk mulai mengirim pesan.</p>
        </div>
      </div>
    </div>
  `;

  $('#threadSearch')?.addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderThreads(ctx);
  }, 220));

  await loadThreads(ctx);

  // Buka percakapan tertentu bila dirujuk dari halaman lain (?partner=12)
  const requested = Number(ctx.params.get('partner') || 0);
  const target = requested && state.threads.some((t) => t.partnerId === requested)
    ? requested
    : state.threads[0]?.partnerId;

  if (target) await openThread(target, ctx);

  // Hentikan polling saat meninggalkan halaman.
  window.addEventListener('hashchange', stopPolling, { once: true });
}

/* --------------------------------------------------------------- threads */

async function loadThreads(ctx) {
  try {
    const data = await api.get('/api/chat/threads');
    state.threads = data.threads;
    renderThreads(ctx);
  } catch (err) {
    handleError(err);
    $('#threadList').innerHTML = emptyState('⚠️', 'Gagal memuat percakapan');
  }
}

function renderThreads(ctx) {
  const list = $('#threadList');
  if (!list) return;

  const filtered = state.search
    ? state.threads.filter(
      (t) =>
        t.name.toLowerCase().includes(state.search) ||
        String(t.roomCode || '').toLowerCase().includes(state.search)
    )
    : state.threads;

  const countEl = $('#threadCount');
  if (countEl) countEl.textContent = `${filtered.length} kontak`;

  if (!filtered.length) {
    list.innerHTML = emptyState('🔍', 'Tidak ada kontak', 'Coba kata kunci lain.');
    return;
  }

  list.innerHTML = filtered
    .map(
      (t) => `
      <button class="chat-thread-item ${t.partnerId === state.partnerId ? 'is-active' : ''}" data-id="${t.partnerId}">
        ${avatar(t.name, t.avatarColor)}
        <span class="chat-thread-item__text">
          <strong>${esc(t.name)}</strong>
          <small>${t.lastMessage
        ? `${t.lastFromMe ? 'Anda: ' : ''}${esc(t.lastMessage)}`
        : 'Belum ada pesan'}</small>
        </span>
        <span class="chat-thread-item__side">
          ${t.roomCode ? roomChip(t.roomCode) : t.roleLabel ? `<small class="muted">${esc(t.roleLabel)}</small>` : ''}
          ${t.lastAt ? `<time>${esc(relatif(t.lastAt))}</time>` : ''}
          ${t.unread ? `<span class="pill-count">${t.unread}</span>` : ''}
        </span>
      </button>`
    )
    .join('');

  $$('.chat-thread-item', list).forEach((btn) =>
    btn.addEventListener('click', () => openThread(Number(btn.dataset.id), ctx))
  );
}

/* -------------------------------------------------------------- messages */

async function openThread(partnerId, ctx) {
  state.partnerId = partnerId;
  renderThreads(ctx);

  const panel = $('#chatPanel');
  panel.innerHTML = '<div class="empty" style="margin:auto"><span class="spinner spinner--dark"></span></div>';

  let data;
  try {
    data = await api.get(`/api/chat/messages/${partnerId}`);
  } catch (err) {
    handleError(err);
    panel.innerHTML = emptyState('⚠️', 'Gagal memuat pesan');
    return;
  }

  state.messages = data.messages;
  state.lastMessageId = data.messages.at(-1)?.id || 0;
  const p = data.partner;

  panel.innerHTML = `
    <div class="chat-panel__head">
      ${avatar(p.name, p.avatarColor)}
      <div class="grow">
        <strong style="font-size:.95rem">${esc(p.name)}</strong><br />
        <small class="muted">
          ${esc(p.roleLabel)}${p.roomCode ? ` · Kamar ${esc(p.roomCode)}` : ''}
        </small>
      </div>
      ${p.phone && ctx.user.role === 'owner'
      ? `<a class="btn btn--light btn--sm" href="https://wa.me/${esc(p.phone.replace(/\D/g, '').replace(/^0/, '62'))}"
             target="_blank" rel="noopener" title="Buka WhatsApp">📱 WhatsApp</a>`
      : ''}
    </div>

    <div class="chat-panel__messages" id="messageList"></div>

    <form class="chat-panel__form" id="chatForm">
      <textarea id="chatInput" rows="1" placeholder="Tulis pesan… (Enter untuk kirim)"
                maxlength="2000"></textarea>
      <button type="submit" class="btn btn--primary" id="sendBtn">Kirim</button>
    </form>`;

  renderMessages();

  const input = $('#chatInput');
  input.focus();

  // Textarea tumbuh otomatis; Enter mengirim, Shift+Enter baris baru.
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#chatForm').requestSubmit();
    }
  });

  $('#chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;

    const btn = $('#sendBtn');
    btn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    try {
      const res = await api.post('/api/chat/messages', { receiverId: partnerId, body });
      state.messages.push(res.message);
      state.lastMessageId = res.message.id;
      renderMessages();
      loadThreads(ctx);
    } catch (err) {
      handleError(err);
      input.value = body; // kembalikan teks agar tidak hilang
    }
    btn.disabled = false;
    input.focus();
  });

  startPolling(ctx);
  ctx.refreshBadges?.();
}

function renderMessages() {
  const list = $('#messageList');
  if (!list) return;

  if (!state.messages.length) {
    list.innerHTML = `
      <div class="empty" style="margin:auto">
        <span class="empty__icon">👋</span>
        <strong>Belum ada pesan</strong>
        <p>Kirim pesan pertama untuk memulai percakapan.</p>
      </div>`;
    return;
  }

  let lastDay = '';
  list.innerHTML = state.messages
    .map((m) => {
      const d = parseDate(m.createdAt);
      const day = d ? d.toDateString() : '';
      let separator = '';
      if (day !== lastDay) {
        lastDay = day;
        separator = `<div class="chat-day">${esc(dayLabel(d))}</div>`;
      }
      return `
        ${separator}
        <div class="bubble bubble--${m.fromMe ? 'out' : 'in'}">
          ${esc(m.body)}
          <span class="bubble__time">${esc(jam(m.createdAt))}${m.fromMe ? (m.readAt ? ' ✓✓' : ' ✓') : ''}</span>
        </div>`;
    })
    .join('');

  list.scrollTop = list.scrollHeight;
}

function dayLabel(date) {
  if (!date) return '';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hari ini';
  if (date.toDateString() === yesterday.toDateString()) return 'Kemarin';
  return tanggal(date, { withDay: true });
}

/* --------------------------------------------------------------- polling */

function startPolling(ctx) {
  stopPolling();
  state.timer = setInterval(async () => {
    if (!state.partnerId || document.visibilityState !== 'visible') return;
    try {
      const data = await api.get(`/api/chat/messages/${state.partnerId}`);
      const latest = data.messages.at(-1)?.id || 0;
      const changed =
        latest !== state.lastMessageId || data.messages.length !== state.messages.length;
      if (changed) {
        state.messages = data.messages;
        state.lastMessageId = latest;
        renderMessages();
        loadThreads(ctx);
      }
    } catch { /* abaikan kegagalan polling */ }
  }, 6000);
}

function stopPolling() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

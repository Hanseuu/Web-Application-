/* ==========================================================================
   Halaman login — pemilihan peran (Pemilik Kos / Penyewa) lalu autentikasi
   ========================================================================== */

const ROLE_LABELS = { owner: 'Pemilik Kos', tenant: 'Penyewa' };

const form = document.getElementById('loginForm');
const roleField = document.getElementById('roleField');
const roleLabel = document.getElementById('roleLabel');
const errorBox = document.getElementById('loginError');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const submitBtn = document.getElementById('loginSubmit');

/* ------------------------------------------------------------ pilih peran */

function setRole(role) {
  roleField.value = role;
  roleLabel.textContent = ROLE_LABELS[role] || role;
  document.querySelectorAll('.role-option').forEach((btn) => {
    const active = btn.dataset.role === role;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', String(active));
  });
  localStorage.setItem('komen:lastRole', role);
  hideError();
}

document.getElementById('rolePicker').addEventListener('click', (e) => {
  const btn = e.target.closest('.role-option');
  if (btn) setRole(btn.dataset.role);
});

/* ------------------------------------------------------------------ utils */

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}
function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

document.getElementById('togglePassword').addEventListener('click', (e) => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  e.currentTarget.textContent = show ? '🙈' : '👁';
  e.currentTarget.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
});

/* --------------------------------------------------------------- akun demo */

document.querySelectorAll('.demo-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    setRole(chip.dataset.demoRole);
    emailInput.value = chip.dataset.email;
    passwordInput.value = chip.dataset.password;
    passwordInput.focus();
  });
});

/* ------------------------------------------------------------------ submit */

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const role = roleField.value;

  if (!email || !password) {
    showError('Email dan password wajib diisi.');
    return;
  }

  const original = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Memproses…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, role }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showError(data.error || `Login gagal (HTTP ${res.status}).`);
      submitBtn.disabled = false;
      submitBtn.innerHTML = original;
      return;
    }

    // Simpan profil ringkas agar shell aplikasi bisa langsung render.
    sessionStorage.setItem('komen:user', JSON.stringify(data.user));
    location.replace(data.redirect || '/app.html');
  } catch (err) {
    showError('Tidak dapat menghubungi server. Coba lagi sesaat.');
    console.error(err);
    submitBtn.disabled = false;
    submitBtn.innerHTML = original;
  }
});

/* ------------------------------------------------------------------- init */

(async function init() {
  // Pesan bila pengguna dialihkan ke sini karena sesi berakhir.
  if (sessionStorage.getItem('komen:expired')) {
    sessionStorage.removeItem('komen:expired');
    showError('Sesi Anda sudah berakhir. Silakan login kembali.');
  }

  setRole(localStorage.getItem('komen:lastRole') || 'owner');

  // Info kos pada panel kiri.
  try {
    const res = await fetch('/api/auth/meta');
    if (res.ok) {
      const meta = await res.json();
      const info = document.getElementById('kostInfo');
      info.textContent = `${meta.kost.name} — ${meta.kost.address}`;
    }
  } catch {
    document.getElementById('kostInfo').textContent =
      'Kelola penyewa, tagihan, komplain, dan pengumuman dalam satu tempat.';
  }

  // Bila sesi masih valid, langsung masuk ke aplikasi.
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.ok) {
      const { user } = await res.json();
      sessionStorage.setItem('komen:user', JSON.stringify(user));
      location.replace(user.role === 'owner' ? '/app.html#/owner/beranda' : '/app.html#/penyewa/beranda');
    }
  } catch {
    /* belum login - biarkan form tampil */
  }
}());

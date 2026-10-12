# Web-Application-

Web Application for Venture — **Komen (Kos Manajemen)**.

---


Aplikasi web pengelolaan kos dengan database, dua peran pengguna (**pemilik kos** dan **penyewa**),
dan halaman beranda yang berbeda sesuai peran.

```
Node.js + Express 5  ·  SQLite (better-sqlite3)  ·  Frontend vanilla JS (tanpa build step)
```

## Menjalankan

```bash
npm install
cp .env.example .env     # opsional, aplikasi jalan dengan nilai default
npm start                # http://localhost:3000
```

Database dan data demo dibuat otomatis saat pertama kali dijalankan.

## Menayangkan online (gratis)

Cara tercepat mendapat URL publik **tanpa kartu kredit dan tanpa daftar akun** —
jalankan aplikasi, lalu buka terminal kedua:

```bash
cloudflared tunnel --url http://localhost:3000
```

Alamat `https://xxx.trycloudflare.com` yang muncul bisa langsung dibagikan.

Pilihan lain: **Back4app Containers** (gratis tanpa kartu, memakai
[`Dockerfile`](Dockerfile)) atau **Render** (sekali klik lewat
[`render.yaml`](render.yaml)).

Perbandingan lengkap beserta batasannya ada di **[DEPLOY.md](DEPLOY.md)**.

### Akun login

Halaman pertama adalah login, dan peran **wajib dipilih** di sana. Memilih peran yang tidak
sesuai dengan akun akan ditolak.

| Peran | Email | Password |
|---|---|---|
| Pemilik Kos (owner) | `owner@komen.id` | `owner123` |
| Penyewa (tenant) | `penyewa@komen.id` | `penyewa123` |
| Penyewa lain | `rizky.pratama@mail.com` | `penyewa123` |

Semua penyewa demo lain memakai password `penyewa123` dengan email berpola
`nama.belakang@mail.com` (lihat menu Daftar Penyewa).

### Perintah lain

```bash
npm run dev        # mode watch
npm run reset      # bangun ulang data demo dari nol
npm run smoke      # 121 pengujian API end-to-end
npm run browser    # 122 pengujian UI di Chromium headless + screenshot
```

---

## Nomor kamar (format XYY)

Kode kamar dibentuk dari **lantai + nomor kamar 2 digit**, maksimal **30 kamar per lantai**.
Nomor satu digit diberi awalan `0`.

| Lantai | Kamar | Kode |
|---|---|---|
| 1 | 5 | `105` |
| 2 | 12 | `212` |
| 3 | 30 | `330` |

Aturan ini dipusatkan di `buildRoomCode()` (`src/lib/helpers.js`) dan divalidasi di database,
sehingga lantai di luar 1–3 atau nomor kamar di atas 30 ditolak.

---

## Fitur

### Beranda Pemilik Kos — 5 fitur

| Fitur | Isi |
|---|---|
| **Daftar Penyewa** | Siapa yang sedang menghuni + nomor kamar (XYY), filter lantai/status, pencarian, edit & ganti nama, pindah kamar, reset password, tandai keluar, dan tombol chat langsung ke penyewa |
| **Denah & Fasilitas** | Edit denah per lantai (judul, keterangan, unggah gambar) + peta kamar otomatis dari data hunian; kelola fasilitas (foto, ikon, kategori, tampil/sembunyi) dan daftar tempat di sekitar kos. Semuanya tampil di halaman penyewa |
| **Buat Pengumuman** | Dropdown target: **Semua penyewa / Lantai 1 saja / Lantai 2 saja / Lantai 3 saja**; terbit langsung atau **dijadwalkan**; opsi sematkan dan kirim via WhatsApp; lihat siapa yang sudah membaca |
| **Pusat Komplain** | Papan tiga kolom **Baru · Sedang Diproses · Selesai**, foto bukti dari penyewa, riwayat penanganan, ubah status + catatan (opsional kabari lewat WhatsApp) |
| **Keuangan** | Terbitkan tagihan (semua / per lantai / pilih penyewa, bisa pakai harga kamar masing-masing), kirim pengingat satuan maupun massal lewat **notifikasi web + WhatsApp**, tandai lunas manual, riwayat transaksi, dan log bukti kirim WhatsApp |

### Beranda Penyewa — 4 fitur

| Fitur | Isi |
|---|---|
| **Tagihan Saya** | Tagihan jatuh tempo/terlambat dan yang akan datang; bayar lewat **QRIS** (kode QR dibuat server) atau **Virtual Account** BCA/BNI/Mandiri/BRI; status transaksi **berhasil / gagal** ditampilkan jelas beserta struk dan tombol coba lagi |
| **Lapor Kerusakan** | Laporkan kerusakan di kamar atau area kos dengan **lampiran foto** (maks. 5, pratinjau sebelum kirim). Foto langsung tampil di Pusat Komplain pemilik |
| **Pengumuman** | Semua pengumuman yang menyasar penyewa tersebut; yang **terbaru muncul sebagai pop-up** dan dapat ditandai sudah dibaca |
| **Fasilitas** | Fasilitas milik kos, denah lantai (kamar sendiri ditandai, nama penghuni lain disembunyikan), serta **laundry, minimarket, SPBU, apotek, ATM, masjid, dll di sekitar kos** — diklik akan membuka **Google Maps** |

### Navigasi kiri atas (kedua peran)

**Home · Chat · Profil** — tersedia di header pada setiap halaman.

- **Chat** — percakapan dua arah pemilik ↔ penyewa. Pemilik melihat daftar semua penyewa
  (dengan nomor kamar dan badge pesan belum dibaca), penyewa hanya punya satu percakapan
  dengan pemilik.
- **Profil** — data akun, ubah profil, ganti password, dan pengaturan izin notifikasi web.

---

## Notifikasi

Notifikasi disimpan di database, lalu di-*poll* browser setiap 15 detik dan ditampilkan sebagai
**toast in-app**, **lonceng di header**, serta **Web Notification** browser (izin diminta saat
pengguna pertama kali mengeklik ikon lonceng, atau dari halaman Profil).

Notifikasi dibuat otomatis untuk: tagihan baru, pengingat pembayaran, hasil pembayaran,
pengumuman terbit, laporan kerusakan baru, perubahan status laporan, dan pesan chat.

---

## Integrasi WhatsApp

Dikonfigurasi lewat `.env`. Setiap pengiriman selalu dicatat di tabel `wa_logs` dan bisa dilihat
pemilik pada **Keuangan → Log WhatsApp**.

| `WA_PROVIDER` | Perilaku |
|---|---|
| `mock` *(default)* | Tidak keluar ke internet; pesan dicatat lengkap sebagai simulasi. Cocok untuk demo |
| `fonnte` | Kirim via `api.fonnte.com` — isi `WA_TOKEN` dengan token device |
| `meta` | WhatsApp Cloud API — isi `WA_TOKEN` dan `WA_PHONE_ID` |

Kegagalan gateway tidak pernah membatalkan aksi utama: tagihan tetap terbit, dan kegagalan
kirim dilaporkan terpisah.

## Pembayaran (QRIS & Virtual Account)

| `PAYMENT_PROVIDER` | Perilaku |
|---|---|
| `mock` *(default)* | QRIS dibuat lokal sebagai payload **EMVCo** lengkap dengan CRC16 lalu dirender menjadi gambar QR; nomor VA dibuat dengan prefix bank. Hasil transaksi dapat dicoba lewat tombol simulasi **Berhasil/Gagal** di UI |
| `custom` | Pembuatan transaksi diteruskan ke `PAYMENT_API_URL`, gateway asli lalu memanggil webhook |

### Webhook

```
POST /api/webhooks/payment
x-komen-signature: <HMAC-SHA256 hex dari raw body, kunci PAYMENT_WEBHOOK_SECRET>

{ "reference": "KMN-2026-ABCD1234", "status": "berhasil" }
```

`status` menerima penamaan umum gateway (`success`, `paid`, `settlement`, `failed`, `expire`, …).
Endpoint bersifat **idempoten** — webhook yang terkirim ulang tidak menggandakan efek.
Transaksi yang melewati batas waktu otomatis ditandai kedaluwarsa, dan tagihannya kembali
berstatus belum dibayar.

---

## Struktur

```
komen/
├── src/
│   ├── server.js                   bootstrap Express, routing, error handler
│   ├── config.js                   konfigurasi + daftar metode bayar/target/status
│   ├── db.js                       koneksi SQLite + skema
│   ├── seed.js                     data demo (npm run reset)
│   ├── scheduler.js                tugas berkala tiap 30 detik
│   ├── lib/
│   │   ├── auth.js                 scrypt, sesi, middleware peran
│   │   ├── helpers.js              buildRoomCode (XYY), format tanggal & rupiah
│   │   ├── upload.js               unggah gambar (multer)
│   │   └── placeholder.js          generator PNG untuk gambar contoh
│   ├── services/
│   │   ├── notifications.js        notifikasi in-app
│   │   ├── whatsapp.js             gateway + template pesan
│   │   ├── payments.js             QRIS EMVCo, VA, webhook
│   │   ├── announcements.js        penerima per lantai + penerbitan
│   │   └── maps.js                 tautan Google Maps
│   └── routes/                     auth, owner.*, tenant.*, chat, notifications, webhooks
├── public/
│   ├── index.html                  halaman login (pilih peran)
│   ├── app.html                    shell aplikasi (nav Home/Chat/Profil)
│   ├── css/style.css
│   └── js/
│       ├── core.js                 API client, format, toast, modal
│       ├── app.js                  router hash + sidebar per peran
│       ├── notifications.js        polling + Web Notification
│       └── pages/                  12 modul halaman (lazy-loaded)
├── tests/
│   ├── smoke.js                    pengujian API end-to-end
│   └── browser.js                  pengujian UI (Chromium headless)
├── data/komen.db                   database SQLite
└── uploads/                        foto komplain, denah, fasilitas
```

### Tabel database

`rooms`, `users`, `sessions`, `floorplans`, `facilities`, `nearby_places`, `announcements`,
`announcement_reads`, `complaints`, `complaint_photos`, `complaint_updates`, `bills`,
`payments`, `messages`, `notifications`, `wa_logs`, `settings`.

### Tugas berkala (`src/scheduler.js`)

Setiap 30 detik: menerbitkan pengumuman yang jadwalnya tiba, menandai transaksi kedaluwarsa,
menandai tagihan lewat jatuh tempo menjadi *terlambat*, dan membersihkan sesi kedaluwarsa.

---

## Catatan keamanan

- Password di-hash dengan **scrypt** (modul `crypto` bawaan Node), bukan disimpan apa adanya.
- Sesi memakai token acak 32 byte pada cookie `httpOnly` + `sameSite=lax`
  (`secure` otomatis aktif saat `NODE_ENV=production`).
- Setiap endpoint dijaga middleware peran: penyewa tidak dapat mengakses area pemilik dan
  sebaliknya; penyewa hanya bisa membuka tagihan dan laporan miliknya sendiri.
- Pesan login dibuat seragam agar tidak membocorkan email mana yang terdaftar.
- Semua input pengguna di-*escape* sebelum dirender ke HTML, unggahan dibatasi tipe gambar
  dan ukuran 6 MB, serta path unggahan dijaga terhadap *path traversal*.
- Menonaktifkan penyewa langsung menghapus sesi aktifnya.

## Pengujian

```bash
npm run smoke     # 121 pemeriksaan API
npm run browser   # 122 pemeriksaan UI + screenshot ke .kiro/artifacts/screenshots/
```

Keduanya berjalan pada database sementara, jadi data Anda tidak tersentuh.
Pengujian UI juga menggagalkan build bila ada error JavaScript di konsol browser.

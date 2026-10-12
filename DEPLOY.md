# Deploy ke Render

Panduan menayangkan **Komen (Kos Manajemen)** di [Render](https://render.com) memakai
paket **Free** — tanpa biaya dan tanpa kartu kredit.

Repositori ini sudah berisi [`render.yaml`](render.yaml), sehingga Render dapat membuat
layanan beserta seluruh environment variable secara otomatis.

---

## Langkah deploy

1. Buka [Render Dashboard](https://dashboard.render.com) dan login.
2. Klik **New** → **Blueprint**.
3. Pilih repositori **`Web-Application-`**.
   Render otomatis menemukan `render.yaml` di akar repositori.
4. Periksa ringkasan yang tampil — seharusnya satu layanan web bernama **`komen`**
   dengan paket **Free**.
5. Klik **Apply**.

Build pertama memakan waktu sekitar 2–4 menit (`npm ci` + start). Setelah selesai,
Render memberi URL publik berbentuk:

```
https://komen-xxxx.onrender.com
```

Buka URL tersebut dan login dengan akun demo:

| Peran | Email | Password |
|---|---|---|
| Pemilik Kos | `owner@komen.id` | `owner123` |
| Penyewa | `penyewa@komen.id` | `penyewa123` |

Tidak ada langkah tambahan: database SQLite beserta data demo dibuat otomatis saat
aplikasi pertama kali berjalan.

> **Tips mencoba dua peran sekaligus:** buka pemilik di jendela biasa dan penyewa di
> jendela **Incognito/Private**, supaya kedua sesi login tidak saling menimpa.

---

## Yang perlu diketahui tentang paket Free

Semuanya berasal dari [dokumentasi resmi Render](https://render.com/docs/free) dan
sudah diperhitungkan dalam konfigurasi ini.

### 1. Layanan tidur setelah 15 menit

Tanpa kunjungan selama 15 menit, layanan dimatikan sementara. Kunjungan berikutnya
membangunkannya kembali dalam waktu sekitar **satu menit** — pengunjung melihat halaman
loading dari Render selama proses tersebut.

Jatah paket Free adalah **750 jam instance per bulan** per workspace, dan waktu tidur
tidak ikut terhitung. Untuk satu layanan, jatah ini tidak akan habis.

### 2. Data ter-reset secara berkala

Sistem berkas Render bersifat *ephemeral*: setiap kali layanan **deploy, restart, atau
tidur**, seluruh perubahan berkas hilang — termasuk database SQLite dan foto laporan
kerusakan yang diunggah penyewa. Paket Free **tidak bisa** memakai persistent disk.

Aplikasi ini menanganinya dengan baik: saat database kosong, data demo dibangun ulang
otomatis, jadi situs tidak pernah rusak — hanya kembali ke kondisi awal.

Artinya:

| | Paket Free |
|---|---|
| Mendemokan aplikasi | ✅ Sangat cocok |
| Dipakai kos sungguhan | ❌ Data penyewa akan hilang |

### 3. Penjadwalan pengumuman mengikuti waktu aktif

Tugas berkala (`src/scheduler.js`) hanya berjalan saat layanan hidup. Bila pengumuman
dijadwalkan pada jam 20.00 sementara layanan sedang tidur, pengumuman tersebut terbit
saat ada kunjungan berikutnya — bukan tepat pukul 20.00. Jadwal yang terlewat tidak
hilang, karena scheduler ikut dijalankan sekali setiap kali aplikasi start.

---

## Mengubah pengaturan

Semua nilai di bawah dapat diubah lewat **Render Dashboard → layanan `komen`
→ Environment**, tanpa perlu mengubah kode. Layanan otomatis restart setelah disimpan.

| Variabel | Default | Keterangan |
|---|---|---|
| `KOST_NAME` | `Kos Melati Residence` | Nama kos di header dan pesan |
| `KOST_ADDRESS` | `Jl. Melati No. 12, Yogyakarta` | Alamat kos |
| `KOST_LAT` / `KOST_LNG` | koordinat Yogyakarta | Titik acuan pencarian Google Maps |
| `SESSION_TTL_DAYS` | `7` | Masa aktif sesi login |
| `WA_PROVIDER` | `mock` | `mock` / `fonnte` / `meta` |
| `PAYMENT_PROVIDER` | `mock` | `mock` / `custom` |
| `PAYMENT_MERCHANT_NAME` | `KOS MELATI RESIDENCE` | Nama merchant pada QRIS |

### Mengaktifkan WhatsApp sungguhan

Secara default `WA_PROVIDER=mock`, artinya pesan **dicatat tetapi tidak dikirim** —
dapat dilihat pemilik di menu **Keuangan → Log WhatsApp**. Untuk mengirim sungguhan,
tambahkan di Environment:

- **Fonnte:** `WA_PROVIDER=fonnte` dan `WA_TOKEN=<token device Anda>`
- **WhatsApp Cloud API:** `WA_PROVIDER=meta`, `WA_TOKEN=<access token>`,
  `WA_PHONE_ID=<phone number id>`

Token sengaja tidak dicantumkan di `render.yaml` agar tidak pernah tersimpan di Git.

### Mengaktifkan payment gateway sungguhan

Default `PAYMENT_PROVIDER=mock` membuat QRIS dan Virtual Account secara lokal, dan
halaman Tagihan Saya menampilkan tombol **Simulasikan Berhasil/Gagal** untuk menguji
kedua alur. Untuk gateway nyata, set `PAYMENT_PROVIDER=custom` beserta
`PAYMENT_API_URL` dan `PAYMENT_API_KEY`, lalu arahkan webhook gateway ke:

```
POST https://<domain-anda>.onrender.com/api/webhooks/payment
```

Render sudah membuat `PAYMENT_WEBHOOK_SECRET` secara acak — nilainya dapat dilihat di
halaman Environment, dan dipakai gateway untuk menandatangani webhook
(`x-komen-signature`, HMAC-SHA256 dari raw body).

---

## Agar data tidak ter-reset

Dua pilihan, sesuai kebutuhan:

### Pilihan A — Naikkan paket Render + persistent disk

Paket berbayar dapat memasang disk permanen. Setelah disk dipasang
(misalnya pada `/var/data`), tambahkan environment variable berikut agar database dan
foto unggahan tersimpan di disk tersebut:

```
DB_PATH=/var/data/komen.db
UPLOAD_DIR=/var/data/uploads
```

Aplikasi sudah mendukung kedua variabel ini, jadi tidak ada perubahan kode.

### Pilihan B — Pindah ke VPS gratis permanen

[Oracle Cloud Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
menyediakan mesin virtual yang gratis selamanya dengan disk permanen dan selalu aktif
(tanpa tidur). Karena ini aplikasi Node biasa, caranya cukup `git clone`,
`npm ci --omit=dev`, lalu jalankan `npm start` di belakang reverse proxy.

---

## Pemecahan masalah

| Gejala | Penyebab & solusi |
|---|---|
| Kunjungan pertama lambat (±1 menit) | Normal pada paket Free: layanan sedang bangun dari tidur |
| Data penyewa/tagihan kembali ke semula | Normal pada paket Free: filesystem *ephemeral*. Lihat bagian "Agar data tidak ter-reset" |
| Foto laporan kerusakan hilang | Penyebab sama seperti di atas — foto tersimpan di disk |
| Build gagal pada `better-sqlite3` | Pastikan `NODE_VERSION=22` masih ada di Environment agar memakai binary siap pakai |
| Deploy tidak jalan setelah push | Periksa **Settings → Build & Deploy**; `autoDeployTrigger: commit` seharusnya aktif |
| Blueprint tidak terbaca | `render.yaml` harus berada di akar repositori pada branch yang dipilih Render |

Log lengkap tersedia di **Render Dashboard → layanan `komen` → Logs**.

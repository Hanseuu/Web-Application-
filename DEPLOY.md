# Panduan Menayangkan Komen

Beberapa cara menjalankan **Komen (Kos Manajemen)** agar bisa dibuka orang lain,
termasuk **tanpa kartu kredit**.

| Cara | Kartu kredit | Berapa lama URL hidup | Data bertahan | Cocok untuk |
|---|---|---|---|---|
| **A. Cloudflare Tunnel** | ❌ tidak perlu | Selama proses dijalankan (jam/hari) | ✅ ya | Demo, presentasi, uji coba bersama |
| **B. Back4app Containers** | ❌ tidak perlu | ⏱️ **60 menit per deploy**, lalu dihapus | ❌ ter-reset | Pratinjau singkat / uji platform |
| **C. Render** | ⚠️ sering diminta untuk verifikasi | Tidak terbatas (tidur saat sepi) | ❌ ter-reset | Link tetap sekali klik |
| **D. VPS / Oracle Always Free** | ✅ perlu (verifikasi) | Tidak terbatas, selalu aktif | ✅ ya | Dipakai kos sungguhan |

> **Penting:** paket gratis Back4app **bukan** hosting permanen — URL-nya sementara dan
> hanya hidup 60 menit per deploy (lihat bagian B). Untuk demo yang bertahan lama tanpa
> kartu kredit, pakai **cara A**.

Akun demo untuk semua cara di bawah:

| Peran | Email | Password |
|---|---|---|
| Pemilik Kos | `owner@komen.id` | `owner123` |
| Penyewa | `penyewa@komen.id` | `penyewa123` |

> **Tips:** buka pemilik di jendela biasa dan penyewa di jendela **Incognito**, supaya
> kedua sesi login tidak saling menimpa.

---

## A. Cloudflare Tunnel — tanpa kartu, tanpa daftar akun

Cara tercepat mendapat **URL HTTPS publik** dari komputer sendiri. Menurut
[dokumentasi Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/),
Quick Tunnel membuat alamat `trycloudflare.com` sementara **tanpa perlu akun Cloudflare
maupun domain**.

### Langkah

1. Pasang `cloudflared` — unduh dari
   [halaman rilis Cloudflare](https://github.com/cloudflare/cloudflared/releases)
   (Windows: `cloudflared-windows-amd64.exe`).

2. Jalankan aplikasi di satu terminal:

   ```bash
   npm install
   npm start                       # http://localhost:3000
   ```

3. Buka terminal **kedua**, lalu jalankan:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

4. `cloudflared` menampilkan URL seperti:

   ```
   https://nama-acak-anda.trycloudflare.com
   ```

   Bagikan URL itu — siapa pun bisa membukanya dari ponsel maupun komputer lain.

### Yang perlu diketahui

- URL **berhenti bekerja** saat proses `cloudflared` dihentikan atau komputer dimatikan.
- Nama host **berubah** setiap kali tunnel dijalankan ulang.
- Cloudflare tidak menjamin ketersediaan (*no uptime guarantee*), dan setiap Quick Tunnel
  menampung hingga 200 permintaan bersamaan.
- Komputer Anda yang melayani permintaan, jadi **semua fitur jalan penuh dan data
  tersimpan permanen** di database lokal.
- Siapa pun yang punya URL dapat mengaksesnya. Bila ingin membatasi, tambahkan
  `--allowed-mail email@anda.com` sehingga pengunjung harus memasukkan PIN sekali pakai
  yang dikirim ke email tersebut.

**Paling cocok untuk:** menunjukkan aplikasi saat presentasi atau meminta teman mencoba.

---

## B. Back4app Containers — tanpa kartu, link tetap

Back4app menyatakan paket container gratisnya dapat dipakai
[**tanpa kartu kredit**](https://www.back4app.com/pricing/container-as-a-service).
Aplikasi dibangun dari [`Dockerfile`](Dockerfile) yang sudah tersedia di repositori ini.

### Langkah

1. Buka [back4app.com](https://www.back4app.com) → **Sign up**.
   Paling praktis memakai tombol **Sign up with GitHub**, sehingga izin akses
   repositori langsung terpasang.

2. Di dashboard, klik **Build new app** → pilih **Containers as a Service**.

3. Klik **Import from GitHub** / **Connect GitHub**, lalu beri izin Back4app mengakses
   repositori. Karena repositori ini **publik**, cukup pilih `Web-Application-`.

4. Isi konfigurasi deploy:

   | Kolom | Nilai |
   |---|---|
   | Repository | `Hanseuu/Web-Application-` |
   | Branch | `main` |
   | Root directory | *(biarkan kosong — `Dockerfile` ada di akar)* |
   | Dockerfile path | `Dockerfile` *(biasanya terdeteksi otomatis)* |
   | Plan | **Free** |

   Environment variable **tidak wajib diisi** — semuanya sudah punya nilai bawaan.

5. Klik **Deploy**. Build pertama berlangsung beberapa menit; statusnya dapat dipantau
   di tab **Logs**.

6. Setelah status menjadi *ready*, aplikasi hidup di alamat seperti:

   ```
   https://nama-app-anda.b4a.run
   ```

   Buka alamat itu dan login memakai akun demo di atas.

### Mengapa `Dockerfile` ini sudah sesuai

Menurut dokumentasi Back4app, aplikasi harus
[mendengarkan port dari variabel `PORT`](https://www.back4app.com/docs-containers/run-an-express-container-app)
dan port tersebut harus
[di-`EXPOSE` pada Dockerfile](https://www.back4app.com/docs-containers/troubleshooting).
Keduanya sudah dipenuhi: aplikasi membaca `process.env.PORT` (lihat `src/config.js`)
dan `Dockerfile` berisi `ENV PORT=3000` beserta `EXPOSE 3000`. Bila Back4app
menyuntikkan nilai `PORT` yang berbeda, aplikasi otomatis mengikutinya.

### Menyesuaikan pengaturan (opsional)

Tambahkan environment variable di pengaturan aplikasi Back4app bila ingin mengubah
identitas kos atau mengaktifkan integrasi — misalnya:

```
KOST_NAME=Kos Hanseu Residence
KOST_ADDRESS=Jl. Contoh No. 1, Yogyakarta
```

Daftar lengkapnya ada di bagian [Pengaturan](#pengaturan).

### ⏱️ Batas 60 menit pada paket gratis — baca sebelum memakai

Paket gratis Back4app adalah **pratinjau**, bukan hosting permanen. Menurut
[pengukuran tim Back4app sendiri](https://www.back4app.com/blog/run-a-bot-webhook-or-cron-24-7-without-a-vps)
(diuji 15–16 September 2026):

- Dashboard menampilkan kartu **"Temporary URL Active — URL is temporary and will be
  live for 60 minutes"** begitu aplikasi hidup.
- Tepat **60 menit setelah deploy dimulai**, container **dihapus** (bukan ditidurkan):
  log menunjukkan `COOLING DOWN… → FINISHING CONTAINER… → DEPLOYMENT DESTROYED`.
  Setelah itu URL membalas `404`.
- **Waktu build ikut terhitung.** Build 4 menit menyisakan 56 menit masa hidup.
- **Deploy ulang memulai hitungan 60 menit yang baru** — jadi demo bisa dinyalakan lagi
  kapan pun, tetapi dengan URL baru.
- Halaman harga Back4app sendiri menyebut paket Free *"ideal for testing and learning
  about the platform"*.

Artinya: cocok untuk **menunjukkan aplikasi selama kurang dari satu jam**. Untuk demo
yang bertahan lebih lama tanpa biaya, pakai **[cara A — Cloudflare Tunnel](#a-cloudflare-tunnel--tanpa-kartu-tanpa-daftar-akun)**.
Untuk link permanen yang selalu hidup di Back4app, paket **Shared $5/bulan**
(0.5 CPU, 512 MB) tidak memiliki batas tersebut.

### Yang perlu diketahui

- **Sumber daya paket gratis:** 0.25 CPU dan **256 MB RAM**. Aplikasi ini terukur
  memakai **±110 MB saat idle dan ±128 MB setelah 500 permintaan**, jadi masih muat.
  `Dockerfile` juga membatasi heap Node (`--max-old-space-size=160`) supaya di container
  kecil Node memaksa garbage collection alih-alih di-OOM-kill.
- **Penyimpanan tidak permanen:** database SQLite dan foto unggahan ter-reset setiap
  container dibangun ulang. Aplikasi otomatis menyemai ulang data demo, jadi situs tetap
  berfungsi normal — hanya kembali ke kondisi awal.
- Setiap commit baru ke `main` memicu build ulang.
- Region paket gratis adalah **USA**, sehingga akses dari Indonesia terasa sedikit lebih
  lambat dibanding Cloudflare Tunnel yang berjalan di komputer sendiri.

---

## C. Render — Blueprint sekali klik

Repositori ini menyertakan [`render.yaml`](render.yaml), jadi Render dapat membuat
layanan beserta seluruh environment variable secara otomatis:

**Render Dashboard → New → Blueprint → pilih repositori ini → Apply.**

Build pertama ±2–4 menit, lalu aplikasi hidup di `https://komen-xxxx.onrender.com`.

### Soal kartu kredit

Paket workspace **Hobby** di Render tidak memiliki biaya bulanan dan dibuat otomatis
saat mendaftar ([dokumentasi Render](https://render.com/docs/teams)). Meski begitu,
Render dapat meminta metode pembayaran sebagai **verifikasi akun**. Bila Anda tidak
ingin memasukkan kartu, pakai **cara A atau B** di atas — tidak ada yang hilang, karena
aplikasinya sama.

### Batasan paket Free

Berdasarkan [dokumentasi Render](https://render.com/docs/free):

1. **Tidur setelah 15 menit** tanpa kunjungan; akses berikutnya perlu ±1 menit untuk
   bangun. Jatah 750 jam instance per bulan tidak akan habis untuk satu layanan.
2. **Sistem berkas *ephemeral*** dan paket Free tidak mendukung persistent disk —
   database SQLite dan foto unggahan hilang setiap deploy/restart/tidur. Aplikasi
   menyemai ulang data demo otomatis, jadi situs tidak pernah rusak.
3. **Pengumuman terjadwal** hanya diproses saat layanan hidup. Jadwal yang terlewat ikut
   diterbitkan saat aplikasi start berikutnya (lihat `src/scheduler.js`).

> Catatan: Render ikut mendeteksi `Dockerfile` bila layanan dibuat secara manual.
> Dengan alur **Blueprint**, `render.yaml` sudah menetapkan `runtime: node`,
> jadi tidak ada konflik.

---

## D. VPS atau Oracle Cloud Always Free — untuk pemakaian sungguhan

Bila kos sungguhan akan memakai aplikasi ini, data **tidak boleh** ter-reset. Pilih
mesin virtual dengan disk permanen:

- [Oracle Cloud Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
  — gratis selamanya selama akun aktif (kartu kredit hanya untuk verifikasi identitas)
- VPS berbayar murah (Hostinger, DigitalOcean, Contabo, dsb.)

Cara termudah memakai Docker:

```bash
git clone https://github.com/Hanseuu/Web-Application-.git
cd Web-Application-
docker build -t komen .
docker run -d --restart unless-stopped -p 80:3000 \
  -v komen-data:/data \
  -e DB_PATH=/data/komen.db \
  -e UPLOAD_DIR=/data/uploads \
  komen
```

Volume `komen-data` membuat database dan foto unggahan bertahan melewati restart
maupun pembaruan image.

Tanpa Docker juga bisa: `npm ci --omit=dev` lalu `npm start` di belakang reverse proxy
(Nginx/Caddy) memakai process manager seperti `pm2` atau unit `systemd`.

---

## Pengaturan

Semua variabel di bawah bersifat opsional — aplikasi berjalan dengan nilai bawaan.
Isi lewat dashboard platform atau berkas `.env` (lihat [`.env.example`](.env.example)).

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Biasanya diisi otomatis oleh platform |
| `KOST_NAME` | `Kos Melati Residence` | Nama kos di header dan pesan |
| `KOST_ADDRESS` | `Jl. Melati No. 12, Yogyakarta` | Alamat kos |
| `KOST_LAT` / `KOST_LNG` | koordinat Yogyakarta | Titik acuan pencarian Google Maps |
| `SESSION_TTL_DAYS` | `7` | Masa aktif sesi login |
| `DB_PATH` | `data/komen.db` | Lokasi database SQLite |
| `UPLOAD_DIR` | `uploads` | Lokasi foto laporan, denah, fasilitas |
| `WA_PROVIDER` | `mock` | `mock` / `fonnte` / `meta` |
| `PAYMENT_PROVIDER` | `mock` | `mock` / `custom` |
| `PAYMENT_MERCHANT_NAME` | `KOS MELATI RESIDENCE` | Nama merchant pada QRIS |

### Mengaktifkan WhatsApp sungguhan

Default `mock` berarti pesan **dicatat tetapi tidak dikirim** — dapat dilihat pemilik di
menu **Keuangan → Log WhatsApp**. Untuk mengirim sungguhan:

- **Fonnte:** `WA_PROVIDER=fonnte` dan `WA_TOKEN=<token device>`
- **WhatsApp Cloud API:** `WA_PROVIDER=meta`, `WA_TOKEN=<access token>`,
  `WA_PHONE_ID=<phone number id>`

Token sengaja tidak pernah disimpan di repositori.

### Mengaktifkan payment gateway sungguhan

Default `mock` membuat QRIS dan Virtual Account secara lokal, dan halaman Tagihan Saya
menyediakan tombol **Simulasikan Berhasil/Gagal** untuk menguji kedua alur. Untuk
gateway nyata: set `PAYMENT_PROVIDER=custom`, `PAYMENT_API_URL`, `PAYMENT_API_KEY`,
lalu arahkan webhook gateway ke:

```
POST https://<domain-anda>/api/webhooks/payment
```

Webhook diverifikasi dengan header `x-komen-signature` berisi HMAC-SHA256 dari raw body
memakai `PAYMENT_WEBHOOK_SECRET`.

---

## Pemecahan masalah

| Gejala | Penyebab & solusi |
|---|---|
| Kunjungan pertama lambat | Normal pada paket gratis: layanan sedang bangun dari tidur |
| Data penyewa/tagihan kembali ke semula | Penyimpanan tidak permanen pada paket gratis. Pakai cara A atau D |
| Foto laporan kerusakan hilang | Penyebab sama — foto tersimpan di disk |
| URL `trycloudflare.com` tidak bisa dibuka | Proses `cloudflared` atau `npm start` sudah berhenti; jalankan ulang keduanya |
| Build gagal pada `better-sqlite3` | Pakai Node 20+ (`NODE_VERSION=22` pada Render; `Dockerfile` sudah memakai `node:22-slim`) |
| Halaman login muncul terus setelah login | Cookie sesi butuh HTTPS saat `NODE_ENV=production`. Semua cara di atas sudah memakai HTTPS |

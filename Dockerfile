# ---------------------------------------------------------------------------
# Image produksi untuk Komen (Kos Manajemen)
#
# Dipakai oleh platform berbasis container (Back4app Containers, Koyeb,
# Oracle Cloud, VPS, dsb). Untuk Render, konfigurasi di render.yaml sudah
# memakai runtime "node" sehingga Dockerfile ini tidak diperlukan.
#
# Build & jalankan secara lokal:
#   docker build -t komen .
#   docker run -p 3000:3000 komen
#
# Data permanen (opsional) — pasang volume ke /data:
#   docker run -p 3000:3000 \
#     -v komen-data:/data \
#     -e DB_PATH=/data/komen.db \
#     -e UPLOAD_DIR=/data/uploads \
#     komen
# ---------------------------------------------------------------------------

# Varian "slim" (Debian/glibc) dipilih, bukan Alpine, supaya better-sqlite3
# memakai binary siap pakai dan tidak perlu dikompilasi saat build.
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Dependensi di-install lebih dulu agar lapisan ini bisa dipakai ulang
# (cache) selama package-lock.json tidak berubah.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Kode aplikasi. Folder tests/ sengaja tidak disertakan di image produksi.
COPY src ./src
COPY public ./public

# Folder data & unggahan dibuat dan dimiliki user "node" (non-root).
RUN mkdir -p /app/data /app/uploads /data \
    && chown -R node:node /app /data

USER node

EXPOSE 3000

# Endpoint health check yang sama dipakai platform untuk memantau container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]

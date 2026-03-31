# Admin Navigation (Data Baru)

Panduan cepat ini menjelaskan perilaku admin setelah update incremental + fast winners.

## 1) Alur Load per Halaman

- **Dashboard / Entries / Recharges / Results**
  - Load awal ambil data terbaru (page pertama) + summary global.
  - Data lama diambil **on-demand** saat paging/filter butuh.
  - Jadi normal kalau tidak langsung tarik semua historical.

- **Winners**
  - Prioritas ambil dari endpoint cepat: `/api/admin/winners.json`.
  - Tidak lagi pakai sweep background panjang kalau endpoint cepat gagal.
  - Jika endpoint gagal, tabel tampilkan error jelas (bukan loading muter terus).

## 2) Cara Pakai Winners

1. Buka tab **Winners**.
2. Lihat daftar winner terbaru dulu (latest concurso ditandai badge).
3. Klik tombol **Details** di row winner.
4. Modal menampilkan:
   - Ringkasan tiket (valid/invalid/pending/unknown)
   - Ringkasan recharge
   - Scan WhatsApp multi-game ID

## 3) Arti Status UI

- `Updated (latest loaded: ...)`
  - Data terbaru sudah kebaca, historical belum full (normal).

- `Updated (all data loaded)`
  - Semua page dataset sudah kebaca penuh.

- `Winners fast endpoint unavailable...`
  - Endpoint winners di worker gagal/versi lama.
  - Solusi: deploy worker terbaru lalu refresh admin.

## 4) Error yang Paling Umum

- **`Too many subrequests` (500) di `/api/admin/winners.json`**
  - Worker staging masih versi lama atau query terlalu berat.
  - Deploy worker terbaru yang sudah pakai bounded window fetch.

- **`Missing platform or game_id` (400) di `/api/admin/winner-profile.json`**
  - Frontend lama masih kirim query tanpa param detail.
  - Pastikan file `admin/api.js` terbaru sudah ter-deploy.

## 5) Checklist Setelah Deploy

1. Hard refresh browser (`Ctrl+F5`).
2. Login ulang admin.
3. Buka Winners:
   - list muncul tanpa loading panjang
   - klik Details tidak error
4. Cek console:
   - tidak ada 500 `Too many subrequests`
   - tidak ada 400 `Missing platform or game_id`

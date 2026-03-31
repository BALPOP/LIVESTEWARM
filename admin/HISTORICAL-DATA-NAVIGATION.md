# Historical Data Page - Navigation & Feature Guide

Dokumen ini menjelaskan cara pakai halaman **Historical** di Admin dashboard.

## Tujuan halaman
Halaman ini dipakai untuk analisis data tiket lama (historical archive) dari Google Sheet bulanan:
- Dec 2025
- Jan 2026
- Feb 2026
- Mar 2026 (boleh kosong, tetap aman)

Semua filter tanggal mengikuti tanggal data arsip berbasis **waktu Brazil**.

---

## 1. Cara akses
1. Login ke admin.
2. Klik menu **Historical** di sidebar.
3. Klik **Load Historical Data** kalau data belum diload / mau refresh.

---

## 2. Loading state (anti-kira bug)
Saat loading, akan muncul panel:
- status teks proses (bulan yang sedang diproses),
- progress bar persentase,
- update per bulan (misal: `Jan 2026 loaded (xxxx rows)`).

Jadi user tahu sistem sedang jalan, bukan nge-freeze.

---

## 3. Filter yang tersedia

## 3.1 Month
- All Months
- Dec 2025
- Jan 2026
- Feb 2026
- Mar 2026

## 3.2 Date range (Brazil)
- **Date From**
- **Date To**

> Dipakai untuk fokus ke range tertentu lintas bulan.

## 3.3 Platform
- All Platforms
- POPN1
- POPLUZ

## 3.4 Game ID
- Search parsial berdasarkan Game ID.

## Tombol
- **Apply Filters**: terapkan filter sekarang.
- **Clear Filters**: reset semua filter ke default.

---

## 4. Kartu statistik utama (top summary)
Setelah filter diterapkan, kartu ini otomatis update:
- Total Historical Tickets
- Unique Game IDs
- POPN1 Tickets
- POPLUZ Tickets
- VALID Tickets
- INVALID Tickets
- PENDING Tickets

---

## 5. Grafik yang tersedia

## 5.1 Tickets per Month (Line chart)
Menampilkan total tiket per bulan sesuai filter aktif.

## 5.2 Status Breakdown per Month (Stacked bar)
Menampilkan komposisi:
- VALID
- INVALID
- PENDING
per bulan, sesuai filter aktif.

---

## 6. Top generators analysis
Section **Most VALID Tickets by Game ID**:
- ranking Game ID + platform,
- urut berdasarkan jumlah tiket VALID terbanyak,
- menampilkan:
  - Total Tickets
  - VALID
  - INVALID
  - PENDING

Cocok untuk lihat siapa user paling aktif dan kualitas tiketnya.

---

## 7. Monthly summary table
Tabel ringkasan bulanan menampilkan:
- Month
- Total Tickets
- POPN1
- POPLUZ
- VALID
- INVALID
- PENDING
- Unique Game IDs

---

## 8. Alur pakai yang disarankan
1. Load data dulu.
2. Mulai dari **All Months** untuk lihat baseline.
3. Filter ke platform (POPN1 / POPLUZ) untuk analisis channel.
4. Pakai date range untuk investigasi event/periode tertentu.
5. Cek top generators untuk identifikasi akun paling banyak kirim tiket VALID.
6. Drill-down via Game ID search.

---

## 9. Catatan operasional
- Jika sheet bulan tertentu kosong, data tetap aman (count = 0).
- Jika sheet tidak bisa dibaca publik, akan muncul error loading.
- Refresh historical tidak mengubah data operasional utama; ini read-only analytics.

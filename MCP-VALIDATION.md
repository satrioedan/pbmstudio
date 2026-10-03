# Hasil validasi

Tanggal: 6 September 2026. Node.js v24.19.0.
SDK MCP 1.27.1, Express 5.2.1, Zod 3.25.76; versi terkunci di package-lock.json.

## Tes otomatis dalam paket

`npm run test:mcp` menggunakan server lokal sementara dan MCP client dari SDK resmi.

- Akses tanpa token ditolak dan mengiklankan metadata OAuth.
- Callback yang tidak terdaftar ditolak.
- Login memerlukan cookie CSRF dan kode akses pemilik.
- PKCE S256 dan resource/audience diperiksa.
- Authorization code sekali pakai.
- Daftar 10 tool dapat ditemukan dan tool baca bisa dipanggil.
- Dua permintaan tulis identik yang bersamaan hanya menjalankan efek samping sekali.
- ID permintaan yang sama dengan argumen berbeda ditolak.
- Operasi tanpa confirmed=true ditolak.
- Field owner dan identitas kunci tidak masuk hasil MCP.
- Origin asing ditolak.
- Refresh token dirotasi; peningkatan scope ditolak; token read-only tidak dapat menulis.
- Pencabutan grant membatalkan token keluarga yang terkait.
- Jurnal bertahan saat modul dibuat ulang; hasil yang tidak pasti tidak dicoba ulang.

## Uji backend asli dari unggahan

Salinan terisolasi dibuat tanpa .env, data.json, backup, dan log unggahan. Backend dijalankan dengan PROVIDER_MOCK=true, pemilik uji, dan jurnal baru. OAuth dan MCP client SDK digunakan untuk menjalankan:

- list_models dan get_credits;
- generate_lyrics;
- create_song → get_job_status → success;
- list_tracks dan set_track_liked;
- remix_audio dan separate_stems;
- penolakan convert_to_wav untuk lagu APIframe;
- pengurangan total 33 kredit simulasi untuk generate + remix + stem;
- hasil yang sama terlihat melalui REST untuk pemilik uji, dan tidak terlihat ketika memakai ID pemilik uji lain.

Semua pemeriksaan di atas lulus. Tidak memakai kredit nyata atau API key unggahan.

## Belum diverifikasi

Deploy/restart pada hosting ulas.tech, HTTPS dan reverse proxy produksi, login melalui UI ChatGPT, callback spesifik akun pengguna, ketersediaan model/biaya nyata, kualitas audio provider, serta konversi WAV sukses dengan provider nyata. Perlu smoke test baca dahulu setelah pemasangan; operasi berbayar baru diuji setelah pemilik menyetujuinya.

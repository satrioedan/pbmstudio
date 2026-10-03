# GEJEMUZIK / ulas.tech — MCP untuk ChatGPT

Paket tambahan untuk kode dalam public.zip yang diberikan pada 6 September 2026.
Endpoint setelah dipasang: `https://ulas.tech/mcp`.
**Belum dipasang di hosting dan belum diuji melalui UI ChatGPT.**

## Isi dan cara kerja

- `server.js`: backend asli dengan tambahan routing MCP, aktif hanya jika `MCP_ENABLED=true`.
- `mcp/`: SDK MCP resmi, OAuth, tool musik, jurnal pencegahan pengiriman ulang, dan tes.
- `package.json` + `package-lock.json`: dependensi terkunci.
- `MCP.env.example`: pengaturan tambahan, tanpa kunci asli.
- `MCP-VALIDATION.md`: hasil pemeriksaan dan batas pengujian.

Startup tetap `app.cjs`; tidak perlu port atau proses MCP terpisah. MCP menggunakan fungsi REST backend langsung dalam konteks pemilik tetap. Tidak mengirim kunci provider ke ChatGPT.

Paket ini **bukan salinan lengkap situs**. Ekstrak di root aplikasi lama yang berisi `app.cjs`, `server.js`, `store.js`, dan `public/`. Jangan ekstrak di dalam folder `public/`. File `.env`, `data.json`, frontend, dan provider asli tidak disertakan dan tidak perlu diganti.

## Pemasangan

1. Cadangkan aplikasi, khususnya `server.js`, `package.json`, `package-lock.json` jika ada, `.env`, dan `data.json`. Simpan cadangan di luar folder publik.
2. Unggah dan ekstrak isi folder `ulas-mcp/` ke root aplikasi Node.js. Jika kode di hosting sudah berubah sejak ZIP sumber, gabungkan tambahan routing MCP ke versi terbaru alih-alih menimpa `server.js`.
3. Gunakan Node.js 22 atau 24 yang didukung hosting. Di terminal root aplikasi:

   ```bash
   npm ci --omit=dev
   npm run test:mcp
   ```

   Pada panel hosting, jalankan instalasi NPM menggunakan runtime aplikasi jika terminal memakai versi Node lain. Startup file tetap `app.cjs`.

4. Dapatkan ID pemilik yang benar: buka ulas.tech di browser yang biasanya dipakai membuat lagu, buka Developer Tools → Application/Storage → Local Storage → ulas.tech, salin nilai `gjm_client`. Alternatif di Console situs:

   ```js
   localStorage.getItem('gjm_client')
   ```

   Jangan membuat ID baru jika ingin mengakses koleksi dan API key browser tersebut. Jangan mengirim ID atau isi `.env` ke percakapan. Pasang nilainya langsung di konfigurasi hosting.

5. Mulai pembuatan koneksi OAuth di ChatGPT untuk mendapatkan **redirect/callback URL yang ditampilkan oleh ChatGPT**. Salin URL persis ke `MCP_REDIRECT_URIS`; jangan menebak alamat callback. Jika UI memberikan lebih dari satu callback, pisahkan dengan koma. Tidak ada wildcard.
6. Tambahkan variabel dari `MCP.env.example` ke `.env` aplikasi yang sudah ada. Jangan mengganti seluruh `.env`. Buat dua rahasia berbeda, masing-masing dengan menjalankan:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Hasil pertama untuk `MCP_CLIENT_SECRET`, kedua untuk `MCP_LOGIN_SECRET`. Simpan rahasia di pengelola kata sandi. Jangan pakai API key musik sebagai rahasia ini. Batasi izin `.env` dan jurnal ke pemilik proses aplikasi.
7. Pastikan `BASE_PATH` kosong dan domain menggunakan HTTPS. Gunakan **satu worker/proses aplikasi**: token OAuth disimpan dalam memori. Pada Passenger, atur batas instance aplikasi menjadi satu melalui konfigurasi hosting; jangan hanya mengubah jumlah proses pada pengaturan yang berbeda. Untuk banyak worker, pindahkan token/authorization grants ke penyimpanan bersama dan jurnal ke database dengan locking sebelum mengaktifkannya.
8. Restart aplikasi melalui panel hosting. Untuk Passenger yang mendukung restart file, jalankan dari root aplikasi:

   ```bash
   touch tmp/restart.txt
   ```

9. Periksa:

   ```bash
   curl -i https://ulas.tech/.well-known/oauth-authorization-server
   curl -i -X POST https://ulas.tech/mcp
   ```

   Metadata harus mengembalikan JSON. Permintaan MCP tanpa login harus mengembalikan **401**, dengan `WWW-Authenticate` berisi URL metadata. GET `/mcp` dengan token valid mengembalikan 405 karena transport ini memakai respons JSON pada POST, tanpa SSE mandiri.

Jika reverse proxy membatasi rute, teruskan `/mcp`, `/mcp-login`, `/authorize`, `/token`, `/revoke`, dan `/.well-known/oauth-*` ke proses Node yang sama. Teruskan header Authorization dan MCP-Protocol-Version. Jangan menambahkan cache di rute-rute tersebut.

## Hubungkan ke ChatGPT

Mengikuti dokumentasi OpenAI yang diperiksa 6 September 2026; penempatan menu dapat berbeda menurut akun/workspace.

1. Aktifkan Developer mode melalui Settings → Security and login jika tersedia.
2. Di Plugins, pilih tambah koneksi/developer-mode app.
3. Nama: `GEJEMUZIK`; URL: `https://ulas.tech/mcp`; autentikasi: **OAuth**.
4. Masukkan kredensial OAuth statis: Client ID sesuai `MCP_CLIENT_ID`, Client Secret sesuai `MCP_CLIENT_SECRET`. Server ini menggunakan klien terdaftar statis, bukan DCR/CIMD. Metadata mengiklankan client_secret_post dan PKCE S256.
5. Saat halaman persetujuan GEJEMUZIK terbuka, masukkan `MCP_LOGIN_SECRET` dan izinkan koneksi. Ini berbeda dari Client Secret dan kunci provider.
6. Aktifkan koneksi dalam percakapan dan mulai dengan “Tampilkan model musik yang tersedia” serta “Tampilkan koleksi lagu saya.”
7. Setelah deploy perubahan tools, refresh metadata koneksi. Setelah restart server, sambungkan/login ulang karena token lama tidak bertahan antar-restart.

Apabila akun/workspace tidak menampilkan opsi OAuth statis atau pembuatan koneksi, jangan menonaktifkan autentikasi. Perlu menyesuaikan instalasi plugin/akses workspace berdasarkan menu yang tersedia.

## Tools

| Tool | Fungsi dan batas |
|---|---|
| `list_models` | Katalog model dan estimasi kredit dari kode situs |
| `get_credits` | Saldo virtual situs; bukan cek saldo live KIE/MusicAPI |
| `list_tracks` | Koleksi pemilik, pagination dan filter favorit |
| `get_job_status` | Poll satu lagu, hasil audio, status stem/WAV |
| `generate_lyrics` | Lirik melalui Gemini yang dipasang pada situs |
| `create_song` | Generate lagu menggunakan model katalog situs |
| `remix_audio` | Cover/aransemen ulang lagu APIframe selesai, estimasi 11 kredit |
| `separate_stems` | APIframe atau Upload & Cover, estimasi 11 kredit; multi-stem hanya Upload & Cover |
| `convert_to_wav` | Lagu sunoapi.org Upload & Cover saja, estimasi 6 kredit |
| `set_track_liked` | Set favorit true/false, tanpa biaya provider |

Harga adalah nilai dari backend unggahan, bukan verifikasi harga provider saat ini. `get_job_status` dapat memanggil provider untuk memperbarui status; tidak membuat job baru.

Perintah contoh:

> Tampilkan model yang tersedia dan estimasi kreditnya. Saya ingin lagu reggae Indonesia dengan vokal pria serak. Tunjukkan pilihan dulu sebelum membuat lagu.

> Buat lirik tentang perjalanan cinta yang akhirnya bahagia menggunakan Gemini situs. Minta persetujuan penggunaan API sebelum menjalankan.

> Cek status lagu yang tadi dibuat, lalu berikan tautan audio jika selesai.

Setiap tool yang mengubah data memerlukan `confirmed: true` dan `request_id` UUID. Tool memberi instruksi kepada ChatGPT untuk meminta persetujuan dahulu. Flag ini bukan bukti kriptografis persetujuan manusia: tetap gunakan konfirmasi tindakan pada klien ChatGPT. Gunakan UUID yang sama saat mengulang permintaan yang sama. Jurnal menyimpan status sebelum efek samping dijalankan. Jika koneksi gagal atau server mati, operasi tertunda tidak dicoba ulang otomatis. Periksa situs untuk memastikan hasil sebelum meminta operasi baru.

## Batas yang perlu diketahui

- Integrasi ini untuk **satu pemilik/browser yang dikonfigurasi**, bukan login multi-pengguna. Jangan membagikan koneksi ke pengguna yang tidak boleh mengakses koleksi/kredit pemilik tersebut.
- Backend asli memakai `gjm_client`/`x-gjm-client` sebagai penanda pemilik, bukan autentikasi akun yang kuat. OAuth melindungi rute MCP; **tidak memperbaiki keamanan seluruh REST API lama**. Untuk layanan banyak pengguna, REST juga perlu autentikasi akun dan otorisasi server. Tes pemisahan pemilik tidak berarti header tersebut tidak bisa dipalsukan.
- Tidak tersedia: penghapusan lagu, membuka/mengubah API key, perubahan halaman depan, upload audio dari attachment ChatGPT, mastering audio di browser, dan homofon AI. Mastering asli dikerjakan di browser sehingga membutuhkan pipeline render server tersendiri untuk diotomatisasi melalui MCP.
- URL audio dikembalikan sebagaimana tersedia dari provider; dapat kedaluwarsa. Tidak ada pemindahan otomatis file ke penyimpanan permanen.
- Jurnal `.mcp-journal.json` berisi hasil operasi, lirik, dan URL lagu. Letaknya di root aplikasi, di luar `public/`; cadangkan secara privat. Kapasitas 10.000 operasi. Untuk reset/arsip, hentikan proses, periksa pending, arsipkan jurnal, lalu restart. UUID lama dari jurnal yang diarsip tidak lagi mendapat perlindungan duplikasi.
- Jangan menjalankan pengujian provider nyata memakai arsip unggahan asli. `.env`, `data.json`, backup, dan log dapat berisi informasi privat. Jangan masukkan ke git atau folder publik.

## Rollback

Set `MCP_ENABLED=false` lalu restart untuk menonaktifkan MCP. Backend lama tetap bisa berjalan tanpa mengimpor SDK. Untuk rollback penuh, pulihkan file backend dan package yang dicadangkan; simpan database lagu terbaru.

## Referensi

- OpenAI, Developer mode: https://developers.openai.com/api/docs/guides/developer-mode
- OpenAI, OAuth plugin: https://developers.openai.com/plugins/build/auth
- OpenAI, Connect and test: https://developers.openai.com/plugins/deploy/connect-chatgpt
- SDK resmi: https://github.com/modelcontextprotocol/typescript-sdk
- Streamable HTTP: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports

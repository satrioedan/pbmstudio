# GEJEMUZIK

AI song generator — full-stack Node (tanpa dependency) — by **bangalimin**.

Menggabungkan dua provider:

- **APIframe** — generate lagu baru, aransemen ulang (cover), pisah stem.
- **sunoapi.org** — Upload & Cover (aransemen audio dari galeri lokal), pisah stem, konversi WAV.

Keduanya mendukung **banyak API key** dengan **rotasi otomatis** saat limit.

## Fitur

- Buat lagu dari judul + gaya + lirik (mode vokal/instrumental, model pilihan).
- Aransemen ulang / cover (APIframe).
- Upload audio lokal → aransemen ulang versi baru (sunoapi.org).
- Pisah stem (`vokal+instrumental` atau `semua stem`) — kedua provider.
- Konversi ke WAV (sunoapi.org).
- **Unduh MP3** (passthrough langsung dari provider).
- Favorit, pustaka, riwayat lagu (tersimpan di `data.json`).
- Dashboard responsif (mobile bottom-nav + desktop sidebar).
- Mode mock — bisa langsung dicoba tanpa API asli.

## Persyaratan

- Node.js 18+

## Cara jalan

```bash
cp .env.example .env
# edit .env bila perlu (boleh dibiarkan default untuk mock)
npm start
```

Lalu buka <http://localhost:3000>.

## API key

Key bisa diisi via:

1. File `.env` (`PROVIDER_API_KEY` untuk APIframe, `SUNOAPI_KEY` untuk sunoapi.org), **atau**
2. Dashboard → **Setelan API Key** (mendukung banyak key, satu per baris).

Saat key kena limit (`401/402/429/430`), sistem akan menandai key tersebut habis dan langsung pakai key berikutnya secara otomatis (rotation).

## Catatan

- Tindakan susulan (cover / stem / WAV / status) selalu memakai **key yang sama** dengan lagu sumber (tidak dirotasi) karena keterikatan task pada provider.
- Fitur WAV via API hanya tersedia untuk lagu sunoapi.org. Untuk lagu APIframe gunakan **Unduh MP3**.
- File yang diunggah ke fitur Upload & Cover disimpan di `public/uploads/`. Agar URL-nya bisa diakses provider, set `PUBLIC_URL` ke domain HTTPS publik aplikasi (misal saat deploy).

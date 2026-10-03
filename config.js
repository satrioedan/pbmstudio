// ============================================================================
// GEJEMUZIK config loader
// Memuat file .env secara native tanpa dependency, aman untuk cPanel/Passenger.
// Harus dijalankan sebelum server/provider membaca process.env.
// ============================================================================

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomBytes } from "node:crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))

function unquote(v) {
  let s = String(v ?? "").trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s
}

export function loadEnv(file = join(__dirname, ".env")) {
  if (!existsSync(file)) return false
  const raw = readFileSync(file, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = line.indexOf("=")
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const value = unquote(line.slice(idx + 1))
    if (!key) continue
    const hasExisting = process.env[key] !== undefined && process.env[key] !== ""
    // Jangan timpa PORT dari Passenger/cPanel. Untuk value kosong, jangan hapus env dari cPanel.
    // Selain itu, .env boleh menimpa cPanel UI supaya PROVIDER_MOCK=false benar-benar aktif.
    if (key === "PORT" && hasExisting) continue
    if (value === "" && hasExisting) continue
    process.env[key] = value
  }
  return true
}

loadEnv()

// Backward compatibility: beberapa panduan lama memakai nama ini.
if (!process.env.PROVIDER_API_KEY && process.env.APIFRAME_API_KEY) {
  process.env.PROVIDER_API_KEY = process.env.APIFRAME_API_KEY
}
if (!process.env.SUNOAPI_KEY && process.env.SUNO_API_KEY) {
  process.env.SUNOAPI_KEY = process.env.SUNO_API_KEY
}

export const CONFIG = {
  basePath: process.env.BASE_PATH || "",
  publicUrl: (process.env.PUBLIC_URL || "https://ulas.tech").replace(/\/$/, ""),
  providerMock: String(process.env.PROVIDER_MOCK ?? "true") === "true",
}

// Token rahasia untuk memverifikasi callback/webhook dari KIE AI & sunoapi.org agar
// tidak bisa dipalsukan pihak luar (mereka tidak mendukung tanda tangan HMAC seperti
// APIframe). Set WEBHOOK_SECRET di .env supaya nilainya tetap sama walau server restart
// (kalau tidak, job yang masih berjalan saat restart akan gagal diverifikasi lewat
// webhook, tapi tetap akan ter-update lewat polling status biasa).
export const WEBHOOK_TOKEN = process.env.WEBHOOK_SECRET || randomBytes(24).toString("hex")

// Jaring pengaman proses: tanpa ini, satu error async yang tidak tertangkap bisa
// mematikan seluruh server Node (semua pengguna terputus) dan memicu Passenger
// terus-menerus me-restart proses (bisa berujung ke "fork: retry: Resource
// temporarily unavailable" pada shared hosting). Cukup didaftarkan sekali di sini
// karena config.js selalu diimpor lebih dulu oleh semua modul lain.
if (!globalThis.__gjmCrashGuardsInstalled) {
  globalThis.__gjmCrashGuardsInstalled = true
  process.on("unhandledRejection", (reason) => {
    console.error("[GEJEMUZIK] Unhandled promise rejection:", reason)
  })
  process.on("uncaughtException", (err) => {
    console.error("[GEJEMUZIK] Uncaught exception, proses akan restart:", err && err.stack ? err.stack : err)
    // Keluar dengan sengaja (bukan crash liar) supaya Passenger me-restart proses
    // dalam keadaan bersih, alih-alih melanjutkan dengan state yang mungkin rusak.
    process.exit(1)
  })
}

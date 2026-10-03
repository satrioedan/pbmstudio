// ============================================================================
// GEJEMUZIK - CommonJS startup wrapper untuk cPanel/Passenger
// Memuat .env terlebih dahulu, lalu dynamic import server.js.
// ============================================================================

"use strict"

const { existsSync, readFileSync } = require("node:fs")
const { join } = require("node:path")

function loadEnv(file) {
  if (!existsSync(file)) return
  const raw = readFileSync(file, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = line.indexOf("=")
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!key) continue
    const hasExisting = process.env[key] !== undefined && process.env[key] !== ""
    // Jangan timpa PORT dari Passenger/cPanel. Untuk value kosong, jangan hapus env dari cPanel.
    if (key === "PORT" && hasExisting) continue
    if (value === "" && hasExisting) continue
    process.env[key] = value
  }
  if (!process.env.PROVIDER_API_KEY && process.env.APIFRAME_API_KEY) process.env.PROVIDER_API_KEY = process.env.APIFRAME_API_KEY
  if (!process.env.SUNOAPI_KEY && process.env.SUNO_API_KEY) process.env.SUNOAPI_KEY = process.env.SUNO_API_KEY
}

loadEnv(join(__dirname, ".env"))

import("./server.js").catch((err) => {
  console.error("[GEJEMUZIK] Gagal memuat server.js:")
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})

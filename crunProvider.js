// ============================================================================
// crun.ai provider adapter (Suno API via crun.ai)
// API key: https://crun.ai  (header X-API-KEY)
// Docs: https://docs.crun.ai/suno-api/generate-music
//   POST /api/v1/client/job/CreateTask      { model: "suno/music-generate", input }
//   GET  /api/v1/client/job/TaskInfo?task_id (status: pending|running|success|failed)
//   GET  /api/v1/client/account/balance     (data.balance)
// Respons selalu berbentuk { code, message, data } — code != 200 berarti gagal
// walaupun HTTP status 200.
// ============================================================================

import "./config.js"
import { store, maskKey } from "./store.js"
import { getModel } from "./models.js"

const MOCK = String(process.env.PROVIDER_MOCK ?? "false") === "true"
const MOCK_DELAY = Number(process.env.MOCK_DELAY_SECONDS ?? 8) * 1000
const ENV_KEY = process.env.CRUN_API_KEY || ""
const BASE_URL = (process.env.CRUN_BASE_URL || "https://api.crun.ai").replace(/\/$/, "")
// 401 key salah, 402 kredit habis, 403 key nonaktif, 429 rate limit -> rotasi key.
const ROTATE_CODES = new Set([401, 402, 403, 429])
const SAMPLE_AUDIO = [
  "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb749d484.mp3",
  "https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3",
]
const mockJobs = new Map()

function poolForGenerate() {
  const keys = store.getCrunRawKeys()
  if (keys.length) return keys
  if (ENV_KEY) return [{ id: "env", key: ENV_KEY }]
  return []
}

function resolveKey(keyId) {
  if (keyId) {
    const k = store.getCrunKeyById(keyId)
    if (k) return k.key
    if (keyId === "env" && ENV_KEY) return ENV_KEY
  }
  return poolForGenerate()[0]?.key || null
}

function mapStatus(s) {
  switch ((s || "").toString().toLowerCase()) {
    case "success": case "succeeded": case "completed": return "success"
    case "failed": case "error": case "canceled": case "cancelled": return "failed"
    default: return "processing"
  }
}

function errorMessage(data, httpStatus) {
  const detail = Array.isArray(data?.errors) && data.errors.length ? ` (${data.errors.join(", ")})` : ""
  return (data?.message || data?.error || `crun.ai ${httpStatus}`) + detail
}

async function call(path, key, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "X-API-KEY": key, "Content-Type": "application/json", ...(init.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  const code = Number(data?.code ?? res.status)
  return { ok: res.ok && code === 200, code: res.ok ? code : res.status, data }
}

function normalizeTrack(t = {}, i = 0) {
  return {
    id: t.suno_id || t.id || String(i + 1),
    audioUrl: t.suno_audio_url || t.audio_url || null,
    imageUrl: t.suno_image_large_url || t.suno_image_url || t.image_url || null,
    title: t.title || null,
    tags: t.tags || null,
    duration: t.duration || null,
  }
}

function parseTracks(task) {
  const result = task?.result || {}
  let arr = result.suno_data || []
  if (!Array.isArray(arr)) arr = [arr]
  arr = arr.map(normalizeTrack).filter((t) => t.audioUrl)
  if (!arr.length && Array.isArray(result.media_urls)) {
    arr = result.media_urls.filter((u) => typeof u === "string").map((u, i) => normalizeTrack({ audio_url: u }, i))
  }
  const first = arr[0] || {}
  return { audioUrl: first.audioUrl || null, imageUrl: first.imageUrl || null, tracks: arr }
}

function buildBody({ title, lyrics, style, type, vocalGender, model }) {
  const m = getModel(model)
  const version = m?.modelVersion || "v5"
  const instrumental = type === "instrumental"
  const hasLyrics = !instrumental && !!String(lyrics || "").trim()
  const isV4 = version === "v4"
  const input = { model: version, instrumental }

  // Custom mode bila ada lirik (atau instrumental dengan judul); selain itu simple mode.
  if (hasLyrics || (instrumental && String(title || "").trim())) {
    input.mode = "custom"
    input.title = String(title || "Untitled").slice(0, 80)
    input.tags = String(style || "pop").slice(0, isV4 ? 200 : 1000)
    if (hasLyrics) input.lyrics = String(lyrics).slice(0, isV4 ? 3000 : 5000)
    if (vocalGender === "male") input.vocal_gender = "m"
    else if (vocalGender === "female") input.vocal_gender = "f"
  } else {
    input.mode = "simple"
    input.prompt = String(style || title || "instrumental track").slice(0, 500)
  }

  // Tanpa callback_url: status diambil lewat polling TaskInfo (crun.ai tidak menandatangani callback).
  return { model: "suno/music-generate", input }
}

export const crunProvider = {
  hasKey() { return poolForGenerate().length > 0 },

  async generate(input) {
    if (MOCK) {
      const jobId = "crun_mock_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl: SAMPLE_AUDIO[Math.floor(Math.random() * SAMPLE_AUDIO.length)] })
      return { jobId, status: "processing", keyId: "mock" }
    }
    const pool = poolForGenerate()
    if (!pool.length) throw new Error("Belum ada API key crun.ai. Tambahkan di Setelan API Key bagian crun.ai.")

    const body = JSON.stringify(buildBody(input))
    const start = store.getCrunKeyCursor() % pool.length
    let lastErr = null
    for (let i = 0; i < pool.length; i++) {
      const idx = (start + i) % pool.length
      const { id, key } = pool[idx]
      let r
      try {
        r = await call("/api/v1/client/job/CreateTask", key, { method: "POST", body })
      } catch (e) {
        lastErr = new Error(`crun.ai ${maskKey(key)}: ${e.message}`)
        continue
      }
      if (r.ok) {
        const jobId = r.data?.data?.task_id
        if (!jobId) throw new Error("Respons crun.ai tidak berisi task_id: " + JSON.stringify(r.data).slice(0, 300))
        store.setCrunKeyCursor((idx + 1) % pool.length)
        return { jobId, status: "processing", keyId: id }
      }
      if (ROTATE_CODES.has(r.code)) {
        if (r.code === 402 && id !== "env") store.updateCrunKeyCredits(id, 0)
        lastErr = new Error(`crun.ai ${maskKey(key)} (${r.code}): ${errorMessage(r.data, r.code)}`)
        continue
      }
      throw new Error(errorMessage(r.data, r.code))
    }
    throw new Error("Semua API key crun.ai limit atau gagal. " + (lastErr ? lastErr.message : ""))
  },

  async getStatus(jobId, keyId) {
    if (MOCK) {
      const job = mockJobs.get(jobId)
      if (!job) return { status: "failed", error: "Mock job tidak ditemukan" }
      if (Date.now() >= job.finishAt) return { status: "success", audioUrl: job.audioUrl, tracks: [{ id: "1", audioUrl: job.audioUrl }] }
      return { status: "processing" }
    }
    const key = resolveKey(keyId)
    if (!key) throw new Error("API key crun.ai untuk job ini tidak ditemukan")
    const r = await call(`/api/v1/client/job/TaskInfo?task_id=${encodeURIComponent(jobId)}`, key)
    if (!r.ok) throw new Error(errorMessage(r.data, r.code))
    return this.parseTask(r.data?.data)
  },

  /** Ubah objek task crun.ai (dari TaskInfo atau callback) jadi status lagu. */
  parseTask(task) {
    const status = mapStatus(task?.status)
    if (status === "success") {
      const parsed = parseTracks(task)
      if (!parsed.audioUrl) return { status: "processing" }
      return { status, ...parsed }
    }
    if (status === "failed") return { status, error: task?.result?.message || "crun.ai gagal generate" }
    return { status }
  },

  async checkCredits(key) {
    const r = await call("/api/v1/client/account/balance", key)
    if (!r.ok) throw new Error(r.code === 401 ? "Key tidak valid" : r.code === 403 ? "Key nonaktif" : errorMessage(r.data, r.code))
    return Number(r.data?.data?.balance ?? 0)
  },
}

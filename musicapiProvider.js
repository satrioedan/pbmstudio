// ============================================================================
// MusicAPI.ai provider adapter (Sonic API)
// API key: https://musicapi.ai/dashboard/apikey
// Docs: https://docs.musicapi.ai
// ============================================================================

import "./config.js"
import { store, maskKey } from "./store.js"

const MOCK = String(process.env.PROVIDER_MOCK ?? "false") === "true"
const MOCK_DELAY = Number(process.env.MOCK_DELAY_SECONDS ?? 8) * 1000
const ENV_KEY = process.env.MUSICAPI_KEY || ""
const BASE_URL = (process.env.MUSICAPI_BASE_URL || "https://api.musicapi.ai").replace(/\/$/, "")
const ROTATE_STATUS = new Set([401, 403, 429])
const SAMPLE_AUDIO = [
  "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb749d484.mp3",
  "https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3",
]
const mockJobs = new Map()

function poolForGenerate() {
  const keys = store.getMusicApiRawKeys ? store.getMusicApiRawKeys() : []
  if (keys.length) return keys
  if (ENV_KEY) return [{ id: "env", key: ENV_KEY }]
  return []
}
function resolveKey(keyId) {
  if (keyId) {
    const k = store.getMusicApiKeyById?.(keyId)
    if (k) return k.key
    if (keyId === "env" && ENV_KEY) return ENV_KEY
  }
  return poolForGenerate()[0]?.key || null
}
function mapStatus(s) {
  switch ((s || "").toString().toLowerCase()) {
    case "succeeded": case "success": case "completed": case "complete": case "done": return "success"
    case "failed": case "error": case "canceled": case "cancelled": return "failed"
    default: return "processing"
  }
}
function firstNonEmpty(...vals) { return vals.find((v) => typeof v === "string" && v.trim()) || null }
function normalizeTrack(t = {}, i = 0) {
  return {
    id: t.id || t.audio_id || t.audioId || String(i + 1),
    audioUrl: firstNonEmpty(t.audio_url, t.audioUrl, t.url, t.stream_url, t.download_url),
    imageUrl: firstNonEmpty(t.image_url, t.imageUrl, t.cover_url, t.thumbnail_url),
    title: t.title || t.name || null,
    tags: t.tags || null,
    duration: t.duration || null,
  }
}
function parseTracks(data) {
  const root = data?.data || data?.result || data || {}
  let arr = root.data || root.songs || root.tracks || root.audios || root.output || []
  if (!Array.isArray(arr)) arr = [arr]
  arr = arr.map(normalizeTrack).filter((t) => t.audioUrl)
  const direct = firstNonEmpty(root.audio_url, root.audioUrl, root.url, data?.audio_url, data?.audioUrl)
  if (!arr.length && direct) arr = [normalizeTrack({ audio_url: direct, image_url: root.image_url || root.imageUrl }, 0)]
  const first = arr[0] || {}
  return { audioUrl: first.audioUrl || null, imageUrl: first.imageUrl || null, tracks: arr }
}
function buildBody({ title, lyrics, style, type, model }) {
  const instrumental = type === "instrumental"
  const custom = !!String(lyrics || "").trim() || !!String(title || "").trim()
  return {
    custom_mode: custom,
    mv: model === "musicapi-sonic-v4" ? "sonic-v4" : "sonic-v4-5",
    title: String(title || "Untitled").slice(0, 80),
    tags: String(style || "pop").slice(0, 1000),
    prompt: String(lyrics || style || title || "music").slice(0, custom ? 5000 : 500),
    instrumental,
  }
}

export const musicapiProvider = {
  hasKey() { return poolForGenerate().length > 0 },
  async generate(input) {
    if (MOCK) {
      const jobId = "musicapi_mock_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl: SAMPLE_AUDIO[Math.floor(Math.random() * SAMPLE_AUDIO.length)] })
      return { jobId, status: "processing", keyId: "mock" }
    }
    const pool = poolForGenerate()
    if (!pool.length) throw new Error("Belum ada API key MusicAPI.ai. Tambahkan di Setelan API Key bagian MusicAPI.ai.")
    const start = store.getMusicApiKeyCursor ? store.getMusicApiKeyCursor() % pool.length : 0
    let lastErr = null
    for (let i = 0; i < pool.length; i++) {
      const idx = (start + i) % pool.length
      const { id, key } = pool[idx]
      let res, data
      try {
        res = await fetch(`${BASE_URL}/api/v1/sonic/create`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildBody(input)),
        })
        data = await res.json().catch(() => ({}))
      } catch (e) { lastErr = new Error(`MusicAPI ${maskKey(key)}: ${e.message}`); continue }
      if (res.ok) {
        const jobId = data.task_id || data.taskId || data.id || data?.data?.task_id || data?.data?.taskId || data?.data?.id
        if (!jobId) throw new Error("Respons MusicAPI.ai tidak berisi task_id: " + JSON.stringify(data).slice(0, 300))
        if (store.setMusicApiKeyCursor) store.setMusicApiKeyCursor((idx + 1) % pool.length)
        return { jobId, status: "processing", keyId: id }
      }
      if (ROTATE_STATUS.has(res.status)) {
        if ((res.status === 403 || res.status === 401) && id !== "env") store.updateMusicApiKeyCredits?.(id, 0)
        lastErr = new Error(`MusicAPI ${maskKey(key)} (${res.status}): ${data.error || data.message || data.detail || "limit/invalid"}`)
        continue
      }
      throw new Error(data.error || data.message || data.detail || JSON.stringify(data).slice(0, 300) || `MusicAPI ${res.status}`)
    }
    throw new Error("Semua API key MusicAPI.ai limit atau gagal. " + (lastErr ? lastErr.message : ""))
  },
  async getStatus(jobId, keyId) {
    if (MOCK) {
      const job = mockJobs.get(jobId)
      if (!job) return { status: "failed", error: "Mock job tidak ditemukan" }
      if (Date.now() >= job.finishAt) return { status: "success", audioUrl: job.audioUrl, tracks: [{ id: "1", audioUrl: job.audioUrl }] }
      return { status: "processing" }
    }
    const key = resolveKey(keyId)
    if (!key) throw new Error("API key MusicAPI.ai untuk job ini tidak ditemukan")
    const res = await fetch(`${BASE_URL}/api/v1/sonic/task/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || data.message || data.detail || `MusicAPI ${res.status}`)
    const status = mapStatus(data.state || data.status || data?.data?.state || data?.data?.status)
    if (status === "success") return { status, ...parseTracks(data) }
    if (status === "failed") return { status, error: data.error || data.message || data?.data?.error || "MusicAPI gagal generate" }
    return { status }
  },
  async checkCredits(key) {
    const res = await fetch(`${BASE_URL}/api/v1/get-credits`, { headers: { Authorization: `Bearer ${key}` } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || data.message || data.detail || `MusicAPI ${res.status}`)
    return Number(data.credits ?? data.credit ?? data?.data?.credits ?? data?.data?.credit ?? 0)
  },
}

// ============================================================================
// KIE AI provider adapter (Suno API compatible)
// API key: https://kie.ai/id/api-key
// Docs: https://docs.kie.ai/suno-api
// ============================================================================

import { WEBHOOK_TOKEN } from "./config.js"
import { store, maskKey } from "./store.js"

const MOCK = String(process.env.PROVIDER_MOCK ?? "false") === "true"
const MOCK_DELAY = Number(process.env.MOCK_DELAY_SECONDS ?? 8) * 1000
const ENV_KEY = process.env.KIE_API_KEY || ""
const BASE_URL = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/$/, "")
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://ulas.tech").replace(/\/$/, "")
const ROTATE_STATUS = new Set([401, 402, 429, 430])
const SAMPLE_AUDIO = [
  "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb749d484.mp3",
  "https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3",
]
const mockJobs = new Map()

function poolForGenerate() {
  const keys = store.getKieRawKeys ? store.getKieRawKeys() : []
  if (keys.length) return keys
  if (ENV_KEY) return [{ id: "env", key: ENV_KEY }]
  return []
}
function resolveKey(keyId) {
  if (keyId) {
    const k = store.getKieKeyById?.(keyId)
    if (k) return k.key
    if (keyId === "env" && ENV_KEY) return ENV_KEY
  }
  return poolForGenerate()[0]?.key || null
}
function mapStatus(s) {
  switch ((s || "").toString().toUpperCase()) {
    case "SUCCESS":
    case "COMPLETE":
    case "COMPLETED": return "success"
    case "CREATE_TASK_FAILED":
    case "GENERATE_AUDIO_FAILED":
    case "CALLBACK_EXCEPTION":
    case "SENSITIVE_WORD_ERROR":
    case "FAILED":
    case "ERROR": return "failed"
    default: return "processing"
  }
}
function firstNonEmpty(...vals) { return vals.find((v) => typeof v === "string" && v.trim()) || null }
function normalizeTrack(t = {}, i = 0) {
  return {
    id: t.id || t.audioId || t.audio_id || String(i + 1),
    audioUrl: firstNonEmpty(t.audioUrl, t.audio_url, t.streamAudioUrl, t.stream_audio_url, t.url),
    imageUrl: firstNonEmpty(t.imageUrl, t.image_url, t.coverUrl, t.thumbnailUrl),
    title: t.title || t.name || null,
    tags: t.tags || null,
    duration: t.duration || null,
  }
}
function parseTracks(data) {
  const d = data?.data || data || {}
  const response = d.response || data?.response || {}
  let tracks = response.sunoData || d.sunoData || data?.sunoData || data?.data?.data || []
  if (!Array.isArray(tracks)) tracks = [tracks]
  tracks = tracks.map(normalizeTrack).filter((t) => t.audioUrl)
  const first = tracks[0] || {}
  return { audioUrl: first.audioUrl || null, imageUrl: first.imageUrl || null, tracks }
}
function buildBody({ title, lyrics, style, type, vocalGender, model }) {
  const instrumental = type === "instrumental"
  const hasLyrics = !instrumental && !!String(lyrics || "").trim()
  const kieModel = model === "kie-suno-v5" ? "V5" : model === "kie-suno-v4.5" ? "V4_5" : "V5_5"
  const body = {
    prompt: hasLyrics ? String(lyrics).slice(0, 5000) : String(style || title || "music").slice(0, 500),
    style: String(style || "Pop").slice(0, 1000),
    title: String(title || "Untitled").slice(0, 80),
    customMode: true,
    instrumental,
    model: kieModel,
    callBackUrl: `${PUBLIC_URL}/api/webhooks/kie?t=${WEBHOOK_TOKEN}`,
  }
  if (vocalGender === "male") body.vocalGender = "m"
  if (vocalGender === "female") body.vocalGender = "f"
  return body
}

export const kieProvider = {
  hasKey() { return poolForGenerate().length > 0 },
  async generate(input) {
    if (MOCK) {
      const jobId = "kie_mock_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl: SAMPLE_AUDIO[Math.floor(Math.random() * SAMPLE_AUDIO.length)] })
      return { jobId, status: "processing", keyId: "mock" }
    }
    const pool = poolForGenerate()
    if (!pool.length) throw new Error("Belum ada API key KIE AI. Tambahkan di Setelan API Key bagian KIE AI.")
    const start = store.getKieKeyCursor ? store.getKieKeyCursor() % pool.length : 0
    let lastErr = null
    for (let i = 0; i < pool.length; i++) {
      const idx = (start + i) % pool.length
      const { id, key } = pool[idx]
      let res, data
      try {
        res = await fetch(`${BASE_URL}/api/v1/generate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildBody(input)),
        })
        data = await res.json().catch(() => ({}))
      } catch (e) { lastErr = new Error(`KIE ${maskKey(key)}: ${e.message}`); continue }
      if (res.ok && (data.code == null || Number(data.code) === 200)) {
        const jobId = data?.data?.taskId || data?.taskId || data?.id
        if (!jobId) throw new Error("Respons KIE AI tidak berisi taskId: " + JSON.stringify(data).slice(0, 300))
        if (store.setKieKeyCursor) store.setKieKeyCursor((idx + 1) % pool.length)
        return { jobId, status: "processing", keyId: id }
      }
      if (ROTATE_STATUS.has(res.status) || ROTATE_STATUS.has(Number(data.code))) {
        if ((res.status === 402 || Number(data.code) === 402) && id !== "env") store.updateKieKeyCredits?.(id, 0)
        lastErr = new Error(`KIE ${maskKey(key)} (${data.code || res.status}): ${data.msg || data.message || "limit/invalid"}`)
        continue
      }
      throw new Error(data.msg || data.message || JSON.stringify(data).slice(0, 300) || `KIE AI ${res.status}`)
    }
    throw new Error("Semua API key KIE AI limit atau gagal. " + (lastErr ? lastErr.message : ""))
  },
  async getStatus(jobId, keyId) {
    if (MOCK) {
      const job = mockJobs.get(jobId)
      if (!job) return { status: "failed", error: "Mock job tidak ditemukan" }
      if (Date.now() >= job.finishAt) return { status: "success", audioUrl: job.audioUrl, tracks: [{ id: "1", audioUrl: job.audioUrl }] }
      return { status: "processing" }
    }
    const key = resolveKey(keyId)
    if (!key) throw new Error("API key KIE AI untuk job ini tidak ditemukan")
    const res = await fetch(`${BASE_URL}/api/v1/generate/record-info?taskId=${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || (data.code != null && Number(data.code) !== 200)) throw new Error(data.msg || data.message || `KIE AI ${res.status}`)
    const d = data.data || {}
    const status = mapStatus(d.status)
    if (status === "success") return { status, ...parseTracks(data) }
    if (status === "failed") return { status, error: d.errorMessage || data.msg || "KIE AI gagal generate" }
    return { status }
  },
  async checkCredits(key) {
    // KIE docs tidak selalu menyediakan endpoint kredit publik yang stabil.
    // Validasi ringan: panggil endpoint detail dummy; 401 berarti invalid, selain itu dianggap reachable.
    const res = await fetch(`${BASE_URL}/api/v1/generate/record-info?taskId=__check__`, { headers: { Authorization: `Bearer ${key}` } })
    if (res.status === 401) throw new Error("Key KIE AI tidak valid")
    return null
  },
}

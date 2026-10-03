// ============================================================================
// PROVIDER ADAPTER -> APIframe (Suno API) + KOLAM MULTI API KEY
// Docs: https://apiframe.ai/docs/music/suno
//   POST   /v2/music/generate     (header X-API-Key: afk_...)
//   GET    /v2/jobs/:id           (polling status)
//   GET    /v2/me                 (cek sisa kredit -> team.credits)
//   Webhook POST -> { event, jobId, status, result, error }
//
// Multi key: key disimpan di store (lewat Setelan API Key). Saat generate,
// key dipakai bergiliran (round-robin). Bila sebuah key limit/invalid
// (HTTP 401/402/429) -> otomatis ROLLING ke key berikutnya.
//
// Mode mock tetap tersedia (PROVIDER_MOCK=true) untuk tes UI tanpa API key.
// ============================================================================

import "./config.js"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { getModel } from "./models.js"
import { store, maskKey } from "./store.js"

const MOCK = String(process.env.PROVIDER_MOCK ?? "false") === "true"
const MOCK_DELAY = Number(process.env.MOCK_DELAY_SECONDS ?? 8) * 1000
const ENV_KEY = process.env.PROVIDER_API_KEY || process.env.APIFRAME_API_KEY || ""
const BASE_URL = (process.env.PROVIDER_BASE_URL || "https://api.apiframe.ai").replace(/\/$/, "")
// URL publik (https) supaya APIframe bisa kirim webhook. Kosong -> polling.
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "")

// Status HTTP yang memicu rotasi ke key berikutnya.
const ROTATE_STATUS = new Set([401, 402, 429, 430])

// Audio sample bebas-royalti untuk mode mock.
const SAMPLE_AUDIO = [
  "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb749d484.mp3",
  "https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3",
  "https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0c6ff1bab.mp3",
]
const mockJobs = new Map()

// --------------------------- Kolam API key ----------------------------------

// Key untuk generate: pakai key tersimpan; bila kosong, fallback ke env.
function poolForGenerate() {
  const keys = store.getRawKeys()
  if (keys.length) return keys
  if (ENV_KEY) return [{ id: "env", key: ENV_KEY }]
  return []
}

// Semua key (untuk verifikasi webhook): gabungan store + env.
function allKeys() {
  const keys = store.getRawKeys().slice()
  if (ENV_KEY && !keys.some((k) => k.key === ENV_KEY)) keys.push({ id: "env", key: ENV_KEY })
  return keys
}

// Cari key mentah dari id (untuk getStatus job tertentu).
function resolveKey(keyId) {
  if (keyId) {
    const k = store.getKey(keyId)
    if (k) return k.key
    if (keyId === "env" && ENV_KEY) return ENV_KEY
  }
  const pool = poolForGenerate()
  return pool[0]?.key || null
}

// ----------------------------- Util ------------------------------------------

function mapStatus(s) {
  switch ((s || "").toString().toUpperCase()) {
    case "COMPLETED":
    case "COMPLETE":
    case "SUCCEEDED":
    case "SUCCESS":
    case "DONE":
      return "success"
    case "FAILED":
    case "FAILURE":
    case "ERROR":
    case "CANCELLED":
    case "CANCELED":
      return "failed"
    case "QUEUED":
    case "PENDING":
    case "PROCESSING":
    case "RUNNING":
    default:
      return "processing"
  }
}

function firstNonEmpty(...vals) {
  return vals.find((v) => typeof v === "string" && v.trim()) || null
}

function normalizeTrack(t = {}, i = 0) {
  const audioUrl = firstNonEmpty(t.audioUrl, t.audio_url, t.url, t.sourceAudioUrl, t.streamAudioUrl, t.downloadUrl)
  const imageUrl = firstNonEmpty(t.imageUrl, t.image_url, t.coverUrl, t.cover_url, t.thumbnailUrl)
  return {
    id: t.id || t.audioId || t.audio_id || String(i + 1),
    audioUrl,
    imageUrl,
    title: t.title || t.name || null,
    tags: t.tags || null,
    duration: t.duration || t.durationSec || null,
  }
}

function parseTracks(payload) {
  const result = payload?.result || payload?.data || payload || {}
  let tracks = result?.tracks || result?.songs || result?.audios || result?.items || result?.output || []
  if (!Array.isArray(tracks)) tracks = [tracks]
  tracks = tracks.map(normalizeTrack).filter((t) => t.audioUrl)
  const directAudio = firstNonEmpty(result.audioUrl, result.audio_url, result.url, result.outputUrl, payload?.audioUrl, payload?.audio_url)
  const directImage = firstNonEmpty(result.imageUrl, result.image_url, result.coverUrl, result.cover_url, payload?.imageUrl, payload?.image_url)
  if (!tracks.length && directAudio) tracks = [normalizeTrack({ audioUrl: directAudio, imageUrl: directImage }, 0)]
  const first = tracks[0] || {}
  return {
    audioUrl: first.audioUrl || directAudio || null,
    imageUrl: first.imageUrl || directImage || null,
    tracks,
  }
}

function buildBody({ title, lyrics, style, type, vocalGender, model }) {
  const m = getModel(model)
  if (!m) throw new Error(`Model tidak dikenal: ${model}`)

  const instrumental = type === "instrumental"
  const hasLyrics = !instrumental && !!lyrics.trim()
  const body = { model: m.apiframeModel }

  if (m.apiframeModel === "suno") {
    const sunoParams = { instrumental, model_version: m.modelVersion || "V4_5PLUS" }
    if (title) sunoParams.title = title.slice(0, 80)
    if (style) sunoParams.style = style.slice(0, 1000)
    if (vocalGender === "male") sunoParams.vocal_gender = "m"
    else if (vocalGender === "female") sunoParams.vocal_gender = "f"

    if (hasLyrics) {
      sunoParams.custom_mode = true
      body.prompt = lyrics.slice(0, 5000)
    } else {
      sunoParams.custom_mode = false
      body.prompt = (style || title || "instrumental track").slice(0, 500)
    }
    body.sunoParams = sunoParams
  } else {
    body.prompt = (hasLyrics ? lyrics : style || title || "instrumental track").slice(0, 1000)
  }

  if (PUBLIC_URL.startsWith("https://")) {
    body.webhookUrl = `${PUBLIC_URL}/api/webhooks/provider`
    body.webhookEvents = ["completed", "failed"]
  }
  return body
}

// Pretty-print nama stem untuk hasil APIframe.
const STEM_LABELS_APIFRAME = {
  vocals: "Vokal", vocal: "Vokal", instrumental: "Instrumental", instruments: "Instrumental",
  backing_vocals: "Vokal latar", drums: "Drum", bass: "Bass", guitar: "Gitar",
  keyboard: "Keyboard", piano: "Piano", percussion: "Perkusi", strings: "Strings",
  synth: "Synth", fx: "Efek", brass: "Brass", woodwinds: "Tiup kayu", origin: "Asli (mix)",
}
function prettyStem(name) {
  const k = String(name || "").toLowerCase().replace(/[\s-]+/g, "_").replace(/_?(url|stem|track)$/, "")
  return STEM_LABELS_APIFRAME[k] || (name ? String(name) : "Stem")
}
// Kumpulkan daftar { name, url } stem dari berbagai kemungkinan bentuk respons.
function parseStems(result) {
  const out = []
  const seen = new Set()
  const push = (name, url) => {
    if (!url || typeof url !== "string" || seen.has(url)) return
    seen.add(url)
    out.push({ name: prettyStem(name), url })
  }
  if (!result) return out
  if (result.stems && !Array.isArray(result.stems) && typeof result.stems === "object") {
    for (const [k, v] of Object.entries(result.stems)) if (typeof v === "string") push(k, v)
  }
  const arr = Array.isArray(result.stems) ? result.stems
    : Array.isArray(result.tracks) ? result.tracks
    : Array.isArray(result.files) ? result.files
    : Array.isArray(result.assets) ? result.assets : []
  for (const it of arr) {
    if (typeof it === "string") push("stem", it)
    else if (it) push(it.name || it.type || it.stem || it.label || it.title, it.audioUrl || it.url || it.audio_url || it.fileUrl)
  }
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === "string" && /url$/i.test(k) &&
      /vocal|instrument|drum|bass|guitar|keyboard|percussion|string|synth|fx|brass|woodwind|piano/i.test(k)) push(k, v)
  }
  return out
}

// ----------------------------- Provider --------------------------------------

export const provider = {
  /** Mulai generate lagu (dengan rotasi key otomatis). */
  async generate(input) {
    if (MOCK) {
      const jobId = "mock_" + Math.random().toString(36).slice(2, 12)
      const audioUrl = SAMPLE_AUDIO[Math.floor(Math.random() * SAMPLE_AUDIO.length)]
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl })
      return { jobId, status: "processing", keyId: "mock" }
    }

    const pool = poolForGenerate()
    if (!pool.length) {
      throw new Error("Belum ada API key. Tambahkan dulu di Setelan API Key.")
    }

    const body = JSON.stringify(buildBody(input))
    const start = pool.length ? store.getKeyCursor() % pool.length : 0
    let lastErr = null

    for (let i = 0; i < pool.length; i++) {
      const idx = (start + i) % pool.length
      const { id, key } = pool[idx]
      let res, data
      try {
        res = await fetch(`${BASE_URL}/v2/music/generate`, {
          method: "POST",
          headers: { "X-API-Key": key, "Content-Type": "application/json" },
          body,
        })
        data = await res.json().catch(() => ({}))
      } catch (e) {
        lastErr = new Error(`Key ${maskKey(key)}: ${e.message}`)
        continue // error jaringan -> coba key berikutnya
      }

      if (res.ok) {
        const jobId = data.id || data.jobId || data.job_id || data?.data?.id || data?.data?.jobId || data?.data?.taskId
        if (!jobId) throw new Error("Respons APIframe tidak berisi job id: " + JSON.stringify(data).slice(0, 300))
        store.setKeyCursor((idx + 1) % pool.length) // giliran berikutnya
        return { jobId, status: mapStatus(data.status), keyId: id }
      }

      if (ROTATE_STATUS.has(res.status)) {
        if (res.status === 402 && id !== "env") store.updateKeyCredits(id, 0) // tandai habis
        lastErr = new Error(`Key ${maskKey(key)} (${res.status}): ${data.error || data.message || "limit/invalid"}`)
        continue // ROLLING ke key berikutnya
      }

      // Error lain (mis. 400 validasi) berlaku untuk semua key -> hentikan.
      throw new Error(data.error || data.message || data.msg || JSON.stringify(data).slice(0, 300) || `APIframe ${res.status}`)
    }

    throw new Error("Semua API key limit atau gagal. " + (lastErr ? lastErr.message : ""))
  },

  /**
   * Aransemen ulang / Cover: buat versi baru dari sebuah lagu yang sudah jadi
   * dengan gaya berbeda, tetapi melodi intinya dipertahankan.
   * Docs: POST /v2/music/suno/action  (action: "cover")
   * Penting: cover WAJIB memakai key yang sama dengan job induk (parentJobId
   * milik akun key tsb), jadi TIDAK ada rotasi key di sini.
   */
  async cover({ parentJobId, keyId, index, trackId, style, prompt, title, negativeTags, audioWeight }) {
    if (MOCK) {
      const jobId = "mock_" + Math.random().toString(36).slice(2, 12)
      const audioUrl = SAMPLE_AUDIO[Math.floor(Math.random() * SAMPLE_AUDIO.length)]
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl })
      return { jobId, status: "processing", keyId: keyId || "mock" }
    }

    if (!parentJobId) throw new Error("Lagu ini belum punya job induk dari APIframe, tidak bisa diaransemen ulang.")
    const key = resolveKey(keyId)
    if (!key) throw new Error("API key untuk lagu induk tidak ditemukan. Cover harus pakai key pembuat lagu aslinya.")

    const body = { parentJobId, action: "cover" }
    if (trackId) body.trackId = trackId
    else body.index = index === 2 ? 2 : 1
    if (style) body.style = String(style).slice(0, 1000)
    if (prompt) body.prompt = String(prompt).slice(0, 5000)
    if (title) body.title = String(title).slice(0, 80)
    if (negativeTags) body.negative_tags = String(negativeTags).slice(0, 500)
    if (audioWeight != null && !Number.isNaN(Number(audioWeight))) {
      body.audio_weight = Math.min(1, Math.max(0, Number(audioWeight)))
    }
    if (PUBLIC_URL.startsWith("https://")) {
      body.webhookUrl = `${PUBLIC_URL}/api/webhooks/provider`
      body.webhookEvents = ["completed", "failed"]
    }

    const res = await fetch(`${BASE_URL}/v2/music/suno/action`, {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))

    if (res.ok) {
      const jobId = data.id || data.jobId
      if (!jobId) throw new Error("Respons APIframe tidak berisi job id")
      return { jobId, status: mapStatus(data.status), keyId: keyId || "env" }
    }
    
    throw apiError(data.code || res.status, data.message || data.error)
  },

  /**
   * Cover from URL - create cover version from publicly accessible audio URL
   * Used when user uploads file but wants to use APIframe instead of sunoapi.org
   */
  async coverFromUrl({ audioUrl, style, prompt, title, negativeTags, audioWeight, instrumental, vocalGender }) {
    if (MOCK) {
      const jobId = "mock_" + Math.random().toString(36).slice(2, 12)
      const audio = SAMPLE_AUDIO[Math.floor(Math.random() * SAMPLE_AUDIO.length)]
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl: audio })
      return { jobId, status: "processing", keyId: "mock" }
    }

    const pool = poolForGenerate()
    if (!pool.length) {
      throw new Error("Belum ada API key APIframe. Tambahkan di Setelan API Key.")
    }

    const body = {
      audioUrl,
      action: "cover",
      style: String(style || "").slice(0, 1000),
    }
    
    if (prompt) body.prompt = String(prompt).slice(0, 5000)
    if (title) body.title = String(title).slice(0, 80)
    if (negativeTags) body.negative_tags = String(negativeTags).slice(0, 500)
    if (audioWeight != null && !Number.isNaN(Number(audioWeight))) {
      body.audio_weight = Math.min(1, Math.max(0, Number(audioWeight)))
    }
    if (instrumental) body.instrumental = true
    if (vocalGender === "male") body.vocal_gender = "m"
    else if (vocalGender === "female") body.vocal_gender = "f"
    
    if (PUBLIC_URL.startsWith("https://")) {
      body.webhookUrl = `${PUBLIC_URL}/api/webhooks/provider`
      body.webhookEvents = ["completed", "failed"]
    }

    const start = pool.length ? store.getKeyCursor() % pool.length : 0
    let lastErr = null

    for (let i = 0; i < pool.length; i++) {
      const idx = (start + i) % pool.length
      const { id, key } = pool[idx]
      let res, data
      try {
        res = await fetch(`${BASE_URL}/v2/music/suno/action`, {
          method: "POST",
          headers: { "X-API-Key": key, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        data = await res.json().catch(() => ({}))
      } catch (e) {
        lastErr = new Error(`Key ${maskKey(key)}: ${e.message}`)
        continue
      }

      if (res.ok) {
        const jobId = data.id || data.jobId || data.job_id
        if (!jobId) throw new Error("Respons APIframe tidak berisi job id")
        store.setKeyCursor((idx + 1) % pool.length)
        return { jobId, status: mapStatus(data.status), keyId: id }
      }

      if (ROTATE_STATUS.has(res.status)) {
        if (res.status === 402 && id !== "env") store.updateKeyCredits(id, 0)
        lastErr = new Error(`Key ${maskKey(key)} (${res.status}): ${data.error || data.message || "limit/invalid"}`)
        continue
      }

      throw new Error(data.error || data.message || data.msg || JSON.stringify(data).slice(0, 300) || `APIframe ${res.status}`)
    }

    throw new Error("Semua API key limit atau gagal. " + (lastErr ? lastErr.message : ""))
  },

  /**
   * Pisah stem (vokal & instrumen) dari sebuah track Suno yang sudah jadi.
   * Docs: POST /v2/music/suno/action (action: "stems"). Hasil berupa file audio
   * dan tidak bisa di-action lagi. Pakai key yang sama dengan job induk.
   */
  async stems({ parentJobId, keyId, index, trackId }) {
    if (MOCK) {
      const jobId = "mock_stem_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, {
        finishAt: Date.now() + MOCK_DELAY,
        stems: [
          { name: "Vokal", url: SAMPLE_AUDIO[0] },
          { name: "Instrumental", url: SAMPLE_AUDIO[1] },
        ],
      })
      return { jobId, status: "processing", keyId: keyId || "mock" }
    }

    if (!parentJobId) throw new Error("Lagu ini belum punya job induk dari APIframe, tidak bisa dipisah stem.")
    const key = resolveKey(keyId)
    if (!key) throw new Error("API key untuk lagu induk tidak ditemukan. Stem harus pakai key pembuat lagu aslinya.")

    const body = { parentJobId, action: "stems" }
    if (trackId) body.trackId = trackId
    else body.index = index === 2 ? 2 : 1
    if (PUBLIC_URL.startsWith("https://")) {
      body.webhookUrl = `${PUBLIC_URL}/api/webhooks/provider`
      body.webhookEvents = ["completed", "failed"]
    }

    const res = await fetch(`${BASE_URL}/v2/music/suno/action`, {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      const jobId = data.id || data.jobId
      if (!jobId) throw new Error("Respons APIframe tidak berisi job id")
      return { jobId, status: mapStatus(data.status), keyId: keyId || "env" }
    }
    if (res.status === 402) {
      if (keyId && keyId !== "env") store.updateKeyCredits(keyId, 0)
      throw new Error("Kredit key pembuat lagu ini habis. Stem harus pakai key yang sama, isi ulang kredit key tersebut dulu.")
    }
    if (res.status === 409) throw new Error("Lagu ini tidak bisa dipisah stem (mungkin hasil stems/cover atau dibuat sebelum fitur ini ada).")
    throw new Error(data.error || data.message || data.msg || JSON.stringify(data).slice(0, 300) || `APIframe ${res.status}`)
  },

  /** Cek status job stem -> GET /v2/jobs/:id (hasil di-parse jadi daftar stem). */
  async getStemStatus(jobId, keyId) {
    if (MOCK) {
      const job = mockJobs.get(jobId)
      if (!job) return { status: "failed" }
      if (Date.now() >= job.finishAt) return { status: "success", stems: job.stems || [] }
      return { status: "processing" }
    }

    const key = resolveKey(keyId)
    if (!key) throw new Error("API key untuk job ini tidak ditemukan")

    const res = await fetch(`${BASE_URL}/v2/jobs/${encodeURIComponent(jobId)}`, {
      headers: { "X-API-Key": key },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || data.message || data.msg || JSON.stringify(data).slice(0, 300) || `APIframe ${res.status}`)

    const status = mapStatus(data.status)
    if (status === "success") return { status, stems: parseStems(data.result) }
    if (status === "failed") return { status, error: data.error }
    return { status }
  },

  /** Cek status job memakai key yang membuatnya. */
  async getStatus(jobId, keyId) {
    if (MOCK) {
      const job = mockJobs.get(jobId)
      if (!job) return { status: "failed" }
      if (Date.now() >= job.finishAt) return { status: "success", audioUrl: job.audioUrl }
      return { status: "processing" }
    }

    const key = resolveKey(keyId)
    if (!key) throw new Error("API key untuk job ini tidak ditemukan")

    const res = await fetch(`${BASE_URL}/v2/jobs/${encodeURIComponent(jobId)}`, {
      headers: { "X-API-Key": key },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || data.message || data.msg || JSON.stringify(data).slice(0, 300) || `APIframe ${res.status}`)

    const status = mapStatus(data.status)
    if (status === "success") return { status, ...parseTracks(data) }
    if (status === "failed") return { status, error: data.error }
    return { status }
  },

  /** Cek sisa kredit sebuah key -> GET /v2/me (team.credits). */
  async checkCredits(key) {
    const res = await fetch(`${BASE_URL}/v2/me`, { headers: { "X-API-Key": key } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = res.status === 401 ? "Key tidak valid" : data.error || `APIframe ${res.status}`
      throw new Error(msg)
    }
    return Number(data?.team?.credits ?? 0)
  },

  /**
   * Verifikasi & parse webhook APIframe. Mencocokkan tanda tangan dengan
   * SHA256 dari salah satu key tersimpan (signing secret = SHA256(API_KEY)).
   * @returns {{ jobId, status, audioUrl?, imageUrl?, tracks?, error? } | null}
   */
  verifyWebhook(headers, rawBody) {
    if (MOCK) return null

    const signature = headers["x-webhook-signature"] || ""
    let ok = false
    for (const { key } of allKeys()) {
      const secret = createHash("sha256").update(key).digest("hex")
      const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex")
      if (signature.length === expected.length &&
        timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        ok = true
        break
      }
    }
    if (!ok) throw new Error("Tanda tangan webhook tidak valid")

    const body = JSON.parse(rawBody)
    const status = mapStatus(body.status)
    const out = { jobId: body.jobId, status }
    if (status === "success") Object.assign(out, parseTracks(body.result))
    if (status === "failed") out.error = body.error
    return out
  },
}

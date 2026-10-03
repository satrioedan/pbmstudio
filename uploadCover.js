// ============================================================================
// PROVIDER ADAPTER (kedua) -> sunoapi.org : UPLOAD & COVER AUDIO + MULTI KEY
// Dipakai khusus untuk fitur "Upload dari galeri lalu aransemen ulang".
//
// Alur:
//   1) Upload file audio lokal (base64) -> dapat downloadUrl publik
//      POST {FILE_BASE}/api/file-base64-upload   (Bearer KEY)
//   2) Aransemen ulang dari audio tsb (melodi inti dipertahankan, gaya baru)
//      POST {API_BASE}/api/v1/generate/upload-cover  (Bearer KEY) -> taskId
//   3) Cek status / ambil hasil
//      GET  {API_BASE}/api/v1/generate/record-info?taskId=...  (Bearer KEY)
//   4) Cek sisa kredit -> GET {API_BASE}/api/v1/generate/credit
//
// Multi key: seperti APIframe. Kunci sunoapi.org disimpan di store (Setelan
// API Key). Satu pekerjaan (upload + cover + polling) memakai SATU kunci yang
// sama karena taskId terikat ke akun kunci tsb. Saat memulai pekerjaan baru,
// kunci dipakai bergiliran (round-robin); bila sebuah kunci limit/invalid
// (HTTP 401/429/430) -> otomatis ROLLING ke kunci berikutnya.
//
// Mode mock (PROVIDER_MOCK=true) tetap jalan untuk tes UI tanpa kunci.
// ============================================================================

import { WEBHOOK_TOKEN } from "./config.js"
import { store, maskKey } from "./store.js"

const MOCK = String(process.env.PROVIDER_MOCK ?? "false") === "true"
const MOCK_DELAY = Number(process.env.MOCK_DELAY_SECONDS ?? 8) * 1000
const ENV_KEY = process.env.SUNOAPI_KEY || process.env.SUNO_API_KEY || ""
const API_BASE = (process.env.SUNOAPI_BASE_URL || "https://api.sunoapi.org").replace(/\/$/, "")
const FILE_BASE = (process.env.SUNOAPI_FILE_BASE_URL || "https://sunoapiorg.redpandaai.co").replace(/\/$/, "")
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "")

// Status yang memicu rotasi ke kunci berikutnya (limit / invalid / rate-limit).
const ROTATE_STATUS = new Set([401, 429, 430])
// Status yang berlaku untuk semua kunci -> hentikan, jangan rotasi.
const FATAL_STATUS = new Set([400, 404, 405, 413, 455, 500])

const SAMPLE_AUDIO = [
  "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb749d484.mp3",
  "https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3",
  "https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0c6ff1bab.mp3",
]
const mockJobs = new Map()

// Daftar model Suno yang valid untuk sunoapi.org.
export const UPLOAD_MODELS = ["V4", "V4_5", "V4_5PLUS", "V4_5ALL", "V5", "V5_5"]

// --------------------------- Kolam API key ----------------------------------

// Kunci untuk memulai pekerjaan: pakai kunci tersimpan; bila kosong -> env.
function poolForGenerate() {
  const keys = store.getUploadRawKeys()
  if (keys.length) return keys
  if (ENV_KEY) return [{ id: "env", key: ENV_KEY }]
  return []
}

// Cari kunci mentah dari id (untuk getStatus job tertentu).
function resolveKey(keyId) {
  if (keyId) {
    const k = store.getUploadKeyById(keyId)
    if (k) return k.key
    if (keyId === "env" && ENV_KEY) return ENV_KEY
  }
  const pool = poolForGenerate()
  return pool[0]?.key || null
}

// --------------------------------- Util -------------------------------------

function clamp01(n) {
  const v = Number(n)
  if (Number.isNaN(v)) return null
  return Math.min(1, Math.max(0, v))
}

function limStyle(model) { return model === "V4" ? 200 : 1000 }
function limTitle(model) { return (model === "V4" || model === "V4_5ALL") ? 80 : 100 }
function limPrompt(model) { return model === "V4" ? 3000 : 5000 }

function mapStatus(s) {
  switch ((s || "").toUpperCase()) {
    case "SUCCESS":
      return "success"
    case "CREATE_TASK_FAILED":
    case "GENERATE_AUDIO_FAILED":
    case "CALLBACK_EXCEPTION":
    case "SENSITIVE_WORD_ERROR":
      return "failed"
    case "PENDING":
    case "TEXT_SUCCESS":
    case "FIRST_SUCCESS":
    default:
      return "processing"
  }
}

function firstNonEmpty(...vals) {
  return vals.find((v) => typeof v === "string" && v.trim()) || null
}

function parseTracks(sunoData) {
  let tracks = Array.isArray(sunoData) ? sunoData : (sunoData ? [sunoData] : [])
  tracks = tracks.map((t, i) => ({
    id: t.id || t.audioId || t.audio_id || String(i + 1),
    audioUrl: firstNonEmpty(t.audioUrl, t.audio_url, t.url, t.sourceAudioUrl, t.streamAudioUrl, t.downloadUrl),
    imageUrl: firstNonEmpty(t.imageUrl, t.image_url, t.coverUrl, t.cover_url, t.thumbnailUrl),
    title: t.title || t.name || null,
    tags: t.tags || null,
    duration: t.duration || t.durationSec || null,
  })).filter((t) => t.audioUrl)
  const first = tracks[0] || {}
  return {
    audioUrl: first.audioUrl || null,
    imageUrl: first.imageUrl || null,
    tracks,
  }
}

// Status flag untuk task stem/WAV (PENDING/SUCCESS/*_FAILED/CALLBACK_EXCEPTION).
function mapFlag(s) {
  const v = (s || "").toUpperCase()
  if (v === "SUCCESS") return "success"
  if (v === "PENDING") return "processing"
  return /FAIL|ERROR|EXCEPTION/.test(v) ? "failed" : "processing"
}

// Label stem dari respons vocal-removal sunoapi.org.
const SUNO_STEM_LABELS = {
  vocalUrl: "Vokal", instrumentalUrl: "Instrumental", backingVocalsUrl: "Vokal latar",
  drumsUrl: "Drum", bassUrl: "Bass", guitarUrl: "Gitar", keyboardUrl: "Keyboard",
  percussionUrl: "Perkusi", stringsUrl: "Strings", synthUrl: "Synth", fxUrl: "Efek",
  brassUrl: "Brass", woodwindsUrl: "Tiup kayu", originUrl: "Asli (mix)",
}
function parseSunoStems(r) {
  const out = []
  const seen = new Set()
  const push = (name, url) => {
    if (!url || typeof url !== "string" || seen.has(url)) return
    seen.add(url)
    out.push({ name, url })
  }
  if (r && typeof r === "object") {
    for (const [k, label] of Object.entries(SUNO_STEM_LABELS)) push(label, r[k])
    if (Array.isArray(r.originData)) for (const it of r.originData) push(it.stem_type_group_name || "Stem", it.audio_url)
  }
  return out
}

const MSG = {
  400: "Parameter tidak valid",
  401: "Kunci sunoapi.org tidak valid",
  404: "Endpoint tidak ditemukan",
  405: "Terlalu sering, coba lagi",
  413: "Teks/prompt terlalu panjang",
  429: "Kredit sunoapi.org tidak cukup",
  430: "Terlalu sering memanggil API, tunggu sebentar",
  455: "Sistem sedang pemeliharaan",
  500: "Server sunoapi.org error",
}

// Kode error mentah dari provider (mis. status task sunoapi.org) -> pesan ramah + saran tindakan.
// Dipakai supaya user tidak melihat kode mentah seperti "SENSITIVE_WORD_ERROR" di kartu Library.
const ERROR_HINTS = {
  SENSITIVE_WORD_ERROR: 'Lirik atau gaya yang dimasukkan terdeteksi mengandung kata sensitif oleh provider. Ubah dulu isinya, lalu klik "Ulang" untuk generate ulang.',
  CREATE_TASK_FAILED: 'Provider gagal membuat tugas aransemen. Klik "Ulang" untuk mencoba lagi.',
  GENERATE_AUDIO_FAILED: 'Provider gagal menghasilkan audio dari file yang diunggah. Klik "Ulang" untuk mencoba lagi.',
  CALLBACK_EXCEPTION: 'Terjadi kesalahan saat provider mengirim hasil (callback). Klik "Ulang" untuk mencoba lagi.',
  UPLOAD_FAILED: 'Gagal mengunggah file audio ke provider. Periksa format/ukuran file lalu klik "Ulang".',
  TIMEOUT: 'Provider tidak merespons tepat waktu. Klik "Ulang" untuk mencoba lagi.',
}

function friendlyError(code, fallbackMsg) {
  const key = String(code || "").trim().toUpperCase()
  if (ERROR_HINTS[key]) return ERROR_HINTS[key]
  if (MSG[code]) return MSG[code]
  const fb = (fallbackMsg || "").toString().trim()
  if (fb) return fb
  return 'Gagal memproses audio. Klik "Ulang" untuk generate ulang.'
}

// Error dengan metadata untuk keputusan rotasi.
function apiError(code, msg) {
  const e = new Error(msg || MSG[code] || `sunoapi.org ${code}`)
  e.status = code
  e.fatal = FATAL_STATUS.has(code)
  e.rotate = ROTATE_STATUS.has(code)
  return e
}

// --------------------------- Operasi per-kunci ------------------------------

async function uploadAudioWith(key, { base64Data, fileName }) {
  const res = await fetch(`${FILE_BASE}/api/file-base64-upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      base64Data,
      uploadPath: "kampung-music",
      fileName: fileName || `audio-${Date.now()}.mp3`,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.success === false || data.code !== 200) {
    throw apiError(data.code || res.status, data.msg)
  }
  const url = data?.data?.downloadUrl
  if (!url) throw new Error("Upload berhasil tapi URL audio tidak ditemukan.")
  return url
}

async function coverWith(key, { uploadUrl, instrumental, style, prompt, title, model, vocalGender, negativeTags, audioWeight }) {
  const m = UPLOAD_MODELS.includes(model) ? model : "V4_5PLUS"
  const isInstrumental = !!instrumental
  const hasLyrics = !isInstrumental && !!String(prompt || "").trim()
  const customMode = isInstrumental || hasLyrics

  const body = { uploadUrl, customMode, instrumental: isInstrumental, model: m }
  if (customMode) {
    body.style = String(style || "").slice(0, limStyle(m))
    if (title) body.title = String(title).slice(0, limTitle(m))
    if (!isInstrumental) body.prompt = String(prompt || "").slice(0, limPrompt(m))
  } else {
    body.prompt = String(prompt || style || title || "cover version").slice(0, 500)
  }
  if (vocalGender === "male") body.vocalGender = "m"
  else if (vocalGender === "female") body.vocalGender = "f"
  if (negativeTags) body.negativeTags = String(negativeTags).slice(0, 500)
  const aw = clamp01(audioWeight)
  if (aw != null) body.audioWeight = aw

  body.callBackUrl = PUBLIC_URL.startsWith("https://")
    ? `${PUBLIC_URL}/api/webhooks/uploadcover?t=${WEBHOOK_TOKEN}`
    : "https://example.com/callback"

  const res = await fetch(`${API_BASE}/api/v1/generate/upload-cover`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.code !== 200) throw apiError(data.code || res.status, data.msg)
  const taskId = data?.data?.taskId
  if (!taskId) throw new Error("Respons sunoapi.org tidak berisi taskId.")
  return { jobId: taskId, status: "processing" }
}

// ------------------------------- Adapter ------------------------------------

export const uploadCover = {
  hasKey() {
    return MOCK || poolForGenerate().length > 0
  },

  /**
   * Upload audio lokal + aransemen ulang, dengan rotasi kunci otomatis.
   * Satu pekerjaan memakai satu kunci (upload & cover & polling konsisten).
   * @returns {Promise<{ jobId, status, keyId, uploadUrl }>}
   */
  async uploadAndCover(params) {
    if (MOCK) {
      const jobId = "sa_mock_" + Math.random().toString(36).slice(2, 12)
      const audioUrl = SAMPLE_AUDIO[Math.floor(Math.random() * SAMPLE_AUDIO.length)]
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl })
      return { jobId, status: "processing", keyId: "mock", uploadUrl: audioUrl }
    }

    if (!params.base64Data) throw new Error("Data audio kosong.")
    const pool = poolForGenerate()
    if (!pool.length) {
      throw new Error("Belum ada kunci sunoapi.org. Tambahkan di Setelan API Key bagian Upload & Cover.")
    }

    const start = store.getUploadKeyCursor() % pool.length
    let lastErr = null

    for (let i = 0; i < pool.length; i++) {
      const idx = (start + i) % pool.length
      const { id, key } = pool[idx]
      try {
        const uploadUrl = await uploadAudioWith(key, params)
        const job = await coverWith(key, { ...params, uploadUrl })
        store.setUploadKeyCursor((idx + 1) % pool.length) // giliran berikutnya
        return { ...job, keyId: id, uploadUrl }
      } catch (e) {
        lastErr = new Error(`Kunci ${maskKey(key)}: ${e.message}`)
        if (e.fatal) throw e // error global (mis. validasi) -> hentikan
        if (e.status === 429 && id !== "env") store.updateUploadKeyCredits(id, 0) // tandai habis
        // rotate / error jaringan -> coba kunci berikutnya
      }
    }
    throw new Error("Semua kunci sunoapi.org limit atau gagal. " + (lastErr ? lastErr.message : ""))
  },

  /**
   * Upload audio only (without cover) - returns public URL
   * Used when user wants to use APIframe for cover instead of sunoapi.org
   */
  async uploadAudioOnly({ base64Data, fileName }) {
    if (MOCK) {
      return SAMPLE_AUDIO[0]
    }

    if (!base64Data) throw new Error("Data audio kosong.")
    const pool = poolForGenerate()
    if (!pool.length) {
      throw new Error("Belum ada kunci sunoapi.org untuk upload file.")
    }

    const start = store.getUploadKeyCursor() % pool.length
    let lastErr = null

    for (let i = 0; i < pool.length; i++) {
      const idx = (start + i) % pool.length
      const { id, key } = pool[idx]
      try {
        const uploadUrl = await uploadAudioWith(key, { base64Data, fileName })
        store.setUploadKeyCursor((idx + 1) % pool.length)
        return uploadUrl
      } catch (e) {
        lastErr = new Error(`Kunci ${maskKey(key)}: ${e.message}`)
        if (e.fatal) throw e
        if (e.status === 429 && id !== "env") store.updateUploadKeyCredits(id, 0)
      }
    }
    throw new Error("Semua kunci sunoapi.org limit atau gagal. " + (lastErr ? lastErr.message : ""))
  },

  /**
   * Generate ulang (retry) cover dari uploadUrl yang sudah ada, tanpa upload file lagi.
   * Dipakai saat job sebelumnya gagal (mis. SENSITIVE_WORD_ERROR) dan user klik "Ulang" di kartu Library.
   */
  async retryCover(params) {
    if (MOCK) {
      const jobId = "sa_retry_" + Math.random().toString(36).slice(2, 12)
      const audioUrl = SAMPLE_AUDIO[Math.floor(Math.random() * SAMPLE_AUDIO.length)]
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl })
      return { jobId, status: "processing", keyId: "mock" }
    }
    if (!params.uploadUrl) throw new Error("URL audio sumber tidak ditemukan, tidak bisa generate ulang. Silakan upload ulang file audio secara manual.")

    const pool = poolForGenerate()
    if (!pool.length) throw new Error("Belum ada kunci sunoapi.org. Tambahkan di Setelan API Key bagian Upload & Cover.")

    // Coba kunci yang sama dengan job sebelumnya dulu (taskId lama terikat ke kunci itu),
    // baru rotasi ke kunci lain kalau kunci tsb sudah tidak valid/limit.
    const preferredIdx = params.keyId ? pool.findIndex((p) => p.id === params.keyId) : -1
    const startIdx = preferredIdx >= 0 ? preferredIdx : (cursor % pool.length)
    let lastErr = null

    for (let i = 0; i < pool.length; i++) {
      const idx = (startIdx + i) % pool.length
      const { id, key } = pool[idx]
      try {
        const job = await coverWith(key, params)
        if (preferredIdx < 0) cursor = (idx + 1) % pool.length
        return { ...job, keyId: id }
      } catch (e) {
        lastErr = new Error(`Kunci ${maskKey(key)}: ${e.message}`)
        if (e.fatal) throw e
        if (e.status === 429 && id !== "env") store.updateUploadKeyCredits(id, 0)
      }
    }
    throw new Error("Semua kunci sunoapi.org limit atau gagal. " + (lastErr ? lastErr.message : ""))
  },

  /** Cek status task -> GET record-info (pakai kunci pembuatnya). */
  async getStatus(taskId, keyId) {
    if (MOCK) {
      const job = mockJobs.get(taskId)
      if (!job) return { status: "failed" }
      if (Date.now() >= job.finishAt) return { status: "success", audioUrl: job.audioUrl }
      return { status: "processing" }
    }

    const key = resolveKey(keyId)
    if (!key) throw new Error("Kunci sunoapi.org untuk job ini tidak ditemukan.")

    const res = await fetch(`${API_BASE}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.code !== 200) throw apiError(data.code || res.status, data.msg)

    const d = data.data || {}
    const status = mapStatus(d.status)
    if (status === "success") return { status, ...parseTracks(d?.response?.sunoData || d?.response?.data || d?.response || d?.data) }
    if (status === "failed") return { status, error: friendlyError(d.status, d.errorMessage), errorCode: d.status || null }
    return { status }
  },

  /**
   * Pisah stem dari sebuah track sunoapi.org (butuh taskId + audioId).
   * Docs: POST /api/v1/vocal-removal/generate. Pakai kunci pembuat track.
   * type: "separate_vocal" (vokal+instrumental) | "split_stem" (per-instrumen).
   */
  async separateStems({ taskId, audioId, type, keyId }) {
    if (MOCK) {
      const jobId = "sa_stem_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, {
        finishAt: Date.now() + MOCK_DELAY,
        stems: [
          { name: "Vokal", url: SAMPLE_AUDIO[0] },
          { name: "Instrumental", url: SAMPLE_AUDIO[1] },
        ],
      })
      return { jobId, status: "processing", keyId: keyId || "mock" }
    }
    if (!taskId || !audioId) throw new Error("Lagu ini tidak punya taskId/audioId sunoapi.org, tidak bisa dipisah stem.")
    const key = resolveKey(keyId)
    if (!key) throw new Error("Kunci sunoapi.org untuk lagu ini tidak ditemukan.")

    const body = {
      taskId, audioId,
      type: type === "split_stem" ? "split_stem" : "separate_vocal",
      callBackUrl: PUBLIC_URL.startsWith("https://") ? `${PUBLIC_URL}/api/webhooks/uploadcover?t=${WEBHOOK_TOKEN}` : "https://example.com/callback",
    }
    const res = await fetch(`${API_BASE}/api/v1/vocal-removal/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.code !== 200) {
      if ((data.code || res.status) === 429 && keyId && keyId !== "env") store.updateUploadKeyCredits(keyId, 0)
      throw apiError(data.code || res.status, data.msg)
    }
    const newTask = data?.data?.taskId
    if (!newTask) throw new Error("Respons sunoapi.org tidak berisi taskId stem.")
    return { jobId: newTask, status: "processing" }
  },

  /** Cek status pemisahan stem -> GET /api/v1/vocal-removal/record-info. */
  async getStemStatus(taskId, keyId) {
    if (MOCK) {
      const job = mockJobs.get(taskId)
      if (!job) return { status: "failed" }
      if (Date.now() >= job.finishAt) return { status: "success", stems: job.stems || [] }
      return { status: "processing" }
    }
    const key = resolveKey(keyId)
    if (!key) throw new Error("Kunci sunoapi.org untuk job ini tidak ditemukan.")
    const res = await fetch(`${API_BASE}/api/v1/vocal-removal/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.code !== 200) throw apiError(data.code || res.status, data.msg)
    const d = data.data || {}
    const status = mapFlag(d.successFlag)
    if (status === "success") return { status, stems: parseSunoStems(d.response || {}) }
    if (status === "failed") return { status, error: d.errorMessage || "Gagal memisah stem" }
    return { status }
  },

  /** Konversi sebuah track ke WAV -> POST /api/v1/wav/generate. */
  async convertWav({ taskId, audioId, keyId }) {
    if (MOCK) {
      const jobId = "sa_wav_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, wavUrl: SAMPLE_AUDIO[0] })
      return { jobId, status: "processing", keyId: keyId || "mock" }
    }
    if (!taskId || !audioId) throw new Error("Lagu ini tidak punya taskId/audioId sunoapi.org, tidak bisa dikonversi WAV.")
    const key = resolveKey(keyId)
    if (!key) throw new Error("Kunci sunoapi.org untuk lagu ini tidak ditemukan.")

    const body = {
      taskId, audioId,
      callBackUrl: PUBLIC_URL.startsWith("https://") ? `${PUBLIC_URL}/api/webhooks/uploadcover?t=${WEBHOOK_TOKEN}` : "https://example.com/callback",
    }
    const res = await fetch(`${API_BASE}/api/v1/wav/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.code !== 200) {
      if ((data.code || res.status) === 429 && keyId && keyId !== "env") store.updateUploadKeyCredits(keyId, 0)
      throw apiError(data.code || res.status, data.msg)
    }
    const newTask = data?.data?.taskId
    if (!newTask) throw new Error("Respons sunoapi.org tidak berisi taskId WAV.")
    return { jobId: newTask, status: "processing" }
  },

  /** Cek status konversi WAV -> GET /api/v1/wav/record-info. */
  async getWavStatus(taskId, keyId) {
    if (MOCK) {
      const job = mockJobs.get(taskId)
      if (!job) return { status: "failed" }
      if (Date.now() >= job.finishAt) return { status: "success", wavUrl: job.wavUrl }
      return { status: "processing" }
    }
    const key = resolveKey(keyId)
    if (!key) throw new Error("Kunci sunoapi.org untuk job ini tidak ditemukan.")
    const res = await fetch(`${API_BASE}/api/v1/wav/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.code !== 200) throw apiError(data.code || res.status, data.msg)
    const d = data.data || {}
    const status = mapFlag(d.successFlag)
    if (status === "success") return { status, wavUrl: d?.response?.audioWavUrl || d.audioWavUrl || d?.response?.audio_wav_url || null }
    if (status === "failed") return { status, error: d.errorMessage || "Gagal konversi WAV" }
    return { status }
  },

  /** Cek sisa kredit sebuah kunci -> GET /api/v1/generate/credit. */
  async checkCredits(key) {
    const res = await fetch(`${API_BASE}/api/v1/generate/credit`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || (data.code && data.code !== 200)) {
      const msg = res.status === 401 ? "Kunci tidak valid" : data.msg || `sunoapi.org ${res.status}`
      throw new Error(msg)
    }
    const c = typeof data?.data === "number" ? data.data : (data?.data?.credits ?? data?.credits ?? 0)
    return Number(c) || 0
  },

  /**
   * Parse callback sunoapi.org (tanpa tanda tangan). Dipakai endpoint webhook.
   * @returns {{ jobId, status, audioUrl?, imageUrl?, tracks?, error? } | null}
   */
  parseCallback(rawBody) {
    if (MOCK) return null
    let body
    try { body = JSON.parse(rawBody) } catch { return null }
    const inner = body?.data || {}
    const jobId = inner.task_id || inner.taskId
    if (!jobId) return null
    const type = inner.callbackType
    if (type && type !== "complete") return { jobId, status: "processing" }
    const out = { jobId, status: "success" }
    const arr = Array.isArray(inner.data) ? inner.data : []
    const norm = arr.map((t) => ({
      id: t.id,
      audioUrl: t.audio_url,
      imageUrl: t.image_url,
      title: t.title,
      tags: t.tags,
      duration: t.duration,
    }))
    Object.assign(out, parseTracks(norm))
    if (body.code && body.code !== 200) {
      out.status = "failed"
      out.errorCode = String(body.code)
      out.error = friendlyError(body.code, body.msg)
    }
    return out
  },
}

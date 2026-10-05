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

const AUDIO_MIME = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac",
  ogg: "audio/ogg", aac: "audio/aac", opus: "audio/opus",
}

function mapVersion(model) {
  const fromCatalog = getModel(model)?.modelVersion
  if (fromCatalog) return fromCatalog
  const raw = String(model || "").toLowerCase().replace(/[_\s]/g, "")
  if (raw.includes("5.5") || raw.includes("55")) return "v5.5"
  if (raw.includes("4.5plus") || raw.includes("45plus") || raw.includes("4.5+")) return "v4.5plus"
  if (raw.includes("4.5all") || raw.includes("45all")) return "v4.5all"
  if (raw.includes("4.5") || raw.includes("45")) return "v4.5"
  if (raw.includes("v4")) return "v4"
  return "v5"
}

function vocalCode(vocalGender) {
  if (vocalGender === "male") return "m"
  if (vocalGender === "female") return "f"
  return null
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

function buildCoverBody({ audioUrl, title, lyrics, prompt, style, instrumental, vocalGender, model, negativeTags, audioWeight }) {
  const version = mapVersion(model)
  const isV4 = version === "v4"
  const lyricText = String(lyrics || "").trim()
  const styleText = String(style || prompt || "").trim()
  const titleText = String(title || "").trim()
  const input = { audio_url: audioUrl, model: version, instrumental: !!instrumental }
  const gender = vocalCode(vocalGender)
  // Custom hanya bila lirik ada (atau instrumental). Tanpa lirik, simple mode cukup.
  if (lyricText || instrumental) {
    input.mode = "custom"
    input.title = (titleText || "Cover").slice(0, 80)
    input.tags = (styleText || "pop").slice(0, isV4 ? 200 : 1000)
    if (!instrumental) input.lyrics = lyricText.slice(0, isV4 ? 3000 : 5000)
    if (gender) input.vocal_gender = gender
    if (negativeTags) input.negative_tags = String(negativeTags).slice(0, 500)
    const weight = Number(audioWeight)
    if (Number.isFinite(weight)) input.audio_weight = Math.min(1, Math.max(0, weight > 1 ? weight / 100 : weight))
  } else {
    input.mode = "simple"
    input.prompt = (styleText || titleText || "cover in a new style").slice(0, 500)
  }
  return { model: "suno/music-cover", input }
}

function sourceIds({ taskId, sunoId }) {
  if (!taskId || !sunoId || /^\d+$/.test(String(sunoId))) {
    throw new Error("Lagu ini belum punya Suno ID. Stem dan video hanya untuk lagu yang selesai dari crun.ai.")
  }
  return { taskId, sunoId }
}

const STEM_LABELS = {
  vocal_url: "Vokal",
  instrumental_url: "Instrumen",
  backing_vocals_url: "Backing vokal",
  drums_url: "Drum",
  bass_url: "Bass",
  guitar_url: "Gitar",
  keyboard_url: "Keyboard",
  percussion_url: "Perkusi",
  strings_url: "Strings",
  synth_url: "Synth",
  fx_url: "FX",
}

function parseStemTask(task) {
  const status = mapStatus(task?.status)
  if (status !== "success") {
    return status === "failed" ? { status, error: task?.result?.message || "Pemisahan stem gagal" } : { status }
  }
  const info = task?.result?.media_info || {}
  const stems = Object.entries(STEM_LABELS)
    .filter(([key]) => typeof info[key] === "string" && info[key])
    .map(([key, name]) => ({ name, url: info[key] }))
  if (!stems.length) return { status: "processing" }
  return { status: "success", stems }
}

function parseVideoTask(task) {
  const status = mapStatus(task?.status)
  if (status !== "success") {
    return status === "failed" ? { status, error: task?.result?.message || "Video gagal" } : { status }
  }
  const urls = []
  const info = task?.result?.media_info || {}
  if (info.video_url) urls.push(info.video_url)
  if (Array.isArray(task?.result?.media_urls)) urls.push(...task.result.media_urls.filter((u) => typeof u === "string"))
  const videoUrl = urls.find((u) => /\.mp4|video/i.test(u)) || urls[0] || null
  if (!videoUrl) return { status: "processing" }
  return { status: "success", videoUrl }
}

async function fetchTask(jobId, keyId) {
  const key = resolveKey(keyId)
  if (!key) throw new Error("API key crun.ai untuk job ini tidak ditemukan")
  const r = await call(`/api/v1/client/job/TaskInfo?task_id=${encodeURIComponent(jobId)}`, key)
  if (!r.ok) throw new Error(errorMessage(r.data, r.code))
  return r.data?.data
}

async function submitTask(body) {
  const pool = poolForGenerate()
  if (!pool.length) throw new Error("Belum ada API key crun.ai. Tambahkan di Setelan API Key bagian crun.ai.")
  const payload = JSON.stringify(body)
  const start = store.getCrunKeyCursor() % pool.length
  let lastErr = null
  for (let i = 0; i < pool.length; i++) {
    const idx = (start + i) % pool.length
    const { id, key } = pool[idx]
    let r
    try {
      r = await call("/api/v1/client/job/CreateTask", key, { method: "POST", body: payload })
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
}

export const crunProvider = {
  hasKey() { return poolForGenerate().length > 0 },

  async generate(input) {
    if (MOCK) {
      const jobId = "crun_mock_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl: SAMPLE_AUDIO[Math.floor(Math.random() * SAMPLE_AUDIO.length)] })
      return { jobId, status: "processing", keyId: "mock" }
    }
    return submitTask(buildBody(input))
  },

  async uploadAudio({ base64Data, fileName }) {
    const pool = poolForGenerate()
    if (!pool.length) throw new Error("Belum ada API key crun.ai. Tambahkan di Setelan API Key bagian crun.ai.")
    const extMatch = String(fileName || "").match(/\.(mp3|wav|m4a|flac|ogg|aac|opus)$/i)
    const ext = extMatch ? "." + extMatch[1].toLowerCase() : ".mp3"
    const contentType = AUDIO_MIME[ext.slice(1)] || "audio/mpeg"
    const bytes = Buffer.from(String(base64Data || ""), "base64")
    if (!bytes.length) throw new Error("File audio kosong")
    const { id, key } = pool[store.getCrunKeyCursor() % pool.length]
    const q = new URLSearchParams({ content_type: contentType, ext })
    const r = await call(`/api/v1/client/files/upload-url?${q}`, key)
    if (!r.ok) throw new Error(errorMessage(r.data, r.code))
    const presigned = r.data?.data?.presigned_url
    const fileUrl = r.data?.data?.file_url
    if (!presigned || !fileUrl) throw new Error("crun.ai tidak memberi URL upload")
    const put = await fetch(presigned, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes })
    if (!put.ok) throw new Error("Upload audio ke crun.ai gagal (" + put.status + ")")
    return { fileUrl, keyId: id }
  },

  async cover(input) {
    if (!input?.audioUrl || !/^https?:\/\//.test(input.audioUrl)) {
      throw new Error("Cover crun.ai butuh URL audio publik dari lagu sumber")
    }
    if (MOCK) {
      const jobId = "crun_cover_mock_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl: SAMPLE_AUDIO[0] })
      return { jobId, status: "processing", keyId: "mock", uploadUrl: input.audioUrl }
    }
    const job = await submitTask(buildCoverBody(input))
    return { ...job, uploadUrl: input.audioUrl }
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

  async stems({ taskId, sunoId, trackId, type }) {
    const ids = sourceIds({ taskId, sunoId: sunoId || trackId })
    const mode = type === "split_stem" ? "instrumental" : "vocal"
    if (MOCK) {
      const jobId = "crun_stem_mock_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, {
        finishAt: Date.now() + MOCK_DELAY,
        stems: mode === "instrumental"
          ? [{ name: "Drum", url: SAMPLE_AUDIO[0] }, { name: "Bass", url: SAMPLE_AUDIO[1] }, { name: "Vokal", url: SAMPLE_AUDIO[0] }]
          : [{ name: "Vokal", url: SAMPLE_AUDIO[0] }, { name: "Instrumen", url: SAMPLE_AUDIO[1] }],
      })
      return { jobId, status: "processing", keyId: "mock" }
    }
    return submitTask({
      model: "suno/vocal-separatio",
      input: { task_id: ids.taskId, suno_id: ids.sunoId, mode },
    })
  },

  async getStemStatus(jobId, keyId) {
    if (MOCK) {
      const job = mockJobs.get(jobId)
      if (!job) return { status: "failed", error: "Mock job tidak ditemukan" }
      if (Date.now() >= job.finishAt) return { status: "success", stems: job.stems || [] }
      return { status: "processing" }
    }
    const task = await fetchTask(jobId, keyId)
    return parseStemTask(task)
  },

  async extend(input) {
    const sunoId = input?.sunoId || input?.trackId
    if (!sunoId || /^\d+$/.test(String(sunoId))) {
      throw new Error("Lagu ini belum punya Suno ID. Perpanjang hanya untuk lagu yang selesai dari crun.ai.")
    }
    const version = mapVersion(input.model)
    const isV4 = version === "v4"
    const title = String(input.title || "Extended").slice(0, 80)
    const tags = String(input.style || "pop").slice(0, isV4 ? 200 : 1000)
    const prompt = String(input.lyrics || input.style || "continue the song with a new section and outro").slice(0, isV4 ? 3000 : 5000)
    const continueAt = Number(input.continueAt)
    const bodyInput = {
      suno_id: sunoId,
      mode: "custom",
      model: version,
      continue_at: Number.isFinite(continueAt) && continueAt >= 0 ? continueAt : 30,
      title,
      tags,
      prompt,
    }
    const gender = vocalCode(input.vocalGender)
    if (gender) bodyInput.vocal_gender = gender
    if (input.instrumental) bodyInput.instrumental = true
    if (MOCK) {
      const jobId = "crun_ext_mock_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, audioUrl: SAMPLE_AUDIO[1] })
      return { jobId, status: "processing", keyId: "mock" }
    }
    return submitTask({ model: "suno/music-extend", input: bodyInput })
  },

  async video({ taskId, sunoId, author, brand }) {
    const ids = sourceIds({ taskId, sunoId })
    const input = { task_id: ids.taskId, suno_id: ids.sunoId }
    if (author) input.author = String(author).slice(0, 80)
    if (brand) input.brand = String(brand).slice(0, 80)
    if (MOCK) {
      const jobId = "crun_vid_mock_" + Math.random().toString(36).slice(2, 12)
      mockJobs.set(jobId, { finishAt: Date.now() + MOCK_DELAY, videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" })
      return { jobId, status: "processing", keyId: "mock" }
    }
    return submitTask({ model: "suno/music-video", input })
  },

  async getVideoStatus(jobId, keyId) {
    if (MOCK) {
      const job = mockJobs.get(jobId)
      if (!job) return { status: "failed", error: "Mock job tidak ditemukan" }
      if (Date.now() >= job.finishAt) return { status: "success", videoUrl: job.videoUrl }
      return { status: "processing" }
    }
    return parseVideoTask(await fetchTask(jobId, keyId))
  },

  async checkCredits(key) {
    const r = await call("/api/v1/client/account/balance", key)
    if (!r.ok) throw new Error(r.code === 401 ? "Key tidak valid" : r.code === 403 ? "Key nonaktif" : errorMessage(r.data, r.code))
    const body = r.data?.data && typeof r.data.data === "object" ? r.data.data : r.data
    const value = body?.balance ?? body?.credits ?? body?.credit ?? body?.remaining
    const credits = Number(value)
    if (!Number.isFinite(credits)) throw new Error("Saldo crun.ai tidak terbaca")
    return credits
  },
}

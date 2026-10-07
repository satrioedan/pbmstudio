// ============================================================================
// GEJEMUZIK - Backend (Node bawaan, tanpa dependency)
// Menyajikan frontend statis + REST API + polling status provider.
// ============================================================================

// Vercel hanya menerima entrypoint Express jika file ini mengimpor express.
// Routing tetap lewat node:http di bawah; impor ini tidak mengubah handler.
import express from "express"
void express
import {createPersona, resolvePersona} from "./persona.js"
import { WEBHOOK_TOKEN } from "./config.js"
import { createServer } from "node:http"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join, extname, normalize } from "node:path"
import { randomUUID } from "node:crypto"
import { MODELS, getModel } from "./models.js"
import { provider } from "./providers.js"
import { uploadCover, UPLOAD_MODELS } from "./uploadCover.js"
import { gemini, GEMINI_MODELS } from "./gemini.js"
import { kieUploadCover } from "./kieCover.presets-20260910.js"
import { kieProvider } from "./kieProvider.presets-20260910.js"
import { musicapiProvider } from "./musicapiProvider.js"
import { crunProvider } from "./crunProvider.js"
import { store, withOwner, storeReady, flushStore, beginRequest, endRequest } from "./store.js"

// BASE_PATH: dukungan pemasangan di sub-path (mis. https://host/evo/).
// Kosong = root. Non-kosong = leading slash, no trailing slash (e.g. "/evo").
const BASE_PATH = (() => {
  let p = String(process.env.BASE_PATH || "").trim()
  if (!p || p === "/") return ""
  if (!p.startsWith("/")) p = "/" + p
  while (p.endsWith("/")) p = p.slice(0, -1)
  return p
})()

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, "public")
const PORT = Number(process.env.PORT ?? 3000)
const PUBLIC_URL = String(process.env.PUBLIC_URL || "https://ulas.tech").replace(/\/$/, "")

const LIMITS = { title: 80, lyrics: 5000, style: 1000 }
const COVER_COST = 11 // kredit aransemen ulang / cover (Suno action)
const UPLOAD_COVER_COST = 11 // kredit upload & cover (sunoapi.org)
const STEM_COST = 11 // kredit pisah stem
const WAV_COST = 6 // kredit konversi WAV (virtual)
const UPLOAD_MAX_BYTES = 40e6 // batas body upload audio base64 (~40MB)

// Ubah kode error mentah dari provider (mis. "SENSITIVE_WORD_ERROR") jadi kalimat yang
// dipahami user, supaya kartu Library tidak menampilkan kode mentah. Provider seperti
// uploadCover.js sudah mengembalikan pesan ramah sendiri, jadi fungsi ini hanya jadi
// pengaman generik untuk provider lain yang mungkin mengembalikan kode mentah.
function humanizeError(raw) {
  const s = String(raw || "").trim()
  if (!s) return null
  if (/^[A-Z][A-Z0-9_]{3,60}$/.test(s)) {
    return `Provider melaporkan error "${s}". Klik "Ulang" untuk generate ulang, atau ubah gaya/lirik jika errornya terkait konten.`
  }
  return s
}

function boostLyricsLocally(lyrics, title, style) {
  const raw = String(lyrics || "").trim()
  const hook = (title || raw.split(/\n/).map((l) => l.trim()).find(Boolean) || "Ini laguku").replace(/^\[.*?\]\s*/, "")
  const flavor = style ? style.split(",")[0].trim() : "melodi yang hangat"
  if (!raw) {
    return [
      "[Verse 1]",
      `${hook} datang pelan, tapi tidak mau pergi`,
      `Di ${flavor}, aku simpan semua yang tersisa`,
      "Satu kalimat kecil jadi alasan untuk bertahan",
      "Dan malam ini suaranya lebih jujur dari kemarin",
      "",
      "[Pre-Chorus]",
      "Pelan dulu, lalu biarkan nadanya naik",
      "Aku tahu bagian ini yang akan kau ingat",
      "",
      "[Chorus]",
      hook,
      `${hook}, ulang sampai jadi rumah`,
      "Simpan di kepala, jangan dilepas",
      `${hook}, ini hook yang pulang sendiri`,
      "",
      "[Verse 2]",
      "Detail yang dulu sepele sekarang jadi bukti",
      "Aku sebut namamu tanpa perlu berteriak",
      "Kalau dunia ramai, chorus ini yang menuntun",
      "Dan aku tetap di baris yang paling mudah diingat",
      "",
      "[Bridge]",
      "Bukan soal sempurna, soal terasa dekat",
      "Satu nada turun, lalu semua kembali naik",
      "",
      "[Chorus]",
      hook,
      `${hook}, ulang sampai jadi rumah`,
      "",
      "[Outro]",
      hook,
    ].join("\n").slice(0, 5000)
  }
  if (/\[chorus\]/i.test(raw) && /\[verse/i.test(raw)) {
    return raw.includes(hook) ? raw : `${raw}\n\n[Chorus]\n${hook}\n${hook}`.slice(0, 5000)
  }
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter((l) => l && !/^\[/.test(l))
  const take = (start, count) => lines.slice(start, start + count).join("\n") || hook
  return [
    "[Verse 1]",
    take(0, 4),
    "",
    "[Pre-Chorus]",
    lines[4] || "Dan aku tahu ini baru mulai",
    "",
    "[Chorus]",
    hook,
    lines[0] || hook,
    `${hook}, jangan lupa baris ini`,
    "",
    "[Verse 2]",
    take(5, 4),
    "",
    "[Bridge]",
    lines.at(-1) || "Kalau sunyi, chorus ini yang menjawab",
    "",
    "[Chorus]",
    hook,
    lines[0] || hook,
    "",
    "[Outro]",
    hook,
  ].join("\n").slice(0, 5000)
}

function sumCredits(keys) {
  return (Array.isArray(keys) ? keys : []).reduce((sum, key) => {
    if (key.credits === null || key.credits === undefined || key.credits === "") return sum
    const value = Number(key.credits)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
}

function byteSlice(data, header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || ""))
  if (!m || (m[1] === "" && m[2] === "")) return null
  const size = data.length
  let start = m[1] === "" ? null : Number(m[1])
  let end = m[2] === "" ? null : Number(m[2])
  if (start === null) {
    start = Math.max(0, size - end)
    end = size - 1
  } else if (end === null || end >= size) end = size - 1
  if (!Number.isFinite(start) || start < 0 || start >= size || start > end) return { invalid: true }
  return { start, end, chunk: data.subarray(start, end + 1) }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
}

// Folder lokal untuk file hasil Mastering (tidak lewat provider AI eksternal).
const MASTERED_DIR = join(PUBLIC_DIR, "uploads", "mastered")

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  res.end(body)
}

function parseCookies(header = "") {
  const out = {}
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}
function safeOwnerId(v) {
  const s = String(v || "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80)
  return s || randomUUID()
}
function getOwnerId(req, res) {
  const cookies = parseCookies(req.headers.cookie || "")
  const fromHeader = req.headers["x-gjm-client"]
  const owner = safeOwnerId(Array.isArray(fromHeader) ? fromHeader[0] : fromHeader || cookies.gjm_client)
  // Cookie membuat <audio>, download, dan tab baru tetap memakai owner/device yang sama.
  res.setHeader("Set-Cookie", `gjm_client=${encodeURIComponent(owner)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`)
  return owner
}

function readBody(req, maxBytes = 1e7) {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (c) => {
      data += c
      if (data.length > maxBytes) reject(new Error("Payload terlalu besar"))
    })
    req.on("end", () => {
      if (!data) return resolve({})
      try { resolve(JSON.parse(data)) } catch { reject(new Error("JSON tidak valid")) }
    })
    req.on("error", reject)
  })
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (c) => {
      data += c
      if (data.length > 1e7) reject(new Error("Payload terlalu besar"))
    })
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

// --------------------------------- API --------------------------------------

async function handleApi(req, res, url) {
  const { pathname } = url
  const method = req.method

  if(method === "POST" && pathname === "/api/personas") {
    try { return sendJson(res, 201, await createPersona(await readBody(req))) }
    catch(e) { return sendJson(res, 400, {error:e.message}) }
  }
  // GET /api/models
  if (method === "GET" && pathname === "/api/models") {
    return sendJson(res, 200, { models: MODELS, uploadModels: UPLOAD_MODELS, geminiModels: GEMINI_MODELS })
  }

  // GET /api/credits
  if (method === "GET" && pathname === "/api/credits") {
    return sendJson(res, 200, store.getAllCredits())
  }

  // GET /api/songs?liked=true
  if (method === "GET" && pathname === "/api/songs") {
    const liked = url.searchParams.get("liked") === "true"
    return sendJson(res, 200, { songs: store.listSongs({ liked }) })
  }

  // POST /api/songs
  if (method === "POST" && pathname === "/api/songs") {
    const body = await readBody(req)
    const title = (body.title || "").toString().slice(0, LIMITS.title)
    const lyrics = (body.lyrics || "").toString().slice(0, LIMITS.lyrics)
    const style = (body.style || "").toString().slice(0, LIMITS.style)
    const type = body.type === "instrumental" ? "instrumental" : "vocal"
    const vocalGender = ["male", "female", "auto"].includes(body.vocalGender) ? body.vocalGender : "auto"
    const modelId = body.model

    const m = getModel(modelId)
    if (!m) return sendJson(res, 400, { error: "Model tidak valid" })
    if (!style.trim()) return sendJson(res, 400, { error: "Deskripsi Utama (style) wajib diisi" })
    const modelProvider = m.provider || "apiframe"
    let voice = {}
    try { voice = resolvePersona(body.personaRef) } catch(e) { return sendJson(res,400,{error:e.message}) }
    if(voice.personaId && (modelProvider !== "kie" || type === "instrumental")) return sendJson(res,400,{error:"Profil penyanyi hanya untuk lagu vokal KIE."})
    const adapter = modelProvider === "kie" ? kieProvider : modelProvider === "musicapi" ? musicapiProvider : modelProvider === "crun" ? crunProvider : provider
    // Hanya APIframe yang memakai dompet kredit virtual internal. KIE dan
    // MusicAPI memvalidasi saldo langsung melalui API key provider masing-masing.
    if (modelProvider === "apiframe" && store.getCredits("apiframe") < m.credits) {
      return sendJson(res, 402, { error: "Kredit APIframe tidak cukup" })
    }

    let job
    try {
      job = await adapter.generate({ title, lyrics, style, type, vocalGender, model: modelId, ...voice })
    } catch (e) {
      return sendJson(res, 502, { error: "Provider gagal: " + e.message })
    }

    if (modelProvider === "apiframe") store.deductCredits("apiframe", m.credits)
    const now = Date.now()
    const song = store.addSong({
      id: randomUUID(),
      title: title || "(Tanpa judul)",
      lyrics, style, type, vocalGender, personaRef: voice.personaRef || null,
      model: modelId, modelLabel: m.label, credits: m.credits,
      status: job.status || "processing",
      audioUrl: null, imageUrl: null, tracks: [], error: null, liked: false,
      provider: modelProvider,
      providerJobId: job.jobId,
      providerKeyId: job.keyId || null,
      createdAt: now, updatedAt: now,
    })
    return sendJson(res, 201, { song, credits: store.getAllCredits() })
  }

  // POST /api/mastering/save -> simpan hasil render Mastering Studio (proses lokal di browser, gratis, tanpa kredit AI)
  if (method === "POST" && pathname === "/api/mastering/save") {
    const body = await readBody(req, UPLOAD_MAX_BYTES)
    const base64Data = (body.base64Data || "").toString()
    if (!base64Data) return sendJson(res, 400, { error: "Data audio hasil mastering kosong" })
    const title = (body.title || "Mastered Track").toString().slice(0, LIMITS.title)
    const sourceSongId = body.sourceSongId ? String(body.sourceSongId) : null
    let buf
    try { buf = Buffer.from(base64Data, "base64") } catch { return sendJson(res, 400, { error: "Data audio tidak valid" }) }
    if (!buf.length) return sendJson(res, 400, { error: "Data audio tidak valid" })

    try { await mkdir(MASTERED_DIR, { recursive: true }) } catch (e) { return sendJson(res, 500, { error: "Gagal menyiapkan folder mastering: " + e.message }) }
    const requestedExt = extname(String(body.fileName || "")).toLowerCase()
    const audioExt = requestedExt === ".mp3" ? ".mp3" : ".wav"
    const fileId = randomUUID()
    const fileName = `${fileId}${audioExt}`
    try { await writeFile(join(MASTERED_DIR, fileName), buf) }
    catch (e) { return sendJson(res, 500, { error: "Gagal menyimpan file mastering: " + e.message }) }

    const now = Date.now()
    const audioUrl = `/uploads/mastered/${fileName}`
    const song = store.addSong({
      id: randomUUID(),
      title,
      lyrics: "", style: "", type: "vocal", vocalGender: "auto",
      model: null, modelLabel: "Mastering Studio", credits: 0,
      status: "success",
      audioUrl, imageUrl: null, tracks: [], error: null, liked: false,
      provider: "mastering", isMastered: true, sourceSongId,
      providerJobId: null, providerKeyId: null,
      createdAt: now, updatedAt: now,
    })
    return sendJson(res, 201, { song, credits: store.getAllCredits() })
  }

  // POST /api/upload-cover  -> upload audio dari galeri lalu aransemen ulang
  // Upload Cover: SunoAPI or KIE AI
  if (method === "POST" && pathname === "/api/upload-cover") {
    const body = await readBody(req, UPLOAD_MAX_BYTES)
    const base64Data = (body.base64Data || "").toString()
    const fileName = (body.fileName || "").toString().slice(0, 120)
    const style = (body.style || "").toString().slice(0, LIMITS.style)
    const prompt = (body.prompt || "").toString().slice(0, LIMITS.lyrics)
    const title = (body.title || "").toString().slice(0, LIMITS.title)
    const negativeTags = (body.negativeTags || "").toString().slice(0, 500)
    const audioWeight = body.audioWeight
    const instrumental = body.instrumental === true || body.type === "instrumental"
    const vocalGender = ["male", "female", "auto"].includes(body.vocalGender) ? body.vocalGender : "auto"
    if (body.provider && !["sunoapi", "kie", "crun"].includes(body.provider)) return sendJson(res, 400, { error: "Provider cover tidak dikenal. Pilih crun.ai, KIE API, atau SunoAPI." })
    const selectedProvider = body.provider === "kie" ? "kie" : body.provider === "crun" ? "crun" : "sunoapi"
    const supportedCoverModels = selectedProvider === "kie" ? ["V4", "V4_5", "V4_5PLUS", "V4_5ALL", "V5", "V5_5"] : UPLOAD_MODELS
    const model = supportedCoverModels.includes(body.model) ? body.model : "V4_5PLUS"

    if (!base64Data) return sendJson(res, 400, { error: "File audio belum diupload" })
    const audioExt = /\.(mp3|wav|m4a|flac|ogg|aac|wma|aiff|opus)$/i.test(fileName)
    if (!audioExt) return sendJson(res, 400, { error: "Format file tidak didukung. Gunakan mp3, wav, m4a, flac, ogg, atau aac." })
    if (!style.trim()) return sendJson(res, 400, { error: "Gaya/genre baru wajib diisi" })

    let voice = {}
    try { voice = resolvePersona(body.personaRef) } catch(e) { return sendJson(res,400,{error:e.message}) }
    if(voice.personaId && (selectedProvider !== "kie" || instrumental || !prompt.trim())) return sendJson(res,400,{error:"Profil penyanyi untuk Cover membutuhkan KIE, mode vokal, dan lirik custom."})
    let job, providerName, creditType, cost
    let uploadUrl = null
    
    if (selectedProvider === "crun") {
      if (!crunProvider.hasKey()) return sendJson(res, 400, { error: "Belum ada API key crun.ai. Tambahkan di Setelan API Key bagian crun.ai." })
      try {
        const uploaded = await crunProvider.uploadAudio({ base64Data, fileName })
        uploadUrl = uploaded.fileUrl
        job = await crunProvider.cover({
          audioUrl: uploadUrl, instrumental, style, lyrics: prompt, prompt, title, model, vocalGender, negativeTags, audioWeight,
        })
      } catch (e) {
        return sendJson(res, 502, { error: "crun.ai gagal: " + e.message })
      }
      providerName = "crun"
      creditType = null
      cost = UPLOAD_COVER_COST
    } else if (selectedProvider === "sunoapi") {
      // Use sunoapi.org upload & cover
      if (!uploadCover.hasKey()) {
        return sendJson(res, 400, { error: "Belum ada kunci sunoapi.org. Atur di Setelan API Key bagian Upload & Cover." })
      }
      if (store.getCredits("suno") < UPLOAD_COVER_COST) {
        return sendJson(res, 402, { error: "Kredit sunoapi.org tidak cukup" })
      }
      
      try {
        job = await uploadCover.uploadAndCover({
          base64Data, fileName, instrumental, style, prompt, title, model, vocalGender, negativeTags, audioWeight,
        })
      } catch (e) {
        return sendJson(res, 502, { error: "sunoapi.org gagal: " + e.message })
      }
      uploadUrl = job.uploadUrl || null
      
      providerName = "uploadcover"
      creditType = "suno"
      cost = UPLOAD_COVER_COST
      
    } else {
      try {
        job = await kieUploadCover({base64Data, fileName, instrumental, style, prompt, title, model, vocalGender, negativeTags, audioWeight, ...voice})
      } catch (e) { return sendJson(res, 502, {error: e.message}) }
      uploadUrl = job.uploadUrl
      providerName = "kie"
      creditType = null
      cost = UPLOAD_COVER_COST
    }

    if (creditType) store.deductCredits(creditType, cost)
    const now = Date.now()
    const song = store.addSong({
      id: randomUUID(),
      title: title || (fileName ? fileName.replace(/\.[^.]+$/, "") + " (Aransemen)" : "Aransemen dari upload"),
      lyrics: prompt,
      style,
      type: instrumental ? "instrumental" : "vocal",
      vocalGender,
      model, 
      modelLabel: selectedProvider === "sunoapi" ? "sunoapi.org " + model : selectedProvider === "crun" ? "crun.ai Cover " + model : "KIE Cover " + model,
      credits: cost,
      status: job.status || "processing",
      audioUrl: null, imageUrl: null, tracks: [], error: null, liked: false,
      provider: providerName,
      providerJobId: job.jobId,
      providerKeyId: job.keyId || null,
      personaRef: voice.personaRef || null,
      isCover: true, isUpload: true, sourceFile: fileName || null,
      uploadUrl, negativeTags: negativeTags || null, audioWeight: (audioWeight === undefined ? null : audioWeight),
      createdAt: now, updatedAt: now,
    })
    return sendJson(res, 201, { song, credits: store.getAllCredits() })
  }

  // Routes dengan :id
  const idMatch = pathname.match(/^\/api\/songs\/([^/]+)(\/like|\/cover|\/stems|\/wav|\/download|\/stream|\/retry|\/extend|\/video)?$/)
  if (idMatch) {
    const id = idMatch[1]
    const sub = idMatch[2] || ""
    const song = store.getSong(id)
    if (!song) return sendJson(res, 404, { error: "Lagu tidak ditemukan" })

    // PATCH /api/songs/:id/like
    if (method === "PATCH" && sub === "/like") {
      const updated = store.updateSong(id, { liked: !song.liked })
      return sendJson(res, 200, { song: updated })
    }

    // POST /api/songs/:id/cover  -> aransemen ulang lagu jadi gaya baru
    if (method === "POST" && sub === "/cover") {
      if (song.status !== "success") {
        return sendJson(res, 400, { error: "Lagu harus selesai dulu sebelum diaransemen ulang" })
      }
      if (song.provider === "crun") {
        if (!song.audioUrl) return sendJson(res, 400, { error: "Lagu crun.ai ini belum punya audio, tidak bisa di-cover" })
        if (!crunProvider.hasKey()) return sendJson(res, 400, { error: "Belum ada API key crun.ai. Tambahkan di Setelan API Key bagian crun.ai." })
        const body = await readBody(req)
        const style = (body.style || "").toString().slice(0, LIMITS.style)
        const prompt = (body.prompt || "").toString().slice(0, LIMITS.lyrics)
        const title = (body.title || "").toString().slice(0, LIMITS.title)
        const negativeTags = (body.negativeTags || "").toString().slice(0, 500)
        const audioWeight = body.audioWeight
        if (!style.trim()) return sendJson(res, 400, { error: "Gaya/genre baru wajib diisi untuk aransemen ulang" })
        let job
        try {
          job = await crunProvider.cover({
            audioUrl: song.audioUrl,
            style,
            lyrics: prompt || song.lyrics,
            title: title || `${song.title} (Aransemen)`,
            instrumental: song.type === "instrumental",
            vocalGender: song.vocalGender,
            model: song.model,
            negativeTags,
            audioWeight,
          })
        } catch (e) {
          return sendJson(res, 502, { error: "crun.ai gagal: " + e.message })
        }
        const now = Date.now()
        const cover = store.addSong({
          id: randomUUID(),
          title: title || `${song.title} (Aransemen)`,
          lyrics: prompt || song.lyrics,
          style: style || song.style,
          type: song.type, vocalGender: song.vocalGender,
          model: song.model, modelLabel: "crun.ai Cover", credits: COVER_COST,
          status: job.status || "processing",
          audioUrl: null, imageUrl: null, tracks: [], error: null, liked: false,
          provider: "crun",
          providerJobId: job.jobId,
          providerKeyId: job.keyId || null,
          isCover: true, coverOf: song.id,
          uploadUrl: song.audioUrl,
          negativeTags: negativeTags || null, audioWeight: (audioWeight === undefined ? null : audioWeight),
          createdAt: now, updatedAt: now,
        })
        return sendJson(res, 201, { song: cover, credits: store.getAllCredits() })
      }
      if (!song.providerJobId) {
        return sendJson(res, 400, { error: "Lagu ini tidak punya job induk, tidak bisa diaransemen ulang" })
      }
      const body = await readBody(req)
      const style = (body.style || "").toString().slice(0, LIMITS.style)
      const prompt = (body.prompt || "").toString().slice(0, LIMITS.lyrics)
      const title = (body.title || "").toString().slice(0, LIMITS.title)
      const negativeTags = (body.negativeTags || "").toString().slice(0, 500)
      const audioWeight = body.audioWeight
      const index = body.index === 2 ? 2 : 1
      if (!style.trim()) return sendJson(res, 400, { error: "Gaya/genre baru wajib diisi untuk aransemen ulang" })
      if (store.getCredits("apiframe") < COVER_COST) return sendJson(res, 402, { error: "Kredit APIframe tidak cukup" })

      let job
      try {
        job = await provider.cover({
          parentJobId: song.providerJobId,
          keyId: song.providerKeyId,
          index, style, prompt, title, negativeTags, audioWeight,
        })
      } catch (e) {
        return sendJson(res, 502, { error: "Provider gagal: " + e.message })
      }

      store.deductCredits("apiframe", COVER_COST)
      const now = Date.now()
      const cover = store.addSong({
        id: randomUUID(),
        title: title || `${song.title} (Aransemen)`,
        lyrics: prompt || song.lyrics,
        style: style || song.style,
        type: song.type, vocalGender: song.vocalGender,
        model: song.model, modelLabel: song.modelLabel, credits: COVER_COST,
        status: job.status || "processing",
        audioUrl: null, imageUrl: null, tracks: [], error: null, liked: false,
        provider: "apiframe",
        providerJobId: job.jobId,
        providerKeyId: job.keyId || song.providerKeyId || null,
        isCover: true, coverOf: song.id,
        negativeTags: negativeTags || null, audioWeight: (audioWeight === undefined ? null : audioWeight),
        createdAt: now, updatedAt: now,
      })
      return sendJson(res, 201, { song: cover, credits: store.getAllCredits() })
    }

    // POST /api/songs/:id/retry -> generate ulang otomatis pakai parameter yang sama
    // (dipakai tombol "Ulang" di kartu Library saat status lagu "failed")
    if (method === "POST" && sub === "/retry") {
      if (song.status !== "failed") {
        return sendJson(res, 400, { error: "Lagu ini belum gagal, tidak perlu generate ulang" })
      }

      let retryJob, retryCreditType, retryCost

      if (song.provider === "crun" && (song.isUpload || song.isCover)) {
        const source = song.uploadUrl || (song.coverOf ? store.getSong(song.coverOf)?.audioUrl : null)
        if (!source) return sendJson(res, 400, { error: "Audio sumber cover tidak tersimpan. Buat cover baru dari lagu atau file aslinya." })
        retryCreditType = null
        retryCost = COVER_COST
        try {
          retryJob = await crunProvider.cover({
            audioUrl: source,
            instrumental: song.type === "instrumental",
            style: song.style,
            lyrics: song.lyrics,
            title: song.title,
            model: song.model,
            vocalGender: song.vocalGender,
            negativeTags: song.negativeTags,
            audioWeight: song.audioWeight,
          })
        } catch (e) {
          return sendJson(res, 502, { error: "crun.ai gagal: " + e.message })
        }
      } else if (song.isUpload && song.provider === "kie") {
        if (!song.uploadUrl) return sendJson(res, 400, {error: "Silakan upload ulang audio sumber."})
        retryCreditType = null
        retryCost = UPLOAD_COVER_COST
        try {
          retryJob = await kieUploadCover({uploadUrl:song.uploadUrl, instrumental:song.type === "instrumental", style:song.style, prompt:song.lyrics, title:song.title, model:song.model, vocalGender:song.vocalGender, negativeTags:song.negativeTags, audioWeight:song.audioWeight, ...resolvePersona(song.personaRef)})
        } catch(e) { return sendJson(res, 502, {error:e.message + " Jika audio sumber kedaluwarsa, upload ulang file."}) }
      } else if (song.isUpload) {
        // Upload & Cover (sunoapi.org): generate ulang dari uploadUrl yang sama, tanpa upload file lagi.
        if (!song.uploadUrl) {
          return sendJson(res, 400, { error: "File audio sumber lagu ini tidak tersimpan (data lama). Silakan upload ulang secara manual di menu Upload & Cover." })
        }
        retryCreditType = "suno"
        retryCost = UPLOAD_COVER_COST
        if (store.getCredits(retryCreditType) < retryCost) return sendJson(res, 402, { error: "Kredit sunoapi.org tidak cukup" })
        try {
          retryJob = await uploadCover.retryCover({
            uploadUrl: song.uploadUrl,
            keyId: song.providerKeyId,
            instrumental: song.type === "instrumental",
            style: song.style,
            prompt: song.lyrics,
            title: song.title,
            model: song.model,
            vocalGender: song.vocalGender,
            negativeTags: song.negativeTags,
            audioWeight: song.audioWeight,
          })
        } catch (e) {
          return sendJson(res, 502, { error: "sunoapi.org gagal: " + e.message })
        }
      } else if (song.isCover && song.coverOf) {
        // Aransemen ulang (APIframe cover dari lagu lain): perlu job induk dari lagu asal.
        const parent = store.getSong(song.coverOf)
        if (!parent || !parent.providerJobId) {
          return sendJson(res, 400, { error: "Lagu asal sudah tidak tersedia, tidak bisa generate ulang otomatis. Buat aransemen baru secara manual." })
        }
        retryCreditType = "apiframe"
        retryCost = COVER_COST
        if (store.getCredits(retryCreditType) < retryCost) return sendJson(res, 402, { error: "Kredit APIframe tidak cukup" })
        try {
          retryJob = await provider.cover({
            parentJobId: parent.providerJobId,
            keyId: song.providerKeyId || parent.providerKeyId,
            index: 1,
            style: song.style,
            prompt: song.lyrics,
            title: song.title,
            negativeTags: song.negativeTags,
            audioWeight: song.audioWeight,
          })
        } catch (e) {
          return sendJson(res, 502, { error: "Provider gagal: " + e.message })
        }
      } else {
        // Generate lagu biasa (APIframe / KIE AI / MusicAPI)
        const modelProvider = song.provider === "kie" ? kieProvider : song.provider === "musicapi" ? musicapiProvider : song.provider === "crun" ? crunProvider : provider
        retryCreditType = song.provider === "kie" || song.provider === "musicapi" || song.provider === "crun" ? null : "apiframe"
        retryCost = song.credits || (getModel(song.model)?.credits) || 0
        if (retryCreditType && store.getCredits(retryCreditType) < retryCost) return sendJson(res, 402, { error: "Kredit APIframe tidak cukup" })
        try {
          retryJob = await modelProvider.generate({
            title: song.title,
            lyrics: song.lyrics,
            style: song.style,
            type: song.type,
            vocalGender: song.vocalGender,
            model: song.model,
            ...resolvePersona(song.personaRef),
          })
        } catch (e) {
          return sendJson(res, 502, { error: "Provider gagal: " + e.message })
        }
      }

      if (retryCreditType) store.deductCredits(retryCreditType, retryCost)
      const retried = store.updateSong(id, {
        status: retryJob.status || "processing",
        error: null, errorCode: null,
        audioUrl: null, imageUrl: null, tracks: [],
        providerJobId: retryJob.jobId,
        providerKeyId: retryJob.keyId || song.providerKeyId || null,
      })
      return sendJson(res, 201, { song: retried, credits: store.getAllCredits() })
    }

    // POST /api/songs/:id/stems  -> pisah stem (vokal/instrumen atau per-instrumen)
    if (method === "POST" && sub === "/stems") {
      if (song.status !== "success") return sendJson(res, 400, { error: "Lagu harus selesai dulu sebelum dipisah stem" })
      if (song.stemStatus === "processing") return sendJson(res, 409, { error: "Pemisahan stem sedang berjalan" })
      const body = await readBody(req)
      const type = body.type === "split_stem" ? "split_stem" : "separate_vocal"
      if (song.provider === "crun") {
        if (!crunProvider.hasKey()) return sendJson(res, 400, { error: "Belum ada API key crun.ai. Tambahkan di Setelan API Key bagian crun.ai." })
        const trackId = body.trackId || (Array.isArray(song.tracks) && song.tracks[0] && song.tracks[0].id) || null
        let job
        try {
          job = await crunProvider.stems({ taskId: song.providerJobId, sunoId: trackId, type })
        } catch (e) {
          return sendJson(res, 502, { error: "crun.ai gagal: " + e.message })
        }
        const updated = store.updateSong(id, {
          stemProvider: "crun", stemType: type,
          stemJobId: job.jobId, stemKeyId: job.keyId || song.providerKeyId || null,
          stemStatus: "processing", stems: [], stemError: null,
        })
        return sendJson(res, 201, { song: updated, credits: store.getAllCredits() })
      }
      const isSuno = song.provider === "uploadcover"
      const which = isSuno ? "suno" : "apiframe"
      if (store.getCredits(which) < STEM_COST) {
        return sendJson(res, 402, { error: `Kredit ${isSuno ? "sunoapi.org" : "APIframe"} tidak cukup` })
      }
      const trackId = body.trackId || (Array.isArray(song.tracks) && song.tracks[0] && song.tracks[0].id) || null
      let job
      try {
        job = isSuno
          ? await uploadCover.separateStems({ taskId: song.providerJobId, audioId: trackId, type, keyId: song.providerKeyId })
          : await provider.stems({ parentJobId: song.providerJobId, keyId: song.providerKeyId, trackId })
      } catch (e) {
        return sendJson(res, 502, { error: "Provider gagal: " + e.message })
      }
      store.deductCredits(which, STEM_COST)
      const updated = store.updateSong(id, {
        stemProvider: which, stemType: type,
        stemJobId: job.jobId, stemKeyId: job.keyId || song.providerKeyId || null,
        stemStatus: "processing", stems: [], stemError: null,
      })
      return sendJson(res, 201, { song: updated, credits: store.getAllCredits() })
    }

    // POST /api/songs/:id/wav  -> konversi track ke WAV (sunoapi.org)
    if (method === "POST" && sub === "/wav") {
      if (song.status !== "success") return sendJson(res, 400, { error: "Lagu harus selesai dulu sebelum dikonversi WAV" })
      const isSuno = song.provider === "uploadcover"
      if (!isSuno) {
        return sendJson(res, 400, { error: "Konversi WAV via API hanya untuk lagu sunoapi.org (Upload & Aransemen). Untuk lagu APIframe, pakai tombol Unduh untuk mengambil file audionya." })
      }
      if (song.wavStatus === "processing") return sendJson(res, 409, { error: "Konversi WAV sedang berjalan" })
      if (store.getCredits("suno") < WAV_COST) return sendJson(res, 402, { error: "Kredit sunoapi.org tidak cukup" })
      const body = await readBody(req)
      const trackId = body.trackId || (Array.isArray(song.tracks) && song.tracks[0] && song.tracks[0].id) || null
      let job
      try {
        job = await uploadCover.convertWav({ taskId: song.providerJobId, audioId: trackId, keyId: song.providerKeyId })
      } catch (e) {
        return sendJson(res, 502, { error: "Provider gagal: " + e.message })
      }
      store.deductCredits("suno", WAV_COST)
      const updated = store.updateSong(id, {
        wavJobId: job.jobId, wavKeyId: job.keyId || song.providerKeyId || null,
        wavStatus: "processing", wavUrl: null, wavError: null,
      })
      return sendJson(res, 201, { song: updated, credits: store.getAllCredits() })
    }

    // POST /api/songs/:id/extend -> perpanjang lagu crun.ai jadi lagu baru
    if (method === "POST" && sub === "/extend") {
      if (song.provider !== "crun") return sendJson(res, 400, { error: "Perpanjang lewat crun.ai hanya untuk lagu crun.ai" })
      if (song.status !== "success") return sendJson(res, 400, { error: "Lagu harus selesai dulu sebelum diperpanjang" })
      if (!crunProvider.hasKey()) return sendJson(res, 400, { error: "Belum ada API key crun.ai. Tambahkan di Setelan API Key bagian crun.ai." })
      const body = await readBody(req)
      const trackId = body.trackId || (Array.isArray(song.tracks) && song.tracks[0] && song.tracks[0].id) || null
      const style = (body.style || song.style || "").toString().slice(0, LIMITS.style)
      const lyrics = (body.lyrics || song.lyrics || "").toString().slice(0, LIMITS.lyrics)
      const title = (body.title || `${song.title} (Perpanjang)`).toString().slice(0, LIMITS.title)
      const continueAt = Number(body.continueAt)
      let job
      try {
        job = await crunProvider.extend({
          sunoId: trackId,
          model: song.model,
          continueAt: Number.isFinite(continueAt) ? continueAt : 30,
          title,
          style,
          lyrics,
          vocalGender: song.vocalGender,
          instrumental: song.type === "instrumental",
        })
      } catch (e) {
        return sendJson(res, 502, { error: "crun.ai gagal: " + e.message })
      }
      const now = Date.now()
      const extended = store.addSong({
        id: randomUUID(),
        title, lyrics, style,
        type: song.type, vocalGender: song.vocalGender,
        model: song.model, modelLabel: "crun.ai Extend", credits: 0,
        status: job.status || "processing",
        audioUrl: null, imageUrl: song.imageUrl || null, tracks: [], error: null, liked: false,
        provider: "crun",
        providerJobId: job.jobId,
        providerKeyId: job.keyId || song.providerKeyId || null,
        isExtend: true, extendOf: song.id,
        createdAt: now, updatedAt: now,
      })
      return sendJson(res, 201, { song: extended, credits: store.getAllCredits() })
    }

    // POST /api/songs/:id/video -> video lirik crun.ai, menempel di lagu yang sama
    if (method === "POST" && sub === "/video") {
      if (song.provider !== "crun") return sendJson(res, 400, { error: "Video lewat crun.ai hanya untuk lagu crun.ai" })
      if (song.status !== "success") return sendJson(res, 400, { error: "Lagu harus selesai dulu sebelum dibuat video" })
      if (song.videoStatus === "processing") return sendJson(res, 409, { error: "Video sedang dibuat" })
      if (!crunProvider.hasKey()) return sendJson(res, 400, { error: "Belum ada API key crun.ai. Tambahkan di Setelan API Key bagian crun.ai." })
      const body = await readBody(req)
      const trackId = body.trackId || (Array.isArray(song.tracks) && song.tracks[0] && song.tracks[0].id) || null
      let job
      try {
        job = await crunProvider.video({
          taskId: song.providerJobId,
          sunoId: trackId,
          author: body.author,
          brand: body.brand,
        })
      } catch (e) {
        return sendJson(res, 502, { error: "crun.ai gagal: " + e.message })
      }
      const updated = store.updateSong(id, {
        videoJobId: job.jobId,
        videoKeyId: job.keyId || song.providerKeyId || null,
        videoStatus: "processing",
        videoUrl: null,
        videoError: null,
      })
      return sendJson(res, 201, { song: updated, credits: store.getAllCredits() })
    }

    // GET /api/songs/:id/download?src=<url>
    // GET /api/songs/:id/stream?src=<url>
    //   download = attachment, stream = inline untuk pemutar audio.
    if ((method === "GET" || method === "HEAD") && (sub === "/download" || sub === "/stream")) {
      const src = url.searchParams.get("src") || ""
      const allowed = new Set()
      if (song.audioUrl) allowed.add(song.audioUrl)
      if (Array.isArray(song.tracks)) for (const t of song.tracks) if (t && t.audioUrl) allowed.add(t.audioUrl)
      if (song.wavUrl) allowed.add(song.wavUrl)
      if (song.videoUrl) allowed.add(song.videoUrl)
      if (Array.isArray(song.stems)) for (const s of song.stems) if (s && s.url) allowed.add(s.url)
      const requestedFileId = (src.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0]?.toLowerCase() || ""
      const storedFileUrl = [song.audioUrl, ...(Array.isArray(song.tracks) ? song.tracks.map((t) => t?.audioUrl) : [])]
        .find((u) => requestedFileId && String(u || "").toLowerCase().includes(requestedFileId) && !/\/\/audiostream\.kie\.ai\//.test(String(u || "")))
      if (!src || (!allowed.has(src) && !storedFileUrl)) return sendJson(res, 400, { error: "Sumber audio tidak valid untuk lagu ini" })
      let playSrc = storedFileUrl || src
      if (!storedFileUrl && song.provider === "crun" && /\/\/audiostream\.kie\.ai\//.test(src)) {
        try {
          const st = await crunProvider.getStatus(song.providerJobId, song.providerKeyId)
          const replacement = (st.tracks || []).find((t) => t?.audioUrl && !/\/\/audiostream\.kie\.ai\//.test(t.audioUrl) && (!requestedFileId || t.audioUrl.toLowerCase().includes(requestedFileId)))
          if (replacement?.audioUrl) {
            playSrc = replacement.audioUrl
            store.updateSong(id, {
              audioUrl: song.audioUrl === src ? playSrc : song.audioUrl,
              tracks: (song.tracks || []).map((t) => t?.audioUrl === src ? { ...t, audioUrl: playSrc } : t),
            })
            await flushStore()
          }
        } catch { /* stream lama tetap dicoba */ }
      }
      const safeTitle = (song.title || "track").replace(/[^\w.-]+/g, "_").slice(0, 60) || "track"

      const extM = src.toLowerCase().match(/\.(mp3|wav|m4a|flac|ogg|aac|mp4)(?:[?#]|$)/)
      const ext = (extM && extM[1]) || "mp3"
      const fallbackType = ext === "mp4" ? "video/mp4" : ext === "wav" ? "audio/wav" : ext === "flac" ? "audio/flac" : ext === "ogg" ? "audio/ogg" : ext === "m4a" || ext === "aac" ? "audio/mp4" : "audio/mpeg"
      const filename = `${safeTitle}.${ext}`

      // File lokal (mis. hasil Mastering di /uploads/mastered/...) disajikan langsung dari disk,
      // tidak lewat fetch() provider eksternal karena src berupa path relatif, bukan URL absolut.
      if (src.startsWith("/")) {
        const localPath = normalize(join(PUBLIC_DIR, src))
        if (!localPath.startsWith(PUBLIC_DIR)) return sendJson(res, 400, { error: "Path tidak valid" })
        try {
          const data = await readFile(localPath)
          const part = byteSlice(data, req.headers.range)
          if (part && part.invalid) {
            res.writeHead(416, { "Content-Range": `bytes */${data.length}` })
            return res.end()
          }
          const body = part ? part.chunk : data
          res.writeHead(part ? 206 : 200, {
            "Content-Type": fallbackType,
            "Content-Disposition": sub === "/download" ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=86400",
            "Content-Length": String(body.length),
            ...(part ? { "Content-Range": `bytes ${part.start}-${part.end}/${data.length}` } : {}),
          })
          if (method === "HEAD") return res.end()
          return res.end(body)
        } catch {
          return sendJson(res, 404, { error: "File lokal tidak ditemukan" })
        }
      }

      let upstream
      try {
        const headers = {
          // Beberapa CDN/provider audio menolak request default Node.js dengan HTTP 403.
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          "Accept": "audio/*,*/*;q=0.9",
          "Referer": PUBLIC_URL + "/",
        }
        // Range tidak diteruskan. CDN sering menolaknya atau membalas 200, lalu browser
        // gagal memutar ulang karena mengharapkan 206. Putar ulang mengunduh file utuh lagi.
        upstream = await fetch(playSrc, { headers, redirect: "follow" })
      }
      catch (e) { return sendJson(res, 502, { error: "Gagal mengambil sumber: " + e.message }) }

      if (!upstream.ok || !upstream.body) {
        return sendJson(res, 502, { error: "Sumber audio tidak bisa diambil: HTTP " + upstream.status })
      }
      if (upstream.headers.get("content-length") === "0") {
        return sendJson(res, 502, { error: "Sumber audio kosong" })
      }

      const ctype = upstream.headers.get("content-type") || fallbackType
      const headers = {
        "Content-Type": ctype,
        "Content-Disposition": sub === "/download" ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`,
        "Accept-Ranges": "none",
        "Cache-Control": "private, max-age=86400",
      }
      const len = upstream.headers.get("content-length")
      if (len) headers["Content-Length"] = len
      res.writeHead(200, headers)
      if (method === "HEAD") return res.end()
      const reader = upstream.body.getReader()
      let cancelled = false
      res.on("close", () => { cancelled = true; try { reader.cancel() } catch {} })
      ;(async () => {
        try {
          while (!cancelled) {
            const { done, value } = await reader.read()
            if (done) break
            if (!res.write(Buffer.from(value))) await new Promise((resolve) => res.once("drain", resolve))
          }
        } catch { /* terputus */ }
        try { res.end() } catch {}
      })()
      return
    }

    // GET /api/songs/:id  -> sekalian polling status ke provider bila masih proses
    if (method === "GET" && !sub) {
      let siblings = []
      if (song.status === "processing" || song.status === "queued") {
        try {
          const st = song.provider === "uploadcover"
            ? await uploadCover.getStatus(song.providerJobId, song.providerKeyId)
            : song.provider === "kie"
              ? await kieProvider.getStatus(song.providerJobId, song.providerKeyId)
              : song.provider === "musicapi"
                ? await musicapiProvider.getStatus(song.providerJobId, song.providerKeyId)
                : song.provider === "crun"
                  ? await crunProvider.getStatus(song.providerJobId, song.providerKeyId)
                  : await provider.getStatus(song.providerJobId, song.providerKeyId)
          const incoming = Array.isArray(st.tracks) ? st.tracks.filter((t) => t && t.audioUrl) : []
          const current = Array.isArray(song.tracks) ? song.tracks.filter((t) => t && t.audioUrl) : []
          if (st.status !== song.status || incoming.length > current.length) {
            siblings = store.applyResult(id, {
              status: st.status,
              audioUrl: st.audioUrl ?? song.audioUrl,
              imageUrl: st.imageUrl ?? song.imageUrl,
              tracks: st.tracks ?? song.tracks,
              error: st.error ? humanizeError(st.error) : null,
              errorCode: st.errorCode ?? null,
            }).created
          }
        } catch { /* biarkan status lama */ }
      }
      // polling stem (bisa jalan walau lagu utama sudah selesai)
      let cur = store.getSong(id)
      if (cur && cur.stemStatus === "processing" && cur.stemJobId) {
        try {
          const st = cur.stemProvider === "suno"
            ? await uploadCover.getStemStatus(cur.stemJobId, cur.stemKeyId)
            : cur.stemProvider === "crun"
              ? await crunProvider.getStemStatus(cur.stemJobId, cur.stemKeyId)
              : await provider.getStemStatus(cur.stemJobId, cur.stemKeyId)
          if (st.status !== "processing") {
            store.updateSong(id, { stemStatus: st.status, stems: st.stems ?? cur.stems ?? [], stemError: st.error ?? null })
          }
        } catch { /* biarkan */ }
      }
      cur = store.getSong(id)
      if (cur && cur.videoStatus === "processing" && cur.videoJobId && cur.provider === "crun") {
        try {
          const st = await crunProvider.getVideoStatus(cur.videoJobId, cur.videoKeyId)
          if (st.status !== "processing") {
            store.updateSong(id, { videoStatus: st.status, videoUrl: st.videoUrl ?? cur.videoUrl ?? null, videoError: st.error ?? null })
          }
        } catch { /* biarkan */ }
      }
      // polling konversi WAV
      cur = store.getSong(id)
      if (cur && cur.wavStatus === "processing" && cur.wavJobId) {
        try {
          const st = await uploadCover.getWavStatus(cur.wavJobId, cur.wavKeyId)
          if (st.status !== "processing") {
            store.updateSong(id, { wavStatus: st.status, wavUrl: st.wavUrl ?? cur.wavUrl ?? null, wavError: st.error ?? null })
          }
        } catch { /* biarkan */ }
      }
      if (!siblings.length && song.status === "success" && Array.isArray(song.tracks) && song.tracks.filter((t) => t && t.audioUrl).length > 1) {
        siblings = store.applyResult(id, {}).created
      }
      return sendJson(res, 200, { song: store.getSong(id), siblings })
    }

    // DELETE /api/songs/:id
    if (method === "DELETE" && !sub) {
      store.deleteSong(id)
      return sendJson(res, 200, { ok: true })
    }
  }

  // DELETE /api/songs  -> hapus semua
  if (method === "DELETE" && pathname === "/api/songs") {
    store.deleteAll()
    return sendJson(res, 200, { ok: true })
  }

  // POST /api/webhooks/kie -> callback KIE AI (opsional; polling tetap didukung)
  if (method === "POST" && pathname === "/api/webhooks/kie") {
    // Cegah callback palsu dari pihak luar: KIE AI tidak mendukung tanda tangan HMAC,
    // jadi kita pakai token rahasia yang disisipkan di URL callback saat job dibuat.
    if (url.searchParams.get("t") !== WEBHOOK_TOKEN) {
      return sendJson(res, 401, { error: "Token webhook tidak valid" })
    }
    const raw = await readRawBody(req)
    try {
      const body = JSON.parse(raw || "{}")
      const taskId = body?.data?.task_id || body?.data?.taskId || body?.data?.taskId || body?.task_id || body?.taskId
      const items = body?.data?.data || body?.data?.response?.sunoData || []
      const song = taskId ? store.getSongByJob(taskId) : null
      if (song && Array.isArray(items) && items.length) {
        const tracks = items.map((t, i) => ({ id: t.id || String(i + 1), audioUrl: t.audio_url || t.audioUrl || t.streamAudioUrl, imageUrl: t.image_url || t.imageUrl, title: t.title, tags: t.tags, duration: t.duration })).filter((t) => t.audioUrl)
        if (tracks.length) store.applyResult(song.id, { status: "success", audioUrl: tracks[0].audioUrl, imageUrl: tracks[0].imageUrl || song.imageUrl, tracks, error: null })
      }
    } catch { /* abaikan callback malformed */ }
    return sendJson(res, 200, { ok: true })
  }

  // POST /api/webhooks/uploadcover  -> callback sunoapi.org (Upload & Cover)
  if (method === "POST" && pathname === "/api/webhooks/uploadcover") {
    // Cegah callback palsu dari pihak luar (lihat catatan token di webhook KIE di atas).
    if (url.searchParams.get("t") !== WEBHOOK_TOKEN) {
      return sendJson(res, 401, { error: "Token webhook tidak valid" })
    }
    const raw = await readRawBody(req)
    try {
      const evt = uploadCover.parseCallback(raw)
      if (evt) {
        const song = store.getSongByJob(evt.jobId)
        if (song) store.applyResult(song.id, {
          status: evt.status,
          audioUrl: evt.audioUrl ?? song.audioUrl,
          imageUrl: evt.imageUrl ?? song.imageUrl,
          tracks: evt.tracks ?? song.tracks,
          error: evt.error ?? null,
          errorCode: evt.errorCode ?? null,
        })
      }
    } catch (e) {
      return sendJson(res, 400, { error: e.message })
    }
    return sendJson(res, 200, { ok: true })
  }

  // ------------- KUNCI UPLOAD & COVER (sunoapi.org) : MULTI KEY ------------

  // GET /api/upload-keys -> daftar kunci tersamar + ringkasan kredit
  if (method === "GET" && pathname === "/api/upload-keys") {
    const keys = store.listUploadKeys()
    const totalCredits = sumCredits(keys)
    return sendJson(res, 200, { keys, count: keys.length, totalCredits })
  }

  // POST /api/upload-keys -> tambah banyak kunci (satu per baris)
  if (method === "POST" && pathname === "/api/upload-keys") {
    try {
      const body = await readBody(req)
      const rawKeys = (body.keys || body.key || "").toString()
      if (!rawKeys.trim()) return sendJson(res, 400, { error: "Kunci sunoapi.org kosong" })
      const added = store.addUploadKeys(rawKeys)
      return sendJson(res, 201, { added, keys: store.listUploadKeys() })
    } catch (e) {
      return sendJson(res, 500, { error: "Gagal menyimpan kunci sunoapi.org: " + e.message })
    }
  }

  // POST /api/upload-keys/check -> cek kredit SEMUA kunci
  if (method === "POST" && pathname === "/api/upload-keys/check") {
    const raw = store.getUploadRawKeys()
    await Promise.all(raw.map(async ({ id, key }) => {
      try { store.updateUploadKeyCredits(id, await uploadCover.checkCredits(key)) }
      catch { /* saldo terakhir tetap dipakai jika cek gagal */ }
    }))
    const keys = store.listUploadKeys()
    const totalCredits = sumCredits(keys)
    return sendJson(res, 200, { keys, count: keys.length, totalCredits })
  }

  // DELETE /api/upload-keys -> hapus semua kunci
  if (method === "DELETE" && pathname === "/api/upload-keys") {
    store.deleteAllUploadKeys()
    return sendJson(res, 200, { ok: true, keys: [] })
  }

  // Routes /api/upload-keys/:id (+ /check, /reveal)
  const upKeyMatch = pathname.match(/^\/api\/upload-keys\/([^/]+)(\/check|\/reveal)?$/)
  if (upKeyMatch) {
    const keyId = upKeyMatch[1]
    const sub = upKeyMatch[2]
    const entry = store.getUploadKeyById(keyId)
    if (!entry) return sendJson(res, 404, { error: "Kunci tidak ditemukan" })

    // POST /api/upload-keys/:id/check -> cek kredit satu kunci
    if (method === "POST" && sub === "/check") {
      try {
        const credits = await uploadCover.checkCredits(entry.key)
        store.updateUploadKeyCredits(keyId, credits)
        return sendJson(res, 200, { id: keyId, credits })
      } catch (e) {
        /* saldo terakhir tetap dipakai jika cek gagal */
        return sendJson(res, 502, { error: e.message })
      }
    }

    // GET /api/upload-keys/:id/reveal -> tampilkan kunci utuh
    if (method === "GET" && sub === "/reveal") {
      return sendJson(res, 200, { id: keyId, key: entry.key })
    }

    // DELETE /api/upload-keys/:id -> hapus satu kunci
    if (method === "DELETE" && !sub) {
      store.deleteUploadKey(keyId)
      return sendJson(res, 200, { ok: true })
    }
  }

  // POST /api/webhooks/provider
  if (method === "POST" && pathname === "/api/webhooks/provider") {
    const raw = await readRawBody(req)
    try {
      const evt = provider.verifyWebhook(req.headers, raw)
      if (evt) {
        const song = store.getSongByJob(evt.jobId)
        if (song) store.updateSong(song.id, {
          status: evt.status,
          audioUrl: evt.audioUrl ?? song.audioUrl,
          imageUrl: evt.imageUrl ?? song.imageUrl,
          tracks: evt.tracks ?? song.tracks,
          error: evt.error ? humanizeError(evt.error) : null,
        })
      }
    } catch (e) {
      return sendJson(res, 400, { error: e.message })
    }
    return sendJson(res, 200, { ok: true })
  }

  // ----------------------------- API KEYS ------------------------------------

  // GET /api/keys -> daftar key tersamar + ringkasan kredit
  if (method === "GET" && pathname === "/api/keys") {
    const keys = store.listKeys()
    const totalCredits = sumCredits(keys)
    return sendJson(res, 200, { keys, count: keys.length, totalCredits })
  }

  // POST /api/keys -> tambah banyak key (satu per baris)
  if (method === "POST" && pathname === "/api/keys") {
    const body = await readBody(req)
    const added = store.addKeys(body.keys || "")
    return sendJson(res, 201, { added, keys: store.listKeys() })
  }

  // POST /api/keys/check -> cek kredit SEMUA key
  if (method === "POST" && pathname === "/api/keys/check") {
    const raw = store.getRawKeys()
    await Promise.all(raw.map(async ({ id, key }) => {
      try { store.updateKeyCredits(id, await provider.checkCredits(key)) }
      catch { /* saldo terakhir tetap dipakai jika cek gagal */ }
    }))
    const keys = store.listKeys()
    const totalCredits = sumCredits(keys)
    return sendJson(res, 200, { keys, count: keys.length, totalCredits })
  }

  // DELETE /api/keys -> hapus semua key
  if (method === "DELETE" && pathname === "/api/keys") {
    store.deleteAllKeys()
    return sendJson(res, 200, { ok: true, keys: [] })
  }

  // Routes /api/keys/:id (+ /check, /reveal)
  const keyMatch = pathname.match(/^\/api\/keys\/([^/]+)(\/check|\/reveal)?$/)
  if (keyMatch) {
    const keyId = keyMatch[1]
    const sub = keyMatch[2]
    const entry = store.getKey(keyId)
    if (!entry) return sendJson(res, 404, { error: "Key tidak ditemukan" })

    // POST /api/keys/:id/check -> cek kredit satu key
    if (method === "POST" && sub === "/check") {
      try {
        const credits = await provider.checkCredits(entry.key)
        store.updateKeyCredits(keyId, credits)
        return sendJson(res, 200, { id: keyId, credits })
      } catch (e) {
        return sendJson(res, 502, { error: e.message })
      }
    }

    // GET /api/keys/:id/reveal -> tampilkan key utuh (tombol mata)
    if (method === "GET" && sub === "/reveal") {
      return sendJson(res, 200, { id: keyId, key: entry.key })
    }

    // DELETE /api/keys/:id -> hapus satu key
    if (method === "DELETE" && !sub) {
      store.deleteKey(keyId)
      return sendJson(res, 200, { ok: true })
    }
  }

  // ------------- KUNCI GOOGLE GEMINI (Generate Lirik) : MULTI KEY ----------

  // GET /api/gemini-keys -> daftar key tersamar
  if (method === "GET" && pathname === "/api/gemini-keys") {
    const keys = store.listGeminiKeys()
    return sendJson(res, 200, { keys, count: keys.length })
  }

  // POST /api/gemini-keys -> tambah banyak key (satu per baris)
  if (method === "POST" && pathname === "/api/gemini-keys") {
    try {
      const body = await readBody(req)
      const rawKeys = (body.keys || body.key || "").toString()
      if (!rawKeys.trim()) return sendJson(res, 400, { error: "Key Gemini kosong" })
      const added = store.addGeminiKeys(rawKeys)
      return sendJson(res, 201, { added, keys: store.listGeminiKeys() })
    } catch (e) {
      return sendJson(res, 500, { error: "Gagal menyimpan key Gemini: " + e.message })
    }
  }

  // POST /api/gemini-keys/check -> verifikasi SEMUA key
  if (method === "POST" && pathname === "/api/gemini-keys/check") {
    const raw = store.getGeminiRawKeys()
    await Promise.all(raw.map(async ({ id, key }) => {
      const ok = await gemini.checkKey(key).catch(() => false)
      store.updateGeminiKeyCredits(id, ok ? 1 : 0)
    }))
    const keys = store.listGeminiKeys()
    return sendJson(res, 200, { keys, count: keys.length })
  }

  // DELETE /api/gemini-keys -> hapus semua key
  if (method === "DELETE" && pathname === "/api/gemini-keys") {
    store.deleteAllGeminiKeys()
    return sendJson(res, 200, { ok: true, keys: [] })
  }

  // Routes /api/gemini-keys/:id (+ /check, /reveal)
  const gmKeyMatch = pathname.match(/^\/api\/gemini-keys\/([^/]+)(\/check|\/reveal)?$/)
  if (gmKeyMatch) {
    const keyId = gmKeyMatch[1]
    const sub = gmKeyMatch[2]
    const entry = store.getGeminiKeyById(keyId)
    if (!entry) return sendJson(res, 404, { error: "Key tidak ditemukan" })

    if (method === "POST" && sub === "/check") {
      try {
        const ok = await gemini.checkKey(entry.key)
        store.updateGeminiKeyCredits(keyId, ok ? 1 : 0)
        return sendJson(res, 200, { id: keyId, credits: ok ? 1 : 0 })
      } catch (e) {
        store.updateGeminiKeyCredits(keyId, 0)
        return sendJson(res, 502, { error: e.message })
      }
    }
    if (method === "GET" && sub === "/reveal") {
      return sendJson(res, 200, { id: keyId, key: entry.key })
    }
    if (method === "DELETE" && !sub) {
      store.deleteGeminiKey(keyId)
      return sendJson(res, 200, { ok: true })
    }
  }

  // ------------- KUNCI KIE AI : MULTI KEY -------------------------------
  if (method === "GET" && pathname === "/api/kie-keys") {
    const keys = store.listKieKeys()
    const totalCredits = sumCredits(keys)
    return sendJson(res, 200, { keys, count: keys.length, totalCredits })
  }
  if (method === "POST" && pathname === "/api/kie-keys") {
    try {
      const body = await readBody(req)
      const rawKeys = (body.keys || body.key || "").toString()
      if (!rawKeys.trim()) return sendJson(res, 400, { error: "API key KIE AI kosong" })
      const added = store.addKieKeys(rawKeys)
      return sendJson(res, 201, { added, keys: store.listKieKeys() })
    } catch (e) { return sendJson(res, 500, { error: "Gagal menyimpan API key KIE AI: " + e.message }) }
  }
  if (method === "POST" && pathname === "/api/kie-keys/check") {
    const raw = store.getKieRawKeys()
    if (!raw.length) return sendJson(res, 400, { error: "Belum ada API key KIE AI" })
    const results = await Promise.all(raw.map(async ({ id, key }) => {
      try {
        const credits = await kieProvider.checkCredits(key)
        store.updateKieKeyCredits(id, credits)
        return { id, ok: true, credits }
      } catch (e) {
        /* saldo terakhir tetap dipakai jika cek gagal */
        return { id, ok: false, credits: 0, error: e.message }
      }
    }))
    const keys = store.listKieKeys()
    const totalCredits = sumCredits(keys)
    const validCount = results.filter((r) => r.ok).length
    const invalidCount = results.length - validCount
    return sendJson(res, invalidCount && !validCount ? 502 : 200, { keys, count: keys.length, totalCredits, validCount, invalidCount, results, ...(invalidCount && !validCount ? { error: results[0]?.error || "Semua key KIE AI gagal divalidasi" } : {}) })
  }
  if (method === "DELETE" && pathname === "/api/kie-keys") {
    store.deleteAllKieKeys()
    return sendJson(res, 200, { ok: true, keys: [] })
  }
  const kieKeyMatch = pathname.match(/^\/api\/kie-keys\/([^/]+)(\/check|\/reveal)?$/)
  if (kieKeyMatch) {
    const keyId = kieKeyMatch[1]
    const sub = kieKeyMatch[2]
    const entry = store.getKieKeyById(keyId)
    if (!entry) return sendJson(res, 404, { error: "KIE AI key tidak ditemukan" })
    if (method === "POST" && sub === "/check") {
      try { const credits = await kieProvider.checkCredits(entry.key); store.updateKieKeyCredits(keyId, credits); return sendJson(res, 200, { id: keyId, credits }) }
      catch (e) { return sendJson(res, 502, { error: e.message }) }
    }
    if (method === "GET" && sub === "/reveal") return sendJson(res, 200, { id: keyId, key: entry.key })
    if (method === "DELETE" && !sub) { store.deleteKieKey(keyId); return sendJson(res, 200, { ok: true }) }
  }

  // ------------- KUNCI MusicAPI.ai : MULTI KEY ---------------------------
  if (method === "GET" && pathname === "/api/musicapi-keys") {
    const keys = store.listMusicApiKeys()
    const totalCredits = sumCredits(keys)
    return sendJson(res, 200, { keys, count: keys.length, totalCredits })
  }
  if (method === "POST" && pathname === "/api/musicapi-keys") {
    try {
      const body = await readBody(req)
      const rawKeys = (body.keys || body.key || "").toString()
      if (!rawKeys.trim()) return sendJson(res, 400, { error: "API key MusicAPI.ai kosong" })
      const added = store.addMusicApiKeys(rawKeys)
      return sendJson(res, 201, { added, keys: store.listMusicApiKeys() })
    } catch (e) { return sendJson(res, 500, { error: "Gagal menyimpan API key MusicAPI.ai: " + e.message }) }
  }
  if (method === "POST" && pathname === "/api/musicapi-keys/check") {
    const raw = store.getMusicApiRawKeys()
    await Promise.all(raw.map(async ({ id, key }) => {
      try { store.updateMusicApiKeyCredits(id, await musicapiProvider.checkCredits(key)) }
      catch { /* saldo terakhir tetap dipakai jika cek gagal */ }
    }))
    const keys = store.listMusicApiKeys()
    const totalCredits = sumCredits(keys)
    return sendJson(res, 200, { keys, count: keys.length, totalCredits })
  }
  if (method === "DELETE" && pathname === "/api/musicapi-keys") {
    store.deleteAllMusicApiKeys()
    return sendJson(res, 200, { ok: true, keys: [] })
  }
  const musicApiKeyMatch = pathname.match(/^\/api\/musicapi-keys\/([^/]+)(\/check|\/reveal)?$/)
  if (musicApiKeyMatch) {
    const keyId = musicApiKeyMatch[1]
    const sub = musicApiKeyMatch[2]
    const entry = store.getMusicApiKeyById(keyId)
    if (!entry) return sendJson(res, 404, { error: "MusicAPI.ai key tidak ditemukan" })
    if (method === "POST" && sub === "/check") {
      try { const credits = await musicapiProvider.checkCredits(entry.key); store.updateMusicApiKeyCredits(keyId, credits); return sendJson(res, 200, { id: keyId, credits }) }
      catch (e) { return sendJson(res, 502, { error: e.message }) }
    }
    if (method === "GET" && sub === "/reveal") return sendJson(res, 200, { id: keyId, key: entry.key })
    if (method === "DELETE" && !sub) { store.deleteMusicApiKey(keyId); return sendJson(res, 200, { ok: true }) }
  }

  // ------------- KUNCI crun.ai : MULTI KEY --------------------------------
  if (method === "GET" && pathname === "/api/crun-keys") {
    const keys = store.listCrunKeys()
    const totalCredits = sumCredits(keys)
    return sendJson(res, 200, { keys, count: keys.length, totalCredits })
  }
  if (method === "POST" && pathname === "/api/crun-keys") {
    try {
      const body = await readBody(req)
      const rawKeys = (body.keys || body.key || "").toString()
      if (!rawKeys.trim()) return sendJson(res, 400, { error: "API key crun.ai kosong" })
      const added = store.addCrunKeys(rawKeys)
      await flushStore()
      return sendJson(res, 201, { added, keys: store.listCrunKeys() })
    } catch (e) { return sendJson(res, 500, { error: "Gagal menyimpan API key crun.ai: " + e.message }) }
  }
  if (method === "POST" && pathname === "/api/crun-keys/check") {
    const raw = store.getCrunRawKeys()
    const errors = []
    await Promise.all(raw.map(async ({ id, key }) => {
      try { store.updateCrunKeyCredits(id, await crunProvider.checkCredits(key)) }
      catch (e) { errors.push(String(e.message || "Saldo crun.ai tidak terbaca").slice(0, 160)) }
    }))
    if (raw.length) await flushStore()
    const keys = store.listCrunKeys()
    const body = { keys, count: keys.length, totalCredits: sumCredits(keys), failed: errors.length }
    if (!raw.length) return sendJson(res, 200, { ...body, error: "Belum ada API key crun.ai" })
    if (errors.length === raw.length) return sendJson(res, 502, { error: errors[0], ...body })
    return sendJson(res, 200, body)
  }
  if (method === "DELETE" && pathname === "/api/crun-keys") {
    store.deleteAllCrunKeys()
    return sendJson(res, 200, { ok: true, keys: [] })
  }
  const crunKeyMatch = pathname.match(/^\/api\/crun-keys\/([^/]+)(\/check|\/reveal)?$/)
  if (crunKeyMatch) {
    const keyId = crunKeyMatch[1]
    const sub = crunKeyMatch[2]
    const entry = store.getCrunKeyById(keyId)
    if (!entry) return sendJson(res, 404, { error: "crun.ai key tidak ditemukan" })
    if (method === "POST" && sub === "/check") {
      try { const credits = await crunProvider.checkCredits(entry.key); store.updateCrunKeyCredits(keyId, credits); await flushStore(); return sendJson(res, 200, { id: keyId, credits }) }
      catch (e) { return sendJson(res, 502, { error: e.message }) }
    }
    if (method === "GET" && sub === "/reveal") return sendJson(res, 200, { id: keyId, key: entry.key })
    if (method === "DELETE" && !sub) { store.deleteCrunKey(keyId); return sendJson(res, 200, { ok: true }) }
  }

  // GET /api/frontpage -> ambil konten landing page
  if (method === "GET" && pathname === "/api/frontpage") {
    return sendJson(res, 200, store.getFrontpage())
  }

  // PUT /api/frontpage -> simpan konten landing page
  if (method === "PUT" && pathname === "/api/frontpage") {
    const body = await readBody(req)
    const fp = store.saveFrontpage({
      title:     (body.title     || "").toString().slice(0, 100),
      subtitle:  (body.subtitle  || "").toString().slice(0, 200),
      tagline:   (body.tagline   || "").toString().slice(0, 300),
      description: (body.description || "").toString().slice(0, 1000),
      cta:       (body.cta       || "Mulai").toString().slice(0, 60),
      footer:    (body.footer    || "").toString().slice(0, 200),
      features:  Array.isArray(body.features) ? body.features.slice(0, 8).map((f) => ({
        icon: (f.icon || "•").toString().slice(0, 10),
        text: (f.text || "").toString().slice(0, 200),
      })) : store.getFrontpage().features,
    })
    return sendJson(res, 200, fp)
  }

  // GET /api/blocks -> ambil semua blok konten
  if (method === "GET" && pathname === "/api/blocks") {
    return sendJson(res, 200, { blocks: store.getBlocks() })
  }

  // POST /api/blocks -> tambah blok baru
  if (method === "POST" && pathname === "/api/blocks") {
    const body = await readBody(req)
    const type = ["text", "image", "embed", "heading", "divider"].includes(body.type) ? body.type : "text"
    let content = {}
    if (type === "text") {
      content = {
        text: (body.text || "").toString().slice(0, 5000),
        align: ["left", "center", "right"].includes(body.align) ? body.align : "center",
        size: ["sm", "md", "lg"].includes(body.size) ? body.size : "md",
      }
    } else if (type === "heading") {
      content = {
        text: (body.text || "Heading").toString().slice(0, 200),
        level: ["h2", "h3", "h4"].includes(body.level) ? body.level : "h2",
        align: ["left", "center", "right"].includes(body.align) ? body.align : "center",
      }
    } else if (type === "divider") {
      content = { style: ["line", "dots", "space"].includes(body.style) ? body.style : "line" }
    } else if (type === "image") {
      content = {
        src: (body.src || "").toString().slice(0, 2000),
        alt: (body.alt || "").toString().slice(0, 300),
        caption: (body.caption || "").toString().slice(0, 300),
      }
    } else if (type === "embed") {
      content = {
        url: (body.url || "").toString().slice(0, 2000),
        embedType: (body.embedType || "url").toString().slice(0, 30),
        caption: (body.caption || "").toString().slice(0, 300),
      }
    }
    const block = store.addBlock({ type, content })
    return sendJson(res, 201, { block })
  }

  // PUT /api/blocks/reorder -> urutkan ulang (body: { ids: [id1, id2, ...] })
  if (method === "PUT" && pathname === "/api/blocks/reorder") {
    const body = await readBody(req)
    const ids = Array.isArray(body.ids) ? body.ids : []
    const blocks = store.reorderBlocks(ids)
    return sendJson(res, 200, { blocks })
  }

  // PUT/DELETE /api/blocks/:id
  const blockMatch = pathname.match(/^\/api\/blocks\/([^/]+)$/)
  if (blockMatch) {
    const id = blockMatch[1]
    if (method === "PUT") {
      const body = await readBody(req)
      const block = store.getBlocks().find((b) => b.id === id)
      if (!block) return sendJson(res, 404, { error: "Blok tidak ditemukan" })
      const merged = { ...block, content: { ...block.content } }
      if (body.text !== undefined) merged.content.text = body.text.toString().slice(0, 5000)
      if (body.align !== undefined) merged.content.align = body.align
      if (body.src !== undefined) merged.content.src = body.src.toString().slice(0, 2000)
      if (body.alt !== undefined) merged.content.alt = body.alt.toString().slice(0, 300)
      if (body.caption !== undefined) merged.content.caption = body.caption.toString().slice(0, 300)
      if (body.url !== undefined) merged.content.url = body.url.toString().slice(0, 2000)
      if (body.embedType !== undefined) merged.content.embedType = body.embedType.toString().slice(0, 30)
      if (body.size !== undefined) merged.content.size = body.size
      if (body.level !== undefined) merged.content.level = body.level
      const updated = store.updateBlock(id, merged)
      return sendJson(res, 200, { block: updated })
    }
    if (method === "DELETE") {
      const ok = store.deleteBlock(id)
      return sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Blok tidak ditemukan" })
    }
  }

  // POST /api/blocks/:id/duplicate
  const blockDupMatch = pathname.match(/^\/api\/blocks\/([^/]+)\/duplicate$/)
  if (blockDupMatch && method === "POST") {
    const dup = store.duplicateBlock(blockDupMatch[1])
    if (!dup) return sendJson(res, 404, { error: "Blok tidak ditemukan" })
    return sendJson(res, 201, { block: dup })
  }

  // POST /api/blocks/:id/toggle-visibility
  const blockToggleMatch = pathname.match(/^\/api\/blocks\/([^/]+)\/toggle-visibility$/)
  if (blockToggleMatch && method === "POST") {
    const block = store.toggleBlockVisibility(blockToggleMatch[1])
    if (!block) return sendJson(res, 404, { error: "Blok tidak ditemukan" })
    return sendJson(res, 200, { block })
  }

  // POST /api/lyrics/boost -> perkuat lirik. Gemini bila ada key, kalau tidak pakai penguat lokal.
  if (method === "POST" && pathname === "/api/lyrics/boost") {
    const body = await readBody(req)
    const lyrics = (body.lyrics || "").toString().slice(0, 5000)
    const title = (body.title || "").toString().slice(0, 80)
    const style = (body.style || "").toString().slice(0, 1000)
    const model = (body.model || "").toString().slice(0, 60)
    if (!lyrics.trim() && !title.trim() && !style.trim()) {
      return sendJson(res, 400, { error: "Isi lirik, judul, atau gaya dulu" })
    }
    if (store.getGeminiRawKeys().length) {
      const prompt = [
        "Kamu penulis lirik lagu. Perkuat lirik berikut agar hook-nya lebih mudah diingat, rimanya lebih rapat, emosinya lebih jelas, dan strukturnya siap dipakai generator musik.",
        "Pertahankan bahasa, tema, dan makna. Jangan mengubah judul menjadi cerita lain.",
        "Format wajib: [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Chorus], [Outro].",
        "Ulangi baris hook di chorus. Setiap bagian 4-8 baris. Jangan terlalu panjang.",
        "Output HANYA lirik. Tanpa penjelasan, catatan, atau markdown.",
        title ? `Judul: ${title}` : "",
        style ? `Gaya: ${style}` : "",
        "",
        lyrics.trim() ? `LIRIK ASLI:\n${lyrics}` : "Lirik asli kosong. Tulis lirik baru dari judul dan gaya.",
      ].filter(Boolean).join("\n")
      try {
        const out = await gemini.generateText(prompt, model)
        const text = String(out.text || "").replace(/^```[\w]*\n?|```$/g, "").trim()
        if (text) return sendJson(res, 200, { lyrics: text.slice(0, 5000), source: "gemini" })
      } catch { /* lanjut ke penguat lokal */ }
    }
    return sendJson(res, 200, { lyrics: boostLyricsLocally(lyrics, title, style), source: "local" })
  }

  // POST /api/lyrics/generate -> hasilkan lirik via Gemini (rotasi key ditangani gemini.js)
  if (method === "POST" && pathname === "/api/lyrics/generate") {
    const body = await readBody(req)
    const theme = (body.theme || "").toString().trim().slice(0, 500)
    if (!theme) return sendJson(res, 400, { error: "Tema lagu wajib diisi" })
    const opts = {
      theme,
      language:  (body.language  || "Indonesia").toString().slice(0, 60),
      genre:     (body.genre     || "").toString().slice(0, 120),
      mood:      (body.mood      || "").toString().slice(0, 120),
      structure: (body.structure || "").toString().slice(0, 200),
      extra:     (body.extra     || "").toString().slice(0, 500),
      model:     (body.model     || "").toString().slice(0, 60),
    }
    try {
      const out = await gemini.generateLyrics(opts)
      return sendJson(res, 200, { lyrics: out.lyrics, model: out.model, keyId: out.keyId })
    } catch (e) {
      return sendJson(res, 502, { error: e.message })
    }
  }

  // POST /api/homofon/ai -> konversi teks ke homofon via Gemini
  if (method === "POST" && pathname === "/api/homofon/ai") {
    const body = await readBody(req)
    const text = (body.text || "").toString().trim().slice(0, 5000)
    if (!text) return sendJson(res, 400, { error: "Teks tidak boleh kosong" })
    const language = (body.language || "id").toString().slice(0, 20)
    const model = (body.model || "").toString().slice(0, 60)
    const extra = (body.extra || "").toString().slice(0, 200)

    const langLabel = language === "en" ? "English" : language === "auto" ? "campuran Indonesia & English" : "Bahasa Indonesia"
    const promptParts = []
    promptParts.push(`Kamu adalah ahli linguistik dan permainan kata. Tugasmu: ubah teks berikut menjadi versi HOMOFON.`)
    promptParts.push(`Homofon = kata yang bunyinya sama (atau sangat mirip saat diucapkan), tapi ejaan dan artinya berbeda.`)
    promptParts.push(`Bahasa: ${langLabel}.`)
    promptParts.push("")
    promptParts.push("ATURAN KETAT:")
    promptParts.push("- Ganti sebanyak mungkin kata dengan pasangan homofonnya.")
    promptParts.push("- Pertahankan struktur kalimat, tanda baca, dan format asli (baris baru, spasi).")
    promptParts.push("- Jika sebuah kata TIDAK punya homofon yang jelas, biarkan apa adanya.")
    promptParts.push("- Untuk Bahasa Indonesia, termasuk: ejaan lama/baru (apotek/apotik), h-luluh (hutang/utang), kh/k (khas/kas), f/p (aktif/aktip), z/j (zaman/jaman), informal (sudah/udah), serapan (rezeki/rejeki).")
    promptParts.push("- Untuk English, termasuk: there/their/they're, to/too/two, your/you're, flower/flour, knight/night, dll.")
    promptParts.push("- Output HANYA teks hasil konversi. JANGAN tambahkan penjelasan, catatan, intro, atau markdown.")
    promptParts.push("- JANGAN bungkus dalam backtick atau code block.")
    if (extra) promptParts.push(`- Instruksi tambahan dari user: ${extra}`)
    promptParts.push("")
    promptParts.push("TEKS ASLI:")
    promptParts.push(text)

    const prompt = promptParts.join("\n")

    try {
      const out = await gemini.generateText(prompt, model)
      return sendJson(res, 200, { result: out.text, model: out.model })
    } catch (e) {
      return sendJson(res, 502, { error: e.message })
    }
  }

  return sendJson(res, 404, { error: "Endpoint tidak ditemukan" })
}

// ------------------------------ Static files --------------------------------

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === "/") pathname = "/index.html"
  if (pathname === "/220580" || pathname === "/220580/") pathname = "/frontpage-admin-20260907.html"
  const filePath = normalize(join(PUBLIC_DIR, pathname))
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end("Forbidden")
  }
  try {
    const ext = extname(filePath)
    let data = await readFile(filePath)
    // Substitusi placeholder BASE_PATH di file teks (HTML & manifest).
    if (ext === ".html" || ext === ".webmanifest") {
      data = Buffer.from(data.toString("utf8").split("__GJM_BASE__").join(BASE_PATH))
    }
    const mime = MIME[ext] || "application/octet-stream"
    res.writeHead(200, { "Content-Type": mime })
    res.end(data)
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("404 Not Found")
  }
}

// --------------------------------- Server -----------------------------------

// Keep MCP/OAuth routing when adding future REST or frontend features.
const mcpHandler = process.env.MCP_ENABLED === "true"
  ? (await import("./mcp/index.js")).createMcpHandler({ handleApi, withOwner })
  : null

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  // Kupas BASE_PATH sebelum routing (dukungan deploy sub-path mis. /evo).
  if (BASE_PATH) {
    if (url.pathname === BASE_PATH) {
      res.writeHead(302, { Location: BASE_PATH + "/" })
      return res.end()
    }
    if (url.pathname.startsWith(BASE_PATH + "/")) {
      url.pathname = url.pathname.slice(BASE_PATH.length) || "/"
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      return res.end("404 Not Found (BASE_PATH " + BASE_PATH + " tidak cocok)")
    }
  }

  try {
    await storeReady
    // Passenger may append a slash to extensionless OAuth URLs.
    const mcpPath = url.pathname.replace(/\/+$/, "") || "/"
    const usesStore = mcpHandler?.matches(mcpPath) || url.pathname.startsWith("/api/")
    if (usesStore) await beginRequest()
    try {
      if (mcpHandler?.matches(mcpPath)) {
        await mcpHandler.handle(req, res)
      } else if (url.pathname.startsWith("/api/")) {
        const ownerId = getOwnerId(req, res)
        await withOwner(ownerId, () => handleApi(req, res, url))
      } else {
        await serveStatic(req, res, url)
      }
      if (usesStore) await flushStore()
    } finally {
      if (usesStore) endRequest()
    }
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: "Server error: " + e.message })
    else console.error("[v0] request error after response:", e.message)
  }
})

server.listen(PORT, () => {
  console.log(`\n  \uD83C\uDFB5 GEJEMUZIK berjalan di http://localhost:${PORT}${BASE_PATH}/`)
  console.log(`     BASE_PATH: ${BASE_PATH || "(root)"}`)
  console.log(`     Mode mock: ${process.env.PROVIDER_MOCK ?? "false"} | Kredit APIframe: ${store.getAllCredits().apiframe} · sunoapi.org: ${store.getAllCredits().suno}\n`)
})

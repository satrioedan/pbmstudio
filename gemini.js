// ============================================================================
// Gemini provider - generate lirik via Google Generative Language API.
// ============================================================================
// API: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={KEY}
// Mendukung multi-key rotation (lihat store.js > geminiKeys).
//
// Tidak ada endpoint "kredit" di Gemini, jadi "cek" = ping ringan untuk
// verifikasi key valid (status "ok"/"invalid" disimpan sebagai credits).
//   credits = 1  -> key valid (OK)
//   credits = 0  -> key invalid / quota habis
//   credits = null -> belum dicek
// ============================================================================

import "./config.js"
import { store, ENV_GEMINI_KEY } from "./store.js"

const BASE = "https://generativelanguage.googleapis.com/v1beta"
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash"
const MOCK = String(process.env.PROVIDER_MOCK ?? "false") === "true"

export const GEMINI_MODELS = [
  { id: "gemini-2.5-flash",  label: "Gemini 2.5 Flash (cepat)" },
  { id: "gemini-2.5-pro",    label: "Gemini 2.5 Pro (kualitas tinggi)" },
  { id: "gemini-2.0-flash",  label: "Gemini 2.0 Flash (stabil)" },
  { id: "gemini-1.5-flash",  label: "Gemini 1.5 Flash (legacy)" },
]

function pickKey() {
  const raw = store.getGeminiRawKeys()
  const pool = raw.length ? raw : (ENV_GEMINI_KEY ? [{ id: "env", key: ENV_GEMINI_KEY }] : [])
  if (!pool.length) throw new Error("Belum ada API key Gemini. Tambahkan di \u2699\uFE0F Setelan.")
  const idx = store.getGeminiKeyCursor() % pool.length
  store.setGeminiKeyCursor((idx + 1) % pool.length)
  return pool[idx]
}

function buildPrompt({ theme, language, genre, mood, structure, extra }) {
  const lang = (language || "Indonesia").trim()
  const parts = []
  parts.push(`Tulis lirik lagu lengkap dalam bahasa ${lang}.`)
  if (genre)  parts.push(`Genre: ${genre}.`)
  if (mood)   parts.push(`Mood/Suasana: ${mood}.`)
  if (structure) {
    parts.push(`Struktur: ${structure}.`)
  } else {
    parts.push("Struktur standar: [Verse 1] [Pre-Chorus] [Chorus] [Verse 2] [Pre-Chorus] [Chorus] [Bridge] [Chorus] [Outro].")
  }
  parts.push(`Tema / pesan lagu: ${theme}`)
  if (extra) parts.push(`Instruksi tambahan: ${extra}`)
  parts.push("")
  parts.push("ATURAN KETAT:")
  parts.push("- Output HANYA teks lirik mentah, siap di-copy ke generator musik (Suno/Lyria).")
  parts.push("- Setiap bagian diawali tag dalam kurung siku: [Verse 1], [Chorus], [Bridge], dst. (HARUS bahasa Inggris).")
  parts.push("- JANGAN tulis intro, kata pengantar, penjelasan, atau catatan apa pun. Mulai langsung dari [Verse 1].")
  parts.push("- JANGAN bungkus dalam backtick atau markdown.")
  parts.push("- Akhiri dengan baris terakhir [Outro] (jangan kosong).")
  return parts.join("\n")
}

function cleanOutput(text) {
  if (!text) return ""
  let s = String(text).trim()
  // Buang code fence ```...``` kalau ada
  s = s.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim()
  // Hapus baris pengantar sebelum [Verse / [Intro
  const m = s.search(/\[(Verse|Intro|Chorus|Pre-Chorus|Hook|Verse 1)/i)
  if (m > 0) s = s.slice(m).trim()
  return s
}

async function callGemini(key, model, prompt, { raw = false } = {}) {
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.95,
      topP: 0.95,
      maxOutputTokens: 2048,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`
    const err = new Error(`Gemini: ${msg}`)
    err.status = res.status
    err.body = data
    throw err
  }
  const cand = (data.candidates || [])[0]
  if (!cand) throw new Error("Gemini: respons kosong")
  const finish = cand.finishReason
  const text = (cand.content?.parts || []).map((p) => p.text || "").join("").trim()
  if (!text) throw new Error(`Gemini: tidak menghasilkan teks (finishReason=${finish || "?"})`)
  if (raw) return text
  return cleanOutput(text)
}

// --- MOCK lirik untuk dev/testing tanpa kredit ----------------------------
function mockLyrics({ theme, language, genre, mood }) {
  const t = theme || "cinta sederhana"
  return [
    "[Verse 1]",
    `Di pagi yang basah kita bicara tentang ${t}`,
    `Genre ${genre || "pop"} mengiring langkah pelan`,
    `Mood ${mood || "melankolis"} tersembunyi di hatiku`,
    "",
    "[Pre-Chorus]",
    "Lalu waktu memanggil, kita berdiri",
    "Menatap matahari, ya menatap matahari",
    "",
    "[Chorus]",
    `Oh tentang ${t}, oh tentang kita`,
    `Bahasa ${language || "Indonesia"} bicara apa adanya`,
    "Tak perlu indah, asal nyata",
    "",
    "[Verse 2]",
    "Mock lirik ini dihasilkan tanpa Gemini",
    "Set PROVIDER_MOCK=false dan tambah API key untuk hasil nyata",
    "",
    "[Bridge]",
    "Sepenggal cerita, kita simpan rapi",
    "",
    "[Chorus]",
    `Oh tentang ${t}, oh tentang kita`,
    `Bahasa ${language || "Indonesia"} bicara apa adanya`,
    "",
    "[Outro]",
    "Selamat datang di GEJEMUZIK.",
  ].join("\n")
}

export const gemini = {
  models: GEMINI_MODELS,

  // Generic text generation — kirim prompt langsung tanpa wrapping lirik
  async generateText(prompt, model) {
    if (MOCK) {
      await new Promise((r) => setTimeout(r, 600))
      return { text: "[MOCK] " + prompt.slice(0, 100), model: model || DEFAULT_MODEL, keyId: "mock" }
    }
    const useModel = (model && GEMINI_MODELS.some((m) => m.id === model)) ? model : DEFAULT_MODEL
    const totalKeys = store.getGeminiRawKeys().length
    let lastErr = null
    for (let i = 0; i < totalKeys; i++) {
      const { id, key } = pickKey()
      try {
        const text = await callGemini(key, useModel, prompt, { raw: true })
        store.updateGeminiKeyCredits(id, 1)
        return { text, model: useModel, keyId: id }
      } catch (e) {
        lastErr = e
        if (e.status === 401 || e.status === 403 || e.status === 429) {
          store.updateGeminiKeyCredits(id, 0)
          continue
        }
        throw e
      }
    }
    throw lastErr || new Error("Semua API key Gemini gagal")
  },

  async generateLyrics(input) {
    if (MOCK) {
      await new Promise((r) => setTimeout(r, 600))
      return { lyrics: mockLyrics(input), model: input.model || DEFAULT_MODEL, keyId: "mock" }
    }
    const model = (input.model && GEMINI_MODELS.some((m) => m.id === input.model)) ? input.model : DEFAULT_MODEL
    const prompt = buildPrompt(input)

    // Rotasi key: coba semua key bila ada error otentikasi/kuota.
    const totalKeys = store.getGeminiRawKeys().length
    let lastErr = null
    for (let i = 0; i < totalKeys; i++) {
      const { id, key } = pickKey()
      try {
        const lyrics = await callGemini(key, model, prompt)
        store.updateGeminiKeyCredits(id, 1) // tandai valid
        return { lyrics, model, keyId: id }
      } catch (e) {
        lastErr = e
        // 401/403/429 -> kemungkinan key bermasalah, tandai invalid lalu rotasi
        if (e.status === 401 || e.status === 403 || e.status === 429) {
          store.updateGeminiKeyCredits(id, 0)
          continue
        }
        throw e
      }
    }
    throw lastErr || new Error("Semua API key Gemini gagal")
  },

  async checkKey(key) {
    // Ping minimal: minta 1 token saja
    try {
      const url = `${BASE}/models/${DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(key)}`
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      })
      return res.ok ? 1 : 0
    } catch { return 0 }
  },
}

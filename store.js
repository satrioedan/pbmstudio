// Penyimpanan sederhana berbasis file JSON (tanpa dependency).
// Data lagu dan API key dipisah per browser/perangkat memakai ownerId.

import "./config.js"
import { databaseUrl, loadAppState, saveAppState } from "./lib/db.js"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_FILE = join(__dirname, "data.json")
const START_CREDITS = Number(process.env.START_CREDITS ?? 500)

export const ENV_GEMINI_KEY = (process.env.GEMINI_API_KEY || "").trim()

const CREDIT_KEYS = { apiframe: "creditsApiframe", suno: "creditsSuno" }
function readyTracks(tracks) {
  return (Array.isArray(tracks) ? tracks : []).filter((t) => t && t.audioUrl)
}

function versionTitle(title, index, total) {
  const base = String(title || "Lagu").replace(/\s+\(\d+\)$/, "").trim() || "Lagu"
  return (total > 1 ? `${base} (${index + 1})` : base).slice(0, 80)
}

function splitSongResult(song) {
  const ready = readyTracks(song.tracks)
  if (ready.length < 2) return []
  const group = song.splitGroup || song.id
  const now = Date.now()
  const first = ready[0]
  song.splitGroup = group
  song.splitIndex = 1
  song.title = versionTitle(song.title, 0, ready.length)
  song.audioUrl = first.audioUrl
  song.imageUrl = first.imageUrl || song.imageUrl || null
  song.tracks = [first]
  song.updatedAt = now
  const created = []
  for (let i = 1; i < ready.length; i++) {
    const track = ready[i]
    const exists = state.songs.find((s) => s.splitGroup === group && (
      (track.id && Array.isArray(s.tracks) && s.tracks[0] && s.tracks[0].id === track.id) || s.audioUrl === track.audioUrl
    ))
    if (exists) continue
    state.songs.push({
      ...song,
      id: randomUUID(),
      title: versionTitle(song.title, i, ready.length),
      audioUrl: track.audioUrl,
      imageUrl: track.imageUrl || song.imageUrl || null,
      tracks: [track],
      splitGroup: group,
      splitIndex: i + 1,
      credits: 0,
      liked: false,
      stemProvider: null, stemType: null, stemJobId: null, stemKeyId: null,
      stemStatus: null, stems: [], stemError: null,
      wavJobId: null, wavKeyId: null, wavStatus: null, wavUrl: null, wavError: null,
      videoJobId: null, videoKeyId: null, videoStatus: null, videoUrl: null, videoError: null,
      createdAt: song.createdAt || now,
      updatedAt: now,
    })
    created.push(state.songs.at(-1))
  }
  return created
}

function splitStoredSongs() {
  let changed = false
  for (const song of state.songs) {
    if (song.status === "success" && readyTracks(song.tracks).length > 1) {
      splitSongResult(song)
      changed = true
    }
  }
  return changed
}

function creditField(which) { return CREDIT_KEYS[which] || CREDIT_KEYS.apiframe }

const ownerContext = new AsyncLocalStorage()
export function withOwner(ownerId, fn) {
  return ownerContext.run(String(ownerId || "guest").slice(0, 80), fn)
}
function currentOwner() { return ownerContext.getStore() || "guest" }
function owns(item) { return item && item.ownerId === currentOwner() }
function ownedList(arr) { return Array.isArray(arr) ? arr.filter(owns) : [] }
function cursorKey(name) { return name + ":" + currentOwner() }

function getDefaultFrontpage() {
  return {
    title: "GEJEMUZIK",
    subtitle: "AI Song Generator",
    tagline: "Buat lagu dengan AI — Suno, Lyria, Udio & Gemini dalam satu tempat",
    description: "Generate lagu dari teks, aransemen ulang, pisah stem, dan hasilkan lirik otomatis. Semua dari browser, tanpa ribet.",
    features: [
      { icon: "🎵", text: "Generate lagu dari judul + gaya + lirik" },
      { icon: "🎹", text: "Aransemen ulang (cover) dengan gaya baru" },
      { icon: "🎼", text: "Pisah stem vokal & instrumen" },
      { icon: "✍️", text: "Tulis lirik otomatis pakai Gemini" },
    ],
    cta: "Mulai Buat Lagu",
    footer: "by bangalimin",
    blocks: [],
  }
}

function makeInitialState() {
  return {
    songs: [],
    frontpage: getDefaultFrontpage(),
    creditsApiframe: START_CREDITS,
    creditsSuno: START_CREDITS,
    apiKeys: [],
    uploadKeys: [],
    geminiKeys: [],
    kieKeys: [],
    musicapiKeys: [],
    crunKeys: [],
    keyCursor: 0,
    uploadKeyCursor: 0,
    geminiKeyCursor: 0,
    userCredits: {},
    cursors: {},
  }
}

function load() {
  if (databaseUrl()) return makeInitialState()
  let s
  if (!existsSync(DB_FILE)) {
    s = makeInitialState()
  } else {
    try { s = JSON.parse(readFileSync(DB_FILE, "utf8")) }
    catch {
      const bak = DB_FILE + ".bak"
      if (existsSync(bak)) {
        try { s = JSON.parse(readFileSync(bak, "utf8")); console.warn("data.json corrupt — pulihkan dari data.json.bak") }
        catch { s = makeInitialState() }
      } else s = makeInitialState()
    }
  }
  return normalizeState(s)
}

function normalizeState(s) {
  if (!s || typeof s !== "object") s = makeInitialState()
  if (!Array.isArray(s.songs)) s.songs = []
  if (!s.frontpage || typeof s.frontpage !== "object") s.frontpage = getDefaultFrontpage()
  if (!Array.isArray(s.frontpage.features)) s.frontpage.features = getDefaultFrontpage().features
  if (!Array.isArray(s.frontpage.blocks)) s.frontpage.blocks = []

  if (typeof s.creditsApiframe !== "number") s.creditsApiframe = typeof s.credits === "number" ? s.credits : START_CREDITS
  if (typeof s.creditsSuno !== "number") s.creditsSuno = typeof s.credits === "number" ? s.credits : START_CREDITS
  delete s.credits

  if (!Array.isArray(s.apiKeys)) s.apiKeys = []
  if (!Array.isArray(s.uploadKeys)) s.uploadKeys = []
  if (!Array.isArray(s.geminiKeys)) s.geminiKeys = []
  if (!Array.isArray(s.kieKeys)) s.kieKeys = []
  if (!Array.isArray(s.musicapiKeys)) s.musicapiKeys = []
  if (!Array.isArray(s.crunKeys)) s.crunKeys = []
  if (typeof s.keyCursor !== "number") s.keyCursor = 0
  if (typeof s.uploadKeyCursor !== "number") s.uploadKeyCursor = 0
  if (typeof s.geminiKeyCursor !== "number") s.geminiKeyCursor = 0
  if (!s.userCredits || typeof s.userCredits !== "object") s.userCredits = {}
  if (!s.cursors || typeof s.cursors !== "object") s.cursors = {}

  // Migrasi uploadKey tunggal lama.
  if (typeof s.uploadKey === "string" && s.uploadKey.trim() && !s.uploadKeys.some((k) => k.key === s.uploadKey.trim())) {
    s.uploadKeys.push({ id: randomUUID(), key: s.uploadKey.trim(), credits: null, addedAt: Date.now(), lastCheckedAt: null })
  }
  delete s.uploadKey
  return s
}

export function maskKey(key) {
  if (!key || key.length <= 11) return key || ""
  return key.slice(0, 7) + "…" + key.slice(-4)
}

let writeChain = Promise.resolve()
let dbReady = !databaseUrl()

function persist(next) {
  if (databaseUrl()) {
    if (!dbReady) throw new Error("Database belum siap. Coba lagi sebentar.")
    const snapshot = JSON.parse(JSON.stringify(next))
    const run = () => saveAppState(snapshot)
    writeChain = writeChain.then(run, run)
    return
  }
  try {
    if (existsSync(DB_FILE)) {
      try { writeFileSync(DB_FILE + ".bak", readFileSync(DB_FILE)) } catch {}
    }
    writeFileSync(DB_FILE, JSON.stringify(next, null, 2))
  } catch (e) {
    if (e && (e.code === "EROFS" || e.code === "EACCES" || e.code === "EROFS")) {
      throw new Error("Filesystem Vercel hanya bisa dibaca dan DATABASE_URL belum terbaca. API key tidak tersimpan.")
    }
    throw e
  }
}

export function flushStore() {
  return writeChain
}

async function hydrate() {
  if (!databaseUrl()) return
  const data = await loadAppState()
  if (data && typeof data === "object") state = normalizeState(data)
  dbReady = true
}

function ensureOwnerCredits() {
  const owner = currentOwner()
  if (!state.userCredits[owner]) {
    state.userCredits[owner] = { creditsApiframe: START_CREDITS, creditsSuno: START_CREDITS }
  }
  if (typeof state.userCredits[owner].creditsApiframe !== "number") state.userCredits[owner].creditsApiframe = START_CREDITS
  if (typeof state.userCredits[owner].creditsSuno !== "number") state.userCredits[owner].creditsSuno = START_CREDITS
  return state.userCredits[owner]
}

function listPool(arr) {
  return arr.map((k) => ({
    id: k.id,
    masked: maskKey(k.key),
    credits: k.credits ?? null,
    addedAt: k.addedAt,
    lastCheckedAt: k.lastCheckedAt ?? null,
  }))
}

function addToPoolForOwner(arr, rawText) {
  const owner = currentOwner()
  const candidates = String(rawText || "")
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  let added = 0
  for (const key of candidates) {
    const owned = arr.find((k) => k.key === key && k.ownerId === owner)
    if (owned) continue

    // Jika data lama belum punya ownerId, adopsi oleh owner yang menambahkan ulang.
    const legacy = arr.find((k) => k.key === key && !k.ownerId)
    if (legacy) {
      legacy.ownerId = owner
      legacy.addedAt = legacy.addedAt || Date.now()
      added++
      continue
    }

    arr.push({ id: randomUUID(), ownerId: owner, key, credits: null, addedAt: Date.now(), lastCheckedAt: null })
    added++
  }
  return added
}

let state = load()
export const storeReady = hydrate()

export const store = {
  // ------------------------------ KREDIT -----------------------------------
  getCredits(which = "apiframe") {
    return ensureOwnerCredits()[creditField(which)]
  },
  getAllCredits() {
    const uc = ensureOwnerCredits()
    return { apiframe: uc.creditsApiframe, suno: uc.creditsSuno }
  },
  deductCredits(which, n) {
    const uc = ensureOwnerCredits()
    const f = creditField(which)
    uc[f] = Math.max(0, uc[f] - n)
    persist(state)
    return uc[f]
  },

  // ------------------------------- LAGU ------------------------------------
  listSongs({ liked } = {}) {
    if (splitStoredSongs()) persist(state)
    let songs = ownedList(state.songs).sort((a, b) => b.createdAt - a.createdAt)
    if (liked) songs = songs.filter((s) => s.liked)
    return songs
  },
  getSong(id) {
    return state.songs.find((s) => s.id === id && owns(s)) || null
  },
  getSongByJob(jobId) {
    return state.songs.find((s) => s.providerJobId === jobId) || null
  },
  addSong(song) {
    song.ownerId = currentOwner()
    state.songs.push(song)
    persist(state)
    return song
  },
  updateSong(id, patch) {
    const song = state.songs.find((s) => s.id === id)
    if (!song) return null
    Object.assign(song, patch, { updatedAt: Date.now() })
    persist(state)
    return song
  },
  applyResult(id, patch) {
    const song = state.songs.find((s) => s.id === id)
    if (!song) return { song: null, created: [] }
    Object.assign(song, patch, { updatedAt: Date.now() })
    const created = song.status === "success" ? splitSongResult(song) : []
    persist(state)
    return { song, created }
  },
  deleteSong(id) {
    const before = state.songs.length
    const owner = currentOwner()
    state.songs = state.songs.filter((s) => !(s.id === id && s.ownerId === owner))
    persist(state)
    return state.songs.length < before
  },
  deleteAll() {
    const owner = currentOwner()
    state.songs = state.songs.filter((s) => s.ownerId !== owner)
    persist(state)
  },

  // ----------------------- API KEYS APIframe -------------------------------
  getRawKeys() { return ownedList(state.apiKeys).map((k) => ({ id: k.id, key: k.key })) },
  listKeys() { return listPool(ownedList(state.apiKeys)) },
  getKey(id) { return state.apiKeys.find((k) => k.id === id && owns(k)) || null },
  addKeys(rawText) {
    const added = addToPoolForOwner(state.apiKeys, rawText)
    if (added) persist(state)
    return added
  },
  updateKeyCredits(id, credits) {
    const k = state.apiKeys.find((x) => x.id === id && owns(x))
    if (!k) return null
    k.credits = credits
    k.lastCheckedAt = Date.now()
    persist(state)
    return k
  },
  deleteKey(id) {
    const before = state.apiKeys.length
    const owner = currentOwner()
    state.apiKeys = state.apiKeys.filter((k) => !(k.id === id && k.ownerId === owner))
    if (state.apiKeys.length !== before) persist(state)
    return state.apiKeys.length < before
  },
  deleteAllKeys() {
    const owner = currentOwner()
    state.apiKeys = state.apiKeys.filter((k) => k.ownerId !== owner)
    state.cursors[cursorKey("keyCursor")] = 0
    persist(state)
  },
  getKeyCursor() { return state.cursors[cursorKey("keyCursor")] || 0 },
  setKeyCursor(n) { state.cursors[cursorKey("keyCursor")] = n; persist(state) },

  // ------------- API KEYS sunoapi.org (Upload & Cover) ---------------------
  getUploadRawKeys() { return ownedList(state.uploadKeys).map((k) => ({ id: k.id, key: k.key })) },
  listUploadKeys() { return listPool(ownedList(state.uploadKeys)) },
  getUploadKeyById(id) { return state.uploadKeys.find((k) => k.id === id && owns(k)) || null },
  addUploadKeys(rawText) {
    const added = addToPoolForOwner(state.uploadKeys, rawText)
    if (added) persist(state)
    return added
  },
  updateUploadKeyCredits(id, credits) {
    const k = state.uploadKeys.find((x) => x.id === id && owns(x))
    if (!k) return null
    k.credits = credits
    k.lastCheckedAt = Date.now()
    persist(state)
    return k
  },
  deleteUploadKey(id) {
    const before = state.uploadKeys.length
    const owner = currentOwner()
    state.uploadKeys = state.uploadKeys.filter((k) => !(k.id === id && k.ownerId === owner))
    if (state.uploadKeys.length !== before) persist(state)
    return state.uploadKeys.length < before
  },
  deleteAllUploadKeys() {
    const owner = currentOwner()
    state.uploadKeys = state.uploadKeys.filter((k) => k.ownerId !== owner)
    state.cursors[cursorKey("uploadKeyCursor")] = 0
    persist(state)
  },
  getUploadKeyCursor() { return state.cursors[cursorKey("uploadKeyCursor")] || 0 },
  setUploadKeyCursor(n) { state.cursors[cursorKey("uploadKeyCursor")] = n; persist(state) },

  // ----------------- API KEYS Gemini (Generate Lirik) ----------------------
  getGeminiRawKeys() { return ownedList(state.geminiKeys).map((k) => ({ id: k.id, key: k.key })) },
  listGeminiKeys() { return listPool(ownedList(state.geminiKeys)) },
  getGeminiKeyById(id) { return state.geminiKeys.find((k) => k.id === id && owns(k)) || null },
  addGeminiKeys(rawText) {
    const added = addToPoolForOwner(state.geminiKeys, rawText)
    if (added) persist(state)
    return added
  },
  updateGeminiKeyCredits(id, credits) {
    const k = state.geminiKeys.find((x) => x.id === id && owns(x))
    if (!k) return null
    k.credits = credits
    k.lastCheckedAt = Date.now()
    persist(state)
    return k
  },
  deleteGeminiKey(id) {
    const before = state.geminiKeys.length
    const owner = currentOwner()
    state.geminiKeys = state.geminiKeys.filter((k) => !(k.id === id && k.ownerId === owner))
    if (state.geminiKeys.length !== before) persist(state)
    return state.geminiKeys.length < before
  },
  deleteAllGeminiKeys() {
    const owner = currentOwner()
    state.geminiKeys = state.geminiKeys.filter((k) => k.ownerId !== owner)
    state.cursors[cursorKey("geminiKeyCursor")] = 0
    persist(state)
  },
  getGeminiKeyCursor() { return state.cursors[cursorKey("geminiKeyCursor")] || 0 },
  setGeminiKeyCursor(n) { state.cursors[cursorKey("geminiKeyCursor")] = n; persist(state) },

  // ----------------- API KEYS KIE AI --------------------------------------
  getKieRawKeys() { return ownedList(state.kieKeys).map((k) => ({ id: k.id, key: k.key })) },
  listKieKeys() { return listPool(ownedList(state.kieKeys)) },
  getKieKeyById(id) { return state.kieKeys.find((k) => k.id === id && owns(k)) || null },
  addKieKeys(rawText) { const added = addToPoolForOwner(state.kieKeys, rawText); if (added) persist(state); return added },
  updateKieKeyCredits(id, credits) { const k = state.kieKeys.find((x) => x.id === id && owns(x)); if (!k) return null; k.credits = credits; k.lastCheckedAt = Date.now(); persist(state); return k },
  deleteKieKey(id) { const before = state.kieKeys.length; const owner = currentOwner(); state.kieKeys = state.kieKeys.filter((k) => !(k.id === id && k.ownerId === owner)); if (state.kieKeys.length !== before) persist(state); return state.kieKeys.length < before },
  deleteAllKieKeys() { const owner = currentOwner(); state.kieKeys = state.kieKeys.filter((k) => k.ownerId !== owner); state.cursors[cursorKey("kieKeyCursor")] = 0; persist(state) },
  getKieKeyCursor() { return state.cursors[cursorKey("kieKeyCursor")] || 0 },
  setKieKeyCursor(n) { state.cursors[cursorKey("kieKeyCursor")] = n; persist(state) },

  // ----------------- API KEYS MusicAPI.ai ---------------------------------
  getMusicApiRawKeys() { return ownedList(state.musicapiKeys).map((k) => ({ id: k.id, key: k.key })) },
  listMusicApiKeys() { return listPool(ownedList(state.musicapiKeys)) },
  getMusicApiKeyById(id) { return state.musicapiKeys.find((k) => k.id === id && owns(k)) || null },
  addMusicApiKeys(rawText) { const added = addToPoolForOwner(state.musicapiKeys, rawText); if (added) persist(state); return added },
  updateMusicApiKeyCredits(id, credits) { const k = state.musicapiKeys.find((x) => x.id === id && owns(x)); if (!k) return null; k.credits = credits; k.lastCheckedAt = Date.now(); persist(state); return k },
  deleteMusicApiKey(id) { const before = state.musicapiKeys.length; const owner = currentOwner(); state.musicapiKeys = state.musicapiKeys.filter((k) => !(k.id === id && k.ownerId === owner)); if (state.musicapiKeys.length !== before) persist(state); return state.musicapiKeys.length < before },
  deleteAllMusicApiKeys() { const owner = currentOwner(); state.musicapiKeys = state.musicapiKeys.filter((k) => k.ownerId !== owner); state.cursors[cursorKey("musicapiKeyCursor")] = 0; persist(state) },
  getMusicApiKeyCursor() { return state.cursors[cursorKey("musicapiKeyCursor")] || 0 },
  setMusicApiKeyCursor(n) { state.cursors[cursorKey("musicapiKeyCursor")] = n; persist(state) },

  // ----------------- API KEYS crun.ai --------------------------------------
  getCrunRawKeys() { return ownedList(state.crunKeys).map((k) => ({ id: k.id, key: k.key })) },
  listCrunKeys() { return listPool(ownedList(state.crunKeys)) },
  getCrunKeyById(id) { return state.crunKeys.find((k) => k.id === id && owns(k)) || null },
  addCrunKeys(rawText) { const added = addToPoolForOwner(state.crunKeys, rawText); if (added) persist(state); return added },
  updateCrunKeyCredits(id, credits) { const k = state.crunKeys.find((x) => x.id === id && owns(x)); if (!k) return null; k.credits = credits; k.lastCheckedAt = Date.now(); persist(state); return k },
  deleteCrunKey(id) { const before = state.crunKeys.length; const owner = currentOwner(); state.crunKeys = state.crunKeys.filter((k) => !(k.id === id && k.ownerId === owner)); if (state.crunKeys.length !== before) persist(state); return state.crunKeys.length < before },
  deleteAllCrunKeys() { const owner = currentOwner(); state.crunKeys = state.crunKeys.filter((k) => k.ownerId !== owner); state.cursors[cursorKey("crunKeyCursor")] = 0; persist(state) },
  getCrunKeyCursor() { return state.cursors[cursorKey("crunKeyCursor")] || 0 },
  setCrunKeyCursor(n) { state.cursors[cursorKey("crunKeyCursor")] = n; persist(state) },

  // ----------------------------- FRONTPAGE ---------------------------------
  getFrontpage() { return { ...state.frontpage } },
  saveFrontpage(fp) {
    Object.assign(state.frontpage, fp)
    persist(state)
    return this.getFrontpage()
  },

  // ----------------------------- BLOCKS ------------------------------------
  getBlocks() { return state.frontpage.blocks || [] },
  addBlock(block) {
    const blocks = state.frontpage.blocks || []
    const id = randomUUID()
    const order = blocks.length
    blocks.push({ id, order, hidden: false, ...block })
    state.frontpage.blocks = blocks
    persist(state)
    return blocks.find((b) => b.id === id)
  },
  updateBlock(id, patch) {
    const block = (state.frontpage.blocks || []).find((b) => b.id === id)
    if (!block) return null
    Object.assign(block, patch)
    persist(state)
    return block
  },
  deleteBlock(id) {
    const blocks = state.frontpage.blocks || []
    const before = blocks.length
    const remaining = blocks.filter((b) => b.id !== id)
    if (remaining.length === before) return false
    remaining.forEach((b, i) => { b.order = i })
    state.frontpage.blocks = remaining
    persist(state)
    return true
  },
  duplicateBlock(id) {
    const blocks = state.frontpage.blocks || []
    const src = blocks.find((b) => b.id === id)
    if (!src) return null
    const dup = { ...src, id: randomUUID(), order: src.order + 1, content: { ...src.content } }
    blocks.forEach((b) => { if (b.order >= dup.order) b.order++ })
    blocks.push(dup)
    blocks.sort((a, b) => a.order - b.order)
    persist(state)
    return dup
  },
  toggleBlockVisibility(id) {
    const block = (state.frontpage.blocks || []).find((b) => b.id === id)
    if (!block) return null
    block.hidden = !block.hidden
    persist(state)
    return block
  },
  reorderBlocks(orderedIds) {
    const blocks = state.frontpage.blocks || []
    const map = {}
    blocks.forEach((b) => { map[b.id] = b })
    const reordered = orderedIds.map((id, i) => {
      if (map[id]) { map[id].order = i; return map[id] }
      return null
    }).filter(Boolean)
    const existing = new Set(orderedIds)
    blocks.forEach((b) => { if (!existing.has(b.id)) { b.order = reordered.length; reordered.push(b) } })
    state.frontpage.blocks = reordered
    persist(state)
    return this.getBlocks()
  },
}

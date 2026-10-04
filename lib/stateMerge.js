export const KEY_FIELDS = ["apiKeys", "uploadKeys", "geminiKeys", "kieKeys", "musicapiKeys", "crunKeys"]

export function mergeStates(dbState, localState, baseState) {
  const db = dbState && typeof dbState === "object" ? dbState : {}
  const local = localState && typeof localState === "object" ? localState : {}
  const base = baseState && typeof baseState === "object" ? baseState : {}
  const out = { ...db, ...local }
  for (const field of KEY_FIELDS) {
    out[field] = dedupeKeys(mergeById(db[field], local[field], base[field], pickKey))
  }
  out.songs = mergeById(db.songs, local.songs, base.songs, pickSong)
  out.cursors = mergeChangedMap(db.cursors, local.cursors, base.cursors)
  out.userCredits = mergeChangedMap(db.userCredits, local.userCredits, base.userCredits)
  out.frontpage = JSON.stringify(base.frontpage ?? null) === JSON.stringify(local.frontpage ?? null)
    ? (db.frontpage ?? local.frontpage)
    : local.frontpage
  out.mcpJournal = { ...(db.mcpJournal || {}), ...(local.mcpJournal || {}) }
  out.revision = Number(db.revision) || 0
  return out
}

function pickKey(prev, next) {
  const newer = (next.lastCheckedAt || 0) >= (prev.lastCheckedAt || 0) ? { ...prev, ...next } : { ...next, ...prev }
  if (newer.credits == null) newer.credits = next.credits ?? prev.credits ?? null
  newer.id = prev.id || next.id
  const addedAt = Math.min(prev.addedAt || Infinity, next.addedAt || Infinity)
  newer.addedAt = Number.isFinite(addedAt) ? addedAt : (prev.addedAt || next.addedAt || Date.now())
  return newer
}

function pickSong(prev, next) {
  const chosen = (next.updatedAt || 0) >= (prev.updatedAt || 0) ? { ...prev, ...next } : { ...next, ...prev }
  chosen.id = prev.id || next.id
  return chosen
}

function mergeById(dbArr, localArr, baseArr, pick) {
  const db = Array.isArray(dbArr) ? dbArr : []
  const local = Array.isArray(localArr) ? localArr : []
  const base = Array.isArray(baseArr) ? baseArr : []
  const baseIds = new Set(base.map((item) => item && item.id).filter(Boolean))
  const localIds = new Set(local.map((item) => item && item.id).filter(Boolean))
  const removed = new Set([...baseIds].filter((id) => !localIds.has(id)))
  const map = new Map()
  for (const item of db) {
    if (!item || !item.id || removed.has(item.id)) continue
    map.set(item.id, item)
  }
  for (const item of local) {
    if (!item || !item.id) continue
    const prev = map.get(item.id)
    map.set(item.id, prev ? pick(prev, item) : item)
  }
  return [...map.values()]
}

function dedupeKeys(arr) {
  const map = new Map()
  for (const key of arr) {
    const ident = `${key.ownerId || ""}:${key.key || ""}`
    const prev = map.get(ident)
    map.set(ident, prev ? pickKey(prev, key) : key)
  }
  return [...map.values()]
}

function mergeChangedMap(dbMap, localMap, baseMap) {
  const out = { ...(dbMap || {}) }
  const base = baseMap || {}
  const local = localMap || {}
  for (const [key, value] of Object.entries(local)) {
    if (JSON.stringify(base[key]) !== JSON.stringify(value)) out[key] = value
  }
  for (const key of Object.keys(base)) {
    if (!(key in local)) delete out[key]
  }
  return out
}

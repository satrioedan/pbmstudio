import { getPool } from "./db.js"

const MAX_CHUNK_CHARS = 3_000_000
const MAX_FILE_BYTES = 10 * 1024 * 1024
let tableReady = null

function poolOrThrow() {
  const pool = getPool()
  if (!pool) throw new Error("Database belum tersedia")
  return pool
}

async function ensureTable(pool) {
  if (!tableReady) {
    tableReady = pool.query(`CREATE TABLE IF NOT EXISTS upload_chunks (
      session_id text NOT NULL,
      idx integer NOT NULL,
      owner_id text NOT NULL,
      total integer NOT NULL,
      file_name text NOT NULL,
      data text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (session_id, idx)
    )`).catch((error) => {
      tableReady = null
      throw error
    })
  }
  await tableReady
}

export async function saveUploadChunk({ sessionId, index, total, fileName, chunk, ownerId }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ""))) throw new Error("Sesi unggah tidak valid")
  if (!Number.isInteger(index) || index < 0 || index > 15) throw new Error("Potongan unggah tidak valid")
  if (!Number.isInteger(total) || total < 1 || total > 16 || index >= total) throw new Error("File terlalu besar")
  if (typeof chunk !== "string" || !chunk || chunk.length > MAX_CHUNK_CHARS) throw new Error("Potongan unggah terlalu besar")
  const pool = poolOrThrow()
  await ensureTable(pool)
  const existing = await pool.query("SELECT owner_id FROM upload_chunks WHERE session_id = $1 LIMIT 1", [sessionId])
  if (existing.rows[0] && existing.rows[0].owner_id !== ownerId) throw new Error("Sesi unggah tidak valid")
  await pool.query("DELETE FROM upload_chunks WHERE created_at < now() - interval '2 hours'")
  await pool.query(
    `INSERT INTO upload_chunks (session_id, idx, owner_id, total, file_name, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (session_id, idx) DO UPDATE SET data = EXCLUDED.data`,
    [sessionId, index, ownerId, total, String(fileName || "audio.mp3").slice(0, 120), chunk],
  )
}

export async function takeUploadSession(sessionId, ownerId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ""))) throw new Error("Sesi unggah tidak valid")
  const pool = poolOrThrow()
  await ensureTable(pool)
  const { rows } = await pool.query(
    "SELECT idx, total, file_name, data, owner_id FROM upload_chunks WHERE session_id = $1 ORDER BY idx",
    [sessionId],
  )
  if (!rows.length || rows.some((row) => row.owner_id !== ownerId)) throw new Error("Unggahan tidak ditemukan atau sudah kedaluwarsa")
  const total = Number(rows[0].total)
  if (rows.length !== total || rows.some((row, i) => Number(row.idx) !== i)) throw new Error("Unggahan belum lengkap")
  const bytes = Buffer.concat(rows.map((row) => Buffer.from(row.data, "base64")))
  await pool.query("DELETE FROM upload_chunks WHERE session_id = $1", [sessionId])
  if (!bytes.length) throw new Error("File audio kosong")
  if (bytes.length > MAX_FILE_BYTES) throw new Error("File maksimal 10 MB")
  return { base64Data: bytes.toString("base64"), fileName: rows[0].file_name }
}

import { drizzle } from "drizzle-orm/node-postgres"
import { eq } from "drizzle-orm"
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { Pool } from "pg"
import { attachDatabasePool } from "@vercel/functions/db-connections"

const STATE_ID = "main"

export const appState = pgTable("app_state", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || ""
}

let db
let pool

export function getPool() {
  const url = databaseUrl()
  if (!url) return null
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 1 })
    if (process.env.VERCEL) {
      try { attachDatabasePool(pool) } catch { /* query tetap jalan tanpa helper */ }
    }
  }
  return pool
}

export function getDb() {
  const activePool = getPool()
  if (!activePool) return null
  if (!db) db = drizzle(activePool, { schema: { appState } })
  return db
}

export async function loadAppState() {
  const database = getDb()
  if (!database) return null
  const rows = await database
    .select({ data: appState.data })
    .from(appState)
    .where(eq(appState.id, STATE_ID))
    .limit(1)
  return rows[0]?.data ?? null
}

export async function saveAppState(data) {
  return patchAppState(() => data)
}

export async function patchAppState(mutator) {
  const activePool = getPool()
  if (!activePool) throw new Error("DATABASE_URL belum tersedia")
  const client = await activePool.connect()
  try {
    await client.query("BEGIN")
    const current = await client.query("SELECT data FROM app_state WHERE id = $1 FOR UPDATE", [STATE_ID])
    const next = await mutator(current.rows[0]?.data ?? null)
    await client.query(
      `INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [STATE_ID, JSON.stringify(next)],
    )
    await client.query("COMMIT")
    return next
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* rollback gagal setelah koneksi putus */ }
    throw error
  } finally {
    client.release()
  }
}

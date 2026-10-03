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

function getDb() {
  const url = databaseUrl()
  if (!url) return null
  if (!db) {
    const pool = new Pool({ connectionString: url, max: 1 })
    if (process.env.VERCEL) {
      try { attachDatabasePool(pool) } catch { /* query tetap jalan tanpa helper */ }
    }
    db = drizzle(pool, { schema: { appState } })
  }
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
  const database = getDb()
  if (!database) throw new Error("DATABASE_URL belum tersedia")
  const now = new Date()
  await database
    .insert(appState)
    .values({ id: STATE_ID, data, updatedAt: now })
    .onConflictDoUpdate({
      target: appState.id,
      set: { data, updatedAt: now },
    })
}

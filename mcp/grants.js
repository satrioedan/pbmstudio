import { and, eq, lt, sql } from "drizzle-orm"
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { getDb } from "../lib/db.js"

export const mcpGrants = pgTable("mcp_grants", {
  kind: text("kind").notNull(),
  id: text("id").notNull(),
  data: jsonb("data").notNull(),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
  family: text("family"),
})

const memory = new Map()

function key(kind, id) {
  return kind + "\0" + id
}

export function createGrantStore() {
  const database = getDb()
  if (!database) {
    return {
      async get(kind, id) {
        const row = memory.get(key(kind, id))
        if (!row || row.expires <= Date.now()) {
          memory.delete(key(kind, id))
          return null
        }
        return row.data
      },
      async put(kind, id, data, expires, family = null) {
        memory.set(key(kind, id), { data, expires, family })
      },
      async remove(kind, id) {
        memory.delete(key(kind, id))
      },
      async removeFamily(family) {
        for (const [k, row] of memory) if (row.family === family) memory.delete(k)
      },
      async count(kind) {
        let n = 0
        for (const [k, row] of memory) if (k.startsWith(kind + "\0") && row.expires > Date.now()) n++
        return n
      },
    }
  }
  return {
    async get(kind, id) {
      const rows = await database
        .select({ data: mcpGrants.data })
        .from(mcpGrants)
        .where(and(eq(mcpGrants.kind, kind), eq(mcpGrants.id, id), sql`${mcpGrants.expires} > now()`))
        .limit(1)
      return rows[0]?.data ?? null
    },
    async put(kind, id, data, expires, family = null) {
      const row = { kind, id, data, expires: new Date(expires), family }
      await database
        .insert(mcpGrants)
        .values(row)
        .onConflictDoUpdate({
          target: [mcpGrants.kind, mcpGrants.id],
          set: { data: row.data, expires: row.expires, family: row.family },
        })
    },
    async remove(kind, id) {
      await database.delete(mcpGrants).where(and(eq(mcpGrants.kind, kind), eq(mcpGrants.id, id)))
    },
    async removeFamily(family) {
      await database.delete(mcpGrants).where(eq(mcpGrants.family, family))
    },
    async count(kind) {
      await database.delete(mcpGrants).where(lt(mcpGrants.expires, new Date()))
      const rows = await database
        .select({ n: sql`count(*)::int` })
        .from(mcpGrants)
        .where(eq(mcpGrants.kind, kind))
      return Number(rows[0]?.n || 0)
    },
  }
}

import test from "node:test"
import assert from "node:assert/strict"
import { mergeStates } from "./stateMerge.js"

test("stacked keys survive a stale save", () => {
  const db = { revision: 3, crunKeys: [
    { id: "a", ownerId: "u", key: "one", credits: 10 },
    { id: "b", ownerId: "u", key: "two", credits: 20 },
  ], songs: [] }
  const base = { revision: 1, crunKeys: [], songs: [] }
  const local = { revision: 1, crunKeys: [{ id: "c", ownerId: "u", key: "three", credits: 30 }], songs: [] }
  const merged = mergeStates(db, local, base)
  assert.deepEqual(merged.crunKeys.map((k) => k.key).sort(), ["one", "three", "two"])
  assert.equal(merged.crunKeys.reduce((sum, k) => sum + k.credits, 0), 60)
})

test("deleting one key keeps keys added elsewhere", () => {
  const base = { crunKeys: [{ id: "a", ownerId: "u", key: "one", credits: 10 }], songs: [] }
  const local = { crunKeys: [], songs: [] }
  const db = { crunKeys: [
    { id: "a", ownerId: "u", key: "one", credits: 10 },
    { id: "b", ownerId: "u", key: "two", credits: 20 },
  ], songs: [] }
  const merged = mergeStates(db, local, base)
  assert.deepEqual(merged.crunKeys.map((k) => k.key), ["two"])
})

test("newer credit check wins for the same key", () => {
  const key = { id: "a", ownerId: "u", key: "one" }
  const db = { crunKeys: [{ ...key, credits: 10, lastCheckedAt: 1 }], songs: [] }
  const local = { crunKeys: [{ ...key, credits: 25, lastCheckedAt: 2 }], songs: [] }
  const merged = mergeStates(db, local, db)
  assert.equal(merged.crunKeys[0].credits, 25)
})

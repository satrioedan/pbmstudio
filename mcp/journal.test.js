import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createToolRegistry } from './tools.js';
test('journal survives reload and blocks retry after uncertain provider result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ulas-journal-')); let count = 0;
  const path = join(dir, 'journal.json'); const auth = { authInfo: { scopes: ['music:write'] } };
  const args = { confirmed: true, request_id: randomUUID(), model: 'suno-v5', style: 'reggae' };
  const build = api => {
    const calls = {}; createToolRegistry(api, path, 'owner').register({ registerTool(name, info, fn) { calls[name] = fn; } }); return calls;
  };
  try {
    let registry = build(async () => { count++; throw new Error('network interrupted after submitting'); });
    assert.equal((await registry.create_song(args, auth)).isError, true);
    registry = build(async () => { count++; return { song: { id: 'duplicate' } }; });
    assert.equal((await registry.create_song(args, auth)).isError, true); assert.equal(count, 1);
    const next = { ...args, request_id: randomUUID() }; const first = await registry.create_song(next, auth);
    registry = build(async () => { count++; return {}; });
    assert.deepEqual(await registry.create_song(next, auth), first); assert.equal(count, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

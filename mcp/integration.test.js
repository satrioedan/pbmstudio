import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpHandler } from './index.js';

test('OAuth + official MCP client + music tool isolation and replay protection', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ulas-mcp-test-'));
  const owner = new AsyncLocalStorage(); let writes = 0;
  const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { MCP_PUBLIC_URL: base, MCP_ALLOW_LOCAL_HTTP: 'true', MCP_OWNER_ID: 'test-owner', MCP_CLIENT_ID: 'test-client', MCP_CLIENT_SECRET: 'c'.repeat(40), MCP_LOGIN_SECRET: 'l'.repeat(40), MCP_REDIRECT_URIS: 'https://chatgpt.com/test-callback', MCP_JOURNAL_PATH: join(dir, 'journal.json') };
  const handler = createMcpHandler({ env, withOwner: (id, fn) => owner.run(id, fn), handleApi: async (req, res, url) => {
    assert.equal(owner.getStore(), 'test-owner');
    if (req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      assert.equal(JSON.parse(body).style, 'reggae'); writes++;
      await new Promise(r => setTimeout(r, 20));
    }
    res.writeHead(200);
    res.end(JSON.stringify(url.pathname === '/api/models' ? { models: [{ id: 'suno-v5', credits: 11 }] } : url.pathname === '/api/credits' ? { apiframe: 500 } : { song: { id: 'song-1', status: 'processing', providerKeyId: 'hidden', ownerId: 'private', title: 'Test' } }));
  } });
  server.on('request', (req, res) => handler.handle(req, res));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(data), redirect: 'manual' });
  await t.test('unauthenticated access rejected with discovery', async () => {
    const r = await fetch(base + '/mcp', { method: 'POST' }); assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate'), /oauth-protected-resource/);
    const meta = await (await fetch(base + '/.well-known/oauth-authorization-server')).json(); assert.ok(meta.code_challenge_methods_supported.includes('S256')); assert.equal(meta.registration_endpoint, base + '/register');
  });
  const verifier = randomBytes(32).toString('base64url');
  const params = { client_id: env.MCP_CLIENT_ID, response_type: 'code', redirect_uri: env.MCP_REDIRECT_URIS, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'music:read music:write', resource: base + '/mcp', state: 'state-test' };
  await t.test('only ChatGPT callbacks can register', async () => {
    const bad = await fetch(base + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://attacker.example/cb'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }) });
    assert.equal(bad.status, 400);
    const ok = await fetch(base + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/connector/oauth/callback123'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'ChatGPT' }) });
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).token_endpoint_auth_method, 'none');
  });
  await t.test('unregistered callback rejected', async () => {
    const r = await fetch(base + '/authorize?' + new URLSearchParams({ ...params, redirect_uri: 'https://attacker.example/cb' }), { redirect: 'manual' }); assert.equal(r.status, 400);
  });
  const auth = await fetch(base + '/authorize?' + new URLSearchParams(params));
  assert.equal(auth.status, 200); const cookie = auth.headers.get('set-cookie').split(';')[0];
  const flow = (await auth.text()).match(/name="flow" value="([^"]+)"/)[1];
  await t.test('login requires CSRF cookie and owner secret', async () => {
    assert.equal((await post('/mcp-login', { flow, secret: env.MCP_LOGIN_SECRET })).status, 403);
    assert.equal((await post('/mcp-login', { flow, secret: 'wrong' }, { Cookie: cookie })).status, 403);
  });
  const consent = await post('/mcp-login', { flow, secret: env.MCP_LOGIN_SECRET }, { Cookie: cookie }); assert.equal(consent.status, 303);
  const cb = new URL(consent.headers.get('location')); assert.equal(cb.searchParams.get('state'), 'state-test');
  const grant = { grant_type: 'authorization_code', client_id: env.MCP_CLIENT_ID, client_secret: env.MCP_CLIENT_SECRET, code: cb.searchParams.get('code'), code_verifier: verifier, redirect_uri: env.MCP_REDIRECT_URIS, resource: base + '/mcp' };
  await t.test('PKCE and resource binding enforced', async () => {
    assert.equal((await post('/token', { ...grant, code_verifier: 'bad' })).status, 400);
    assert.equal((await post('/token', { ...grant, resource: 'https://wrong.example/mcp' })).status, 400);
  });
  const tokens = await (await post('/token', grant)).json(); assert.ok(tokens.access_token);
  await t.test('authorization code cannot be reused', async () => assert.equal((await post('/token', grant)).status, 400));
  const client = new Client({ name: 'ulas-integration-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + tokens.access_token } } }));
  t.after(() => client.close());
  await t.test('tools list and read tool through SDK client', async () => {
    const { tools } = await client.listTools(); assert.equal(tools.length, 10); assert.ok(!tools.some(t => /key|delete/.test(t.name)));
    const r = await client.callTool({ name: 'list_models', arguments: {} }); assert.equal(JSON.parse(r.content[0].text).models[0].id, 'suno-v5');
  });
  const args = { confirmed: true, request_id: randomUUID(), model: 'suno-v5', style: 'reggae' };
  await t.test('parallel retry executes once and removes private fields', async () => {
    const [a, b] = await Promise.all([client.callTool({ name: 'create_song', arguments: args }), client.callTool({ name: 'create_song', arguments: args })]);
    assert.equal(writes, 1); assert.deepEqual(a, b); assert.doesNotMatch(a.content[0].text, /hidden|private|providerKeyId/);
  });
  await t.test('changed request and missing consent rejected', async () => {
    assert.equal((await client.callTool({ name: 'create_song', arguments: { ...args, style: 'pop' } })).isError, true);
    assert.equal((await client.callTool({ name: 'create_song', arguments: { ...args, confirmed: false } })).isError, true);
    assert.equal(writes, 1);
  });
  await t.test('Origin rejection', async () => {
    assert.equal((await fetch(base + '/mcp', { headers: { Authorization: 'Bearer ' + tokens.access_token, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(base + '/mcp', { method: 'OPTIONS', headers: { Origin: 'https://chat.openai.com', 'Access-Control-Request-Method': 'POST' } })).status, 204);
    assert.equal((await fetch(base + '/mcp-login', { method: 'POST', headers: { Origin: 'https://chatgpt.com', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'secret=x' })).status, 403);
  });
  await t.test('refresh rotates and scope cannot escalate', async () => {
    const refreshGrant = { grant_type: 'refresh_token', client_id: env.MCP_CLIENT_ID, client_secret: env.MCP_CLIENT_SECRET, refresh_token: tokens.refresh_token, resource: base + '/mcp' };
    assert.equal((await post('/token', { ...refreshGrant, scope: 'admin' })).status, 400);
    const next = await (await post('/token', { ...refreshGrant, scope: 'music:read' })).json(); assert.ok(next.access_token);
    assert.equal((await post('/token', refreshGrant)).status, 400);
    const readClient = new Client({ name: 'read-test', version: '1' });
    await readClient.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + next.access_token } } }));
    assert.equal((await readClient.callTool({ name: 'create_song', arguments: { ...args, request_id: randomUUID() } })).isError, true); await readClient.close();
    await post('/revoke', { client_id: env.MCP_CLIENT_ID, client_secret: env.MCP_CLIENT_SECRET, token: next.refresh_token });
    assert.equal((await fetch(base + '/mcp', { headers: { Authorization: 'Bearer ' + tokens.access_token } })).status, 401);
  });
});

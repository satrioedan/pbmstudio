import { publicBackendError } from './public-error-20260911.js';
import express from 'express';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createAuth } from './auth.js';
import { createToolRegistry } from './tools.js';

export function createMcpHandler({ handleApi, withOwner, env = process.env }) {
  const origin = new URL(env.MCP_PUBLIC_URL || 'https://lagu.bangalimin.com');
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('MCP_PUBLIC_URL must be a bare origin; use a domain root.');
  const local = env.MCP_ALLOW_LOCAL_HTTP === 'true' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !local) throw new Error('MCP_PUBLIC_URL requires HTTPS.');
  if (env.BASE_PATH && env.BASE_PATH !== '/') throw new Error('MCP integration currently requires BASE_PATH empty.');
  // cPanel/Passenger canonicalizes extensionless paths with a trailing slash.
  const config = { resource: origin.origin + '/mcp', secure: origin.protocol === 'https:',
    clientId: env.MCP_CLIENT_ID || 'gejemuzik-chatgpt', clientSecret: env.MCP_CLIENT_SECRET || '',
    loginSecret: env.MCP_LOGIN_SECRET || '', autoApprove: env.MCP_AUTO_APPROVE === 'true',
    redirects: String(env.MCP_REDIRECT_URIS || '').split(',').map(s => s.trim()).filter(Boolean) };
  if (config.clientSecret.length < 32 || config.loginSecret.length < 32 || config.clientSecret === config.loginSecret) throw new Error('Set distinct MCP_CLIENT_SECRET and MCP_LOGIN_SECRET, at least 32 random characters each.');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(env.MCP_OWNER_ID || '')) throw new Error('Set valid MCP_OWNER_ID from the browser account.');
  if (!config.redirects.length) throw new Error('Set MCP_REDIRECT_URIS to the exact ChatGPT callback URL.');
  for (const s of config.redirects) { const u = new URL(s); if (u.protocol !== 'https:' || u.hash || u.username || u.password) throw new Error('OAuth redirects must be exact HTTPS URLs without fragments/credentials.'); }
  async function api(method, path, body) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]); req.method = method; req.headers = {};
    let status = 200, data;
    const res = { writeHead(code) { status = code; }, setHeader() {}, end(value) { data = JSON.parse(String(value || '{}')); } };
    await withOwner(env.MCP_OWNER_ID, () => handleApi(req, res, new URL(path, origin)));
    if (status >= 400) { const e = new Error('Backend rejected request'); e.publicMessage = publicBackendError(status, data); throw e; }
    return data;
  }
  const journalPath = env.MCP_JOURNAL_PATH || (env.VERCEL ? 'neon' : fileURLToPath(new URL('../.mcp-journal.json', import.meta.url)));
  const registry = createToolRegistry(api, journalPath, env.MCP_OWNER_ID);
  const app = express(); app.disable('x-powered-by');
  // Vercel is the only trusted proxy hop, so rate limits see the client address.
  const { provider, login } = createAuth(config);
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self' https://chatgpt.com https://chat.openai.com; frame-ancestors 'none'; base-uri 'none'");
    const requestOrigin = req.headers.origin;
    const chatOrigins = ['https://chatgpt.com', 'https://chat.openai.com', 'https://platform.openai.com'];
    const crossSite = requestOrigin && requestOrigin !== 'null' && requestOrigin !== origin.origin;
    if (crossSite && (!chatOrigins.includes(requestOrigin) || req.path === '/mcp-login')) return res.status(403).json({ error: 'Origin rejected' });
    if (crossSite && (req.path === '/mcp' || req.path === '/mcp/')) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID');
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Session-Id');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });
  app.post('/mcp-login', express.urlencoded({ extended: false, limit: '4kb' }), login);
  app.set('trust proxy', 1);
  app.use(mcpAuthRouter({
    provider, issuerUrl: origin, resourceServerUrl: new URL(config.resource),
    scopesSupported: ['music:read', 'music:write'], resourceName: 'GEJEMUZIK',
    clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
  }));
  const auth = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(config.resource)) });
  app.post(['/mcp', '/mcp/'], auth, express.json({ limit: '64kb' }), async (req, res) => {
    const server = new McpServer({ name: 'gejemuzik', version: '1.0.0' }, { instructions: 'Gunakan bahasa Indonesia. Baca model dan estimasi kredit sebelum tindakan berbayar. get_credits membaca saldo live crun.ai browser terpasang. Minta persetujuan, lalu pakai UUID request_id unik. Hasil processing bukan kegagalan: simpan song.id dan cek get_job_status. Jangan otomatis mengulang operasi berbayar dengan ID baru. Koleksi terikat ke satu pemilik yang dipasang administrator.' });
    registry.register(server);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: 'Internal MCP error' } }); }
  });
  app.all(['/mcp', '/mcp/'], auth, (req, res) => { res.setHeader('Allow', 'POST'); res.status(405).end(); });
  app.use((err, req, res, next) => { if (!res.headersSent) res.status(err.status === 413 ? 413 : 400).json({ error: 'Invalid request' }); });
  const paths = new Set(['/mcp', '/mcp/', '/mcp-login', '/authorize', '/token', '/revoke', '/register', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']);
  return { matches: path => paths.has(path), handle: app };
}

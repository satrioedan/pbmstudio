import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { InvalidGrantError, InvalidTokenError, InvalidScopeError, InvalidTargetError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { createGrantStore } from './grants.js';
const random = () => randomBytes(32).toString('base64url');
const digest = s => createHash('sha256').update(String(s)).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));

// Single owner, pre-registered OAuth client. No public registration endpoint.
export function createAuth(config) {
  const grants = createGrantStore();
  const scopes = ['music:read', 'music:write'];
  const kinds = ['pending', 'code', 'access', 'refresh'];
  async function guardCapacity() {
    for (const kind of kinds) if (await grants.count(kind) >= 2000) throw new Error('Authentication capacity reached');
  }
  async function read(kind, id) {
    const row = await grants.get(kind, id);
    return row && row.expires > Date.now() ? row : null;
  }
  const resourceCheck = resource => {
    const canonical = config.resource.endsWith('/') ? config.resource : config.resource + '/';
    const allowed = new Set([canonical, canonical.slice(0, -1)]);
    if (resource && !allowed.has(resource.href)) throw new InvalidTargetError('Invalid resource');
  };
  const client = {
    client_id: config.clientId, client_secret: config.clientSecret,
    redirect_uris: config.redirects, token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    scope: scopes.join(' '), client_name: 'GEJEMUZIK ChatGPT',
  };
  async function issue(grant) {
    await guardCapacity();
    const token = random(), renewal = random(), family = grant.family || random();
    const accessGrant = { ...grant, family, expires: Date.now() + 3600_000 };
    const refreshGrant = { ...grant, family, expires: Date.now() + 7 * 86400_000 };
    await grants.put('access', token, accessGrant, accessGrant.expires, family);
    await grants.put('refresh', renewal, refreshGrant, refreshGrant.expires, family);
    return { access_token: token, token_type: 'Bearer', expires_in: 3600,
      refresh_token: renewal, scope: grant.scopes.join(' ') };
  }
  const provider = {
    clientsStore: { getClient: id => id === client.client_id ? client : undefined },
    async authorize(c, params, res) {
      await guardCapacity(); resourceCheck(params.resource);
      const requested = params.scopes?.length ? params.scopes : scopes;
      if (requested.some(s => !scopes.includes(s))) throw new InvalidScopeError('Unsupported scope');
      if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidGrantError('Invalid PKCE challenge');
      if (config.autoApprove) {
        const code = random();
        const grant = { ...params, scopes: requested, clientId: c.client_id, expires: Date.now() + 60_000 };
        await grants.put('code', code, grant, grant.expires);
        const redirect = new URL(params.redirectUri);
        redirect.searchParams.set('code', code);
        if (params.state !== undefined) redirect.searchParams.set('state', params.state);
        return res.redirect(303, redirect.href);
      }
      const flow = random(), csrf = random();
      const pendingGrant = { ...params, scopes: requested, csrf, clientId: c.client_id, expires: Date.now() + 300_000 };
      await grants.put('pending', flow, pendingGrant, pendingGrant.expires);
      res.cookie('gjm_mcp_flow', csrf, { httpOnly: true, secure: config.secure, sameSite: 'lax', path: '/mcp-login', maxAge: 300_000 });
      res.type('html').send(`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Hubungkan GEJEMUZIK</title><body><main><h1>Hubungkan GEJEMUZIK ke ChatGPT</h1><p>Izinkan akses koleksi musik${requested.includes('music:write') ? ' dan pembuatan musik yang dapat memakai kredit provider' : ''}.</p><form method="post" action="/mcp-login"><input type="hidden" name="flow" value="${flow}"><label>Kode akses pemilik <input type="password" name="secret" required autocomplete="current-password" maxlength="256"></label><button type="submit">Izinkan koneksi</button></form><p>Tutup halaman ini untuk membatalkan.</p></main></body></html>`);
    },
    async challengeForAuthorizationCode(c, code) {
      const g = await read('code', code);
      if (!g || g.clientId !== c.client_id) throw new InvalidGrantError('Invalid code');
      return g.codeChallenge;
    },
    async exchangeAuthorizationCode(c, code, verifier, redirect, resource) {
      resourceCheck(resource);
      const g = await read('code', code);
      if (!g || g.clientId !== c.client_id || redirect !== g.redirectUri) throw new InvalidGrantError('Invalid code or redirect');
      await grants.remove('code', code);
      return issue({ clientId: c.client_id, scopes: g.scopes });
    },
    async exchangeRefreshToken(c, token, requested, resource) {
      resourceCheck(resource);
      const g = await read('refresh', token);
      if (!g || g.clientId !== c.client_id) throw new InvalidGrantError('Invalid refresh token');
      if (requested?.some(s => !g.scopes.includes(s))) throw new InvalidScopeError('Scope escalation denied');
      await grants.remove('refresh', token);
      return issue({ ...g, scopes: requested || g.scopes });
    },
    async verifyAccessToken(token) {
      const g = await read('access', token);
      if (!g) throw new InvalidTokenError('Expired or invalid access token');
      return { token, clientId: g.clientId, scopes: g.scopes, expiresAt: Math.floor(g.expires / 1000), resource: new URL(config.resource) };
    },
    async revokeToken(c, request) {
      const g = await read('access', request.token) || await read('refresh', request.token);
      if (!g || g.clientId !== c.client_id || !g.family) return;
      await grants.removeFamily(g.family);
    },
  };
  let failed = 0, windowStart = Date.now();
  async function login(req, res) {
    if (Date.now() - windowStart > 900_000) { failed = 0; windowStart = Date.now(); }
    if (failed >= 10) return res.status(429).send('Terlalu banyak percobaan. Coba lagi 15 menit.');
    const g = await read('pending', req.body.flow);
    const cookie = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('gjm_mcp_flow='))?.slice(13);
    if (!g || !equal(cookie || '', g.csrf) || !equal(req.body.secret || '', config.loginSecret)) {
      failed++; return res.status(403).send('Koneksi ditolak. Mulai ulang koneksi dan periksa kode akses.');
    }
    await grants.remove('pending', req.body.flow);
    const code = random();
    const codeGrant = { ...g, expires: Date.now() + 60_000 };
    await grants.put('code', code, codeGrant, codeGrant.expires);
    const redirect = new URL(g.redirectUri); redirect.searchParams.set('code', code);
    if (g.state !== undefined) redirect.searchParams.set('state', g.state);
    res.clearCookie('gjm_mcp_flow', { path: '/mcp-login', secure: config.secure, httpOnly: true, sameSite: 'lax' });
    res.redirect(303, redirect.href);
  }
  return { provider, login };
}

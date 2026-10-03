import { z } from 'zod';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
const text = max => z.string().trim().max(max);
const id = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);
const paid = { confirmed: z.literal(true).describe('True only after user approves this operation and its provider credit cost.'), request_id: z.string().uuid().describe('Unique UUID for this operation. Reuse on transport retries; do not automatically use a new UUID after an uncertain result.') };
const output = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !/key|token|secret|owner|providerJobId/i.test(k))
    .map(([k, v]) => [k, /error/i.test(k) && v ? 'Operasi provider gagal. Periksa rincian di situs.' : sanitize(v)]));
  return value;
}
export function createToolRegistry(api, journalPath, ownerId) {
  const journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, 'utf8')) : {};
  const save = () => { writeFileSync(journalPath + '.tmp', JSON.stringify(journal), { mode: 0o600 }); renameSync(journalPath + '.tmp', journalPath); };
  let queue = Promise.resolve();
  const serial = task => { const p = queue.then(task); queue = p.catch(() => {}); return p; };
  const defs = [];
  function add(name, description, shape, run, write = false) {
    defs.push({ name, description, shape, run, write });
  }
  async function song(songId) { return (await api('GET', `/api/songs/${encodeURIComponent(songId)}`)).song; }
  const songPath = (a, suffix = '') => `/api/songs/${encodeURIComponent(a.song_id)}${suffix}`;
  add('list_models', 'Daftar model dan perkiraan kredit dari katalog situs. Harga aktual mengikuti provider.', {}, () => api('GET', '/api/models'));
  add('get_credits', 'Saldo virtual situs untuk pemilik terpasang; bukan verifikasi saldo live KIE/MusicAPI.', {}, () => api('GET', '/api/credits'));
  add('list_tracks', 'Daftar koleksi musik pemilik, maksimal 100 lagu per halaman.', { liked: z.boolean().optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20) }, async a => {
    const { songs } = await api('GET', `/api/songs?liked=${a.liked === true}`);
    return { songs: songs.slice(a.offset, a.offset + a.limit), total: songs.length, next_offset: a.offset + a.limit < songs.length ? a.offset + a.limit : null };
  });
  add('get_job_status', 'Cek status lagu/stem/WAV sekali, termasuk URL hasil. Jika processing, periksa lagi kemudian; jangan mengirim ulang generate.', { song_id: id }, a => api('GET', songPath(a)));
  add('generate_lyrics', 'Buat lirik memakai Gemini situs; dapat memakai kuota/biaya API. Minta persetujuan dahulu.', { ...paid, theme: text(500).min(1), language: text(60).default('Indonesia'), genre: text(120).optional(), mood: text(120).optional(), structure: text(200).optional(), extra: text(500).optional(), model: text(60).optional() }, a => api('POST', '/api/lyrics/generate', a), true);
  add('create_song', 'Buat lagu AI. Baca list_models, jelaskan model dan estimasi kredit, minta persetujuan. Hasil awal berisi song.id untuk get_job_status.', { ...paid, model: text(60).min(1), style: text(1000).min(1), title: text(80).optional(), lyrics: text(5000).optional(), type: z.enum(['vocal', 'instrumental']).default('vocal'), vocalGender: z.enum(['male', 'female', 'auto']).default('auto') }, a => api('POST', '/api/songs', a), true);
  add('remix_audio', 'Aransemen ulang lagu APIframe selesai, estimasi 11 kredit virtual APIframe. Provider lain tidak didukung endpoint ini.', { ...paid, song_id: id, style: text(1000).min(1), prompt: text(5000).optional(), title: text(80).optional(), index: z.union([z.literal(1), z.literal(2)]).default(1), negativeTags: text(500).optional(), audioWeight: z.number().min(0).max(1).optional() }, async a => {
    const s = await song(a.song_id); if (s.provider !== 'apiframe') throw new Error('Aransemen melalui MCP ini hanya mendukung lagu APIframe.');
    return api('POST', songPath(a, '/cover'), a);
  }, true);
  add('separate_stems', 'Pisah vokal/instrumen lagu APIframe atau Upload & Cover selesai, estimasi 11 kredit. Multi-stem hanya untuk Upload & Cover.', { ...paid, song_id: id, type: z.enum(['separate_vocal', 'split_stem']).default('separate_vocal'), trackId: id.optional() }, async a => {
    const s = await song(a.song_id); if (!['apiframe', 'uploadcover'].includes(s.provider) || (a.type === 'split_stem' && s.provider !== 'uploadcover')) throw new Error('Jenis pemisahan/provider lagu tidak didukung.');
    if (a.trackId && !(s.tracks || []).some(t => t.id === a.trackId)) throw new Error('Track bukan bagian lagu ini.');
    return api('POST', songPath(a, '/stems'), a);
  }, true);
  add('convert_to_wav', 'Konversi lagu Upload & Cover sunoapi.org selesai ke WAV, estimasi 6 kredit virtual; bukan konversi umum semua provider.', { ...paid, song_id: id, trackId: id.optional() }, async a => {
    const s = await song(a.song_id); if (s.provider !== 'uploadcover') throw new Error('WAV hanya mendukung lagu Upload & Cover.');
    if (a.trackId && !(s.tracks || []).some(t => t.id === a.trackId)) throw new Error('Track bukan bagian lagu ini.');
    return api('POST', songPath(a, '/wav'), a);
  }, true);
  add('set_track_liked', 'Atur favorit lagu ke nilai yang diminta.', { ...paid, song_id: id, liked: z.boolean() }, async a => {
    const s = await song(a.song_id); return s.liked === a.liked ? { song: s } : api('PATCH', songPath(a, '/like'), {});
  }, true);
  function register(server) {
    for (const d of defs) server.registerTool(d.name, {
      description: d.description, inputSchema: z.object(d.shape).strict(),
      annotations: { readOnlyHint: !d.write, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [d.write ? 'music:write' : 'music:read'] }] },
    }, async (args, extra) => {
      if (!extra.authInfo?.scopes?.includes(d.write ? 'music:write' : 'music:read')) return { ...output({ error: 'Scope tidak mencukupi.' }), isError: true };
      const execute = async () => {
        if (!d.write) return output(sanitize(await d.run(args)));
        const { request_id, confirmed, ...body } = args;
        const hash = createHash('sha256').update(JSON.stringify([ownerId, d.name, body])).digest('hex');
        const previous = Object.hasOwn(journal, request_id) ? journal[request_id] : null;
        if (previous) {
          if (previous.hash !== hash) throw new Error('request_id sudah digunakan untuk operasi berbeda.');
          if (previous.result) return previous.result;
          throw new Error('Hasil operasi sebelumnya belum pasti. Periksa koleksi/status di situs sebelum mencoba operasi baru.');
        }
        if (Object.keys(journal).length >= 10000) throw new Error('Jurnal operasi penuh. Administrator perlu mengarsipkan jurnal setelah memeriksa operasi tertunda.');
        journal[request_id] = { hash, status: 'pending', at: Date.now() }; save();
        // Persist before side effects. A crash/timeout stays pending, never automatically retried.
        const result = output(sanitize(await d.run(body)));
        journal[request_id] = { hash, status: 'done', at: Date.now(), result }; save(); return result;
      };
      try { return await (d.write ? serial(execute) : execute()); }
      catch (e) { return { ...output({ error: e.publicMessage || (/^(Aransemen|Jenis pemisahan|WAV hanya|Track bukan|request_id|Hasil operasi|Jurnal operasi)/.test(e.message) ? e.message : 'Operasi gagal atau hasil belum pasti. Periksa situs sebelum mengulang tindakan berbayar.') }), isError: true }; }
    });
  }
  return { register };
}

#!/usr/bin/env node
// Local stand-in for Supabase Auth and the /api/v1 routes the app uses, so every signed-in screen can be
// previewed in the simulator without an account. Development only: `node dev/mock-server.mjs` (port 8799).
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.MOCK_PORT || 8799);
const state = {
    balance: 240, free: 10,
    threads: [{ id: randomUUID(), model_id: 'claude-sonnet', title: 'Launch plan for the spring drop', pinned: false, updated_at: new Date().toISOString() }],
    messages: new Map(),
    personas: [{ id: randomUUID(), name: 'Editor', instructions: 'Be concise. Tighten every sentence and keep the brand voice.', model_id: 'claude-sonnet', thinking: false, web: false }],
    folders: [{ id: randomUUID(), name: 'Launch' }],
    jobs: [],
    socialPlan: 'publish',
    socialPosts: [
        { id: 'post-1', key: 'seed-1', status: 'scheduled', scheduled_at: '2026-10-20T09:00:00Z', global_text: 'Spring launch teaser: the product turns in soft light.', created_at: '2026-10-18T10:00:00Z', updated_at: '2026-10-18T10:00:00Z', targets: [{ id: 't1', network: 'instagram', publish_status: 'pending', platform_post_url: null, last_error: null }] },
        { id: 'post-2', key: 'seed-2', status: 'failed', scheduled_at: '2026-10-17T09:00:00Z', global_text: 'Behind the scenes cut.', created_at: '2026-10-17T08:00:00Z', updated_at: '2026-10-17T09:05:00Z', targets: [{ id: 't2', network: 'tiktok', publish_status: 'failed', platform_post_url: null, last_error: 'The account access token expired. <b>Reconnect</b> the account.' }, { id: 't3', network: 'instagram', publish_status: 'published', platform_post_url: 'https://www.instagram.com/p/mock/', last_error: null }] },
    ],
    deleted: new Set(),
    referral: { code: 'K7M2PQ9XWD', referred: 2, attached: false },
};
state.messages.set(state.threads[0].id, [
    { id: randomUUID(), role: 'user', content: 'Give me three angles for a spring launch video.' },
    { id: randomUUID(), role: 'assistant', content: '1. A 10-second reveal with the product turning in soft light.\n2. A before/after split screen.\n3. A fast montage of customers unboxing it.', credits: 1 },
]);

const FILM_ID = '11111111-1111-4111-8111-111111111111';
const CINEMA = Array.from({ length: 30 }, (_, i) => {
    const series = i % 5 === 4;
    const id = i === 0 ? FILM_ID : randomUUID();
    return {
        id, content_type: series ? 'SERIES' : i % 2 ? 'SHORT' : 'FILM', title: `${series ? 'The Long Night' : 'Short drama'} ${i + 1}`,
        synopsis: 'A twist at every turn. Nothing is what it seems when the lights go out.', language: 'en', ai_disclosures: [], categories: [],
        published_at: new Date(Date.now() - i * 3600e3).toISOString(), username: 'studio', display_name: 'Mock Studio',
        episode_count: series ? 3 : 0, duration_seconds: series ? null : 94,
    };
});
const episodes = (id) => [1, 2, 3].map((n) => ({ id: randomUUID(), position: n, title: `Episode ${n}`, synopsis: '', duration_seconds: 60, access: n < 3 ? 'free' : 'locked', credits: n < 3 ? 0 : 5 }));
// MOCK_PLAY_TTL shortens the token lifetime so renewal can be watched (the app renews 3 minutes early; use 200+).
const PLAY_TTL = Number(process.env.MOCK_PLAY_TTL || 900);
const plays = new Map();

// A real 8 second video for the quick-edit length probe, made once with ffmpeg when it is installed.
const CLIP_LENGTH_S = 8;
let clipFile = null;
function ensureClip() {
    if (clipFile) return clipFile;
    const out = join(tmpdir(), 'veyrnox-mock-clip.mp4');
    if (!existsSync(out)) {
        const r = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc=size=320x568:rate=24:duration=${CLIP_LENGTH_S}`, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'ignore' });
        if (r.status !== 0) return null;
    }
    clipFile = out;
    return out;
}

const CATALOG = [
    { id: 'nano-banana', name: 'Nano Banana', modality: 'text-to-image', credits: 4, gated: false, durations: [5], capabilities: { inputs: { prompt: { type: 'string' } }, media: {} } },
    { id: 'seedream-4', name: 'Seedream 4', modality: 'text-to-image', credits: 3, gated: false, durations: [5], capabilities: { inputs: { prompt: { type: 'string' } }, media: {} } },
    { id: 'veo-fast', name: 'Veo 3.1 Fast', modality: 'text-to-video', credits: 12, gated: false, durations: [5, 10], capabilities: { inputs: { prompt: { type: 'string' } }, media: {} } },
    { id: 'kling-3', name: 'Kling 3', modality: 'text-to-video', credits: 9, gated: false, durations: [5, 10], capabilities: { inputs: { prompt: { type: 'string' } }, media: {} } },
    { id: 'sfx-v2', name: 'ElevenLabs Sound Effects', modality: 'text-to-audio', credits: 2, gated: false, durations: [5], capabilities: { inputs: { prompt: { type: 'string' } }, media: {} } },
];
const CHAT_MODELS = [
    { id: 'claude-sonnet', name: 'Claude Sonnet', maker: 'claude', maker_label: 'Claude', credits_per_reply: 1, gated: false },
    { id: 'gpt-luna', name: 'GPT Luna', maker: 'chatgpt', maker_label: 'ChatGPT', credits_per_reply: 1, gated: false },
    { id: 'gemini-flash', name: 'Gemini Flash', maker: 'gemini', maker_label: 'Gemini', credits_per_reply: 1, gated: false },
];

// A 256x256 gradient PNG, so image results have something to show.
function png() {
    const w = 256, h = 256, raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        for (let x = 0; x < w; x++) {
            const o = y * (w * 3 + 1) + 1 + x * 3;
            raw[o] = 62 + (x >> 2); raw[o + 1] = 230 - (y >> 2); raw[o + 2] = 196 - (x >> 3);
        }
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = png();

// A JWT-shaped token (unsigned) with a subject, so the app has an account id for the AI-sharing consent record.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mockJwt = () => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: '00000000-0000-4000-8000-000000000001', exp: Math.floor(Date.now() / 1000) + 3600 })}.mock`;
const tokens = () => ({ access_token: mockJwt(), refresh_token: 'mock-refresh', expires_in: 3600, token_type: 'bearer' });
const jobState = (j) => { const age = Date.now() - j.created; return age < 2500 ? 'queued' : age < 6000 ? 'running' : 'succeeded'; };
const jobView = (j) => ({ job_id: j.id, state: jobState(j), credits: j.credits, model_id: j.model_id, created_at: new Date(j.created).toISOString(), label: j.label, has_asset: jobState(j) === 'succeeded' });

const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
    let m;
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;
    const body = req.method === 'POST' || req.method === 'PATCH' ? await readBody(req) : {};
    console.log(req.method, path);

    if (path.startsWith('/auth/v1/token') || path === '/auth/v1/signup') return send(res, 200, tokens());
    if (path === '/auth/v1/logout') { res.writeHead(204); return res.end(); }
    if (path === '/clip.mp4') {
        const file = ensureClip();
        if (!file) { res.writeHead(404); return res.end(); }
        const buf = readFileSync(file);
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
        if (range) {
            const from = range[1] ? Number(range[1]) : 0;
            const to = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
            res.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${from}-${to}/${buf.length}`, 'content-length': to - from + 1 });
            return res.end(buf.subarray(from, to + 1));
        }
        res.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': buf.length });
        return res.end(buf);
    }
    if (path === '/asset.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
    if (path === '/api/cinema/titles') {
        const limit = Number(url.searchParams.get('limit') || 24), beforeId = url.searchParams.get('before_id');
        const start = beforeId ? CINEMA.findIndex((t) => t.id === beforeId) + 1 : 0;
        const titles = CINEMA.slice(start, start + limit), last = titles[titles.length - 1];
        const more = start + limit < CINEMA.length;
        return send(res, 200, { titles, categories: [], next: more ? last.published_at : null, next_id: more ? last.id : null });
    }
    if ((m = path.match(/^\/api\/cinema\/posters\/([^/]+)$/))) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
    if (path === '/api/catalog') return send(res, 200, { models: CATALOG });
    // Publish brands (ADR-0135): the person's own, a client brand they edit, and one they can only view.
    const BRAND_CLIENT = '22222222-2222-4222-8222-222222222222';
    const BRAND_VIEW = '33333333-3333-4333-8333-333333333333';
    const brandHeader = String(req.headers['x-publish-brand-id'] || '');
    if (path === '/api/v1/social/brands' && req.method === 'GET') {
        return send(res, 200, { brands: [
            { id: '11111111-1111-4111-8111-111111111111', label: 'Veyrnox Studio', timezone: 'Europe/London', role: 'owner', paid: true },
            { id: BRAND_CLIENT, label: 'Acme Client', timezone: 'America/New_York', role: 'editor', paid: true },
            { id: BRAND_VIEW, label: 'Agency (view only)', timezone: 'UTC', role: 'viewer', paid: false },
        ] });
    }
    // Approvals: each reviewer carries a signed link, as the real route adds; the app must not show it.
    if (path === '/api/v1/social/approvals' && req.method === 'GET') {
        if (brandHeader === BRAND_VIEW) return send(res, 403, { error: 'brand_role_forbidden', role: 'viewer' });
        const link = 'https://mock.example/social/review/MOCK-SIGNED-LINK';
        return send(res, 200, { brand_id: brandHeader || 'b1', requests: brandHeader === BRAND_CLIENT ? [] : [
            { id: 'ap-1', post_id: 'p-1', policy: 'any', status: 'pending', scheduled_at: '2026-10-22T09:00:00Z', global_text: 'Spring drop is live: three new looks, free shipping this week.', created_at: '2026-10-18T10:00:00Z', reviewers: [
                { id: 'rv-1', email: 'sam@acme.example', decision: 'pending', comment: null, decided_at: null, url: link },
                { id: 'rv-2', email: 'lee@acme.example', decision: 'commented', comment: 'Can we soften the second line?', decided_at: '2026-10-18T12:30:00Z', url: link } ] },
            { id: 'ap-2', post_id: 'p-2', policy: 'any', status: 'approved', scheduled_at: null, global_text: 'Behind the scenes at the studio.', created_at: '2026-10-15T10:00:00Z', reviewers: [
                { id: 'rv-3', email: 'sam@acme.example', decision: 'approved', comment: 'Great.', decided_at: '2026-10-15T11:00:00Z', url: link } ] },
            { id: 'ap-3', post_id: 'p-3', policy: 'any', status: 'rejected', scheduled_at: null, global_text: 'Flash sale, 50% off everything.', created_at: '2026-10-12T10:00:00Z', reviewers: [
                { id: 'rv-4', email: 'lee@acme.example', decision: 'rejected', comment: 'Not approved by legal.', decided_at: '2026-10-12T15:00:00Z', url: link } ] },
        ] });
    }
    if (path === '/api/v1/social/accounts' && brandHeader === BRAND_CLIENT) {
        return send(res, 200, { brand_id: BRAND_CLIENT, accountLimit: 5, planTier: 'publish', accounts: [
            { id: 'acc-c1', network: 'linkedin', display_name: 'Acme Corp Page', avatar_url: null, status: 'active', connected_at: '2026-10-02T10:00:00Z', token_expires_at: '2026-12-02T10:00:00Z', publishingEnabled: true, supportedMedia: ['image'] } ] });
    }
    if (path === '/api/v1/social/accounts') return send(res, 200, { brand_id: 'b1', accountLimit: 5, planTier: 'publish', accounts: [
        { id: 'acc-1', network: 'instagram', display_name: 'Veyrnox Studio', avatar_url: null, status: 'active', connected_at: '2026-10-01T10:00:00Z', token_expires_at: '2026-12-01T10:00:00Z', publishingEnabled: true, supportedMedia: ['image', 'video'] },
        { id: 'acc-2', network: 'tiktok', display_name: 'veyrnox.ai', avatar_url: null, status: 'expired', connected_at: '2026-09-01T10:00:00Z', token_expires_at: '2026-10-01T10:00:00Z', publishingEnabled: true, supportedMedia: ['image', 'video'] } ] });
    // Publish posts (stateful): create, reschedule, cancel and restore, with the version stamp the real routes require.
    if (path === '/api/v1/social/posts' && req.method === 'POST') {
        const at = body.publishNow === true ? new Date().toISOString() : body.scheduledAt;
        if (!at || Number.isNaN(Date.parse(at))) return send(res, 400, { error: 'invalid_schedule' });
        if (body.publishNow !== true && body.scheduledAt && state.socialPlan !== 'publish') return send(res, 402, { error: 'publish_plan_required', feature: 'scheduling' });
        if (!Array.isArray(body.accountIds) || body.accountIds.length === 0) return send(res, 400, { error: 'invalid_account_ids' });
        if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.idempotencyKey)) return send(res, 400, { error: 'invalid_idempotency_key' });
        const prior = state.socialPosts.find((x) => x.key === body.idempotencyKey);
        if (prior) return send(res, 201, { post_id: prior.id, idempotent: true, target_count: prior.targets.length });
        const id = randomUUID();
        const now = new Date().toISOString();
        state.socialPosts.unshift({ id, key: body.idempotencyKey, status: body.publishNow === true ? 'published' : 'scheduled', scheduled_at: at, global_text: body.globalText || '', created_at: now, updated_at: now,
            targets: body.accountIds.map((a, i) => ({ id: randomUUID(), network: a === 'acc-2' ? 'tiktok' : 'instagram', publish_status: body.publishNow === true ? 'published' : 'pending', platform_post_url: null, last_error: null })) });
        console.log('MOCK created post', id, body.publishNow === true ? 'now' : 'scheduled');
        return send(res, 201, { post_id: id, idempotent: false, target_count: body.accountIds.length });
    }
    // Drafts (ADR-0139): two in one batch and one alone; read-only here.
    if (path === '/api/v1/social/drafts' && req.method === 'GET') {
        const B = '44444444-4444-4444-8444-444444444444';
        return send(res, 200, { brand_id: 'b1', approvalEnabled: true, drafts: [
            { id: 'dr-1', draft_batch_id: B, scheduled_at: '2026-10-23T09:00:00Z', global_text: 'Monday motivation: the studio is open and the kettle is on.', created_at: '2026-10-18T09:00:00Z', media: [{ media_type: 'image', job_id: 'j1' }], networks: ['instagram', 'linkedin'] },
            { id: 'dr-2', draft_batch_id: B, scheduled_at: '2026-10-24T12:00:00Z', global_text: 'Three tips for softer product light.', created_at: '2026-10-18T09:00:01Z', media: [], networks: ['linkedin'] },
            { id: 'dr-3', draft_batch_id: null, scheduled_at: null, global_text: 'Draft with no batch or time yet.', created_at: '2026-10-17T09:00:00Z', media: [{ media_type: 'video', job_id: 'j2' }], networks: [] },
        ] });
    }
    if (path === '/api/v1/social/posts' && req.method === 'GET') return send(res, 200, { brand_id: 'b1', posts: state.socialPosts.map(({ key, updated_at, ...p }) => p) });
    m = path.match(/^\/api\/v1\/social\/posts\/([^/]+)$/);
    if (m && req.method === 'GET') {
        const found = state.socialPosts.find((x) => x.id === m[1]);
        if (!found) return send(res, 404, { error: 'post_not_found' });
        const { key, ...row } = found;
        return send(res, 200, { brand_id: 'b1', brandRole: 'owner', post: row });
    }
    m = path.match(/^\/api\/v1\/social\/posts\/([^/]+)(\/schedule)?$/);
    if (m && req.method === 'PATCH') {
        const post = state.socialPosts.find((x) => x.id === m[1]);
        if (!post) return send(res, 404, { error: 'POST_NOT_FOUND' });
        const now = new Date().toISOString();
        if (m[2]) {
            if (post.status !== 'scheduled') return send(res, 409, { error: 'POST_STARTED' });
            if (body.expectedAt !== post.scheduled_at) return send(res, 409, { error: 'SCHEDULE_CHANGED' });
            post.scheduled_at = body.scheduledAt; post.updated_at = now;
            return send(res, 200, { scheduled_at: post.scheduled_at, idempotent: false });
        }
        if (body.expectedUpdatedAt !== post.updated_at) return send(res, 409, { error: 'POST_CHANGED' });
        if (body.action === 'cancel') { if (post.status !== 'scheduled') return send(res, 409, { error: 'POST_STARTED' }); post.status = 'canceled'; post.updated_at = now; return send(res, 200, { updated_at: now, idempotent: false }); }
        if (body.action === 'restore') { if (post.status !== 'canceled') return send(res, 409, { error: 'POST_CHANGED' }); post.status = 'scheduled'; post.scheduled_at = body.scheduledAt; post.updated_at = now; return send(res, 200, { updated_at: now, scheduled_at: post.scheduled_at, idempotent: false }); }
        return send(res, 400, { error: 'invalid_body' });
    }
    if (path === '/api/v1/social/analytics') return send(res, 200, { account: { id: 'acc-1', network: 'instagram', display_name: 'Veyrnox Studio', status: 'active' }, sync: { last_ok_at: '2026-10-18T06:00:00Z', failing: false }, evolution: [{ date: '2026-10-17', metrics: { followers: 1240, reach: 5300 } }, { date: '2026-10-18', metrics: { followers: 1262, reach: 6120, video_views: 880 } }], posts: [{ id: 'ap-1', published_at: '2026-10-17T09:00:00Z', type: 'reel', permalink: 'https://www.instagram.com/p/mock/', caption: 'Behind the scenes cut.', metrics: { likes: 140, comments: 12 } }] });
    // Workspaces and projects (read-only). The real routes answer errors as {error:{code,message}}, an object.
    const PROJECTS = [
        { id: 'c1111111-1111-4111-8111-111111111111', workspace_id: 'w1111111-1111-4111-8111-111111111111', owner_id: 'u1', name: 'Spring launch reel', version: 54, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-18T09:00:00Z' },
        { id: 'c2222222-2222-4222-8222-222222222222', workspace_id: 'w1111111-1111-4111-8111-111111111111', owner_id: 'u1', name: 'Product teaser', version: 3, created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-12T09:00:00Z' },
    ];
    const WORKSPACES = [
        { id: 'w1111111-1111-4111-8111-111111111111', organisation_id: 'o1', name: 'Studio', is_default: true },
        { id: 'w2222222-2222-4222-8222-222222222222', organisation_id: 'o1', name: 'Client work', is_default: false },
    ];
    if (path === '/api/v1/workspaces' && req.method === 'GET') return send(res, 200, { workspaces: WORKSPACES });
    if (path === '/api/v1/projects' && req.method === 'GET') {
        const w = new URL(req.url, 'http://x').searchParams.get('workspace_id');
        return send(res, 200, { projects: PROJECTS.filter((p) => p.workspace_id === w) });
    }
    m = path.match(/^\/api\/v1\/projects\/([^/]+)(\/history)?$/);
    if (m && req.method === 'GET') {
        const p = PROJECTS.find((x) => x.id === m[1]);
        if (!p) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'The resource was not found.', requestId: 'mock' } });
        if (!m[2]) return send(res, 200, { project: p });
        const before = Number(new URL(req.url, 'http://x').searchParams.get('before') || p.version + 1);
        const revs = []; for (let r = Math.min(before - 1, p.version); r >= 1 && revs.length < 50; r--) revs.push({ revision: r, actor_id: 'u1', created_at: new Date(Date.parse(p.updated_at) - (p.version - r) * 3600000).toISOString(), restored_from: r === 40 ? 12 : null });
        return send(res, 200, { versions: revs, next_before: revs.length === 50 ? revs[49].revision : null });
    }
    // Library files (read-only): film masters and editor renders, with the real routes' shapes. The asset link is http
    // here, which the app refuses on purpose, so Share and Save cannot be exercised against the mock.
    const FILES = {
        masters: [
            { id: 'a1111111-1111-4111-8111-111111111111', source_job_id: null, label: 'Spring launch master', sha256: 'a'.repeat(64), size_bytes: 41_943_040, width: 1920, height: 1080, seconds: 74, frame_rate: 30, created_at: new Date(Date.now() - 2 * 86400000).toISOString(), expires_at: new Date(Date.now() + 28 * 86400000).toISOString() },
            { id: 'a2222222-2222-4222-8222-222222222222', source_job_id: null, label: 'Teaser cut', sha256: 'b'.repeat(64), size_bytes: 9_437_184, width: 1080, height: 1920, seconds: 12.5, frame_rate: 30, created_at: new Date(Date.now() - 20 * 86400000).toISOString(), expires_at: new Date(Date.now() + 3 * 3600000).toISOString() },
            { id: 'a3333333-3333-4333-8333-333333333333', source_job_id: null, label: 'Old promo', sha256: 'c'.repeat(64), size_bytes: 20_971_520, width: 1280, height: 720, seconds: 30, frame_rate: 25, created_at: new Date(Date.now() - 40 * 86400000).toISOString(), expires_at: new Date(Date.now() - 86400000).toISOString() },
        ],
        renders: [
            { id: 'b1111111-1111-4111-8111-111111111111', label: 'Editor export: product reel', sha256: 'd'.repeat(64), size_bytes: 15_728_640, state: 'stored', width: 1080, height: 1920, seconds: 22, frame_rate: 30, created_at: new Date(Date.now() - 86400000).toISOString(), expires_at: new Date(Date.now() + 60 * 86400000).toISOString(), inspected_at: new Date().toISOString() },
        ],
    };
    if (path === '/api/v1/library/masters' && req.method === 'GET') return send(res, 200, { enabled: true, masters: FILES.masters });
    if (path === '/api/v1/library/editor-renders' && req.method === 'GET') return send(res, 200, { enabled: true, renders: FILES.renders });
    m = path.match(/^\/api\/v1\/library\/(masters|editor-renders)\/([^/]+)\/asset$/);
    if (m && req.method === 'GET') {
        const f = FILES[m[1] === 'masters' ? 'masters' : 'renders'].find((x) => x.id === m[2]);
        if (!f) return send(res, 404, { error: 'not_found' });
        return send(res, 200, { url: `http://localhost:${PORT}/asset.png`, mime_type: 'video/mp4', size_bytes: f.size_bytes, sha256: f.sha256, expires_in: 900, asset_expires_at: f.expires_at });
    }
    if (path === '/api/presets')
        return send(res, 200, {
            presets: [
                { id: 'mock-hero', title: 'Studio Product Shot', category: 'PRODUCTS', modelId: 'nano-banana', modelName: 'Nano Banana', modality: 'text-to-image', prompt: 'A glossy product on black acrylic, soft rim light, 4k.', needs: null, durationSeconds: null, credits: 4, gated: false, isNew: true, previewUrl: null, posterUrl: null, previewAspect: '1 / 1' },
                { id: 'mock-orbit', title: 'Orbit Reveal', category: 'PRODUCTS', modelId: 'kling-3', modelName: 'Kling 3', modality: 'text-to-video', prompt: 'A smooth 360-degree orbit around the product, cinematic lighting.', needs: null, durationSeconds: 10, credits: 18, gated: false, isNew: false, previewUrl: null, posterUrl: null, previewAspect: '9 / 16' },
                { id: 'mock-gated', title: 'Hidden Gated One', category: 'CINEMATIC', modelId: 'veo-fast', modelName: 'Veo', modality: 'text-to-video', prompt: 'x', needs: null, durationSeconds: 5, credits: 12, gated: true, isNew: false, previewUrl: null, posterUrl: null, previewAspect: '9 / 16' },
            ],
        });

    if (!req.headers.authorization?.startsWith('Bearer ')) return send(res, 401, { error: 'not_authenticated' });
    if (path === '/api/v1/balance') return send(res, 200, { balance: state.balance, free_credits: state.free, free_expires_at: null });
    if (path === '/api/v1/referrals') return send(res, 200, { enabled: true, code: state.referral.code, referred: state.referral.referred });
    if (path === '/api/v1/referrals/attach' && req.method === 'POST') {
        if (body.code === state.referral.code) return send(res, 400, { error: 'self_referral' });
        if (state.referral.attached) return send(res, 409, { error: 'already_attached' });
        state.referral.attached = true;
        return send(res, 200, { attached: true });
    }
    if (path === '/api/v1/store-purchases/customer') return send(res, 200, { rc_customer_id: '3f2b8a52-6c0e-4d7a-9b1f-0a1b2c3d4e5f' });
    if (path === '/api/v1/social/plan') return send(res, 200, { plans: [], entitlement: { tier: 'free', subscription: null } });

    if ((m = path.match(/^\/api\/v1\/cinema\/titles\/([^/]+)$/))) {
        const t = CINEMA.find((x) => x.id === m[1]);
        if (!t) return send(res, 404, { error: 'title_not_found' });
        const head = { ...t, creator: { username: t.username, display_name: t.display_name } };
        if (t.content_type === 'SERIES') return send(res, 200, { title: { ...head, seasons: [{ id: randomUUID(), position: 1, title: 'Season 1', episodes: episodes(t.id) }] } });
        return send(res, 200, { title: { ...head, access: t.id === CINEMA[1].id ? 'locked' : 'free', credits: 0 } });
    }
    if (path === '/api/v1/cinema/play' && req.method === 'POST') {
        if (body.content_id === CINEMA[1].id) return send(res, 503, { error: 'unlocks_not_open' });
        const watch = randomUUID();
        plays.set(body.content_id, { minutes: 0 });
        const seg = (n) => Buffer.from(JSON.stringify({ n })).toString('base64url');
        return send(res, 200, { token: `${seg(1)}.${seg(2)}.${seg(3)}`, customer_code: 'mockcode', expires_at: new Date(Date.now() + PLAY_TTL * 1000).toISOString(), watch_session_id: watch, content_id: body.content_id });
    }
    if (path === '/api/v1/cinema/play/heartbeat' && req.method === 'POST') {
        const p = plays.get(body.content_id) ?? { minutes: 0 };
        p.minutes += body.seconds / 60; plays.set(body.content_id, p);
        // MOCK_FREE_CEILING_SECONDS makes the free monthly ceiling hit after that many reported seconds.
        const limit = Number(process.env.MOCK_FREE_CEILING_SECONDS || 0);
        if (limit && p.minutes * 60 >= limit) return send(res, 200, { recorded: false, access: 'locked', seconds: 0, reason: 'free_ceiling', content_id: body.content_id });
        return send(res, 200, { recorded: true, access: 'free', seconds: body.seconds, content_id: body.content_id });
    }
    if (path === '/api/v1/cinema/audience' && req.method === 'POST') return send(res, 200, { ok: true });
    if (path === '/api/v1/reports' && req.method === 'POST') return send(res, 200, { replayed: false });

    if (path === '/api/v1/chat/models') return send(res, 200, { models: CHAT_MODELS });
    // Personas and folders (stateful), with the real routes' limits and error codes.
    const count = (fid) => state.threads.filter((t) => t.folder_id === fid).length;
    if (path === '/api/v1/chat/personas' && req.method === 'GET') return send(res, 200, { enabled: true, personas: state.personas });
    if (path === '/api/v1/chat/personas' && req.method === 'POST') {
        const name = String(body.name || '').trim(); const ins = String(body.instructions || '').trim();
        if (!name || name.length > 60) return send(res, 400, { error: 'invalid_persona_name' });
        if (!ins || ins.length > 4000) return send(res, 400, { error: 'invalid_instructions' });
        const p = { id: randomUUID(), name, instructions: ins, model_id: body.model_id ?? null, thinking: body.thinking === true, web: body.web === true };
        state.personas.push(p);
        return send(res, 201, { persona: p });
    }
    m = path.match(/^\/api\/v1\/chat\/personas\/([^/]+)$/);
    if (m) {
        const p = state.personas.find((x) => x.id === m[1]);
        if (!p) return send(res, 404, { error: 'persona_not_found' });
        if (req.method === 'DELETE') { state.personas = state.personas.filter((x) => x !== p); return send(res, 200, { ok: true }); }
        if (req.method === 'PATCH') {
            const name = String(body.name || '').trim(); const ins = String(body.instructions || '').trim();
            if (!name || name.length > 60) return send(res, 400, { error: 'invalid_persona_name' });
            if (!ins || ins.length > 4000) return send(res, 400, { error: 'invalid_instructions' });
            Object.assign(p, { name, instructions: ins, model_id: body.model_id ?? null, thinking: body.thinking === true, web: body.web === true });
            return send(res, 200, { persona: p });
        }
    }
    if (path === '/api/v1/chat/folders' && req.method === 'GET') return send(res, 200, { folders: state.folders.map((f) => ({ ...f, count: count(f.id) })) });
    if (path === '/api/v1/chat/folders' && req.method === 'POST') {
        const name = String(body.name || '').trim();
        if (!name || name.length > 60) return send(res, 400, { error: 'invalid_name' });
        if (state.folders.length >= 5) return send(res, 409, { error: 'FOLDER_LIMIT' });
        const f = { id: randomUUID(), name };
        state.folders.push(f);
        return send(res, 201, { folder: { ...f, count: 0 } });
    }
    m = path.match(/^\/api\/v1\/chat\/folders\/([^/]+)$/);
    if (m) {
        const f = state.folders.find((x) => x.id === m[1]);
        if (!f) return send(res, 404, { error: 'folder_not_found' });
        if (req.method === 'DELETE') { state.folders = state.folders.filter((x) => x !== f); state.threads.forEach((t) => { if (t.folder_id === f.id) t.folder_id = null; }); return send(res, 200, { ok: true }); }
        if (req.method === 'PATCH') { const name = String(body.name || '').trim(); if (!name || name.length > 60) return send(res, 400, { error: 'invalid_name' }); f.name = name; return send(res, 200, { folder: { ...f, count: count(f.id) } }); }
    }
    // Change or delete one chat: { folder_id } alone files it; { system_prompt } sets its instructions.
    m = path.match(/^\/api\/v1\/chat\/threads\/([^/]+)$/);
    if (m && (req.method === 'PATCH' || req.method === 'DELETE')) {
        const t = state.threads.find((x) => x.id === m[1]);
        if (!t) return send(res, 404, { error: 'thread_not_found' });
        if (req.method === 'DELETE') { state.threads = state.threads.filter((x) => x !== t); return send(res, 200, { ok: true }); }
        if ('folder_id' in body) {
            if (body.folder_id !== null && !state.folders.some((f) => f.id === body.folder_id)) return send(res, 404, { error: 'folder_not_found' });
            t.folder_id = body.folder_id; return send(res, 200, { ok: true, folder_id: t.folder_id });
        }
        if (typeof body.system_prompt === 'string') { t.system_prompt = body.system_prompt; if (!t.title) t.title = 'Chat with a persona'; return send(res, 200, { ok: true }); }
        return send(res, 400, { error: 'invalid_body' });
    }
    if (path === '/api/v1/chat/threads' && req.method === 'GET') return send(res, 200, { threads: state.threads });
    if (path === '/api/v1/chat/threads' && req.method === 'POST') {
        const t = { id: randomUUID(), model_id: body.model_id, title: null, pinned: false, folder_id: null, updated_at: new Date().toISOString() };
        state.threads.unshift(t); state.messages.set(t.id, []);
        return send(res, 201, { thread: t });
    }
    m = path.match(/^\/api\/v1\/chat\/threads\/([^/]+)(\/messages)?$/);
    if (m) {
        const t = state.threads.find((x) => x.id === m[1]);
        if (!t) return send(res, 404, { error: 'thread_not_found' });
        if (!m[2]) return send(res, 200, { thread: t, messages: state.messages.get(t.id) ?? [] });
        const reply = `Here is a quick take on “${String(body.text || '').slice(0, 60)}”: lead with the strongest visual, keep it under ten seconds, and end on the product name.`;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
        state.balance -= 1;
        ev('start', { job_id: randomUUID(), credits: 1, balance_after: state.balance });
        let i = 0;
        const timer = setInterval(() => {
            if (i >= reply.length) {
                clearInterval(timer);
                t.title ||= String(body.text || '').slice(0, 40);
                state.messages.get(t.id).push({ id: randomUUID(), role: 'user', content: body.text }, { id: randomUUID(), role: 'assistant', content: reply, credits: 1 });
                ev('done', { status: 'succeeded', credits_charged: 1, balance: state.balance });
                return res.end();
            }
            ev('delta', { text: reply.slice(i, i + 6) }); i += 6;
        }, 40);
        return;
    }

    if (path === '/api/v1/generations' && req.method === 'POST' && body.model_id === 'clip-edit') {
        // Quick edit (ADR-0134): checks the clips like the server does, quotes 3 credits per started 10 s plus 4 for captions,
        // and a confirmed price of 0 is refused with the real price and charges nothing.
        const clips = body.inputs?.clips;
        if (!Array.isArray(clips) || clips.length === 0 || clips.length > 10) return send(res, 400, { error: 'inputs_invalid' });
        let total = 0;
        for (const c of clips) {
            const src = state.jobs.find((x) => x.id === c.asset_id);
            if (!src) return send(res, 404, { error: 'asset_not_found' });
            if (!src.kind.includes('video')) return send(res, 400, { error: 'clip_not_video' });
            if (!(c.in_s >= 0 && c.out_s > c.in_s && c.out_s <= CLIP_LENGTH_S + 0.01)) return send(res, 400, { error: 'clip_range' });
            total += c.out_s - c.in_s;
        }
        if (total > 60.01) return send(res, 400, { error: 'too_long' });
        const credits = 3 * Math.ceil(total / 10) + (body.inputs?.captions ? 4 : 0);
        if (body.confirmed_credits !== credits) return send(res, 409, { error: 'credit_confirmation_mismatch', expected_credits: credits });
        if (state.balance < credits) return send(res, 402, { error: 'insufficient_credits' });
        state.balance -= credits;
        const job = { id: randomUUID(), model_id: 'veo-fast', credits, created: Date.now(), label: `Edit of ${clips.length} clip${clips.length > 1 ? 's' : ''}`, kind: 'text-to-video' };
        state.jobs.unshift(job);
        console.log('[mock] clip-edit created');
        return send(res, 200, { job_id: job.id, state: 'SUBMITTED', balance_after: state.balance });
    }
    if (path === '/api/v1/generations' && req.method === 'POST') {
        const model = CATALOG.find((x) => x.id === body.model_id);
        if (!model) return send(res, 400, { error: 'model_id_required' });
        const seconds = body.inputs?.duration_seconds || 5;
        const credits = model.credits * Math.ceil(seconds / 5);
        if (body.confirmed_credits !== undefined && body.confirmed_credits !== credits) return send(res, 409, { error: 'credit_confirmation_mismatch', expected_credits: credits });
        if (state.balance < credits) return send(res, 402, { error: 'insufficient_credits' });
        state.balance -= credits;
        const job = { id: randomUUID(), model_id: model.id, credits, created: Date.now(), label: String(body.inputs?.prompt || '').slice(0, 60), kind: model.modality };
        state.jobs.unshift(job);
        return send(res, 200, { job_id: job.id, state: 'SUBMITTED', balance_after: state.balance });
    }
    if (path === '/api/v1/jobs') return send(res, 200, { jobs: state.jobs.map(jobView), next: null });
    // GET /api/v1/jobs/:id/media-info (server PR #1289): the real length of a finished video. A job whose prompt says
    // "nolength" answers 422 so the app's player fallback can be seen.
    m = path.match(/^\/api\/v1\/jobs\/([^/]+)\/media-info$/);
    if (m && req.method === 'GET') {
        const j = state.jobs.find((x) => x.id === m[1]);
        if (!j || jobState(j) !== 'succeeded') return send(res, 404, { error: 'not_found' });
        if (!j.kind.includes('video')) return send(res, 400, { error: 'not_video' });
        if (/nolength/i.test(j.label || '')) return send(res, 422, { error: 'unreadable' });
        return send(res, 200, { seconds: CLIP_LENGTH_S, width: 320, height: 568, size_bytes: 40099, mime_type: 'video/mp4' });
    }
    m = path.match(/^\/api\/v1\/jobs\/([^/]+)(\/asset)?$/);
    if (m) {
        // DELETE /api/v1/jobs/:id (ADR-0116): a repeat answers replayed; a job still running or whose prompt says "held" is refused.
        if (req.method === 'DELETE' && !m[2]) {
            const target = state.jobs.find((x) => x.id === m[1]);
            if (!target) return state.deleted.has(m[1]) ? send(res, 200, { deleted: true, replayed: true }) : send(res, 404, { error: 'not_found' });
            if (jobState(target) !== 'succeeded') return send(res, 409, { error: 'job_in_progress' });
            if (/held/i.test(target.label || '')) return send(res, 409, { error: 'job_on_hold' });
            state.jobs = state.jobs.filter((x) => x.id !== m[1]);
            state.deleted.add(m[1]);
            return send(res, 200, { deleted: true, replayed: false });
        }
        const j = state.jobs.find((x) => x.id === m[1]);
        if (!j) return send(res, 404, { error: 'not_found' });
        if (!m[2]) return send(res, 200, { state: jobState(j), credits: j.credits, model_id: j.model_id });
        return send(res, 200, { url: `http://localhost:${PORT}/${j.kind.includes('video') ? 'clip.mp4' : 'asset.png'}`, mime_type: j.kind.includes('image') ? 'image/png' : 'video/mp4', expires_in: 900 });
    }
    return send(res, 404, { error: 'not_found' });
}).listen(PORT, () => console.log(`mock server on http://localhost:${PORT}`));

#!/usr/bin/env node
// Local stand-in for Supabase Auth and the /api/v1 routes the app uses, so every signed-in screen can be
// previewed in the simulator without an account. Development only: `node dev/mock-server.mjs` (port 8799).
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 8799);
const state = {
    balance: 240, free: 10,
    threads: [{ id: randomUUID(), model_id: 'claude-sonnet', title: 'Launch plan for the spring drop', pinned: false, updated_at: new Date().toISOString() }],
    messages: new Map(),
    jobs: [],
};
state.messages.set(state.threads[0].id, [
    { id: randomUUID(), role: 'user', content: 'Give me three angles for a spring launch video.' },
    { id: randomUUID(), role: 'assistant', content: '1. A 10-second reveal with the product turning in soft light.\n2. A before/after split screen.\n3. A fast montage of customers unboxing it.', credits: 1 },
]);

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

const tokens = () => ({ access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 3600, token_type: 'bearer' });
const jobState = (j) => { const age = Date.now() - j.created; return age < 2500 ? 'queued' : age < 6000 ? 'running' : 'succeeded'; };
const jobView = (j) => ({ job_id: j.id, state: jobState(j), credits: j.credits, model_id: j.model_id, created_at: new Date(j.created).toISOString(), label: j.label, has_asset: jobState(j) === 'succeeded' });

const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;
    const body = req.method === 'POST' ? await readBody(req) : {};
    console.log(req.method, path);

    if (path.startsWith('/auth/v1/token') || path === '/auth/v1/signup') return send(res, 200, tokens());
    if (path === '/auth/v1/logout') { res.writeHead(204); return res.end(); }
    if (path === '/asset.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
    if (path === '/api/catalog') return send(res, 200, { models: CATALOG });

    if (!req.headers.authorization?.startsWith('Bearer ')) return send(res, 401, { error: 'not_authenticated' });
    if (path === '/api/v1/balance') return send(res, 200, { balance: state.balance, free_credits: state.free, free_expires_at: null });
    if (path === '/api/v1/store-purchases/customer') return send(res, 200, { rc_customer_id: '3f2b8a52-6c0e-4d7a-9b1f-0a1b2c3d4e5f' });
    if (path === '/api/v1/social/plan') return send(res, 200, { plans: [], entitlement: { tier: 'free', subscription: null } });

    if (path === '/api/v1/chat/models') return send(res, 200, { models: CHAT_MODELS });
    if (path === '/api/v1/chat/threads' && req.method === 'GET') return send(res, 200, { threads: state.threads });
    if (path === '/api/v1/chat/threads' && req.method === 'POST') {
        const t = { id: randomUUID(), model_id: body.model_id, title: null, pinned: false, updated_at: new Date().toISOString() };
        state.threads.unshift(t); state.messages.set(t.id, []);
        return send(res, 201, { thread: t });
    }
    let m = path.match(/^\/api\/v1\/chat\/threads\/([^/]+)(\/messages)?$/);
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
    m = path.match(/^\/api\/v1\/jobs\/([^/]+)(\/asset)?$/);
    if (m) {
        const j = state.jobs.find((x) => x.id === m[1]);
        if (!j) return send(res, 404, { error: 'not_found' });
        if (!m[2]) return send(res, 200, { state: jobState(j), credits: j.credits, model_id: j.model_id });
        return send(res, 200, { url: `http://localhost:${PORT}/asset.png`, mime_type: j.kind.includes('image') ? 'image/png' : 'video/mp4', expires_in: 900 });
    }
    return send(res, 404, { error: 'not_found' });
}).listen(PORT, () => console.log(`mock server on http://localhost:${PORT}`));

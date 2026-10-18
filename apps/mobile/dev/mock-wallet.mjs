#!/usr/bin/env node
// Wallet-side fixtures (M12): credit history, usage, free allowance, help and appeals. Kept apart from
// mock-server.mjs. `node dev/mock-wallet.mjs` listens on 8798, answers these routes itself and forwards every
// other request (sign-in, balance, ...) to the main mock on 8799, so point EXPO_PUBLIC_DEV_API_BASE at 8798.
import { createServer, request as httpRequest } from 'node:http';

const PORT = Number(process.env.MOCK_WALLET_PORT || 8798);
const UPSTREAM = Number(process.env.MOCK_PORT || 8799);
const PAGE = 25;

const KINDS = ['generation', 'generation', 'generation_refund', 'top_up', 'referral_reward', 'signup_grant', 'free_credit_expiry', 'payment_adjustment'];
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 60 entries, newest first, one every 37 minutes: enough for three pages.
export const LEDGER = Array.from({ length: 60 }, (_, i) => {
    const kind = KINDS[i % KINDS.length];
    const delta = { generation: -7, generation_refund: 7, top_up: 500, referral_reward: 50, signup_grant: 10, free_credit_expiry: -4, payment_adjustment: -500 }[kind];
    return { id: uuid(i + 1), delta, free_delta: kind === 'signup_grant' ? 10 : kind === 'free_credit_expiry' ? -4 : 0, job_id: null, kind, created_at: new Date(Date.now() - i * 37 * 60e3).toISOString() };
});

function ledgerPage(url) {
    const before = url.searchParams.get('before');
    const beforeId = url.searchParams.get('before_id');
    let rows = LEDGER;
    if (before !== null || beforeId !== null) {
        if (!before || !beforeId || Number.isNaN(Date.parse(before))) return [400, { error: 'invalid_cursor' }];
        const at = LEDGER.findIndex((e) => e.id === beforeId);
        rows = at < 0 ? [] : LEDGER.slice(at + 1);
    }
    const entries = rows.slice(0, PAGE);
    const last = entries.at(-1);
    return [200, { entries, next: rows.length > PAGE ? { before: last.created_at, before_id: last.id } : null }];
}

/** Returns [status, body] for a wallet route, or null when the path is not one of them. */
export function handleWallet(method, url) {
    if (method === 'GET' && url.pathname === '/api/v1/ledger') return ledgerPage(url);
    if (method === 'GET' && url.pathname === '/api/v1/ledger/usage') return [200, { spent: { day: 14, week: 63, month: 210 }, truncated: false }];
    if (method === 'GET' && url.pathname === '/api/v1/free-allowance') {
        // MOCK_FREE_OFF=1 answers the disabled shape, which hides the card.
        return [200, process.env.MOCK_FREE_OFF ? { enabled: false, left: {} } : { enabled: true, left: { 'flux-schnell': 3, 'kling-v2': 1 } }];
    }
    if (url.pathname === '/api/v1/appeals') {
        if (method === 'GET') return [200, { sanctions: SANCTIONS, hold_until: null, frozen: false }];
        if (method === 'POST') return 'appeals-post';
    }
    return null;
}

export const SANCTIONS = [
    { action_id: uuid(9001), action: 'takedown', created_at: new Date(Date.now() - 3 * 864e5).toISOString(), job_id: null, model_id: 'flux-schnell', hold_until: null, appeal_status: null },
    { action_id: uuid(9002), action: 'warning', created_at: new Date(Date.now() - 9 * 864e5).toISOString(), job_id: null, model_id: null, hold_until: null, appeal_status: 'rejected' },
];

// POST /api/v1/appeals: the same checks as the route, then marks the decision as under review.
export function postAppeal(body) {
    const s = SANCTIONS.find((x) => x.action_id === body?.action_id);
    if (!s) return [404, { error: 'action_not_found' }];
    if (typeof body.statement !== 'string' || body.statement.trim().length < 10 || body.statement.length > 2000) return [400, { error: 'statement_invalid' }];
    const replayed = s.appeal_status !== null;
    if (!replayed) s.appeal_status = 'open';
    return [replayed ? 200 : 201, { appeal_id: uuid(7000), status: s.appeal_status, submitted_at: new Date().toISOString(), replayed }];
}

function forward(req, res) {
    const up = httpRequest({ host: '127.0.0.1', port: UPSTREAM, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        let hit = req.headers.authorization ? handleWallet(req.method ?? 'GET', url) : null;
        if (!hit) return forward(req, res);
        if (hit === 'appeals-post') {
            let raw = '';
            req.on('data', (c) => (raw += c));
            return req.on('end', () => {
                let body = null;
                try { body = JSON.parse(raw); } catch { /* body stays null */ }
                const out = postAppeal(body);
                res.writeHead(out[0], { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(out[1]));
            });
        }
        res.writeHead(hit[0], { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(hit[1]));
    }).listen(PORT, () => console.log(`mock-wallet on ${PORT}, forwarding the rest to ${UPSTREAM}`));
}

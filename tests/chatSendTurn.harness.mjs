// The harness of tests/chatSendUnanswered.test.mjs and tests/chatSendReplay.test.mjs: sendTurn run for real against a
// faked fetch (ADR-0067). chatApi.js is loaded with its imports handed in, the way tests/chatSendFlow.harness.mjs loads
// the hook. It was part of tests/chatSendUnanswered.test.mjs, and moved here unchanged when a second file needed it.
// Not a test file itself: its name keeps it out of `npm test`'s pattern.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { askStoppedSend, jobIdOf, lostNotice, settleStoppedTurn } from '../app/veyrnox/_lib/chatStop.js';
import { GatewayError, TEXT } from './chatSendFlow.harness.mjs';
import { JOB, KEY } from './chatWarning.harness.mjs';

const apiSource = readFileSync(new URL('../app/veyrnox/_lib/chatApi.js', import.meta.url), 'utf8');

/** chatApi.js with its imports handed in, as the harness loads the hook: sendTurn runs for real against a faked fetch. */
export function loadApi(fetch, { token = 'token' } = {}) {
    const imported = [...apiSource.matchAll(/^import \{ ([^}]+) \} from /gm)].flatMap((m) => m[1].split(',').map((n) => n.trim()));
    const body = apiSource.replace(/^'use client';\n/, '').replace(/^import [^\n]+\n/gm, '').replace(/^export \{[^\n]*\n/gm, '').replace(/^export /gm, '');
    const calls = [];
    const deps = {
        getFreshAccessToken: async () => token, getSession: () => ({ access_token: token }), clearSession: () => {}, turnOptions: (o) => o,
        lostNotice, settleStoppedTurn, askStoppedSend, jobIdOf, gatewayFetch: async () => { throw new Error('not used here'); }, GatewayError,
        ACCOUNT_PAUSED_COPY: 'paused', makeIdempotencyKey: () => KEY, notifyBalanceChanged: () => {},
    };
    assert.deepEqual(imported.filter((n) => !(n in deps)), [], 'every name chatApi.js imports is handed in here');
    const made = new Function('deps', 'fetch', `const { ${Object.keys(deps).join(', ')} } = deps;\n${body}\nreturn { chatApi, sendTurn, chatErrorCopy };`);
    return { ...made(deps, (...args) => { calls.push(args); return fetch(...args); }), calls };
}
/** One sendTurn: what it returned or threw, the events it handed on, and the requests it made. */
export async function sent(fetch, more) {
    const events = [];
    const { sendTurn, calls } = loadApi(fetch, more);
    const args = { threadId: 'chat-a', text: TEXT, key: KEY, options: {}, signal: more?.signal, onEvent: (ev) => events.push(ev) };
    return sendTurn(args).then((r) => ({ r, events, calls }), (e) => ({ e, events, calls }));
}
export const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
export const START = frame('start', { job_id: JOB });
export const DONE = frame('done', { status: 'complete', credits_charged: 2 });
/** A reply stream: the frames one read at a time, then a clean end, or `breaks` thrown by the next read. */
export function stream(frames, breaks = null) {
    let i = 0;
    const source = { pull(c) { if (i < frames.length) { c.enqueue(new TextEncoder().encode(frames[i])); i += 1; } else if (breaks) c.error(breaks); else c.close(); } };
    return new Response(new ReadableStream(source), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}
export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const page = (status) => new Response('<html><body>error</body></html>', { status, headers: { 'content-type': 'text/html' } });
export const dropped = () => new TypeError('Failed to fetch');
/** The one thing send() asks about: a GatewayError, so it is told from an error raised before the request, with the status that came. */
export const isUnanswered = (e, status = 0) => e instanceof GatewayError && e.code === 'send_unanswered' && e.status === status;

#!/usr/bin/env node
/**
 * Slice 0 webhook probe for Clip Editor captions (docs/editor/CAPTIONS.md).
 * Does `veed/subtitles` deliver a callback through fal's normal queue webhook,
 * and does it verify with our own verifyWebhookSignature (Ed25519 via JWKS)?
 *
 * It starts a receiver on localhost, submits one real captions job with
 * ?fal_webhook=<public-url>/hook, waits for fal's POST, and runs the delivery
 * through packages/adapters/fal.js#verifyWebhookSignature, the same function
 * the Worker uses. Nothing is written to the repo or the database.
 *
 * fal has to reach the receiver, so it needs a public https URL that forwards
 * to the local port. A Cloudflare quick tunnel needs no account:
 *
 *   cloudflared tunnel --url http://localhost:8788
 *
 * Usage (PAID, one captions job):
 *   FAL_KEY=... node scripts/probe-fal-webhook.mjs --public-url=https://xyz.trycloudflare.com --video-url=https://...
 *   FAL_KEY=... node scripts/probe-fal-webhook.mjs --public-url=... --video-file=./clip.mp4
 *
 * The expected fal user id is read from the first delivery's
 * x-fal-webhook-user-id header unless FAL_WEBHOOK_USER_ID is set; set it to
 * compare against the id the Worker is configured with. Reads FAL_KEY from the
 * environment and never prints it.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { verifyWebhookSignature } from '../packages/adapters/fal.js';

const ENDPOINT = 'veed/subtitles';
const PORT = 8788;
const WAIT_MS = 5 * 60 * 1000;

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const publicUrl = flag('public-url');
const videoUrlArg = flag('video-url');
const videoFile = flag('video-file');
const key = process.env.FAL_KEY;

function die(msg) { console.error(msg); process.exit(2); }
if (!key) die('FAL_KEY is not set.');
if (!publicUrl?.startsWith('https://')) die('--public-url=https://... is required (see the header for a tunnel).');
if (!videoUrlArg && !videoFile) die('Pass --video-url=https://... or --video-file=./clip.mp4.');
if (videoUrlArg) {
    let host = '';
    try { host = new URL(videoUrlArg).hostname; } catch { die('--video-url is not a valid URL.'); }
    if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes('.')) die('--video-url is a placeholder?');
}

const authHeader = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };

async function uploadToFal(path) {
    const bytes = await readFile(path);
    const init = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', {
        method: 'POST', headers: authHeader, body: JSON.stringify({ content_type: 'video/mp4', file_name: basename(path) }) });
    if (!init.ok) die(`upload initiate failed: ${init.status}`);
    const { upload_url: uploadUrl, file_url: fileUrl } = await init.json();
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: bytes });
    if (!put.ok) die(`upload failed: ${put.status}`);
    return fileUrl;
}

let resolveDelivery;
const delivery = new Promise((r) => { resolveDelivery = r; });

const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/hook') { res.writeHead(404).end(); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        res.writeHead(200).end('ok');
        resolveDelivery({ raw: new Uint8Array(Buffer.concat(chunks)), headers: req.headers });
    });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`receiver listening on http://localhost:${PORT}/hook (tunnel it to ${publicUrl})`);

const videoUrl = videoUrlArg ?? await uploadToFal(videoFile);
const hook = `${publicUrl.replace(/\/$/, '')}/hook`;
const post = await fetch(`https://queue.fal.run/${ENDPOINT}?fal_webhook=${encodeURIComponent(hook)}`, {
    method: 'POST', headers: authHeader, body: JSON.stringify({ video_url: videoUrl, preset: 'simple' }) });
if (!post.ok) { server.close(); die(`submit failed: ${post.status} ${(await post.text().catch(() => '')).slice(0, 300)}`); }
const q = await post.json();
console.log(`request_id ${q.request_id}; waiting up to ${WAIT_MS / 60000} min for the callback...`);

const got = await Promise.race([delivery, new Promise((r) => setTimeout(() => r(null), WAIT_MS))]);
server.close();
if (!got) { console.log('RESULT: no callback arrived. Check the tunnel, or the endpoint may not deliver webhooks.'); process.exit(1); }

const h = got.headers;
const sigHeaders = {
    signature: h['x-fal-webhook-signature'], timestamp: h['x-fal-webhook-timestamp'],
    requestId: h['x-fal-webhook-request-id'], userId: h['x-fal-webhook-user-id'],
};
console.log('headers present:', Object.fromEntries(Object.entries(sigHeaders).map(([k, v]) => [k, v ? 'yes' : 'MISSING'])));
let body = null;
try { body = JSON.parse(Buffer.from(got.raw).toString('utf8')); } catch { /* not JSON */ }
console.log('body keys:', body ? Object.keys(body) : 'not JSON', '| status:', body?.status ?? '(none)', '| request_id matches:', body?.request_id === q.request_id);
console.log('payload has video url:', typeof (body?.payload?.video?.url ?? body?.video?.url) === 'string');

const expectedUserId = process.env.FAL_WEBHOOK_USER_ID || sigHeaders.userId || '';
const ok = await verifyWebhookSignature(got.raw, sigHeaders, { expectedUserId });
console.log(`RESULT: signature ${ok ? 'VERIFIED' : 'FAILED'} with the Worker's verifier`
    + (process.env.FAL_WEBHOOK_USER_ID ? '' : ' (expected user id taken from the header itself, so this checks the signature, not the tenant)'));
process.exit(ok ? 0 : 1);

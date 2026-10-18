#!/usr/bin/env node
// Spike part 2 helper: checks a real Cloudflare Stream manifest and opens it in the iOS simulator's player.
//   CUSTOMER_CODE=<code> PLAYBACK_TOKEN=<token> node dev/open-manifest.mjs
// The token is a 15-minute playback token for one video (not an account credential). Get one from the signed-in
// staging web app (POST /api/v1/cinema/play). Needs a dev build with `ai.veyrnox.app` installed and booted.
import { execFileSync } from 'node:child_process';

const code = process.env.CUSTOMER_CODE;
const token = process.env.PLAYBACK_TOKEN;
if (!code || !token) { console.error('Set CUSTOMER_CODE and PLAYBACK_TOKEN.'); process.exit(1); }
if (!/^[a-z0-9]{1,64}$/.test(code) || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) { console.error('That does not look like a customer code and a token.'); process.exit(1); }

const manifest = `https://customer-${code}.cloudflarestream.com/${token}/manifest/video.m3u8`;
const started = Date.now();
const res = await fetch(manifest);
const text = await res.text();
console.log(`manifest: HTTP ${res.status} in ${Date.now() - started} ms, ${res.headers.get('content-type')}`);
console.log(text.split('\n').slice(0, 8).join('\n'));
if (!res.ok || !text.startsWith('#EXTM3U')) { console.error('Not an HLS manifest. Stop here: fall back to the iframe in a web view.'); process.exit(2); }

const link = `ai.veyrnox.app://cinema/probe?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`;
try {
    execFileSync('xcrun', ['simctl', 'openurl', 'booted', link], { stdio: 'inherit' });
    console.log('Opened in the simulator. Read the startup time and status lines on the probe screen.');
} catch {
    console.log('Could not open the simulator. Open this link in it yourself:\n' + link);
}

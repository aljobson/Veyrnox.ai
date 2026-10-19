#!/usr/bin/env node
// Starts the built Worker (.open-next, via `wrangler dev`) and requests a few
// public pages. Run after `npm run build:worker`. Needs no secrets: the
// Supabase key set is a throwaway static JWKS in .dev.vars (middleware.js
// reads SUPABASE_JWKS), and no handler here talks to a database.
// Born of the 2026-10-19 outage: next 16.4.2 + adapter 1.20.8 built green and
// answered every page with 500 "Unexpected loadManifest(...) call!".
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.SMOKE_PORT || 8797);
const BASE = `http://127.0.0.1:${PORT}`;
const PATHS = ['/', '/pricing', '/robots.txt', '/sitemap.xml'];
const POISON = /loadManifest|Unexpected loadManifest|preview-props/i;
const STARTUP_MS = 120_000;

if (!existsSync('.open-next/worker.js')) {
    console.error('smoke: .open-next/worker.js missing, run `npm run build:worker` first');
    process.exit(2);
}
const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
writeFileSync('.dev.vars', `SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_JWKS='${JSON.stringify({ keys: [{ ...jwk, kid: 'smoke', alg: 'ES256', use: 'sig' }] })}'\n`);

const child = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
});
let log = '';
for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { log += d; });
let exited = false;
child.on('exit', () => { exited = true; });

function cleanup() {
    rmSync('.dev.vars', { force: true });
    // wrangler spawns workerd/esbuild: kill the whole group, or they keep the job alive.
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
}
async function waitUp() {
    const until = Date.now() + STARTUP_MS;
    while (Date.now() < until) {
        if (exited) throw new Error('wrangler dev exited before it was ready');
        try { await fetch(`${BASE}/robots.txt`); return; } catch { await new Promise((r) => setTimeout(r, 1000)); }
    }
    throw new Error(`wrangler dev not ready after ${STARTUP_MS / 1000}s`);
}

const failures = [];
try {
    await waitUp();
    for (const path of PATHS) {
        const res = await fetch(BASE + path, { redirect: 'manual' });
        const body = await res.text();
        const bad = res.status !== 200 ? `status ${res.status}` : POISON.test(body) ? 'body contains a loadManifest/preview-props error' : '';
        console.log(`${bad ? 'FAIL' : 'ok  '} ${path} -> ${res.status}${bad ? ` (${bad})` : ''}`);
        if (bad) failures.push(`${path}: ${bad}; body starts: ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
    }
    if (POISON.test(log)) failures.push('wrangler log contains a loadManifest/preview-props error');
} catch (e) {
    failures.push(String(e.message || e));
} finally {
    cleanup();
}
if (failures.length) {
    console.error('\nworker smoke FAILED:\n- ' + failures.join('\n- '));
    console.error('\n--- wrangler output (tail) ---\n' + log.split('\n').slice(-40).join('\n'));
    process.exit(1);
}
console.log('worker smoke passed');
process.exit(0);

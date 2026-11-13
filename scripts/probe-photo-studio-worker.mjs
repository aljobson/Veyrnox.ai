#!/usr/bin/env node
// HTTP qualification through the real built Worker + Assets binding, never mocked middleware.
// --serve leaves the final enabled LOCAL probe running for the host's browser qualification.
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { parseJsonc } from './check-migration-ledger.mjs';
import { VISION_RELEASES, verifyVisionAssets, visionDigest } from './editor-vision-assets.mjs';
import { editorVisionWorkerPolicy } from '../app/veyrnox/_lib/editorVisionRuntime.mjs';
const root = process.cwd(), port = Number(process.env.PHOTO_PROOF_PORT || 8796), origin = `http://127.0.0.1:${port}`;
await access(resolve(root, '.open-next/worker.js'));
await verifyVisionAssets(resolve(root, '.open-next/assets'));
const original = parseJsonc(await readFile('wrangler.jsonc', 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'veyrnox-photo-proof-'));
const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
let child, log = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stop() {
    if (!child) return;
    const current = child; child = null;
    try { process.kill(-current.pid, 'SIGTERM'); } catch { /* exited */ }
    await Promise.race([new Promise(resolve => current.once('exit', resolve)), pause(2000)]);
    try { process.kill(-current.pid, 'SIGKILL'); } catch { /* exited */ }
}
async function start(localInference, photoStudio) {
    log = '';
    const config = {
        name: 'veyrnox-photo-local-proof', main: resolve(root, original.main),
        compatibility_date: original.compatibility_date, compatibility_flags: original.compatibility_flags,
        assets: { ...original.assets, directory: resolve(root, '.open-next/assets') },
        vars: { ...original.vars, PUBLIC_HOST: origin, SUPABASE_URL: 'http://127.0.0.1:54321',
            SUPABASE_JWKS: JSON.stringify({ keys: [{ ...jwk, kid: 'photo-proof', alg: 'ES256', use: 'sig' }] }),
            EDITOR_RUNTIME_FLAGS: JSON.stringify({ localInference, photoStudio }),
        },
    };
    // Legacy overrides must not shadow the grouped flags being tested.
    delete config.vars.EDITOR_LOCAL_INFERENCE_ENABLED; delete config.vars.PHOTO_STUDIO_ENABLED;
    const path = join(temporary, 'wrangler.json'); await writeFile(path, JSON.stringify(config));
    child = spawn(resolve(root, 'node_modules/.bin/wrangler'), ['dev', '--local', '--config', path, '--port', String(port), '--ip', '127.0.0.1', '--persist-to', join(temporary, 'state')], {
        cwd: temporary, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    });
    let exited = false; child.once('exit', () => { exited = true; }); child.once('error', error => { log += error.message; exited = true; });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-24000); });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (exited) throw new Error('Local built Worker exited before readiness.');
        try { const res = await fetch(`${origin}/robots.txt`); await res.arrayBuffer(); return; } catch { await pause(500); }
    }
    throw new Error('Local built Worker startup timed out.');
}
async function check(localInference, photoStudio) {
    for (const [index, release] of VISION_RELEASES.entries()) {
        const prefix = `/editor-vision/${release.version}`, enabled = localInference === 'true' && (index === 0 || photoStudio === 'true');
        for (const name of ['worker.mjs', release.model]) for (const method of ['GET', 'HEAD']) {
            const response = await fetch(`${origin}${prefix}/${name}`, { method, redirect: 'manual' });
            assert.equal(response.status, enabled ? 200 : 404, `${localInference}/${photoStudio} ${method} ${prefix}/${name}`);
            assert.equal(response.headers.get('Cache-Control'), enabled ? 'no-cache' : 'no-store');
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (enabled) {
                assert.equal(response.headers.get('Content-Security-Policy'), editorVisionWorkerPolicy(origin, prefix));
                if (method === 'GET') assert.equal(visionDigest(bytes), release.assets.find(file => file.path === name).sha256);
                const etag = response.headers.get('ETag');
                if (method === 'GET' && etag) {
                    // A revalidation must reach the gate and come back 304 with the same policy, not re-send the bytes.
                    const again = await fetch(`${origin}${prefix}/${name}`, { headers: { 'If-None-Match': etag }, redirect: 'manual' });
                    assert.equal(again.status, 304, `conditional ${prefix}/${name}`); assert.equal(again.headers.get('Cache-Control'), 'no-cache');
                    console.log(`PASS ${localInference}/${photoStudio} conditional ${prefix}/${name}: 304`);
                } else if (method === 'GET') console.log(`NOTE ${prefix}/${name}: no ETag from the local Assets binding; conditional path covered by unit test only`);
            }
            if (method === 'HEAD' || !enabled) assert.equal(bytes.length, 0);
            console.log(`PASS ${localInference}/${photoStudio} ${method} ${prefix}/${name}: ${response.status}`);
        }
    }
    if (photoStudio === 'false') for (const path of ['/app/photo-studio', '/veyrnox/app/photo-studio']) {
        const response = await fetch(origin + path, { redirect: 'manual' }); assert.equal(response.status, 404, path); await response.arrayBuffer();
    }
}
try {
    for (const [local, photo] of [['false','false'], ['false','true'], ['true','false'], ['true','true']]) {
        await start(local, photo); await check(local, photo);
        if (process.argv.includes('--serve') && local === 'true' && photo === 'true') {
            console.log(`Built Worker ready at ${origin}. Run the browser proof; Ctrl-C stops this local server.`);
            await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
        }
        await stop();
    }
} catch (error) { console.error(error.message); console.error(log); process.exitCode = 1; }
finally { await stop(); await rm(temporary, { recursive: true, force: true }); }

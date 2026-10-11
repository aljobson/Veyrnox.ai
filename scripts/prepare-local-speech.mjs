import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root, inventory, verifyBytes, verifyAssets, manifestText, workerText } from './local-speech-assets.mjs';
const target = new URL(`public/editor-speech/${inventory.version}/`, root);
const archives = new Map();
const temporary = await mkdtemp(join(tmpdir(), 'veyrnox-local-speech-'));
async function download(spec) {
    const response = await fetch(spec.source, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Local speech download failed (${response.status}): ${spec.source}`);
    const bytes = Buffer.from(await response.arrayBuffer()); verifyBytes(bytes, spec); return bytes;
}
async function cached(file) {
    const body = await readFile(new URL(file.path, target)).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (body) verifyBytes(body, file); return body;
}
async function store(file, bytes) {
    verifyBytes(bytes, file); const destination = new URL(file.path, target);
    await mkdir(dirname(fileURLToPath(destination)), { recursive: true }); await writeFile(destination, bytes);
}
try {
    const missingFragments = [];
    for (const file of inventory.files) {
        if (await cached(file)) continue;
        if (file.fragmentOf) { missingFragments.push(file); continue; }
        let bytes;
        if (file.archive) {
            if (!archives.has(file.archive)) {
                const spec = inventory.archives[file.archive], archive = await download(spec);
                if (`sha512-${createHash('sha512').update(archive).digest('base64')}` !== spec.integrity) throw new Error('Local speech package integrity mismatch.');
                const path = join(temporary, `${file.archive}.tgz`); await writeFile(path, archive); archives.set(file.archive, path);
            }
            // Only known regular-file members are streamed out; no archive paths are extracted into the checkout.
            bytes = execFileSync('tar', ['-xOf', archives.get(file.archive), file.member], { maxBuffer: 32 * 1024 * 1024 });
        } else bytes = await download(file);
        await store(file, bytes);
    }
    if (missingFragments.length) {
        const body = await download(inventory.decoder);
        let offset = 0;
        for (const fragment of inventory.decoder.chunks) {
            if (missingFragments.some(file => file.path === fragment.path)) await store(fragment, body.subarray(offset, offset + fragment.bytes));
            offset += fragment.bytes;
        }
        if (offset !== body.length) throw new Error('Local speech decoder fragment lengths do not match.');
    }
    await mkdir(fileURLToPath(target), { recursive: true });
    await writeFile(new URL('manifest.json', target), manifestText());
    await writeFile(new URL('worker.mjs', target), await workerText());
    const result = await verifyAssets(fileURLToPath(new URL('public/', root)));
    console.log(`Local speech model, runtime and notices verified: ${result.files} assets, ${result.bytes} bytes, largest ${result.largest} bytes.`);
} finally { await rm(temporary, { recursive: true, force: true }); }

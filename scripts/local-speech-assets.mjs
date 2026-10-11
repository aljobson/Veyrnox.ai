import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCAL_SPEECH_ASSET_PATH } from '../app/veyrnox/_lib/localSpeechAssets.mjs';
export const root = new URL('../', import.meta.url);
export const inventory = JSON.parse(await readFile(new URL('local-speech-assets.json', import.meta.url), 'utf8'));
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
if (LOCAL_SPEECH_ASSET_PATH !== `/editor-speech/${inventory.version}`) throw new Error('Local speech client path does not match asset inventory.');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyBytes(bytes, file) {
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Local speech checksum mismatch: ${file.path || file.source}`);
}
export function manifestText(spec = inventory) {
    const models = Object.fromEntries(spec.files.filter(file => file.path.startsWith('models/') && !file.fragmentOf).map(file => [file.path, { path: file.path, bytes: file.bytes, sha256: file.sha256 }]));
    models[spec.decoder.path] = { bytes: spec.decoder.bytes, sha256: spec.decoder.sha256, chunks: spec.decoder.chunks };
    return JSON.stringify({ version: spec.version, model: spec.model, modelRevision: spec.modelRevision, models }, null, 2) + '\n';
}
export async function workerText(spec = inventory) {
    const source = await readFile(new URL('local-speech-worker.mjs', import.meta.url), 'utf8');
    if (!source.includes("'__MANIFEST_SHA256__'")) throw new Error('Local speech Worker integrity marker is missing.');
    return source.replace('__MANIFEST_SHA256__', sha256(manifestText(spec)));
}
export async function verifyAssets(base, spec = inventory) {
    const target = join(base, 'editor-speech', spec.version);
    if (await readFile(join(target, 'manifest.json'), 'utf8') !== manifestText(spec)) throw new Error('Local speech manifest mismatch.');
    if (await readFile(join(target, 'worker.mjs'), 'utf8') !== await workerText(spec)) throw new Error('Local speech Worker mismatch.');
    const actual = (await readdir(target, { recursive: true, withFileTypes: true })).filter(entry => !entry.isDirectory()).map(entry => join(entry.parentPath ?? entry.path, entry.name).slice(target.length + 1)).sort();
    const expected = [...spec.files.map(file => file.path), 'manifest.json', 'worker.mjs'].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Local speech asset file set mismatch.');
    let bytes = 0;
    for (const file of spec.files) {
        if (file.bytes > MAX_ASSET_BYTES) throw new Error(`Local speech asset exceeds the Cloudflare static asset limit: ${file.path}`);
        const data = await readFile(join(target, file.path)); verifyBytes(data, file); bytes += data.length;
    }
    // Validate fragment ordering and full model integrity, as the browser must do before inference.
    const decoder = Buffer.concat(await Promise.all(spec.decoder.chunks.map(file => readFile(join(target, file.path)))));
    verifyBytes(decoder, spec.decoder);
    return { files: expected.length, bytes, largest: Math.max(...spec.files.map(file => file.bytes)) };
}

import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITOR_VISION_VERSION } from '../app/veyrnox/_lib/editorVisionRuntime.mjs';
export const VISION_ASSETS = Object.freeze([
    { path: 'selfie_multiclass_256x256.tflite', source: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite', bytes: 16371837, sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0' },
    { path: 'vision_bundle.mjs', source: 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', bytes: 155439, sha256: 'd885630c297c0b20b1fe86096cb06291c4c8080876f27852e724f24ac603713f' },
    { path: 'wasm/vision_wasm_module_internal.js', source: 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js', bytes: 323415, sha256: 'da8934057f147b622e82cfb4c0dbd85461c598e268588b5a8ba9ca963a8ff82d' },
    { path: 'wasm/vision_wasm_module_internal.wasm', source: 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm', bytes: 11756972, sha256: '2dabd8e23c60984628beb7bb338764c81a08e6837145273f59578684b5d53c1b' },
    { path: 'worker.mjs', source: 'scripts/editor-vision-worker.mjs' },
    { path: 'NOTICE.txt', source: 'scripts/editor-vision-notices/NOTICE.txt' },
    { path: 'Apache-2.0.txt', source: 'scripts/editor-vision-notices/Apache-2.0.txt' },
].map(Object.freeze));
const project = fileURLToPath(new URL('../', import.meta.url));
export const visionDigest = data => createHash('sha256').update(data).digest('hex');
async function inventory(directory, prefix = '') {
    const names = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = `${prefix}${entry.name}`;
        if (entry.isDirectory()) names.push(...await inventory(join(directory, entry.name), `${path}/`));
        else if (entry.isFile()) names.push(path);
        else throw new Error(`Vision assets must be ordinary files: ${path}`);
    }
    return names.sort();
}
export function validateVisionManifest(manifest, expected) {
    if (!manifest || manifest.version !== EDITOR_VISION_VERSION || !Array.isArray(manifest.files) || manifest.files.length !== expected.length) throw new Error('The vision manifest version or file count changed.');
    for (const [index, pinned] of expected.entries()) {
        const file = manifest.files[index];
        if (!file || file.path !== pinned.path || file.source !== pinned.source || file.bytes !== pinned.bytes || file.sha256 !== pinned.sha256) throw new Error(`The vision manifest asset changed: ${pinned.path}`);
    }
}
export async function verifyVisionAssets(base) {
    const target = resolve(base, 'editor-vision', EDITOR_VISION_VERSION), manifestFile = join(target, 'manifest.json');
    const actual = await inventory(target), expected = ['manifest.json', ...VISION_ASSETS.map(file => file.path)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('The compiled vision asset paths changed.');
    if ((await stat(manifestFile)).size > 24000) throw new Error('The vision manifest exceeded its bound.');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const verified = await Promise.all(VISION_ASSETS.map(async file => {
        if (file.sha256) return file;
        const source = await readFile(join(project, file.source));
        return { ...file, bytes: source.length, sha256: visionDigest(source) };
    }));
    validateVisionManifest(manifest, verified);
    let total = 0, largest = 0;
    for (const pinned of verified) {
        const { bytes, sha256 } = pinned;
        const content = await readFile(join(target, pinned.path));
        if (content.length !== bytes || visionDigest(content) !== sha256) throw new Error(`The compiled vision asset changed: ${pinned.path}`);
        if (bytes > 25 * 1024 * 1024) throw new Error(`The vision asset exceeds the delivery bound: ${pinned.path}`);
        total += bytes; largest = Math.max(largest, bytes);
    }
    const worker = await readFile(join(target, 'worker.mjs'), 'utf8');
    if (/https?:\/\/|importScripts|unsafe-eval|console\.(?:log|error)/.test(worker) || !worker.includes("await import('./vision_bundle.mjs')") || !worker.includes('modelAssetPath: `${prefix}selfie_multiclass_256x256.tflite`')) throw new Error('The vision Worker must use only its fixed local model and runtime.');
    if (total > 32 * 1024 * 1024) throw new Error('The vision assets exceeded their total build budget.');
    return { files: VISION_ASSETS.length, bytes: total, largest };
}

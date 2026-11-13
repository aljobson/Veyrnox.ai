import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITOR_VISION_VERSION, FACE_VISION_VERSION, HAIR_VISION_VERSION } from '../app/veyrnox/_lib/editorVisionRuntime.mjs';
export const VISION_ASSETS = Object.freeze([
    { path: 'selfie_multiclass_256x256.tflite', source: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite', bytes: 16371837, sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0' },
    { path: 'vision_bundle.mjs', source: 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', bytes: 155439, sha256: 'd885630c297c0b20b1fe86096cb06291c4c8080876f27852e724f24ac603713f' },
    { path: 'wasm/vision_wasm_module_internal.js', source: 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js', bytes: 323415, sha256: 'da8934057f147b622e82cfb4c0dbd85461c598e268588b5a8ba9ca963a8ff82d' },
    { path: 'wasm/vision_wasm_module_internal.wasm', source: 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm', bytes: 11756972, sha256: '2dabd8e23c60984628beb7bb338764c81a08e6837145273f59578684b5d53c1b' },
    { path: 'worker.mjs', source: 'scripts/editor-vision-worker.mjs', bytes: 3222, sha256: '3208a143547fc9000de7f351dd56612be2cfaf2ece41eebfbeb1a4c0f0935ca0' },
    { path: 'NOTICE.txt', source: 'scripts/editor-vision-notices/NOTICE.txt', bytes: 1428, sha256: '5a910be0916d0e2753d47fd213227693d3a05e06c7c621a3cef312400a057756' },
    { path: 'Apache-2.0.txt', source: 'scripts/editor-vision-notices/Apache-2.0.txt', bytes: 12331, sha256: '8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8' },
].map(Object.freeze));
export const FACE_ASSETS = Object.freeze([
    { path: 'face_landmarker.task', source: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', bytes: 3758596, sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff' },
    ...VISION_ASSETS.filter(file => file.path === 'vision_bundle.mjs' || file.path.startsWith('wasm/') || file.path === 'Apache-2.0.txt'),
    { path: 'worker.mjs', source: 'scripts/face-landmarker-worker.mjs', bytes: 2272, sha256: '26847e8fa813fc4399b283247c40ef923661881c15dc32819cc189c743100558' },
    { path: 'NOTICE.txt', source: 'scripts/editor-vision-notices/FACE-NOTICE.txt', bytes: 852, sha256: 'e4eabd56fc0dd1841cadeb7ed461ba5ffec9e0627c5efa97d86b5c38521093cd' },
].map(Object.freeze));
export const HAIR_ASSETS = Object.freeze(VISION_ASSETS.map(file => Object.freeze(file.path === 'worker.mjs'
    ? { ...file, source: 'scripts/editor-vision-hair-worker.mjs', bytes: 3741, sha256: '9bc776a4e7fbf3dd87aae422a673f8fa68d3f2e4e477a8f399f074a3c217b503' } : file)));
// One previous segmentation protocol, its current replacement, and the current face runtime.
// Each source is the real build input; v1 retains its original source filename.
// Proposed, pending owner approval (ADR-0338). Static assets, excluding manifests.
export const VISION_COMBINED_BUDGET_BYTES = 72 * 1024 * 1024;
export const VISION_RELEASES = Object.freeze([
    { version: EDITOR_VISION_VERSION, assets: VISION_ASSETS, model: 'selfie_multiclass_256x256.tflite' },
    { version: FACE_VISION_VERSION, assets: FACE_ASSETS, model: 'face_landmarker.task' },
    { version: HAIR_VISION_VERSION, assets: HAIR_ASSETS, model: 'selfie_multiclass_256x256.tflite' },
]);
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
export function validateVisionManifest(manifest, expected, version = EDITOR_VISION_VERSION) {
    if (!manifest || manifest.version !== version || !Array.isArray(manifest.files) || manifest.files.length !== expected.length) throw new Error('The vision manifest version or file count changed.');
    for (const [index, pinned] of expected.entries()) {
        const file = manifest.files[index];
        if (!file || file.path !== pinned.path || file.source !== pinned.source || file.bytes !== pinned.bytes || file.sha256 !== pinned.sha256) throw new Error(`The vision manifest asset changed: ${pinned.path}`);
    }
}
async function verifyRelease(base, { version, assets, model }) {
    const target = resolve(base, 'editor-vision', version), manifestFile = join(target, 'manifest.json');
    const actual = await inventory(target), expected = ['manifest.json', ...assets.map(file => file.path)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('The compiled vision asset paths changed.');
    if ((await stat(manifestFile)).size > 24000) throw new Error('The vision manifest exceeded its bound.');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const verified = await Promise.all(assets.map(async file => {
        if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Unpinned vision asset: ${file.path}`);
        if (!file.source.startsWith('https:')) {
            const source = await readFile(join(project, file.source));
            if (source.length !== file.bytes || visionDigest(source) !== file.sha256) throw new Error(`The declared vision source changed: ${file.source}`);
        }
        return file;
    }));
    validateVisionManifest(manifest, verified, version);
    let total = 0, largest = 0;
    for (const pinned of verified) {
        const { bytes, sha256 } = pinned;
        const content = await readFile(join(target, pinned.path));
        if (content.length !== bytes || visionDigest(content) !== sha256) throw new Error(`The compiled vision asset changed: ${pinned.path}`);
        if (bytes > 25 * 1024 * 1024) throw new Error(`The vision asset exceeds the delivery bound: ${pinned.path}`);
        total += bytes; largest = Math.max(largest, bytes);
    }
    const worker = await readFile(join(target, 'worker.mjs'), 'utf8');
    if (/https?:\/\/|importScripts|unsafe-eval|console\.(?:log|error)/.test(worker) || !worker.includes("await import('./vision_bundle.mjs')") || !worker.includes('modelAssetPath: `${prefix}' + model + '`')) throw new Error('The vision Worker must use only its fixed local model and runtime.');
    if (total > 32 * 1024 * 1024) throw new Error('The vision assets exceeded their total build budget.');
    return { files: assets.length, bytes: total, largest };
}

export async function verifyVisionAssets(base) {
    const directory = resolve(base, 'editor-vision');
    if (!(await lstat(directory)).isDirectory()) throw new Error('Vision assets must be a real directory.');
    const versions = await readdir(directory);
    for (const version of versions) if (!(await lstat(join(directory, version))).isDirectory()) throw new Error('Vision prefixes must be real directories.');
    if (JSON.stringify(versions.sort()) !== JSON.stringify(VISION_RELEASES.map(r => r.version).sort())) throw new Error('Expected current hair/face and exactly one retained segmentation prefix.');
    const releases = await Promise.all(VISION_RELEASES.map(release => verifyRelease(base, release)));
    const bytes = releases.reduce((n, r) => n + r.bytes, 0);
    if (bytes > VISION_COMBINED_BUDGET_BYTES) throw new Error('Combined retained vision assets exceed 72 MiB.');
    return { files: releases.reduce((n, r) => n + r.files, 0), bytes, largest: Math.max(...releases.map(r => r.largest)) };
}

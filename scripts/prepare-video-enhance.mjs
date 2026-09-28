import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const target = new URL('public/video-enhance/', root);
const model = new URL('face_landmarker.task', target);
const source = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const digest = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(target, { recursive: true });
let bytes = await readFile(model).catch(() => null);
if (!bytes || hash(bytes) !== digest) {
    const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Model download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== digest) throw new Error('Model checksum mismatch');
    await writeFile(model, bytes);
}
await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm/', root), new URL('wasm/', target), { recursive: true });
console.log('Local Video Enhance assets ready. Model SHA-256 verified. No media uploaded.');

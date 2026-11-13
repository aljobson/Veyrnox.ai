import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { VISION_RELEASES, visionDigest, verifyVisionAssets } from './editor-vision-assets.mjs';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('node_modules/@mediapipe/tasks-vision/package.json', root), 'utf8'));
if (pkg.version !== '1.0.1' || pkg.license !== 'Apache-2.0') throw new Error('The pinned vision package changed.');
for (const { version, assets } of VISION_RELEASES) {
const target = new URL(`public/editor-vision/${version}/`, root);
const files = assets.map(file => ({ ...file }));
for (const item of files) {
    const destination = new URL(item.path, target); let bytes;
    if (item.source.startsWith('https:')) {
        bytes = await readFile(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
        if (!bytes && item.path === 'face_landmarker.task') bytes = await readFile(new URL('public/video-enhance/mediapipe-1.0.1-face-landmarker-1/face_landmarker.task', root)).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
        if (!bytes) { const response = await fetch(item.source, { redirect: 'error', signal: AbortSignal.timeout(60000) }); if (!response.ok || Number(response.headers.get('content-length')) > 20000000) throw new Error('The pinned segmentation model download failed.'); bytes = Buffer.from(await response.arrayBuffer()); }
    } else bytes = await readFile(new URL(item.source, root));
    const digest = visionDigest(bytes);
    if ((item.bytes && bytes.length !== item.bytes) || (item.sha256 && digest !== item.sha256)) throw new Error(`The pinned vision asset changed: ${item.path}`);
    const directory = new URL('.', destination); await mkdir(directory, { recursive: true }); await writeFile(destination, bytes);
    item.bytes = bytes.length; item.sha256 = digest;
}
await writeFile(new URL('manifest.json', target), JSON.stringify({ version, files }, null, 2) + '\n');
console.log(`Local vision runtime ${version}: ${files.reduce((n, f) => n + f.bytes, 0)} bytes verified.`);
}
await verifyVisionAssets(fileURLToPath(new URL('public/', root)));

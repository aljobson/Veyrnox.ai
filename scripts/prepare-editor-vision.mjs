import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { VISION_ASSETS, visionDigest, verifyVisionAssets } from './editor-vision-assets.mjs';
import { EDITOR_VISION_VERSION } from '../app/veyrnox/_lib/editorVisionRuntime.mjs';
const root = new URL('../', import.meta.url), target = new URL(`public/editor-vision/${EDITOR_VISION_VERSION}/`, root);
const files = VISION_ASSETS.map(file => ({ ...file }));
const pkg = JSON.parse(await readFile(new URL('node_modules/@mediapipe/tasks-vision/package.json', root), 'utf8'));
if (pkg.version !== '1.0.1' || pkg.license !== 'Apache-2.0') throw new Error('The pinned vision package changed.');
for (const item of files) {
    const destination = new URL(item.path, target); let bytes;
    if (item.source.startsWith('https:')) {
        bytes = await readFile(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
        if (!bytes) { const response = await fetch(item.source, { redirect: 'error', signal: AbortSignal.timeout(60000) }); if (!response.ok || Number(response.headers.get('content-length')) > 20000000) throw new Error('The pinned segmentation model download failed.'); bytes = Buffer.from(await response.arrayBuffer()); }
    } else bytes = await readFile(new URL(item.source, root));
    const digest = visionDigest(bytes);
    if ((item.bytes && bytes.length !== item.bytes) || (item.sha256 && digest !== item.sha256)) throw new Error(`The pinned vision asset changed: ${item.path}`);
    const directory = new URL('.', destination); await mkdir(directory, { recursive: true }); await writeFile(destination, bytes);
    item.bytes = bytes.length; item.sha256 = digest;
}
await writeFile(new URL('manifest.json', target), JSON.stringify({ version: EDITOR_VISION_VERSION, files }, null, 2) + '\n');
await verifyVisionAssets(fileURLToPath(new URL('public/', root)));
console.log(`Local vision runtime ${EDITOR_VISION_VERSION}: ${files.reduce((n, f) => n + f.bytes, 0)} bytes verified.`);

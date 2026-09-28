import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { root, inventory, verifyBytes, verifyAssets, manifestText } from './video-enhance-assets.mjs';

for (const [name, version] of Object.entries(inventory.packages)) {
    const installed = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root), 'utf8'));
    if (installed.version !== version) throw new Error(`Video Enhance package version mismatch: ${name}`);
}
const target = new URL(`public/video-enhance/${inventory.version}/`, root);
for (const file of inventory.files) {
    const destination = new URL(file.path, target);
    let bytes;
    if (file.source.startsWith('https://')) {
        bytes = await readFile(destination).catch(error => {
            if (error.code !== 'ENOENT') throw error;
            return null;
        });
        if (!bytes) {
            const response = await fetch(file.source, { signal: AbortSignal.timeout(60000) });
            if (!response.ok) throw new Error(`Model download failed (${response.status})`);
            bytes = Buffer.from(await response.arrayBuffer());
        }
    } else bytes = await readFile(new URL(file.source, root));
    verifyBytes(bytes, file);
    await mkdir(dirname(fileURLToPath(destination)), { recursive: true });
    await writeFile(destination, bytes);
}
await writeFile(new URL('manifest.json', target), manifestText());
await verifyAssets(fileURLToPath(new URL('public/', root)));
// Remove only the generated legacy paths so local caches are not shipped twice.
await rm(new URL('public/video-enhance/face_landmarker.task', root), { force: true });
await rm(new URL('public/video-enhance/wasm/', root), { recursive: true, force: true });
console.log('Video Enhance versioned model, runtime and notices verified.');

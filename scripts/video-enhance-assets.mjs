import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { VIDEO_ENHANCE_ASSET_PATH } from '../app/veyrnox/_lib/videoEnhanceAssets.mjs';

export const root = new URL('../', import.meta.url);
export const inventory = JSON.parse(await readFile(new URL('video-enhance-assets.json', import.meta.url), 'utf8'));
if (VIDEO_ENHANCE_ASSET_PATH !== `/video-enhance/${inventory.version}`) {
    throw new Error('Video Enhance client path does not match asset inventory');
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyBytes(bytes, file) {
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
        throw new Error(`Video Enhance checksum mismatch: ${file.path}`);
    }
}
export function manifestText(spec = inventory) {
    return JSON.stringify(spec, null, 2) + '\n';
}
export async function verifyAssets(base, spec = inventory) {
    const target = join(base, 'video-enhance', spec.version);
    const manifest = await readFile(join(target, 'manifest.json'), 'utf8');
    if (manifest !== manifestText(spec)) throw new Error('Video Enhance manifest mismatch');
    const actual = (await readdir(target, { recursive: true, withFileTypes: true }))
        .filter(entry => !entry.isDirectory())
        .map(entry => join(entry.parentPath ?? entry.path, entry.name).slice(target.length + 1)).sort();
    const expected = [...spec.files.map(file => file.path), 'manifest.json'].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Video Enhance asset file set mismatch');
    for (const file of spec.files) verifyBytes(await readFile(join(target, file.path)), file);
    return spec.files.length;
}

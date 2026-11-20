import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import type { Size } from '../../../../../lib/templateSwapCutout.mjs';
import type { SwapFile } from '../../../../../app/veyrnox/_lib/templateSwapClient.mjs';
export const swapDirectory = () => new Directory(Paths.cache, 'template-swap');
// A native Directory uri already ends in '/', so normalise before comparing or no real file ever matches.
export const swapDirectoryPrefix = () => swapDirectory().uri.replace(/\/?$/, '/');
export function deleteSwapFile(uri: string) {
    if (!uri.startsWith(swapDirectoryPrefix())) return;
    try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Launch cleanup retries cache reclamation. */ }
}
export function cleanOldSwapFiles(now = Date.now()) {
    try {
        const dir = swapDirectory();
        if (dir.exists) for (const file of dir.list()) if (file instanceof File && (!file.modificationTime || now - file.modificationTime > 86_400_000)) file.delete();
    } catch { /* Cache may have been removed by the OS. */ }
}
export function writeSwapPng(bytes: Uint8Array, size: Size): SwapFile {
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw Error('photo_too_large');
    const dir = swapDirectory(); dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `${randomUUID()}.png`);
    try { file.write(bytes); return { uri: file.uri, size: bytes.length, type: 'image/png', ...size }; }
    catch (error) { deleteSwapFile(file.uri); throw error; }
}

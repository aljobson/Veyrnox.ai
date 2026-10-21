import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { subscribeCacheUser } from './appCache';
import type { PickedFile } from './sources';

const folder = () => new Directory(Paths.cache, 'veyrnox-draw');
const owners = new Map<string, number>();
let swept = false;

export function isDrawFile(uri: string): boolean {
    const prefix = `${folder().uri.replace(/\/$/, '')}/`;
    const name = uri.startsWith(prefix) ? uri.slice(prefix.length) : '';
    return !!name && !/[\\/%?#]/.test(name) && name !== '.' && name !== '..';
}
export function deleteDrawFile(uri: string): void {
    if (!isDrawFile(uri)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
}
export function claimDrawFile(uri: string): void {
    if (isDrawFile(uri)) owners.set(uri, (owners.get(uri) ?? 0) + 1);
}
export function releaseDrawFile(uri: string): void {
    const count = owners.get(uri) ?? 0;
    if (count > 1) { owners.set(uri, count - 1); return; }
    owners.delete(uri);
    deleteDrawFile(uri);
}
export function sweepStaleDrawFiles(): void {
    if (swept) return;
    const dir = folder();
    if (dir.exists) for (const entry of dir.list()) {
        if (entry instanceof File && !owners.has(entry.uri)) deleteDrawFile(entry.uri);
    }
    swept = true;
}
export function clearDrawFiles(): void {
    const dir = folder();
    if (dir.exists) for (const entry of dir.list()) entry.delete();
    owners.clear();
}
export async function writeDrawing(bytes: Uint8Array): Promise<PickedFile> {
    sweepStaleDrawFiles();
    const dir = folder();
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `${Crypto.randomUUID()}.png`);
    let created = false;
    try {
        file.create();
        created = true;
        file.write(bytes);
        return { uri: file.uri, mimeType: 'image/png', size: bytes.length };
    } catch (error) {
        if (created && file.exists) file.delete();
        throw error;
    }
}
subscribeCacheUser(clearDrawFiles);

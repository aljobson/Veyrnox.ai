import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { subscribeCacheUser } from './appCache';

const folder = () => new Directory(Paths.cache, 'veyrnox-voiceover');
export function adoptTake(uri: string): string | null {
    try {
        const directory = folder(); directory.create({ intermediates: true, idempotent: true });
        const destination = new File(directory, `take-${randomUUID()}.wav`);
        new File(uri).moveSync(destination);
        return destination.uri;
    } catch { return null; }
}
export function discardTake(uri: string | null | undefined): void {
    try { if (uri) { const file = new File(uri); if (file.exists) file.delete(); } } catch { /* Cache cleanup is best effort. */ }
}
export function clearTakes(): void {
    try { const directory = folder(); if (directory.exists) directory.delete(); } catch { /* The OS may have reclaimed it. */ }
}
clearTakes();
subscribeCacheUser(clearTakes);

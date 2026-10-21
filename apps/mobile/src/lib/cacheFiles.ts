import { File, Paths } from 'expo-file-system';

// Delete only cache copies, never the person's original file.
export function discardCacheCopy(uri: string | null | undefined): void {
    if (uri?.startsWith(Paths.cache.uri)) {
        try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Already reclaimed by the OS. */ }
    }
}

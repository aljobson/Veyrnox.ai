import { Paths } from 'expo-file-system';

export const EDITOR_IMPORT_RESERVE_BYTES = 100 * 1024 * 1024;

/**
 * Keeps enough working space for the editor to copy, inspect and later export a picked file.
 * An unavailable platform estimate is treated as unknown rather than blocking every import.
 */
export function editorImportHasSpace(sizeBytes: number | null | undefined, availableBytes?: number) {
    let available = availableBytes;
    if (available === undefined) {
        try { available = Paths.availableDiskSpace; }
        catch { return true; }
    }
    if (typeof available !== 'number' || !Number.isFinite(available) || available < 0) return true;
    const source = typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0;
    return available >= source + EDITOR_IMPORT_RESERVE_BYTES;
}

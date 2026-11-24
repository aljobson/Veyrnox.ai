import { getCacheUser, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';

export type EditorServerExportResolution = '2160p' | '1080p' | '720p';
export const DEFAULT_EDITOR_SERVER_EXPORT_RESOLUTION: EditorServerExportResolution = '1080p';
const RESOLUTIONS = new Set<EditorServerExportResolution>(['2160p', '1080p', '720p']);
const key = (owner: string) => `editor.export.preferences.v1:${owner}`;

export async function readEditorExportResolution(storage: CacheStorage = userDocStorage, owner = getCacheUser()): Promise<EditorServerExportResolution> {
    if (!owner) return DEFAULT_EDITOR_SERVER_EXPORT_RESOLUTION;
    try {
        const value = JSON.parse((await storage.get(key(owner))) ?? 'null') as { owner?: unknown; resolution?: unknown } | null;
        if (value?.owner === owner && RESOLUTIONS.has(value.resolution as EditorServerExportResolution)) return value.resolution as EditorServerExportResolution;
        if (value !== null) await storage.remove(key(owner));
    } catch { /* A missing or damaged preference must not block export. */ }
    return DEFAULT_EDITOR_SERVER_EXPORT_RESOLUTION;
}

export async function writeEditorExportResolution(resolution: EditorServerExportResolution, storage: CacheStorage = userDocStorage, owner = getCacheUser(), liveOwner: () => string | undefined = getCacheUser): Promise<boolean> {
    if (!owner || !RESOLUTIONS.has(resolution)) return false;
    try {
        await storage.set(key(owner), JSON.stringify({ owner, resolution }));
        if (owner !== liveOwner()) { await storage.remove(key(owner)); return false; }
        return true;
    } catch { return false; }
}

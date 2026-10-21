import { getCacheUser, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';
import { validDocument, type ProjectDocument } from './editorBridge';

export interface EditorDraft {
    owner: string;
    projectId: string;
    baseRevision: number;
    document: ProjectDocument;
    updatedAt: number;
}
const key = (id: string) => `editor.draft.v1:${id}`;
export const removeDraft = (id: string, storage: CacheStorage = userDocStorage) => storage.remove(key(id));
export async function readDraft(id: string, storage: CacheStorage = userDocStorage): Promise<EditorDraft | null> {
    const raw = await storage.get(key(id));
    if (raw === null) return null;
    try {
        const draft = JSON.parse(raw) as EditorDraft;
        if (draft.owner && draft.owner === getCacheUser() && draft.projectId === id && Number.isSafeInteger(draft.baseRevision) && draft.baseRevision >= 0 && Number.isFinite(draft.updatedAt) && validDocument(draft.document, id)) return draft;
    } catch { /* Invalid records are removed without logging their contents. */ }
    await removeDraft(id, storage);
    return null;
}
export async function writeDraft(draft: EditorDraft, storage: CacheStorage = userDocStorage): Promise<boolean> {
    if (!draft.owner || draft.owner !== getCacheUser() || !validDocument(draft.document, draft.projectId)) return false;
    try {
        // Write directly: cache.write would swallow a full-disk error and falsely promise recovery.
        await storage.set(key(draft.projectId), JSON.stringify({ owner: draft.owner, projectId: draft.projectId,
            baseRevision: draft.baseRevision, document: draft.document, updatedAt: draft.updatedAt }));
        if (draft.owner !== getCacheUser()) { await removeDraft(draft.projectId, storage); return false; }
        return true;
    } catch { return false; }
}

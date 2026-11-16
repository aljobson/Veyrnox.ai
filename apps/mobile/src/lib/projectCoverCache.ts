import type { ApiClient } from './api';
import { getDocument } from './editorProjects';
import { coverJobId } from './projectCover';

const TTL_MS = 5 * 60_000;
const covers = new Map<string, { at: number; promise: Promise<string | null> }>();
export function clearProjectCovers(): void { covers.clear(); }
// One document read per project per few minutes, however many rows ask.
export function projectCoverFor(api: ApiClient, projectId: string): Promise<string | null> {
    const hit = covers.get(projectId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
    const promise = getDocument(api, projectId).then(head => coverJobId(head.document)).catch(() => { covers.delete(projectId); return null; });
    covers.set(projectId, { at: Date.now(), promise });
    return promise;
}

import type { ApiClient } from './api';
import { getDocument } from './editorProjects';
import { projectCover, type ProjectCover } from './projectCover';
import { subscribeProjectsChanged } from './projectsChanged';

const TTL_MS = 5 * 60_000;
const covers = new Map<string, { at: number; promise: Promise<ProjectCover | null> }>();
export function clearProjectCovers(): void { covers.clear(); }
// A cover save already emits this shared signal; invalidate before the refreshed list asks again.
subscribeProjectsChanged(clearProjectCovers);
// One document read per project per few minutes, however many rows ask.
export function projectCoverFor(api: ApiClient, projectId: string): Promise<ProjectCover | null> {
    const hit = covers.get(projectId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
    const promise = getDocument(api, projectId).then(head => projectCover(head.document)).catch(() => { covers.delete(projectId); return null; });
    covers.set(projectId, { at: Date.now(), promise });
    return promise;
}

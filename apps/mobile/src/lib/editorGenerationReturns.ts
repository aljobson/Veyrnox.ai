import { getCacheUser, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';
import { UUID } from './editorServerExportStore';
import { SEQUENCE_MAX } from './editorTimeline';

export type PendingGeneration = {
    jobId: string; kind: 'video' | 'image' | 'audio'; frame: number;
    name: string; createdAt: number; placed: boolean;
};
const key = (projectId: string) => `editor.generated.v1:${projectId}`;
const tails = new Map<string, Promise<unknown>>();
const DAY = 24 * 60 * 60 * 1000;

// Reads that prune records share the mutation queue, so they cannot overwrite an add.
function serial<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    const result = (tails.get(projectId) ?? Promise.resolve()).then(run);
    const tail = result.catch(() => undefined);
    tails.set(projectId, tail);
    void tail.then(() => { if (tails.get(projectId) === tail) tails.delete(projectId); });
    return result;
}
function itemOf(value: unknown, now: number): PendingGeneration | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as PendingGeneration;
    if (typeof item.jobId !== 'string' || !UUID.test(item.jobId) || !['video', 'image', 'audio'].includes(item.kind) ||
        !Number.isSafeInteger(item.frame) || item.frame < 0 || item.frame >= SEQUENCE_MAX || typeof item.name !== 'string' ||
        !Number.isFinite(item.createdAt) || now - item.createdAt > DAY || (item.placed !== undefined && typeof item.placed !== 'boolean')) return null;
    return { jobId: item.jobId, kind: item.kind, frame: item.frame, name: item.name.slice(0, 120), createdAt: item.createdAt, placed: item.placed === true };
}
async function write(projectId: string, items: PendingGeneration[], storage: CacheStorage, owner: string | undefined) {
    if (!owner || getCacheUser() !== owner) return;
    try {
        if (!items.length) { await storage.remove(key(projectId)); return; }
        await storage.set(key(projectId), JSON.stringify({ owner, projectId, items }));
        if (getCacheUser() !== owner) await storage.remove(key(projectId));
    } catch { /* Storage failure never exposes personal data. */ }
}
async function read(projectId: string, storage: CacheStorage, now: number, owner: string | undefined): Promise<PendingGeneration[] | null> {
    try {
        const raw = await storage.get(key(projectId));
        if (getCacheUser() !== owner || raw === null) return [];
        let record;
        try { record = JSON.parse(raw); } catch { record = null; }
        if (!owner || record?.owner !== owner || record?.projectId !== projectId || !Array.isArray(record?.items)) {
            await storage.remove(key(projectId));
            return [];
        }
        const items = (record.items as unknown[]).map(value => itemOf(value, now)).filter((item): item is PendingGeneration => item !== null);
        if (items.length !== record.items.length) await write(projectId, items, storage, owner);
        if (getCacheUser() !== owner) return [];
        return items;
    } catch { return null; }
}

export function readPending(projectId: string, storage: CacheStorage = userDocStorage, now = Date.now()): Promise<PendingGeneration[]> {
    const owner = getCacheUser();
    return serial(projectId, async () => getCacheUser() === owner ? (await read(projectId, storage, now, owner)) ?? [] : []);
}
export function addPending(projectId: string, value: Omit<PendingGeneration, 'placed'> & { placed?: boolean }, storage: CacheStorage = userDocStorage): Promise<void> {
    const owner = getCacheUser();
    return serial(projectId, async () => {
        if (!owner || getCacheUser() !== owner) return;
        const item = itemOf(value, Date.now());
        if (!item) return;
        const items = await read(projectId, storage, Date.now(), owner);
        if (!items || getCacheUser() !== owner) return;
        const existing = items.find(candidate => candidate.jobId === item.jobId);
        const next = [...items.filter(candidate => candidate.jobId !== item.jobId), { ...item, placed: existing?.placed || item.placed }]
            .sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
        await write(projectId, next, storage, owner);
    });
}
function change(projectId: string, jobId: string, placed: boolean, storage: CacheStorage, current: () => boolean): Promise<void> {
    const owner = getCacheUser();
    return serial(projectId, async () => {
        if (!owner || getCacheUser() !== owner || !current()) return;
        const items = await read(projectId, storage, Date.now(), owner);
        if (!items || getCacheUser() !== owner || !current() || !items.some(item => item.jobId === jobId)) return;
        await write(projectId, placed ? items.map(item => item.jobId === jobId ? { ...item, placed: true } : item) : items.filter(item => item.jobId !== jobId), storage, owner);
    });
}
export const removePending = (projectId: string, jobId: string, storage: CacheStorage = userDocStorage, current: () => boolean = () => true) => change(projectId, jobId, false, storage, current);
export const markPlaced = (projectId: string, jobId: string, storage: CacheStorage = userDocStorage, current: () => boolean = () => true) => change(projectId, jobId, true, storage, current);

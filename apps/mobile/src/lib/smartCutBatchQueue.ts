import { getCacheUser, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';

export const SMART_CUT_BATCH_MAX = 10;
export type SmartCutBatchState = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
export type SmartCutBatchItem = { readonly projectId: string; readonly name: string; readonly state: SmartCutBatchState; readonly error: string };
export type SmartCutBatch = { readonly version: 1; readonly id: string; readonly owner: string; readonly workspaceId: string; readonly createdAt: number; readonly updatedAt: number; readonly items: readonly SmartCutBatchItem[] };
const STATES = new Set<SmartCutBatchState>(['pending', 'active', 'completed', 'failed', 'cancelled']);
const clean = (value: unknown, max = 120) => String(value ?? '').trim().slice(0, max);
const key = (owner: string, workspaceId: string) => `smart-cut-batch:v1:${clean(owner, 80)}:${clean(workspaceId, 80)}`;
const itemsOf = (projects: readonly { id?: unknown; projectId?: unknown; name?: unknown; state?: unknown; error?: unknown }[]) => {
    const seen = new Set<string>();
    return projects.flatMap((project) => {
        const projectId = clean(project.projectId ?? project.id, 80);
        if (!projectId || seen.has(projectId)) return [];
        seen.add(projectId);
        return [{ projectId, name: clean(project.name), state: STATES.has(project.state as SmartCutBatchState) ? project.state as SmartCutBatchState : 'pending' as const, error: clean(project.error, 240) }];
    }).slice(0, SMART_CUT_BATCH_MAX);
};
export function createSmartCutBatch(owner: string, workspaceId: string, projects: readonly { id: string; name: string }[], id: string, now = Date.now()): SmartCutBatch | null {
    const items = itemsOf(projects);
    if (!clean(owner, 80) || !clean(workspaceId, 80) || !clean(id, 80) || items.length < 2) return null;
    return { version: 1, id: clean(id, 80), owner: clean(owner, 80), workspaceId: clean(workspaceId, 80), createdAt: now, updatedAt: now, items };
}
export function parseSmartCutBatch(value: unknown, owner: string, workspaceId: string): SmartCutBatch | null {
    const raw = value as Partial<SmartCutBatch> | null;
    if (!raw || raw.version !== 1 || raw.owner !== owner || raw.workspaceId !== workspaceId || !Number.isFinite(raw.createdAt) || !Number.isFinite(raw.updatedAt) || !clean(raw.id, 80)) return null;
    const items = itemsOf(Array.isArray(raw.items) ? raw.items : []);
    if (items.length < 2) return null;
    let active = false;
    return { ...raw, version: 1, id: clean(raw.id, 80), owner, workspaceId, createdAt: raw.createdAt!, updatedAt: raw.updatedAt!, items: items.map((item) => {
        if (item.state !== 'active') return item;
        if (active) return { ...item, state: 'pending' } as SmartCutBatchItem;
        active = true;
        return item;
    }) };
}
const change = (queue: SmartCutBatch, projectId: string, update: (item: SmartCutBatchItem) => SmartCutBatchItem, now = Date.now()): SmartCutBatch => ({ ...queue, updatedAt: now, items: queue.items.map((item) => item.projectId === projectId ? update(item) : item) });
export const openSmartCutBatchItem = (queue: SmartCutBatch, projectId: string, now?: number) => queue.items.some((item) => item.state === 'active' && item.projectId !== projectId) ? queue : change(queue, projectId, (item) => ['pending', 'failed'].includes(item.state) ? { ...item, state: 'active', error: '' } : item, now);
export const finishSmartCutBatchItem = (queue: SmartCutBatch, projectId: string, now?: number) => change(queue, projectId, (item) => item.state === 'active' ? { ...item, state: 'completed', error: '' } : item, now);
export const failSmartCutBatchItem = (queue: SmartCutBatch, projectId: string, error = '', now?: number) => change(queue, projectId, (item) => item.state === 'active' ? { ...item, state: 'failed', error: clean(error, 240) } : item, now);
export const retrySmartCutBatchItem = (queue: SmartCutBatch, projectId: string, now?: number) => change(queue, projectId, (item) => item.state === 'failed' ? { ...item, state: 'pending', error: '' } : item, now);
export const cancelSmartCutBatchItem = (queue: SmartCutBatch, projectId: string, now?: number) => change(queue, projectId, (item) => ['pending', 'failed'].includes(item.state) ? { ...item, state: 'cancelled', error: '' } : item, now);
export const nextSmartCutBatchItem = (queue: SmartCutBatch) => queue.items.find((item) => item.state === 'active') ?? queue.items.find((item) => item.state === 'pending') ?? null;
export const smartCutBatchDone = (queue: SmartCutBatch) => queue.items.every((item) => ['completed', 'cancelled'].includes(item.state));
export async function readSmartCutBatch(owner: string, workspaceId: string, storage: CacheStorage = userDocStorage): Promise<SmartCutBatch | null> {
    const storageKey = key(owner, workspaceId);
    if (owner !== getCacheUser()) return null;
    try {
        const raw = await storage.get(storageKey);
        if (owner !== getCacheUser()) return null;
        const parsed = raw ? parseSmartCutBatch(JSON.parse(raw), owner, workspaceId) : null;
        if (parsed) return parsed;
    } catch { /* Corrupt private state is removed below without logging project names. */ }
    if (owner === getCacheUser()) await storage.remove(storageKey).catch(() => undefined);
    return null;
}
export async function writeSmartCutBatch(queue: SmartCutBatch, storage: CacheStorage = userDocStorage): Promise<boolean> {
    if (queue.owner !== getCacheUser() || !parseSmartCutBatch(queue, queue.owner, queue.workspaceId)) return false;
    const storageKey = key(queue.owner, queue.workspaceId);
    try {
        await storage.set(storageKey, JSON.stringify(queue));
        return queue.owner === getCacheUser();
    } catch { return false; }
}
export async function removeSmartCutBatch(owner: string, workspaceId: string, storage: CacheStorage = userDocStorage): Promise<boolean> {
    if (owner !== getCacheUser()) return false;
    try { await storage.remove(key(owner, workspaceId)); return owner === getCacheUser(); }
    catch { return false; }
}

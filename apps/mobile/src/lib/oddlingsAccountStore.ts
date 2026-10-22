import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { getCacheUser, subscribeCacheUser, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';
import { cleanItem, legacyFileStore, parseDoc, type PassportDoc } from './oddlingsLibrary';
import { sanitizePicks, type Picks } from './oddlingsBuilder';
import { emptyDoc } from './oddlingsDocument';

export type Op = { kind: 'upsert' | 'remove' | 'draft'; id?: string; gen: number };
export type Orphan = { projectId: string; key: string; expected: number; body: string; createdAt: number };
export type Inflight = Orphan & { linkGen: number; ops: Op[] };
export type CreateIntent = { nonce: string; key: string; workspaceId: string; name: string; linkGenAtIntent: number; createdAt: number };
export interface OddlingsRecord {
    owner: string; projectId: string | null; linkGen: number; revision: number;
    base: PassportDoc; local: PassportDoc; ops: Op[]; gen: number; inflight: Inflight | null;
    orphans: Record<string, Orphan>; pendingCreate: CreateIntent | null; updatedAt: number;
    recoverable?: PassportDoc & { from: string; at: number }; legacyApplied?: boolean;
    rejectedBody?: string; blocked?: 'full'; notice?: 'orphanLost' | 'createFailed';
}
export const ODDLINGS_KEY = 'oddlings.v1';
const fresh = (owner: string): OddlingsRecord => ({ owner, projectId: null, linkGen: 0, revision: 0,
    base: emptyDoc(), local: emptyDoc(), ops: [], gen: 0, inflight: null, orphans: {}, pendingCreate: null, updatedAt: Date.now() });
const queues = new WeakMap<CacheStorage, Promise<unknown>>();
const listeners = new Set<() => void>();
let epoch = 0;
subscribeCacheUser(() => { epoch++; });
export const subscribeOddlings = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const sameOp = (a: Op, b: Op) => a.kind === b.kind && a.id === b.id && a.gen === b.gen;
export function applyOps(base: PassportDoc, local: PassportDoc, ops: readonly Op[]): PassportDoc {
    let items = [...base.items], draft = base.draft;
    for (const op of ops) {
        if (op.kind === 'draft') draft = local.draft;
        else {
            items = items.filter(i => i.id !== op.id);
            const item = local.items.find(i => i.id === op.id);
            if (op.kind === 'upsert' && item) items.push(item);
        }
    }
    return { items: items.sort((a, b) => b.savedAt - a.savedAt), draft };
}
export function enqueue(r: OddlingsRecord, kind: Op['kind'], id?: string): OddlingsRecord {
    const gen = r.gen + 1;
    return { ...r, gen, blocked: undefined, ops: [...r.ops.filter(o => kind === 'draft' ? o.kind !== 'draft' : o.id !== id), { kind, id, gen }] };
}
export function boundOrphans(r: OddlingsRecord, now = Date.now()): OddlingsRecord {
    const all = Object.values(r.orphans).sort((a, b) => b.createdAt - a.createdAt);
    const keep = all.filter(o => now - o.createdAt <= 30 * 86400000).slice(0, 3);
    return { ...r, orphans: Object.fromEntries(keep.map(o => [o.projectId, o])), notice: keep.length < all.length ? 'orphanLost' : r.notice };
}
// Switch atomically: the request's captured generations belong only to its old project.
export function switchLink(r: OddlingsRecord, projectId: string | null, base: PassportDoc, revision: number, bring = true): OddlingsRecord {
    if (r.inflight && projectId === r.inflight.projectId) {
        const linkGen = r.linkGen + 1;
        return { ...r, linkGen, inflight: { ...r.inflight, linkGen } };
    }
    let ops = r.ops, orphans = { ...r.orphans };
    if (r.inflight) {
        const { projectId: old, key, expected, body, createdAt } = r.inflight;
        orphans[old] = { projectId: old, key, expected, body, createdAt };
        ops = ops.filter(o => !r.inflight!.ops.some(s => sameOp(o, s)));
    }
    const bounded = boundOrphans({ ...r, orphans });
    orphans = { ...bounded.orphans };
    const resumed = projectId ? orphans[projectId] : undefined;
    if (projectId) delete orphans[projectId];
    let next: OddlingsRecord = { ...r, notice: bounded.notice, projectId, linkGen: r.linkGen + 1, base, revision, ops, orphans,
        inflight: resumed ? { ...resumed, linkGen: r.linkGen + 1, ops: [] } : null,
        rejectedBody: undefined, blocked: undefined };
    let source = r.local;
    if (r.recoverable && bring) {
        next = { ...next, ops: next.ops.filter(o => !r.recoverable!.items.some(i => i.id === o.id && base.items.some(b => b.id === i.id))) };
        const imported = r.recoverable.items.filter(i => !base.items.some(b => b.id === i.id));
        source = { items: [...source.items.filter(i => !imported.some(b => b.id === i.id)), ...imported], draft: source.draft };
        for (const i of imported) next = enqueue(next, 'upsert', i.id);
    }
    next = { ...next, local: applyOps(base, source, next.ops), recoverable: undefined };
    return boundOrphans(next);
}
export function createOddlingsStore(storage: CacheStorage = userDocStorage) {
    function serialized<T>(fn: () => Promise<T>): Promise<T> {
        const run = (queues.get(storage) ?? Promise.resolve()).catch(() => undefined).then(fn);
        queues.set(storage, run); return run;
    }
    async function readStored(): Promise<OddlingsRecord | null> {
        const raw = await storage.get(ODDLINGS_KEY);
        if (!raw) return null;
        try {
            const r = JSON.parse(raw) as OddlingsRecord;
            if (r.owner && r.owner === getCacheUser() && r.local && r.base && Array.isArray(r.ops)
                && Number.isSafeInteger(r.gen) && Number.isSafeInteger(r.linkGen)) return r;
        } catch { /* A corrupt or foreign record is never displayed. */ }
        await storage.remove(ODDLINGS_KEY); return null;
    }
    const read = () => serialized(readStored);
    function mutate(fn: (r: OddlingsRecord) => OddlingsRecord, owner = getCacheUser()): Promise<OddlingsRecord | null> {
        const started = epoch;
        return serialized(async () => {
            if (!owner || owner !== getCacheUser() || started !== epoch) return null;
            const current = await readStored();
            if (owner !== getCacheUser() || started !== epoch) return null;
            const next = { ...fn(current ?? fresh(owner)), owner, updatedAt: Date.now() };
            await storage.set(ODDLINGS_KEY, JSON.stringify(next));
            if (owner !== getCacheUser() || started !== epoch) { await storage.remove(ODDLINGS_KEY); return null; }
            listeners.forEach(f => f()); return next;
        });
    }
    return { read, mutate,
        async save(picks: Picks, now: number, id?: string | null, motionId = '', owner = getCacheUser()) {
            const item = cleanItem({ id: id || `oddling-${randomUUID()}`, savedAt: now, picks, motionId })!;
            let ok = false;
            const record = await mutate(r => {
                if (r.local.items.length >= 24 && !r.local.items.some(i => i.id === item.id)) return { ...r, blocked: 'full' };
                ok = true;
                return enqueue({ ...r, local: { ...r.local, items: [item, ...r.local.items.filter(i => i.id !== item.id)] } }, 'upsert', item.id);
            }, owner);
            return { ok: ok && !!record, item: ok && record ? item : null, record };
        },
        draft(picks: Picks, now: number, owner = getCacheUser()) { return mutate(r => {
            const clean = sanitizePicks(picks);
            if (JSON.stringify(r.local.draft?.picks) === JSON.stringify(clean)) return r;
            return enqueue({ ...r, local: { ...r.local, draft: { savedAt: now, picks: clean } } }, 'draft');
        }, owner); },
        remove(id: string, owner = getCacheUser()) { return mutate(r => enqueue({ ...r,
            local: { ...r.local, items: r.local.items.filter(i => i.id !== id) } }, 'remove', id), owner); },
    };
}
export type OddlingsStore = ReturnType<typeof createOddlingsStore>;
export const oddlingsStore = createOddlingsStore();

export const LEGACY_MARKER = 'veyrnox.oddlings.legacy.v1';
let claimQueue: Promise<unknown> = Promise.resolve();
export function claimLegacyOddlings(userId: string | null, store = oddlingsStore, file = legacyFileStore,
    secure = { get: SecureStore.getItemAsync, set: SecureStore.setItemAsync }): Promise<void> {
    const claim = claimQueue.catch(() => undefined).then(async () => {
        if (!userId) return;
        let marker: string | null;
        try { marker = await secure.get(LEGACY_MARKER); } catch { return; }
        if (marker && marker !== `claiming:${userId}`) { await file.remove().catch(() => undefined); return; }
        if (!marker) {
            if (!file.exists()) return;
            try { await secure.set(LEGACY_MARKER, `claiming:${userId}`); } catch { return; }
        }
        if (getCacheUser() !== userId) return;
        const current = await store.read();
        if (!current?.legacyApplied && file.exists()) {
            const doc = parseDoc(await file.read());
            const written = await store.mutate(r => {
                if (r.legacyApplied) return r;
                let next = r;
                for (const item of doc.items) {
                    if (r.base.items.some(i => i.id === item.id) || r.local.items.some(i => i.id === item.id) || r.ops.some(o => o.id === item.id)) continue;
                    next = enqueue({ ...next, local: { ...next.local, items: [...next.local.items, item].sort((a, b) => b.savedAt - a.savedAt) } }, 'upsert', item.id);
                }
                if (!next.local.draft && doc.draft) {
                    next = enqueue({ ...next, local: { ...next.local, draft: doc.draft } }, 'draft');
                }
                return { ...next, legacyApplied: true };
            }, userId);
            if (!written) return;
        }
        await file.remove().catch(() => undefined);
        await secure.set(LEGACY_MARKER, `done:${userId}`);
    });
    claimQueue = claim; return claim;
}

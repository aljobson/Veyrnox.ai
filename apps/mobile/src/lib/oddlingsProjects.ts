import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from './api';
import { getCacheUser, subscribeCacheUser } from './appCache';
import { createProject } from './editorProjects';
import { cleanProjectName } from './projects';
import { observe } from './network';
import { emptyDoc, fitsProject, fromServerDocument, toServerDocument } from './oddlingsDocument';
import { applyOps, boundOrphans, oddlingsStore, sameOp, switchLink, type CreateIntent, type Inflight, type OddlingsRecord, type OddlingsStore, type Orphan } from './oddlingsAccountStore';
import type { PassportDoc } from './oddlingsLibrary';

export type SyncState = 'local' | 'saved' | 'full' | 'unavailable' | 'busy' | 'rejected' | 'conflict' | 'gone' | 'other';
type Session = { running?: Promise<SyncState>; includesDraft?: boolean; state: SyncState; until: number; cancelled: boolean };
const sessions = new WeakMap<OddlingsStore, Map<string, Session>>();
const active = new Set<Session>();
subscribeCacheUser(() => { active.forEach(s => { s.cancelled = true; }); active.clear(); });
const path = (id: string) => `/api/v1/projects/${encodeURIComponent(id)}/document`;
const bound = (r: OddlingsRecord, f: { projectId: string | null; linkGen: number }) => r.projectId === f.projectId && r.linkGen === f.linkGen;
const status = (e: unknown) => e instanceof ApiError ? e.status : 503;
const draftEqual = (a: PassportDoc['draft'], b: PassportDoc['draft']) => {
    const canon = (d: PassportDoc['draft']) => d ? JSON.stringify(Object.entries(d.picks).sort(([a], [b]) => a.localeCompare(b))) : 'null';
    return canon(a) === canon(b);
};
export function createOddlingsProjects(api: ApiClient, store: OddlingsStore = oddlingsStore, now = Date.now) {
    function session(owner: string): Session {
        let map = sessions.get(store);
        if (!map) { map = new Map(); sessions.set(store, map); }
        let s = map.get(owner);
        if (!s || s.cancelled) { s = { state: 'local', until: 0, cancelled: false }; map.set(owner, s); active.add(s); }
        return s;
    }
    async function head(id: string) {
        const raw = await observe(api.request<{ revision: number; document: { project_id?: string } }>(path(id)));
        if (!Number.isSafeInteger(raw?.revision) || raw.revision < 0) throw new ApiError(503, 'invalid_response');
        const parsed = fromServerDocument(raw);
        if (parsed.kind === 'oddlings' && raw.document.project_id !== id) throw new ApiError(503, 'invalid_response');
        return { revision: raw.revision, ...parsed };
    }
    const send = (f: Orphan) => observe(api.request<{ revision: number; document: unknown }>(path(f.projectId), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': f.key }, body: f.body,
    }));
    function quiet(s: Session, e: unknown): SyncState {
        const code = status(e);
        s.state = code === 0 || code === 401 ? 'local' : code === 429 ? 'busy' : code === 400 ? 'rejected' : 'unavailable';
        s.until = s.state === 'unavailable' ? now() + 600000 : code === 429 ? now() + ((e as ApiError).retryAfterSeconds ?? 1) * 1000 : 0;
        return s.state;
    }
    async function goneOrUnavailable(owner: string, s: Session, link: { projectId: string | null; linkGen: number }): Promise<SyncState> {
        try { await observe(api.request('/api/v1/workspaces')); }
        catch (e) { return quiet(s, e); }
        await store.mutate(r => {
            if (!bound(r, link)) return r;
            // Even a missing project cannot prove a previous PUT was never committed.
            const next = switchLink(r, null, r.base, r.revision);
            return { ...next, local: r.local, recoverable: { ...r.local, from: link.projectId!, at: now() } };
        }, owner);
        return s.state = 'gone';
    }
    async function failure(owner: string, s: Session, e: unknown, link: { projectId: string | null; linkGen: number }, put: boolean): Promise<SyncState> {
        if (status(e) !== 404) return quiet(s, e);
        if (put) {
            try { await head(link.projectId!); return quiet(s, new ApiError(503, 'unavailable')); }
            catch (probe) { if (status(probe) !== 404) return quiet(s, probe); }
        }
        return goneOrUnavailable(owner, s, link);
    }
    async function acknowledge(owner: string, f: Inflight, raw: { revision: number; document: unknown }) {
        const parsed = fromServerDocument(raw);
        if (parsed.kind !== 'oddlings' || !Number.isSafeInteger(raw.revision) || raw.revision <= f.expected
            || (raw.document as { project_id?: string }).project_id !== f.projectId) throw new ApiError(503, 'invalid_response');
        await store.mutate(r => {
            if (!bound(r, f) || r.inflight?.key !== f.key) return r;
            const ops = r.ops.filter(o => !f.ops.some(sent => sameOp(o, sent)));
            const local = applyOps(parsed.doc, r.local, ops);
            // A draft not included in this request stays on the phone.
            return { ...r, base: parsed.doc, revision: raw.revision, ops, inflight: null, blocked: undefined,
                local: { ...local, draft: !f.ops.some(o => o.kind === 'draft') && r.local.draft ? r.local.draft : local.draft } };
        }, owner);
    }
    async function replayOrphans(owner: string, s: Session) {
        const r = await store.mutate(r => boundOrphans(r, now()), owner);
        for (const orphan of Object.values(r?.orphans ?? {})) {
            if (s.cancelled || owner !== getCacheUser()) return;
            let lost = false;
            try { await send(orphan); }
            catch (e) { if (![400, 409].includes(status(e))) continue; lost = true; }
            await store.mutate(current => {
                if (current.orphans[orphan.projectId]?.key !== orphan.key) return current;
                const orphans = { ...current.orphans }; delete orphans[orphan.projectId];
                return { ...current, orphans, notice: lost ? 'orphanLost' : current.notice };
            }, owner);
        }
    }
    async function replayCreate(owner: string, s: Session): Promise<boolean> {
        const intent = (await store.read())?.pendingCreate;
        if (!intent) return true;
        const finish = (projectId?: string) => store.mutate(r => {
            if (r.pendingCreate?.nonce !== intent.nonce) return r;
            const next = { ...r, pendingCreate: null };
            if (!projectId) return { ...next, notice: 'createFailed' };
            return r.linkGen === intent.linkGenAtIntent ? switchLink(next, projectId, emptyDoc(), 0) : next;
        }, owner);
        if (now() - intent.createdAt >= 86400000) { await finish(); return true; }
        try {
            const project = await createProject(api, intent.workspaceId, intent.name, intent.key);
            if (s.cancelled) return false;
            await finish(project.id); return true;
        } catch (e) {
            if (s.cancelled || (await store.read())?.pendingCreate?.nonce !== intent.nonce) return false;
            let definitive = [400, 403, 409].includes(status(e));
            if (status(e) === 404) {
                try { await observe(api.request('/api/v1/workspaces')); definitive = true; } catch { /* Ambiguous create, retain the intent. */ }
            }
            if (definitive) { await finish(); return true; }
            quiet(s, e); return false;
        }
    }
    async function run(owner: string, s: Session, includeDraft: boolean): Promise<SyncState> {
        const alive = () => !s.cancelled && owner === getCacheUser();
        if (s.until > now()) return s.state;
        if (!await replayCreate(owner, s) || !alive()) return s.state;
        await replayOrphans(owner, s);
        for (let attempt = 0; attempt < 3 && alive(); attempt++) {
            let r = await store.read();
            if (!r?.projectId) return s.state = 'local';
            let f = r.inflight;
            if (!f) {
                let remote: Awaited<ReturnType<typeof head>>;
                try { remote = await head(r.projectId); }
                catch (e) { if (!alive()) return 'local'; return failure(owner, s, e, r, false); }
                if (!alive()) return 'local';
                const link = r;
                if (remote.kind === 'other') {
                    await store.mutate(current => bound(current, link) ? { ...switchLink(current, null, current.base, current.revision), local: current.local } : current, owner);
                    return s.state = 'other';
                }
                const base = remote.kind === 'empty' ? emptyDoc() : remote.doc;
                r = await store.mutate(current => {
                    if (!bound(current, link) || current.inflight) return current;
                    let ops = current.ops;
                    if (includeDraft && draftEqual(current.local.draft, base.draft)) ops = ops.filter(o => o.kind !== 'draft');
                    const selected = ops.filter(o => includeDraft || o.kind !== 'draft');
                    const merged = applyOps(base, current.local, ops);
                    const local = { ...merged, draft: current.local.draft ?? merged.draft };
                    const next = { ...current, base, revision: remote.revision, local, ops };
                    if (!selected.length) return next;
                    const sending = applyOps(base, local, selected);
                    if (!fitsProject(sending, link.projectId!)) return { ...next, blocked: 'full' };
                    const body = JSON.stringify({ expected_revision: remote.revision, document: toServerDocument(link.projectId!, sending) });
                    if (body === current.rejectedBody) return next;
                    return { ...next, blocked: undefined, inflight: { projectId: link.projectId!, linkGen: link.linkGen,
                        key: randomUUID(), expected: remote.revision, body, ops: selected, createdAt: now() } };
                }, owner);
                if (!r || !bound(r, link)) return 'local';
                f = r.inflight;
                if (!f) return s.state = r.blocked ? 'full' : r.ops.some(o => includeDraft || o.kind !== 'draft') ? 'rejected' : 'saved';
            }
            try {
                const raw = await send(f);
                if (!alive()) return 'local';
                const current = await store.read();
                if (!current || !bound(current, f)) return 'local';
                await acknowledge(owner, f, raw);
                const acknowledged = await store.read();
                return s.state = acknowledged?.ops.some(o => includeDraft || o.kind !== 'draft') ? 'local' : 'saved';
            } catch (e) {
                if (!alive()) return 'local';
                const current = await store.read();
                if (!current || !bound(current, f)) return 'local';
                const code = status(e);
                if (code === 409 || code === 400) {
                    await store.mutate(r => bound(r, f!) && r.inflight?.key === f!.key
                        ? { ...r, inflight: null, rejectedBody: code === 400 ? f!.body : undefined } : r, owner);
                    if (code === 409) continue;
                }
                return failure(owner, s, e, f, true);
            }
        }
        return s.state = alive() ? 'conflict' : 'local';
    }
    function syncNow(includeDraft = true): Promise<SyncState> {
        const owner = getCacheUser();
        if (!owner) return Promise.resolve('local');
        const s = session(owner);
        if (s.running) return includeDraft && !s.includesDraft
            ? s.running.then(() => s.cancelled ? 'local' : syncNow(true)) : s.running;
        s.includesDraft = includeDraft;
        const running = run(owner, s, includeDraft).catch((): SyncState => s.state = 'local').finally(() => { s.running = undefined; });
        s.running = running;
        return running;
    }
    return { syncNow, head,
        reportError: (error: unknown): SyncState => { const owner = getCacheUser(); return owner ? quiet(session(owner), error) : 'local'; },
        getState: (): SyncState => { const owner = getCacheUser(); return owner ? session(owner).state : 'local'; },
        async choose(projectId: string, bring = true) {
            const owner = getCacheUser(), before = await store.read();
            const remote = await head(projectId);
            if (owner !== getCacheUser()) return 'local' as SyncState;
            if (remote.kind === 'other') return 'other' as SyncState;
            await store.mutate(r => r.linkGen === (before?.linkGen ?? 0)
                ? switchLink(r, projectId, remote.kind === 'empty' ? emptyDoc() : remote.doc, remote.revision, bring) : r, owner);
            return syncNow();
        },
        async newProject(workspaceId: string, name: string) {
            const clean = cleanProjectName(name);
            if (!clean) return 'rejected' as SyncState;
            await store.mutate(r => {
                if (r.pendingCreate) return r;
                const nonce = randomUUID();
                const pendingCreate: CreateIntent = { nonce, key: nonce, workspaceId, name: clean, linkGenAtIntent: r.linkGen, createdAt: now() };
                return { ...r, pendingCreate, notice: undefined };
            });
            return syncNow();
        },
        discardRecovery: () => store.mutate(r => {
            if (!r.recoverable) return r;
            const ops = r.ops.filter(o => o.kind === 'draft' ? !draftEqual(r.local.draft, r.recoverable!.draft)
                : !r.recoverable!.items.some(i => i.id === o.id));
            return { ...r, recoverable: undefined, base: emptyDoc(), local: applyOps(emptyDoc(), r.local, ops), ops };
        }),
        startOver: () => store.mutate(r => ({ ...r, pendingCreate: null })),
        takeNotice: async () => { let notice: OddlingsRecord['notice']; await store.mutate(r => { notice = r.notice; return { ...r, notice: undefined }; }); return notice; },
    };
}
export type OddlingsProjects = ReturnType<typeof createOddlingsProjects>;

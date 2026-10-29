import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useIsFocused, usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import type { ApiClient, ApiError } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { getDocument, putDocument } from '../../lib/editorProjects';
import { t } from '../../lib/i18n';
import { isOffline, subscribe } from '../../lib/network';
import { applyEditable, cleanBrief, documentProblem, documentStatus, isDirty, parseRestored, readEditable, REVISION_CAP, saveKeyFor, type DocumentStatus, type Editable, type Head, type Pending } from '../../lib/projectDocumentDraft';
import { fetchHistory, mergeVersions, restoreVersion, type Version } from '../../lib/projects';

// The one coordinator of every document write on the project screen (ADR-0000): autosave, Save now, the conflict
// save, restore, the save before opening the editor, and deletion. One write is in flight at a time.
export type Phase = 'idle' | 'saving' | 'restoring' | 'suspended';
export type Status = Exclude<DocumentStatus, 'dropped'> | 'too_big' | 'held' | null;
export type RestoreBlock = 'dirty' | 'unsupported' | 'revision_limit' | 'unloaded' | 'current' | null;
export type Handoff = 'go' | 'unsaved' | 'stop';
export interface Task { current(): boolean }
interface Model { head: Head | null; draft: Editable | null; status: Status; remote: Head | null; lastSavedAt: number | null; phase: Phase; loading: boolean; reviewing: boolean; dropped: boolean }
export interface DeleteLock { settled(): Promise<void>; holds(): boolean }

export const AUTOSAVE_MS = 3000;
const HELD_AFTER = 3;
const AUTOSAVE_BLOCKED = new Set<Status>(['conflict', 'unavailable', 'unsupported', 'rejected', 'too_big', 'paused', 'held', 'daily_limit', 'revision_limit']);
const SAVE_NOW_BLOCKED = new Set<Status>(['conflict', 'unavailable', 'unsupported', 'revision_limit']);
const always: Task = { current: () => true };
// No session fence: every task is refused, so nothing is sent or written (fails closed).
const refused: Task = { current: () => false };
const unfenced = () => refused;
const capped = (head: Head): Status => (head.revision >= REVISION_CAP ? 'revision_limit' : null);
const waitSeconds = (err: unknown) => Math.min(600, Math.max(1, (err as ApiError | null)?.retryAfterSeconds ?? 60));

// Every request is bound to the session that started it (ADR-0291); results are applied only while it is current.
export function useBeginTask(): () => Task {
    const auth = useAuth() as Partial<ReturnType<typeof useAuth>>;
    return auth.beginSessionTask ?? unfenced;
}

export function useProjectDocument({ api, id, onSaved, onRestored }: { api: ApiClient; id: string; onSaved(): void; onRestored(): void }) {
    const beginTask = useBeginTask();
    const focused = useIsFocused();
    const focusedRef = useRef(focused);
    focusedRef.current = focused;
    const owner = useRef(getCacheUser());
    const mounted = useRef(true);
    const stale = useRef(false);
    const flags = useRef({ writing: false, restoring: false, suspended: false, discarded: false });
    const m = useRef<Model>({ head: null, draft: null, status: null, remote: null, lastSavedAt: null, phase: 'idle', loading: true, reviewing: false, dropped: false });
    const [model, setModel] = useState(m.current);
    const inflight = useRef<Promise<void> | null>(null);
    const pending = useRef<Pending | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const strikes = useRef(0);
    const daily = useRef(false);
    const deleteToken = useRef(0);
    const restoreKeys = useRef(new Map<string, string>());
    const callbacks = useRef({ onSaved, onRestored });
    callbacks.current = { onSaved, onRestored };

    const phase = (): Phase => {
        const f = flags.current;
        return f.suspended ? 'suspended' : f.restoring ? 'restoring' : f.writing ? 'saving' : 'idle';
    };
    const owned = () => mounted.current && getCacheUser() === owner.current;
    const live = (task: Task = always) => owned() && !stale.current && task.current();
    const clear = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    };
    function commit(patch: Partial<Model>) {
        if (!owned()) return;
        m.current = { ...m.current, ...patch, phase: phase() };
        setModel(m.current);
    }
    function markStale() {
        stale.current = true;
        clear();
        commit({ dropped: true });
    }
    // True when a result must be dropped; a session that moved on also stops every later send.
    function gone(task: Task) {
        if (task === refused) { commit({ loading: false, status: 'unavailable' }); return true; }
        if (owned() && !stale.current && !task.current()) markStale();
        return !live(task);
    }
    const dirtyNow = () => {
        const { head, draft } = m.current;
        return !!head && !!draft && isDirty(head, draft);
    };
    function canAutosave(retry: boolean) {
        const status = m.current.status;
        if (!live() || !focusedRef.current || phase() !== 'idle' || daily.current || isOffline() || !dirtyNow()) return false;
        return !AUTOSAVE_BLOCKED.has(status) || (retry && status === 'paused');
    }
    function arm(delay = AUTOSAVE_MS, retry = false) {
        if (!canAutosave(retry)) return;
        clear();
        timer.current = setTimeout(() => {
            timer.current = null;
            void save(retry ? 'retry' : 'auto');
        }, delay);
    }
    function track(): () => void {
        let done!: () => void;
        inflight.current = new Promise<void>((resolve) => { done = resolve; });
        return () => {
            inflight.current = null;
            done();
        };
    }

    function fail(err: unknown, expected: number) {
        const status = documentStatus(err, expected);
        if (status === 'dropped') return markStale();
        if (status === 'paused') {
            strikes.current += 1;
            if (strikes.current >= HELD_AFTER) return commit({ status: 'held' });
            commit({ status: 'paused' });
            clear();
            timer.current = setTimeout(() => {
                timer.current = null;
                void save('retry');
            }, waitSeconds(err) * 1000);
            return;
        }
        if (status === 'daily_limit') daily.current = true;
        commit({ status });
    }

    async function write(base: Head, document: Head['document']): Promise<void> {
        const task = beginTask();
        const body = JSON.stringify({ expected_revision: base.revision, document });
        pending.current = saveKeyFor(pending.current, body);
        const key = pending.current.key;
        clear();
        flags.current.writing = true;
        const finish = track();
        commit({});
        try {
            if (gone(task)) return;
            const reply = await putDocument(api, id, base.revision, document, key);
            if (gone(task)) return;
            let next = parseRestored(reply, id, base.revision);
            if (!next) {
                const fallback = { revision: reply.revision, document };
                next = await getDocument(api, id).then((h) => (h.revision >= reply.revision ? h : fallback), () => fallback);
                if (gone(task)) return;
            }
            if (pending.current?.body === body) pending.current = null;
            strikes.current = 0;
            flags.current.writing = false;
            commit({ head: next, status: capped(next), remote: null, lastSavedAt: Date.now() });
            callbacks.current.onSaved();
        } catch (err) {
            if (gone(task)) return;
            flags.current.writing = false;
            fail(err, base.revision);
        } finally {
            flags.current.writing = false;
            finish();
            commit({});
            arm();
        }
    }

    async function save(mode: 'auto' | 'retry' | 'now' | 'handoff'): Promise<void> {
        const { head, draft, status } = m.current;
        if (!live() || !head || !draft || phase() !== 'idle') return;
        if (mode === 'auto' || mode === 'retry' ? !canAutosave(mode === 'retry') : SAVE_NOW_BLOCKED.has(status)) return;
        if (!isDirty(head, draft)) return;
        const document = applyEditable(head.document, draft);
        if (documentProblem(document)) return commit({ status: 'too_big' });
        await write(head, document);
    }

    const load = useCallback(async () => {
        const task = beginTask();
        if (task === refused) return void gone(task);
        commit({ loading: true });
        try {
            const head = await getDocument(api, id);
            if (gone(task)) return;
            const draft = readEditable(head.document);
            commit(draft ? { loading: false, head, draft, status: capped(head), remote: null } : { loading: false, head: null, draft: null, status: 'unsupported' });
        } catch (err) {
            if (gone(task)) return;
            const status = documentStatus(err, 0);
            if (status === 'dropped') return markStale();
            commit({ loading: false, head: null, draft: null, status: status === 'unsupported' || status === 'offline' ? status : 'unavailable' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, id]);

    useEffect(() => void load(), [load]);
    useEffect(() => () => {
        mounted.current = false;
        clear();
    }, []);
    useEffect(() => subscribeCacheUser(() => {
        if (getCacheUser() === owner.current) return;
        stale.current = true;
        clear();
    }), []);
    useEffect(() => {
        if (!focused) clear();
        else arm();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focused]);
    useEffect(() => subscribe(() => {
        if (isOffline() || !live()) return;
        if (!m.current.head && m.current.status === 'offline') return void load();
        if (m.current.status === 'offline') {
            commit({ status: null });
            arm(0);
        }
    }), [load]);
    useEffect(() => {
        const sub = AppState.addEventListener('change', (next) => {
            if (next === 'active' || !canAutosave(false)) return;
            clear();
            void save('auto');
        });
        return () => sub.remove();
    }, []);

    // Back from the editor: a clean draft adopts a newer head; a dirty one is reviewed, never dropped.
    useFocusEffect(useCallback(() => {
        void (async () => {
            if (!m.current.head || m.current.loading || phase() !== 'idle' || !live()) return;
            const task = beginTask();
            try {
                const latest = await getDocument(api, id);
                if (gone(task)) return;
                const cur = m.current;
                if (!cur.head || phase() !== 'idle' || latest.revision <= cur.head.revision) return;
                if (dirtyNow()) {
                    clear();
                    return commit({ status: 'conflict' });
                }
                const draft = readEditable(latest.document);
                commit(draft ? { head: latest, draft, status: capped(latest) } : { head: null, draft: null, status: 'unsupported' });
                callbacks.current.onSaved();
            } catch (err) {
                if (!gone(task) && documentStatus(err, 0) === 'dropped') markStale();
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, id]));

    const edit = (patch: Partial<Editable>) => {
        const draft = m.current.draft;
        if (!draft || flags.current.restoring || flags.current.suspended) return;
        const next = { ...draft, ...patch, brief: cleanBrief(patch.brief ?? draft.brief) };
        const status = m.current.status === 'too_big' || m.current.status === 'rejected' ? null : m.current.status;
        commit({ draft: next, status });
        arm();
    };
    const saveNow = () => { clear(); void save('now'); };

    async function reviewLatest() {
        if (m.current.reviewing || phase() !== 'idle' || !live()) return;
        const task = beginTask();
        commit({ reviewing: true });
        try {
            const remote = await getDocument(api, id);
            if (gone(task)) return;
            commit(readEditable(remote.document) ? { remote, reviewing: false } : { status: 'unsupported', reviewing: false });
        } catch (err) {
            if (gone(task)) return;
            const status = documentStatus(err, 0);
            if (status === 'dropped') return markStale();
            commit({ reviewing: false, status: status === 'unsupported' ? 'unsupported' : 'conflict' });
        }
    }
    function acceptSaved() {
        const remote = m.current.remote;
        const draft = remote && readEditable(remote.document);
        if (!remote || !draft || phase() !== 'idle') return;
        pending.current = null;
        clear();
        commit({ head: remote, draft, remote: null, status: capped(remote) });
        callbacks.current.onSaved();
    }
    async function saveDraftInstead() {
        const { remote, draft } = m.current;
        if (!remote || !draft || phase() !== 'idle' || !live()) return;
        // The remote timeline plus this screen's brief and canvas, so editor work saved elsewhere is never reverted.
        commit({ head: remote, remote: null, status: capped(remote) });
        if (capped(remote) || !isDirty(remote, draft)) return;
        const document = applyEditable(remote.document, draft);
        if (documentProblem(document)) return commit({ status: 'too_big' });
        await write(remote, document);
    }

    function restoreBlock(revision: number): RestoreBlock {
        const { head, draft, status, remote } = m.current;
        if (status === 'unsupported') return 'unsupported';
        if (status === 'revision_limit') return 'revision_limit';
        if (!head || !draft || stale.current) return 'unloaded';
        if (isDirty(head, draft) || phase() !== 'idle' || status === 'conflict' || remote) return 'dirty';
        return revision === head.revision ? 'current' : null;
    }
    async function restore(revision: number): Promise<void> {
        const head = m.current.head;
        if (restoreBlock(revision) || !head) return;
        const task = beginTask();
        const slot = `${head.revision}:${revision}`;
        const key = restoreKeys.current.get(slot) ?? randomUUID();
        restoreKeys.current.set(slot, key);
        clear();
        flags.current.restoring = true;
        const finish = track();
        commit({});
        try {
            if (gone(task)) return;
            const reply = await restoreVersion(api, id, head.revision, revision, key);
            if (gone(task)) return;
            restoreKeys.current.delete(slot);
            pending.current = null;
            strikes.current = 0;
            let next = parseRestored(reply, id, head.revision);
            if (!next) {
                try {
                    next = await getDocument(api, id);
                } catch (err) {
                    if (gone(task)) return;
                    flags.current.restoring = false;
                    commit({ head: null, draft: null, remote: null, status: documentStatus(err, 0) === 'unsupported' ? 'unsupported' : 'unavailable' });
                    return callbacks.current.onRestored();
                }
                if (gone(task)) return;
            }
            const draft = readEditable(next.document);
            flags.current.restoring = false;
            commit(draft ? { head: next, draft, remote: null, status: capped(next) } : { head: null, draft: null, remote: null, status: 'unsupported' });
            callbacks.current.onRestored();
        } catch (err) {
            if (gone(task)) return;
            const status = documentStatus(err, head.revision);
            if (status === 'dropped') return markStale();
            if (status === 'daily_limit') daily.current = true;
            flags.current.restoring = false;
            if (status === 'paused') return pauseRestore(err, revision);
            commit({ status });
        } finally {
            flags.current.restoring = false;
            finish();
            commit({});
        }
    }

    // A rate-limited restore is tried again (same key) once the pause ends; three in a row hold it like a save.
    function pauseRestore(err: unknown, revision: number) {
        if (++strikes.current >= HELD_AFTER) return commit({ status: 'held' });
        commit({ status: 'paused' });
        clear();
        timer.current = setTimeout(() => {
            timer.current = null;
            if (m.current.status !== 'paused' || !live()) return;
            commit({ status: null });
            return restoreBlock(revision) ? arm() : void restore(revision);
        }, waitSeconds(err) * 1000);
    }

    // Open in editor: save first, so the editor never loads a document missing this screen's latest edit.
    async function flushForHandoff(): Promise<Handoff> {
        let tried = false;
        for (;;) {
            if (inflight.current) {
                await inflight.current;
                continue;
            }
            if (!live()) return 'stop';
            if (!dirtyNow()) return 'go';
            if (tried || flags.current.suspended) return 'unsaved';
            tried = true;
            clear();
            await save('handoff');
        }
    }
    function dropToHead() {
        const head = m.current.head;
        const draft = head && readEditable(head.document);
        if (!draft) return;
        pending.current = null;
        clear();
        commit({ draft });
    }

    // Delete: suspends every other write at once, then waits for the one already in flight.
    function beginDelete(): DeleteLock | null {
        if (flags.current.restoring || flags.current.suspended) return null;
        flags.current.suspended = true;
        clear();
        const token = ++deleteToken.current;
        commit({});
        return {
            settled: async () => {
                while (inflight.current) await inflight.current;
            },
            holds: () => flags.current.suspended && deleteToken.current === token,
        };
    }
    function resume() {
        flags.current.suspended = false;
        commit({});
        arm();
    }

    const dirty = model.head && model.draft ? isDirty(model.head, model.draft) : false;
    const guard = !flags.current.discarded && !model.dropped && (dirty || model.phase === 'saving' || model.phase === 'restoring');
    const prevention = useRef<() => void>(() => undefined);
    prevention.current = usePreventRemove(guard, ({ repeat }) => {
        Alert.alert(t('projectDocument.latestNotSaved'), undefined, [
            { text: t('projectDocument.keepEditing'), style: 'cancel' },
            { text: t('projectDocument.leaveWithoutSaving'), style: 'destructive', onPress: () => { flags.current.discarded = true; prevention.current(); repeat(); } },
        ]);
    });
    function discard() {
        flags.current.discarded = true;
        pending.current = null;
        clear();
        prevention.current();
        const head = m.current.head;
        commit({ draft: head ? readEditable(head.document) : null });
    }

    return { ...model, dirty, live, edit, saveNow, reload: load, reviewLatest, acceptSaved, saveDraftInstead, restoreBlock, restore, flushForHandoff, dropToHead, beginDelete, resume, discard };
}
export type ProjectDocumentState = ReturnType<typeof useProjectDocument>;

// History is one {versions, next} state: a refresh commits both at once, and a page applies only against the cursor it
// paged from, so a page started before a refresh can never extend the refreshed list.
export interface History { versions: Version[]; next: number | null }
export function useProjectHistory(api: ApiClient, id: string, owned: () => boolean) {
    const hist = useRef<History | null>(null);
    const [history, setHistory] = useState<History | null>(null);
    const [failed, setFailed] = useState<'refresh' | 'page' | null>(null);
    const cursorRef = useRef<number | null>(null);
    const historySeq = useRef(0);
    const refreshing = useRef(0);
    const loadingMore = useRef(false);
    const beginTask = useBeginTask();
    const ownedRef = useRef(owned);
    ownedRef.current = owned;
    const apply = (h: History) => {
        hist.current = h;
        cursorRef.current = h.next;
        setHistory(h);
    };
    const refresh = useCallback(async (): Promise<unknown> => {
        const seq = ++historySeq.current;
        const task = beginTask();
        refreshing.current = seq;
        loadingMore.current = false;
        try {
            const h = await fetchHistory(api, id);
            if (!ownedRef.current() || !task.current() || historySeq.current !== seq) return null;
            apply({ versions: h.versions, next: h.nextBefore });
            setFailed(null);
            refreshing.current = 0;
            return null;
        } catch (err) {
            if (!ownedRef.current() || !task.current() || historySeq.current !== seq) return null;
            refreshing.current = 0;
            if (hist.current) setFailed('refresh');
            return err;
        }
    }, [api, id, beginTask]);
    async function more() {
        if (refreshing.current !== 0 || loadingMore.current || !hist.current || cursorRef.current === null) return;
        const seq = historySeq.current;
        const cursor = cursorRef.current;
        loadingMore.current = true;
        const task = beginTask();
        const current = () => ownedRef.current() && task.current() && historySeq.current === seq && cursorRef.current === cursor;
        try {
            const h = await fetchHistory(api, id, cursor);
            const cur = hist.current;
            if (!current() || !cur || cur.next !== cursor) return;
            loadingMore.current = false;
            const merged = mergeVersions(cur.versions, h.versions);
            // A page that adds nothing stops paging, even if a server ignored the cursor.
            apply({ versions: merged.versions, next: merged.added ? h.nextBefore : null });
            setFailed(null);
        } catch {
            if (!current()) return;
            loadingMore.current = false;
            setFailed('page');
        }
    }
    const retry = () => (failed === 'refresh' ? void refresh() : void more());
    return { history, failed, refresh, more, retry };
}

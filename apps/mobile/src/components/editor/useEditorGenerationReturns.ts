import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import type { ProjectDocument } from '../../lib/editorBridge';
import { markPlaced, readPending, removePending, type PendingGeneration } from '../../lib/editorGenerationReturns';
import { clampFrame, holdsClip } from '../../lib/editorInsertMedia';
import { libraryMedia, LIBRARY_STOPPED } from '../../lib/editorLibraryLength';
import { t } from '../../lib/i18n';
import { mediaApi, waitForJob } from '../../lib/media';
import { timelineOf, type Media } from '../../lib/nativeEditorModel';
import { useAnnouncement } from '../../lib/useAnnouncement';

export type InsertResult = 'placed' | 'queued' | 'track' | 'full' | 'dropped';
export type GenerationRow = PendingGeneration & { status: 'queued' | 'running' | 'notAdded' | 'removed' | 'placed' };
type Token = { valid(): boolean; end(): void };
type Options = {
    api: ApiClient; projectId: string; announce?: boolean; ready: boolean; dirty: boolean; saving: boolean; revision: number;
    currentDocument(): ProjectDocument | null; beginImport(): Token | null;
    insert(media: Media, frame: number, select?: boolean): InsertResult;
};
type Entry = { media: Media; frame: number; select: boolean; item?: PendingGeneration };

export function useEditorGenerationReturns(options: Options) {
    const latest = useRef(options); latest.current = options;
    const readyRef = useRef(options.ready); readyRef.current = options.ready;
    const [rows, setRows] = useState<GenerationRow[]>([]);
    const [note, setNote] = useState<string | null>(null);
    const [service] = useState(() => {
        let mounted = false, owner = getCacheUser(), projectId = options.projectId, generation = 0;
        let gesture = false, queue: Entry[] = [], pending: PendingGeneration[] = [];
        let refreshing: Promise<void> | null = null, refreshAgain = false, watchAgain = false;
        const notAdded = new Set<string>();
        const delivered = new Map<string, string>(), watching = new Map<string, AbortController>();
        const o = () => latest.current;
        const live = (epoch = generation) => mounted && epoch === generation && !!owner && owner === getCacheUser() && projectId === o().projectId;
        const ready = (epoch = generation) => live(epoch) && readyRef.current && o().ready && o().currentDocument()?.project_id === projectId;
        const has = (id: string) => holdsClip(timelineOf(o().currentDocument()?.timeline), `j-${id}`);
        function status(jobId: string, value: GenerationRow['status']) {
            if (!live()) return;
            if (value === 'notAdded') notAdded.add(jobId);
            if (value === 'placed') notAdded.delete(jobId);
            setRows(all => all.map(row => row.jobId === jobId ? { ...row, status: value } : row));
        }
        function stop() {
            for (const controller of watching.values()) controller.abort();
            watching.clear(); queue = [];
        }
        function clear() {
            generation++; stop(); delivered.clear(); notAdded.clear(); pending = []; gesture = false;
            refreshing = null; refreshAgain = false; watchAgain = false;
            if (mounted) { setRows([]); setNote(null); }
        }
        function placed(item: PendingGeneration, token: Token) {
            const epoch = generation;
            delivered.set(item.jobId, `j-${item.jobId}`);
            pending = pending.map(row => row.jobId === item.jobId ? { ...row, placed: true } : row);
            status(item.jobId, 'placed');
            setNote(t('editorAi.added', { name: item.name }));
            void markPlaced(projectId, item.jobId, undefined, () => ready(epoch) && token.valid());
        }
        function apply(entry: Entry): InsertResult {
            if (!ready()) return 'dropped';
            if (gesture) {
                if (!entry.item || !queue.some(value => value.item?.jobId === entry.item?.jobId)) queue.push(entry);
                return 'queued';
            }
            const token = o().beginImport();
            if (!token) return 'dropped';
            try {
                if (!ready() || !token.valid()) return 'dropped';
                const result = o().insert(entry.media, clampFrame(entry.frame), entry.select);
                if (entry.item) {
                    if (result === 'placed') placed(entry.item, token);
                    else if (result !== 'queued' && result !== 'dropped') status(entry.item.jobId, 'notAdded');
                }
                return result;
            } finally { token.end(); }
        }
        async function fetchResult(item: PendingGeneration, signal: AbortSignal, manualFrame?: number) {
            const epoch = generation;
            const current = () => ready(epoch) && !signal.aborted;
            if (!current()) return;
            const token = o().beginImport();
            if (!token) return;
            try {
                const media = await libraryMedia(o().api, item, item.kind, () => current() && token.valid());
                if (!current() || !token.valid() || media === LIBRARY_STOPPED) return;
                if (has(item.jobId)) { delivered.set(item.jobId, `j-${item.jobId}`); status(item.jobId, 'placed'); return; }
                if (manualFrame === undefined && (delivered.has(item.jobId) || item.placed)) { status(item.jobId, 'removed'); return; }
                if (!media) { status(item.jobId, 'notAdded'); return; }
                apply({ media, frame: clampFrame(manualFrame ?? item.frame), select: false, item });
            } catch { if (current() && token.valid()) status(item.jobId, 'notAdded'); }
            finally { token.end(); }
        }
        async function forget(jobId: string, current: () => boolean) {
            if (!current()) return false;
            const token = o().beginImport(); if (!token) return false;
            try {
                await removePending(projectId, jobId, undefined, () => current() && token.valid());
                return current() && token.valid();
            } finally { token.end(); }
        }
        function watch(item: PendingGeneration) {
            if (notAdded.has(item.jobId) || watching.has(item.jobId) || delivered.has(item.jobId) || item.placed || queue.some(entry => entry.item?.jobId === item.jobId)) return;
            const controller = new AbortController(), epoch = generation;
            watching.set(item.jobId, controller);
            const current = () => ready(epoch) && !controller.signal.aborted;
            void (async () => {
                try {
                    const state = await waitForJob(mediaApi(o().api), item.jobId, state => {
                        if (current() && (state === 'queued' || state === 'running')) status(item.jobId, state);
                    }, controller.signal);
                    if (!current()) return;
                    if (state === 'succeeded') await fetchResult(item, controller.signal);
                    else if (state === 'failed') {
                        const removed = await forget(item.jobId, current);
                        if (!current() || !removed) return;
                        pending = pending.filter(row => row.jobId !== item.jobId);
                        setRows(all => all.filter(row => row.jobId !== item.jobId));
                        setNote(`${item.name}: ${t('job.failed')}`);
                    }
                } catch { /* A future activation or refresh retries the durable item. */ }
                finally { if (watching.get(item.jobId) === controller) watching.delete(item.jobId); }
            })();
        }
        async function reconcile(watchPending: boolean) {
            const epoch = generation;
            if (!ready(epoch)) return;
            const items = await readPending(projectId);
            if (!ready(epoch)) return;
            pending = items;
            for (const item of items) {
                if (has(item.jobId)) delivered.set(item.jobId, `j-${item.jobId}`);
            }
            setRows(old => items.map(item => ({ ...item, status: has(item.jobId) ? 'placed' : delivered.has(item.jobId) || item.placed ? 'removed' : old.find(row => row.jobId === item.jobId)?.status ?? 'queued' })));
            // Re-read dirty/saving and the document for each acknowledgement, including after awaits.
            for (const item of items) {
                const acknowledge = () => ready(epoch) && !o().dirty && !o().saving && has(item.jobId);
                if (!acknowledge()) continue;
                const token = o().beginImport();
                if (!token) continue;
                try {
                    await removePending(projectId, item.jobId, undefined, () => acknowledge() && token.valid());
                    if (!ready(epoch) || !token.valid()) return;
                    // Storage failures are intentionally invisible; retain the row if it remains durable.
                    const remaining = await readPending(projectId);
                    if (!ready(epoch) || !token.valid()) return;
                    if (!remaining.some(row => row.jobId === item.jobId)) {
                        pending = pending.filter(row => row.jobId !== item.jobId);
                        setRows(all => all.filter(row => row.jobId !== item.jobId));
                    }
                } finally { token.end(); }
            }
            if (watchPending && ready(epoch)) for (const item of pending) watch(item);
        }
        function refresh(retry = true): Promise<void> {
            if (!ready()) return Promise.resolve();
            if (retry) { notAdded.clear(); watchAgain = true; }
            if (refreshing) { refreshAgain = true; return refreshing; }
            const epoch = generation;
            const run = (async () => {
                do { refreshAgain = false; const poll = watchAgain; watchAgain = false; await reconcile(poll); } while (ready(epoch) && refreshAgain);
            })().catch(() => undefined); // Keep durable items available for the next trigger.
            refreshing = run;
            void run.finally(() => { if (refreshing === run) refreshing = null; });
            return run;
        }
        return {
            isCurrent: live, refresh,
            place: (media: Media, frame: number, select = false) => apply({ media, frame: clampFrame(frame), select }),
            gestureActive(active: boolean) {
                gesture = active;
                if (active) return;
                const entries = queue; queue = [];
                for (const entry of entries) apply(entry);
            },
            async addAtPlayhead(jobId: string, frame: number) {
                if (!ready()) return;
                watching.get(jobId)?.abort(); watching.delete(jobId);
                const item = pending.find(row => row.jobId === jobId);
                if (!item) return;
                const controller = new AbortController(); watching.set(jobId, controller);
                try { await fetchResult(item, controller.signal, clampFrame(frame)); }
                finally { if (watching.get(jobId) === controller) watching.delete(jobId); }
            },
            async dismiss(jobId: string) {
                const epoch = generation;
                if (!ready(epoch)) return;
                watching.get(jobId)?.abort(); watching.delete(jobId);
                queue = queue.filter(entry => entry.item?.jobId !== jobId);
                const removed = await forget(jobId, () => ready(epoch));
                if (!ready(epoch) || !removed) return;
                notAdded.delete(jobId);
                await refresh(false);
            },
            pause() { generation++; stop(); notAdded.clear(); refreshing = null; refreshAgain = false; watchAgain = false; },
            attach() {
                mounted = true; owner = getCacheUser(); projectId = o().projectId; setRows([]); setNote(null);
                const unsubscribe = subscribeCacheUser(() => { clear(); owner = getCacheUser(); });
                const app = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
                return () => { mounted = false; clear(); unsubscribe(); app.remove(); };
            },
        };
    });
    const document = options.currentDocument();
    useEffect(() => service.attach(), [service, options.projectId]);
    useEffect(() => { if (options.ready) void service.refresh(); else service.pause(); }, [service, options.ready]);
    useEffect(() => { if (options.ready) void service.refresh(false); }, [service, document, options.dirty, options.saving, options.revision, options.ready]);
    useAnnouncement(options.announce === false ? null : note);
    return { ...service, rows: service.isCurrent() ? rows : [], note: service.isCurrent() ? note : null };
}

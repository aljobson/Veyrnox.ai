import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { isOffline, subscribe } from '../networkState';
import type { BeatStore } from '../beatNative/store';
import type { BeatDoc, Edit } from '../beatNative/doc';
import { documentFiles, beatFile } from '../beatNative/persist';
import { t } from '../i18n';
import { placedAlready, placeAiResults } from './shared';
import { loadResults, type AssetMetadataPort } from './results';
import { ReceiptRequest, type Receipt, type RequestOptions } from './request';
import type { AiDoc, Pending } from './types';
export function createPartRequest(options: Omit<RequestOptions<Pending>, 'finish'> & {
    port: AssetMetadataPort; signal: AbortSignal; store: BeatStore;
    apply(edit: Edit, label?: string): boolean;
    savedDoc?: () => Promise<AiDoc | undefined>;
}) {
    return new ReceiptRequest<Pending>({ ...options, async finish(row, status) {
        const check = () => options.current() && !options.signal.aborted;
        const doc = options.store.getBeat(options.beatId) as AiDoc | undefined;
        if (!doc) throw new Error('missing_beat');
        const loaded = await loadResults(row, status, doc, options.port, options.signal);
        if (!check()) return { keep: row, noticeKey: '' };
        if (loaded.results.length) {
            if (!options.apply(d => placeAiResults(d as unknown as AiDoc, row, loaded.results) as unknown as BeatDoc, t(`beatAi.${row.op}`))) throw new Error('placement_refused');
            const placed = options.store.getBeat(options.beatId) as AiDoc;
            await options.store.flushBeat(options.beatId);
            if (!check()) return { keep: row, noticeKey: '' };
            const saved = options.savedDoc ? await options.savedDoc() : await documentFiles().read(beatFile(options.beatId)).then(raw => raw ? JSON.parse(raw).doc as AiDoc : undefined);
            if (!check()) return { keep: row, noticeKey: '' };
            if (!saved || options.store.getBeat(options.beatId) !== placed || !loaded.results.every(r => placedAlready(saved, row, r.ordinal))) throw new Error('placement_not_saved');
        }
        return { noticeKey: loaded.results.length ? 'beatAi.placed' : '', messages: loaded.messages };
    } });
}
export function useBeatAiRequest<R extends Receipt>(request: ReceiptRequest<R>) {
    const view = useSyncExternalStore(request.subscribe, request.snapshot, request.snapshot);
    const offline = useSyncExternalStore(subscribe, isOffline, isOffline);
    const [active, setActive] = useState(AppState.currentState === 'active');
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => { const sub = AppState.addEventListener('change', s => setActive(s === 'active')); return () => sub.remove(); }, []);
    useEffect(() => { if (active) request.clearError(); }, [active, request]);
    useEffect(() => { if (!offline) request.clearError(); }, [offline, request]);
    useEffect(() => {
        // An accepted GET can also detect network recovery after a status-0 failure.
        if (!active || !view.open || !view.record?.requestId || view.terminal || view.pollRefused) return;
        const timer = setInterval(() => { void request.check(); }, 1500);
        return () => clearInterval(timer);
    }, [active, view.open, view.record?.requestId, view.terminal, view.pollRefused, request]);
    useEffect(() => {
        if (!view.record || view.terminal) return;
        const created = view.record.createdAt;
        const timer = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - created) / 1000))), 1000);
        return () => clearInterval(timer);
    }, [view.record, view.terminal]);
    return { ...view, elapsed, offline };
}

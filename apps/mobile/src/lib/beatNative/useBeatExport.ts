import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { isOffline, subscribe } from '../networkState';
import { t } from '../i18n';
import { useAnnouncement } from '../useAnnouncement';
import type { BeatDoc } from './doc';
import { loadNativeOfflineContext, OfflineUnavailable, withWindowOfflineContext } from './nativeContext';
import { ExportFailure, renderNativeExport } from './exportRender';
import { shareBeatExport, sweepBeatExports } from './exportFiles';
import { checkMixdownOwner, checkMixdownTask, createMixdownSaver, mixdownCode, mixdownErrorKey, ownedByOther, preflightMixdownSave, probeMixdownSave, recordOwner, type MixdownProbe, type MixdownTask, type SavedMixdown } from './mixdownSave';
import type { ExportOptions } from './exportShared';
import { replacementUnderway } from './recordingFinalizers';
import { beatStore } from './store';

export type ExportState = 'opening' | 'ready' | 'unavailable' | 'rendering' | 'sharing' | 'shared' | 'saving' | 'saved' | 'error';
const savePhaseKeys = { reserve: 'beatExport.reserve', upload: 'beatExport.upload', commit: 'beatExport.commit' } as const;
export function exportError(error: unknown): string {
    if (error instanceof Error && error.message === 'recording_not_preserved') return t('beatExport.takeNotPreserved');
    if (error instanceof OfflineUnavailable) return t('beatExport.unavailable');
    if (error instanceof ExportFailure) return t(error.key, error.params);
    const code = (error as { displayCode?: string })?.displayCode;
    return t(({ 'recovery-r51': 'beatExport.phone', 'too-much-audio': 'beatExport.audioLimit', 'song-too-large-browser': 'beatExport.audioLimit',
        'cycle-off': 'beatExport.cycleHint', 'export-limit': 'beatExport.durationLimit' } as Record<string, string>)[code ?? ''] ?? 'beatExport.renderError');
}
export function useBeatExport(doc: BeatDoc, prepare: () => Promise<void>, recording: boolean, replacing = false) {
    const { api, generation, beginSessionTask } = useAuth();
    const offline = useSyncExternalStore(subscribe, isOffline, isOffline);
    const [state, setState] = useState<ExportState>('opening');
    const [probe, setProbe] = useState<MixdownProbe>('opening');
    const [message, setMessage] = useState('');
    const [compressor, setCompressor] = useState(false);
    const [saved, setSaved] = useState<SavedMixdown | null>(null);
    const [failedAction, setFailedAction] = useState<'share' | 'save' | null>(null);
    const [percent, setPercent] = useState(0);
    const alive = useRef(false), running = useRef(false);
    const savedSelection = useRef<string | null>(null);
    const seenGeneration = useRef(generation);
    const request = useRef<AbortController | null>(null), probing = useRef<AbortController | null>(null);
    const saver = useMemo(() => createMixdownSaver(api), [api]);
    useAnnouncement(message, { everywhere: true });
    const busy = ['rendering', 'sharing', 'saving'].includes(state);
    const beatOwner = () => recordOwner(beatStore.getRecord(doc.id));
    const viewer = beginSessionTask().user;
    const foreign = !!viewer && ownedByOther(beatOwner(), viewer); // Signed out shows the sign-in message instead.
    const savedGaps = useRef(false);
    useEffect(() => {
        alive.current = true;
        sweepBeatExports();
        const controller = new AbortController();
        void withWindowOfflineContext(loadNativeOfflineContext(), { gaps: [], latencyHint: 'offline' }, async make => { make(1, 1, 48000); })
            .then(() => { if (!controller.signal.aborted) setState('ready'); })
            .catch(() => { if (!controller.signal.aborted) setState('unavailable'); });
        return () => { alive.current = false; controller.abort(); request.current?.abort(); probing.current?.abort(); saver.drop(); };
    }, [saver]);
    async function retryProbe() {
        probing.current?.abort();
        const controller = new AbortController(); probing.current = controller;
        const session = beginSessionTask();
        const task: MixdownTask = { ...session, signal: controller.signal, current: () => alive.current && session.current() };
        setProbe('opening');
        const result = await probeMixdownSave(api, task);
        if (alive.current && !controller.signal.aborted) setProbe(result);
    }
    useEffect(() => {
        request.current?.abort(); saver.drop();
        if (seenGeneration.current !== generation) {
            seenGeneration.current = generation;
            savedSelection.current = null;
            setMessage(t('beatExport.signIn')); setSaved(null); setCompressor(false);
            if (!running.current) setState(value => value === 'unavailable' ? value : 'error');
        }
        void retryProbe();
        return () => { request.current?.abort(); probing.current?.abort(); saver.drop(); };
        // The AuthProvider generation invalidates even a same-owner replacement session.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generation, api]);
    function resetSaved() {
        if (running.current) return;
        savedSelection.current = null;
        setSaved(null); setMessage(''); setCompressor(false); setFailedAction(null);
        setState(value => value === 'opening' || value === 'unavailable' ? value : 'ready');
    }
    async function run(options: ExportOptions, save?: { title: string; rights: boolean }) {
        const selection = save ? JSON.stringify([options.range, save.title.normalize('NFKC').trim()]) : null;
        if (running.current || recording || replacing || state === 'opening' || state === 'unavailable' || (save && (offline || probe !== 'on' || savedSelection.current === selection))) return;
        running.current = true;
        const controller = new AbortController(); request.current = controller;
        const session = save ? beginSessionTask() : null;
        const current = () => alive.current && !controller.signal.aborted && (!session || session.current());
        const task = session ? { ...session, signal: controller.signal, current } : null;
        saver.releaseStale(doc);
        setCompressor(false); setMessage(''); setPercent(0); setFailedAction(null); setState('rendering');
        let gaps = false;
        const progress = (seconds: number, total: number) => {
            if (!current()) return;
            setState('rendering'); setPercent(total ? Math.round(seconds / total * 100) : 0);
            setMessage(t('beatExport.progress', { seconds: seconds.toFixed(1), total: total.toFixed(1) }));
        };
        const render = async (consume: Parameters<typeof renderNativeExport>[2], settings = options) => {
            await renderNativeExport(doc, settings, async result => {
                gaps ||= result.report.gaps.includes('dynamicsCompressor');
                await consume(result);
            }, { current, progress, retainedBytes: saver.retainedBytes });
        };
        try {
            if (task) checkMixdownTask(task);
            if (task) checkMixdownOwner(beatOwner(), task.user);
            if (save) preflightMixdownSave(doc, options.range);
            if (replacementUnderway(doc.id)) throw new ExportFailure('beatTakes.replacing');
            await prepare();
            if (replacementUnderway(doc.id)) throw new ExportFailure('beatTakes.replacing');
            if (!current()) throw new ExportFailure('beatExport.signIn');
            if (save && task) {
                const result = await saver.save({ doc, range: options.range, ...save, task, owner: beatOwner,
                    render: async () => {
                        let bytes: ArrayBuffer | undefined;
                        savedGaps.current = false;
                        await render(async result => { bytes = result.bytes; }, { ...options, kind: 'song', output: 'mix', bitDepth: 16 });
                        if (!bytes) throw new ExportFailure('beatExport.empty');
                        savedGaps.current = gaps;
                        return bytes;
                    },
                    progress: (phase, value) => { if (current()) { setState('saving'); setPercent(value ?? 0); setMessage(t(savePhaseKeys[phase], { percent: value ?? 0 })); } },
                });
                checkMixdownTask(task);
                gaps ||= savedGaps.current; savedGaps.current = false;
                const title = save.title.normalize('NFKC').trim();
                savedSelection.current = selection;
                setSaved(result); setState('saved'); setMessage(t('beatExport.saved', { title }));
            } else {
                await render(async result => {
                    if (!current()) return;
                    setState('sharing'); setMessage(t('beatExport.sharing'));
                    await shareBeatExport(result.bytes, result.filename, current);
                });
                if (!current()) throw new ExportFailure('beatExport.signIn');
                setState('shared'); setMessage(t('beatExport.shared'));
            }
            if (current()) setCompressor(gaps);
        } catch (error) {
            if (alive.current) {
                if (save && mixdownCode(error) === 'beat_library_save_unavailable') setProbe('off');
                setFailedAction(save ? 'save' : 'share');
                setState(error instanceof OfflineUnavailable ? 'unavailable' : 'error');
                setMessage(!current() ? t('beatExport.signIn') : error instanceof ExportFailure || error instanceof OfflineUnavailable || (error instanceof Error && error.message === 'recording_not_preserved') || (error as { displayCode?: string })?.displayCode
                    ? exportError(error) : save ? t(mixdownErrorKey(error)) : exportError(error));
            }
        } finally { running.current = false; if (request.current === controller) request.current = null; }
    }
    return { state, probe, foreign, message, compressor, saved, failedAction, busy, percent, offline, retryProbe, resetSaved, run };
}

import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { ApiClient } from '../../lib/api';
import { ApiError } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { documentIdentity, type ProjectDocument } from '../../lib/editorBridge';
import { editorDeviceMedia } from '../../lib/editorDeviceMedia';
import { createExportStore, type ExportRecord, type ExportBody } from '../../lib/editorServerExportStore';
import { exportCopy, exportDurations, exportError, exportLabel, exportUnavailable, freezeExport, isGateRefusal, JSON_HEADERS, rememberExportUnavailable, remapExport, RENDER_PATH, retiredAttempt, renderStatus, sendExportAttempt, uncertainAttempt, type RenderReply, type Blocked } from '../../lib/editorServerExport';
import { uploadExportFiles, type ExportFile, type UploadedFile } from '../../lib/editorServerExportUploads';
import { requireOnline } from '../../lib/network';
import { publishBalance } from '../../lib/balanceEvents';
import { fetchFileLink } from '../../lib/libraryFiles';
import { shareOutput } from '../../lib/output';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';

export type ExportRouter = { push(path: never): void };
export type ServerExportProps = {
    api: ApiClient; router: ExportRouter; now?: () => number; projectId: string; name: string; document: ProjectDocument;
    dirty: boolean; visible: boolean; onOpen(): void; onClose(): void; onFallback(): void;
};
type Phase = 'idle' | 'preparing' | 'quoted' | 'uploading' | 'sending' | 'rendering' | 'done' | 'failed' | 'error';
type Quote = { credits: number; seconds: number; resolution: ExportBody['resolution']; max_seconds: number };
type Snapshot = { document: ProjectDocument; resolution: ExportBody['resolution']; label: string };
export function useServerExport(props: ServerExportProps) {
    const { api, router, projectId, document, dirty, visible, now = Date.now } = props;
    const latest = useRef(props); latest.current = props;
    const [phase, setPhase] = useState<Phase>('idle');
    const [message, setMessage] = useState<string | null>(null);
    const [resolution, setResolution] = useState<ExportBody['resolution']>('1080p');
    const [limits, setLimits] = useState<Partial<Record<ExportBody['resolution'], number>>>({});
    const [quote, setQuote] = useState<Quote | null>(null);
    const [blocked, setBlocked] = useState<Blocked[]>([]);
    const [files, setFiles] = useState<ExportFile[]>([]);
    const [job, setJob] = useState<ReturnType<typeof renderStatus> | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const [needsCredits, setNeedsCredits] = useState(false);
    const [progress, setProgress] = useState(0);
    const [appActive, setAppActive] = useState(AppState.currentState === 'active');
    const [pollTrigger, setPollTrigger] = useState(0);
    const attempt = useRef<ExportRecord | null>(null);
    const snapshot = useRef<Snapshot | null>(null);
    const identity = useRef('');
    const owner = useRef(getCacheUser());
    const mounted = useRef(true);
    const generation = useRef(0);
    const busy = useRef(false);
    const activeFile = useRef<AbortController | null>(null);
    const uploads = useRef(new Map<string, UploadedFile>());
    const store = useRef(createExportStore(undefined, getCacheUser, now)).current;
    const current = () => mounted.current && owner.current === getCacheUser() && !!owner.current;
    const announcement = message ?? t(`editorServerExport.${phase === 'idle' || phase === 'quoted' ? 'title' : phase}` as Parameters<typeof t>[0]);
    useAnnouncement(visible ? announcement : null);
    const fail = (error: unknown) => {
        if (!current()) return;
        setNeedsCredits((error as ApiError).status === 402);
        setMessage(exportError(error, uploads.current.size > 0)); setPhase('error');
    };
    async function balance() {
        try { const result = await api.getBalance(); if (current()) publishBalance(owner.current!, result.balance); } catch { /* A balance refresh cannot undo an accepted render. */ }
    }
    async function accept(reply: RenderReply) {
        if (!current()) return;
        const status = renderStatus(reply);
        if (!status.jobId) throw new ApiError(0, 'unreadable_response');
        if (attempt.current) {
            attempt.current = freezeExport({ ...attempt.current, jobId: status.jobId });
            await store.write(attempt.current).catch(() => {}); // The durable mid-send record can still replay this accepted job.
        }
        if (!current()) return;
        setJob(status); setPhase(status.phase); setMessage(null); setUnavailable(false);
    }
    async function send(record: ExportRecord, recovery = false) {
        try {
            const reply = await sendExportAttempt(api, record, current, recovery ? 0 : 1);
            await accept(reply); await balance();
        } catch (error) {
            if (!current()) return;
            if (retiredAttempt(error) || (!uncertainAttempt(error) && !(error instanceof Error && error.name === 'OfflineError'))) {
                await store.remove(record); attempt.current = null;
            }
            fail(error);
            if ((error as ApiError).status === 403 && (error as ApiError).code === 'editor_render_media_not_owned') uploads.current.clear();
        }
    }
    useEffect(() => {
        mounted.current = true;
        let cancelled = false;
        const unsubscribe = subscribeCacheUser(() => {
            generation.current++; activeFile.current?.abort(); uploads.current.clear(); snapshot.current = null; attempt.current = null;
            latest.current.onClose(); setPhase('idle'); setJob(null); setQuote(null); setMessage(null);
        });
        const subscription = AppState.addEventListener('change', state => setAppActive(state === 'active'));
        void store.read(projectId).then(async record => {
            if (cancelled || !record || !current()) return;
            generation.current++; attempt.current = freezeExport(record); latest.current.onOpen();
            if (record.jobId) { setJob({ jobId: record.jobId, renderId: null, phase: 'rendering', refunded: false }); setPhase('rendering'); }
            else { setPhase('sending'); busy.current = true; await send(record, true); busy.current = false; }
        }).catch(fail);
        return () => { cancelled = true; mounted.current = false; generation.current++; activeFile.current?.abort(); unsubscribe(); subscription.remove(); };
        // The sheet belongs to this project and owner for its entire mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, api, store]);
    async function prepare(selected = resolution) {
        if (busy.current || attempt.current || !current()) return;
        const token = ++generation.current;
        const live = () => current() && token === generation.current;
        setPhase('preparing'); setMessage(null); setQuote(null); setBlocked([]); setNeedsCredits(false);
        try {
            requireOnline();
            if (exportUnavailable()) { latest.current.onClose(); latest.current.onFallback(); return; }
            if (latest.current.dirty) throw new ApiError(400, 'save_first');
            const saved = JSON.parse(JSON.stringify(latest.current.document)) as ProjectDocument;
            const savedIdentity = documentIdentity(saved);
            const local = await editorDeviceMedia.files(projectId);
            const durations = await exportDurations(api, saved, local);
            if (!live()) return;
            const copy = exportCopy(saved, local, durations);
            setFiles(copy.uploads); setBlocked(copy.blocked);
            if (copy.blocked.length) { setPhase('error'); return; }
            snapshot.current = freezeExport({ document: copy.document, resolution: selected, label: exportLabel(latest.current.name) });
            identity.current = savedIdentity;
            const response = await api.request<Quote>(`${RENDER_PATH}/quote`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ document: copy.document, resolution: selected }) });
            if (!live()) return;
            if (response.resolution !== selected || !Number.isSafeInteger(response.credits) || response.credits < 1 || !Number.isFinite(response.max_seconds) || response.max_seconds <= 0) throw new ApiError(400, 'invalid_quote');
            if (latest.current.dirty || documentIdentity(latest.current.document) !== savedIdentity) throw new ApiError(400, 'quote_changed');
            setQuote(response); setLimits(old => ({ ...old, [selected]: response.max_seconds })); setPhase('quoted');
            const other = selected === '1080p' ? '720p' : '1080p';
            // Limits are server data too. Failure of this optional alternative never invalidates the selected quote.
            void api.request<Quote>(`${RENDER_PATH}/quote`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ document: copy.document, resolution: other }) }).then(result => {
                if (live() && result.resolution === other && Number.isFinite(result.max_seconds) && result.max_seconds > 0) setLimits(old => ({ ...old, [other]: result.max_seconds }));
            }).catch(() => {});
        } catch (error) {
            if (!live()) return;
            if (isGateRefusal(error)) { rememberExportUnavailable(); latest.current.onClose(); latest.current.onFallback(); }
            else fail(error);
        }
    }
    useEffect(() => {
        if (visible && phase === 'idle') void prepare();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, phase]);
    useEffect(() => {
        if (!attempt.current && snapshot.current && (dirty || documentIdentity(document) !== identity.current)) {
            generation.current++; activeFile.current?.abort(); snapshot.current = null; setQuote(null);
            setMessage(t('editorServerExport.changed')); setPhase('error');
        }
    }, [dirty, document]);
    async function confirm() {
        if (busy.current || !quote || !snapshot.current || !current()) return;
        if (latest.current.dirty || documentIdentity(latest.current.document) !== identity.current) { setQuote(null); setMessage(t('editorServerExport.changed')); setPhase('error'); return; }
        busy.current = true;
        const token = generation.current, frozen = snapshot.current, credits = quote.credits;
        const controller = new AbortController(); activeFile.current = controller;
        try {
            requireOnline(); setPhase('uploading'); setMessage(null);
            const mapping = await uploadExportFiles(api, files, uploads.current, controller.signal, now, undefined, (_id, fraction) => { if (current()) setProgress(fraction); });
            if (!current() || token !== generation.current || controller.signal.aborted) return;
            if (latest.current.dirty || documentIdentity(latest.current.document) !== identity.current) throw new ApiError(400, 'quote_changed');
            requireOnline();
            const record = freezeExport({ owner: owner.current!, projectId, key: randomUUID(), body: { ...frozen, document: remapExport(frozen.document, mapping), quoted_credits: credits }, credits, sentAt: now() });
            await store.write(record); // Durable before the first possible paid send.
            if (!current()) return;
            attempt.current = record; setPhase('sending'); await send(record);
        } catch (error) { fail(error); }
        finally { busy.current = false; activeFile.current = null; }
    }
    useEffect(() => {
        if (!job?.jobId || job.phase !== 'rendering' || !appActive || unavailable || !visible) return;
        let stopped = false, polls = 0, failures = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const poll = async () => {
            try {
                const reply = await api.request<RenderReply>(`${RENDER_PATH}?job_id=${encodeURIComponent(job.jobId!)}`, { headers: JSON_HEADERS });
                if (stopped || !current()) return;
                failures = 0;
                const status = renderStatus(reply);
                if (status.jobId !== job.jobId) throw new ApiError(0, 'unreadable_response');
                setJob(status); setPhase(status.phase);
                if (status.phase !== 'rendering') return;
            } catch (error) {
                if (stopped || !current()) return;
                if ([403, 404].includes((error as ApiError).status) || ++failures >= 5) { setUnavailable(true); setMessage(t('editorServerExport.checkAgain')); return; }
            }
            timer = setTimeout(poll, Math.min(10000, 3000 + 1000 * polls++));
        };
        void poll();
        return () => { stopped = true; if (timer) clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, job?.jobId, job?.phase, appActive, unavailable, visible, pollTrigger]);
    useEffect(() => {
        if (visible && (phase === 'done' || phase === 'failed') && attempt.current) {
            const record = attempt.current; attempt.current = null; void store.remove(record).catch(() => {}); void balance();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, visible, store]);
    async function cancel() {
        if (phase === 'uploading') { activeFile.current?.abort(); return; }
        if (!job?.jobId || busy.current || !current()) return;
        busy.current = true;
        try {
            const reply = await api.request<RenderReply>(`${RENDER_PATH}?job_id=${encodeURIComponent(job.jobId)}`, { method: 'DELETE', headers: JSON_HEADERS });
            if (!current()) return;
            const status = renderStatus(reply);
            if (status.jobId !== job.jobId) throw new ApiError(0, 'unreadable_response');
            setJob(status); setPhase(status.phase); setMessage(null);
        } catch (error) {
            if ((error as ApiError).status === 409 && (error as ApiError).code === 'job_finished') { setUnavailable(false); setPollTrigger(n => n + 1); }
            else if (current()) setMessage(exportError(error));
        } finally { busy.current = false; }
    }
    async function retry() {
        if (busy.current) return;
        if (attempt.current && !attempt.current.jobId) { busy.current = true; setPhase('sending'); await send(attempt.current, true); busy.current = false; }
        else if (job?.phase === 'rendering') { setMessage(null); setUnavailable(false); setPollTrigger(n => n + 1); }
        else await prepare();
    }
    async function share() {
        if (!job?.renderId || !current()) return;
        try { const link = await fetchFileLink(api, 'renders', job.renderId); if (!link) throw new ApiError(404, 'missing'); if (current()) await shareOutput(link.url, job.renderId, link.mimeType); }
        catch (error) { if (current()) setMessage(exportError(error)); }
    }
    function close() { generation.current++; activeFile.current?.abort(); if (!attempt.current && (!job || job.phase !== 'rendering')) { setPhase('idle'); setQuote(null); setJob(null); snapshot.current = null; } latest.current.onClose(); }
    function choose(value: ExportBody['resolution']) { if (busy.current || attempt.current) return; setResolution(value); void prepare(value); }
    return { phase, message, resolution, limits, quote, blocked, files, job, unavailable, needsCredits, progress, credits: attempt.current?.credits ?? quote?.credits ?? 0,
        confirm, cancel, retry, share, close, choose, publish: () => router.push({ pathname: '/publish/compose', params: { jobId: job?.jobId } } as never), library: () => router.push('/library/files' as never), buyCredits: () => router.push('/credits' as never),
        fallback: () => { close(); latest.current.onFallback(); } };
}

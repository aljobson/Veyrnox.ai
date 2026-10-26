'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged } from '../../_lib/gateway';
import { accountBoundCall } from '../../_lib/editorDelivery.mjs';
import { documentForTimeline } from '../../_lib/editorProject.mjs';
import { SERVER_RENDER_PATH, serverRenderVisible, serverRenderDisabled, renderSnapshot, snapshotIdentity,
    quoteRequest, renderAttempt, sendRenderAttempt, renderStatus, terminalRender, renderPollDelay, renderPollOutcome, retryRenderTransport,
    renderError, renderFeature, renderLibraryHref, renderDownloadPath } from '../../_lib/editorServerRenderClient.mjs';
import { exportDocument, localRenderFiles, pendingRenderFiles, uploadRenderFiles, uploadedRenderAttempt } from '../../_lib/editorServerRenderUploads.mjs';
import { ConfirmDialog } from '../ConfirmDialog';
import { Button } from '../Button';
const noActor = () => null;
const noPreview = () => false;
const watchPreview = listener => {
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
};

export function ServerRenderPanel(props) {
    const actor = useSyncExternalStore(onSessionChange, getStoredUserId, noActor);
    const readPreview = useCallback(() => {
        try { return serverRenderVisible(props.mode, window.localStorage); } catch { return false; }
    }, [props.mode]);
    const enabled = useSyncExternalStore(watchPreview, readPreview, noPreview);
    return enabled && actor ? <RenderSession key={actor} {...props} actor={actor} /> : null;
}

function RenderSession({ actor, project, timeline, blobs, uploadCache, height, label, balanceInfo, state, onState, onCredits }) {
    const { t, locale } = useI18n();
    const [quote, setQuote] = useState(null), [busy, setBusy] = useState(false), [cancelOpen, setCancelOpen] = useState(false);
    const [upload, setUpload] = useState(null), [fileErrors, setFileErrors] = useState([]);
    const fallbackCache = useRef(new Map()), cacheRef = uploadCache || fallbackCache;
    const alive = useRef(true), controller = useRef(null), locked = useRef(false), generation = useRef(0);
    const current = state?.actor === actor ? state : null;
    const job = current?.job;
    const jobId = job?.jobId, phase = job?.phase, renderId = job?.renderId;
    const statusUnavailable = current?.statusUnavailable === true;
    const doc = useMemo(() => project?.actor === actor && project?.document && project?.savedAt
        ? exportDocument(documentForTimeline(project.document, timeline)) : null, [actor, project, timeline]);
    const reason = serverRenderDisabled(doc, height, label);
    const snapshot = useMemo(() => renderSnapshot(doc, height, label), [doc, height, label]);
    const identity = snapshotIdentity(snapshot), identityRef = useRef(identity);
    identityRef.current = identity;
    useEffect(() => {
        generation.current++;
        setQuote(null);
    }, [identity]);
    useEffect(() => {
        alive.current = true;
        const unsubscribe = onSessionChange(() => {
            if (actor !== getStoredUserId()) { controller.current?.abort(); cacheRef.current.clear(); }
        });
        return () => { alive.current = false; controller.current?.abort(); unsubscribe(); };
    }, [actor, cacheRef]);
    const valid = () => alive.current && actor === getStoredUserId();
    const save = next => { if (valid()) onState({ ...next, actor }); };
    function call(path, init = {}) {
        const abort = new AbortController(); controller.current = abort;
        return accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal)(path, init);
    }
    function showError(error, previous = current) {
        if (!valid()) return;
        const code = error.body?.error || error.code;
        if (code === 'preview_only' && error.status === 403) { save({ unavailable: true }); return; }
        save({ ...previous, error: { code, status: error.status, feature: error.body?.feature } });
    }
    useEffect(() => {
        // A completed POST replay has no render_id; read the canonical status once for delivery.
        if (!jobId || statusUnavailable || (terminalRender({ phase }) && !(phase === 'done' && !renderId))) return;
        let stopped = false, timer, count = 0, fetching = false, health = renderPollOutcome(0);
        const abort = new AbortController();
        const active = () => !stopped && actor === getStoredUserId();
        const callStatus = accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal);
        const schedule = () => {
            clearTimeout(timer);
            const delay = renderPollDelay(count, document.visibilityState === 'visible', { phase: 'rendering' }, health.statusUnavailable);
            if (delay !== null && active()) timer = setTimeout(poll, delay);
        };
        async function poll() {
            if (!active() || fetching || document.visibilityState !== 'visible') return;
            fetching = true;
            try {
                const result = renderStatus(await callStatus(`${SERVER_RENDER_PATH}?job_id=${encodeURIComponent(jobId)}`));
                if (!active()) return;
                health = renderPollOutcome(health.failures);
                onState(previous => previous?.actor === actor && previous.job?.jobId === jobId && !(terminalRender(previous.job) && !terminalRender(result))
                    ? { ...previous, job: result, error: null, statusUnavailable: false } : previous);
                if (terminalRender(result)) { stopped = true; notifyBalanceChanged(); }
            } catch (error) {
                if (active()) {
                    health = renderPollOutcome(health.failures, error);
                    stopped = health.statusUnavailable;
                    onState(previous => previous?.actor === actor && previous.job?.jobId === jobId && (!terminalRender(previous.job) || (previous.job.phase === 'done' && !previous.job.renderId))
                        ? { ...previous, statusUnavailable: health.statusUnavailable, error: null } : previous);
                }
            } finally { fetching = false; count++; if (!stopped) schedule(); }
        }
        const visibility = () => { clearTimeout(timer); if (document.visibilityState === 'visible') schedule(); };
        schedule(); document.addEventListener('visibilitychange', visibility);
        return () => { stopped = true; clearTimeout(timer); abort.abort(); document.removeEventListener('visibilitychange', visibility); };
    }, [actor, jobId, phase, renderId, statusUnavailable, onState]);

    async function getQuote() {
        if (locked.current || !snapshot) return;
        const classified = localRenderFiles(snapshot.document, blobs?.current);
        setFileErrors(classified.errors);
        if (classified.errors.length) return;
        locked.current = true; setBusy(true); setQuote(null);
        const ticket = generation.current, frozen = snapshot;
        save({ ...current, error: null, attempt: null, uncertain: false, needsCredits: false, job: null, statusUnavailable: false });
        try {
            const price = await call(`${SERVER_RENDER_PATH}/quote`, quoteRequest(frozen));
            if (valid() && ticket === generation.current && identityRef.current === snapshotIdentity(frozen)) {
                // Validate the server response without calculating a price.
                renderAttempt(frozen, price, 'validation');
                const pending = pendingRenderFiles(classified.files, cacheRef.current, actor);
                setQuote({ snapshot: frozen, price, identity: snapshotIdentity(frozen), files: classified.files,
                    pending, consent: pending.map(file => file.id) });
            }
        } catch (error) { showError(error); }
        finally { locked.current = false; if (valid()) setBusy(false); }
    }
    async function submit(attempt) {
        if (locked.current) return;
        locked.current = true; setBusy(true); setQuote(null);
        const pending = { attempt, uncertain: true, job: null, error: null };
        save(pending);
        try {
            const response = await sendRenderAttempt(call, attempt, valid);
            if (valid()) { save({ attempt, job: renderStatus(response), uncertain: false }); notifyBalanceChanged(); }
        } catch (error) {
            if (!valid()) return;
            const code = error.body?.error || error.code;
            if (code === 'insufficient_balance' && error.status === 402) {
                save({ attempt, needsCredits: true, uncertain: false });
                setQuote(null); setCancelOpen(false); onCredits();
            } else showError(error, { ...pending, uncertain: retryRenderTransport(error) });
        } finally { locked.current = false; if (valid()) setBusy(false); }
    }
    async function confirm() {
        if (locked.current || !quote || quote.identity !== identityRef.current) return;
        const pending = pendingRenderFiles(quote.files, cacheRef.current, actor);
        if (pending.some(file => !quote.consent.includes(file.id))) {
            setQuote({ ...quote, pending, consent: pending.map(file => file.id) });
            return; // Expiry needs renewed consent before any replacement upload.
        }
        if (!quote.files.length) { void submit(renderAttempt(quote.snapshot, quote.price, makeIdempotencyKey())); return; }
        locked.current = true; setBusy(true); setQuote(null);
        const abort = new AbortController(); controller.current = abort;
        const uploadCall = accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal);
        let attempt;
        try {
            await uploadRenderFiles(quote.files, { actor, getActor: getStoredUserId, cache: cacheRef.current, consent: quote.consent,
                call: uploadCall, signal: abort.signal, onProgress: next => { if (valid()) setUpload(next); } });
            if (!valid()) return;
            // No async gap between final expiry check and the first create send.
            attempt = uploadedRenderAttempt(quote.snapshot, quote.price, makeIdempotencyKey(), quote.files, cacheRef.current, actor);
        } catch (error) {
            if (error.name !== 'AbortError') showError(error);
        } finally { locked.current = false; if (valid()) { setBusy(false); setUpload(null); } }
        if (attempt && valid()) void submit(attempt);
    }
    async function cancel() {
        if (locked.current || !job?.jobId) return;
        locked.current = true; setCancelOpen(false); setBusy(true);
        try {
            const response = await call(`${SERVER_RENDER_PATH}?job_id=${encodeURIComponent(job.jobId)}`, { method: 'DELETE' });
            save({ ...current, job: { ...renderStatus(response), credits: job.credits }, error: null, statusUnavailable: false }); notifyBalanceChanged();
        } catch (error) {
            if (error.status === 409 && (error.body?.error || error.code) === 'job_finished') {
                try { save({ ...current, job: renderStatus(await call(`${SERVER_RENDER_PATH}?job_id=${encodeURIComponent(job.jobId)}`)), error: null, statusUnavailable: false }); }
                catch (readError) { showError(readError); }
            } else showError(error);
        } finally { locked.current = false; if (valid()) setBusy(false); }
    }
    async function download() {
        if (locked.current || !job?.renderId) return;
        locked.current = true; setBusy(true);
        try { const asset = await call(renderDownloadPath(job.renderId)); if (valid()) window.location.assign(asset.url); }
        catch (error) { showError(error); }
        finally { locked.current = false; if (valid()) setBusy(false); }
    }
    if (current?.unavailable) return null;
    const inFlight = job && !terminalRender(job);
    const number = value => Number(value).toLocaleString(localeTag(locale));
    const error = current?.error;
    const balanceCopy = balanceInfo?.actor === actor && Number.isSafeInteger(balanceInfo.balance)
        ? t('app.editor.generation.balance', { balance: number(balanceInfo.balance) }) : '';
    return <section aria-label={t('app.editor.server.title')} className="mt-5 space-y-3 border-t border-vx-border pt-4 text-sm">
        <h3 className="font-bold">{t('app.editor.server.title')}</h3>
        <p className="text-xs text-vx-fg-muted">{t('app.editor.server.note')}</p>
        {reason && <p>{t(`app.editor.server.${reason}`)}</p>}
        {current?.uncertain && current.attempt && <div role="status" className="space-y-1 break-words">
            <p>{current.attempt.snapshot.label}</p>
            <p>{t('app.editor.server.price', { credits: number(current.attempt.credits), resolution: current.attempt.snapshot.resolution })}</p>
        </div>}
        {current?.needsCredits && <p role="status">{t('app.editor.server.balanceLow')}</p>}
        {job && <div role="status" className="space-y-2">
            <p>{t(statusUnavailable ? 'app.editor.server.statusUnavailable' : job.refunded ? 'app.editor.server.refunded' : `app.editor.server.${job.phase}`)}</p>
            {job.phase === 'failed' && !job.refunded && job.error && <p>{t(renderError({ code: job.error }))}</p>}
            {Number.isSafeInteger(job.credits) && <p>{t('app.editor.server.charged', { credits: number(job.credits) })}</p>}
            {inFlight && !statusUnavailable && <progress aria-label={t('app.editor.server.progress')} className="w-full" />}
        </div>}
        {fileErrors.map((item, index) => <p key={item.id || index} role="status" className="break-words">{item.name ? `${item.name}: ` : ''}{t(`app.editor.server.${item.code}`)}</p>)}
        {upload && <div role="status" className="space-y-2 break-words">
            <p>{t('app.editor.server.uploadingFile', { name: upload.name })}</p>
            <progress value={upload.progress} max={1} aria-label={t('app.editor.server.uploadProgress')} className="w-full" />
            <Button type="button" size="sm" className="min-h-11" onClick={() => controller.current?.abort()}>{t('app.editor.server.abortFile')}</Button>
        </div>}
        {error && <p role="status">{t(renderError(error), { feature: t(renderFeature(error.feature)) })}</p>}
        {statusUnavailable && <Button type="button" className="min-h-11" size="sm" disabled={busy} onClick={() => save({ ...current, statusUnavailable: false, error: null })}>{t('app.editor.server.retryStatus')}</Button>}
        {job?.phase === 'done' && <div className="flex flex-wrap items-center gap-3">
            <a className="text-vx-accent underline" href={renderLibraryHref(job.renderId)}>{t('app.editor.server.library')}</a>
            {job.renderId && <Button type="button" className="min-h-11" size="sm" disabled={busy} onClick={download}>{t('app.editor.saved.download')}</Button>}
        </div>}
        {inFlight ? <Button type="button" className="min-h-11" size="sm" variant="ghost" disabled={busy} onClick={() => setCancelOpen(true)}>{t('app.editor.server.cancel')}</Button>
            : current?.uncertain ? <Button type="button" className="min-h-11" size="sm" disabled={busy} onClick={() => submit(current.attempt)}>{t('app.editor.server.retryConnection')}</Button>
                : <Button type="button" className="min-h-11" size="sm" disabled={!!reason || busy} onClick={getQuote}>{t(job || error ? 'app.editor.server.tryAgain' : 'app.editor.server.getQuote')}</Button>}
        {busy && <p role="status">{t('app.editor.server.working')}</p>}
        {quote && quote.identity === identity && <ConfirmDialog title={t('app.editor.server.confirmTitle')}
            body={(quote.pending?.length ? t('app.editor.server.uploadConsent', { count: number(quote.pending.length), mb: number(Math.ceil(quote.pending.reduce((sum, file) => sum + file.size, 0) / 1000000)) }) + ' ' : '') + t('app.editor.server.price', { credits: number(quote.price.credits), resolution: quote.price.resolution }) + balanceCopy}
            confirmLabel={t(quote.pending?.length ? 'app.editor.server.uploadAndRender' : 'app.editor.server.confirm')} onConfirm={confirm} onCancel={() => setQuote(null)} />}
        {cancelOpen && <ConfirmDialog title={t('app.editor.server.cancelTitle')} body={t('app.editor.server.cancelBody')}
            confirmLabel={t('app.editor.server.cancel')} onConfirm={cancel} onCancel={() => setCancelOpen(false)} />}
    </section>;
}

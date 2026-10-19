'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient.js';
import { gatewayFetch } from '../../_lib/gateway.js';
import { accountBoundCall } from '../../_lib/editorDelivery.mjs';
import { uploadSocialFile } from '../../../lib/socialUploadsClient.js';
import { loadSavedRender } from '../../_lib/editorSavedRender.mjs';
import { ConfirmDialog } from '../ConfirmDialog';
const noActor = () => null;

export function EditorLibraryRenders({ visible = true }) {
    const actor = useSyncExternalStore(onSessionChange, getStoredUserId, noActor);
    return actor && visible ? <RenderList key={actor} actor={actor} /> : null;
}
function RenderList({ actor }) {
  const { t } = useI18n();
    const [rows, setRows] = useState([]), [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [confirm, setConfirm] = useState(null), [busy, setBusy] = useState(false), [visible, setVisible] = useState(12);
    const alive = useRef(true), controller = useRef(null);
    useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
    useEffect(() => {
        const abort = new AbortController(); controller.current = abort;
        accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal)('/library/editor-renders').then(page => { if (alive.current && actor === getStoredUserId()) { setRows(page.renders || []); setError(''); } })
            .catch(e => { if (alive.current && actor === getStoredUserId() && !abort.signal.aborted && e.status !== 404) setError(t("app.editor.saved.loadFailed")); });
        return () => abort.abort();
    }, [actor, refresh, t]);
    async function remove() {
        if (!confirm || busy) return;
        setBusy(true); const id = confirm.id; setConfirm(null);
        const abort = new AbortController(); controller.current = abort;
        try { await accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal)('/library/editor-renders', { method: 'DELETE', body: JSON.stringify({ id }) }); if (alive.current && actor === getStoredUserId()) setRows(previous => previous.filter(row => row.id !== id)); }
        catch { if (alive.current && actor === getStoredUserId() && !abort.signal.aborted) setError(t("app.editor.saved.removeFailed")); }
        finally { if (alive.current && actor === getStoredUserId()) setBusy(false); }
    }
    if (!rows.length && !error) return null;
    return <section aria-label={t("app.editor.saved.title")} className="max-w-[1400px] mx-auto px-4 sm:px-8 py-6">
        <h2 className="text-xl font-semibold">{t("app.editor.saved.title")}</h2>
        {error && <p role="alert" className="text-sm">{error} <button type="button" className="underline" onClick={() => setRefresh(n => n + 1)}>{t("app.editor.saved.retry")}</button></p>}
        <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{rows.slice(0, visible).map(row => <RenderCard key={row.id} actor={actor} row={row} onRemove={() => setConfirm(row)} />)}</div>
        {rows.length > visible && <button type="button" className="mt-4 text-sm text-vx-accent underline" onClick={() => setVisible(n => n + 12)}>{t("app.editor.saved.more")}</button>}
        {confirm && <ConfirmDialog title={t('app.editor.saved.removeTitle', { name: confirm.label })} body={t("app.editor.saved.removeBody")} confirmLabel={t("app.editor.saved.remove")} tone="danger" onCancel={() => setConfirm(null)} onConfirm={remove} />}
    </section>;
}
function RenderCard({ actor, row, onRemove }) {
  const { t, locale } = useI18n();
  const num = value => locale === 'en' ? String(value) : Number(value).toLocaleString(localeTag(locale));
    const [url, setUrl] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState(''), [consent, setConsent] = useState(false), [uploaded, setUploaded] = useState(null);
    const alive = useRef(true), controller = useRef(null), running = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
    useEffect(() => {
        const abort = new AbortController(); controller.current = abort;
        accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal)(`/library/editor-renders/${row.id}/asset`).then(asset => { if (alive.current && actor === getStoredUserId()) setUrl(asset.url); })
            .catch(() => { if (alive.current && actor === getStoredUserId() && !abort.signal.aborted) setError(t("app.editor.saved.videoFailed")); });
        return () => abort.abort();
    }, [actor, row.id, t]);
    async function download() {
        if (running.current) return;
        const abort = new AbortController(); controller.current = abort; running.current = true; setError(''); setStatus(t("app.editor.saved.downloading"));
        try { const asset = await accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal)(`/library/editor-renders/${row.id}/asset?download=1`); if (alive.current && actor === getStoredUserId()) window.location.assign(asset.url); }
        catch { if (alive.current && actor === getStoredUserId() && !abort.signal.aborted) setError(t("app.editor.saved.downloadFailed")); }
        finally { running.current = false; if (alive.current && actor === getStoredUserId()) setStatus(''); }
    }
    async function prepare() {
        if (running.current || !consent) return;
        const abort = new AbortController(); controller.current = abort; running.current = true; setError(''); setStatus(t("app.editor.saved.preparing"));
        const call = accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal);
        try {
            const capabilities = await call('/social/accounts');
            if (!capabilities.uploadsEnabled) throw new Error(t("app.editor.delivery.uploadClosed"));
            const file = await loadSavedRender(call, row, { signal: abort.signal });
            const item = await uploadSocialFile(file, { call, signal: abort.signal, onProgress: percent => alive.current && actor === getStoredUserId() && setStatus(t('app.editor.delivery.uploadProgress', { percent: num(percent) })) });
            if (alive.current && actor === getStoredUserId()) setUploaded(item);
        } catch (e) { if (alive.current && actor === getStoredUserId() && !abort.signal.aborted) setError(e.status ? t("app.editor.saved.publishFailed") : e.message); }
        finally { running.current = false; if (alive.current && actor === getStoredUserId()) setStatus(''); }
    }
    return <article id={`render-${row.id}`} aria-label={row.label} className="overflow-hidden rounded-xl border border-vx-border bg-vx-panel">
        {url && <video aria-label={t('app.editor.saved.preview', { name: row.label })} controls playsInline preload="metadata" src={url} className="aspect-video w-full bg-black" />}
        <div className="space-y-2 p-4"><h3 className="font-semibold">{row.label}</h3><p className="text-xs text-vx-fg-muted">{t('app.editor.saved.details', { width: num(row.width), height: num(row.height), seconds: locale === 'en' ? Number(row.seconds).toFixed(2) : Number(row.seconds).toLocaleString(localeTag(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }), rate: num(row.frame_rate) })}</p>
            <p className="text-xs text-vx-fg-muted">{t('app.editor.saved.expires', { date: new Date(row.expires_at).toLocaleDateString(localeTag(locale)) })}</p>
            <button type="button" className="text-sm text-vx-accent underline disabled:opacity-40" disabled={!!status} onClick={download}>{t("app.editor.saved.download")}</button>
            <label className="flex gap-2 text-xs"><input aria-label={t('app.editor.saved.rightsLabel', { name: row.label })} type="checkbox" checked={consent} disabled={!!status} onChange={e => setConsent(e.target.checked)} /><span>{t("app.editor.saved.rights")}</span></label>
            {uploaded ? <a className="block text-sm text-vx-accent underline" href={`/app/publish?upload=${encodeURIComponent(uploaded.id)}`}>{t("app.editor.delivery.choose")}</a> : <button type="button" className="text-sm text-vx-accent underline disabled:opacity-40" disabled={!consent || !!status} onClick={prepare}>{t("app.editor.saved.prepare")}</button>}
            <button type="button" className="block text-sm underline" disabled={!!status} onClick={onRemove}>{t("app.editor.saved.remove")}</button>
            {status && <p role="status" className="text-xs">{status}</p>}{error && <p role="alert" className="text-xs">{error}</p>}
        </div>
    </article>;
}

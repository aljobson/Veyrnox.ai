'use client';
import LegalLink from '../../../../components/LegalLink';
import { useI18n } from '../../../../components/I18nProvider';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient.js';
import { uploadSocialFile } from '../../../lib/socialUploadsClient.js';
import { gatewayFetch } from '../../_lib/gateway.js';
import { accountBoundCall, localExportFile, saveEditorRender, editorDestinations } from '../../_lib/editorDelivery.mjs';
import { Button } from '../Button';

const noActor = () => null;


export function EditorDeliveryPanel({ result }) {
    const actor = useSyncExternalStore(onSessionChange, getStoredUserId, noActor);
    if (!result) return null;
    return <DeliverySession key={`${actor || 'anonymous'}:${result.url}`} actor={actor} result={result} />;
}
// Local delivery helper messages are closed UI copy; unfamiliar provider text is preserved.
const deliveryCopyKeys = {
  "Statistics only; uploads unavailable.": "app.editor.delivery.reason.statistics",
  "Video delivery is not open for this connection.": "app.editor.delivery.reason.notOpen",
  "Video posting is not supported by this connection.": "app.editor.delivery.reason.unsupported",
  "Not released.": "app.editor.delivery.reason.unreleased",
  "Connection setup is required.": "app.editor.delivery.reason.setup",
  "Device video uploads are not open.": "app.editor.delivery.reason.device",
  "Connect an account in Publish.": "app.editor.delivery.reason.connect",
  "Choose when to deliver to your inbox; finish posting in TikTok.": "app.editor.delivery.reason.tiktok",
  "Choose the account, visibility and posting time in Publish.": "app.editor.delivery.reason.publish",
  "Checking export…": "app.editor.delivery.progress.check",
  "Uploading to your private Library…": "app.editor.delivery.progress.upload",
  "Inspecting and saving…": "app.editor.delivery.progress.inspect"
};
function DeliverySession({ actor, result }) {
  const { t, locale } = useI18n();
    const [open, setOpen] = useState(false), [consent, setConsent] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
    const [library, setLibrary] = useState(null), [social, setSocial] = useState(null), [saved, setSaved] = useState(null), [uploaded, setUploaded] = useState(null);
    const alive = useRef(true), controller = useRef(null), running = useRef(false), saveKey = useRef(crypto.randomUUID());
    const current = () => alive.current && actor === getStoredUserId();
    useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
    async function options() {
        if (running.current) return;
        setOpen(true); setError('');
        if (!actor) return;
        const abort = new AbortController(); controller.current = abort; running.current = true; setStatus(t("app.editor.delivery.checking"));
        const call = accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal);
        try {
            const checks = await Promise.allSettled([call('/library/editor-renders'), call('/social/accounts')]);
            if (!current()) return;
            setLibrary(checks[0].status === 'fulfilled' && checks[0].value.enabled === true);
            setSocial(checks[1].status === 'fulfilled' ? checks[1].value : { unavailable: true });
        } finally { running.current = false; if (current()) setStatus(''); }
    }
    async function deliver(action) {
        if (running.current || !consent || !current()) return;
        const abort = new AbortController(); controller.current = abort; running.current = true; setError(''); setStatus(t("app.editor.delivery.reading"));
        const call = accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal);
        try {
            const file = await localExportFile(result, { origin: window.location.origin, signal: abort.signal });
            if (!current()) return;
            if (action === 'library') {
                const item = await saveEditorRender(file, { consent, idempotencyKey: saveKey.current, call, signal: abort.signal, onProgress: value => current() && setStatus(tOr(t, deliveryCopyKeys[value], value)) });
                if (current()) setSaved(item);
            } else {
                setStatus(t("app.editor.delivery.uploading"));
                const item = await uploadSocialFile(file, { call, signal: abort.signal, onProgress: percent => current() && setStatus(t('app.editor.delivery.uploadProgress', { percent: locale === 'en' ? percent : percent.toLocaleString(localeTag(locale)) })) });
                if (current()) setUploaded(item);
            }
        } catch (e) {
            if (current() && !abort.signal.aborted) { if (e?.body?.error?.code === 'UPLOAD_CLOSED') saveKey.current = crypto.randomUUID(); setError(tOr(t, `app.editor.delivery.error.${e?.body?.error?.code || e?.code}`, typeof e?.message === 'string' && !e.status ? e.message : t('app.publish.uploads.failed'))); }
        } finally { running.current = false; if (current()) setStatus(''); }
    }
    const destinations = editorDestinations(social), uploadOpen = social?.uploadsEnabled === true;
    return <section aria-label={t("app.editor.delivery.region")} className="space-y-2 rounded-lg border border-vx-border p-2">
        <Button size="sm" variant="ghost" disabled={!!status} onClick={options}>{open ? t("app.editor.delivery.refresh") : t("app.editor.delivery.open")}</Button>
        {open && <>
            {!actor ? <p className="text-xs">{t("app.editor.delivery.signIn")}{' '}<Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</Button></p> : <>
                <label className="flex items-start gap-2 text-xs"><input aria-label={t("app.editor.delivery.confirm")} type="checkbox" checked={consent} disabled={!!status} onChange={e => setConsent(e.target.checked)} /><span>{t("app.editor.delivery.rights")}{' '}<LegalLink element="a" className="underline" href="/legal/aup">{t("guide.your-own-files.l2")}</LegalLink></span></label>
                {saved ? <p role="status" className="text-xs">{t("app.editor.delivery.saved")}{' '}<a className="text-vx-accent underline" href={saved.url}>{t("app.editor.delivery.view")}</a></p> : <Button size="sm" disabled={!library || !consent || !!status} onClick={() => deliver('library')}>{t("app.editor.delivery.save")}</Button>}
                {library === false && <p className="text-xs text-vx-fg-muted">{t("app.editor.delivery.closed")}</p>}
                <p className="text-[10px] text-vx-fg-muted">{t("app.editor.delivery.limits")}</p>
                {uploaded ? <p role="status" className="text-xs">{t("app.editor.delivery.verified")}{' '}<a className="text-vx-accent underline" href={`/app/publish?upload=${encodeURIComponent(uploaded.id)}`}>{t("app.editor.delivery.choose")}</a></p> : <Button size="sm" variant="ghost" disabled={!uploadOpen || !consent || !!status} onClick={() => deliver('publish')}>{t("app.editor.delivery.prepare")}</Button>}
                {social && !uploadOpen && <p className="text-xs text-vx-fg-muted">{t("app.editor.delivery.uploadClosed")}</p>}
                <ul aria-label={t("app.editor.delivery.destinations")} className="space-y-1 text-[10px] text-vx-fg-muted">{destinations.map(n => <li key={n.key}><strong>{n.label}</strong>: {tOr(t, deliveryCopyKeys[n.reason], n.reason)}</li>)}<li><strong>{t('app.editor.delivery.tiktokAds')}</strong>{t("app.editor.delivery.ads")}</li></ul>
                <p className="text-[10px] text-vx-fg-muted">{t("app.editor.delivery.policy")}</p>
            </>}
        </>}
        {status && <><p role="status" className="text-xs">{status}</p><Button size="sm" variant="ghost" onClick={() => controller.current?.abort()}>{t("app.editor.delivery.cancel")}</Button></>}
        {error && <p role="alert" className="text-xs">{error}</p>}
    </section>;
}

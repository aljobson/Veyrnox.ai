'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient.js';
import { uploadSocialFile } from '../../../lib/socialUploadsClient.js';
import { gatewayFetch } from '../../_lib/gateway.js';
import { accountBoundCall, localExportFile, saveEditorRender, editorDestinations } from '../../_lib/editorDelivery.mjs';
import { Button } from '../Button';

const noActor = () => null;
const errorCopy = error => {
    const code = error?.body?.error?.code || error?.code;
    return ({ NOT_FOUND: 'Private Library saving is not open here yet.', UPLOAD_CLOSED: 'The save window expired. Retry to start a new upload.', RENDER_LIMIT: 'Your private renders are full (100 videos or 200 MiB). Remove unused videos and try again.', INVALID_RENDER: 'This MP4 could not be verified. Export it again.', RENDER_MISMATCH: 'The uploaded bytes did not match the export. Export it again.', uploads_not_open: 'Device uploads are not open in Publish yet.', publish_not_open: 'Publish is not open for this account yet.', account_changed: 'Your account changed. Reopen delivery in the current account.', rate_limited: 'Please wait a minute and try again.' })[code] || (typeof error?.message === 'string' && !error.status ? error.message : 'That did not complete. Check your connection and try again.');
};

export function EditorDeliveryPanel({ result }) {
    const actor = useSyncExternalStore(onSessionChange, getStoredUserId, noActor);
    if (!result) return null;
    return <DeliverySession key={`${actor || 'anonymous'}:${result.url}`} actor={actor} result={result} />;
}
function DeliverySession({ actor, result }) {
    const [open, setOpen] = useState(false), [consent, setConsent] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
    const [library, setLibrary] = useState(null), [social, setSocial] = useState(null), [saved, setSaved] = useState(null), [uploaded, setUploaded] = useState(null);
    const alive = useRef(true), controller = useRef(null), running = useRef(false), saveKey = useRef(crypto.randomUUID());
    const current = () => alive.current && actor === getStoredUserId();
    useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
    async function options() {
        if (running.current) return;
        setOpen(true); setError('');
        if (!actor) return;
        const abort = new AbortController(); controller.current = abort; running.current = true; setStatus('Checking delivery options…');
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
        const abort = new AbortController(); controller.current = abort; running.current = true; setError(''); setStatus('Reading export…');
        const call = accountBoundCall(gatewayFetch, actor, getStoredUserId, abort.signal);
        try {
            const file = await localExportFile(result, { origin: window.location.origin, signal: abort.signal });
            if (!current()) return;
            if (action === 'library') {
                const item = await saveEditorRender(file, { consent, idempotencyKey: saveKey.current, call, signal: abort.signal, onProgress: value => current() && setStatus(value) });
                if (current()) setSaved(item);
            } else {
                setStatus('Uploading for Publish…');
                const item = await uploadSocialFile(file, { call, signal: abort.signal, onProgress: percent => current() && setStatus(`Uploading for Publish… ${percent}%`) });
                if (current()) setUploaded(item);
            }
        } catch (e) {
            if (current() && !abort.signal.aborted) { if (e?.body?.error?.code === 'UPLOAD_CLOSED') saveKey.current = crypto.randomUUID(); setError(errorCopy(e)); }
        } finally { running.current = false; if (current()) setStatus(''); }
    }
    const destinations = editorDestinations(social), uploadOpen = social?.uploadsEnabled === true;
    return <section aria-label="Export delivery" className="space-y-2 rounded-lg border border-vx-border p-2">
        <Button size="sm" variant="ghost" disabled={!!status} onClick={options}>{open ? 'Refresh delivery options' : 'Save or prepare a post'}</Button>
        {open && <>
            {!actor ? <p className="text-xs">Sign in to save a private video or prepare a post. <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</Button></p> : <>
                <label className="flex items-start gap-2 text-xs"><input aria-label="Confirm export rights" type="checkbox" checked={consent} disabled={!!status} onChange={e => setConsent(e.target.checked)} /><span>I own this edit or have permission to use its footage, music, brands and artwork, and consent from identifiable people. <a className="underline" href="/legal/aup">Acceptable Use</a></span></label>
                {saved ? <p role="status" className="text-xs">Saved to your private Library. <a className="text-vx-accent underline" href={saved.url}>View saved edit</a></p> : <Button size="sm" disabled={!library || !consent || !!status} onClick={() => deliver('library')}>Save edit to Library</Button>}
                {library === false && <p className="text-xs text-vx-fg-muted">Private editor saving is not open here yet.</p>}
                <p className="text-[10px] text-vx-fg-muted">Private Library videos: MP4/H.264, up to 25 MiB, 10 minutes and 4096 pixels per edge, at 24, 25, 30, 50 or 60 fps. Retained for 90 days. Saving uses no credits.</p>
                {uploaded ? <p role="status" className="text-xs">Video verified for Publish. <a className="text-vx-accent underline" href={`/app/publish?upload=${encodeURIComponent(uploaded.id)}`}>Choose destinations and posting time</a></p> : <Button size="sm" variant="ghost" disabled={!uploadOpen || !consent || !!status} onClick={() => deliver('publish')}>Prepare video in Publish</Button>}
                {social && !uploadOpen && <p className="text-xs text-vx-fg-muted">Device video uploads are not open in Publish here yet.</p>}
                <ul aria-label="Video publishing destinations" className="space-y-1 text-[10px] text-vx-fg-muted">{destinations.map(n => <li key={n.key}><strong>{n.label}</strong>: {n.reason}</li>)}<li><strong>TikTok Ads</strong>: Advertising delivery is not connected.</li></ul>
                <p className="text-[10px] text-vx-fg-muted">Preparing uploads your video. Posting starts only when you choose Post now or Schedule post in Publish.</p>
            </>}
        </>}
        {status && <><p role="status" className="text-xs">{status}</p><Button size="sm" variant="ghost" onClick={() => controller.current?.abort()}>Cancel delivery</Button></>}
        {error && <p role="alert" className="text-xs">{error}</p>}
    </section>;
}

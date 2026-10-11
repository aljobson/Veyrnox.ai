'use client';
import { useEffect, useRef, useState } from 'react';
import { onSessionChange } from '../../../lib/authClient';
import { gatewayFetch } from '../../_lib/gateway';
import { saveFilmMaster, SAVE_ERRORS } from '../../_lib/filmMasterSave.mjs';

export function FilmMasterSave({ master, jobId, label, fetcher = gatewayFetch, transfer }) {
    const [consent, setConsent] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState(''), [saved, setSaved] = useState(null);
    const running = useRef(false), abort = useRef(null), uploadId = useRef(null);
    useEffect(() => {
        const stop = onSessionChange(() => { abort.current?.abort(); setSaved(null); setConsent(false); setStatus(''); });
        return () => { abort.current?.abort(); stop(); };
    }, []);
    async function save() {
        if (running.current || saved || !consent) return;
        const controller = new AbortController(); abort.current = controller; running.current = true;
        uploadId.current ||= crypto.randomUUID(); setError('');
        try {
            const result = await saveFilmMaster({ blob: master.blob, jobId, label, uploadId: uploadId.current, consent,
                signal: controller.signal, onProgress: setStatus, fetcher, transfer });
            if (!controller.signal.aborted) setSaved(result);
        } catch (e) {
            if (!controller.signal.aborted) {
                if (e.code === 'upload_expired') uploadId.current = null;
                setError(e.code === 'rate_limited' ? `Please wait ${e.retryAfter || 60} seconds and try again.` : SAVE_ERRORS[e.code] || (e.code ? 'Your master could not be saved. Try again; the download is still available.' : e.message));
            }
        } finally { running.current = false; if (!controller.signal.aborted) setStatus(''); }
    }
    return <div className="space-y-3">
        {saved ? <p role="status" className="text-xs font-semibold">Saved to your Library. <a className="text-vx-accent underline" href={saved.url}>View saved video →</a></p> : <>
            <label className="flex items-start gap-2 text-xs text-vx-fg-muted"><input type="checkbox" checked={consent} disabled={!!status} onChange={e => setConsent(e.target.checked)} />
                <span>I own this video or have permission to use it, including consent from anyone identifiable and rights to any brand, artwork or recording. <a className="underline" href="/legal/aup">Acceptable Use</a></span></label>
            <button type="button" disabled={!consent || !!status} onClick={save} className="rounded-full bg-vx-accent px-4 py-2 text-xs font-semibold text-vx-accent-ink disabled:opacity-40">{status ? 'Saving to Library…' : 'Save to Library'}</button>
            {status && <p role="status" className="text-xs">{status}</p>}
            <p className="text-xs text-vx-fg-muted">Saving is free. The video stays in your Library until its source take expires, up to 90 days.</p>
        </>}
        {error && <p role="alert" className="text-xs text-vx-danger">{error}</p>}
    </div>;
}

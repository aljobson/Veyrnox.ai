'use client';
import { useEffect, useRef, useState } from 'react';
import { listSocialUploads, uploadSocialFile, removeSocialUpload } from '../../../lib/socialUploadsClient.js';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const errorCopy = (code) => ({
    upload_type_not_allowed: 'Choose a JPG, PNG, WebP image or an MP4 video.',
    upload_size_required: 'This file is empty. Choose another file.',
    upload_too_large: 'Images can be up to 20 MB; MP4 videos up to 100 MB.',
    upload_budget_exceeded:'Your uploads are full (10 files or 200 MB). Remove unused files, then try again after 20 minutes.',
    upload_in_use:'This file is used by a draft, scheduled or in-progress post. Finish or cancel that post first.',
    upload_type_mismatch: 'This file does not match its file type. Export it again and try uploading it.',
    upload_unreadable: 'This file could not be read. Export it again and try uploading it.',
}[code] || 'That did not complete. Check your connection and try again.');

export default function DeviceUploads({ selected, onSelect, onBusyChange, list = listSocialUploads, upload = uploadSocialFile, remove = removeSocialUpload }) {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [progress, setProgress] = useState(null);
    const [consent, setConsent] = useState(false);
    const [removing, setRemoving] = useState(null);
    const input = useRef(null);
    const controller = useRef(null);
    useEffect(() => {
        let live = true;
        list().then((r) => { if (live) setFiles(r.uploads || []); })
            .catch(() => { if (live) setError('Could not load your uploads. Try refreshing this page.'); })
            .finally(() => { if (live) setLoading(false); });
        return () => { live = false; controller.current?.abort(); };
    }, [list]);
    async function chooseFile(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !consent || controller.current) return;
        const active = new AbortController();
        controller.current = active;
        setError(''); setNotice(''); setProgress(0); onBusyChange?.(true);
        try {
            const uploaded = await upload(file, { signal: active.signal, onProgress: setProgress });
            if (active.signal.aborted) return;
            setFiles((old) => [uploaded, ...old]);
            onSelect({ uploadId: uploaded.id, thumbUrl: uploaded.url, mediaType: uploaded.mime_type.split('/')[0], filename: uploaded.filename });
            setNotice('Uploaded and selected. Nothing is posted until you schedule it.');
        } catch (err) {
            if (!active.signal.aborted) setError(errorCopy(err.code));
            else setNotice('Upload canceled.');
        } finally {
            controller.current = null; setProgress(null); onBusyChange?.(false);
        }
    }
    async function removeFile(file) {
        setRemoving(file.id); setError(''); setNotice('');
        try {
            await remove(file.id);
            setFiles((old) => old.filter((f) => f.id !== file.id));
            if (selected?.uploadId === file.id) onSelect(null);
            setNotice('Removed from your uploads. Storage is freed within 20 minutes.');
        } catch (err) { setError(errorCopy(err.code)); }
        finally { setRemoving(null); }
    }
    const busy = progress !== null;
    return <section aria-label="Device uploads" className="space-y-3 rounded-xl border border-vx-border p-3">
        <h3 className="text-sm font-bold">Your uploads</h3>
        <p className="text-xs text-vx-fg-muted">JPG, PNG or WebP up to 20 MB. MP4 up to 100 MB. Uploading uses no generation credits. Files stay in your Publish uploads until removed.</p>
        <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-vx-accent" />
            <span>I own this content or have permission to store and publish it.</span>
        </label>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={chooseFile} className="sr-only" tabIndex={-1} aria-label="Choose file from device" />
        <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button} disabled={!consent || busy} onClick={() => input.current?.click()}>Upload from device</button>
            {busy && <button type="button" className={button} onClick={() => controller.current?.abort()}>Cancel upload</button>}
        </div>
        {busy && <div role="status" className="text-sm"><progress value={progress} max={100} aria-label="Upload progress" className="w-full" />{progress < 100 ? `Uploading… ${progress}%` : 'Checking your file…'}</div>}
        {loading && <p role="status" className="text-sm text-vx-fg-muted">Loading your uploads…</p>}
        {!loading && !files.length && <p className="text-sm text-vx-fg-muted">No uploads yet. Choose a file from your device.</p>}
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {files.map((file) => <li key={file.id} className="min-w-0 rounded-lg border border-vx-border p-2">
                <button type="button" aria-pressed={selected?.uploadId === file.id} disabled={busy || removing !== null}
                    className="w-full text-left focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent"
                    onClick={() => onSelect({ uploadId: file.id, thumbUrl: file.url, mediaType: file.mime_type.split('/')[0], filename: file.filename })}>
                    {file.mime_type.startsWith('video/') ? <video src={file.url} preload="metadata" muted playsInline className="h-24 w-full object-contain" /> : <img src={file.url} alt="" className="h-24 w-full object-contain" />}
                    <span className="block truncate text-sm">{file.filename}</span>
                    <span className="text-xs text-vx-fg-muted">{selected?.uploadId === file.id ? 'Selected · ' : ''}{(file.size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                </button>
                <button type="button" disabled={busy || removing !== null} className="mt-2 text-xs underline" aria-label={`Remove ${file.filename}`} onClick={() => removeFile(file)}>{removing === file.id ? 'Removing…' : 'Remove'}</button>
            </li>)}
        </ul>
        {notice && <p role="status" className="text-sm text-vx-accent">{notice}</p>}
        {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
    </section>;
}

'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useEffect, useRef, useState } from 'react';
import { listSocialUploads, uploadSocialFile, removeSocialUpload } from '../../../lib/socialUploadsClient.js';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';


export default function DeviceUploads({ selected, onSelect, onBusyChange, list = listSocialUploads, upload = uploadSocialFile, remove = removeSocialUpload }) {
  const { t, locale } = useI18n();
    const errorCopy = code => tOr(t, `app.publish.uploads.error.${code}`, t('app.publish.uploads.failed'));
    const number = value => locale === 'en' ? value : value.toLocaleString(localeTag(locale));
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
            .catch(() => { if (live) setError(t("app.publish.uploads.loadFailed")); })
            .finally(() => { if (live) setLoading(false); });
        return () => { live = false; controller.current?.abort(); };
    }, [list, t]);
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
            setNotice(t("app.publish.uploads.selectedNotice"));
        } catch (err) {
            if (!active.signal.aborted) setError(errorCopy(err.code));
            else setNotice(t("app.publish.uploads.canceled"));
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
            setNotice(t("app.publish.uploads.removed"));
        } catch (err) { setError(errorCopy(err.code)); }
        finally { setRemoving(null); }
    }
    const busy = progress !== null;
    return <section aria-label={t("app.publish.uploads.device")} className="space-y-3 rounded-xl border border-vx-border p-3">
        <h3 className="text-sm font-bold">{t("app.publish.uploads.title")}</h3>
        <p className="text-xs text-vx-fg-muted">{t("app.publish.uploads.limits")}</p>
        <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-vx-accent" />
            <span>{t("app.publish.uploads.rights")}</span>
        </label>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={chooseFile} className="sr-only" tabIndex={-1} aria-label={t("app.publish.uploads.choose")} />
        <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button} disabled={!consent || busy} onClick={() => input.current?.click()}>{t("app.publish.uploads.upload")}</button>
            {busy && <button type="button" className={button} onClick={() => controller.current?.abort()}>{t("app.publish.uploads.cancel")}</button>}
        </div>
        {busy && <div role="status" className="text-sm"><progress value={progress} max={100} aria-label={t("app.publish.uploads.progress")} className="w-full" />{progress < 100 ? t('app.publish.uploads.uploading', { percent: number(progress) }) : t("app.publish.uploads.checking")}</div>}
        {loading && <p role="status" className="text-sm text-vx-fg-muted">{t("app.publish.uploads.loading")}</p>}
        {!loading && !files.length && <p className="text-sm text-vx-fg-muted">{t("app.publish.uploads.empty")}</p>}
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {files.map((file) => <li key={file.id} className="min-w-0 rounded-lg border border-vx-border p-2">
                <button type="button" aria-pressed={selected?.uploadId === file.id} disabled={busy || removing !== null}
                    className="w-full text-start focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent"
                    onClick={() => onSelect({ uploadId: file.id, thumbUrl: file.url, mediaType: file.mime_type.split('/')[0], filename: file.filename })}>
                    {file.mime_type.startsWith('video/') ? <video src={file.url} preload="metadata" muted playsInline className="h-24 w-full object-contain" /> : <img src={file.url} alt="" className="h-24 w-full object-contain" />}
                    <span className="block truncate text-sm">{file.filename}</span>
                    <span className="text-xs text-vx-fg-muted">{selected?.uploadId === file.id ? t("app.publish.uploads.selected") : ''}{locale === 'en' ? (file.size_bytes / 1024 / 1024).toFixed(1) : new Intl.NumberFormat(localeTag(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(file.size_bytes / 1024 / 1024)} {t("app.publish.uploads.megabytes")}</span>
                </button>
                <button type="button" disabled={busy || removing !== null} className="mt-2 text-xs underline" aria-label={t('app.publish.uploads.remove', { filename: file.filename })} onClick={() => removeFile(file)}>{removing === file.id ? t("app.publish.uploads.removing") : t("app.publish.common.remove")}</button>
            </li>)}
        </ul>
        {notice && <p role="status" className="text-sm text-vx-accent">{notice}</p>}
        {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
    </section>;
}

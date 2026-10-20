'use client';
import LegalLink from '../../../../components/LegalLink';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';

import { useEffect, useRef, useState } from 'react';
import { onSessionChange } from '../../../lib/authClient';
import { gatewayFetch } from '../../_lib/gateway';
import { saveFilmMaster } from '../../_lib/filmMasterSave.mjs';

export function saveError(t, error) {
    const fallback = t('app.film.save.failed');
    if (error?.code) return tOr(t, `app.film.save.error.${error.code}`, fallback);
    const message = error?.message;
    return tOr(t, `app.film.save.message.${message}`, message && !/^[a-z][a-z0-9_:-]*$/.test(message) ? message : fallback);
}
export function FilmMasterSave({ master, jobId, label, fetcher = gatewayFetch, transfer }) {
  const { t, locale } = useI18n();
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
                setError(e.code === 'rate_limited' ? t('app.film.save.retry', { seconds: locale === 'en' ? e.retryAfter || 60 : Number(e.retryAfter || 60).toLocaleString(localeTag(locale)) }) : saveError(t, e));
            }
        } finally { running.current = false; if (!controller.signal.aborted) setStatus(''); }
    }
    return <div className="space-y-3">
        {saved ? <p role="status" className="text-xs font-semibold">{t("app.film.save.saved")}<a className="text-vx-accent underline" href={saved.url}>{t("app.film.save.view")}</a></p> : <>
            <label className="flex items-start gap-2 text-xs text-vx-fg-muted"><input type="checkbox" checked={consent} disabled={!!status} onChange={e => setConsent(e.target.checked)} />
                <span>{t("app.film.save.rights")}<LegalLink element="a" className="underline" href="/legal/aup">{t("label.Acceptable Use")}</LegalLink></span></label>
            <button type="button" disabled={!consent || !!status} onClick={save} className="rounded-full bg-vx-accent px-4 py-2 text-xs font-semibold text-vx-accent-ink disabled:opacity-40">{status ? t("app.film.save.saving") : t("app.film.save.button")}</button>
            {status && <p role="status" className="text-xs">{tOr(t, `app.film.save.progress.${status}`, t('app.film.save.saving'))}</p>}
            <p className="text-xs text-vx-fg-muted">{t("app.film.save.policy")}</p>
        </>}
        {error && <p role="alert" className="text-xs text-vx-danger">{error}</p>}
    </div>;
}

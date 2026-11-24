'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider';
import { seedance25Models, createSeedance25Session } from '../../../lib/seedance25Client.mjs';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged } from '../_lib/gateway';
import { uploadSourceFile } from '../_lib/uploadSourceFile';
import { getSession } from '../../lib/authClient';
import { useCatalog } from '../_lib/useCatalog';
import { useOwnerProofCatalog } from '../_lib/useOwnerProofModels.js';

export function Seedance25EditorActions({ file }) {
    const { models: publicModels } = useCatalog();
    const models = useOwnerProofCatalog(publicModels);
    return <Seedance25Actions models={models} file={file} />;
}
export function Seedance25Actions({ models, assetId, file }) {
    const { t } = useI18n();
    const offers = seedance25Models(models);
    const [chosen, setChosen] = useState(null), [prompt, setPrompt] = useState(''), [quote, setQuote] = useState(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [jobId, setJobId] = useState(null);
    const [attempted, setAttempted] = useState(false);
    const attempt = useRef(null), locked = useRef(false), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    if (!offers.length || (!assetId && !file)) return null;
    const model = offers.find(m => m.id === chosen);
    function session() {
        if (!attempt.current) {
            const owner = getSession()?.user?.id;
            attempt.current = createSeedance25Session({
                current: () => alive.current && !!owner && getSession()?.user?.id === owner,
                makeKey: makeIdempotencyKey,
                request: (path, body) => gatewayFetch(path, { method: 'POST', body: JSON.stringify(body) }),
                reference: async () => assetId ? { slot: 'video', origin: 'asset', asset_id: assetId }
                    : { slot: 'video', origin: 'upload', key: await uploadSourceFile(file) },
            });
        }
        return attempt.current;
    }
    async function run(submit) {
        if (locked.current) return;
        locked.current = true; setBusy(true); setError('');
        try {
            if (submit) { const result = await session().submit(); if (alive.current) { setJobId(result.job_id); notifyBalanceChanged(); } }
            else { const result = await session().quote(model, prompt); if (alive.current) setQuote(result); }
        } catch { if (alive.current) { setError(t('app.seedance25.error')); if (!attempt.current?.attempted) setQuote(null); } }
        finally { locked.current = false; if (alive.current) { setBusy(false); setAttempted(!!attempt.current?.attempted); } }
    }
    if (jobId) return <Link href="/app/library" className="text-sm text-vx-accent">{t('app.seedance25.result')}</Link>;

    return <div className="space-y-3 p-3">
        <div className="flex flex-wrap gap-2">{offers.map(offer => <button type="button" key={offer.id} disabled={busy || attempted} aria-pressed={chosen === offer.id}
            className="min-h-11 rounded-lg border border-vx-border px-3 text-sm" onClick={() => { setChosen(offer.id); setQuote(null); }}>
            {t(offer.id.endsWith('-edit') ? 'app.seedance25.edit' : 'app.seedance25.extend')}</button>)}</div>
        {model && <>
            <p className="text-sm text-vx-fg-muted">{t('app.seedance25.cap')}</p>
            <label className="block text-sm">{t('app.seedance25.prompt')}<textarea className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base p-2" maxLength={30000}
                disabled={busy || attempted} value={prompt} onChange={e => { setPrompt(e.target.value); setQuote(null); }} /></label>
            <p className="text-xs text-vx-fg-muted">{t('app.seedance25.rights')}</p>
            {quote && <p role="status">{t('app.seedance25.price', { credits: quote.credits })}</p>}
            <button type="button" className="min-h-11 rounded-lg bg-vx-accent px-4 text-vx-accent-ink" disabled={busy || !prompt.trim()}
                onClick={() => run(!!quote)}>{t(busy ? 'app.seedance25.wait' : attempted ? 'app.seedance25.retry' : quote ? 'app.seedance25.confirm' : 'app.seedance25.quote')}</button>
        </>}
        {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
    </div>;
}

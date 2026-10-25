'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import NetworkLogo from '../../../veyrnox/app/publish/NetworkLogo';
import { Main } from '../../../veyrnox/_components/Main';

const button = 'rounded-full border border-vx-border px-5 py-2.5 text-sm font-bold disabled:opacity-50';

export default function SocialReviewPage() {
  const { t, locale } = useI18n();
    const { token } = useParams();
    const [review, setReview] = useState(null);
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        fetch(`/api/social/approvals/${encodeURIComponent(token)}`, { cache: 'no-store' })
            .then(async (response) => { if (!response.ok) throw new Error('load'); return response.json(); })
            .then((data) => { if (active) setReview(data); })
            .catch(() => { if (active) setError(t('social.review.invalid')); });
        return () => { active = false; };
    }, [token, t]);

    async function decide(decision) {
        setBusy(decision); setError('');
        try {
            const response = await fetch(`/api/social/approvals/${encodeURIComponent(token)}`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, comment }),
            });
            if (!response.ok) throw new Error('decision');
            const result = await response.json();
            setReview((current) => ({ ...current, decision: result.decision, request_status: result.request_status }));
        } catch { setError(t('social.review.saveError')); }
        finally { setBusy(''); }
    }

    return <Main className="mx-auto min-h-screen max-w-2xl px-4 py-12 sm:px-8">
        <div className="mb-8"><div className="text-sm font-black tracking-[0.18em] text-vx-accent">VEYRNOX PUBLISH</div><h1 className="mt-2 text-3xl font-black">{t('social.review.title')}</h1></div>
        {error && <p role="alert" className="rounded-xl border border-vx-danger/50 p-4 text-sm text-vx-danger">{error}</p>}
        {!review && !error && <p className="text-sm text-vx-fg-muted">{t('social.review.loading')}</p>}
        {review && <article className="space-y-5 rounded-2xl border border-vx-border p-5">
            <div><p className="text-xs font-bold uppercase tracking-wide text-vx-fg-muted">{t('social.brand')}</p><p className="font-bold">{review.brand_name}</p></div>
            <div className="flex flex-wrap gap-2">{(review.networks || []).map((network) => <span key={network} className="inline-flex items-center gap-2 rounded-full border border-vx-border px-3 py-1 text-sm font-bold"><NetworkLogo network={network} className="h-4 w-4" />{network}</span>)}</div>
            <ol className="space-y-3">{(review.attachments || (review.media ? [review.media] : [])).map((media, index) => <li key={index}>
                <p>{t('app.publish.carousel.item', { count: index + 1 })}</p>
                {media.held || !media.preview_url ? <p>{t('app.publish.carousel.unavailable')}</p> : media.media_type === 'video'
                    ? <video src={media.preview_url} controls playsInline className="max-h-[420px] w-full rounded-xl bg-black object-contain" />
                    : <img src={media.preview_url} alt={t('social.preview')} className="max-h-[420px] w-full rounded-xl object-contain" />}
            </li>)}</ol>
            {(review.targets || []).length > 0 ? <div className="space-y-3">{review.targets.map((target) => <section key={target.network} className="rounded-xl border border-vx-border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-bold"><NetworkLogo network={target.network} className="h-4 w-4" />{target.network}</div>
                <p className="whitespace-pre-wrap text-sm text-vx-fg-body">{target.text}</p>
            </section>)}</div> : review.global_text && <p className="whitespace-pre-wrap text-sm text-vx-fg-body">{review.global_text}</p>}
            <p className="text-xs text-vx-fg-muted">{t('social.review.planned', { date: new Date(review.scheduled_at).toLocaleString(localeTag(locale)) })} {review.policy === 'all' ? t('social.review.all') : t('social.review.one')}</p>
            {review.decision === 'pending' && review.request_status === 'pending' ? <>
                <div><label htmlFor="review-comment" className="mb-2 block text-sm font-bold">{t('social.comment')}</label><textarea id="review-comment" rows={3} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} className="w-full rounded-xl border border-vx-border bg-transparent p-3 text-sm" /></div>
                <div className="flex flex-wrap gap-3"><button type="button" disabled={Boolean(busy)} className={`${button} border-vx-danger text-vx-danger`} onClick={() => decide('rejected')}>{busy === 'rejected' ? t('social.saving') : t('social.reject')}</button><button type="button" disabled={Boolean(busy)} className="rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black disabled:opacity-50" onClick={() => decide('approved')}>{busy === 'approved' ? t('social.saving') : t('social.approve')}</button></div>
            </> : <p role="status" className="rounded-xl bg-vx-panel p-4 text-sm font-bold">{t('social.review.result', { decision: tOr(t, `social.status.${review.decision}`, review.decision), status: tOr(t, `social.status.${review.request_status}`, review.request_status) })}</p>}
        </article>}
    </Main>;
}

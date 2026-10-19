'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../components/I18nProvider';

import { useCallback, useEffect, useState } from 'react';
import { listSocialApprovals } from '../../../lib/socialPostsClient.js';

const statusTone = { approved: 'text-vx-accent', rejected: 'text-vx-danger', pending: 'text-vx-fg-muted', canceled: 'text-vx-fg-muted' };

export function ApprovalRequests({ refreshToken }) {
  const { t, locale } = useI18n();
    const [requests, setRequests] = useState(null);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState('');
    const load = useCallback(async () => {
        setError('');
        try { const result = await listSocialApprovals(); setRequests(result.requests || []); }
        catch { setError(t("app.publish.approvals.loadFailed")); }
    }, [t]);
    useEffect(() => { load(); }, [load, refreshToken]);

    async function copy(reviewer) {
        try { await navigator.clipboard.writeText(reviewer.url); setCopied(reviewer.id); }
        catch { setError(t("app.publish.approvals.copyFailed")); }
    }

    if (requests === null && !error) return <p className="text-sm text-vx-fg-muted">{t("app.publish.approvals.loading")}</p>;
    return <div className="space-y-3">
        {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
        {requests?.length === 0 && <p className="text-sm text-vx-fg-muted">{t("app.publish.approvals.empty")}</p>}
        {(requests || []).map((request) => <article key={request.id} className="rounded-xl border border-vx-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold">{request.global_text || t("app.publish.approvals.noCaption")}</p><p className="mt-1 text-xs text-vx-fg-muted">{t('app.publish.approvals.planned', { date: new Date(request.scheduled_at).toLocaleString(localeTag(locale)) })} · {request.policy === 'all' ? t("app.publish.approvals.everyone") : t("app.publish.approvals.oneEnough")}</p></div><span className={`text-xs font-black uppercase ${statusTone[request.status] || 'text-vx-fg-muted'}`}>{tOr(t, `app.publish.status.${request.status}`, request.status)}</span></div>
            <ul className="mt-3 space-y-2">{(request.reviewers || []).map((reviewer) => <li key={reviewer.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{reviewer.email} · <strong className={statusTone[reviewer.decision]}>{tOr(t, `app.publish.status.${reviewer.decision}`, reviewer.decision)}</strong></span><button type="button" disabled={request.status !== 'pending'} onClick={() => copy(reviewer)} className="font-bold text-vx-accent underline disabled:opacity-40">{copied === reviewer.id ? t("common.copied") : t("app.publish.common.copyLink")}</button></li>)}</ul>
        </article>)}
    </div>;
}

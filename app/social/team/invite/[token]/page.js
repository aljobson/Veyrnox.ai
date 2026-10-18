'use client';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getStoredUserId, onSessionChange } from '../../../../lib/authClient';
import { acceptSocialTeamInvite } from '../../../../lib/socialTeamClient';
import { Main } from '../../../../veyrnox/_components/Main';

const currentAccount = () => getStoredUserId() || '';
const noAccount = () => '';

export default function TeamInvitationPage() {
  const { t, locale } = useI18n();
    const { token } = useParams();
    const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
    const [invite, setInvite] = useState(null);
    const [busy, setBusy] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        fetch(`/api/social/team/${encodeURIComponent(token)}`, { cache: 'no-store' })
            .then(async (response) => { if (!response.ok) throw new Error('load'); return response.json(); })
            .then((data) => { if (active) setInvite(data); })
            .catch(() => { if (active) setError(t('social.invite.invalid')); });
        return () => { active = false; };
    }, [token, t]);
    async function accept() {
        if (!account) { window.dispatchEvent(new CustomEvent('veyrnox:auth-required')); return; }
        setBusy(true); setError('');
        try { await acceptSocialTeamInvite(token); setAccepted(true); }
        catch (next) { setError(next?.status === 403 ? t('social.invite.emailRequired', { email: invite.email }) : t('social.invite.failed')); }
        finally { setBusy(false); }
    }
    return <Main className="mx-auto min-h-screen max-w-xl px-4 py-12 sm:px-8"><div className="text-sm font-black tracking-[0.18em] text-vx-accent">VEYRNOX PUBLISH</div><h1 className="mt-2 text-3xl font-black">{t('social.invite.title')}</h1>
        {error && <p role="alert" className="mt-6 rounded-xl border border-vx-danger/50 p-4 text-sm text-vx-danger">{error}</p>}
        {!invite && !error && <p className="mt-6 text-sm text-vx-fg-muted">{t('social.invite.loading')}</p>}
        {invite && !accepted && <article className="mt-6 space-y-4 rounded-2xl border border-vx-border p-6"><div><p className="text-xs font-bold uppercase tracking-wider text-vx-fg-muted">{t('social.brand')}</p><p className="text-xl font-black">{invite.brand_name}</p></div><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-bold">{t('social.invite.email')}</dt><dd>{invite.email}</dd></div><div><dt className="font-bold">{t('social.role')}</dt><dd className="capitalize">{tOr(t, `social.role.${invite.role}`, invite.role)}</dd></div></dl><p className="text-xs text-vx-fg-muted">{t('social.invite.expires', { date: new Date(invite.expires_at).toLocaleString(localeTag(locale)) })}</p>{invite.status === 'pending' ? <button type="button" disabled={busy} onClick={accept} className="rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black disabled:opacity-50">{busy ? t('social.invite.joining') : account ? t('social.invite.accept') : t('social.invite.signIn')}</button> : <p className="rounded-xl bg-vx-panel p-4 text-sm font-bold">{t('social.invite.status', { status: tOr(t, `social.status.${invite.status}`, invite.status) })}</p>}</article>}
        {accepted && <section className="mt-6 rounded-2xl border border-vx-accent/40 p-6"><h2 className="text-xl font-black">{t('social.invite.joined', { brand: invite.brand_name })}</h2><p className="mt-2 text-sm text-vx-fg-body">{t('social.invite.access', { role: tOr(t, `social.role.${invite.role}`, invite.role) })}</p><Link href="/app/publish" className="mt-5 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">{t('social.open')}</Link></section>}
    </Main>;
}

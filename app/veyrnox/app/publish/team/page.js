'use client';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { changeSocialTeamMember, inviteSocialTeamMember, listSocialTeam, revokeSocialTeamInvite } from '../../../../lib/socialTeamClient';
import BrandSwitcher from '../BrandSwitcher';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const roles = ['manager', 'editor', 'reviewer', 'analyst', 'viewer'];
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const control = 'rounded-xl border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';

export default function PublishTeamPage() {
  const { t } = useI18n();
    const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
    return <><AppNav /><Main className="mx-auto max-w-[1000px] px-4 py-10 sm:px-8">
        <nav aria-label={t("label.Publish")} className="mb-2 flex flex-wrap gap-4 text-sm"><Link href="/app/publish" className="text-vx-accent underline">Veyrnox.ai Publish</Link><Link href="/app/publish/analytics" className="text-vx-accent underline">{t("publish.f7.name")}</Link><Link href="/app/publish/activity" className="text-vx-accent underline">{t("app.publish.nav.activity")}</Link></nav>
        <h1 data-testid="publish-team-title" className="text-3xl font-black">{t("app.publish.nav.team")}</h1>
        <p className="mt-2 mb-4 text-sm text-vx-fg-muted">{t("app.publish.team.intro")}</p>
        {account && <BrandSwitcher />}
        {account ? <TeamDashboard key={account} /> : <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button>}
    </Main></>;
}

function TeamDashboard() {
  const { t, locale } = useI18n();
  const roleLabel = role => tOr(t, `app.publish.role.${role}`, role);
    const [team, setTeam] = useState(null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('editor');
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [createdLink, setCreatedLink] = useState('');
    const load = useCallback(() => {
        setError('');
        return listSocialTeam().then(setTeam).catch((next) => {
            setError(next?.status === 402 ? t("app.publish.team.plan") : next?.status === 403 ? t("app.publish.team.denied") : t("app.publish.team.loadFailed"));
        });
    }, [t]);
    useEffect(() => { load(); }, [load]);

    async function invite(event) {
        event.preventDefault(); setBusy('invite'); setMessage(''); setError('');
        try {
            const result = await inviteSocialTeamMember(email, role, team.brand_id);
            setCreatedLink(result.invitation.url); setEmail('');
            let copied = false;
            try { await navigator.clipboard.writeText(result.invitation.url); copied = true; } catch { /* The visible link remains copyable. */ }
            setMessage(copied ? t('app.publish.team.copied', { email: result.invitation.email }) : t('app.publish.team.created', { email: result.invitation.email }));
            await load();
        } catch (next) {
            setError(next?.body?.error === 'MEMBER_EXISTS' ? t("app.publish.team.memberExists") : next?.body?.error === 'INVITE_EXISTS' ? t("app.publish.team.inviteExists") : t("app.publish.team.inviteFailed"));
        } finally { setBusy(''); }
    }

    async function update(member, action, nextRole) {
        setBusy(member.user_id); setMessage(''); setError('');
        try { await changeSocialTeamMember(team.brand_id, member.user_id, action, nextRole); setMessage(action === 'remove' ? t('app.publish.team.removed', { email: member.email }) : t('app.publish.team.roleChanged', { email: member.email, role: roleLabel(nextRole) })); await load(); }
        catch { setError(t("app.publish.team.changeFailed")); }
        finally { setBusy(''); }
    }

    async function revoke(invite) {
        setBusy(invite.id); setMessage(''); setError('');
        try { await revokeSocialTeamInvite(team.brand_id, invite.id); setMessage(t('app.publish.team.revoked', { email: invite.email })); await load(); }
        catch { setError(t("app.publish.team.revokeFailed")); }
        finally { setBusy(''); }
    }
    async function copy(url, recipient) {
        setCreatedLink(url);
        try { await navigator.clipboard.writeText(url); setMessage(t('app.publish.team.copied', { email: recipient })); }
        catch { setMessage(t('app.publish.team.copyBelow', { email: recipient })); }
    }

    if (!team && !error) return <p className="text-sm text-vx-fg-muted">{t("app.publish.team.loading")}</p>;
    if (!team) return <p role="alert" className="rounded-xl border border-vx-danger/40 p-4 text-sm text-vx-danger">{error}</p>;
    const canGrantManagers = team.actor_role === 'owner';
    return <div className="space-y-6">
        <section className="rounded-2xl border border-vx-border p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-vx-fg-muted">{t("social.brand")}</p><h2 className="mt-1 text-xl font-black">{team.brand_name}</h2><p className="mt-1 text-sm text-vx-fg-muted">{t('app.publish.team.yourRole', { role: roleLabel(team.actor_role) })}</p>
        </section>
        <form data-testid="publish-team-form" onSubmit={invite} className="rounded-2xl border border-vx-border p-5">
            <h2 className="font-black">{t("app.publish.team.invite")}</h2><p className="mt-1 text-sm text-vx-fg-muted">{t("app.publish.team.expiry")}</p>
            <div className="mt-4 flex flex-wrap items-end gap-3"><label className="grid min-w-64 flex-1 gap-1 text-sm font-bold">{t("authGate.email")}<input data-testid="publish-team-email" required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={control} /></label>
                <label className="grid gap-1 text-sm font-bold">{t("social.role")}<select value={role} onChange={(event) => setRole(event.target.value)} className={control}>{roles.filter((item) => canGrantManagers || item !== 'manager').map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</select></label>
                <button data-testid="publish-team-invite" className={`${button} border-vx-accent bg-vx-accent text-black`} disabled={busy === 'invite'}>{busy === 'invite' ? t("app.publish.developer.creating") : t("app.publish.team.create")}</button></div>
        </form>
        {message && <p role="status" className="rounded-xl bg-vx-panel p-4 text-sm font-bold">{message}</p>}{createdLink && <label className="grid gap-1 text-sm font-bold">{t("app.publish.team.link")}<input readOnly value={createdLink} onFocus={(event) => event.target.select()} className={control} /></label>}{error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
        <section className="rounded-2xl border border-vx-border p-5"><h2 className="font-black">{t("app.publish.team.members")}</h2><ul className="mt-4 divide-y divide-vx-border">{team.members.map((member) => <li key={member.user_id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-56 flex-1"><p className="font-bold">{member.email}</p><p className="text-xs text-vx-fg-muted">{t('app.publish.team.joined', { date: new Date(member.joined_at).toLocaleDateString(localeTag(locale)) })}</p></div>{member.role === 'owner' ? <span className="rounded-full border border-vx-border px-3 py-1 text-xs font-bold">{t("app.publish.team.owner")}</span> : <><select aria-label={t('app.publish.team.memberRole', { email: member.email })} value={member.role} disabled={busy === member.user_id || team.actor_role === 'manager' && member.role === 'manager'} onChange={(event) => update(member, 'role', event.target.value)} className={control}>{roles.filter((item) => canGrantManagers || item !== 'manager').map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</select><button type="button" className={button} disabled={busy === member.user_id || team.actor_role === 'manager' && member.role === 'manager'} onClick={() => update(member, 'remove')}>{t("app.publish.smartlink.remove")}</button></>}</li>)}</ul></section>
        <section className="rounded-2xl border border-vx-border p-5"><h2 className="font-black">{t("app.publish.team.pending")}</h2>{team.invitations.length === 0 ? <p className="mt-3 text-sm text-vx-fg-muted">{t("app.publish.team.noPending")}</p> : <ul className="mt-4 divide-y divide-vx-border">{team.invitations.map((invite) => <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-56 flex-1"><p className="font-bold">{invite.email}</p><p className="text-xs text-vx-fg-muted">{t('app.publish.team.expires', { role: roleLabel(invite.role), date: new Date(invite.expires_at).toLocaleString(localeTag(locale)) })}</p></div><button type="button" className={button} onClick={() => copy(invite.url, invite.email)}>{t("app.publish.common.copyLink")}</button><button type="button" className={button} disabled={busy === invite.id || team.actor_role === 'manager' && invite.role === 'manager'} onClick={() => revoke(invite)}>{t("app.publish.developer.revoke")}</button></li>)}</ul>}</section>
    </div>;
}

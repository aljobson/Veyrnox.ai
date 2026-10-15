'use client';

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
    const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
    return <><AppNav /><Main className="mx-auto max-w-[1000px] px-4 py-10 sm:px-8">
        <nav aria-label="Publish" className="mb-2 flex flex-wrap gap-4 text-sm"><Link href="/app/publish" className="text-vx-accent underline">Veyrnox Publish</Link><Link href="/app/publish/analytics" className="text-vx-accent underline">Analytics</Link><Link href="/app/publish/activity" className="text-vx-accent underline">Activity</Link></nav>
        <h1 className="text-3xl font-black">Team</h1>
        <p className="mt-2 mb-4 text-sm text-vx-fg-muted">Invite people to your brand, assign clear roles and keep access under your control.</p>
        {account && <BrandSwitcher />}
        {account ? <TeamDashboard key={account} /> : <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>}
    </Main></>;
}

function TeamDashboard() {
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
            setError(next?.status === 402 ? 'The team workspace is included with the Publish Plan.' : next?.status === 403 ? 'Your role cannot manage this team.' : 'Could not load the team. Check your connection and try again.');
        });
    }, []);
    useEffect(() => { load(); }, [load]);

    async function invite(event) {
        event.preventDefault(); setBusy('invite'); setMessage(''); setError('');
        try {
            const result = await inviteSocialTeamMember(email, role, team.brand_id);
            setCreatedLink(result.invitation.url); setEmail('');
            let copied = false;
            try { await navigator.clipboard.writeText(result.invitation.url); copied = true; } catch { /* The visible link remains copyable. */ }
            setMessage(copied ? `Invitation link copied for ${result.invitation.email}.` : `Invitation created for ${result.invitation.email}. Copy its link below.`);
            await load();
        } catch (next) {
            setError(next?.body?.error === 'MEMBER_EXISTS' ? 'That person is already on the team.' : next?.body?.error === 'INVITE_EXISTS' ? 'A pending invitation already exists for that email.' : 'Could not create the invitation.');
        } finally { setBusy(''); }
    }

    async function update(member, action, nextRole) {
        setBusy(member.user_id); setMessage(''); setError('');
        try { await changeSocialTeamMember(team.brand_id, member.user_id, action, nextRole); setMessage(action === 'remove' ? `${member.email} was removed.` : `${member.email} is now ${nextRole}.`); await load(); }
        catch { setError('That team change could not be saved.'); }
        finally { setBusy(''); }
    }

    async function revoke(invite) {
        setBusy(invite.id); setMessage(''); setError('');
        try { await revokeSocialTeamInvite(team.brand_id, invite.id); setMessage(`Invitation for ${invite.email} was revoked.`); await load(); }
        catch { setError('That invitation could not be revoked.'); }
        finally { setBusy(''); }
    }
    async function copy(url, recipient) {
        setCreatedLink(url);
        try { await navigator.clipboard.writeText(url); setMessage(`Invitation link copied for ${recipient}.`); }
        catch { setMessage(`Copy the invitation link for ${recipient} below.`); }
    }

    if (!team && !error) return <p className="text-sm text-vx-fg-muted">Loading your team…</p>;
    if (!team) return <p role="alert" className="rounded-xl border border-vx-danger/40 p-4 text-sm text-vx-danger">{error}</p>;
    const canGrantManagers = team.actor_role === 'owner';
    return <div className="space-y-6">
        <section className="rounded-2xl border border-vx-border p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-vx-fg-muted">Brand</p><h2 className="mt-1 text-xl font-black">{team.brand_name}</h2><p className="mt-1 text-sm text-vx-fg-muted">Your role: {team.actor_role}</p>
        </section>
        <form onSubmit={invite} className="rounded-2xl border border-vx-border p-5">
            <h2 className="font-black">Invite a team member</h2><p className="mt-1 text-sm text-vx-fg-muted">Links expire after seven days and only work for the invited email address.</p>
            <div className="mt-4 flex flex-wrap items-end gap-3"><label className="grid min-w-64 flex-1 gap-1 text-sm font-bold">Email<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={control} /></label>
                <label className="grid gap-1 text-sm font-bold">Role<select value={role} onChange={(event) => setRole(event.target.value)} className={control}>{roles.filter((item) => canGrantManagers || item !== 'manager').map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <button className={`${button} border-vx-accent bg-vx-accent text-black`} disabled={busy === 'invite'}>{busy === 'invite' ? 'Creating…' : 'Create invitation'}</button></div>
        </form>
        {message && <p role="status" className="rounded-xl bg-vx-panel p-4 text-sm font-bold">{message}</p>}{createdLink && <label className="grid gap-1 text-sm font-bold">Invitation link<input readOnly value={createdLink} onFocus={(event) => event.target.select()} className={control} /></label>}{error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
        <section className="rounded-2xl border border-vx-border p-5"><h2 className="font-black">Members</h2><ul className="mt-4 divide-y divide-vx-border">{team.members.map((member) => <li key={member.user_id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-56 flex-1"><p className="font-bold">{member.email}</p><p className="text-xs text-vx-fg-muted">Joined {new Date(member.joined_at).toLocaleDateString()}</p></div>{member.role === 'owner' ? <span className="rounded-full border border-vx-border px-3 py-1 text-xs font-bold">Owner</span> : <><select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy === member.user_id || team.actor_role === 'manager' && member.role === 'manager'} onChange={(event) => update(member, 'role', event.target.value)} className={control}>{roles.filter((item) => canGrantManagers || item !== 'manager').map((item) => <option key={item} value={item}>{item}</option>)}</select><button type="button" className={button} disabled={busy === member.user_id || team.actor_role === 'manager' && member.role === 'manager'} onClick={() => update(member, 'remove')}>Remove</button></>}</li>)}</ul></section>
        <section className="rounded-2xl border border-vx-border p-5"><h2 className="font-black">Pending invitations</h2>{team.invitations.length === 0 ? <p className="mt-3 text-sm text-vx-fg-muted">No pending invitations.</p> : <ul className="mt-4 divide-y divide-vx-border">{team.invitations.map((invite) => <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-56 flex-1"><p className="font-bold">{invite.email}</p><p className="text-xs text-vx-fg-muted">{invite.role} · expires {new Date(invite.expires_at).toLocaleString()}</p></div><button type="button" className={button} onClick={() => copy(invite.url, invite.email)}>Copy link</button><button type="button" className={button} disabled={busy === invite.id || team.actor_role === 'manager' && invite.role === 'manager'} onClick={() => revoke(invite)}>Revoke</button></li>)}</ul>}</section>
    </div>;
}

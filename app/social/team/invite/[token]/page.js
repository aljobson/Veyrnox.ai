'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getStoredUserId, onSessionChange } from '../../../../lib/authClient';
import { acceptSocialTeamInvite } from '../../../../lib/socialTeamClient';
import { Main } from '../../../../veyrnox/_components/Main';

const currentAccount = () => getStoredUserId() || '';
const noAccount = () => '';

export default function TeamInvitationPage() {
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
            .catch(() => { if (active) setError('This team invitation is invalid, expired or no longer available.'); });
        return () => { active = false; };
    }, [token]);
    async function accept() {
        if (!account) { window.dispatchEvent(new CustomEvent('veyrnox:auth-required')); return; }
        setBusy(true); setError('');
        try { await acceptSocialTeamInvite(token); setAccepted(true); }
        catch (next) { setError(next?.status === 403 ? `Sign in with ${invite.email} to accept this invitation.` : 'This invitation could not be accepted.'); }
        finally { setBusy(false); }
    }
    return <Main className="mx-auto min-h-screen max-w-xl px-4 py-12 sm:px-8"><div className="text-sm font-black tracking-[0.18em] text-vx-accent">VEYRNOX PUBLISH</div><h1 className="mt-2 text-3xl font-black">Join a brand team</h1>
        {error && <p role="alert" className="mt-6 rounded-xl border border-vx-danger/50 p-4 text-sm text-vx-danger">{error}</p>}
        {!invite && !error && <p className="mt-6 text-sm text-vx-fg-muted">Loading invitation…</p>}
        {invite && !accepted && <article className="mt-6 space-y-4 rounded-2xl border border-vx-border p-6"><div><p className="text-xs font-bold uppercase tracking-wider text-vx-fg-muted">Brand</p><p className="text-xl font-black">{invite.brand_name}</p></div><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-bold">Invited email</dt><dd>{invite.email}</dd></div><div><dt className="font-bold">Role</dt><dd className="capitalize">{invite.role}</dd></div></dl><p className="text-xs text-vx-fg-muted">Expires {new Date(invite.expires_at).toLocaleString()}.</p>{invite.status === 'pending' ? <button type="button" disabled={busy} onClick={accept} className="rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black disabled:opacity-50">{busy ? 'Joining…' : account ? 'Accept invitation' : 'Sign in to accept'}</button> : <p className="rounded-xl bg-vx-panel p-4 text-sm font-bold">This invitation is {invite.status}.</p>}</article>}
        {accepted && <section className="mt-6 rounded-2xl border border-vx-accent/40 p-6"><h2 className="text-xl font-black">You joined {invite.brand_name}</h2><p className="mt-2 text-sm text-vx-fg-body">Your {invite.role} access is ready.</p><Link href="/app/publish" className="mt-5 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">Open Veyrnox.ai Publish</Link></section>}
    </Main>;
}

'use client';
import { useState } from 'react';
import { connectBluesky } from '../../../lib/socialConnectClient.js';

export default function BlueskyConnect({ onConnected, onCancel }) {
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function submit(event) {
        event.preventDefault();
        setError(''); setBusy(true);
        const appPassword = password;
        setPassword('');
        try {
            await connectBluesky(identifier.trim(), appPassword);
            await onConnected();
        } catch (err) {
            setError(err.body?.code === 'ACCOUNT_LIMIT' ? (err.body.limit === 5 ? 'You have reached the five-account free limit. Disconnect an account first.' : 'Your plan connects one account. Disconnect it first.')
                : err.body?.stage === 'record_account' ? 'Bluesky sign-in succeeded, but Veyrnox could not save the connection. Please try again later.'
                : err.body?.stage === 'provider_session' && !['provider_request_failed_400', 'provider_request_failed_401'].includes(err.body?.code) ? 'Veyrnox could not complete the Bluesky connection. Please try again later.'
                : 'Could not connect. Check your handle and app password, then try again.');
        } finally { setBusy(false); }
    }
    return <form onSubmit={submit} className="space-y-3 rounded-xl border border-vx-border p-4">
        <h3 className="font-bold">Connect Bluesky</h3>
        <p className="text-sm text-vx-fg-muted">Create a dedicated app password in Bluesky Settings → Privacy and security → App passwords. Use your handle and that app password here.</p>
        <label className="block text-sm">Bluesky handle
            <input required autoComplete="off" value={identifier} onChange={(e) => setIdentifier(e.target.value)} maxLength={253}
                placeholder="you.bsky.social" className="mt-1 w-full rounded-lg border border-vx-border bg-transparent p-2" />
        </label>
        <label className="block text-sm">App password
            <input required type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={19}
                pattern="[a-z0-9]{4}(-[a-z0-9]{4}){3}" title="Use the four groups of letters and numbers from your Bluesky app password, separated by hyphens." className="mt-1 w-full rounded-lg border border-vx-border bg-transparent p-2" />
        </label>
        {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
        <div className="flex gap-3">
            <button disabled={busy} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{busy ? 'Connecting…' : 'Connect Bluesky'}</button>
            <button type="button" disabled={busy} onClick={onCancel} className="rounded-full border border-vx-border px-4 py-2 text-sm font-bold">Cancel</button>
        </div>
    </form>;
}

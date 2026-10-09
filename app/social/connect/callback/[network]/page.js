'use client';

// Every live network's OAuth redirect target — app/api/v1/social/accounts/
// :network/{connect,callback}/route.js each hard-code their own
// CALLBACK_PATH as `/social/connect/callback/${network}`; this page reads
// that same network back out of its own URL. Mirrors app/auth/callback/
// page.js's shape: a bare landing page, no nav, that exchanges the
// one-time code and sends the browser back into the app.

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { NETWORKS, completeNetworkConnect, selectNetworkResource } from '../../../../lib/socialConnectClient.js';

const TRY_AGAIN = 'Nothing was connected. Go back and try again.';
const ERROR_COPY = {
    NO_YOUTUBE_CHANNEL: 'That Google account has no YouTube channel. Create a channel on that account, then try again.',
    ACCOUNT_LIMIT: 'Your plan connects one account. Disconnect the one you have, then try again.',
    NO_ELIGIBLE_RESOURCE: 'No eligible Page, board or business location was found. Check the access you granted and try again.',
    selection_expired: 'This selection has expired. Start connecting again.',
    VERIFIER_MISSING: `This was opened in a different browser or tab than where you started connecting. ${TRY_AGAIN}`,
    invalid_state: `This connection link was already used or has expired. ${TRY_AGAIN}`,
    not_authenticated: `You were signed out before this finished. Sign in, then ${TRY_AGAIN.toLowerCase()}`,
};

function networkLabel(key) {
    return NETWORKS.find((n) => n.key === key)?.label || key;
}

export default function SocialConnectCallback() {
    const { network } = useParams();
    const [status, setStatus] = useState('Connecting your account…');
    const [failed, setFailed] = useState(false);
    const [selection, setSelection] = useState(null);
    const [resourceId, setResourceId] = useState('');
    const [busy, setBusy] = useState(false);
    const started = useRef(null);

    useEffect(() => {
        if (started.current === network) return;
        started.current = network;
        if (!network || !NETWORKS.some((n) => n.key === network)) {
            setStatus(`Unrecognized network. ${TRY_AGAIN}`);
            setFailed(true);
            return;
        }
        const fail = (message) => { setStatus(message); setFailed(true); };
        if (!new URL(window.location.href).searchParams.get('code')) {
            fail(`This page was opened without a connection response. ${TRY_AGAIN}`);
            return;
        }
        completeNetworkConnect(network)
            .then((result) => {
                if (result?.selectionId && result?.choices?.length) {
                    setSelection(result);
                    setStatus(`Choose a ${NETWORKS.find((n) => n.key === network)?.resource || 'destination'} to connect.`);
                } else if (result && result.ok) {
                    setStatus(`Connected ${networkLabel(network)}. Redirecting…`);
                    window.location.replace('/app/publish');
                } else {
                    const code = result && result.code;
                    console.error('[social-connect-callback] connect failed', network, code);
                    fail(ERROR_COPY[code] || `${networkLabel(network)} could not be connected. ${TRY_AGAIN}`);
                }
            })
            .catch((err) => {
                console.error('[social-connect-callback] unexpected failure', network, err);
                fail(`${networkLabel(network)} could not be connected. ${TRY_AGAIN}`);
            });
    }, [network]);

    async function choose(event) {
        event.preventDefault(); setBusy(true); setFailed(false);
        try {
            const result = await selectNetworkResource(network, selection.selectionId, resourceId);
            if (!result.ok) throw new Error(result.code);
            window.location.replace('/app/publish');
        } catch (err) {
            setStatus(ERROR_COPY[err.body?.error || err.body?.code || err.message] || `Could not connect that destination. ${TRY_AGAIN}`);
            setFailed(true); setSelection(null);
        } finally { setBusy(false); }
    }

    return (
        <div className="min-h-screen bg-vx-base text-vx-fg flex items-center justify-center px-6">
            <div className="text-center max-w-sm">
                <div className="text-sm text-zinc-400">{status}</div>
                {selection && <form onSubmit={choose} className="mt-4 space-y-4">
                    <label className="block text-sm">Destination
                        <select required value={resourceId} onChange={(e) => setResourceId(e.target.value)} disabled={busy}
                            className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3">
                            <option value="">Choose a destination</option>
                            {selection.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
                        </select>
                    </label>
                    <button disabled={busy || !resourceId} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{busy ? 'Connecting…' : 'Connect destination'}</button>
                </form>}
                {failed && (
                    <a href="/app/publish" className="mt-4 inline-block text-sm text-white underline">Back to Veyrnox Publish</a>
                )}
            </div>
        </div>
    );
}

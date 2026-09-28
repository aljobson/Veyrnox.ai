'use client';

// Every live network's OAuth redirect target — app/api/v1/social/accounts/
// :network/{connect,callback}/route.js each hard-code their own
// CALLBACK_PATH as `/social/connect/callback/${network}`; this page reads
// that same network back out of its own URL. Mirrors app/auth/callback/
// page.js's shape: a bare landing page, no nav, that exchanges the
// one-time code and sends the browser back into the app.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { NETWORKS, completeNetworkConnect } from '../../../../lib/socialConnectClient.js';

const TRY_AGAIN = 'Nothing was connected. Go back and try again.';
const ERROR_COPY = {
    NO_LINKED_INSTAGRAM_ACCOUNT: 'That Facebook account has no linked Instagram Business or Creator account. Convert your Instagram account to a Business or Creator account, link it to a Facebook Page, then try again.',
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

    useEffect(() => {
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
                if (result && result.ok) {
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

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
            <div className="text-center max-w-sm">
                <div className="text-sm text-zinc-400">{status}</div>
                {failed && (
                    <a href="/app/publish" className="mt-4 inline-block text-sm text-white underline">Back to Veyrnox Publish</a>
                )}
            </div>
        </div>
    );
}

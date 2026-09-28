'use client';

// Instagram's OAuth redirect target — the exact path app/api/v1/social/
// accounts/instagram/{connect,callback}/route.js both hard-code as
// CALLBACK_PATH. Mirrors app/auth/callback/page.js's shape: a bare landing
// page, no nav, that exchanges the one-time code and sends the browser
// back into the app.

import { useEffect, useState } from 'react';
import { completeInstagramConnect } from '../../../lib/socialConnectClient.js';

const TRY_AGAIN = 'Nothing was connected. Go back and try again.';
const ERROR_COPY = {
    NO_LINKED_INSTAGRAM_ACCOUNT: 'That Facebook account has no linked Instagram Business or Creator account. Convert your Instagram account to a Business or Creator account, link it to a Facebook Page, then try again.',
    VERIFIER_MISSING: `This was opened in a different browser or tab than where you started connecting. ${TRY_AGAIN}`,
    invalid_state: `This connection link was already used or has expired. ${TRY_AGAIN}`,
    not_authenticated: `You were signed out before this finished. Sign in, then ${TRY_AGAIN.toLowerCase()}`,
};

export default function SocialConnectCallback() {
    const [status, setStatus] = useState('Connecting your account…');
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const fail = (message) => { setStatus(message); setFailed(true); };
        if (!new URL(window.location.href).searchParams.get('code')) {
            fail(`This page was opened without a connection response. ${TRY_AGAIN}`);
            return;
        }
        completeInstagramConnect()
            .then((result) => {
                if (result && result.ok) {
                    setStatus(`Connected @${result.account?.display_name?.replace(/^@/, '') || ''}. Redirecting…`);
                    window.location.replace('/app/publish');
                } else {
                    const code = result && result.code;
                    console.error('[social-connect-callback] connect failed', code);
                    fail(ERROR_COPY[code] || `Instagram could not be connected. ${TRY_AGAIN}`);
                }
            })
            .catch((err) => {
                console.error('[social-connect-callback] unexpected failure', err);
                fail(`Instagram could not be connected. ${TRY_AGAIN}`);
            });
    }, []);

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

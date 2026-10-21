"use client";
import { useI18n } from '../../../components/I18nProvider';

// Sign-in callback (PKCE) for OAuth and for emailed links. Supabase returns a
// one-time `?code=`; we exchange it with the verifier this browser stored
// when it started the flow (app/lib/pkceVerifier.js). Implicit fragment tokens
// are scrubbed and rejected: they do not prove this browser started a sign-in.

import { useEffect, useState } from "react";
import { rejectImplicitCallbackFragment, completeOAuthFromCode, oauthCallbackError } from "../../lib/authClient.js";
import { MAGIC_VERIFIER_TTL_MS } from "../../lib/pkceVerifier.js";
import { safeAuthReturnPath } from "../../lib/authReturn.js";
import { Main } from "../../veyrnox/_components/Main.js";

export default function AuthCallback() {
  const { t, href: localizedHref } = useI18n();
    const [status, setStatus] = useState(t('callback.signingIn'));
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const TRY_AGAIN = t('callback.retry');
        const fail = (message) => { setStatus(message); setFailed(true); };
        const href = window.location.href;
        const requestedNext = new URL(href).searchParams.get('next');
        const next = safeAuthReturnPath(requestedNext) || localizedHref('/');
        if (rejectImplicitCallbackFragment()) {
            fail(t('callback.notStarted', { minutes: Math.round(MAGIC_VERIFIER_TTL_MS / 60000) }));
            return;
        }
        const providerError = oauthCallbackError(href);
        if (providerError) {
            // The provider or our Auth config refused: not a browser problem.
            console.error("[auth-callback] provider returned", providerError);
            fail(t('callback.refused', { retry: TRY_AGAIN }));
            return;
        }
        if (!new URL(href).searchParams.get('code')) {
            fail(t('callback.noResponse', { retry: TRY_AGAIN }));
            return;
        }
        completeOAuthFromCode()
            .then((s) => {
                if (s) {
                    setStatus(t('callback.signedIn'));
                    window.location.replace(next);
                } else {
                    fail(t('callback.notStarted', { minutes: Math.round(MAGIC_VERIFIER_TTL_MS / 60000) }));
                }
            })
            .catch((err) => {
                console.error("[auth-callback] code exchange failed", err?.status, err?.code);
                fail(t('callback.failed', { retry: TRY_AGAIN }));
            });
    }, [t, localizedHref]);
    return (
        <Main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
            <div className="text-center">
                <div className="text-sm text-zinc-400">{status}</div>
                {failed && (
                    <a href={localizedHref('/')} className="mt-4 inline-block text-sm text-white underline">{t('callback.back')}</a>
                )}
            </div>
        </Main>
    );
}

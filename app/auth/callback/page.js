"use client";

// OAuth callback (PKCE). Supabase returns a one-time `?code=`; we exchange
// it with the verifier this browser stored when it started the flow.

import { useEffect, useState } from "react";
import { completeOAuthFromCode, oauthCallbackError } from "../../lib/authClient.js";

const TRY_AGAIN = "Nothing was changed. Go back and try signing in again.";

export default function AuthCallback() {
    const [status, setStatus] = useState("Signing you in…");
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const fail = (message) => { setStatus(message); setFailed(true); };
        const href = window.location.href;
        const providerError = oauthCallbackError(href);
        if (providerError) {
            // The provider or our Auth config refused: not a browser problem.
            console.error("[auth-callback] provider returned", providerError);
            fail(`Sign-in was refused by the provider. ${TRY_AGAIN}`);
            return;
        }
        if (!new URL(href).searchParams.get("code")) {
            fail(`This page was opened without a sign-in response. ${TRY_AGAIN}`);
            return;
        }
        completeOAuthFromCode()
            .then((s) => {
                if (s) {
                    setStatus("Signed in. Redirecting…");
                    window.location.replace("/");
                } else {
                    fail("This sign-in was started in a different browser or tab. Start signing in again here.");
                }
            })
            .catch((err) => {
                console.error("[auth-callback] code exchange failed", err?.status, err?.code);
                fail(`Sign-in could not be completed. ${TRY_AGAIN}`);
            });
    }, []);
    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
            <div className="text-center">
                <div className="text-sm text-zinc-400">{status}</div>
                {failed && (
                    <a href="/" className="mt-4 inline-block text-sm text-white underline">Back to Veyrnox</a>
                )}
            </div>
        </div>
    );
}

"use client";

// Sign-in callback (PKCE) for OAuth and for emailed links. Supabase returns a
// one-time `?code=`; we exchange it with the verifier this browser stored
// when it started the flow (app/lib/pkceVerifier.js).

import { useEffect, useState } from "react";
import { completeOAuthFromCode, oauthCallbackError } from "../../lib/authClient.js";
import { MAGIC_VERIFIER_TTL_MS } from "../../lib/pkceVerifier.js";

const TRY_AGAIN = "Nothing was changed. Go back and try signing in again.";
// No verifier here: an emailed link opened in another browser or on another
// device, or opened after the verifier kept for it had expired.
const NOT_STARTED_HERE = `This sign-in was not started in this browser, or its link is more than ${Math.round(MAGIC_VERIFIER_TTL_MS / 60000)} minutes old. Open the link in the browser where you asked for it, or go back and ask for a new one.`;

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
                    fail(NOT_STARTED_HERE);
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

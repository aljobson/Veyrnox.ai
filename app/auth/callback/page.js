"use client";

// OAuth callback (PKCE). Supabase returns a one-time `?code=`; we exchange
// it with the verifier this browser stored when it started the flow.

import { useEffect, useState } from "react";
import { completeOAuthFromCode } from "../../lib/authClient.js";

export default function AuthCallback() {
    const [status, setStatus] = useState("Signing you in…");
    useEffect(() => {
        completeOAuthFromCode()
            .then((s) => {
                if (s) {
                    setStatus("Signed in. Redirecting…");
                    window.location.replace("/");
                } else {
                    setStatus("This sign-in link is not valid for this browser. Try signing in again.");
                }
            })
            .catch((err) => setStatus(err?.message || "Sign-in failed."));
    }, []);
    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center">
            <div className="text-sm text-zinc-400">{status}</div>
        </div>
    );
}

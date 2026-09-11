"use client";

// OAuth callback. Supabase returns tokens in the URL fragment.

import { useEffect, useState } from "react";
import { completeOAuthFromHash } from "../../lib/authClient.js";

export default function AuthCallback() {
    const [status, setStatus] = useState("Signing you in…");
    useEffect(() => {
        try {
            const s = completeOAuthFromHash();
            if (s) {
                setStatus("Signed in. Redirecting…");
                window.location.replace("/");
            } else {
                setStatus("No auth token in URL. Try signing in again.");
            }
        } catch (err) {
            setStatus(err?.message || "Sign-in failed.");
        }
    }, []);
    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center">
            <div className="text-sm text-zinc-400">{status}</div>
        </div>
    );
}

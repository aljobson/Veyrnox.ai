"use client";

/**
 * AuthGate — inline sign-in / sign-up modal for the studio.
 *
 * Shown when the caller detects no active Supabase session AND the
 * `veyrnox_gateway` feature flag is on. Without a session the
 * /api/v1/* middleware returns 401 and generation fails; this gate
 * gets the user to a session before they try to spend credits.
 *
 * Deliberately minimal: email + password, magic-link fallback, no
 * OAuth. OAuth (Google/Apple) is a Phase-4 add-on with per-provider
 * consent screens and a proper landing page — beyond the Slice 9b
 * exit-gate scope.
 */

import { useEffect, useState } from "react";
import { getSupabase } from "../authClient.js";
import { showError, showSuccess } from "../lib/errorToast.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthGate({ onSignedIn }) {
    const [mode, setMode] = useState("sign_in"); // "sign_in" | "sign_up" | "magic"
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);

    // If a session already exists, close ourselves and hand it back.
    useEffect(() => {
        const supabase = getSupabase();
        supabase.auth.getSession().then(({ data }) => {
            if (data?.session) onSignedIn?.(data.session);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session) onSignedIn?.(session);
        });
        return () => sub.subscription.unsubscribe();
    }, [onSignedIn]);

    async function handleSubmit(e) {
        e.preventDefault();
        setNotice(null);
        if (!EMAIL_RE.test(email)) {
            setNotice({ kind: "error", text: "Enter a valid email address." });
            return;
        }
        if (mode !== "magic" && password.length < 8) {
            setNotice({ kind: "error", text: "Password must be at least 8 characters." });
            return;
        }
        const supabase = getSupabase();
        setBusy(true);
        try {
            if (mode === "sign_up") {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: { emailRedirectTo: window.location.origin },
                });
                if (error) throw error;
                setNotice({ kind: "success", text: "Check your email to confirm your account." });
            } else if (mode === "sign_in") {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                showSuccess("Signed in");
            } else {
                const { error } = await supabase.auth.signInWithOtp({
                    email,
                    options: { emailRedirectTo: window.location.origin },
                });
                if (error) throw error;
                setNotice({ kind: "success", text: "Check your email for a sign-in link." });
            }
        } catch (err) {
            showError(err, mode === "sign_up" ? "Sign-up failed" : "Sign-in failed");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Sign in to Veyrnox"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
        >
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl">
                <h2 className="text-lg font-semibold text-white mb-1">
                    {mode === "sign_up" ? "Create your Veyrnox account" : mode === "magic" ? "Email me a sign-in link" : "Sign in to Veyrnox"}
                </h2>
                <p className="text-sm text-zinc-400 mb-4">
                    New users get 50 free credits. Data stays in the EU (Frankfurt).
                </p>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <label className="block">
                        <span className="text-xs text-zinc-400">Email</span>
                        <input
                            type="email"
                            required
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="mt-1 w-full rounded-lg bg-zinc-800 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                        />
                    </label>

                    {mode !== "magic" && (
                        <label className="block">
                            <span className="text-xs text-zinc-400">Password</span>
                            <input
                                type="password"
                                required
                                autoComplete={mode === "sign_up" ? "new-password" : "current-password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                minLength={8}
                                className="mt-1 w-full rounded-lg bg-zinc-800 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                            />
                        </label>
                    )}

                    {notice && (
                        <div
                            className={`text-xs rounded-md px-3 py-2 ${
                                notice.kind === "error"
                                    ? "bg-red-500/10 text-red-300 border border-red-500/20"
                                    : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                            }`}
                        >
                            {notice.text}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={busy}
                        className="w-full rounded-lg bg-white text-zinc-900 font-semibold py-2 text-sm hover:bg-zinc-200 disabled:opacity-60"
                    >
                        {busy
                            ? "Working…"
                            : mode === "sign_up"
                                ? "Create account"
                                : mode === "magic"
                                    ? "Send magic link"
                                    : "Sign in"}
                    </button>
                </form>

                <div className="mt-4 flex flex-wrap gap-3 text-xs text-zinc-400">
                    {mode !== "sign_in" && (
                        <button type="button" className="underline hover:text-white" onClick={() => setMode("sign_in")}>
                            Have an account? Sign in
                        </button>
                    )}
                    {mode !== "sign_up" && (
                        <button type="button" className="underline hover:text-white" onClick={() => setMode("sign_up")}>
                            New? Create an account
                        </button>
                    )}
                    {mode !== "magic" && (
                        <button type="button" className="underline hover:text-white" onClick={() => setMode("magic")}>
                            Email me a link instead
                        </button>
                    )}
                </div>

                <p className="mt-4 text-[10px] text-zinc-500 leading-tight">
                    By continuing you accept the Veyrnox Terms & Privacy Policy. AI outputs are marked as
                    AI-generated per EU AI Act Article 50.
                </p>
            </div>
        </div>
    );
}

"use client";

/**
 * AuthGate — root-mounted modal listening for veyrnox:auth-required
 * events. Lives under top-level components/ (not packages/studio) so
 * the transpiled-workspace bundle path stays clean — PR #38 bisect.
 *
 * Wire once in app/layout.js. Any studio component that hits a 401 on
 * /api/v1/* dispatches `window.dispatchEvent(new
 * CustomEvent('veyrnox:auth-required'))` and this handler pops the
 * modal.
 */

import { useCallback, useEffect, useState } from "react";
import {
    getSession,
    onSessionChange,
    signInWithPassword,
    signUp,
    sendMagicLink,
    signInWithOAuth,
} from "../app/lib/authClient.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthGate() {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState("sign_in");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    // Which OAuth providers are actually enabled on the Supabase side.
    // Fetching once on first mount avoids showing broken buttons that
    // redirect to a Supabase 400 "provider is not enabled" page.
    const [oauth, setOauth] = useState({ apple: false, google: false });

    useEffect(() => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !anon) return;
        let cancelled = false;
        fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (cancelled || !data) return;
                const ext = data.external || {};
                setOauth({ apple: !!ext.apple, google: !!ext.google });
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Listen for the app-wide "please authenticate" signal.
    useEffect(() => {
        function onAuthRequired(ev) {
            // If a session already exists (race with a refresh), skip.
            if (getSession()) return;
            const wanted = ev && ev.detail && ev.detail.mode;
            if (wanted === "sign_up" || wanted === "sign_in" || wanted === "magic") {
                setMode(wanted);
            }
            setOpen(true);
        }
        window.addEventListener("veyrnox:auth-required", onAuthRequired);
        return () => window.removeEventListener("veyrnox:auth-required", onAuthRequired);
    }, []);

    // Deep-link: /any-route?auth=sign_up|sign_in|magic opens the gate on
    // mount via the same event path (so the getSession() short-circuit
    // still applies). Lets static/marketing CTAs target sign-up directly.
    useEffect(() => {
        const p = new URLSearchParams(window.location.search).get("auth");
        if (p === "sign_up" || p === "sign_in" || p === "magic") {
            window.dispatchEvent(new CustomEvent("veyrnox:auth-required", { detail: { mode: p } }));
        }
    }, []);

    // Close when a session appears (from any tab).
    useEffect(() => {
        return onSessionChange((s) => {
            if (s) setOpen(false);
        });
    }, []);

    const dismiss = useCallback(() => setOpen(false), []);

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
        setBusy(true);
        try {
            if (mode === "sign_up") {
                const { session, needsConfirmation } = await signUp(email, password);
                if (needsConfirmation) {
                    setNotice({ kind: "success", text: "Check your email to confirm your account." });
                } else if (session) {
                    setOpen(false);
                }
            } else if (mode === "sign_in") {
                await signInWithPassword(email, password);
                setOpen(false);
            } else {
                await sendMagicLink(email);
                setNotice({ kind: "success", text: "Check your email for a sign-in link." });
            }
        } catch (err) {
            setNotice({ kind: "error", text: err?.message || "Sign-in failed" });
        } finally {
            setBusy(false);
        }
    }

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Sign in to Veyrnox"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
        >
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl">
                <div className="flex items-start justify-between mb-1">
                    <h2 className="text-lg font-semibold text-white">
                        {mode === "sign_up" ? "Create your account" : mode === "magic" ? "Email sign-in link" : "Sign in to Veyrnox"}
                    </h2>
                    <button
                        type="button"
                        aria-label="Close"
                        onClick={dismiss}
                        className="text-zinc-400 hover:text-white text-xl leading-none"
                    >
                        ×
                    </button>
                </div>
                <p className="text-sm text-zinc-400 mb-4">
                    New users get 50 free credits. Data stays in the EU (Frankfurt).
                </p>

                {(oauth.apple || oauth.google) && (
                    <>
                        <div className="space-y-2 mb-3">
                            {oauth.apple && (
                                <button type="button" onClick={() => signInWithOAuth("apple")} disabled={busy} className="w-full rounded-lg bg-white text-black font-semibold py-2 text-sm hover:bg-zinc-200 disabled:opacity-60">
                                    Continue with Apple
                                </button>
                            )}
                            {oauth.google && (
                                <button type="button" onClick={() => signInWithOAuth("google")} disabled={busy} className="w-full rounded-lg bg-zinc-800 border border-white/10 text-white font-semibold py-2 text-sm hover:bg-zinc-700 disabled:opacity-60">
                                    Continue with Google
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-3 mb-3 text-[10px] text-zinc-500 uppercase tracking-wider">
                            <div className="h-px bg-white/10 flex-1" /> or email <div className="h-px bg-white/10 flex-1" />
                        </div>
                    </>
                )}
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
                    By continuing you accept the Veyrnox <a href="/legal/terms" className="underline hover:text-zinc-300">Terms</a> &amp; <a href="/legal/privacy" className="underline hover:text-zinc-300">Privacy Policy</a>. AI outputs are marked as
                    AI-generated per EU AI Act Article 50.
                </p>
            </div>
        </div>
    );
}

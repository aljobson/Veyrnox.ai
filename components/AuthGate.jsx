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

import { useCallback, useEffect, useRef, useState } from "react";
import {
    getSession,
    onSessionChange,
    signInWithPassword,
    signUp,
    sendMagicLink,
    signInWithOAuth,
} from "../app/lib/authClient.js";
import Turnstile, { TURNSTILE_SITE_KEY } from "./Turnstile.jsx";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GoTrue's strings are developer-facing ("Email rate limit exceeded",
// "AuthApiError: Invalid login credentials"). Translate the ones users
// actually hit; anything unrecognised falls back to a plain sentence rather
// than a raw error object, and the original stays in console.error.
const AUTH_ERROR_COPY = [
    [/invalid login credentials/i, "That email and password don't match. Check both and try again."],
    [/email not confirmed/i, "Confirm your email first — check your inbox for the link."],
    [/rate limit/i, "Too many attempts. Wait a minute and try again."],
    [/user already registered/i, "There's already an account with that email. Try signing in."],
    [/password should be at least/i, "Passwords need at least 8 characters."],
    [/network|fetch|failed to fetch/i, "Couldn't reach the server. Check your connection."],
];

function humanAuthError(err) {
    const raw = err && err.message ? String(err.message) : "";
    if (raw) {
        const hit = AUTH_ERROR_COPY.find(([re]) => re.test(raw));
        if (hit) return hit[1];
        console.error("[auth] unmapped error:", raw);
    }
    return "That didn't work. Try again.";
}

export default function AuthGate() {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState("sign_in");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    // Turnstile (ADR-0026). A token is single-use, so every attempt bumps
    // `attempt`, which remounts the widget for a fresh one.
    const [captchaToken, setCaptchaToken] = useState(null);
    const [attempt, setAttempt] = useState(0);
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

    // This dialog appears unannounced on a 401, so it has to take focus and
    // accept Escape — ConfirmDialog already does both. Without it a keyboard
    // user had to Tab blindly through the whole page to reach the modal that
    // had just appeared, and could not dismiss it.
    const panelRef = useRef(null);
    const closeRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        // Remember where focus was so dismissing returns it, rather than
        // dropping the user at the top of the document.
        const previous = document.activeElement;
        closeRef.current?.focus();
        return () => { if (previous && previous.focus) previous.focus(); };
    }, [open]);

    // Keep Tab inside the dialog. Everything behind it stays in the tab order
    // otherwise, which is what aria-modal promises is not the case.
    function onKeyDown(e) {
        if (e.key === "Escape") { dismiss(); return; }
        if (e.key !== "Tab") return;
        const focusable = panelRef.current?.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || !focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

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
        if (TURNSTILE_SITE_KEY && !captchaToken) {
            setNotice({ kind: "error", text: "Finish the security check above the button, then try again." });
            return;
        }
        const token = captchaToken || undefined;
        setBusy(true);
        try {
            if (mode === "sign_up") {
                const { session, needsConfirmation } = await signUp(email, password, token);
                if (needsConfirmation) {
                    setNotice({ kind: "success", text: "Check your email to confirm your account." });
                } else if (session) {
                    setOpen(false);
                }
            } else if (mode === "sign_in") {
                await signInWithPassword(email, password, token);
                setOpen(false);
            } else {
                await sendMagicLink(email, token);
                setNotice({ kind: "success", text: "Check your email for a sign-in link." });
            }
        } catch (err) {
            setNotice({ kind: "error", text: humanAuthError(err) || "Sign-in failed" });
        } finally {
            setBusy(false);
            // Spent either way — a failed attempt consumes the token too.
            if (TURNSTILE_SITE_KEY) {
                setCaptchaToken(null);
                setAttempt((n) => n + 1);
            }
        }
    }

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Sign in to Veyrnox"
            ref={panelRef}
            onKeyDown={onKeyDown}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
        >
            <div className="w-full max-w-sm rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl">
                <div className="flex items-start justify-between mb-1">
                    <h2 className="text-lg font-semibold text-vx-fg">
                        {mode === "sign_up" ? "Create your account" : mode === "magic" ? "Email sign-in link" : "Sign in to Veyrnox"}
                    </h2>
                    <button
                        type="button"
                        ref={closeRef}
                        aria-label="Close"
                        onClick={dismiss}
                        className="text-vx-fg-muted hover:text-vx-fg text-xl leading-none"
                    >
                        ×
                    </button>
                </div>
                <p className="text-sm text-vx-fg-muted mb-4">
                    New users get 50 free credits.
                </p>

                {(oauth.apple || oauth.google) && (
                    <>
                        <div className="space-y-2 mb-3">
                            {oauth.apple && (
                                <button type="button" onClick={() => signInWithOAuth("apple")} disabled={busy} className="w-full rounded-lg bg-vx-fg text-vx-base font-semibold py-2 text-sm hover:opacity-90 disabled:opacity-60">
                                    Continue with Apple
                                </button>
                            )}
                            {oauth.google && (
                                <button type="button" onClick={() => signInWithOAuth("google")} disabled={busy} className="w-full rounded-lg bg-vx-base border border-vx-border text-vx-fg font-semibold py-2 text-sm hover:border-vx-accent disabled:opacity-60">
                                    Continue with Google
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-3 mb-3 text-[10px] text-vx-fg-faint uppercase tracking-wider">
                            <div className="h-px bg-vx-border flex-1" /> or email <div className="h-px bg-vx-border flex-1" />
                        </div>
                    </>
                )}
                <form onSubmit={handleSubmit} className="space-y-3">
                    <label className="block">
                        <span className="text-xs text-vx-fg-muted">Email</span>
                        <input
                            type="email"
                            required
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="mt-1 w-full rounded-lg bg-vx-base border border-vx-border px-3 py-2 text-sm text-vx-fg outline-none focus:border-vx-accent focus-visible:ring-2 focus-visible:ring-vx-accent/40"
                        />
                    </label>

                    {mode !== "magic" && (
                        <label className="block">
                            <span className="text-xs text-vx-fg-muted">Password</span>
                            <span className="relative mt-1 block">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    required
                                    autoComplete={mode === "sign_up" ? "new-password" : "current-password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    minLength={8}
                                    className="w-full rounded-lg bg-vx-base border border-vx-border pl-3 pr-16 py-2 text-sm text-vx-fg outline-none focus:border-vx-accent focus-visible:ring-2 focus-visible:ring-vx-accent/40"
                                />
                                {/* A typo in a masked 8-character minimum is the
                                    commonest reason a sign-up bounces. */}
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    aria-pressed={showPassword}
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                    className="absolute inset-y-0 right-0 px-3 text-[11px] font-bold uppercase tracking-wide text-vx-fg-muted hover:text-vx-fg"
                                >
                                    {showPassword ? "Hide" : "Show"}
                                </button>
                            </span>
                            <span className="mt-1 block text-[11px] text-vx-fg-faint">At least 8 characters.</span>
                        </label>
                    )}

                    <Turnstile
                        key={attempt}
                        onToken={setCaptchaToken}
                        onError={() => setNotice({
                            kind: "error",
                            text: "The security check couldn't load. Turn off content blockers for this site, or try another network.",
                        })}
                    />

                    {/* Always mounted so a screen reader hears the message
                        appear instead of the whole region being inserted. */}
                    <div role="status" aria-live="polite" className={notice ? "block" : "sr-only"}>
                        {notice && (
                            <div
                                className={`flex items-start gap-2 text-xs rounded-md px-3 py-2 border ${
                                    notice.kind === "error"
                                        ? "bg-vx-danger/10 text-vx-danger border-vx-danger/30"
                                        : "bg-vx-accent/10 text-vx-accent border-vx-accent/30"
                                }`}
                            >
                                <span aria-hidden="true">{notice.kind === "error" ? "✕" : "✓"}</span>
                                <span>{notice.text}</span>
                            </div>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={busy}
                        className="w-full rounded-full bg-vx-accent text-vx-accent-ink font-extrabold py-2.5 text-sm hover:bg-vx-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-60"
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

                <div className="mt-4 flex flex-wrap gap-3 text-xs text-vx-fg-muted">
                    {mode !== "sign_in" && (
                        <button type="button" className="underline hover:text-vx-fg" onClick={() => setMode("sign_in")}>
                            Have an account? Sign in
                        </button>
                    )}
                    {mode !== "sign_up" && (
                        <button type="button" className="underline hover:text-vx-fg" onClick={() => setMode("sign_up")}>
                            New? Create an account
                        </button>
                    )}
                    {mode !== "magic" && (
                        <button type="button" className="underline hover:text-vx-fg" onClick={() => setMode("magic")}>
                            Email me a link instead
                        </button>
                    )}
                </div>

                <p className="mt-4 text-[10px] text-vx-fg-faint leading-tight">
                    By continuing you accept the Veyrnox <a href="/legal/terms" className="underline hover:text-vx-fg">Terms</a> &amp; <a href="/legal/privacy" className="underline hover:text-vx-fg">Privacy Policy</a>.
                </p>
            </div>
        </div>
    );
}

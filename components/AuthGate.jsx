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
import { Turnstile, TURNSTILE_SITE_KEY } from "./Turnstile.jsx";

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
    // Supabase's leaked-password check (HaveIBeenPwned; CLAUDE.md OWASP #7
    // keeps it on). Without this line a breached password surfaced as the
    // generic fallback, which never told the user the password was the problem.
    [/known to be weak|easy to guess|weak.?password/i, "That password has appeared in a data breach. Choose a different one — ideally one you don't use anywhere else."],
    [/network|fetch|failed to fetch/i, "Couldn't reach the server. Check your connection."],
    // signInWithOAuth writes the PKCE verifier to sessionStorage before it
    // redirects. Safari private browsing and blocked site data throw there,
    // which used to leave the provider buttons silently dead.
    [/storage|quota|securityerror/i, "Your browser is blocking site storage, so sign-in can't start. Turn off private browsing, or allow site data for this site."],
    [/captcha/i, "The security check failed or expired. Try again."],
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

// Apple requires its mark on the button and the wording to be one of its
// approved strings ("Continue with Apple"). currentColor makes the mark track
// the button's text, so the white-on-dark and black-on-light variants — both
// of which Apple allows — come from the theme tokens rather than two assets.
function AppleMark() {
    return (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
        </svg>
    );
}

function GoogleMark() {
    return (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 48 48" width="16" height="16">
            <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
            <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
            <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
            <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
        </svg>
    );
}

export default function AuthGate() {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState("sign_in");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    // Turnstile (ADR-0026). Tokens are single-use, so every submit bumps
    // captchaReset and the widget issues a fresh one.
    const [captcha, setCaptcha] = useState(null);
    const [captchaReset, setCaptchaReset] = useState(0);
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

    // signInWithOAuth is async and ends in a redirect. Unawaited, a throw on
    // the way to that redirect (blocked sessionStorage, missing env) became an
    // unhandled rejection and the button just did nothing.
    async function startOAuth(provider) {
        setNotice(null);
        setBusy(true);
        try {
            await signInWithOAuth(provider);
        } catch (err) {
            setBusy(false);
            setNotice({ kind: "error", text: humanAuthError(err) });
        }
    }

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
        if (TURNSTILE_SITE_KEY && !captcha) {
            setNotice({ kind: "error", text: "Complete the security check first." });
            return;
        }
        setBusy(true);
        try {
            if (mode === "sign_up") {
                const { session, needsConfirmation } = await signUp(email, password, captcha);
                if (needsConfirmation) {
                    setNotice({ kind: "success", text: "Check your email to confirm your account." });
                } else if (session) {
                    setOpen(false);
                }
            } else if (mode === "sign_in") {
                await signInWithPassword(email, password, captcha);
                setOpen(false);
            } else {
                await sendMagicLink(email, captcha);
                setNotice({ kind: "success", text: "Check your email for a sign-in link." });
            }
        } catch (err) {
            setNotice({ kind: "error", text: humanAuthError(err) || "Sign-in failed" });
        } finally {
            setBusy(false);
            if (TURNSTILE_SITE_KEY) setCaptchaReset((n) => n + 1);
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
                                <button type="button" onClick={() => startOAuth("apple")} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-vx-fg text-vx-base font-semibold py-2 text-sm hover:opacity-90 disabled:opacity-60">
                                    <AppleMark />
                                    Continue with Apple
                                </button>
                            )}
                            {oauth.google && (
                                <button type="button" onClick={() => startOAuth("google")} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-vx-base border border-vx-border text-vx-fg font-semibold py-2 text-sm hover:border-vx-accent disabled:opacity-60">
                                    <GoogleMark />
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
                                    // Safari's generator reads this when it suggests a
                                    // password; a generated one is never in a breach list.
                                    passwordrules={mode === "sign_up" ? "minlength: 12; required: lower; required: upper; required: digit;" : undefined}
                                    aria-describedby="vx-password-hint"
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
                            {/* Sign-up runs Supabase's leaked-password check (it
                                stays on, CLAUDE.md OWASP #7). Say so before the
                                first attempt rather than only after a rejection. */}
                            <span id="vx-password-hint" className="mt-1 block text-[11px] text-vx-fg-faint">
                                {mode === "sign_up"
                                    ? "At least 8 characters. Passwords found in data breaches are rejected, so use a new one — let your browser or password manager suggest it."
                                    : "At least 8 characters."}
                            </span>
                        </label>
                    )}

                    <Turnstile
                        onToken={setCaptcha}
                        onError={() => setNotice({ kind: "error", text: "The security check couldn't load. Disable content blockers for this site, or sign in with Google." })}
                        resetKey={captchaReset}
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

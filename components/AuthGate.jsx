"use client";
import { rich } from '../lib/i18n/rich';
import { useI18n } from './I18nProvider.jsx';

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
import { signInWithPasskey, passkeysSupported } from "../app/lib/passkeys.js";
import { configuredProviders, readAuthSettings, providerAvailable, passkeyUnavailableReason } from "../app/lib/authProviders.js";
import { Turnstile, TURNSTILE_SITE_KEY } from "./Turnstile.jsx";
import { AppleMark, PasskeyMark, GoogleMark } from "./AuthMarks.jsx";
import { captchaNotice, noticeAfterCaptchaFailure, noticeAfterCaptchaToken, noticeWhileCaptchaWaits, CAPTCHA_BLOCKED_CODE, CAPTCHA_UNSUPPORTED, CAPTCHA_WAITING } from "../app/lib/turnstileFailure.js";
import { authCallbackUrl, safeAuthReturnPath } from "../app/lib/authReturn.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GoTrue's strings are developer-facing ("Email rate limit exceeded",
// "AuthApiError: Invalid login credentials"). Translate the ones users
// actually hit; anything unrecognised falls back to a plain sentence rather
// than a raw error object, and the original stays in console.error.
const AUTH_ERROR_COPY = (t) => ([
    [/invalid login credentials/i, t("authGate.thatEmailAndPasswordDonT")],
    [/email not confirmed/i, t("authGate.confirmYourEmailFirstCheckYour")],
    [/rate limit/i, t("authGate.tooManyAttemptsWaitAMinute")],
    [/user already registered/i, t("authGate.thereSAlreadyAnAccountWith")],
    [/password should be at least/i, t("authGate.passwordsNeedAtLeast8Characters")],
    // Supabase's leaked-password check (HaveIBeenPwned; CLAUDE.md OWASP #7
    // keeps it on). Without this line a breached password surfaced as the
    // generic fallback, which never told the user the password was the problem.
    [/known to be weak|easy to guess|weak.?password/i, t("authGate.thatPasswordHasAppearedInA")],
    [/network|fetch|failed to fetch/i, t("authGate.couldnTReachTheServerCheck")],
    // signInWithOAuth writes the PKCE verifier to sessionStorage before it
    // redirects. Safari private browsing and blocked site data throw there,
    // which used to leave the provider buttons silently dead.
    [/storage|quota|securityerror/i, t("authGate.yourBrowserIsBlockingSiteStorage")],
    [/captcha/i, t("authGate.theSecurityCheckFailedOrExpired")], [/database error saving new user/i, t("authGate.weCouldnTCreateThatAccount")], // trigger refusal (0343)
    // GoTrue's passkey codes. "not registered" is the one users actually hit:
    // they tap the passkey button on a device that has never enrolled one.
    [/webauthn_credential_not_found|no passkey/i, t("authGate.noPasskeyForThisSiteOn")],
    [/webauthn_challenge_expired/i, t("authGate.thatTookTooLongTryThe")],
    [/passkey_disabled/i, t("authGate.passkeySignInIsnTAvailable")],
]);

function humanAuthError(err, t) {
    const raw = err && err.message ? String(err.message) : "";
    if (raw) {
        const hit = AUTH_ERROR_COPY(t).find(([re]) => re.test(raw));
        if (hit) return hit[1];
        console.error("[auth] unmapped error:", raw);
    }
    return t("authGate.thatDidnTWorkTryAgain");
}

export default function AuthGate() {
  const { t, locale } = useI18n();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState("sign_in");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    const returnTo = useRef(null);
    // Turnstile (ADR-0026). Tokens are single-use, so every submit bumps
    // captchaReset and the widget issues a fresh one.
    const [captcha, setCaptcha] = useState(null);
    const [captchaReset, setCaptchaReset] = useState(0);
    // The widget's last error code, CAPTCHA_WAITING while it waits for a
    // click, or CAPTCHA_UNSUPPORTED, so a submit without a token can say why.
    const [captchaFailure, setCaptchaFailure] = useState(null);
    // Every entry point uses this dialog. Availability controls whether an
    // action can start, never whether Apple or passkeys disappear from it.
    const oauth = configuredProviders(process.env.NEXT_PUBLIC_AUTH_PROVIDERS);
    const authSettings = useRef(null);
    const [settings, setSettings] = useState(null);

    function rememberSettings(data) {
        if (!data) return;
        authSettings.current = data;
        setSettings(data);
    }

    useEffect(() => {
        let cancelled = false;
        readAuthSettings(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
            .then((data) => {
                if (!cancelled) rememberSettings(data);
            });
        return () => { cancelled = true; };
    }, []);

    async function settingsBeforeSignIn() {
        if (authSettings.current) return authSettings.current;
        const data = await readAuthSettings(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 3000);
        rememberSettings(data);
        return data;
    }

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
            const wantedReturn = ev && ev.detail && ev.detail.returnTo;
            // Internal path only. It is later placed in the callback URL and
            // must never become an open redirect.
            returnTo.current = safeAuthReturnPath(wantedReturn);
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

    // This component is mounted once in the root layout and never unmounts,
    // so what was typed stays in state until something empties it. Left
    // alone, the dialog reopened after a session ended with the last email
    // and password filled in, and Show revealed the password.
    const forgetCredentials = useCallback(() => {
        setEmail("");
        setPassword("");
        setShowPassword(false);
    }, []);
    const close = useCallback(() => {
        setOpen(false);
        forgetCredentials();
        setCaptchaFailure(null);
        setNotice(noticeAfterCaptchaToken);
    }, [forgetCredentials]);
    const dismiss = close;

    // Close when a session appears (from any tab), and empty the fields when
    // one ends. Only on a change: a repeated "signed out" notice (another 401
    // while the dialog is open) must not wipe what the user is typing.
    const wasSignedIn = useRef(false);
    useEffect(() => {
        wasSignedIn.current = Boolean(getSession());
        return onSessionChange((s) => {
            const signedIn = Boolean(s);
            if (signedIn) close();
            else if (wasSignedIn.current) forgetCredentials();
            wasSignedIn.current = signedIn;
        });
    }, [close, forgetCredentials]);

    // signInWithOAuth is async and ends in a redirect. Unawaited, a throw on
    // the way to that redirect (blocked sessionStorage, missing env) became an
    // unhandled rejection and the button just did nothing.
    async function startOAuth(provider) {
        setNotice(null);
        setBusy(true);
        const data = await settingsBeforeSignIn();
        if (!providerAvailable(data, provider)) {
            setBusy(false);
            setNotice({ kind: "error", text: t('authGate.providerSetup', { provider: provider === 'apple' ? 'Apple' : 'Google' }) });
            return;
        }
        try {
            await signInWithOAuth(provider, authCallbackUrl(returnTo.current, window.location.origin));
        } catch (err) {
            setBusy(false);
            setNotice({ kind: "error", text: humanAuthError(err, t) });
        }
    }

    // Returns null when the user dismisses the OS prompt — a dismissal is not
    // a failure and should leave the dialog exactly as it was.
    async function startPasskey() {
        setNotice(null);
        const unsupported = passkeyUnavailableReason(null, passkeysSupported(), t);
        if (unsupported) {
            setNotice({ kind: "error", text: unsupported });
            return;
        }
        // GoTrue treats the passkey challenge as a sign-in, so Attack
        // Protection applies to it exactly as it does to password sign-in.
        // Without this the request is refused with captcha_failed before any
        // WebAuthn prompt appears, which looks like a broken button.
        if (TURNSTILE_SITE_KEY && !captcha) {
            setNotice(captchaNotice(captchaFailure, t));
            return;
        }
        setBusy(true);
        try {
            const unavailable = passkeyUnavailableReason(await settingsBeforeSignIn(), true, t);
            if (unavailable) {
                setNotice({ kind: "error", text: unavailable });
                return;
            }
            const session = await signInWithPasskey(captcha);
            if (session) close();
        } catch (err) {
            setNotice({ kind: "error", text: humanAuthError(err, t) });
        } finally {
            setBusy(false);
            // Turnstile tokens are single-use; a retry needs a fresh one.
            if (TURNSTILE_SITE_KEY) setCaptchaReset((n) => n + 1);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setNotice(null);
        if (!EMAIL_RE.test(email)) {
            setNotice({ kind: "error", text: t("authGate.enterAValidEmailAddress") });
            return;
        }
        if (mode !== "magic" && password.length < 8) {
            setNotice({ kind: "error", text: t("authGate.passwordMustBeAtLeast8") });
            return;
        }
        if (TURNSTILE_SITE_KEY && !captcha) {
            setNotice(captchaNotice(captchaFailure, t));
            return;
        }
        setBusy(true);
        try {
            if (mode === "sign_up") {
                const { session, needsConfirmation } = await signUp(email, password, captcha);
                if (needsConfirmation) {
                    setPassword("");
                    setNotice({ kind: "success", text: t("authGate.checkYourEmailToConfirmYour") });
                } else if (session) {
                    close();
                }
            } else if (mode === "sign_in") {
                await signInWithPassword(email, password, captcha);
                close();
            } else {
                await sendMagicLink(email, captcha, authCallbackUrl(returnTo.current, window.location.origin));
                setPassword("");
                setNotice({ kind: "success", text: t("authGate.checkYourEmailForASign") });
            }
        } catch (err) {
            setNotice({ kind: "error", text: humanAuthError(err, t) || t("authGate.signInFailed") });
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
            aria-label={t("authGate.title")}
            ref={panelRef}
            onKeyDown={onKeyDown}
            dir={locale === "ar" ? "rtl" : "ltr"}
            className="vx-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
        >
            <div className="max-h-full w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-vx-border bg-vx-panel p-5 sm:p-6 shadow-2xl">
                <div className="flex items-start justify-between mb-1">
                    <h2 className="text-lg font-semibold text-vx-fg">
                        {mode === "sign_up" ? t("authGate.createYourAccount") : mode === "magic" ? t("authGate.emailSignInLink") : t("authGate.title")}
                    </h2>
                    <button
                        type="button"
                        ref={closeRef}
                        aria-label={t("authGate.close")}
                        onClick={dismiss}
                        className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl leading-none text-vx-fg-muted hover:text-vx-fg"
                    >
                        ×
                    </button>
                </div>
                <p className="text-sm text-vx-fg-muted mb-4">
                    {t("authGate.newUsersGet10FreeCredits")}</p>

                <>
                    <div className="space-y-2 mb-3">
                        <button type="button" onClick={startPasskey} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-vx-base border border-vx-border text-vx-fg font-semibold py-2 text-sm hover:border-vx-accent disabled:opacity-60">
                            <PasskeyMark />
                            {t("authGate.signInWithAPasskey")}</button>
                        <button type="button" onClick={() => startOAuth("apple")} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg border border-transparent bg-vx-fg text-vx-base font-semibold py-2 text-sm hover:opacity-90 disabled:opacity-60">
                            <AppleMark />
                            {t("authGate.continueWithApple")}</button>
                        {oauth.google && (
                            <button type="button" onClick={() => startOAuth("google")} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-vx-base border border-vx-border text-vx-fg font-semibold py-2 text-sm hover:border-vx-accent disabled:opacity-60">
                                <GoogleMark />
                                {t("authGate.continueWithGoogle")}</button>
                        )}
                    </div>
                    {settings && (!providerAvailable(settings, "apple") || settings.passkeys_enabled !== true) && (
                        <p className="text-xs text-vx-fg-muted mb-3">
                            {!providerAvailable(settings, "apple") && t("authGate.appleSignInNeedsSetupIn")}
                            {settings.passkeys_enabled !== true && t("authGate.passkeysNeedEnablingInThisEnvironment")}
                        </p>
                    )}
                    <div className="flex items-center gap-3 mb-3 text-[10px] text-vx-fg-faint uppercase tracking-wider">
                        <div className="h-px bg-vx-border flex-1" /> {t("authGate.orEmail")}<div className="h-px bg-vx-border flex-1" />
                    </div>
                </>
                <form onSubmit={handleSubmit} className="space-y-3">
                    <label className="block">
                        <span className="text-xs text-vx-fg-muted">{t("authGate.email")}</span>
                        <input
                            type="email"
                            required
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="mt-1 w-full rounded-lg bg-vx-base border border-vx-field px-3 py-2 text-sm text-vx-fg outline-hidden focus:border-vx-accent focus-visible:ring-2 focus-visible:ring-vx-accent/40"
                        />
                    </label>

                    {mode !== "magic" && (
                        // Not one wrapping <label>: the button and the hint sat inside
                        // it and were read out as part of the field's name.
                        <div>
                            <label htmlFor="vx-password" className="text-xs text-vx-fg-muted">{t("authGate.password")}</label>
                            <span className="relative mt-1 block">
                                <input
                                    id="vx-password"
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
                                    className="w-full rounded-lg bg-vx-base border border-vx-field ps-3 pe-16 py-2 text-sm text-vx-fg outline-hidden focus:border-vx-accent focus-visible:ring-2 focus-visible:ring-vx-accent/40"
                                />
                                {/* A typo in a masked 8-character minimum is the
                                    commonest reason a sign-up bounces. */}
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    // The name changes with the state, so there is no
                                    // aria-pressed: "Hide password, pressed" says two things.
                                    aria-label={showPassword ? t("authGate.hidePassword") : t("authGate.showPassword")}
                                    className="absolute inset-y-0 end-0 px-3 text-[11px] font-bold uppercase tracking-wide text-vx-fg-muted hover:text-vx-fg"
                                >
                                    {showPassword ? t("authGate.hide") : t("oddlings.detail.show")}
                                </button>
                            </span>
                            {/* Sign-up runs Supabase's leaked-password check (it
                                stays on, CLAUDE.md OWASP #7). Say so before the
                                first attempt rather than only after a rejection. */}
                            <span id="vx-password-hint" className="mt-1 block text-[11px] text-vx-fg-faint">
                                {mode === "sign_up"
                                    ? t("authGate.atLeast8CharactersPasswordsFound")
                                    : t("authGate.atLeast8Characters")}
                            </span>
                        </div>
                    )}

                    <Turnstile
                        onToken={(token) => { setCaptcha(token); if (token) { setCaptchaFailure(null); setNotice(noticeAfterCaptchaToken); } }}
                        onFailure={(code) => { setCaptchaFailure(code); setNotice((n) => noticeAfterCaptchaFailure(n, code, t)); }}
                        onError={() => { setCaptchaFailure(CAPTCHA_BLOCKED_CODE); setNotice(captchaNotice(CAPTCHA_BLOCKED_CODE, t)); }}
                        onWaiting={() => { setCaptchaFailure(CAPTCHA_WAITING); setNotice(n => noticeWhileCaptchaWaits(n, t)); }}
                        onUnsupported={() => { setCaptchaFailure(CAPTCHA_UNSUPPORTED); setNotice((n) => noticeAfterCaptchaFailure(n, CAPTCHA_UNSUPPORTED, t)); }}
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
                        className="w-full rounded-full bg-vx-accent text-vx-accent-ink font-extrabold py-2.5 text-sm hover:bg-vx-accent-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-60"
                    >
                        {busy
                            ? t("authGate.working")
                            : mode === "sign_up"
                                ? t("authGate.createAccount")
                                : mode === "magic"
                                    ? t("authGate.sendMagicLink")
                                    : t("oauth.signIn")}
                    </button>
                </form>

                <div className="mt-4 flex flex-wrap gap-3 text-xs text-vx-fg-muted">
                    {mode !== "sign_in" && (
                        <button type="button" className="-my-2 py-2 underline hover:text-vx-fg" onClick={() => setMode("sign_in")}>
                            {t("authGate.haveAnAccountSignIn")}</button>
                    )}
                    {mode !== "sign_up" && (
                        <button type="button" className="-my-2 py-2 underline hover:text-vx-fg" onClick={() => setMode("sign_up")}>
                            {t("authGate.newCreateAnAccount")}</button>
                    )}
                    {mode !== "magic" && (
                        <button type="button" className="-my-2 py-2 underline hover:text-vx-fg" onClick={() => setMode("magic")}>
                            {t("authGate.emailMeALinkInstead")}</button>
                    )}
                </div>

                <p className="mt-4 text-[10px] text-vx-fg-faint leading-tight">
                    {rich(t('authGate.legal'), { terms: <a href="/legal/terms" className="underline hover:text-vx-fg">{t('label.Terms')}</a>, privacy: <a href="/legal/privacy" className="underline hover:text-vx-fg">{t('about.privacy')}</a> })}
                </p>
            </div>
        </div>
    );
}

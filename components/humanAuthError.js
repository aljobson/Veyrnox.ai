import { isEmailRateLimit } from './useEmailResend.js';

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

export function humanAuthError(err, t) {
    // A resend refused for sending too often (HTTP 429 / email-send rate limit codes) is not a developer string.
    if (isEmailRateLimit(err)) return t("authGate.tooManyAttemptsWaitAMinute");
    const raw = err && err.message ? String(err.message) : "";
    if (raw) {
        const hit = AUTH_ERROR_COPY(t).find(([re]) => re.test(raw));
        if (hit) return hit[1];
        console.error("[auth] unmapped error:", raw);
    }
    return t("authGate.thatDidnTWorkTryAgain");
}

"use client";

/**
 * Passkeys (WebAuthn) against Supabase Auth's two-step REST API.
 *
 * Supabase documents `supabase.auth.registerPasskey()` from
 * `@supabase/supabase-js` v2.105+. That library is banned from the SSR import
 * graph — it breaks Cloudflare Workers Builds (CLAUDE.md, bisected across PRs
 * #25/#27/#38/#40), which is why authClient.js is hand-rolled fetch. The
 * two-step endpoints do the same work over plain fetch, so passkeys cost no
 * new dependency.
 *
 * Upstream calls passkey support EXPERIMENTAL and reserves the right to change
 * it without notice. If sign-in starts failing after a Supabase Auth release,
 * check the request/response shapes here first.
 *
 * A passkey belongs to the ACCOUNT, not to how the account was created, so a
 * user who signed up with Google or Apple can register one and afterwards sign
 * in with the passkey alone. Registration needs a signed-in, confirmed user;
 * sign-in needs none, because Supabase uses discoverable credentials and the
 * authenticator resolves the account itself.
 */

import { gotruePost, gotrueAuthed, b64url, adoptSession, withCaptcha } from "./authClient.js";

const REGISTER_OPTIONS = "/auth/v1/passkeys/registration/options";
const REGISTER_VERIFY = "/auth/v1/passkeys/registration/verify";
const SIGNIN_OPTIONS = "/auth/v1/passkeys/authentication/options";
const SIGNIN_VERIFY = "/auth/v1/passkeys/authentication/verify";

/**
 * Can this browser do WebAuthn at all? False on http:// (WebAuthn needs a
 * secure context) and in browsers without the API, so the UI can stay hidden
 * rather than offering a button that throws on click.
 * @returns {boolean}
 */
export function passkeysSupported() {
    return typeof window !== "undefined"
        && typeof window.PublicKeyCredential === "function"
        && !!window.isSecureContext;
}

/** base64url -> bytes. The inverse of authClient's b64url. */
export function fromB64url(value) {
    const b64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * GoTrue sends every ArrayBuffer field base64url-encoded, because JSON has no
 * bytes. `navigator.credentials` wants real BufferSources, so decode exactly
 * the fields WebAuthn defines as buffers and leave the rest alone.
 * @param {any} options  PublicKeyCredential{Creation,Request}Options, encoded
 * @returns {any}
 */
export function decodeOptions(options) {
    const out = { ...options };
    if (out.challenge) out.challenge = fromB64url(out.challenge);
    if (out.user && out.user.id) out.user = { ...out.user, id: fromB64url(out.user.id) };
    for (const key of ["excludeCredentials", "allowCredentials"]) {
        if (Array.isArray(out[key])) {
            out[key] = out[key].map((c) => ({ ...c, id: fromB64url(c.id) }));
        }
    }
    return out;
}

/**
 * The reverse, for the credential the authenticator produced. Only the fields
 * present on this ceremony's response are emitted — registration carries an
 * attestationObject, authentication carries a signature, and sending the
 * wrong set is how verification fails with an unhelpful error.
 * @param {PublicKeyCredential} credential
 * @returns {any} the WebAuthn JSON shape GoTrue verifies
 */
export function encodeCredential(credential) {
    const r = credential.response;
    const bytes = (buf) => b64url(new Uint8Array(buf));
    const out = {
        id: credential.id,
        rawId: bytes(credential.rawId),
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults
            ? credential.getClientExtensionResults()
            : {},
        response: { clientDataJSON: bytes(r.clientDataJSON) },
    };
    if (credential.authenticatorAttachment) out.authenticatorAttachment = credential.authenticatorAttachment;
    if (r.attestationObject) out.response.attestationObject = bytes(r.attestationObject);
    if (r.authenticatorData) out.response.authenticatorData = bytes(r.authenticatorData);
    if (r.signature) out.response.signature = bytes(r.signature);
    if (r.userHandle) out.response.userHandle = bytes(r.userHandle);
    return out;
}

// A cancelled prompt is a NotAllowedError, same as a genuine timeout. It is
// the single most common outcome and is not an error worth shouting about.
function isUserCancelled(err) {
    return err && (err.name === "NotAllowedError" || err.name === "AbortError");
}

/**
 * Register a passkey for the signed-in user. Needs a confirmed, non-anonymous
 * account — Supabase refuses otherwise.
 * @param {string} [friendlyName]  defaults to a name derived from the
 *                                 authenticator (e.g. "iCloud Keychain")
 * @returns {Promise<{id: string, friendly_name?: string} | null>} null if the
 *          user dismissed the prompt
 */
export async function registerPasskey(friendlyName) {
    if (!passkeysSupported()) throw new Error("This browser cannot use passkeys.");
    const started = await gotrueAuthed(REGISTER_OPTIONS, {
        body: friendlyName ? { friendly_name: friendlyName } : {},
    });
    let credential;
    try {
        credential = await navigator.credentials.create({
            publicKey: decodeOptions(started.options),
        });
    } catch (err) {
        if (isUserCancelled(err)) return null;
        throw err;
    }
    if (!credential) return null;
    return gotrueAuthed(REGISTER_VERIFY, {
        body: { challenge_id: started.challenge_id, credential: encodeCredential(credential) },
    });
}

/**
 * The body for the sign-in challenge request. GoTrue applies Attack Protection
 * to this endpoint — it is a sign-in — so with Turnstile on, a request without
 * a token is refused with `captcha_failed` before any WebAuthn happens.
 * Registration is NOT captcha-gated: it requires a Bearer token instead. Both
 * confirmed against the live project.
 * @param {string} [captchaToken]
 */
export function signInBody(captchaToken) {
    return withCaptcha({}, captchaToken);
}

/**
 * Sign in with a passkey. No email needed: the credential is discoverable, so
 * the authenticator picks the account. Persists the session on success, so
 * onSessionChange listeners fire exactly as they do for password sign-in.
 * @param {string} [captchaToken]  Turnstile token (ADR-0026) — required
 *                                 whenever Attack Protection is on
 * @returns {Promise<import("./authClient.js").VeyrnoxSession | null>} null if
 *          the user dismissed the prompt
 */
export async function signInWithPasskey(captchaToken) {
    if (!passkeysSupported()) throw new Error("This browser cannot use passkeys.");
    const started = await gotruePost(SIGNIN_OPTIONS, signInBody(captchaToken));
    let credential;
    try {
        credential = await navigator.credentials.get({
            publicKey: decodeOptions(started.options),
        });
    } catch (err) {
        if (isUserCancelled(err)) return null;
        throw err;
    }
    if (!credential) return null;
    const data = await gotruePost(SIGNIN_VERIFY, {
        challenge_id: started.challenge_id,
        credential: encodeCredential(credential),
    });
    return adoptSession(data);
}

/**
 * The signed-in user's passkeys. Exposed so an account screen can show and
 * revoke them — a passkey on a lost device is only removable from here.
 * @returns {Promise<Array<{id: string, friendly_name?: string, created_at: string, last_used_at?: string}>>}
 */
export async function listPasskeys() {
    const data = await gotrueAuthed("/auth/v1/passkeys", { method: "GET" });
    return Array.isArray(data) ? data : (data && data.passkeys) || [];
}

/** Revoke one passkey. */
export async function deletePasskey(passkeyId) {
    await gotrueAuthed(`/auth/v1/passkeys/${encodeURIComponent(passkeyId)}`, { method: "DELETE" });
}

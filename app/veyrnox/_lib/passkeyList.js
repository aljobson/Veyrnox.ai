// Pure helpers for the Account page's passkey panel. No JSX and no browser
// APIs, so tests import them directly.

export const PASSKEY_NAME_MAX = 60;

// The name is optional; Supabase derives one from the authenticator when it
// is absent. Control characters are dropped because the name is shown back.
export function cleanPasskeyName(input) {
  return String(input ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, PASSKEY_NAME_MAX);
}

export function passkeyLabel(passkey) {
  return cleanPasskeyName(passkey?.friendly_name) || 'Passkey';
}

function day(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function passkeyDates(passkey) {
  const added = day(passkey?.created_at);
  const used = day(passkey?.last_used_at);
  return [added ? `Added ${added}` : null, used ? `last used ${used}` : 'never used'].filter(Boolean).join(' · ');
}

// Only rows with a usable id can be removed, so only those are listed.
export function usablePasskeys(list) {
  return (Array.isArray(list) ? list : []).filter((p) => p && typeof p.id === 'string' && p.id);
}

// GoTrue's own messages are not written for users and can name internals.
export function passkeyErrorCode(err) {
  const status = err?.status;
  const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
  if (/insufficient_aal|AAL2 session is required/i.test(text)) return 'aal';
  if (status === 401 || /not signed in/i.test(text)) return 'expired';
  if (/passkey_disabled/i.test(text)) return 'disabled';
  if (status === 429 || /rate limit/i.test(text)) return 'limited';
  if (err?.name === 'InvalidStateError' || /already (registered|exists)/i.test(text)) return 'exists';
  if (err?.name === 'SecurityError') return 'security';
  return 'unknown';
}

const ERROR_COPY = {
  "aal": "Unlock this session with your authenticator code under Two-factor authentication, then try again.",
  "expired": "Your sign-in has expired. Sign in again, then add the passkey.",
  "disabled": "Passkeys are switched off at the moment.",
  "limited": "Too many attempts. Wait a minute, then try again.",
  "exists": "This device already has a passkey for your account.",
  "security": "Passkeys only work on veyrnox.ai itself.",
  "unknown": "That did not complete. Check your connection and try again."
};
export function passkeyErrorCopy(err) { return ERROR_COPY[passkeyErrorCode(err)]; }

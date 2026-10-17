const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

// Client-side shape checks only; Supabase enforces its own rules (CLAUDE.md).
export function validateEmailForm(email: string, password: string, creating: boolean): string | null {
    if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address.';
    if (creating && password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters for the password.`;
    if (password.length === 0) return 'Enter your password.';
    return null;
}

const MESSAGES: Record<string, string> = {
    invalid_credentials: 'That email and password do not match.',
    email_not_confirmed: 'Confirm your email first, then sign in.',
    user_already_exists: 'That email already has an account. Sign in instead.',
    email_exists: 'That email already has an account. Sign in instead.',
    weak_password: 'That password is too weak. Try a longer one.',
    captcha_failed: 'The security check failed. Try again.',
    over_request_rate_limit: 'Too many attempts. Wait a moment.',
    over_email_send_rate_limit: 'Too many attempts. Wait a moment.',
    network: 'No connection. Check your network and try again.',
};

export function emailAuthMessage(code: string): string {
    return MESSAGES[code] ?? 'Something went wrong. Try again.';
}

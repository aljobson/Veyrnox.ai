import { t } from '../i18n';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

// Client-side shape checks only; Supabase enforces its own rules (CLAUDE.md).
export function validateEmailForm(email: string, password: string, creating: boolean): string | null {
    if (!EMAIL_RE.test(email.trim())) return t('email.err.invalid');
    if (creating && password.length < MIN_PASSWORD) return t('email.err.shortPassword', { min: MIN_PASSWORD });
    if (password.length === 0) return t('email.err.noPassword');
    return null;
}

// Catalog keys, looked up when the message is shown so the device language is read at that moment.
const MESSAGES: Record<string, string> = {
    invalid_credentials: 'email.err.invalid_credentials',
    email_not_confirmed: 'email.err.email_not_confirmed',
    user_already_exists: 'email.err.user_already_exists',
    email_exists: 'email.err.user_already_exists',
    weak_password: 'email.err.weak_password',
    captcha_failed: 'email.err.captcha_failed',
    over_request_rate_limit: 'email.err.rate',
    over_email_send_rate_limit: 'email.err.rate',
    network: 'email.err.network',
};

export function emailAuthMessage(code: string): string {
    return t(MESSAGES[code] ?? 'common.error');
}

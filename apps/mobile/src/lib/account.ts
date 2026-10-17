import { ApiError, type ApiClient } from './api';

// Everything the Account screen shows that is not a screen of its own: legal
// links, contact addresses, the age rule and the in-app report call (ADR-0110).
const SITE = 'https://veyrnox.ai';

export const LEGAL_LINKS = [
    { label: 'Terms of service', url: `${SITE}/legal/terms` },
    { label: 'Privacy policy', url: `${SITE}/legal/privacy` },
    { label: 'Acceptable use policy', url: `${SITE}/legal/aup` },
    { label: 'Refunds', url: `${SITE}/legal/refund` },
] as const;

export const SUPPORT_EMAIL = 'support@veyrnox.com';
export const PRIVACY_EMAIL = 'privacy@veyrnox.com';

// The privacy policy says the service is not intended for anyone under 18.
export const MIN_AGE = 18;

// In-app deletion needs the server route (S1). Until it is on staging the
// button stays visible but off, and the screen names the email route instead.
export const ACCOUNT_DELETION_ENABLED = false;

// Mirrors CATEGORIES and the subject kinds in app/api/v1/reports/route.js.
export const REPORT_CATEGORIES = [
    { id: 'csam', label: 'Sexual content involving a minor' },
    { id: 'intimate_image', label: 'Intimate image shared without consent' },
    { id: 'real_person', label: 'Real person shown without consent' },
    { id: 'violence', label: 'Violence or gore' },
    { id: 'hate', label: 'Hate or harassment' },
    { id: 'fraud', label: 'Scam or fraud' },
    { id: 'copyright', label: 'Copyright' },
    { id: 'other', label: 'Something else' },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['id'];
export type ReportSubject = 'job' | 'cinema_title' | 'other';

export interface ReportInput {
    readonly kind: ReportSubject;
    readonly subjectId: string | null;
    readonly category: ReportCategory;
    readonly details: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DETAILS = 2000;
const MIN_OTHER_DETAILS = 10;

// The same rules the server applies, so a bad report is caught before the request.
export function validateReport(input: ReportInput): string | null {
    if (!REPORT_CATEGORIES.some((c) => c.id === input.category)) return 'Choose what is wrong.';
    if (input.kind === 'other') {
        if (input.subjectId !== null) return 'This report is not about one item.';
        if (input.details.trim().length < MIN_OTHER_DETAILS) return 'Tell us a little more (at least 10 characters).';
    } else if (!input.subjectId || !UUID_RE.test(input.subjectId)) {
        return 'This item cannot be reported.';
    }
    if (input.details.length > MAX_DETAILS) return 'That is too long (2000 characters at most).';
    return null;
}

export function reportErrorMessage(err: unknown): string {
    if (err instanceof ApiError) {
        if (err.code === 'too_many_open_reports') return 'You have several open reports. We will review them first.';
        if (err.code === 'rate_limited') return 'Too many requests. Try again in a minute.';
        if (err.status === 0) return 'No connection. Check your network and try again.';
    }
    return 'The report did not send. Try again.';
}

// Sends one report. A repeat for the same item answers with the first report, not an error.
export async function submitReport(api: Pick<ApiClient, 'request'>, input: ReportInput): Promise<{ replayed: boolean }> {
    const invalid = validateReport(input);
    if (invalid) throw new Error(invalid);
    const result = await api.request<{ replayed?: boolean }>('/api/v1/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            subject_kind: input.kind,
            subject_id: input.subjectId,
            category: input.category,
            details: input.details.trim(),
        }),
    });
    return { replayed: result.replayed === true };
}

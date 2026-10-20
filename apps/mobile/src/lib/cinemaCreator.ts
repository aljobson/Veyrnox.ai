import { ApiError, type ApiClient } from './api';
import { isUuid, socialErrorKey } from './cinemaSocial';

// The viewer's Cinema profile and the creator application (ADR-0168), over GET and POST /api/v1/social-cinema/profile
// and GET and POST /api/v1/creators/apply. Both are behind switches that are off in production (profiles, creators), so
// a closed answer is a message, not an error. The server decides who may become a creator; this only sends the form.
// No upload and no creator tools are in the app yet.

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

export const USERNAME_RE = /^[a-z][a-z0-9_]{2,29}$/;
export const NAME_MAX = 80;
export const BIO_MAX = 500;
export const STATEMENT_MIN = 20;
export const STATEMENT_MAX = 1000;
const chars = (s: string) => [...s.trim()].length;
export const usernameOk = (s: string): boolean => USERNAME_RE.test(s);
export const nameOk = (s: string): boolean => chars(s) >= 1 && chars(s) <= NAME_MAX;
export const bioOk = (s: string): boolean => [...s].length <= BIO_MAX;
export const statementOk = (s: string): boolean => chars(s) >= STATEMENT_MIN && chars(s) <= STATEMENT_MAX;

export interface Profile {
    readonly username: string;
    readonly displayName: string;
    readonly bio: string;
    readonly role: string;
}
export type ApplicationStatus = 'pending' | 'approved' | 'rejected';
export interface Application {
    readonly status: ApplicationStatus;
    readonly statement: string;
}

// The read answers {profile: null} for a person who has none.
export function parseProfile(body: unknown): Profile | null {
    const p = isObject(body) ? body.profile : null;
    if (!isObject(p) || typeof p.username !== 'string') return null;
    return { username: str(p.username, 30), displayName: str(p.display_name, NAME_MAX), bio: str(p.bio, BIO_MAX), role: str(p.role, 20) };
}
export function parseApplication(body: unknown): Application | null {
    const a = isObject(body) ? body.application : null;
    if (!isObject(a) || !['pending', 'approved', 'rejected'].includes(str(a.status, 20))) return null;
    return { status: a.status as ApplicationStatus, statement: str(a.statement, STATEMENT_MAX) };
}

export const fetchProfile = async (api: Pick<ApiClient, 'request'>) => parseProfile(await api.request('/api/v1/social-cinema/profile'));
export const fetchApplication = async (api: Pick<ApiClient, 'request'>) => parseApplication(await api.request('/api/v1/creators/apply'));

const post = <T>(api: Pick<ApiClient, 'request'>, path: string, key: string, payload: Record<string, unknown>) =>
    api.request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) });

export async function createProfile(api: Pick<ApiClient, 'request'>, input: { username: string; displayName: string; bio: string }, key: string): Promise<void> {
    if (!isUuid(key) || !usernameOk(input.username) || !nameOk(input.displayName) || !bioOk(input.bio)) throw new ApiError(400, 'invalid_profile');
    await post(api, '/api/v1/social-cinema/profile', key, { username: input.username, display_name: input.displayName.trim(), bio: input.bio });
}
export async function submitApplication(api: Pick<ApiClient, 'request'>, statement: string, key: string): Promise<void> {
    if (!isUuid(key) || !statementOk(statement)) throw new ApiError(400, 'invalid_application');
    await post(api, '/api/v1/creators/apply', key, { statement: statement.trim() });
}

// Catalog key for a failed profile or application call.
export function creatorErrorKey(err: unknown): string {
    if (err instanceof ApiError) {
        switch (err.code) {
            case 'username_unavailable':
                return 'cinemaCreator.err.username';
            case 'invalid_profile':
                return 'cinemaCreator.err.profile';
            case 'invalid_application':
                return 'cinemaCreator.err.application';
            case 'role_not_eligible':
                return 'cinemaCreator.err.role';
            case 'profile_required':
                return 'cinemaCreator.err.needProfile';
            case 'user_not_provisioned':
                return 'cinemaCreator.err.later';
        }
    }
    return socialErrorKey(err);
}

// ---- Creator analytics (GET /api/v1/cinema/creator-analytics?content_id=) ----

export interface AnalyticsMetrics {
    readonly viewers: number;
    readonly completions: number;
    readonly voters: number;
    readonly sharers: number;
    readonly commenters: number;
}
export interface Analytics {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly minimumViewers: number;
    // Null when fewer than the minimum number of viewers watched: the server hides small counts on purpose.
    readonly metrics: AnalyticsMetrics | null;
}
const KEYS = ['viewers', 'completions', 'voters', 'sharers', 'commenters'] as const;
export function parseAnalytics(body: unknown): Analytics | null {
    if (!isObject(body) || typeof body.suppressed !== 'boolean') return null;
    let metrics: AnalyticsMetrics | null = null;
    if (!body.suppressed) {
        const m = body.metrics;
        if (!isObject(m) || KEYS.some((k) => typeof m[k] !== 'number' || !Number.isFinite(m[k]))) return null;
        metrics = { viewers: m.viewers as number, completions: m.completions as number, voters: m.voters as number, sharers: m.sharers as number, commenters: m.commenters as number };
    }
    return { periodStart: str(body.period_start, 40), periodEnd: str(body.period_end, 40), minimumViewers: typeof body.minimum_viewers === 'number' ? body.minimum_viewers : 5, metrics };
}
export async function fetchAnalytics(api: Pick<ApiClient, 'request'>, contentId: string): Promise<Analytics> {
    if (!isUuid(contentId)) throw new ApiError(400, 'invalid_query');
    const a = parseAnalytics(await api.request(`/api/v1/cinema/creator-analytics?content_id=${encodeURIComponent(contentId)}`));
    if (!a) throw new ApiError(503, 'temporarily_unavailable');
    return a;
}

import { API_BASE, ApiError, type ApiClient } from './api';
import { OFFLINE_PAID_MESSAGE, OfflineError, ensureOnline } from './network';

// The video agent (ADR-0074): a brief is planned first (no charge), then approved. The server prices
// the plan and signs a ticket; the app shows what the server says and never works out a price.
export const AGENT_MODEL_ID = 'video-agent';
export const ASPECTS = ['9:16', '16:9', '1:1'] as const;
export type Aspect = (typeof ASPECTS)[number];

const BRIEF_MIN = 3;
const BRIEF_MAX = 500;
// Mirrors BRIEF_RE in lib/montagePlan.js: tab, newline and carriage return are allowed, other control characters are not.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export interface Plan {
    readonly planId: string;
    // The key the approving request must carry: one plan buys one run, and a retry is charged once.
    readonly idempotencyKey: string;
    readonly seconds: number | null;
    readonly summary: string;
    readonly credits: number;
    readonly aspect: Aspect;
    // Epoch seconds; a plan lasts 30 minutes.
    readonly expiresAt: number;
}

export type BriefProblem = 'too_short' | 'too_long' | 'invalid';

export function briefProblem(raw: string): BriefProblem | null {
    const brief = raw.trim();
    if (brief.length < BRIEF_MIN) return 'too_short';
    if (brief.length > BRIEF_MAX) return 'too_long';
    return CONTROL.test(brief) ? 'invalid' : null;
}

interface PlanResponse {
    plan_id?: unknown;
    idempotency_key?: unknown;
    plan?: { seconds?: unknown; summary?: unknown } | null;
    credits?: unknown;
    aspect_ratio?: unknown;
    expires_at?: unknown;
}

// One call, never retried here: planning can cost the server a model call and shares the generation rate limit.
export async function requestPlan(api: ApiClient, rawBrief: string, aspect: Aspect): Promise<Plan> {
    const problem = briefProblem(rawBrief);
    if (problem) throw new ApiError(400, 'inputs_invalid:brief');
    const brief = rawBrief.trim();
    const r = await api.request<PlanResponse>('/api/v1/montage/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, aspect_ratio: aspect }),
    });
    const usable =
        typeof r.plan_id === 'string' &&
        typeof r.idempotency_key === 'string' &&
        typeof r.credits === 'number' &&
        Number.isFinite(r.credits) &&
        typeof r.expires_at === 'number' &&
        ASPECTS.includes(r.aspect_ratio as Aspect) &&
        !!r.plan &&
        typeof r.plan.summary === 'string';
    if (!usable) throw new ApiError(502, 'plan_unavailable');
    const seconds = r.plan && Number.isInteger(r.plan.seconds) && (r.plan.seconds as number) > 0 ? (r.plan.seconds as number) : null;
    return {
        planId: r.plan_id as string,
        idempotencyKey: r.idempotency_key as string,
        seconds,
        summary: (r.plan as { summary: string }).summary,
        credits: r.credits as number,
        aspect: r.aspect_ratio as Aspect,
        expiresAt: r.expires_at as number,
    };
}

// Approve = the ordinary generation request carrying the plan's ticket, its key and the price it showed.
// The server refuses a changed brief, another account's ticket, an expired plan or a moved price before any charge.
export async function approvePlan(api: ApiClient, plan: Plan, rawBrief: string): Promise<string> {
    await ensureOnline();
    const r = await api.request<{ job_id?: unknown }>('/api/v1/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model_id: AGENT_MODEL_ID,
            idempotency_key: plan.idempotencyKey,
            confirmed_credits: plan.credits,
            inputs: { brief: rawBrief.trim(), plan_id: plan.planId, aspect_ratio: plan.aspect },
        }),
    });
    if (typeof r.job_id !== 'string') throw new ApiError(502, 'unknown');
    return r.job_id;
}

export function minutesLeft(expiresAtSeconds: number, nowMs: number = Date.now()): number {
    return Math.max(0, Math.ceil((expiresAtSeconds * 1000 - nowMs) / 60000));
}

export function planMessage(err: unknown): string {
    if (err instanceof OfflineError) return OFFLINE_PAID_MESSAGE;
    if (!(err instanceof ApiError)) return 'Something went wrong. Try again.';
    switch (err.code) {
        case 'video_agent_unavailable':
            return 'This is not available right now.';
        case 'plan_unavailable':
            return 'We could not make a plan. You were not charged. Try again in a moment.';
        case 'video_agent_offline':
        case 'narration_unavailable':
            return 'This is busy or offline right now. You were not charged. Try again shortly.';
        case 'video_agent_busy': {
            const secs = typeof err.body.retry_after_seconds === 'number' ? err.body.retry_after_seconds : null;
            return secs ? `Every slot is taken right now. Try again in about ${Math.max(1, Math.round(secs / 60))} minutes.` : 'Every slot is taken right now. Try again in a few minutes.';
        }
        case 'video_agent_in_progress':
            return 'You already have one being made. It will appear in your Library when it is done.';
        case 'plan_expired':
            return 'This plan ran out. Plan again; you were not charged.';
        case 'plan_price_changed':
            return 'The price changed. Plan again to see the new price; you were not charged.';
        case 'plan_invalid':
        case 'plan_mismatch':
        case 'plan_key_mismatch':
            return 'That plan no longer matches. Plan again; you were not charged.';
        case 'inputs_invalid:brief':
            return 'Describe the video in 3 to 500 characters.';
        case 'rate_limited':
            return 'Too many requests. Wait a minute before you plan again.';
        case 'insufficient_credits':
            return 'Not enough credits for this.';
        case 'network':
            return 'No connection. Check it and try again.';
        default:
            return 'Something went wrong. You were not charged. Try again.';
    }
}

// The catalog price of the agent, for the entry in Create; null when it is not listed or is gated.
// This is the catalog's number, shown as "from"; the plan screen shows the server's own price for the plan.
export async function fetchAgentListing(): Promise<{ readonly credits: number } | null> {
    try {
        const res = await fetch(`${API_BASE}/api/catalog`);
        if (!res.ok) return null;
        const body = (await res.json()) as { models?: { id?: string; credits?: number; gated?: boolean }[] };
        const row = (body.models ?? []).find((m) => m.id === AGENT_MODEL_ID);
        return row && !row.gated && typeof row.credits === 'number' ? { credits: row.credits } : null;
    } catch {
        return null;
    }
}

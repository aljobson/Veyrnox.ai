import { t } from './i18n';
import { noteLocalSubmission } from './celebrate';
import { API_BASE, ApiError, type ApiClient } from './api';
import { OFFLINE_PAID_MESSAGE, OfflineError, ensureOnline } from './network';
import type { Job, JobPage } from './media';

// The video agent (ADR-0074): a brief is planned first (no charge), then approved. The server prices
// the plan and signs a ticket; the app shows what the server says and never works out a price.
export const AGENT_MODEL_ID = 'video-agent';
export const RESUME_MAX_AGE_MS = 60 * 60 * 1000;
export const RESUME_MAX_PAGES = 5;

export function pickResumableAgentJob(jobs: readonly Job[], nowMs = Date.now()): { jobId: string; credits: number } | null {
    const job = jobs.find(job => {
        const time = Date.parse(job.created_at);
        const age = nowMs - time;
        return job.model_id === AGENT_MODEL_ID && (job.state === 'queued' || job.state === 'running') &&
            !!job.job_id && Number.isFinite(time) && age >= 0 && age < RESUME_MAX_AGE_MS;
    });
    return job ? { jobId: job.job_id, credits: Number(job.credits) || 0 } : null;
}

export async function findResumableAgentJob(
    listPage: (cursor?: JobPage['next']) => Promise<JobPage>,
    isCurrent: () => boolean,
    nowMs = Date.now(),
): Promise<{ jobId: string; credits: number } | null | undefined> {
    let cursor: JobPage['next'] | undefined;
    for (let pageNumber = 0; pageNumber < RESUME_MAX_PAGES; pageNumber++) {
        const page = await listPage(cursor);
        if (!isCurrent()) return undefined;
        const job = pickResumableAgentJob(page.jobs, nowMs);
        if (job) return job;
        if (!page.next || !page.jobs.length) return null;
        const lastTime = Date.parse(page.jobs[page.jobs.length - 1].created_at);
        if (!Number.isFinite(lastTime) || nowMs - lastTime >= RESUME_MAX_AGE_MS) return null;
        cursor = page.next;
    }
    return null;
}

export const ASPECTS = ['9:16', '16:9', '1:1'] as const;
export type Aspect = (typeof ASPECTS)[number];
export const MAX_NARRATION_LENGTH = 300;

const BRIEF_MIN = 3;
const BRIEF_MAX = 500;
// Mirrors BRIEF_RE in lib/montagePlan.js: tab, newline and carriage return are allowed, other control characters are not.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const NARRATION_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export interface Plan {
    readonly planId: string;
    // The key the approving request must carry: one plan buys one run, and a retry is charged once.
    readonly idempotencyKey: string;
    readonly seconds: number | null;
    readonly summary: string;
    readonly credits: number;
    readonly aspect: Aspect;
    // Exact words bypass the planner and are sent unchanged, apart from outer whitespace, to the speech model.
    readonly narrationText: string;
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

export type NarrationResult = { readonly ok: true; readonly text: string } | { readonly ok: false };

export function normaliseNarration(value: unknown): NarrationResult {
    if (value === undefined) return { ok: true, text: '' };
    if (typeof value !== 'string' || value.length > MAX_NARRATION_LENGTH || NARRATION_CONTROL.test(value) || UNPAIRED_SURROGATE.test(value)) return { ok: false };
    return { ok: true, text: value.trim() };
}

interface PlanResponse {
    plan_id?: unknown;
    idempotency_key?: unknown;
    plan?: { seconds?: unknown; summary?: unknown; narration_supported?: unknown } | null;
    credits?: unknown;
    aspect_ratio?: unknown;
    expires_at?: unknown;
    narration_text?: unknown;
}

// One call, never retried here: planning can cost the server a model call and shares the generation rate limit.
export async function requestPlan(api: ApiClient, rawBrief: string, aspect: Aspect, rawNarration: string = ''): Promise<Plan> {
    const problem = briefProblem(rawBrief);
    if (problem) throw new ApiError(400, 'inputs_invalid:brief');
    const narration = normaliseNarration(rawNarration);
    if (!narration.ok) throw new ApiError(400, 'inputs_invalid:narration_text');
    const brief = rawBrief.trim();
    const r = await api.request<PlanResponse>('/api/v1/montage/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, aspect_ratio: aspect, ...(narration.text ? { narration_text: narration.text } : {}) }),
    });
    const usable =
        typeof r.plan_id === 'string' &&
        typeof r.idempotency_key === 'string' &&
        typeof r.credits === 'number' &&
        Number.isFinite(r.credits) &&
        typeof r.expires_at === 'number' &&
        ASPECTS.includes(r.aspect_ratio as Aspect) &&
        !!r.plan &&
        typeof r.plan.summary === 'string' &&
        (!narration.text || (r.narration_text === narration.text && r.plan.narration_supported === true));
    if (!usable) throw new ApiError(502, 'plan_unavailable');
    const seconds = r.plan && Number.isInteger(r.plan.seconds) && (r.plan.seconds as number) > 0 ? (r.plan.seconds as number) : null;
    return {
        planId: r.plan_id as string,
        idempotencyKey: r.idempotency_key as string,
        seconds,
        summary: (r.plan as { summary: string }).summary,
        credits: r.credits as number,
        aspect: r.aspect_ratio as Aspect,
        narrationText: narration.text,
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
            inputs: { brief: rawBrief.trim(), plan_id: plan.planId, aspect_ratio: plan.aspect, ...(plan.narrationText ? { narration_text: plan.narrationText } : {}) },
        }),
    });
    if (typeof r.job_id !== 'string') throw new ApiError(502, 'unknown');
    noteLocalSubmission(r.job_id);
    return r.job_id;
}

export function minutesLeft(expiresAtSeconds: number, nowMs: number = Date.now()): number {
    return Math.max(0, Math.ceil((expiresAtSeconds * 1000 - nowMs) / 60000));
}

export function planMessage(err: unknown): string {
    if (err instanceof OfflineError) return OFFLINE_PAID_MESSAGE;
    if (!(err instanceof ApiError)) return t('montage.somethingwentwrongTryagain');
    switch (err.code) {
        case 'video_agent_unavailable':
            return t('montage.thisisnotavailablerightnow');
        case 'plan_unavailable':
            return t('montage.wecouldnotmakeaplanYou');
        case 'video_agent_offline':
        case 'narration_unavailable':
            return t('montage.thisisbusyorofflinerightnow');
        case 'video_agent_busy': {
            const secs = typeof err.body.retry_after_seconds === 'number' ? err.body.retry_after_seconds : null;
            return secs ? t('montage.everyslotistakenrightnowTry', { value1: Math.max(1, Math.round(secs / 60)) }) : t('montage.everyslotistakenrightnowTry2');
        }
        case 'video_agent_in_progress':
            return t('montage.youalreadyhaveonebeingmadeIt');
        case 'plan_expired':
            return t('montage.thisplanranoutPlanagainyou');
        case 'plan_price_changed':
            return t('montage.thepricechangedPlanagaintosee');
        case 'plan_invalid':
        case 'plan_mismatch':
        case 'plan_key_mismatch':
            return t('montage.thatplannolongermatchesPlanagain');
        case 'inputs_invalid:brief':
            return t('montage.describethevideoin3to500');
        case 'inputs_invalid:narration_text':
            return t('montage.keeptheexactnarrationtocharactersand', { value1: MAX_NARRATION_LENGTH });
        case 'rate_limited':
            return t('montage.toomanyrequestsWaitaminutebefore');
        case 'insufficient_credits':
            return t('montage.notenoughcreditsforthis');
        case 'network':
            return t('montage.noconnectionCheckitandtryagain');
        default:
            return t('montage.somethingwentwrongYouwerenotcharged');
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

export function videoAgentBalanceState(balance: number | null, credits: number): 'unavailable' | 'insufficient' | 'ready' {
    if (balance === null || !Number.isFinite(balance) || balance < 0 || !Number.isFinite(credits) || credits < 0) return 'unavailable';
    return balance < credits ? 'insufficient' : 'ready';
}

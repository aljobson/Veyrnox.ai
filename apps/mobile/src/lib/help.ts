import type { ApiClient } from './api';

// The Vey help assistant (ADR-0103, ADR-0125, ADR-0170): free, rate-limited product guidance from POST /api/v1/help. It answers
// in words and may point at a place in the app; it can never press anything, and spending, deleting and publishing are not
// in its contract.
export const MAX_QUESTION = 500;

export interface HelpPlan {
    readonly message: string;
    readonly target: string | null;
    readonly action: string;
}

export interface HelpTurn {
    readonly role: 'user' | 'assistant';
    readonly content: string;
}

export function parseHelpPlan(body: unknown): HelpPlan | null {
    const plan = body && typeof body === 'object' ? (body as { plan?: unknown }).plan : null;
    if (!plan || typeof plan !== 'object') return null;
    const p = plan as { message?: unknown; target?: unknown; action?: unknown };
    const message = typeof p.message === 'string' ? p.message.trim() : '';
    if (!message) return null;
    return { message, target: typeof p.target === 'string' ? p.target : null, action: typeof p.action === 'string' ? p.action : 'none' };
}

// The last six turns, trimmed the way the route trims them, so a long chat cannot push the request over its limits.
export function trimHistory(turns: readonly HelpTurn[]): HelpTurn[] {
    return turns.slice(-6).map((t) => ({ role: t.role, content: t.content.trim().slice(0, t.role === 'user' ? 500 : 700) }));
}

export const askHelp = async (api: ApiClient, question: string, history: readonly HelpTurn[]): Promise<HelpPlan> => {
    const body = await api.request<unknown>('/api/v1/help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The web sends page targets it can see; the phone has none, so the answer is words and an optional place to go.
        body: JSON.stringify({ question: question.trim().slice(0, MAX_QUESTION), pathname: '/app', history: trimHistory(history) }),
    });
    const plan = parseHelpPlan(body);
    if (!plan) throw new Error('bad_help_answer');
    return plan;
};

// Where a help target or action leads on the phone, or null when the phone has no such place (Oddlings, Film, Projects and the
// rest are not on this phone yet, so no button is shown rather than a dead one).
export function helpRoute(plan: Pick<HelpPlan, 'target' | 'action'>): string | null {
    if (plan.action === 'open_create' || plan.action === 'focus_prompt') return '/create';
    if (plan.action === 'open_library') return '/library';
    if (plan.action === 'open_credits') return '/credits';
    if (plan.action === 'none' || !plan.target) return null;
    const area = plan.target.split('.')[0];
    const sub = plan.target;
    if (sub === 'nav.explore') return '/';
    if (sub === 'nav.create') return '/create';
    if (sub === 'nav.chat') return '/chat';
    if (sub === 'nav.library') return '/library';
    if (sub === 'nav.credits') return '/credits';
    if (sub === 'nav.account') return '/account';
    if (sub === 'nav.publish') return '/publish';
    if (area === 'create') return '/create';
    if (area === 'chat') return '/chat';
    if (area === 'library') return '/library';
    if (area === 'credits') return '/credits';
    if (area === 'account') return '/account';
    if (area === 'publish') return '/publish';
    if (area === 'explore') return '/';
    return null;
}

export function helpErrorKey(err: unknown): string {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'rate_limited') return 'help.err.rate';
    if (code === 'network') return 'help.err.network';
    return 'help.err.later';
}

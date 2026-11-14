import { t } from './i18n';

// Every Publish screen that can answer 402 maps it to one of these messages. A screen that shows one of them is
// plan-locked: it should hide controls that cannot work and point at the plan, not offer "Try again".
export const PLAN_LOCK_KEYS = [
    'ads.err.plan', 'approvals.err.plan', 'autolists.err.plan', 'calendar.err.plan', 'commerce.err.plan', 'contacts.err.plan',
    'dev.err.plan', 'drafts.err.plan', 'inbox.err.plan', 'insights.err.plan', 'queue.err.plan', 'queues.err.plan',
    'reports.err.plan', 'smartlink.err.plan', 'team.err.plan',
] as const;

export function isPlanLockKey(key: string): boolean {
    return (PLAN_LOCK_KEYS as readonly string[]).includes(key);
}

export function isPlanLockMessage(message: string | null | undefined): boolean {
    if (!message) return false;
    return PLAN_LOCK_KEYS.some((key) => t(key) === message);
}

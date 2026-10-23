import type { PublishAccountsState, PublishPost, PublishRole } from './publish';

export type PublishDestinationId =
    | 'accounts' | 'posts' | 'calendar' | 'analytics' | 'bestTime' | 'drafts' | 'approvals' | 'brands'
    | 'inbox' | 'contacts' | 'workflows' | 'smartlink' | 'queues' | 'autolists' | 'reports' | 'ads'
    | 'commerce' | 'team' | 'activity' | 'developer';

export const canPublish = (role: PublishRole): boolean => ['owner', 'manager', 'editor'].includes(role);
export const canReview = (role: PublishRole): boolean => ['owner', 'manager', 'reviewer'].includes(role);
export const canManageBrand = (role: PublishRole): boolean => ['owner', 'manager'].includes(role);
export const hasPublishPlan = (state: PublishAccountsState): boolean => !state.plansEnabled || state.planTier === 'publish';
export const canConnectAccounts = (state: PublishAccountsState, selectedBrand: string | null): boolean =>
    state.brandRole === 'owner' && selectedBrand === null && state.accounts.length < state.accountLimit;

// Mirrors the authenticated website's capability, entitlement and role gates. The server still enforces every route;
// this keeps the mobile dashboard honest by not advertising controls a person cannot use.
export function publishDestinations(state: PublishAccountsState): PublishDestinationId[] {
    const paid = hasPublishPlan(state);
    const role = state.brandRole;
    const out: PublishDestinationId[] = ['accounts', 'posts', 'analytics', 'brands'];
    if (paid) out.push('calendar', 'bestTime');
    if (canReview(role)) out.push('drafts');
    if (state.features.approvals && paid && canPublish(role)) out.push('approvals');
    if (state.features.inbox) out.push('inbox', 'contacts');
    if (state.features.inbox && state.features.inboxWorkflows && paid) out.push('workflows');
    if (state.features.smartlinks) out.push('smartlink');
    if (state.features.queues && paid) out.push('queues');
    if (state.features.rssAutolists && state.features.queues && paid) out.push('autolists');
    if (state.features.reports && paid) out.push('reports');
    if (state.features.ads && paid) out.push('ads');
    if (state.features.commerce && paid) out.push('commerce');
    if (state.features.teams && paid && canManageBrand(role)) out.push('team', 'activity');
    if ((state.features.customerApi || state.features.customerWebhooks) && paid && canManageBrand(role)) out.push('developer');
    return out;
}

export interface PublishSummary {
    readonly connected: number;
    readonly attention: number;
    readonly scheduled: number;
    readonly failed: number;
    readonly nextScheduled: PublishPost | null;
}

export function publishSummary(state: PublishAccountsState, posts: readonly PublishPost[], now: Date = new Date()): PublishSummary {
    const connected = state.accounts.filter((account) => account.status === 'active').length;
    const attention = state.accounts.length - connected;
    const scheduled = posts.filter((post) => post.status === 'scheduled').length;
    const failed = posts.filter((post) => post.status === 'failed' || post.targets.some((target) => target.publishStatus === 'failed')).length;
    const timestamp = now.getTime();
    const nextScheduled = posts
        .filter((post) => post.status === 'scheduled' && post.scheduledAt && new Date(post.scheduledAt).getTime() >= timestamp)
        .sort((a, b) => new Date(a.scheduledAt as string).getTime() - new Date(b.scheduledAt as string).getTime())[0] ?? null;
    return { connected, attention, scheduled, failed, nextScheduled };
}

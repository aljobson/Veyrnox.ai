import type { PublishAccountsState, PublishPost, PublishRole } from './publish';
import { canPublish, hasPublishPlan } from './publishDashboard';

export function composeGates(state: PublishAccountsState) {
    const paid = hasPublishPlan(state);
    return {
        paid, multiAccount: paid, schedule: paid,
        queues: state.features.queues && paid,
        presets: state.features.contentPresets && paid,
        // The server refuses variants when plans are unconfigured, even if the flag is on.
        variants: state.plansEnabled && state.planTier === 'publish' && state.features.variants,
        youtubeVisibility: state.youtubeVisibilityEnabled === true,
    };
}
export function toggleAccount(ids: string[], id: string, multi: boolean): string[] {
    return ids.includes(id) ? ids.filter(value => value !== id) : multi ? [...ids, id] : [id];
}
export function postActions(post: PublishPost, role: PublishRole | null) {
    const allowed = role !== null && canPublish(role);
    const pending = post.targets.every(target => target.publishStatus === 'pending');
    const actionable = post.status === 'scheduled' || post.status === 'canceled';
    return {
        reschedule: allowed && pending && post.status === 'scheduled',
        cancel: allowed && pending && post.status === 'scheduled' && !!post.updatedAt,
        restore: allowed && pending && post.status === 'canceled' && !!post.updatedAt,
        note: role === null ? null : !allowed && actionable ? 'publishParity.post.readOnly' : allowed && !pending ? 'publishParity.post.locked' : null,
    };
}

import { publishRuntimeFeatureEnabled } from './runtimeFlags.js';

export const FREE_SOCIAL_ACCOUNT_LIMIT = 1;
export const PUBLISH_SOCIAL_ACCOUNT_LIMIT = 5;

// The grouped rollout switch selects the entitlement-aware writer. A legacy
// individual value remains available as an emergency override.
export function freeSocialAccountLimit(env = process.env) {
    return FREE_SOCIAL_ACCOUNT_LIMIT;
}

export function socialAccountLimitForTier(tier) {
    return tier === 'publish' ? PUBLISH_SOCIAL_ACCOUNT_LIMIT : FREE_SOCIAL_ACCOUNT_LIMIT;
}
export function socialConnectionWriter(env = process.env) {
    return publishRuntimeFeatureEnabled('PUBLISH_MULTI_ACCOUNT_ENABLED', env)
        ? 'record_social_multi_account_connection' : 'record_social_account_connection';
}

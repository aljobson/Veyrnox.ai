export const FREE_SOCIAL_ACCOUNT_LIMIT = 1;
export const PUBLISH_SOCIAL_ACCOUNT_LIMIT = 5;

// The legacy rollout switch selects the entitlement-aware writer. The writer
// itself decides whether the caller receives the Free or Publish allowance.
export function freeSocialAccountLimit(env = process.env) {
    return FREE_SOCIAL_ACCOUNT_LIMIT;
}

export function socialAccountLimitForTier(tier) {
    return tier === 'publish' ? PUBLISH_SOCIAL_ACCOUNT_LIMIT : FREE_SOCIAL_ACCOUNT_LIMIT;
}
export function socialConnectionWriter(env = process.env) {
    return env.PUBLISH_MULTI_ACCOUNT_ENABLED === 'true'
        ? 'record_social_multi_account_connection' : 'record_social_account_connection';
}

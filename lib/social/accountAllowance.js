// Server-selected free allowance; activate after migration 0265 and acceptance.
export function freeSocialAccountLimit(env = process.env) {
    return env.PUBLISH_MULTI_ACCOUNT_ENABLED === 'true' ? 5 : 1;
}
export function socialConnectionWriter(env = process.env) {
    return env.PUBLISH_MULTI_ACCOUNT_ENABLED === 'true'
        ? 'record_social_multi_account_connection' : 'record_social_account_connection';
}

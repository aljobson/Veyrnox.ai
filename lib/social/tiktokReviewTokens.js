import { networkReleased } from './networks.js';
import { tiktokReviewAllowed } from './tiktokReview.js';
import { tiktokConfig } from '../../packages/adapters/social/tiktok.js';

// Server-only credential selection stays out of the upload validation module's
// client graph. The envelope is a valid bytea hex literal, not a text prefix.
const REVIEW_TOKEN_PREFIX = '\\x766579726e6f782d74696b746f6b2d7265766965772d76313a';

function reviewConfig(env) {
    return tiktokConfig({
        TIKTOK_CLIENT_KEY: env.TIKTOK_REVIEW_CLIENT_KEY,
        TIKTOK_CLIENT_SECRET: env.TIKTOK_REVIEW_CLIENT_SECRET,
    });
}

// Missing sandbox credentials fail closed, never falling back to a different
// app. The sandbox always requests only identity and inbox-upload scopes.
export function tiktokConnectionConfig(authId, env = process.env) {
    if (networkReleased('tiktok', env)) return tiktokConfig(env);
    return tiktokReviewAllowed(authId, env) ? reviewConfig(env) : null;
}

export function isTiktokReviewToken(value) {
    return typeof value === 'string' && value.startsWith(REVIEW_TOKEN_PREFIX);
}

export function wrapTiktokToken(encrypted, review) {
    return review ? REVIEW_TOKEN_PREFIX + encrypted.slice(2) : encrypted;
}

export function unwrapTiktokToken(encrypted) {
    return isTiktokReviewToken(encrypted) ? '\\x' + encrypted.slice(REVIEW_TOKEN_PREFIX.length) : encrypted;
}

// Stored tokens retain their app identity after pilot closure or public
// release. A refresh never uses production credentials for a sandbox token.
export function tiktokStoredConfig(target, env = process.env) {
    const review = isTiktokReviewToken(target.access_token_enc);
    if (review !== isTiktokReviewToken(target.refresh_token_enc)) return null;
    return review ? reviewConfig(env) : tiktokConfig(env);
}

import { rpc } from '../../packages/db/supabase-client.js';
import { createOAuthState, oauthStateDigest, verifyOAuthState } from './oauthState.js';

/** Create a unique state token and persist only its digest. */
export async function issueOAuthState({ authId, network }, secret, cfg) {
    const state = await createOAuthState({ authId, network }, secret);
    const stored = await rpc('prepare_social_oauth_state', {
        p_auth_id: authId,
        p_network: network,
        p_state_hash: await oauthStateDigest(state),
    }, cfg);
    if (stored?.ok !== true) throw new Error('oauth_state_store_failed');
    return state;
}

/** Verify and atomically consume a state before exchanging a provider code. */
export async function consumeOAuthState(state, { authId, network }, secret, cfg) {
    if (!await verifyOAuthState(state, { authId, network }, secret)) return false;
    const consumed = await rpc('consume_social_oauth_state', {
        p_auth_id: authId,
        p_network: network,
        p_state_hash: await oauthStateDigest(state),
    }, cfg);
    return consumed?.ok === true;
}

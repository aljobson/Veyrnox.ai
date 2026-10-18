/**
 * GET /social/connect/mobile/<network> — hands a Publish connect code from the
 * browser back to the Veyrnox app (ADR-0136).
 *
 * The mobile app starts a connect with `client: "mobile"`, so the provider
 * redirects here instead of to the web landing page, which would have no
 * session on a phone. We forward the one-time `code` and signed `state` to the
 * fixed app address and nothing else. The target is a constant and the network
 * must be a known OAuth network, so this is not an open redirect. The code is
 * useless without the PKCE verifier the app holds and its own Bearer token: the
 * app POSTs { code, state, codeVerifier, client: "mobile" } to
 * /api/v1/social/accounts/<network>/callback.
 */

import { APP_CONNECT_CALLBACK } from '../../../../../lib/social/connectReturn.js';
import { SOCIAL_NETWORKS } from '../../../../../lib/social/networks.js';

const NETWORKS = new Set(SOCIAL_NETWORKS.filter((n) => !n.credentials).map((n) => n.key));
// Provider codes vary (TikTok's holds `*` and `!`); printable ASCII, bounded.
const CODE_RE = /^[\x21-\x7E]{1,2048}$/;
// Our own signed state: base64url payload, a dot, base64url signature.
const STATE_RE = /^[A-Za-z0-9_-]{1,1024}\.[A-Za-z0-9_-]{1,512}$/;
const ERROR_RE = /^[a-z_]{1,64}$/;

export async function GET(req, { params }) {
    const { network } = await params;
    const query = new URL(req.url).searchParams;
    const target = new URL(APP_CONNECT_CALLBACK);
    const code = query.get('code');
    const state = query.get('state');
    const error = query.get('error');
    if (!NETWORKS.has(network)) {
        target.searchParams.set('error', 'unknown_network');
    } else {
        target.searchParams.set('network', network);
        if (code && state && CODE_RE.test(code) && STATE_RE.test(state)) {
            target.searchParams.set('code', code);
            target.searchParams.set('state', state);
        } else {
            target.searchParams.set('error', error && ERROR_RE.test(error) ? error : 'invalid_request');
        }
    }
    return new Response(null, {
        status: 302,
        headers: { Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
}

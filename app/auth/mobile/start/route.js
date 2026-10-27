/**
 * GET /auth/mobile/start — begins Google or Apple sign-in for the Veyrnox app
 * (ADR-0106, amendment 2).
 *
 * The app opens this address in the system sign-in sheet instead of the
 * Supabase project address, so iOS names veyrnox.ai in its "wants to use … to
 * sign in" prompt. It forwards only a known provider and a well-formed PKCE
 * challenge to Supabase's authorize endpoint, and always returns to the fixed
 * /auth/mobile bridge on our own host: both targets come from configuration,
 * never from the request, so this is not an open redirect.
 */

const PUBLIC_ORIGIN = process.env.PUBLIC_HOST || 'https://veyrnox.ai';
const PROVIDERS = new Set(['google', 'apple']);
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43,128}$/;

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export function GET(req) {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) return Response.json({ error: 'oauth_not_configured' }, { status: 503, headers });
    const params = new URL(req.url).searchParams;
    const provider = params.get('provider');
    const challenge = params.get('code_challenge');
    if (!PROVIDERS.has(provider) || !challenge || !CHALLENGE_RE.test(challenge)) {
        return Response.json({ error: 'invalid_request' }, { status: 400, headers });
    }
    const target = new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/authorize`);
    target.searchParams.set('provider', provider);
    target.searchParams.set('redirect_to', `${PUBLIC_ORIGIN.replace(/\/$/, '')}/auth/mobile`);
    target.searchParams.set('code_challenge', challenge);
    target.searchParams.set('code_challenge_method', 's256');
    // The system sheet shares browser cookies; without this Google silently reuses the last account.
    if (provider === 'google') target.searchParams.set('prompt', 'select_account');
    return new Response(null, { status: 302, headers: { ...headers, Location: target.toString() } });
}

/**
 * GET /auth/mobile — hands a sign-in code from the browser back to the
 * Veyrnox app (ADR-0106, amendment 1).
 *
 * Supabase sends the browser here after Google or Apple sign-in because this
 * address is on the site's own origin, which its redirect list always allows.
 * The app cannot rely on its own scheme being listed in every environment.
 * We forward only a PKCE `code` (useless without the verifier the app holds)
 * or a short error word to the fixed app address, and nothing else: the target
 * is a constant, so this is not an open redirect.
 */

const APP_CALLBACK = 'ai.veyrnox.app://auth/callback';
const CODE_RE = /^[A-Za-z0-9._~-]{8,512}$/;
const ERROR_RE = /^[a-z_]{1,64}$/;

export function GET(req) {
    const params = new URL(req.url).searchParams;
    const target = new URL(APP_CALLBACK);
    const code = params.get('code');
    const error = params.get('error');
    if (code && CODE_RE.test(code)) target.searchParams.set('code', code);
    else target.searchParams.set('error', error && ERROR_RE.test(error) ? error : 'invalid_request');
    return new Response(null, {
        status: 302,
        headers: { Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
}

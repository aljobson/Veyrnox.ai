// Development fixtures only. No app/runtime imports; opt in with MOCK_SECURITY_FIXTURES=1.
export const securityFixturesEnabled = (env = process.env) => env.MOCK_SECURITY_FIXTURES === '1' && env.NODE_ENV !== 'production';
export const SECURITY_CODE = '123456';
export const SECURITY_SECRET = 'JBSWY3DPEHPK3PXP';
export const SECURITY_URI = `otpauth://totp/Veyrnox:creator?secret=${SECURITY_SECRET}&issuer=Veyrnox`;
const userId = '00000000-0000-4000-8000-000000000001';
const date = '2026-10-20T10:00:00Z';
export function createSecurityFixtures() {
    return {
        factors: [{ id: 'mock-totp', factor_type: 'totp', status: 'verified', friendly_name: 'Authenticator' }],
        passkeys: [
            { id: 'mock_key_phone', friendly_name: 'iPhone', created_at: date, last_used_at: date },
            { id: 'mock_key_laptop', friendly_name: 'Laptop', created_at: date, last_used_at: null },
        ],
        devices: [{ id: 'mock-phone', name: 'This iPhone', current: true }, { id: 'mock-laptop', name: 'Laptop', current: false }],
        grants: [{ client_id: '11111111-1111-4111-8111-111111111111', client_name: 'Demo assistant', scopes: ['profile'], granted_at: date }],
        challenges: new Set(),
        aal: 'aal1',
    };
}
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
export function securityTokens(aal = 'aal1') {
    return {
        access_token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: userId, aal, exp: Math.floor(Date.now() / 1000) + 3600 })}.mock`,
        refresh_token: `mock-refresh-${aal}`, expires_in: 3600, token_type: 'bearer',
    };
}
// Return null for routes owned by the ordinary mock server. Each test/server gets isolated mutable state.
export function securityResponse(state, method, url, body = {}) {
    const path = url.pathname;
    const ok = (body) => ({ status: 200, body });
    const error = (error_code, status = 400) => ({ status, body: { error_code } });
    if ((path === '/auth/v1/token' || path === '/auth/v1/signup') && method === 'POST') {
        const aal = body.refresh_token === 'mock-refresh-aal2' ? 'aal2' : 'aal1';
        return ok(securityTokens(aal));
    }
    if (path === '/auth/v1/user' && method === 'GET') return ok({ id: userId, email: 'creator@veyrnox.local', app_metadata: { provider: 'email' }, factors: state.factors });
    if (path === '/auth/v1/factors' && method === 'POST') {
        const factor = { id: 'mock-enrolment', factor_type: 'totp', status: 'unverified', friendly_name: body.friendly_name };
        state.factors = [...state.factors.filter(f => f.id !== factor.id), factor];
        return ok({ id: factor.id, totp: { secret: SECURITY_SECRET, uri: SECURITY_URI } });
    }
    const match = path.match(/^\/auth\/v1\/factors\/([^/]+)(?:\/(challenge|verify))?$/);
    if (match) {
        const factor = state.factors.find(f => f.id === match[1]);
        if (!factor) return error('factor_not_found', 404);
        if (method === 'POST' && match[2] === 'challenge') {
            const id = `challenge-${factor.id}`;
            state.challenges.add(id);
            return ok({ id });
        }
        if (method === 'POST' && match[2] === 'verify') {
            if (!state.challenges.has(body.challenge_id) || body.challenge_id !== `challenge-${factor.id}` || body.code !== SECURITY_CODE) return error('mfa_verification_failed');
            state.challenges.delete(body.challenge_id);
            factor.status = 'verified';
            state.aal = 'aal2';
            return ok(securityTokens('aal2'));
        }
        if (method === 'DELETE' && !match[2]) {
            state.factors = state.factors.filter(f => f.id !== factor.id);
            return ok({});
        }
    }
    if (path === '/auth/v1/passkeys' && method === 'GET') return ok({ passkeys: state.passkeys });
    if (path.startsWith('/auth/v1/passkeys/') && method === 'DELETE') {
        state.passkeys = state.passkeys.filter(p => p.id !== path.split('/').pop());
        return ok({});
    }
    // Native passkey creation still needs a real associated domain; component tests cover add/cancel.
    if (path === '/auth/v1/user/oauth/grants') {
        if (method === 'GET') return ok({ grants: state.grants });
        if (method === 'DELETE') {
            state.grants = state.grants.filter(g => g.client_id !== url.searchParams.get('client_id'));
            return ok({ revoked: true });
        }
    }
    if (path === '/auth/v1/logout' && method === 'POST') {
        state.devices = url.searchParams.get('scope') === 'others' ? state.devices.filter(d => d.current) : [];
        return ok({});
    }
    return null;
}
const state = createSecurityFixtures();
export function mockSecurity(req, res, url, body) {
    if (!securityFixturesEnabled()) return false;
    const response = securityResponse(state, req.method, url, body);
    if (!response) return false;
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response.body));
    return true;
}

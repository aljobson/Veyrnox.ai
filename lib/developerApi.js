import { readPublicCatalog } from './publicCatalog.js';
import { estimatedCredits } from './generationEstimate.js';
import { POST as createGeneration } from '../app/api/v1/generations/route.js';
import { GET as listGenerations } from '../app/api/v1/jobs/route.js';
import { GET as readGeneration } from '../app/api/v1/jobs/[id]/route.js';
import { GET as readAsset } from '../app/api/v1/jobs/[id]/asset/route.js';
import { GET as readBalance } from '../app/api/v1/balance/route.js';

const PUBLIC_ORIGIN = process.env.PUBLIC_HOST || 'https://veyrnox.ai';
const MODEL_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY = ['x-veyrnox-auth-id', 'x-veyrnox-auth-email', 'x-veyrnox-auth-role',
    'x-veyrnox-auth-client-id', 'x-veyrnox-auth-aal', 'x-veyrnox-auth-mfa-at', 'x-request-id', 'cf-ipcountry'];

const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-expose-headers': 'Retry-After, WWW-Authenticate, X-Request-Id',
    'access-control-max-age': '86400',
};

const oauthChallenge = `Bearer resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/api/v1/developer", error="insufficient_scope"`;

function json(body, status = 200, headers = {}) {
    return Response.json(body, { status, headers: { ...corsHeaders, 'cache-control': 'no-store', ...headers } });
}

function trustedHeaders(source) {
    const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json' });
    for (const name of IDENTITY) {
        const value = source.headers.get(name);
        if (value) headers.set(name, value);
    }
    return headers;
}

async function internal(handler, source, path, { method = 'GET', body, params } = {}) {
    const request = new Request(new URL(path, PUBLIC_ORIGIN), {
        method,
        headers: trustedHeaders(source),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = await handler(request, params ? { params: Promise.resolve(params) } : undefined);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
    headers.set('cache-control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
}

async function requestJson(request) {
    const text = await request.text();
    if (text.length > 64 * 1024) return { error: 'body_too_large', status: 413 };
    try { return { value: JSON.parse(text) }; } catch { return { error: 'invalid_json', status: 400 }; }
}

export async function developerApi(request, segments = []) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (!request.headers.get('x-veyrnox-auth-id')) return json({ error: 'not_authenticated' }, 401);
    if (!request.headers.get('x-veyrnox-auth-client-id')) {
        return json({ error: 'oauth_client_required' }, 403, { 'www-authenticate': oauthChallenge });
    }

    const method = request.method;
    const path = segments.join('/');
    if (method === 'GET' && path === '') return json({
        name: 'Veyrnox Developer API', version: '1.0.0', documentation: `${PUBLIC_ORIGIN}/developers`,
        openapi: `${PUBLIC_ORIGIN}/api/developer/openapi`,
    });
    if (method === 'GET' && path === 'me') return json({
        id: request.headers.get('x-veyrnox-auth-id'),
        email: request.headers.get('x-veyrnox-auth-email') || null,
        oauth_client_id: request.headers.get('x-veyrnox-auth-client-id'),
    });
    if (method === 'GET' && path === 'models') {
        try {
            const models = await readPublicCatalog();
            return json({ models, count: models.length }, 200, { 'cache-control': 'private, max-age=60' });
        } catch { return json({ error: 'catalog_unavailable' }, 503); }
    }
    if (method === 'POST' && path === 'estimates') {
        const parsed = await requestJson(request);
        if (parsed.error) return json({ error: parsed.error }, parsed.status);
        const body = parsed.value;
        if (!body || typeof body !== 'object' || Array.isArray(body) || !MODEL_ID_RE.test(body.model_id || '')) {
            return json({ error: 'model_id_required' }, 400);
        }
        if (body.duration_seconds !== undefined && (!Number.isInteger(body.duration_seconds) || body.duration_seconds <= 0 || body.duration_seconds > 600)) {
            return json({ error: 'duration_seconds_invalid' }, 400);
        }
        try {
            const models = await readPublicCatalog();
            const model = models.find((entry) => entry.id === body.model_id);
            if (!model) return json({ error: 'model_not_found' }, 404);
            const credits = estimatedCredits(model, body.duration_seconds);
            if (credits === null) return json({ error: 'duration_not_supported', supported_durations: model.durations || [] }, 400);
            return json({ model_id: model.id, model_name: model.name, modality: model.modality,
                duration_seconds: model.modality.endsWith('video') ? (body.duration_seconds || 5) : null,
                maximum_credits: credits, may_use_free_allowance: true });
        } catch { return json({ error: 'catalog_unavailable' }, 503); }
    }
    if (method === 'GET' && path === 'balance') return internal(readBalance, request, '/api/v1/balance');
    if (path === 'generations' && method === 'GET') {
        const query = new URL(request.url).search;
        return internal(listGenerations, request, `/api/v1/jobs${query}`);
    }
    if (path === 'generations' && method === 'POST') {
        const parsed = await requestJson(request);
        if (parsed.error) return json({ error: parsed.error }, parsed.status);
        if (!parsed.value || !Number.isInteger(parsed.value.confirmed_credits) || parsed.value.confirmed_credits < 0) {
            return json({ error: 'confirmed_credits_required' }, 400);
        }
        return internal(createGeneration, request, '/api/v1/generations', { method: 'POST', body: parsed.value });
    }
    if (segments.length === 2 && segments[0] === 'generations') {
        const id = segments[1];
        if (!UUID_RE.test(id)) return json({ error: 'invalid_job_id' }, 400);
        if (method === 'GET') return internal(readGeneration, request, `/api/v1/jobs/${id}`, { params: { id } });
    }
    if (segments.length === 3 && segments[0] === 'generations' && segments[2] === 'asset') {
        const id = segments[1];
        if (!UUID_RE.test(id)) return json({ error: 'invalid_job_id' }, 400);
        if (method === 'GET') return internal(readAsset, request, `/api/v1/jobs/${id}/asset${new URL(request.url).search}`, { params: { id } });
    }
    return json({ error: 'not_found' }, 404);
}

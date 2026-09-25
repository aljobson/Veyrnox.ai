import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { cinemaFeatures } from './features.js';
import { AI_DISCLOSURES } from './domain.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = ['FILM','SHORT','TRAILER','SERIES','SEASON','EPISODE'];
const fields = ['content_type','parent_id','position','title','synopsis','language','ai_disclosures'];
const errors = { creator_required: 403, account_not_active: 403, content_not_found: 404,
  invalid_draft: 400, invalid_parent: 400, revision_conflict: 409, idempotency_conflict: 409,
  structure_locked: 409, position_taken: 409, draft_locked: 409, draft_limit_reached: 409 };
export function validDraft(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== fields.length
    || Object.keys(body).some(k => !fields.includes(k)) || !TYPES.includes(body.content_type)
    || typeof body.title !== 'string' || [...body.title.trim()].length < 1 || [...body.title.trim()].length > 160
    || typeof body.synopsis !== 'string' || [...body.synopsis].length > 2000
    || typeof body.language !== 'string' || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(body.language)
    || !Array.isArray(body.ai_disclosures) || body.ai_disclosures.length > 8
    || new Set(body.ai_disclosures).size !== body.ai_disclosures.length
    || body.ai_disclosures.some(x => !AI_DISCLOSURES.includes(x))) return false;
  return ['SEASON','EPISODE'].includes(body.content_type)
    ? typeof body.parent_id === 'string' && UUID.test(body.parent_id) && Number.isInteger(body.position) && body.position >= 1 && body.position <= 10000
    : body.parent_id === null && body.position === null;
}
export function contentHandler({ action = 'list', rpcCall = rpc } = {}) {
  return async req => {
    const requestId = crypto.randomUUID(), auth = req.headers.get('x-veyrnox-auth-id');
    const reply = (body, status = 200, headers = {}) => {
      console.info(JSON.stringify({ event: 'cinema.content', request_id: requestId,
        actor_id: UUID.test(auth || '') ? auth : undefined, action, status, code: body.error || 'ok' }));
      return Response.json({ ...body, request_id: requestId }, { status,
        headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId, ...headers } });
    };
    if (!UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    if (!cinemaFeatures(process.env).content) return reply({ error: 'content_not_open' }, 503);
    try {
      const cfg = envConfig(), query = new URL(req.url).searchParams;
      if ([...query.keys()].some(k => action !== 'list' || k !== 'parent_id') || query.getAll('parent_id').length > 1
        || (query.has('parent_id') && !UUID.test(query.get('parent_id')))) return reply({ error: 'invalid_query' }, 400);
      const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, cfg);
      if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
      if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
      let name = 'list_own_cinema_content', args = { p_auth_id: auth, p_parent_id: query.get('parent_id') };
      if (action !== 'list') {
        const key = req.headers.get('idempotency-key');
        if (!UUID.test(key || '')) return reply({ error: 'invalid_idempotency_key' }, 400);
        if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'invalid_content_type' }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response) return reply({ error: 'invalid_body' }, limited.response.status);
        let body;
        try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
        if (!body || Array.isArray(body) || typeof body !== 'object') return reply({ error: 'invalid_draft' }, 400);
        const { id, revision, ...draft } = body;
        if (!validDraft(draft) || (action === 'create' ? Object.hasOwn(body, 'id') || Object.hasOwn(body, 'revision')
          : typeof id !== 'string' || !UUID.test(id) || !Number.isInteger(revision) || revision < 1 || revision > 2147483646)) return reply({ error: 'invalid_draft' }, 400);
        name = 'save_cinema_draft'; args = { p_auth_id: auth, p_idempotency_key: key,
          p_content_id: action === 'create' ? null : id, p_revision: action === 'create' ? 0 : revision, p_draft: draft };
      }
      const result = await rpcCall(name, args, cfg);
      if (result?.error && Object.hasOwn(errors, result.error)) return reply({ error: result.error }, errors[result.error]);
      if (result?.error || (action === 'list' ? !Array.isArray(result?.content) : !UUID.test(result?.id || '') || !Number.isInteger(result.revision))) return reply({ error: 'temporarily_unavailable' }, 503);
      return reply(result, action === 'create' && !result.idempotent ? 201 : 200);
    } catch { return reply({ error: 'temporarily_unavailable' }, 503); }
  };
}

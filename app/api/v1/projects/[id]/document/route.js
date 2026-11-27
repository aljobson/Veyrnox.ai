import { editorFeatureEnabled } from '../../../../../../lib/editorRuntimeFlags.mjs';
import { tenantRequest } from '../../../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../../../packages/security/route.js';
import { ApiError } from '../../../../../../packages/security/errors.js';
import { exactKeys, idempotencyKey, readJson, uuid } from '../../../../../../packages/security/input.js';
import { emptyProjectDocument, validProjectDocument, withTimeline } from '../../../../../../lib/projectDocument.js';
import { validOddlingsProjectDocument } from '../../../../../../lib/projectOddlingsDocument.js';

export async function GET(request, { params }) {
  return protectedRoute(request, async context => {
    const id = uuid((await params).id).toLowerCase();
    const search = new URL(request.url).searchParams;
    const revision = search.get('revision');
    const manualStatus = search.get('manual_commit_status');
    if (revision !== null && (!/^[1-9]\d{0,8}$/.test(revision))) throw new ApiError(400, 'INVALID_REVISION', 'A positive revision is required.');
    if (manualStatus !== null && manualStatus !== '1') throw new ApiError(400, 'INVALID_REQUEST', 'The manual commit status request is invalid.');
    if (manualStatus !== null && revision !== null) throw new ApiError(400, 'INVALID_REQUEST', 'Choose a version or a manual commit status.');
    const projects = await tenantRequest(request, context, `projects?id=eq.${id}&select=id&limit=1`);
    if (!projects[0]) throw new ApiError(404, 'NOT_FOUND', 'The project was not found.');
    if (manualStatus !== null) {
      const status = await tenantRequest(request, context, 'rpc/manual_editor_commit_status', { method: 'POST', body: {
        p_project_id: id, p_idempotency_key: idempotencyKey(request),
      }, limitAware: true });
      return Response.json(status);
    }
    const rows = await tenantRequest(request, context, `project_document_versions?project_id=eq.${id}&select=revision,document,actor_id,created_at,restored_from&order=revision.desc&limit=1${revision ? `&revision=eq.${revision}` : ''}`);
    if (revision && !rows[0]) throw new ApiError(404, 'NOT_FOUND', 'The version was not found.');
    return Response.json(rows[0] || { revision: 0, document: emptyProjectDocument(id), actor_id: null, created_at: null, restored_from: null });
  });
}
export async function PUT(request, { params }) {
  return protectedRoute(request, async context => {
    const id = uuid((await params).id).toLowerCase();
    const body = await readJson(request, 65536);
    exactKeys(body, ['expected_revision', 'document', 'restore_revision', 'manual_commit']);
    if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0 || body.expected_revision >= 2147483647)
      throw new ApiError(400, 'INVALID_REVISION', 'A non-negative revision is required.');
    const restore = body.restore_revision !== undefined;
    const manual = body.manual_commit;
    if (manual !== undefined) {
      if (restore || !manual || typeof manual !== 'object' || Array.isArray(manual))
        throw new ApiError(400, 'INVALID_MANUAL_COMMIT', 'A manual editor commit must save a document.');
      exactKeys(manual, ['mode', 'expected_credits']);
      if (!['quote', 'commit'].includes(manual.mode)
        || (manual.mode === 'quote' && manual.expected_credits !== undefined)
        || (manual.mode === 'commit' && ![0, 5].includes(manual.expected_credits)))
        throw new ApiError(400, 'INVALID_MANUAL_COMMIT', 'The manual editor quote is invalid.');
    }
    const oddlings = !restore && body.document?.schema_version === 4;
    if (oddlings && !editorFeatureEnabled('PROJECT_ODDLINGS_ENABLED'))
      throw new ApiError(404, 'NOT_FOUND', 'Oddlings saving is not available here yet.');
    if (restore ? (body.document !== undefined || !Number.isSafeInteger(body.restore_revision) || body.restore_revision < 1 || body.restore_revision >= 2147483647)
      : !(oddlings ? validOddlingsProjectDocument(body.document, id) : validProjectDocument(body.document, id))) throw new ApiError(400, 'INVALID_DOCUMENT', 'The project document is invalid.');
    if (!restore && body.document?.schema_version === 3 && process.env.EDITOR_MULTITRACK_ENABLED !== 'true')
      throw new ApiError(404, 'NOT_FOUND', 'Multitrack saving is not available here yet.');
    if (!restore && (body.document?.timeline?.folders!==undefined || body.document?.timeline?.fonts!==undefined) && !editorFeatureEnabled('EDITOR_ORGANIZATION_ENABLED'))
      throw new ApiError(404, 'NOT_FOUND', 'Folder and custom font saving is not available here yet.');
    // Older and native clients do not have to calculate product metrics. The server derives the same
    // validated summary before persistence, while oddlings and restores retain their own contracts.
    const document = !restore && !oddlings && [2, 3].includes(body.document?.schema_version)
      ? withTimeline(body.document, body.document.timeline) : body.document;
    if (manual?.mode === 'quote') {
      const quote = await tenantRequest(request, context, 'rpc/quote_manual_editor_commit', { method: 'POST', body: {
        p_project_id: id, p_document: document,
      }, limitAware: true });
      return Response.json(quote);
    }
    const result = await tenantRequest(request, context, manual ? 'rpc/save_paid_project_document' : 'rpc/save_project_document', { method: 'POST', body: manual ? {
      p_project_id: id, p_expected_revision: body.expected_revision, p_document: document,
      p_idempotency_key: idempotencyKey(request), p_expected_credits: manual.expected_credits,
    } : {
      p_project_id: id, p_expected_revision: body.expected_revision, p_document: restore ? null : document,
      p_idempotency_key: idempotencyKey(request), p_restore_revision: restore ? body.restore_revision : null,
    }, limitAware: true });
    if (result?.ok === false) {
      const code = String(result.code || 'MANUAL_COMMIT_FAILED').toUpperCase();
      const status = code === 'INSUFFICIENT_BALANCE' || code === 'NO_BALANCE_ROW' ? 402
        : code === 'ACCOUNT_FROZEN' || code === 'ACCOUNT_ON_HOLD' ? 403
        : code === 'PRICE_CHANGED' || code === 'IDEMPOTENCY_CONFLICT' ? 409
        : code === 'RATE_LIMITED' ? 429 : code === 'INVALID_CREDITS' ? 400 : 503;
      throw new ApiError(status, code, code, result);
    }
    return Response.json(result);
  });
}

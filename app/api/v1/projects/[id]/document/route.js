import { tenantRequest } from '../../../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../../../packages/security/route.js';
import { ApiError } from '../../../../../../packages/security/errors.js';
import { exactKeys, idempotencyKey, readJson, uuid } from '../../../../../../packages/security/input.js';
import { emptyProjectDocument, validProjectDocument } from '../../../../../../lib/projectDocument.js';

export async function GET(request, { params }) {
  return protectedRoute(request, async context => {
    const id = uuid((await params).id).toLowerCase();
    const revision = new URL(request.url).searchParams.get('revision');
    if (revision !== null && (!/^[1-9]\d{0,8}$/.test(revision))) throw new ApiError(400, 'INVALID_REVISION', 'A positive revision is required.');
    const projects = await tenantRequest(request, context, `projects?id=eq.${id}&select=id&limit=1`);
    if (!projects[0]) throw new ApiError(404, 'NOT_FOUND', 'The project was not found.');
    const rows = await tenantRequest(request, context, `project_document_versions?project_id=eq.${id}&select=revision,document,created_at,restored_from&order=revision.desc&limit=1${revision ? `&revision=eq.${revision}` : ''}`);
    if (revision && !rows[0]) throw new ApiError(404, 'NOT_FOUND', 'The version was not found.');
    return Response.json(rows[0] || { revision: 0, document: emptyProjectDocument(id), created_at: null, restored_from: null });
  });
}
export async function PUT(request, { params }) {
  return protectedRoute(request, async context => {
    const id = uuid((await params).id).toLowerCase();
    const body = await readJson(request, 65536);
    exactKeys(body, ['expected_revision', 'document', 'restore_revision']);
    if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0 || body.expected_revision >= 2147483647)
      throw new ApiError(400, 'INVALID_REVISION', 'A non-negative revision is required.');
    const restore = body.restore_revision !== undefined;
    if (restore ? (body.document !== undefined || !Number.isSafeInteger(body.restore_revision) || body.restore_revision < 1 || body.restore_revision >= 2147483647)
      : !validProjectDocument(body.document, id)) throw new ApiError(400, 'INVALID_DOCUMENT', 'The project document is invalid.');
    const result = await tenantRequest(request, context, 'rpc/save_project_document', { method: 'POST', body: {
      p_project_id: id, p_expected_revision: body.expected_revision, p_document: restore ? null : body.document,
      p_idempotency_key: idempotencyKey(request), p_restore_revision: restore ? body.restore_revision : null,
    } });
    return Response.json(result);
  });
}

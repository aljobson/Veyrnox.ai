import { tenantRequest } from '../../../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../../../packages/security/route.js';
import { ApiError } from '../../../../../../packages/security/errors.js';
import { uuid } from '../../../../../../packages/security/input.js';
export async function GET(request, { params }) {
  return protectedRoute(request, async context => {
    const id = uuid((await params).id);
    const before = new URL(request.url).searchParams.get('before');
    if (before !== null && !/^[1-9]\d{0,8}$/.test(before)) throw new ApiError(400, 'INVALID_REVISION', 'A positive revision is required.');
    const projects = await tenantRequest(request, context, `projects?id=eq.${id}&select=id&limit=1`);
    if (!projects[0]) throw new ApiError(404, 'NOT_FOUND', 'The project was not found.');
    const versions = await tenantRequest(request, context, `project_document_versions?project_id=eq.${id}&select=revision,created_at,restored_from&order=revision.desc&limit=50${before ? `&revision=lt.${before}` : ''}`);
    return Response.json({ versions, next_before: versions.length === 50 ? versions.at(-1).revision : null });
  });
}

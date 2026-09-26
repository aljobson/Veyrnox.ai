import { tenantRequest } from '../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../packages/security/route.js';
import { exactKeys, idempotencyKey, projectName, readJson, uuid } from '../../../../packages/security/input.js';

export async function GET(request) {
    return protectedRoute(request, async context => {
        const workspaceId = uuid(new URL(request.url).searchParams.get('workspace_id'));
        const projects = await tenantRequest(request, context, `projects?workspace_id=eq.${workspaceId}&select=id,workspace_id,owner_id,name,version,created_at,updated_at&order=created_at.desc&limit=100`);
        return Response.json({ projects });
    });
}
export async function POST(request) {
    return protectedRoute(request, async context => {
        const body = await readJson(request);
        exactKeys(body, ['workspace_id', 'name']);
        const result = await tenantRequest(request, context, 'rpc/create_project', { method: 'POST', body: {
            p_workspace_id: uuid(body.workspace_id), p_name: projectName(body.name), p_idempotency_key: idempotencyKey(request),
        } });
        return Response.json(result, { status: result.idempotent ? 200 : 201 });
    });
}

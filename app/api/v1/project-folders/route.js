import { tenantRequest } from '../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../packages/security/route.js';
import { exactKeys, idempotencyKey, projectName, readJson, uuid } from '../../../../packages/security/input.js';

export async function GET(request) {
    return protectedRoute(request, async context => {
        const workspaceId = uuid(new URL(request.url).searchParams.get('workspace_id'));
        const folders = await tenantRequest(request, context,
            `project_folders?workspace_id=eq.${workspaceId}&select=id,workspace_id,parent_id,name,version,created_at,updated_at&order=name.asc,id.asc&limit=200`);
        return Response.json({ folders: Array.isArray(folders) ? folders : [] });
    });
}

export async function POST(request) {
    return protectedRoute(request, async context => {
        const body = await readJson(request);
        exactKeys(body, ['workspace_id', 'parent_id', 'name']);
        const result = await tenantRequest(request, context, 'rpc/create_project_folder', { method: 'POST', body: {
            p_workspace_id: uuid(body.workspace_id), p_parent_id: body.parent_id == null ? null : uuid(body.parent_id),
            p_name: projectName(body.name), p_idempotency_key: idempotencyKey(request),
        }, folderAware: true });
        return Response.json(result, { status: result.idempotent ? 200 : 201 });
    });
}

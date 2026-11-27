import { tenantRequest } from '../../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../../packages/security/route.js';
import { ApiError } from '../../../../../packages/security/errors.js';
import { exactKeys, projectName, readJson, uuid } from '../../../../../packages/security/input.js';

export async function GET(request, { params }) {
    return protectedRoute(request, async context => {
        const id = uuid((await params).id);
        let rows;
        try {
            rows = await tenantRequest(request, context, `projects?id=eq.${id}&select=id,workspace_id,owner_id,name,folder_id,version,created_at,updated_at&limit=1`);
        } catch (error) {
            if (error?.status !== 400 && error?.status !== 404) throw error;
            rows = await tenantRequest(request, context, `projects?id=eq.${id}&select=id,workspace_id,owner_id,name,version,created_at,updated_at&limit=1`);
        }
        if (!Array.isArray(rows) || !rows[0]) throw new ApiError(404, 'NOT_FOUND', 'The resource was not found.');
        return Response.json({ project: { folder_id: null, ...rows[0] } });
    });
}
async function mutate(request, params, remove) {
    return protectedRoute(request, async context => {
        const id = uuid((await params).id);
        const body = await readJson(request);
        const moving = !remove && Object.hasOwn(body, 'folder_id');
        exactKeys(body, remove ? ['version'] : moving ? ['folder_id', 'version'] : ['name', 'version']);
        if (!Number.isSafeInteger(body.version) || body.version < 1) throw new ApiError(400, 'INVALID_VERSION', 'A positive version is required.');
        const project = moving
            ? await tenantRequest(request, context, 'rpc/move_project_to_folder', { method: 'POST', body: {
                p_project_id: id, p_expected_version: body.version, p_folder_id: body.folder_id === null ? null : uuid(body.folder_id),
            }, folderAware: true })
            : await tenantRequest(request, context, 'rpc/mutate_project', { method: 'POST', body: {
                p_project_id: id, p_expected_version: body.version, p_name: remove ? null : projectName(body.name), p_remove: remove,
            } });
        return Response.json({ project });
    });
}
export async function PATCH(request, { params }) { return mutate(request, params, false); }
export async function DELETE(request, { params }) { return mutate(request, params, true); }

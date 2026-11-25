import { tenantRequest } from '../../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../../packages/security/route.js';
import { ApiError } from '../../../../../packages/security/errors.js';
import { exactKeys, projectName, readJson, uuid } from '../../../../../packages/security/input.js';

async function mutate(request, params, remove) {
    return protectedRoute(request, async context => {
        const id = uuid((await params).id), body = await readJson(request);
        exactKeys(body, remove ? ['version'] : ['name', 'version']);
        if (!Number.isSafeInteger(body.version) || body.version < 1) throw new ApiError(400, 'INVALID_VERSION', 'A positive version is required.');
        const folder = await tenantRequest(request, context, 'rpc/mutate_project_folder', { method: 'POST', body: {
            p_folder_id: id, p_expected_version: body.version, p_name: remove ? null : projectName(body.name), p_remove: remove,
        }, folderAware: true });
        return Response.json({ folder });
    });
}
export async function PATCH(request, { params }) { return mutate(request, params, false); }
export async function DELETE(request, { params }) { return mutate(request, params, true); }

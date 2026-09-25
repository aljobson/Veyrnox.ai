import { tenantRequest } from '../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../packages/security/route.js';
export async function GET(request) {
    return protectedRoute(request, async context => Response.json({ workspaces: await tenantRequest(request, context,
        'workspaces?select=id,organisation_id,name,is_default&order=created_at.asc&limit=100') }));
}

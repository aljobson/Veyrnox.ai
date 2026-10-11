import { protectedRoute } from '../../../../../../packages/security/route.js';
import { tenantRequest } from '../../../../../../packages/db/tenant-client.js';
import { uuid,readJson,exactKeys,idempotencyKey } from '../../../../../../packages/security/input.js';
import { ApiError } from '../../../../../../packages/security/errors.js';
import { requireEditorShared,expectedVersion } from '../../../../../../packages/security/editor-shared.js';
import { brandKitProblem } from '../../../../../../lib/editorShared.js';
export async function GET(request,{params}) {
    return protectedRoute(request,async context=>{requireEditorShared();const id=uuid((await params).id).toLowerCase();return Response.json(await tenantRequest(request,context,'rpc/read_editor_brand_kit',{method:'POST',body:{p_workspace_id:id}}));});
}
export async function PUT(request,{params}) {
    return protectedRoute(request,async context=>{requireEditorShared();const id=uuid((await params).id).toLowerCase(),body=await readJson(request,12288);exactKeys(body,['expected_version','kit']);const version=expectedVersion(body.expected_version),bad=brandKitProblem(body.kit);if(bad)throw new ApiError(400,'INVALID_BRAND_KIT',bad);
        return Response.json(await tenantRequest(request,context,'rpc/save_editor_brand_kit',{method:'POST',body:{p_workspace_id:id,p_expected_version:version,p_kit:body.kit,p_idempotency_key:idempotencyKey(request)}}));});
}

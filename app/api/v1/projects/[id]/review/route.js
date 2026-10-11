import { protectedRoute } from '../../../../../../packages/security/route.js';
import { tenantRequest } from '../../../../../../packages/db/tenant-client.js';
import { uuid,readJson,exactKeys,idempotencyKey } from '../../../../../../packages/security/input.js';
import { ApiError } from '../../../../../../packages/security/errors.js';
import { requireEditorShared,expectedVersion } from '../../../../../../packages/security/editor-shared.js';
import { reviewCommentProblem } from '../../../../../../lib/editorShared.js';
function savedRevision(value){if(!/^[1-9][0-9]*$/.test(value || ''))throw new ApiError(400,'INVALID_REVISION','Choose a saved revision.');return expectedVersion(Number(value));}
export async function GET(request,{params}) {
    return protectedRoute(request,async context=>{requireEditorShared();const id=uuid((await params).id).toLowerCase();return Response.json(await tenantRequest(request,context,'rpc/read_editor_review',{method:'POST',body:{p_project_id:id,p_revision:savedRevision(new URL(request.url).searchParams.get('revision')),p_before_id:new URL(request.url).searchParams.has('before')?uuid(new URL(request.url).searchParams.get('before')).toLowerCase():null}}));});
}
export async function POST(request,{params}) {
    return protectedRoute(request,async context=>{requireEditorShared();const id=uuid((await params).id).toLowerCase(),body=await readJson(request,12288),bad=reviewCommentProblem(body);if(bad)throw new ApiError(400,'INVALID_COMMENT',bad);
        const result=await tenantRequest(request,context,'rpc/add_editor_review_comment',{method:'POST',body:{p_project_id:id,p_revision:body.revision,p_frame:body.frame,p_body:body.body,p_idempotency_key:idempotencyKey(request)}});return Response.json(result,{status:result.idempotent?200:201});});
}
export async function PATCH(request,{params}) {
    return protectedRoute(request,async context=>{requireEditorShared();const id=uuid((await params).id).toLowerCase(),body=await readJson(request,4096);exactKeys(body,['comment_id','expected_version','resolved']);if(typeof body.resolved!=='boolean')throw new ApiError(400,'INVALID_COMMENT','A resolved state is required.');
        return Response.json(await tenantRequest(request,context,'rpc/resolve_editor_review_comment',{method:'POST',body:{p_project_id:id,p_comment_id:uuid(body.comment_id).toLowerCase(),p_expected_version:expectedVersion(body.expected_version),p_resolved:body.resolved,p_idempotency_key:idempotencyKey(request)}}));});
}

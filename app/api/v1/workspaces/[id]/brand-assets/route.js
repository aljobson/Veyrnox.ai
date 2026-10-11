import { protectedRoute } from '../../../../../../packages/security/route.js';
import { tenantRequest } from '../../../../../../packages/db/tenant-client.js';
import { uuid } from '../../../../../../packages/security/input.js';
import { requireEditorShared } from '../../../../../../packages/security/editor-shared.js';
export async function GET(request,{params}) {
    return protectedRoute(request,async context=>{requireEditorShared();const id=uuid((await params).id).toLowerCase();
        await tenantRequest(request,context,'rpc/read_editor_brand_kit',{method:'POST',body:{p_workspace_id:id}});
        const rows=await tenantRequest(request,context,`project_assets?select=id,project_id,sniffed_type,byte_size,duration_ms,width,height,projects!inner(workspace_id)&state=eq.inspected&projects.workspace_id=eq.${id}&order=created_at.desc&limit=101`);
        return Response.json({assets:rows.slice(0,100).map(({projects:_projects,...asset})=>asset),truncated:rows.length>100});});
}

import { tenantRequest } from '../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../packages/security/route.js';
import { exactKeys, idempotencyKey, projectName, readJson, uuid } from '../../../../packages/security/input.js';

export async function GET(request) {
    return protectedRoute(request, async context => {
        const workspaceId = uuid(new URL(request.url).searchParams.get('workspace_id'));
        // The project row's own version/updated_at only move on create and rename; saves land in project_document_versions.
        // The embedded read takes each project's newest saved revision (and when it was saved) under the same user JWT and RLS.
        // 200 is the live-project cap per workspace (migration 0254), so no project falls outside the list.
        const base = 'id,workspace_id,owner_id,name,version,created_at,updated_at';
        let rows;
        try {
            rows = await tenantRequest(request, context, `projects?workspace_id=eq.${workspaceId}&select=${base},project_document_versions(revision,created_at)&project_document_versions.order=revision.desc&project_document_versions.limit=1&order=created_at.desc&limit=200`);
        } catch (error) {
            // Only a rejected embed (400/404) falls back; auth, rate limit, redirect and outage errors are returned as they are.
            if (error?.status !== 400 && error?.status !== 404) throw error;
            // Never lose the list because the saved-revision read failed: serve the plain rows, with no latest save.
            console.error('[projects] latest save read failed', error?.status ?? error?.code ?? 'unknown');
            rows = await tenantRequest(request, context, `projects?workspace_id=eq.${workspaceId}&select=${base}&order=created_at.desc&limit=200`);
        }
        const projects = (Array.isArray(rows) ? rows : []).map(({ project_document_versions: saves, ...project }) => {
            const head = Array.isArray(saves) ? saves[0] : null;
            return { ...project, latest_revision: Number.isInteger(head?.revision) ? head.revision : null, saved_at: head?.created_at ?? null };
        });
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

import { tenantRequest } from '../../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../../packages/security/route.js';
import { ApiError } from '../../../../../packages/security/errors.js';
import { exactKeys, idempotencyKey, readJson, uuid } from '../../../../../packages/security/input.js';
import { emptyFilm } from '../../../../veyrnox/_lib/filmStudio.js';
import { parseFilm } from '../../../../veyrnox/_lib/filmStudioStorage.js';

export async function GET(request, { params }) {
  return protectedRoute(request, async context => {
    if (process.env.FILM_STUDIO_CLOUD_ENABLED !== 'true') throw new ApiError(404, 'NOT_FOUND', 'The resource was not found.');
    const id = uuid((await params).id);
    const rows = await tenantRequest(request, context,
      `film_studio_projects?select=id,name,shot_count,revision,created_at,updated_at,film_json&id=eq.${encodeURIComponent(id)}&limit=1`,
      { maxBytes: 2_200_000, limitAware: true });
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'The resource was not found.');
    const { film_json, ...project } = rows[0];
    return Response.json({ project, studio_json: film_json });
  });
}

async function mutate(request, params, remove) {
  return protectedRoute(request, async context => {
    if (process.env.FILM_STUDIO_CLOUD_ENABLED !== 'true') throw new ApiError(404, 'NOT_FOUND', 'The resource was not found.');
    const id = uuid((await params).id);
    const body = await readJson(request, remove ? undefined : 2_100_000);
    exactKeys(body, remove ? ['expected_revision'] : ['expected_revision', 'studio_json']);
    if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 1)
      throw new ApiError(400, 'INVALID_REVISION', 'A positive revision is required.');
    if (remove) {
      const result = await tenantRequest(request, context, 'rpc/remove_film_studio', {
        method: 'POST', limitAware: true, body: { p_id: id, p_expected_revision: body.expected_revision },
      });
      return Response.json(result);
    }
    let studio;
    try {
      studio = parseFilm(body.studio_json);
      if (Object.keys(studio).some(key => !Object.hasOwn(emptyFilm(), key))) throw new Error();
    } catch { throw new ApiError(400, 'INVALID_FILM', 'The Film Studio export is invalid.'); }
    const project = await tenantRequest(request, context, 'rpc/save_film_studio', {
      method: 'POST', limitAware: true, body: {
        p_id: id, p_expected_revision: body.expected_revision, p_film: body.studio_json,
        p_name: Array.from(studio.name.trim().replace(/\s+/g, ' ')).slice(0, 120).join('') || 'Untitled film',
        p_idempotency_key: idempotencyKey(request),
      },
    });
    return Response.json({ project });
  });
}
export async function PUT(request, { params }) { return mutate(request, params, false); }
export async function DELETE(request, { params }) { return mutate(request, params, true); }

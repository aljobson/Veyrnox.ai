import { tenantRequest } from '../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../packages/security/route.js';
import { ApiError } from '../../../../packages/security/errors.js';
import { exactKeys, idempotencyKey, readJson } from '../../../../packages/security/input.js';
import { emptyFilm } from '../../../veyrnox/_lib/filmStudio.js';
import { parseFilm } from '../../../veyrnox/_lib/filmStudioStorage.js';

export async function GET(request) {
  return protectedRoute(request, async context => {
    if (process.env.FILM_STUDIO_CLOUD_ENABLED !== 'true') throw new ApiError(404, 'NOT_FOUND', 'The resource was not found.');
    const projects = await tenantRequest(request, context,
      'film_studio_projects?select=id,name,shot_count,revision,created_at,updated_at&order=updated_at.desc&limit=20', { limitAware: true });
    return Response.json({ projects });
  });
}

export async function POST(request) {
  return protectedRoute(request, async context => {
    if (process.env.FILM_STUDIO_CLOUD_ENABLED !== 'true') throw new ApiError(404, 'NOT_FOUND', 'The resource was not found.');
    const body = await readJson(request, 2_100_000);
    exactKeys(body, ['studio_json']);
    let studio;
    try {
      studio = parseFilm(body.studio_json);
      if (Object.keys(studio).some(key => !Object.hasOwn(emptyFilm(), key))) throw new Error();
    } catch { throw new ApiError(400, 'INVALID_FILM', 'The Film Studio export is invalid.'); }
    const project = await tenantRequest(request, context, 'rpc/save_film_studio', {
      method: 'POST', limitAware: true, body: {
        p_id: null, p_expected_revision: 0, p_film: body.studio_json,
        p_name: Array.from(studio.name.trim().replace(/\s+/g, ' ')).slice(0, 120).join('') || 'Untitled film',
        p_idempotency_key: idempotencyKey(request),
      },
    });
    return Response.json({ project }, { status: project.idempotent ? 200 : 201 });
  });
}

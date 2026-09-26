/**
 * POST /api/v1/projects/:id/assets — reserve a project asset and mint the
 * presigned PUT that uploads it (0141, ADR-0056).
 *
 * The reservation runs with the caller's own bearer token, so RLS and the
 * project role decide whether it happens at all. The row is born
 * `quarantined`: nothing may use the bytes until an inspection settles it.
 *
 * The key is derived in the database from opaque org/project/asset UUIDs and
 * is not returned — the client needs the upload URL, not the layout.
 */

import { tenantRequest } from '../../../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../../../packages/security/route.js';
import { ApiError } from '../../../../../../packages/security/errors.js';
import { exactKeys, idempotencyKey, readJson, uuid } from '../../../../../../packages/security/input.js';
import { checkDeclared } from '../../../../../../lib/uploadSource.js';
import { ASSET_URL_TTL_SECONDS } from '../../../../../../lib/projectAssets.js';
import { presignPutUrl, isConfigured, envConfig } from '../../../../../../packages/adapters/r2.js';

export async function POST(request, { params }) {
  return protectedRoute(request, async context => {
    const id = uuid((await params).id).toLowerCase();
    const body = await readJson(request, 4096);
    exactKeys(body, ['media_type', 'size_bytes']);
    // Gate 1, shared with the Transform upload path: judge the claim before
    // anything is reserved or signed.
    const declared = checkDeclared(body.media_type, body.size_bytes);
    if (!declared.ok) throw new ApiError(400, 'INVALID_MEDIA', 'The media type or size is not accepted.');

    const r2 = envConfig();
    if (!isConfigured(r2)) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.');

    const reserved = await tenantRequest(request, context, 'rpc/reserve_project_asset', {
      method: 'POST',
      body: {
        p_project_id: id, p_media_type: declared.contentType,
        p_declared_bytes: body.size_bytes, p_idempotency_key: idempotencyKey(request),
      },
    });

    let signed;
    try {
      signed = await presignPutUrl(reserved.r2_key, declared.contentType, ASSET_URL_TTL_SECONDS, r2, body.size_bytes);
    } catch {
      throw new ApiError(502, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.');
    }

    // The body carries a presigned URL, which is a credential for anyone
    // holding it, so nothing may cache this response.
    return Response.json({
      asset_id: reserved.asset_id, state: reserved.state, idempotent: reserved.idempotent,
      upload_url: signed.url, content_type: signed.contentType,
      ...(signed.headers ? { headers: signed.headers } : {}),
      max_bytes: declared.maxBytes, expires_in: signed.expires,
    }, { headers: { 'Cache-Control': 'no-store' } });
  });
}

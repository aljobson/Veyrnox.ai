/**
 * GET /api/v1/projects/:id/assets/:assetId/download — a short-lived presigned
 * GET for an inspected project asset (0141, ADR-0056).
 *
 * There is no RPC here on purpose. Presigning needs server credentials, so the
 * route is server-side regardless, and authorization is a plain read through
 * the caller's own token: RLS plus `state = 'inspected'` already answers "may
 * this person have this object". A quarantined or rejected asset is simply not
 * found, which is also the honest answer — it is not theirs to fetch yet.
 */

import { tenantRequest } from '../../../../../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../../../../../packages/security/route.js';
import { ApiError } from '../../../../../../../../packages/security/errors.js';
import { uuid } from '../../../../../../../../packages/security/input.js';
import { ASSET_URL_TTL_SECONDS } from '../../../../../../../../lib/projectAssets.js';
import { presignGetUrl, isConfigured, envConfig } from '../../../../../../../../packages/adapters/r2.js';

export async function GET(request, { params }) {
  return protectedRoute(request, async context => {
    const p = await params;
    const projectId = uuid(p.id).toLowerCase();
    const assetId = uuid(p.assetId).toLowerCase();

    const rows = await tenantRequest(request, context,
      `project_assets?id=eq.${assetId}&project_id=eq.${projectId}&state=eq.inspected&select=id,r2_key,sniffed_type,byte_size,duration_ms,width,height&limit=1`);
    const asset = rows[0];
    if (!asset) throw new ApiError(404, 'NOT_FOUND', 'The asset was not found.');

    const r2 = envConfig();
    if (!isConfigured(r2)) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.');
    let signed;
    try { signed = await presignGetUrl(asset.r2_key, ASSET_URL_TTL_SECONDS, r2); }
    catch { throw new ApiError(502, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.'); }

    return Response.json({
      asset_id: asset.id, url: signed.url, expires_in: ASSET_URL_TTL_SECONDS,
      content_type: asset.sniffed_type, byte_size: asset.byte_size,
      duration_ms: asset.duration_ms, width: asset.width, height: asset.height,
    }, { headers: { 'Cache-Control': 'no-store' } });
  });
}

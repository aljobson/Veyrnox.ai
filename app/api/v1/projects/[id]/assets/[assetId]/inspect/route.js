/**
 * POST /api/v1/projects/:id/assets/:assetId/inspect — settle a quarantined
 * asset by reading its bytes (0141, ADR-0056).
 *
 * The caller may ask for an inspection; it cannot supply the answer. The
 * verdict comes from the stored bytes and is written through
 * `record_project_asset_inspection`, which is granted to service_role alone —
 * a verdict a client can assert is not a verdict.
 *
 * Authorization still runs on the caller's own token: the asset is read through
 * RLS first, so a stranger cannot even name someone else's asset. Only after
 * that does the Worker use its own credentials, and only to read the object and
 * record the outcome.
 *
 * Bytes do not pass through the Worker wholesale. The head is fetched with one
 * ranged read; an MP4 whose `moov` sits after the media data costs mp4Info one
 * more range, not a download.
 */

import { tenantRequest } from '../../../../../../../../packages/db/tenant-client.js';
import { protectedRoute } from '../../../../../../../../packages/security/route.js';
import { ApiError } from '../../../../../../../../packages/security/errors.js';
import { uuid } from '../../../../../../../../packages/security/input.js';
import { rpc, envConfig as dbEnvConfig } from '../../../../../../../../packages/db/supabase-client.js';
import { presignGetUrl, listObjects, isConfigured, envConfig } from '../../../../../../../../packages/adapters/r2.js';
import {
  inspectProjectAsset, inspectionRpcArgs, INSPECT_HEAD_BYTES, ASSET_URL_TTL_SECONDS,
} from '../../../../../../../../lib/projectAssets.js';

export async function POST(request, { params }) {
  return protectedRoute(request, async context => {
    const p = await params;
    const projectId = uuid(p.id).toLowerCase();
    const assetId = uuid(p.assetId).toLowerCase();

    const rows = await tenantRequest(request, context,
      `project_assets?id=eq.${assetId}&project_id=eq.${projectId}&select=id,r2_key,state,declared_type&limit=1`);
    const asset = rows[0];
    if (!asset) throw new ApiError(404, 'NOT_FOUND', 'The asset was not found.');
    // Already settled: report it rather than re-reading the object. The RPC
    // would treat a matching verdict as a no-op anyway, but there is no reason
    // to pay for the reads.
    if (asset.state !== 'quarantined') {
      return Response.json({ asset_id: asset.id, state: asset.state, idempotent: true },
        { headers: { 'Cache-Control': 'no-store' } });
    }

    const r2 = envConfig();
    const db = dbEnvConfig();
    if (!isConfigured(r2) || !db.supabaseUrl || !db.serviceRoleKey) {
      throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.');
    }

    // The object's real size, which is not necessarily the declared one.
    const listed = await listObjects(asset.r2_key, r2, { maxKeys: 1 });
    if (!listed.ok) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.');
    const object = listed.objects.find(o => o.key === asset.r2_key);
    if (!object) throw new ApiError(409, 'NOT_UPLOADED', 'The file has not been uploaded yet.');

    let signed;
    try { signed = await presignGetUrl(asset.r2_key, ASSET_URL_TTL_SECONDS, r2); }
    catch { throw new ApiError(502, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.'); }

    const readRange = async (start, end) => {
      const res = await fetch(signed.url, { headers: { Range: `bytes=${start}-${end}` } });
      if (!res.ok) throw new Error(`range ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    };

    let verdict;
    try {
      const head = await readRange(0, Math.min(INSPECT_HEAD_BYTES, object.size) - 1);
      verdict = await inspectProjectAsset({
        declaredType: asset.declared_type, byteSize: object.size, head, readRange,
      });
    } catch (err) {
      // An unreadable object is not a rejection: the file may be fine and the
      // read may be what failed. Leave it quarantined and let the caller retry.
      console.error('[project-assets] inspection read failed:', err?.message);
      throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.');
    }

    let settled;
    try { settled = await rpc('record_project_asset_inspection', inspectionRpcArgs(assetId, verdict), db); }
    catch (err) {
      console.error('[project-assets] verdict write failed:', err?.status);
      throw new ApiError(502, 'DATA_UNAVAILABLE', 'Data is temporarily unavailable.');
    }

    return Response.json({
      asset_id: settled.asset_id, state: settled.state, idempotent: settled.idempotent ?? false,
      ...(settled.sniffed_type ? { content_type: settled.sniffed_type } : {}),
      ...(settled.reject_reason ? { reject_reason: settled.reject_reason } : {}),
    }, { headers: { 'Cache-Control': 'no-store' } });
  });
}

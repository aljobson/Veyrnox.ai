import { editorFeatureEnabled } from './editorRuntimeFlags.mjs';
import { EDITOR_VISION_PATH, FACE_VISION_PATH, HAIR_VISION_PATH, editorVisionWorkerPolicy } from '../app/veyrnox/_lib/editorVisionRuntime.mjs';

export function visionAdmission(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/editor-vision/')) return null;
    const prefix = [EDITOR_VISION_PATH, FACE_VISION_PATH, HAIR_VISION_PATH].find(path => url.pathname.startsWith(`${path}/`));
    const name = prefix && url.pathname.slice(prefix.length + 1);
    const common = ['worker.mjs', 'vision_bundle.mjs', 'wasm/vision_wasm_module_internal.js', 'wasm/vision_wasm_module_internal.wasm', 'NOTICE.txt', 'Apache-2.0.txt', 'manifest.json'];
    const known = prefix && [...common, prefix === FACE_VISION_PATH ? 'face_landmarker.task' : 'selfie_multiclass_256x256.tflite'].includes(name);
    const enabled = known && editorFeatureEnabled('EDITOR_LOCAL_INFERENCE_ENABLED', env) &&
        (prefix === EDITOR_VISION_PATH || editorFeatureEnabled('PHOTO_STUDIO_ENABLED', env));
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" };
    if (!enabled) return { status: 404, headers };
    if (!['GET', 'HEAD'].includes(request.method)) return { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } };
    // no-cache, not no-store: a browser may keep the large model/WASM but must ask here before every use, so a later
    // flag-off decision applies to the next request while an unchanged file costs a 304, not a 28 MB download.
    return { status: 200, headers: { ...headers, 'Cache-Control': 'no-cache', 'Content-Security-Policy': editorVisionWorkerPolicy(url.origin, prefix) } };
}

// RFC 9110 weak comparison of If-None-Match against the asset's ETag.
function etagMatches(header, etag) {
    if (!header || !etag) return false;
    const bare = value => value.trim().replace(/^W\//, '');
    return header.trim() === '*' || header.split(',').some(candidate => bare(candidate) === bare(etag));
}

/** Assets-first would bypass both gates and the Worker document CSP. */
export async function serveEditorVision(request, env) {
    const admission = visionAdmission(request, env);
    if (!admission) return null;
    if (admission.status !== 200) return new Response(null, admission);
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    for (const [name, value] of Object.entries(admission.headers)) headers.set(name, value);
    // Only a delivered (200/206) or unchanged (304) asset may be stored; an upstream 404/5xx must never stick in a cache.
    if (!asset.ok && asset.status !== 304) headers.set('Cache-Control', 'no-store');
    // The Assets binding does not answer conditional requests made from inside the Worker (proved against the built
    // Worker), so a revalidation would re-send the whole model. Answer it here: same gate, same headers, no body.
    if (asset.status === 200 && request.method === 'GET' && etagMatches(request.headers.get('If-None-Match'), asset.headers.get('ETag'))) {
        await asset.body?.cancel();
        return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === 'HEAD' ? null : asset.body, { status: asset.status, statusText: asset.statusText, headers });
}

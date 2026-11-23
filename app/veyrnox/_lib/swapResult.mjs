// Signed links stay in the caller's memory, never in the attempt or history.
const readError = (code, cause) => Object.assign(new Error(code, { cause }), { code });
export async function readSwapResult(jobId, gateway, signal) {
  const path = `/jobs/${encodeURIComponent(jobId)}`;
  let state, asset;
  try { state = await gateway(path, { signal }); }
  catch (error) { throw readError('result_unconfirmed', error); }
  if (state?.state !== 'succeeded') throw readError('result_unconfirmed');
  try { asset = await gateway(`${path}/asset`, { signal }); }
  catch (error) { throw readError('asset_unavailable', error); }
  if (!asset?.url || !asset?.mime_type) throw readError('asset_unavailable');
  return { job_id: jobId, asset_url: asset.url, mime_type: asset.mime_type };
}
export function resultAspect(value) {
  const [w, h] = String(value || '').split(/[:/]/).map(Number);
  return w > 0 && h > 0 ? w / h : 9 / 16;
}

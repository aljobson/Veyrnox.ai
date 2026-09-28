// Live staging proved that Stream DELETE does not revoke an incomplete tus grant.
// Remove this hold only with a replacement design and live revocation evidence.
export const DIRECT_UPLOAD_SAFETY_HOLD = true;
export const MAX_UPLOAD_BYTES=2147483648;
export const UPLOAD_CHUNK_BYTES=5242880;
export function validUploadUrl(value) {
  try { const u=new URL(value); return typeof value==='string' && value.length<=2048 && u.protocol==='https:' && !u.username && !u.password && !u.port && !u.hash && ['upload.videodelivery.net','upload.cloudflarestream.com'].includes(u.hostname) && u.pathname.length>1; } catch { return false; }
}

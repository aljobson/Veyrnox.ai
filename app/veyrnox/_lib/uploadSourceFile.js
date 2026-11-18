import { gatewayFetch, GatewayError } from './gateway.js';

// The browser PUTs the file straight to R2 on a 15-minute URL the gateway signed (ADR-0028); the generation then names
// it by key, never by URL.
export async function uploadSourceFile(file, { signal } = {}) {
  const check = () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  check();
  let up;
  try { up = await gatewayFetch('/uploads', {
    ...(signal ? { signal } : {}),
    method: 'POST',
    body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
  }); } catch (error) { check(); throw error; }
  check();
  let put;
  try {
    put = await fetch(up.upload_url, { method: 'PUT', headers: up.headers || { 'Content-Type': up.content_type }, body: file, ...(signal ? { signal } : {}) });
  } catch {
    check();
    throw new GatewayError('upload_failed', { status: 0, code: 'upload_failed' });
  }
  check();
  if (!put.ok) throw new GatewayError('upload_failed', { status: put.status, code: 'upload_failed' });
  return up.key;
}

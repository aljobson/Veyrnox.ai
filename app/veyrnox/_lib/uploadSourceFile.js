import { gatewayFetch, GatewayError } from './gateway';

// The browser PUTs the file straight to R2 on a 15-minute URL the gateway signed (ADR-0028); the generation then names
// it by key, never by URL.
export async function uploadSourceFile(file) {
  const up = await gatewayFetch('/uploads', {
    method: 'POST',
    body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
  });
  let put;
  try {
    put = await fetch(up.upload_url, { method: 'PUT', headers: up.headers || { 'Content-Type': up.content_type }, body: file });
  } catch {
    throw new GatewayError('upload_failed', { status: 0, code: 'upload_failed' });
  }
  if (!put.ok) throw new GatewayError('upload_failed', { status: put.status, code: 'upload_failed' });
  return up.key;
}

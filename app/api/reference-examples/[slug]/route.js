import { creativeFeatureExample } from '../../../veyrnox/_lib/creativeFeatures.js';

const FORWARDED_HEADERS = ['accept-ranges', 'content-length', 'content-range', 'content-type'];

async function proxyExample(request, { params }, headOnly = false) {
  const { slug } = await params;
  const example = creativeFeatureExample(slug);
  if (!example) return Response.json({ error: 'not_found' }, { status: 404 });

  const range = request.headers.get('range');
  let upstream;
  try {
    upstream = await fetch(example.url, {
      method: headOnly ? 'HEAD' : 'GET',
      headers: range ? { Range: range } : undefined,
      redirect: 'error',
    });
  } catch {
    return Response.json({ error: 'reference_unavailable' }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return Response.json({ error: 'reference_unavailable' }, { status: 502 });
  }

  const headers = new Headers({
    'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    'X-Content-Type-Options': 'nosniff',
  });
  FORWARDED_HEADERS.forEach((name) => {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  });
  return new Response(headOnly ? null : upstream.body, { status: upstream.status, headers });
}

export async function GET(request, context) {
  return proxyExample(request, context);
}

export async function HEAD(request, context) {
  return proxyExample(request, context, true);
}

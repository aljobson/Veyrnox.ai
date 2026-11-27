import { NextResponse } from 'next/server';
import { readCrunTemplateCatalog, readCrunTemplateSummary } from '../../../lib/crunTemplateCatalog.js';

const CACHE = 'public, max-age=30, s-maxage=300, stale-while-revalidate=300';

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  if (params.get('summary') === '1') {
    const result = await readCrunTemplateSummary();
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, {
        status: result.status,
        headers: { 'Cache-Control': result.status === 503 ? 'no-store' : 'public, max-age=15, s-maxage=30' },
      });
    }
    return NextResponse.json(result.summary, { headers: { 'Cache-Control': CACHE } });
  }
  const provider = params.get('provider') || '';
  const page = Number(params.get('page') || 1);
  const pageSize = Number(params.get('page_size') || 50);
  const language = params.get('language') || 'en';
  const result = await readCrunTemplateCatalog({ provider, page, pageSize, language });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, {
      status: result.status,
      headers: { 'Cache-Control': result.status === 503 ? 'no-store' : 'public, max-age=15, s-maxage=30' },
    });
  }
  return NextResponse.json(result.catalog, { headers: { 'Cache-Control': CACHE } });
}

import { NextResponse } from 'next/server';
import { readyTemplateCatalog } from '../../../veyrnox/_lib/templateCatalogReady.js';

const CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';

// Home is a Client Component, so it reads the same server-owned catalogue
// seed as /app/templates through this public, identity-free endpoint.
export function GET() {
  return NextResponse.json(readyTemplateCatalog(), { headers: { 'Cache-Control': CACHE } });
}

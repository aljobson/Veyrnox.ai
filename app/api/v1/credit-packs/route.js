// Authenticated alias of the public, cached price catalog. No account data.
import { NextResponse } from 'next/server';
import { GET as publicCatalog } from '../../credit-packs/route.js';

export async function GET(req) {
    if (!req.headers.get('x-veyrnox-auth-id')) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }
    return publicCatalog();
}

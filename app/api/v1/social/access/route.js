import { NextResponse } from 'next/server';
import { publishAllowed } from '../../../../../lib/social/publishFeature.js';

export function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authId)) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    return NextResponse.json({ enabled: publishAllowed(authId) }, { headers: { 'Cache-Control': 'no-store' } });
}

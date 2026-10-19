/**
 * GET /api/status — is the database answering? Public, anonymous, read-only.
 *
 * Feeds the "something is happening" banner on the site and in the mobile app
 * (ADR-0160). Lives outside /api/v1 on purpose: the banner must still load
 * when sign-in cannot be verified. It reads no identity header and returns one
 * word, so there is nothing per-user to leak. Probes are shared and cached
 * (lib/upstreamStatus.js), never one per request.
 *
 * Response: { status: 'ok' | 'degraded' | 'unknown', checkedAt }
 */

import { NextResponse } from 'next/server';
import { envConfig } from '../../../packages/db/supabase-client.js';
import { currentStatus } from '../../../lib/upstreamStatus.js';

export async function GET() {
    const result = await currentStatus({ cfg: envConfig() });
    return NextResponse.json(
        { status: result.status, checkedAt: result.checkedAt },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}

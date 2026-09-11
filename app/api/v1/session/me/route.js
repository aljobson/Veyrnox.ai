/**
 * GET /api/v1/session/me — returns the verified auth identity.
 *
 * middleware.js at repo root gates every /api/v1/* on a valid Supabase
 * JWT and forwards the verified auth id via `x-veyrnox-auth-id`. This
 * route just reflects that header back — a smoke-test endpoint that
 * proves the gateway is receiving authenticated traffic before any
 * money-touching endpoint (ledger, jobs, etc.) exists.
 *
 * Never trust these headers on any route that isn't behind the middleware
 * — they can only be trusted because middleware.js overwrites them with
 * the verified value on every incoming request that reaches the /api/v1/*
 * matcher.
 */
import { NextResponse } from 'next/server';

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    const email = req.headers.get('x-veyrnox-auth-email');
    const role = req.headers.get('x-veyrnox-auth-role');
    if (!authId) {
        // Should be impossible — the middleware fail-closes before reaching
        // this handler. Guard anyway.
        return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
    }
    return NextResponse.json({ authId, email, role });
}

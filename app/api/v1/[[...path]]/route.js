import { NextResponse } from "next/server";

// Any /api/v1 path with no route of its own. The retired MuAPI passthrough
// that lived here was removed early by owner request (ADR-0007, 2026-09-24); an
// unknown path now gets a typed 404 rather than Next's HTML page.

function notFound() {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;

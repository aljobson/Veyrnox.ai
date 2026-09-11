import { NextResponse } from "next/server";

// Retired per ADR-0007. This route was a passthrough to api.muapi.ai from a
// previous product; the two brands are now separate. 410 Gone with a Sunset
// header signals the removal to any lingering client.

const HEADERS = {
    "Sunset": "Fri, 26 Sep 2026 00:00:00 GMT",
    "Deprecation": "true",
    "Link": "<https://veyrnox.ai/changelog>; rel=\"sunset\"",
};

function gone() {
    return NextResponse.json(
        { error: "endpoint_deprecated", detail: "This route is retired; see the Sunset header for the effective date." },
        { status: 410, headers: HEADERS }
    );
}

export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;


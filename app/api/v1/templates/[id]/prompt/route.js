/**
 * GET /api/v1/templates/:id/prompt: one video template in full, prompt included, for a signed-in person (ADR-0351 amendment 23).
 *
 * While the APP_RUNTIME_FLAGS key templatePromptsPrivate is on, the public template routes carry a placeholder in place of a video
 * template's text. Edit prompt on the web and in the app calls this to get the real thing. The answer is the same object
 * GET /api/templates/:id gave before the key existed. middleware.js gates every /api/v1 path on a verified token, so a signed-out
 * caller never reaches the handler; the handler still answers 401 without the identity header. Never cached by anyone but the caller.
 *
 * Only video templates: an image or audio template's prompt stays public, so those ids answer 404 like an unknown one.
 * Errors: 401 not_authenticated, 404 template_not_found.
 */
import { NextResponse } from 'next/server';
import { templateDetail } from '../../../../../../lib/clientTemplates.js';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(req, { params }) {
    if (!req.headers.get('x-veyrnox-auth-id')) return NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers: NO_STORE });
    const { id } = await params;
    const template = templateDetail(id);
    if (!template || template.kind === 'image' || template.kind === 'audio') return NextResponse.json({ error: 'template_not_found' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ template }, { headers: NO_STORE });
}

/**
 * GET /api/audio-templates: the audio template list (music, voice-over, sound effects) for the mobile app, which has no bundle of
 * them. Answers { templates: [{ id, name, category, kind, modelId, prompt, negativePrompt? }], categories: [...] }.
 *
 * Unauthenticated by design and the same for everyone: static template data with no price and nothing per-user (clients price from
 * the live catalog). Lives outside /api/v1 so the auth middleware does not gate it, like /api/templates, and reads no identity
 * header. It reads no database, so there is no outage shape.
 */
import { NextResponse } from 'next/server';
import { AUDIO_CATEGORIES, AUDIO_TEMPLATES } from '../../veyrnox/_lib/audioTemplates.js';

const CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';

export function GET() {
    return NextResponse.json({ templates: AUDIO_TEMPLATES, categories: AUDIO_CATEGORIES }, { headers: { 'Cache-Control': CACHE } });
}

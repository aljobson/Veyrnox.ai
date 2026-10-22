/**
 * The public template list for GET /api/presets: what the /presets gallery shows, as data the mobile app can render.
 *
 * Templates are static data (app/veyrnox/_lib/templates.js); nothing here is per-user. Every web template is listed. An active catalog
 * row supplies its price; without one, the template keeps the same fallback price the web card quotes and is marked unavailable.
 * Preview and poster addresses are absolute so a native client can load them.
 */
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { MODELS, modelIdForName, presetCredits, presetTitle } from '../app/veyrnox/_lib/tokens.js';

// Same address as SITE_URL in app/seo.js, which is JSX and cannot be loaded here.
const SITE_URL = 'https://veyrnox.ai';

const absolute = (path) => (typeof path === 'string' && path.startsWith('/') ? `${SITE_URL}${path}` : null);

export function toPublicPresets(catalog, presets = PRESETS) {
    const rows = Array.isArray(catalog) ? catalog : [];
    const out = [];
    for (const p of presets) {
        if (!p) continue;
        const modelId = modelIdForName(p.model);
        const row = modelId && rows.find((m) => m.id === modelId);
        const fallbackModel = modelId && MODELS.find((m) => m.id === modelId);
        const available = !!row && typeof row.credits === 'number';
        const clip = SHOWCASE_CLIPS[p.clipKey];
        out.push({
            id: p.id,
            title: presetTitle(p.name),
            category: p.category,
            modelId,
            modelName: p.model,
            modality: row?.modality ?? fallbackModel?.kind ?? '',
            prompt: p.prompt,
            needs: p.needs ?? null,
            durationSeconds: p.durationSeconds ?? 5,
            credits: presetCredits(p, rows),
            gated: !!row?.gated,
            available,
            isNew: !!p.isNew,
            previewUrl: absolute(clip?.video),
            posterUrl: absolute(clip?.poster),
            previewAspect: clip?.aspectRatio ?? p.previewAspect ?? null,
        });
    }
    return out;
}

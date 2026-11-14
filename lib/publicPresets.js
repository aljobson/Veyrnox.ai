import { templateRoute } from './templateRoute.js';
/**
 * The public template list for GET /api/presets: what the /presets gallery shows, as data the mobile app can render.
 *
 * Templates are static data (app/veyrnox/_lib/templates.js); nothing here is per-user. Only legacy video templates are listed; image templates never enter this contract. An active catalog
 * row supplies its price; without one, the template keeps the same fallback price the web card quotes and is marked unavailable.
 * Preview and poster addresses are absolute so a native client can load them.
 */
import { GALLERY_PRESETS } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { MODELS, templateModelId, presetCredits, presetTitle } from '../app/veyrnox/_lib/tokens.js';
import { effectThemeId } from '../app/veyrnox/_lib/effectThemes.js';
import { exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { sourcePromptAuditForModel } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { fallbackCapabilitiesFor } from './fallbackModelCapabilities.js';
import { templateSourceAspect } from './templateFraming.js';

// Same address as SITE_URL in app/seo.js, which is JSX and cannot be loaded here.
const SITE_URL = 'https://veyrnox.ai';

const absolute = (path) => (typeof path === 'string' && path.startsWith('/') ? `${SITE_URL}${path}` : null);

export function toPublicPresets(catalog, presets = GALLERY_PRESETS) {
    const rows = Array.isArray(catalog) ? catalog : [];
    const out = [];
    for (const p of presets) {
        if (!p || p.kind === 'image') continue;
        const modelId = templateModelId(p);
        const row = modelId && rows.find((m) => m.id === modelId);
        const fallbackModel = modelId && MODELS.find((m) => m.id === modelId);
        const available = !!row && typeof row.credits === 'number';
        const clip = SHOWCASE_CLIPS[p.clipKey];
        const source = exactSourcePromptRecord(p.id);
        const promptMax = fallbackCapabilitiesFor(modelId)?.inputs?.prompt?.max;
        const sourceAudit = sourcePromptAuditForModel(p.id, promptMax);
        const sourcePrompt = source?.prompt ?? null;
        out.push({
            id: p.id,
            title: presetTitle(p.name),
            category: p.category,
            theme: effectThemeId(p),
            modelId,
            modelName: row?.name || fallbackModel?.name || p.model,
            slotCount: templateRoute(p, modelId).slotCount,
            boundModelId: templateRoute(p, modelId).boundModelId,
            modality: row?.modality ?? fallbackModel?.kind ?? '',
            prompt: p.prompt,
            ...(p.negativePrompt ? { negativePrompt: p.negativePrompt } : {}),
            promptOrigin: p.promptOrigin ?? null,
            sourcePrompt,
            sourcePromptOrigin: sourcePrompt ? 'community-source-exact' : null,
            sourcePromptStatus: sourceAudit.status,
            sourcePromptRunnable: sourceAudit.runnable,
            sourcePromptIssues: [...sourceAudit.issues],
            sourcePromptModelPromptMax: sourceAudit.modelPromptMax ?? null,
            sourcePromptCharacterCount: sourceAudit.characterCount,
            sourcePromptReferenceImageCount: sourceAudit.referenceImageCount,
            sourcePromptReferenceVideoCount: sourceAudit.referenceVideoCount,
            sourcePromptDuplicateOf: sourceAudit.duplicateOf,
            needs: p.needs ?? null,
            sourceAspect: templateSourceAspect(p, clip?.aspectRatio ?? p.previewAspect),
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
    // Templates that need a source video we cannot supply go last, in the same order otherwise (templateSourceBlock.js).
    const blocked = (item) => item.sourcePromptOrigin === 'community-source-exact' && item.sourcePromptIssues.includes('reference-video-not-supported');
    return [...out.filter((item) => !blocked(item)), ...out.filter(blocked)];
}

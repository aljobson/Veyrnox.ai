/**
 * GET /api/templates?kind=image|audio: the runnable image and audio templates for the mobile app, one list per kind.
 *
 * Audio is the three licensed-track starts the web Create picker offers (app/veyrnox/_lib/createTemplates.js). Image is those
 * Create starts plus the published image gallery (behind IMAGE_TEMPLATES_ENABLED). Each entry carries the full prompt and the
 * catalog id the app opens Create on; nothing is priced here, the app prices from the live catalog. The audio entry keeps the
 * shape mobile builds before the image tab already parse ({ id, name, category, modelId, prompt }).
 */
import { createTemplatesFor } from '../app/veyrnox/_lib/createTemplates.js';
import { publishedImageTemplates } from '../app/veyrnox/_lib/imageTemplates.js';
import { templateModelId } from '../app/veyrnox/_lib/tokens.js';

export const TEMPLATE_KINDS = Object.freeze(['image', 'audio']);

function entry(template) {
    return {
        id: template.id,
        name: template.name,
        category: template.category,
        modelId: templateModelId(template),
        prompt: template.prompt,
        ...(template.previewImage ? { previewImage: template.previewImage } : {}),
        ...(template.previewAspect ? { previewAspect: template.previewAspect } : {}),
        ...(template.photo?.required ? { photoRequired: true } : {}),
        ...(template.previewAudio ? { previewAudio: template.previewAudio, previewAttribution: template.previewAttribution } : {}),
    };
}

/** The templates of one kind, with their categories in first-seen order; an unknown kind answers null. */
export function kindTemplates(kind) {
    if (!TEMPLATE_KINDS.includes(kind)) return null;
    const source = kind === 'image' ? [...createTemplatesFor('image'), ...publishedImageTemplates()] : createTemplatesFor('audio');
    const templates = source.map(entry).filter((t) => t.modelId && t.prompt);
    return { templates, categories: [...new Set(templates.map((t) => t.category))] };
}

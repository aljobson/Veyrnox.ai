import { templateContract } from './templateClientContract.js';
import { publicModelId } from './publicModelIds.js';
import { templateRoute } from './templateRoute.js';
/**
 * Template data for the browser, served by GET /api/templates and GET /api/templates/:id.
 *
 * The catalog (app/veyrnox/_lib/templates.js) carries about 2 MB of prompt and audit data. It stays on the server: importing it from a
 * client component puts all of it in the page bundle. The browser gets a slim card list for the gallery, one full template when it
 * opens one, and search answered here. Nothing is per-user and nothing is priced here; clients price from the live catalog.
 */
import { galleryVideoPresets, galleryCategories, templateById, searchTemplates, galleryTemplates } from '../app/veyrnox/_lib/templates.js';
import { createTemplateById, createTemplatesFor } from '../app/veyrnox/_lib/createTemplates.js';
import { publishedImageTemplates } from '../app/veyrnox/_lib/imageTemplates.js';
import { templateRecipe } from '../app/veyrnox/_lib/templateRecipe.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { sourcePromptAuditForModel } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { templateModelId } from '../app/veyrnox/_lib/tokens.js';
import { fallbackCapabilitiesFor } from './fallbackModelCapabilities.js';
import { templateSourceAspect } from './templateFraming.js';
import { GOAL_WORDS, LOOK_WORDS } from './creatorWords.js';
import { VIDEO_THEME_IDS, videoTemplateTheme } from '../app/veyrnox/_lib/videoTemplateThemes.js';
import { TESTED_SWAP_GALLERY_TEMPLATE_IDS } from '../app/veyrnox/_lib/videoTemplateGallery.js';

export const TEMPLATE_ID_RE = /^[a-z0-9-]{1,40}$/;
export const SEARCH_QUERY_MAX = 80;
const PROMPT_PREVIEW_CHARS = 140;
const SEARCH_RESULT_MAX = 400;

const TASTE_WORDS = [...new Set([...Object.values(GOAL_WORDS).flat(), ...Object.values(LOOK_WORDS).flat()])];

// The Vibe Check words found in `${name} ${category} ${prompt}`, joined so tasteScoreText gives the same score on this string as on
// the full text. A word that matched stays whole, so a word contained in a matched word is still found, and nothing else can match:
// every vocabulary word is plain text and the separator is not part of any of them.
function tasteText(template) {
    const text = ` ${template.name} ${template.category} ${template.prompt} `.toLowerCase();
    return TASTE_WORDS.filter((word) => text.includes(word)).join('|');
}

function card(template) {
    const taste = tasteText(template);
    return {
        id: template.id,
        name: template.name,
        // A listed video template is filed under its theme (videoTemplateThemes.js); images keep their own category.
        category: (template.kind !== 'image' && videoTemplateTheme(template.id)) || template.category,
        model: publicModelId(template.model),
        credits: template.credits,
        durationSeconds: template.kind === 'image' ? null : template.durationSeconds,
        ...(template.kind === 'image' ? { kind: 'image', previewImage: template.previewImage, ...(template.photo ? { photo: template.photo } : {}) } : {}),
        ...(template.isNew ? { isNew: true } : {}),
        bg: template.bg,
        previewAspect: template.previewAspect,
        ...(template.kind !== 'image' ? { clipKey: template.clipKey } : {}),
        promptPreview: String(template.prompt).slice(0, PROMPT_PREVIEW_CHARS),
        ...(taste ? { taste } : {}),
        clip: SHOWCASE_CLIPS[template.clipKey] ?? null,
    };
}

let cards = null;

// A template whose exact prompt needs a source video we cannot supply stays readable but cannot generate (templateSourceBlock.js).
// It goes after the ones that can, in the same order otherwise, so the gallery does not lead with dead ends.
const BLOCKING_ISSUES = ['reference-video-not-supported'];
function inspirationOnly(template) {
    // A tested swap template runs on the swap path, which supplies its source clip (ADR-0351 amendment 20).
    if (TESTED_SWAP_GALLERY_TEMPLATE_IDS.includes(template.id)) return false;
    if (!exactSourcePromptRecord(template.id)) return false;
    const promptMax = fallbackCapabilitiesFor(templateModelId(template))?.inputs?.prompt?.max;
    return sourcePromptAuditForModel(template.id, promptMax).issues.some((issue) => BLOCKING_ISSUES.includes(issue));
}

/** The gallery list: the capped video gallery (galleryVideoPresets) plus published images, slimmed to what a card shows. Built once per isolate. */
export function templateCards() {
    if (!cards) {
        // Video cards go in theme order (stable within a theme), so "All" reads as groups.
        const themeRank = (template) => {
            const rank = VIDEO_THEME_IDS.indexOf(videoTemplateTheme(template.id));
            return rank === -1 ? VIDEO_THEME_IDS.length : rank;
        };
        const themed = [...galleryVideoPresets()].sort((a, b) => themeRank(a) - themeRank(b));
        const flagged = themed.map((template) => ({ template, last: inspirationOnly(template) }));
        cards = {
            ready: flagged.filter((x) => !x.last).map((x) => card(x.template)),
            blocked: flagged.filter((x) => x.last).map((x) => card(x.template)),
        };
    }
    return [...cards.ready, ...publishedImageTemplates().map(card), ...cards.blocked];
}

/** ALL, NEW, then the video themes that have a card, then the other categories that still have a card, in catalog order. */
export function templateCategories() {
    const present = new Set(templateCards().map((card) => card.category));
    const rest = galleryCategories().slice(2).filter((category) => present.has(category) && !VIDEO_THEME_IDS.includes(category));
    return ['ALL', 'NEW', ...VIDEO_THEME_IDS.filter((theme) => present.has(theme)), ...rest];
}

// One prompt: the community one, whenever one is recorded. Create fills its box from this and the person edits it there, so it is
// carried even when it cannot run as written on the template's model (reference media, a long text); the box's own limits and the
// source slots then apply. Compatibility is informational; the prompt stays exact.
function communityPrompt(template) {
    return exactSourcePromptRecord(template.id)?.prompt || null;
}

/**
 * One template in full, by id, or null. Its `prompt` is the exact community prompt when one is recorded,
 * otherwise the independent catalog recipe. A template with incompatible source inputs comes back with
 * sourcePromptRunnable: false whichever way that is known, as informational metadata.
 */
// Model ids in a template answer are supplier-neutral (lib/publicModelIds.js); display names pass through unchanged.
const TEMPLATE_MODEL_KEYS = ['model', 'sourceModel', 'modelId', 'boundModelId'];
function withPublicTemplateModels(template) {
    const out = { ...template };
    for (const key of TEMPLATE_MODEL_KEYS) if (typeof out[key] === 'string') out[key] = publicModelId(out[key]);
    return out;
}

export function templateDetail(id) {
    if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) return null;
    const template = templateById(id) || createTemplateById(id);
    if (!template) return null;
    if (template.kind === 'image') return withPublicTemplateModels({ ...templateRecipe(template), modelId: templateModelId(template), clip: null });
    const exact = template.promptOrigin === 'community-source-exact' || template.sourcePromptOrigin === 'community-source-exact';
    const promptMax = fallbackCapabilitiesFor(templateModelId(template))?.inputs?.prompt?.max;
    const audit = exact ? sourcePromptAuditForModel(id, promptMax) : null;
    const runnable = !exact || (template.sourcePromptRunnable !== false && audit.runnable === true);
    const clip = SHOWCASE_CLIPS[template.clipKey] ?? null;
    const sourceAspect = templateSourceAspect(template, clip?.aspectRatio ?? template.previewAspect);
    return withPublicTemplateModels({
        ...template,
        ...templateRoute(template, templateModelId(template)),
        fidelity: templateContract(template),
        prompt: communityPrompt(template) ?? template.prompt,
        ...(exact ? { sourcePromptRunnable: runnable, sourcePromptIssues: [...audit.issues] } : {}),
        ...(sourceAspect ? { sourceAspect } : {}),
        clip,
    });
}

/** Ids of the gallery templates matching every word of `query`, across name, model, category, needs and the whole prompt. */
export function searchTemplateIds(query) {
    const q = typeof query === 'string' ? query.trim().slice(0, SEARCH_QUERY_MAX) : '';
    if (!q) return [];
    return searchTemplates(galleryTemplates(), q).slice(0, SEARCH_RESULT_MAX).map((template) => template.id);
}

/*
 * GET /api/templates?kind=image|audio: the runnable image and audio templates for the mobile app, one list per kind.
 *
 * Audio is the three licensed-track starts the web Create picker offers (app/veyrnox/_lib/createTemplates.js). Image is those
 * Create starts plus the published image gallery (behind IMAGE_TEMPLATES_ENABLED). Each entry carries the full prompt and the
 * catalog id the app opens Create on; nothing is priced here, the app prices from the live catalog. The audio entry keeps the
 * shape mobile builds before the image tab already parse ({ id, name, category, modelId, prompt }).
 */

export const TEMPLATE_KINDS = Object.freeze(['image', 'audio']);

function kindEntry(template) {
    return {
        id: template.id,
        name: template.name,
        category: template.category,
        modelId: publicModelId(templateModelId(template)),
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
    const templates = source.map(kindEntry).filter((t) => t.modelId && t.prompt);
    return { templates, categories: [...new Set(templates.map((t) => t.category))] };
}

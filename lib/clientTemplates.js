/**
 * Template data for the browser, served by GET /api/templates and GET /api/templates/:id.
 *
 * The catalog (app/veyrnox/_lib/templates.js) carries about 2 MB of prompt and audit data. It stays on the server: importing it from a
 * client component puts all of it in the page bundle. The browser gets a slim card list for the gallery, one full template when it
 * opens one, and search answered here. Nothing is per-user and nothing is priced here; clients price from the live catalog.
 */
import { PRESETS, PRESET_CATEGORIES, templateById, searchTemplates } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { sourcePromptAuditForModel } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { modelIdForName } from '../app/veyrnox/_lib/tokens.js';
import { fallbackCapabilitiesFor } from './fallbackModelCapabilities.js';
import { GOAL_WORDS, LOOK_WORDS } from './creatorWords.js';

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
        category: template.category,
        model: template.model,
        credits: template.credits,
        durationSeconds: template.durationSeconds,
        ...(template.isNew ? { isNew: true } : {}),
        bg: template.bg,
        previewAspect: template.previewAspect,
        clipKey: template.clipKey,
        promptPreview: String(template.prompt).slice(0, PROMPT_PREVIEW_CHARS),
        ...(taste ? { taste } : {}),
        clip: SHOWCASE_CLIPS[template.clipKey] ?? null,
    };
}

let cards = null;

/** The gallery list: every template that has a preview video, slimmed to what a card shows. Built once per isolate. */
export function templateCards() {
    cards ??= PRESETS.map(card);
    return cards;
}

export function templateCategories() {
    return PRESET_CATEGORIES;
}

// One prompt: the community one, whenever it can run on the template's model (the same rule the template page uses,
// app/veyrnox/presets/[id]/page.js). The audit and the source records stay here; the browser receives the decision.
function communityPrompt(template) {
    const exact = exactSourcePromptRecord(template.id)?.prompt;
    if (!exact) return null;
    const promptMax = fallbackCapabilitiesFor(modelIdForName(template.model))?.inputs?.prompt?.max;
    return sourcePromptAuditForModel(template.id, promptMax).runnable ? exact : null;
}

/**
 * One template in full, by id, or null. Its `prompt` is the exact community prompt when that runs on the template's model,
 * otherwise the Veyrnox adaptation. A template whose exact source prompt cannot run here comes back with
 * sourcePromptRunnable: false whichever way that is known, so the browser needs no audit data to refuse it.
 */
export function templateDetail(id) {
    if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) return null;
    const template = templateById(id);
    if (!template) return null;
    const exact = template.promptOrigin === 'community-source-exact' || template.sourcePromptOrigin === 'community-source-exact';
    const promptMax = fallbackCapabilitiesFor(modelIdForName(template.model))?.inputs?.prompt?.max;
    const runnable = !exact || (template.sourcePromptRunnable !== false && sourcePromptAuditForModel(id, promptMax).runnable === true);
    return {
        ...template,
        prompt: communityPrompt(template) ?? template.prompt,
        ...(exact ? { sourcePromptRunnable: runnable } : {}),
        clip: SHOWCASE_CLIPS[template.clipKey] ?? null,
    };
}

/** Ids of the gallery templates matching every word of `query`, across name, model, category, needs and the whole prompt. */
export function searchTemplateIds(query) {
    const q = typeof query === 'string' ? query.trim().slice(0, SEARCH_QUERY_MAX) : '';
    if (!q) return [];
    return searchTemplates(PRESETS, q).slice(0, SEARCH_RESULT_MAX).map((template) => template.id);
}

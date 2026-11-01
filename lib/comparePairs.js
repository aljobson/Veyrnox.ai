/**
 * Model comparison addresses: /compare/<a>-vs-<b>, ids in alphabetical order so
 * one pair has one address. Model ids are lowercase slugs that may contain
 * '-' and '.', so the separator is the first "-vs-".
 */
const SEPARATOR = '-vs-';
const ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** [a, b] from a slug, or null when it is not two distinct well-formed ids. */
export function parsePair(slug) {
    if (typeof slug !== 'string') return null;
    const at = slug.indexOf(SEPARATOR);
    if (at < 1) return null;
    const a = slug.slice(0, at);
    const b = slug.slice(at + SEPARATOR.length);
    if (!ID_RE.test(a) || !ID_RE.test(b) || a === b) return null;
    return [a, b];
}

/** The one slug for a pair, whichever order it is given in. */
export function pairSlug(a, b) {
    return [a, b].sort().join(SEPARATOR);
}

/** A text-prompt generator that needs no uploaded file: the only kind worth putting side by side. */
export function isPromptGenerator(model) {
    const caps = model?.capabilities || {};
    return Boolean(caps.inputs?.prompt) && !Object.values(caps.media || {}).some((slot) => slot?.required);
}

/**
 * Slugs worth listing: every pair among the first `perGroup` prompt-only
 * generators of each modality (text-to-image, text-to-video, ...), so a
 * crawler is never offered a background remover against a face filter, or a
 * video model against a speech model.
 */
export function comparisonSlugs(models, perGroup = 4) {
    const groups = new Map();
    for (const m of models.filter(isPromptGenerator)) {
        if (!groups.has(m.modality)) groups.set(m.modality, []);
        groups.get(m.modality).push(m.id);
    }
    const slugs = [];
    for (const all of groups.values()) {
        const ids = all.slice(0, perGroup);
        for (let i = 0; i < ids.length; i += 1) {
            for (let j = i + 1; j < ids.length; j += 1) slugs.push(pairSlug(ids[i], ids[j]));
        }
    }
    return slugs;
}

/**
 * Motion-transfer template cards (ADR-0269). Public data only: which
 * server-side driving clip a card uses, its mode and length, and our own
 * preview. Titles and blurbs live in the app catalogs under
 * `app.motion.template.<id>.title` / `.blurb`. The clip's R2 key, readiness
 * and orientation live in lib/motionClips.js. The server charges the catalog
 * row (`model`) per 5 seconds of the clip; nothing here is a price.
 */

const card = (id, seconds, model = 'motion-transfer') => Object.freeze({
    id,
    model,
    drivingClip: id,
    seconds,
    preview: { video: `/showcase/${id}.mp4`, poster: `/showcase/${id}.jpg` },
});

export const MOTION_TRANSFER_TEMPLATES = Object.freeze([
    card('motion-city-stride', 5),
    card('motion-runway-turn', 10),
    card('motion-slowmo-hair-walk', 5),
    card('motion-orbit-reveal', 5),
    card('motion-push-in-glance', 5),
    card('motion-two-step', 5),
    card('motion-shoulder-bounce', 5),
    card('motion-arm-wave-routine', 10),
    card('motion-spin-and-freeze', 5),
    card('motion-moonwalk-glide', 5),
    card('motion-parkour-vault', 5),
    card('motion-rooftop-jump', 5),
    card('motion-waiter-balance', 10),
    card('motion-skate-glide', 5),
    card('motion-boxing-combo', 5),
    card('motion-duo-dance', 10),
    card('motion-slow-dance', 10),
    card('motion-world-shift-walk', 10, 'motion-replace'),
    card('motion-hero-landing', 5),
    card('motion-stage-swap', 10, 'motion-replace'),
]);

/** Model id for a mode the server enables. */
export const MOTION_MODEL_FOR_MODE = Object.freeze({ move: 'motion-transfer', replace: 'motion-replace' });

/**
 * Cards a viewer may see: only modes whose flag is on. `ready` (ids whose
 * clip exists) comes from the server; a card that is not ready shows as
 * coming soon and cannot be started.
 * @param {{ move: boolean, replace: boolean }} modes
 * @param {readonly string[]} readyIds
 */
export function visibleMotionTemplates(modes, readyIds) {
    const models = new Set(Object.entries(MOTION_MODEL_FOR_MODE).filter(([mode]) => modes[mode]).map(([, model]) => model));
    const ready = new Set(readyIds);
    return MOTION_TRANSFER_TEMPLATES.filter(t => models.has(t.model)).map(t => ({ ...t, ready: ready.has(t.drivingClip) }));
}

/** Credits shown for a template: the catalog's per-5-second price times the clip's units. The server checks it (confirmed_credits). */
export function motionTemplateQuote(template, catalogCredits) {
    if (!Number.isInteger(catalogCredits) || catalogCredits <= 0) return null;
    return catalogCredits * Math.ceil(template.seconds / 5);
}

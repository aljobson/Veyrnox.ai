/**
 * Driving clips for motion-transfer templates (ADR-0269).
 *
 * Server-side only. A request names a clip by id; the server finds its private
 * R2 key, its exact length (which sets the price) and how the model should
 * follow it. The client never sends a clip URL or a length.
 *
 * Every clip is made by us (docs/templates/motion-transfer-clips.md). `ready`
 * stays false until the file is in R2 and its provenance is recorded here;
 * a clip that is not ready cannot be bought.
 *
 * Fields
 *   mode         'move' (motion transfer) | 'replace' (subject replacement)
 *   seconds      5 | 10, exactly the clip's length
 *   orientation  'image' (follows the clip's camera move, 10 s max) | 'video'
 *                (follows the performer's body); null for replace
 *   people       performers in the clip, so the photo needs as many
 *   provenance   'generated' | 'filmed', plus the prompt or release reference once made
 */

const CLIP_SECONDS = Object.freeze([5, 10]);

const clip = (id, mode, seconds, orientation, people = 1, provenance = 'generated') => Object.freeze({
    id, mode, seconds, orientation, people, provenance, ready: false, key: `motion/driving/${id}.mp4`,
});

export const MOTION_CLIPS = Object.freeze([
    clip('motion-city-stride', 'move', 5, 'image'),
    clip('motion-runway-turn', 'move', 10, 'video'),
    clip('motion-slowmo-hair-walk', 'move', 5, 'image'),
    clip('motion-orbit-reveal', 'move', 5, 'image'),
    clip('motion-push-in-glance', 'move', 5, 'image'),
    clip('motion-two-step', 'move', 5, 'video', 1, 'filmed'),
    clip('motion-shoulder-bounce', 'move', 5, 'video'),
    clip('motion-arm-wave-routine', 'move', 10, 'video', 1, 'filmed'),
    clip('motion-spin-and-freeze', 'move', 5, 'video', 1, 'filmed'),
    clip('motion-moonwalk-glide', 'move', 5, 'video', 1, 'filmed'),
    clip('motion-parkour-vault', 'move', 5, 'video'),
    clip('motion-rooftop-jump', 'move', 5, 'image'),
    clip('motion-waiter-balance', 'move', 10, 'video', 1, 'filmed'),
    clip('motion-skate-glide', 'move', 5, 'image'),
    clip('motion-boxing-combo', 'move', 5, 'video', 1, 'filmed'),
    clip('motion-duo-dance', 'move', 10, 'video', 2, 'filmed'),
    clip('motion-slow-dance', 'move', 10, 'video', 2, 'filmed'),
    clip('motion-world-shift-walk', 'replace', 10, null),
    clip('motion-hero-landing', 'move', 5, 'image'),
    clip('motion-stage-swap', 'replace', 10, null, 1, 'filmed'),
]);

/** Clip ids for one mode, in registry order. */
export function motionClipIds(mode) {
    return MOTION_CLIPS.filter(c => c.mode === mode).map(c => c.id);
}

/** The clip with this id, or null. Only exact registry ids match. */
export function motionClipFor(id, clips = MOTION_CLIPS) {
    if (typeof id !== 'string') return null;
    return clips.find(c => c.id === id) || null;
}

/** True when a clip's fields are internally consistent (used by tests and at load). */
export function validClip(c) {
    if (!c || !/^motion-[a-z0-9-]{3,48}$/.test(c.id)) return false;
    if (!['move', 'replace'].includes(c.mode) || !CLIP_SECONDS.includes(c.seconds)) return false;
    if (c.mode === 'move' && !['image', 'video'].includes(c.orientation)) return false;
    if (c.mode === 'replace' && c.orientation !== null) return false;
    // Kling follows a camera move ('image' orientation) only up to 10 s.
    if (c.orientation === 'image' && c.seconds > 10) return false;
    return c.key === `motion/driving/${c.id}.mp4` && Number.isInteger(c.people) && c.people >= 1 && c.people <= 2;
}

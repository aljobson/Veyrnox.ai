import { admissionAvailable, admissionRequired } from './uploadAdmission.js';

export const MUSIC_INSPIRATION_SOURCE_KINDS = Object.freeze(['audio', 'image', 'video_frames']);

const configured = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Source kinds the native iPhone may offer right now.
 *
 * The umbrella rollout flag is checked by the entitlement route. This second
 * gate reflects the contracts each picker needs, so the phone never uploads a
 * file merely to discover that its safety path is unavailable.
 */
export function musicInspirationSources(env = process.env) {
    if (env.MUSIC_INSPIRATION_ENABLED !== 'true'
        || !configured(env.MUSIC_INSPIRATION_MODEL)
        || !configured(env.MUSIC_INSPIRATION_API_KEY)) return [];

    const admission = admissionAvailable(env);
    // The generic upload route closes every public upload when admission is
    // required but unavailable, including audio. Do not advertise a picker
    // that cannot complete its first network step.
    if (admission.ok !== true) return [];
    const sources = ['audio'];
    const imageSafetyReady = admissionRequired(env)
        && admission.ok === true
        && typeof admission.provider === 'string'
        && env.CONTENT_SCAN_ENABLED === 'true'
        && configured(env.OPENAI_API_KEY);
    if (imageSafetyReady) sources.push('image', 'video_frames');
    return sources;
}

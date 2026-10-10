// Browser timeline editor, slice 3 (ADR-0080): a timeline saved inside a project document (v2, lib/projectDocument.js) and
// reopened later. Pure helpers, no network: the page does the fetching. A document never carries media bytes, so reopening means
// fetching every Library file again (its id names the generation) and asking for every local file again (never uploaded).
import { emptyTimeline, validateTimeline, FPS } from './editorTimeline.mjs';
import { withTimeline } from '../../../lib/projectDocument.js';

/** The timeline inside a project document, or an empty one. `problem` names why a stored timeline could not be used. */
export function timelineFromDocument(doc) {
    if (!doc || doc.schema_version !== 2 || doc.timeline === null || doc.timeline === undefined) return { timeline: emptyTimeline(), problem: null };
    const problem = validateTimeline(doc.timeline);
    return problem ? { timeline: emptyTimeline(), problem } : { timeline: doc.timeline, problem: null };
}

/** The project document to save for this timeline: the brief and canvas are kept, the timeline replaces whatever was there. */
export function documentForTimeline(doc, tl) {
    return withTimeline(doc, tl);
}

export const jobIdFromMediaId = id => (typeof id === 'string' && id.startsWith('j-') ? id.slice(2) : null);

/** What a reopened timeline needs before it can play: Library files to fetch again, local files to ask for again. */
export function mediaToRelink(tl, loaded = new Set()) {
    const library = [], local = [];
    for (const m of Object.values(tl.media)) {
        if (loaded.has(m.id)) continue;
        const jobId = jobIdFromMediaId(m.id);
        if (jobId) library.push({ id: m.id, jobId, name: m.name });
        else local.push({ id: m.id, name: m.name, frames: m.frames, kind: m.kind });
    }
    return { library, local };
}

/** The missing local media entry a chosen file stands in for: the same name and the same length to the frame, else null. */
export function matchLocalFile(tl, file, probe, loaded = new Set()) {
    if (!file || !probe || probe.error) return null;
    const frames = Math.max(1, Math.floor(probe.seconds * FPS));
    return Object.values(tl.media).find(m => !loaded.has(m.id) && !jobIdFromMediaId(m.id) && m.name === file.name && m.frames === frames && m.kind === probe.kind) || null;
}

/** Plain words for a save failure the page shows. */
export function saveProblem(error) {
    if (!error) return '';
    if (error.status === 409) return 'A newer version was saved elsewhere. Choose which to keep.';
    if (error.status === 404) return 'This project is no longer available.';
    if (error.status === 429) return 'Too many saves for now. Try again in a minute.';
    if (error.status === 400) return 'This timeline could not be saved. Remove the last change and try again.';
    return 'Could not save. Check your connection and try again.';
}

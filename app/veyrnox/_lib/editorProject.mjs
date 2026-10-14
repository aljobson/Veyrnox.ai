// Browser timeline editor, slice 3 (ADR-0080): a timeline saved inside a project document (v2, lib/projectDocument.js) and
// reopened later. Pure helpers, no network: the page does the fetching. A document never carries media bytes, so reopening means
// fetching every Library file again (its id names the generation) and asking for every local file again (never uploaded).
import { librarySourceFromId } from './editorLibraryCollection.mjs';
import { isAudioStem } from '../../../lib/audioStems.mjs';
import { emptyTimeline, validateTimeline, FPS } from './editorTimeline.mjs';
import { withTimeline } from '../../../lib/projectDocument.js';

/** The timeline inside a project document, or an empty one. `problem` names why a stored timeline could not be used. */
export function timelineFromDocument(doc) {
    if (!doc || ![2, 3].includes(doc.schema_version) || doc.timeline === null || doc.timeline === undefined) return { timeline: emptyTimeline(), problem: null };
    const problem = validateTimeline(doc.timeline);
    return problem ? { timeline: emptyTimeline(), problem } : { timeline: doc.timeline, problem: null };
}

/** The project document to save for this timeline: the brief and canvas are kept, the timeline replaces whatever was there. */
export function documentForTimeline(doc, tl) {
    return withTimeline(doc, tl);
}

export function jobIdFromMediaId(id) {
    if (typeof id !== 'string' || !id.startsWith('j-')) return null;
    const parts = id.slice(2).split('--');
    return parts[0] && (parts.length === 1 || (parts.length === 2 && isAudioStem(parts[1]))) ? parts[0] : null;
}

/** What a reopened timeline needs before it can play: Library files to fetch again, local files to ask for again. */
export function mediaToRelink(tl, loaded = new Set()) {
    const library = [], assets=[],local = [];
    for (const m of Object.values(tl.media)) {
        if (loaded.has(m.id) || m.kind === 'graphic' || m.originalAudio) continue;
        if(m.assetSource){assets.push({id:m.id,...m.assetSource,name:m.name});continue;}
        const saved=librarySourceFromId(m.id);if(saved){library.push({...saved,id:m.id,name:m.name});continue;}
        const jobId = jobIdFromMediaId(m.id);
        if (jobId) { const stem=m.id.split('--')[1]; library.push({ id: m.id, jobId, name: m.name, ...(isAudioStem(stem)?{stem}:{}) }); }
        else local.push({ id: m.id, name: m.name, frames: m.frames, kind: m.kind });
    }
    return { library, assets, local };
}

/** The missing local media entry a chosen file stands in for: the same name and the same length to the frame, else null. */
export function matchLocalFile(tl, file, probe, loaded = new Set()) {
    if (!file || !probe || probe.error) return null;
    const frames = Math.max(1, Math.floor(probe.seconds * FPS));
    return Object.values(tl.media).find(m => !loaded.has(m.id) && !jobIdFromMediaId(m.id) && (m.sourceName || m.name) === file.name && m.frames === frames && m.kind === probe.kind) || null;
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

const documentCounts = doc => {
    const timeline = doc?.timeline;
    return {
        video: Array.isArray(timeline?.video) ? timeline.video.length : 0,
        audio: Array.isArray(timeline?.audio) ? timeline.audio.length : 0,
        text: Array.isArray(timeline?.text) ? timeline.text.length : 0,
        markers: Array.isArray(timeline?.markers) ? timeline.markers.length : 0,
    };
};

/** A compact, non-destructive comparison for two valid saved editor documents. */
export function projectDocumentDifferences(local, saved) {
    const before = documentCounts(local), after = documentCounts(saved), labels = { video: 'Video clips', audio: 'Audio clips', text: 'Text layers', markers: 'Markers' };
    return Object.keys(labels).filter(key => before[key] !== after[key]).map(key => `${labels[key]}: ${before[key]} → ${after[key]}`);
}

/** Name a conflict copy without exceeding the project API's 120-character limit. */
export function conflictCopyName(name) {
    const base = typeof name === 'string' && name.trim() ? name.trim() : 'Project';
    const suffix = ' — edit copy';
    return `${base.slice(0, 120 - suffix.length).trimEnd()}${suffix}`;
}

export function remoteSaveLabel(actorId, currentActorId) {
    return actorId && actorId === currentActorId ? 'Another device' : 'A collaborator';
}

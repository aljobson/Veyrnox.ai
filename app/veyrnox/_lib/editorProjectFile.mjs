import { emptyProjectDocument, validProjectDocument } from '../../../lib/projectDocument.js';
import { documentForTimeline, timelineFromDocument, mediaToRelink } from './editorProject.mjs';
import { upgradeSequence } from './editorSequence.mjs';
import { validateSequence } from './editorSequenceValidation.mjs';

export const PROJECT_FILE_LIMIT = 32768;
const LOCAL_PROJECT_ID = '00000000-0000-4000-8000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const sizeProblem = 'This project file exceeds the 32 KiB document limit. Use fewer clips or caption lines, or shorten its brief.';
const fileProblem = 'Choose a Veyrnox project JSON file up to 32 KiB.';
const validDocument = value => {
    try { return UUID.test(value?.project_id) && validProjectDocument(value, value.project_id); }
    catch { return false; }
};
const timelineProblem = timeline => {
    try { return validateSequence(timeline); }
    catch { return 'Invalid multitrack document.'; }
};
export function projectFileName(name = 'veyrnox-studio-project') {
    const stem = typeof name === 'string' ? name.replace(/(?:\.veyrnox)?\.json$/i, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) : '';
    return `${stem || 'veyrnox-studio-project'}.veyrnox.json`;
}

/** Metadata and edits only. Browser blobs, loaded fonts, URLs and cloud state are never read or written. */
export function exportProjectFile(timeline, { projectDocument = null, name } = {}) {
    const problem = timelineProblem(timeline);
    if (problem) throw new Error(`This edit could not be downloaded: ${problem}`);
    if (projectDocument !== null && !validDocument(projectDocument)) throw new Error('The project metadata is invalid. Reopen its saved version before downloading it.');
    const base = projectDocument || { ...emptyProjectDocument(LOCAL_PROJECT_ID), canvas: { aspect_ratio: timeline.aspect === 'source' ? '16:9' : timeline.aspect, frame_rate: timeline.fps } };
    const document = documentForTimeline(base, timeline), json = JSON.stringify(document), bytes = encoder.encode(json).byteLength;
    if (bytes > PROJECT_FILE_LIMIT) throw new Error(sizeProblem);
    if (!validDocument(document)) throw new Error('This edit could not be downloaded as a valid project document.');
    return { document, json, bytes, name: projectFileName(name) };
}

/** Validate the whole file before upgrading; damaged documents are refused instead of repaired or loaded empty. */
export function parseProjectFile(text) {
    if (typeof text !== 'string' || !text.length) throw new Error(fileProblem);
    if (text.length > PROJECT_FILE_LIMIT || encoder.encode(text).byteLength > PROJECT_FILE_LIMIT) throw new Error(sizeProblem);
    let source;
    try { source = JSON.parse(text); }
    catch { throw new Error('This project file is not valid JSON. Choose the original downloaded project file.'); }
    if (!validDocument(source)) throw new Error('This project file has unsupported or invalid project data. Its contents were not loaded.');
    const { timeline: saved, problem } = timelineFromDocument(source);
    if (problem) throw new Error(`This project file could not be opened: ${problem}`);
    const timeline = upgradeSequence(saved), upgradedProblem = timelineProblem(timeline);
    if (upgradedProblem) throw new Error(`This project file could not be opened: ${upgradedProblem}`);
    const document = documentForTimeline(source, timeline);
    if (encoder.encode(JSON.stringify(document)).byteLength > PROJECT_FILE_LIMIT) throw new Error(sizeProblem);
    if (!validDocument(document)) throw new Error('This project file could not be upgraded to the current editor. Its contents were not loaded.');
    return { document, timeline, sourceVersion: source.schema_version, relink: mediaToRelink(timeline), fonts: timeline.fonts || [] };
}

/** Check the byte limit before reading a chosen file into memory. No MIME/extension claim substitutes for document validation. */
export async function readProjectFile(file) {
    if (!file || !Number.isInteger(file.size) || file.size < 1 || file.size > PROJECT_FILE_LIMIT || typeof file.text !== 'function') throw new Error(fileProblem);
    let text;
    try { text = await file.text(); }
    catch { throw new Error('The project file could not be read. Choose it again from this device.'); }
    return parseProjectFile(text);
}

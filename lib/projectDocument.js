import { validateTimeline } from '../app/veyrnox/_lib/editorTimeline.mjs';
import { validCanvasAspect } from '../app/veyrnox/_lib/editorCanvasFormat.mjs';

// Canonical v1 contains the brief and output canvas. v2 (ADR-0080, slice 3) adds `timeline`: the browser editor's timeline
// document, or null. A document never carries media bytes; the timeline names files by id and the editor fetches them again.
const V1_KEYS = ['schema_version', 'project_id', 'brief', 'canvas'];
const V2_KEYS = [...V1_KEYS, 'timeline'];
const EDITING_SUMMARY_KEYS = ['source_frames', 'edited_frames', 'fps'];
const COVER_KEYS = ['frame', 'text', 'text_color'];

/**
 * A small, reproducible account of footage removed from a saved edit. Source duration counts each
 * referenced video once, even when the edit uses several ranges from it. We deliberately return
 * nothing for incomplete media metadata or for an edit that is not shorter than its sources.
 */
export function editingSummaryForTimeline(timeline) {
  if (!object(timeline) || !Array.isArray(timeline.video) || !object(timeline.media)
    || !Number.isInteger(timeline.fps) || timeline.fps < 1 || timeline.video.length === 0) return null;
  const ids = new Set();
  let sourceFrames = 0;
  for (const clip of timeline.video) {
    if (!object(clip) || typeof clip.mediaId !== 'string' || ids.has(clip.mediaId)) continue;
    const media = timeline.media[clip.mediaId];
    if (!object(media) || media.kind !== 'video' || !Number.isInteger(media.frames) || media.frames < 1) return null;
    ids.add(clip.mediaId);
    sourceFrames += media.frames;
  }
  if (ids.size === 0 || !Number.isSafeInteger(sourceFrames)) return null;
  const editedFrames = timeline.schemaVersion === 3
    ? Math.max(0, ...timeline.video.map(clip => Number.isInteger(clip.start) && Number.isInteger(clip.len) ? clip.start + clip.len : 0))
    : timeline.video.reduce((sum, clip) => sum + (Number.isInteger(clip.len) ? clip.len : 0), 0);
  if (!Number.isSafeInteger(editedFrames) || editedFrames < 1 || sourceFrames <= editedFrames) return null;
  return { source_frames: sourceFrames, edited_frames: editedFrames, fps: timeline.fps };
}

export function editingTimeSavedSeconds(summary) {
  if (!object(summary) || !keys(summary, EDITING_SUMMARY_KEYS)
    || !Number.isSafeInteger(summary.source_frames) || !Number.isSafeInteger(summary.edited_frames)
    || !Number.isSafeInteger(summary.fps) || summary.fps < 1 || summary.edited_frames < 1
    || summary.source_frames <= summary.edited_frames) return null;
  return Math.max(1, Math.round((summary.source_frames - summary.edited_frames) / summary.fps));
}

export function emptyProjectDocument(projectId) {
  return { schema_version: 1, project_id: projectId, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 } };
}
/** A saved project cover points at a composition frame and may carry a short title. */
export function validProjectCover(value) {
  return object(value) && keys(value, COVER_KEYS)
    && Number.isSafeInteger(value.frame) && value.frame >= 0 && value.frame < 2147483647
    && typeof value.text === 'string' && value.text.length <= 120 && !value.text.includes('\u0000')
    && typeof value.text_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.text_color);
}
/** The same project document carrying `timeline` (a validated editor timeline, or null). */
export function withTimeline(doc, timeline) {
  const editingSummary = editingSummaryForTimeline(timeline);
  return { schema_version: timeline?.schemaVersion === 3 ? 3 : 2, project_id: doc.project_id, brief: doc.brief, canvas: doc.canvas, timeline: timeline ?? null,
    ...(doc.cover ? { cover: doc.cover } : {}),
    ...(editingSummary ? { editing_summary: editingSummary } : {}) };
}
// JSONB may reorder keys at any depth. Equality must not turn a successful save into another edit.
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
export function equalProjectDocuments(a, b) {
  return !!a && !!b && a.schema_version === b.schema_version && a.project_id === b.project_id
    && a.brief === b.brief && a.canvas?.aspect_ratio === b.canvas?.aspect_ratio
    && a.canvas?.frame_rate === b.canvas?.frame_rate
    && canonical(a.cover ?? null) === canonical(b.cover ?? null)
    && canonical(a.timeline ?? null) === canonical(b.timeline ?? null)
    && canonical(a.editing_summary ?? null) === canonical(b.editing_summary ?? null);
}
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => Object.keys(v).length === allowed.length && Object.keys(v).every(k => allowed.includes(k));
export function validProjectDocument(value, projectId) {
  if (!object(value)) return false;
  const v2 = value.schema_version === 2 || value.schema_version === 3;
  const allowedKeys = v2 ? [...V2_KEYS, 'editing_summary', 'cover'] : [...V1_KEYS, 'cover'];
  const hasRequiredKeys = (v2 ? V2_KEYS : V1_KEYS).every(key => Object.hasOwn(value, key));
  return hasRequiredKeys && Object.keys(value).every(key => allowedKeys.includes(key))
    && (value.schema_version === 1 || v2) && value.project_id === projectId
    && typeof value.brief === 'string' && value.brief.length <= 6000 && !value.brief.includes('\u0000')
    && object(value.canvas) && keys(value.canvas, ['aspect_ratio', 'frame_rate'])
    && validCanvasAspect(value.canvas.aspect_ratio)
    && [24, 25, 30, 60].includes(value.canvas.frame_rate)
    && (!Object.hasOwn(value, 'cover') || validProjectCover(value.cover))
    && (!v2 || (value.schema_version === 2 && value.timeline === null) || (value.timeline?.schemaVersion === value.schema_version && validateTimeline(value.timeline) === null))
    // This is server-owned derived data. Clients may carry the previous valid value while editing;
    // the save route always recomputes it from the submitted timeline before persistence.
    && (!Object.hasOwn(value, 'editing_summary') || editingTimeSavedSeconds(value.editing_summary) !== null)
    && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 32768;
}

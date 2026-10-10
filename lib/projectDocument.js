import { validateTimeline } from '../app/veyrnox/_lib/editorTimeline.mjs';

// Canonical v1 contains the brief and output canvas. v2 (ADR-0080, slice 3) adds `timeline`: the browser editor's timeline
// document, or null. A document never carries media bytes; the timeline names files by id and the editor fetches them again.
const V1_KEYS = ['schema_version', 'project_id', 'brief', 'canvas'];
const V2_KEYS = [...V1_KEYS, 'timeline'];

export function emptyProjectDocument(projectId) {
  return { schema_version: 1, project_id: projectId, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 } };
}
/** The same project document carrying `timeline` (a validated editor timeline, or null). */
export function withTimeline(doc, timeline) {
  return { schema_version: 2, project_id: doc.project_id, brief: doc.brief, canvas: doc.canvas, timeline: timeline ?? null };
}
// JSONB may reorder keys at any depth. Equality must not turn a successful save into another edit.
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
export function equalProjectDocuments(a, b) {
  return !!a && !!b && a.schema_version === b.schema_version && a.project_id === b.project_id
    && a.brief === b.brief && a.canvas?.aspect_ratio === b.canvas?.aspect_ratio
    && a.canvas?.frame_rate === b.canvas?.frame_rate
    && canonical(a.timeline ?? null) === canonical(b.timeline ?? null);
}
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => Object.keys(v).length === allowed.length && Object.keys(v).every(k => allowed.includes(k));
export function validProjectDocument(value, projectId) {
  if (!object(value)) return false;
  const v2 = value.schema_version === 2;
  return keys(value, v2 ? V2_KEYS : V1_KEYS)
    && (value.schema_version === 1 || v2) && value.project_id === projectId
    && typeof value.brief === 'string' && value.brief.length <= 6000 && !value.brief.includes('\u0000')
    && object(value.canvas) && keys(value.canvas, ['aspect_ratio', 'frame_rate'])
    && ['16:9', '9:16', '1:1'].includes(value.canvas.aspect_ratio)
    && [24, 25, 30, 60].includes(value.canvas.frame_rate)
    && (!v2 || value.timeline === null || validateTimeline(value.timeline) === null)
    && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 32768;
}

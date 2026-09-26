// Canonical v1 contains the brief and output canvas. Media/timeline need a later schema version.
export function emptyProjectDocument(projectId) {
  return { schema_version: 1, project_id: projectId, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 } };
}
// JSONB may reorder keys. Equality must not turn a successful save into another edit.
export function equalProjectDocuments(a, b) {
  return !!a && !!b && a.schema_version === b.schema_version && a.project_id === b.project_id
    && a.brief === b.brief && a.canvas?.aspect_ratio === b.canvas?.aspect_ratio
    && a.canvas?.frame_rate === b.canvas?.frame_rate;
}
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => Object.keys(v).length === allowed.length && Object.keys(v).every(k => allowed.includes(k));
export function validProjectDocument(value, projectId) {
  return object(value) && keys(value, ['schema_version', 'project_id', 'brief', 'canvas'])
    && value.schema_version === 1 && value.project_id === projectId
    && typeof value.brief === 'string' && value.brief.length <= 6000 && !value.brief.includes('\u0000')
    && object(value.canvas) && keys(value.canvas, ['aspect_ratio', 'frame_rate'])
    && ['16:9', '9:16', '1:1'].includes(value.canvas.aspect_ratio)
    && [24, 25, 30, 60].includes(value.canvas.frame_rate)
    && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 32768;
}

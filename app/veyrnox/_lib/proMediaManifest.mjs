import { refuse, loss, result } from './proInterchangeTime.mjs';
const idOK = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
export const safeText = (value, max, fallback = '', keepLines = false) => typeof value === 'string' ? value.replace(keepLines ? /[\u0000-\u0008\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, '').slice(0, max) || fallback : fallback;
export function safeSourceName(value) {
    const original = typeof value === 'string' ? value : '';
    const base = original.split(/[\\/]/).at(-1);
    const clean = safeText(base, 255, 'Untitled');
    const sourceName = ['.', '..'].includes(clean) ? 'Untitled' : clean;
    return { sourceName, name: sourceName.slice(0, 120), needsManualRelink: sourceName !== original || ['.', '..'].includes(sourceName) };
}
// This is an interchange namespace, NOT a host path. The host bridge currently registers
// names under /files/; callers must relink/rename explicitly (see the P3 evidence document).
export function virtualPath(mediaId, sourceName, kind) {
    if (!idOK(mediaId)) refuse('invalid_media_id');
    const ext = /\.([a-zA-Z0-9]{1,10})$/.exec(sourceName)?.[1]?.toLowerCase() || ({ audio: 'wav', image: 'png', video: 'mp4', graphic: 'png' }[kind]);
    return `/veyrnox/${mediaId}.${ext}`;
}
export function assertManifest(manifest) {
    if (!object(manifest) || manifest.version !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length > 40 || Object.keys(manifest).some(k => !['version', 'entries'].includes(k))) refuse('invalid_manifest');
    const ids = new Set(), paths = new Set();
    for (const e of manifest.entries) {
        if (!object(e) || Object.keys(e).some(k => !['mediaId','kind','frames','width','height','hasAudio','source','sourceRef','name','sourceName','virtualPath','needsManualRelink','offline'].includes(k)) || !idOK(e.mediaId) || ids.has(e.mediaId) || paths.has(e.virtualPath)) refuse('manifest_collision');
        if (!['video','audio','image','graphic'].includes(e.kind) || !Number.isInteger(e.frames) || e.frames < 1 || e.frames > 1e7 || ![e.width,e.height].every(n => Number.isInteger(n) && n >= 0 && n <= 16384) || typeof e.hasAudio !== 'boolean') refuse('invalid_manifest_media');
        if (typeof e.name !== 'string' || safeText(e.name,120) !== e.name || /[\\/]/.test(e.name) || typeof e.sourceName !== 'string' || safeSourceName(e.sourceName).needsManualRelink) refuse('invalid_manifest_name');
        if (e.virtualPath !== virtualPath(e.mediaId, e.sourceName, e.kind)) refuse('invalid_virtual_path');
        if (['needsManualRelink','offline'].some(k => e[k] !== undefined && typeof e[k] !== 'boolean')) refuse('invalid_manifest');
        if (!['library','asset','local'].includes(e.source)) refuse('invalid_manifest_source');
        if (e.source === 'library' && (e.sourceRef !== e.mediaId || !e.mediaId.startsWith('j-'))) refuse('invalid_manifest_source');
        if (e.source === 'local' && e.sourceRef !== null) refuse('invalid_manifest_source');
        if (e.source === 'asset' && (!object(e.sourceRef) || Object.keys(e.sourceRef).length !== 2 || !['projectId','assetId'].every(k => typeof e.sourceRef[k] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.sourceRef[k])))) refuse('invalid_manifest_source');
        ids.add(e.mediaId); paths.add(e.virtualPath);
    }
    return manifest;
}
export const validateMediaManifest = manifest => result(() => ({ manifest: assertManifest(manifest) }));
export function manifestEntry(media, report = [], path = `media.${media.id}`) {
    const names = safeSourceName(media.sourceName || media.name);
    if (names.needsManualRelink) loss(report, `${path}.sourceName`, 'needs_manual_relink', 'approximated', 'The original filename is unsafe; manual relinking is required.', { code: 'unsafe_source_name' });
    const display = safeSourceName(media.name).name;
    if(display!==media.name)loss(report,`${path}.name`,'sanitized','approximated','Display name reduced to a safe basename.');
    const source = media.assetSource ? 'asset' : media.id.startsWith('j-') ? 'library' : 'local';
    return { mediaId: media.id, kind: media.kind, frames: media.frames, width: media.width, height: media.height, hasAudio: media.hasAudio, source,
        sourceRef: source === 'asset' ? { projectId: media.assetSource.projectId, assetId: media.assetSource.assetId } : source === 'library' ? media.id : null,
        ...names, name:display, virtualPath: virtualPath(media.id, names.sourceName, media.kind), offline: true };
}
export function createMediaManifest(media, report = []) {
    return assertManifest({ version: 1, entries: Object.values(media).map(m => manifestEntry(m, report)) });
}
export function manifestMedia(entry) {
    return { id: entry.mediaId, kind: entry.kind, frames: entry.frames, width: entry.width, height: entry.height, hasAudio: entry.hasAudio,
        name: entry.name, sourceName: entry.sourceName, ...(entry.source === 'asset' ? { assetSource: { ...entry.sourceRef } } : {}) };
}

import { sourceFrame } from '../../../../app/veyrnox/_lib/editorSpeed.mjs';
import type { Clip } from './nativeEditorModel';

/** Compact identity for the source asset and complete output-frame -> source-frame mapping baked into a mask video. */
export function editorSemanticMaskIdentity(clip: Clip): string {
    let hash = 0x811c9dc5;
    const update = (value: string) => { for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0;
    } };
    update(`${clip.mediaId ?? ''}|${clip.len}|`);
    for (let offset = 0; offset < clip.len; offset += 1) update(`${sourceFrame(clip, offset).toFixed(6)}|`);
    return `sm2-${hash.toString(16).padStart(8, '0')}`;
}

export function editorStaticSemanticMaskMatches(clip: Clip): boolean {
    const mask = clip.semanticMask;
    return !!mask && !mask.dynamic && Math.abs(mask.sourceFrame - sourceFrame(clip, 0)) < 0.000001;
}

export function editorSemanticMaskMatches(clip: Clip): boolean {
    const dynamic = clip.semanticMask?.dynamic;
    return !!dynamic && dynamic.frames === clip.len && dynamic.identity === editorSemanticMaskIdentity(clip);
}

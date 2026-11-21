import { ORIGINAL_AUDIO as presets, originalAudioPreset as preset, originalAudioProblem as problem,
    synthesizeOriginalAudio } from '../../../../app/veyrnox/_lib/editorOriginalAudio.mjs';
import { ORIGINAL_CREDIT, ORIGINAL_USAGE, originalFolder } from '../../../../app/veyrnox/_lib/editorStoredLabels.mjs';
import type { Media } from './nativeEditorModel';
export type OriginalAudioPreset = { id: string; title: string; category: 'Music' | 'Sound effects'; seconds: number; bpm?: number; tags: string };
export const ORIGINAL_AUDIO = presets as readonly OriginalAudioPreset[];
export const originalAudioPreset = preset as (id: string) => OriginalAudioPreset | undefined;
export const originalAudioProblem = problem as (value: unknown) => string | null;
function requiredPreset(id: string): OriginalAudioPreset {
    const value = originalAudioPreset(id);
    if (!value) throw new Error('Unknown original sound');
    return value;
}
export const originalAudioFrames = (id: string): number => Math.floor(Math.round(requiredPreset(id).seconds * 48000) / 48000 * 30);
export function originalAudioWavBytes(id: string): Uint8Array {
    const samples = synthesizeOriginalAudio(id, 48000) as Float32Array;
    const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
    const ascii = (at: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 48000, true); view.setUint32(28, 96000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(samples[i] * 32767), true);
    return bytes;
}
export function originalAudioMedia(id: string, mediaId: string): Media {
    const p = requiredPreset(id);
    return { id: mediaId, kind: 'audio', frames: originalAudioFrames(id), name: p.title, hasAudio: true, width: 0, height: 0,
        sourceName: `${p.id}.wav`, folder: originalFolder(p.category), attribution: { credit: ORIGINAL_CREDIT, usage: ORIGINAL_USAGE, url: '' },
        originalAudio: { version: 1, presetId: id } };
}

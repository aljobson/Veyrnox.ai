import type { BeatAsset, BeatDoc, BeatSoundAsset } from './doc';
// Typed seams only: the web modules remain the source of truth.
// @ts-ignore shared JavaScript
import * as sounds from '../../../../../app/veyrnox/_lib/music/beat/beatSounds.mjs';
// @ts-ignore shared JavaScript
import * as templates from '../../../../../app/veyrnox/_lib/music/beat/beatTemplates.mjs';
// @ts-ignore shared JavaScript
import * as shortcuts from '../../../../../app/veyrnox/_lib/music/beat/beatShortcuts.mjs';
// @ts-ignore shared JavaScript
import * as tips from '../../../../../app/veyrnox/_lib/music/beat/beatCoachMarks.mjs';
// @ts-ignore shared JavaScript
import * as suggestions from '../../../../../app/veyrnox/_lib/music/beat/beatLibrarySuggestions.mjs';
// @ts-ignore shared JavaScript
import * as ops from '../../../../../app/veyrnox/_lib/music/beat/beatOps.mjs';
export type SoundCategory = 'Bass' | 'Keys' | 'Synth' | 'FX';
export type BeatSound = { id: string; name: string; category: SoundCategory; instrument: string; preset: string; bars: number; notes: [number, number, number, number][] };
export type TemplateId = 'hiphop' | 'lofi' | 'house' | 'blank';
export type TipId = 'grid' | 'library' | 'play' | 'arrangement' | 'export' | 'shortcuts';
export type ShortcutContext = 'global' | 'grid' | 'regions' | 'ruler' | 'piano' | 'automation' | 'takes' | 'typing';
export type AudioAsset = BeatAsset;
export const { BEAT_SOUNDS, soundById, soundDuration, soundTicks, validateSound } = sounds as unknown as {
    BEAT_SOUNDS: readonly BeatSound[]; soundById(id: string): BeatSound | undefined; soundDuration(id: string, bpm: number): number; soundTicks(id: string): number; validateSound(sound: unknown): boolean;
};
export const { BEAT_TEMPLATES, createBeatFromTemplate } = templates as unknown as {
    BEAT_TEMPLATES: readonly { id: TemplateId; nameKey: string; descriptionKey: string }[];
    createBeatFromTemplate(input: { template: TemplateId; id: string; title: string; now?: number }): BeatDoc;
};
export const { BEAT_SHORTCUTS } = shortcuts as unknown as { BEAT_SHORTCUTS: readonly { id: string; context: ShortcutContext; labelKey: string }[] };
export const { BEAT_TIP_STEPS, beatTipsSeenKey } = tips as unknown as { BEAT_TIP_STEPS: readonly { id: TipId }[]; beatTipsSeenKey(userId: string | null): string | null };
export const { suggestBeatCategories } = suggestions as unknown as { suggestBeatCategories(query: string, sounds: readonly BeatSound[]): SoundCategory[] };
export const { addAudioRegion } = ops as unknown as { addAudioRegion(doc: BeatDoc, asset: AudioAsset, track?: string, start?: number): BeatDoc };
export function soundAsset(sound: BeatSound, bpm: number): BeatSoundAsset {
    return { source: 'sound', ref: sound.id, name: sound.name, durationSec: soundDuration(sound.id, bpm), bpm: null, sourceChannels: 2, encodedBytes: 0 };
}
export function filterSounds(query: string, category: SoundCategory | 'All', name: (sound: BeatSound) => string) {
    const term = query.trim().toLocaleLowerCase();
    return BEAT_SOUNDS.filter(s => (category === 'All' || category === s.category)
        && (s.name.toLocaleLowerCase().includes(term) || name(s).toLocaleLowerCase().includes(term)));
}

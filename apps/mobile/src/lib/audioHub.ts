import { priceLines } from './catalogPages';
import { creativeFeature } from './creativeFeatures';
import type { MenuIcon } from './menuIcons';
import { audioFamily, starterModel } from './createOptions';
import { estimateCredits, kindOf, type CatalogModel } from './media';

export type AudioStudioId = 'yourMusic' | 'music' | 'speech' | 'dialogue' | 'dub' | 'lipSync' | 'dubbing' | 'talkingPhoto' | 'singingPhoto';
export type AudioHubId = Exclude<AudioStudioId, 'dub'>;
export const AUDIO_STUDIOS = ['music', 'speech', 'dialogue'] as const;
export const AUDIO_PERFORMANCES = ['lipSync', 'dubbing', 'talkingPhoto', 'singingPhoto'] as const;
export const AUDIO_ICONS = {
    yourMusic: 'vinylRecord', music: 'audio', speech: 'microphone', dialogue: 'chatsCircle',
    lipSync: 'waveform', dubbing: 'monitorPlay', talkingPhoto: 'userSound', singingPhoto: 'pianoKeys',
} as const satisfies Record<AudioHubId, MenuIcon>;

const FEATURE_SLUGS: Partial<Record<AudioStudioId, string>> = {
    dub: 'lip-sync', lipSync: 'lip-sync', dubbing: 'video-dubbing',
    talkingPhoto: 'ai-talking-photo-generator', singingPhoto: 'singing-photo',
};

export type AudioTarget = { pathname: '/music' | '/music/create' } | { pathname: '/create/[modelId]'; params: { modelId: string } } | { pathname: '/features/[slug]'; params: { slug: string } } | { pathname: '/create' };

// A catalog name like "ACE-Step (music/SFX)" trips the effects heuristic in audioFamily, so music is matched by name first.
const isMusic = (m: CatalogModel): boolean => {
    const text = `${m.id} ${m.name}`;
    const family = audioFamily(m);
    return family === 'music' || (/music|song|ace-?step/i.test(text) && family === 'effects');
};
const byFamily = (models: readonly CatalogModel[], family: 'music' | 'speech'): CatalogModel | null => {
    const audio = models.filter((m) => kindOf(m.modality) === 'audio' && (family === 'music' ? isMusic(m) : audioFamily(m) === 'speech'));
    return starterModel(audio, 'audio');
};
const dialogue = (models: readonly CatalogModel[]): CatalogModel | null =>
    starterModel(models.filter((m) => kindOf(m.modality) === 'audio' && /dialogue/i.test(`${m.id} ${m.name}`)), 'audio');

// Where a card goes. Before the catalog arrives (or when no open model fits) it falls back to Create, never a dead end.
export function audioTarget(id: AudioStudioId, models: readonly CatalogModel[] | null, musicAvailable = false): AudioTarget {
    if (id === 'music' && musicAvailable) return { pathname: '/music/create' };
    if (id === 'yourMusic') return { pathname: '/music' };
    const slug = FEATURE_SLUGS[id];
    if (slug) return { pathname: '/features/[slug]', params: { slug } };
    const model = !models ? null : id === 'music' ? byFamily(models, 'music') : id === 'speech' ? byFamily(models, 'speech') : dialogue(models);
    return model ? { pathname: '/create/[modelId]', params: { modelId: model.id } } : { pathname: '/create' };
}

// Price the actual catalog destination. Native music uses a separate two-candidate quote.
// Stale catalog entries remain useful for navigation, but cannot advertise a current price.
export function fromCredits(models: readonly CatalogModel[] | null, id: AudioStudioId, musicAvailable = false, fresh = false): number | null {
    if (!fresh || !models) return null;
    const target = audioTarget(id, models, musicAvailable);
    const modelId = target.pathname === '/create/[modelId]' ? target.params.modelId
        : target.pathname === '/features/[slug]' ? creativeFeature(target.params.slug)?.model : undefined;
    const model = models.find((item) => item.id === modelId);
    if (!model || !Number.isFinite(model.credits) || model.credits < 0) return null;
    const credits = target.pathname === '/features/[slug]'
        ? estimateCredits(model, model.durations?.includes(5) ? 5 : (model.durations?.[0] ?? null))
        : priceLines(model)[0].credits;
    return Number.isFinite(credits) && credits >= 0 ? credits : null;
}

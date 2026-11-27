import { speechModel } from './speech/model';
import { dialogueModel } from './speech/dialogue';
import { priceLines } from './catalogPages';
import { creativeFeature } from './creativeFeatures';
import type { MenuIcon } from './menuIcons';
import { audioFamily, starterModel } from './createOptions';
import { estimateCredits, kindOf, type CatalogModel } from './media';
import { audioFeatureIds } from './featureRegistry';
import { TOOL_TASKS } from './toolDirectory';

export type AudioStudioId = 'yourMusic' | 'music' | 'speech' | 'dialogue' | 'dub' | 'lipSync' | 'dubbing' | 'talkingPhoto' | 'singingPhoto';
export type AudioHubId = Exclude<AudioStudioId, 'dub'>;
export const AUDIO_STUDIOS = audioFeatureIds('studios') as readonly AudioHubId[];
export const AUDIO_ICONS = {
    yourMusic: 'vinylRecord', music: 'audio', speech: 'microphone', dialogue: 'chatsCircle',
    lipSync: 'waveform', dubbing: 'monitorPlay', talkingPhoto: 'userSound', singingPhoto: 'pianoKeys',
} as const satisfies Record<AudioHubId, MenuIcon>;

const FEATURE_SLUGS: Partial<Record<AudioStudioId, string>> = {
    dub: 'lip-sync', lipSync: 'lip-sync', dubbing: 'video-dubbing',
    talkingPhoto: 'ai-talking-photo-generator', singingPhoto: 'singing-photo',
};

export const AUDIO_PERFORMANCES = audioFeatureIds('performance') as readonly AudioHubId[];
const TOOL_MODEL_IDS = new Set(TOOL_TASKS.flatMap((task) => task.ids));

// Audio owns making and editing sound. A performance recipe that uses a model already listed in Tools belongs to
// Tools/Creative Tools instead of being repeated here under another label. Deriving this from the two catalogues keeps
// a newly registered performance from silently creating the same duplicate journey again.
export const AUDIO_HUB_PERFORMANCES = AUDIO_PERFORMANCES.filter((id) => {
    const slug = FEATURE_SLUGS[id];
    const modelId = slug ? creativeFeature(slug)?.model : null;
    return !modelId || !TOOL_MODEL_IDS.has(modelId);
});

export type AudioTarget = { pathname: '/music' | '/music/create' | '/speech' | '/dialogue' } | { pathname: '/create/[modelId]'; params: { modelId: string } } | { pathname: '/features/[slug]'; params: { slug: string } } | { pathname: '/create' };

const bySpeechFamily = (models: readonly CatalogModel[]): CatalogModel | null => {
    const audio = models.filter((m) => kindOf(m.modality) === 'audio' && audioFamily(m) === 'speech');
    return starterModel(audio, 'audio');
};
const dialogue = (models: readonly CatalogModel[]): CatalogModel | null =>
    starterModel(models.filter((m) => kindOf(m.modality) === 'audio' && /dialogue/i.test(`${m.id} ${m.name}`)), 'audio');

// Where a card goes. Music owns its availability/error state, so its destination
// must not change while the asynchronous Music probe and catalog are loading.
// Other catalog-backed cards still fall back to Create when no open model fits.
export function audioTarget(id: AudioStudioId, models: readonly CatalogModel[] | null, _musicAvailable = false): AudioTarget {
    if (id === 'music') return { pathname: '/music/create' };
    if (id === 'speech' && models && speechModel(models)) return { pathname: '/speech' };
    if (id === 'dialogue' && models && dialogueModel(models)) return { pathname: '/dialogue' };
    if (id === 'yourMusic') return { pathname: '/music' };
    const slug = FEATURE_SLUGS[id];
    if (slug) return { pathname: '/features/[slug]', params: { slug } };
    const model = !models ? null : id === 'speech' ? bySpeechFamily(models) : dialogue(models);
    return model ? { pathname: '/create/[modelId]', params: { modelId: model.id } } : { pathname: '/create' };
}

// Price the actual catalog destination. Native music uses a separate two-candidate quote.
// Stale catalog entries remain useful for navigation, but cannot advertise a current price.
export function fromCredits(models: readonly CatalogModel[] | null, id: AudioStudioId, musicAvailable = false, fresh = false): number | null {
    if (!fresh || !models) return null;
    const target = audioTarget(id, models, musicAvailable);
    const modelId = target.pathname === '/create/[modelId]' ? target.params.modelId
        : target.pathname === '/features/[slug]' ? creativeFeature(target.params.slug)?.model : undefined;
    const model = target.pathname === '/speech' ? speechModel(models) : target.pathname === '/dialogue' ? dialogueModel(models) : models.find((item) => item.id === modelId);
    if (!model || !Number.isFinite(model.credits) || model.credits < 0) return null;
    const credits = target.pathname === '/speech' || target.pathname === '/dialogue' ? estimateCredits(model, null) : target.pathname === '/features/[slug]'
        ? estimateCredits(model, model.durations?.includes(5) ? 5 : (model.durations?.[0] ?? null))
        : priceLines(model)[0].credits;
    return Number.isFinite(credits) && credits >= 0 ? credits : null;
}

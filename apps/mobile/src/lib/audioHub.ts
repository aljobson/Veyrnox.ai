// The Audio hub: the same four studios as the web hub (app/veyrnox/app/audio/page.js). The hub owns no generation
// logic; each card opens an existing screen, on the cheapest open model that fits the job where one is needed.
import { audioFamily, starterModel } from './createOptions';
import { kindOf, type CatalogModel } from './media';

export type AudioStudioId = 'music' | 'speech' | 'dialogue' | 'dub';
export const AUDIO_STUDIOS: readonly AudioStudioId[] = ['music', 'speech', 'dialogue', 'dub'];

export type AudioTarget = { pathname: '/create/[modelId]'; params: { modelId: string } } | { pathname: '/features/[slug]'; params: { slug: string } } | { pathname: '/create' };

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
export function audioTarget(id: AudioStudioId, models: readonly CatalogModel[] | null): AudioTarget {
    if (id === 'dub') return { pathname: '/features/[slug]', params: { slug: 'lip-sync' } };
    const model = !models ? null : id === 'music' ? byFamily(models, 'music') : id === 'speech' ? byFamily(models, 'speech') : dialogue(models);
    return model ? { pathname: '/create/[modelId]', params: { modelId: model.id } } : { pathname: '/create' };
}

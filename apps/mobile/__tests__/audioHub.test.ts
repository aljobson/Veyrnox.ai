import { audioTarget } from '../src/lib/audioHub';
import type { CatalogModel } from '../src/lib/media';

const model = (id: string, name: string, credits: number, modality = 'text-to-audio'): CatalogModel =>
    ({ id, name, modality, credits, gated: false, capabilities: { inputs: { prompt: {} } } }) as unknown as CatalogModel;

describe('audio hub targets', () => {
    test('falls back to Create before the catalog loads or when nothing fits', () => {
        expect(audioTarget('music', null)).toEqual({ pathname: '/create' });
        expect(audioTarget('speech', [])).toEqual({ pathname: '/create' });
        expect(audioTarget('dialogue', [model('x', 'Other', 1)])).toEqual({ pathname: '/create' });
    });
    test('lip sync always opens the lip-sync feature', () => {
        expect(audioTarget('dub', null)).toEqual({ pathname: '/features/[slug]', params: { slug: 'lip-sync' } });
    });
    test('music picks the cheapest music model, including one named music/SFX', () => {
        const models = [model('suno', 'Suno music', 9), model('ace-step', 'ACE-Step (music/SFX)', 2), model('tts', 'Text to speech voice', 1)];
        expect(audioTarget('music', models)).toEqual({ pathname: '/create/[modelId]', params: { modelId: 'ace-step' } });
        expect(audioTarget('speech', models)).toEqual({ pathname: '/create/[modelId]', params: { modelId: 'tts' } });
    });
    test('dialogue picks a dialogue model', () => {
        expect(audioTarget('dialogue', [model('market:elevenlabs/text-to-dialogue-v3', 'Dialogue v3', 4)])).toEqual({ pathname: '/create/[modelId]', params: { modelId: 'market:elevenlabs/text-to-dialogue-v3' } });
    });
});

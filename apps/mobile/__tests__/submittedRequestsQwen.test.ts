import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import { rememberSubmitted, submittedRequests, submittedHref } from '../src/lib/submittedRequests';
import { buildSpeechRequest } from '../src/lib/speech/studio';
import { defaultSpeechSettings } from '../src/lib/speech/shared';
import { restoreSpeech } from '../src/lib/speech/restore';
import { DEFAULT_CINEMA } from '../src/lib/cinemaCamera';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import type { ApiClient } from '../src/lib/api';
import type { FormSnapshot } from '../src/lib/createHandoff';

jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
const storage = createMemoryStorage(), cache = createCache(storage), docs = createMemoryStorage();
const qwen: CatalogModel = { id: 'qwen3-tts', name: 'Qwen3 TTS', modality: 'text-to-speech', credits: 2, gated: false,
    durations: [], capabilities: { inputs: { prompt: { max: 600 } } } };
const mini = { ...qwen, id: 'minimax-speech-2.6-hd', credits: 6 };
const settings: FormSnapshot = { opts: { aspect: null, count: 1, seed: '', negative: '', voice: '', audioSeconds: '' },
    cameraOn: false, cinema: DEFAULT_CINEMA, characterOn: false, character: {} };
const api = { request: jest.fn() } as unknown as ApiClient;
const request = buildSpeechRequest('Bonjour', { ...defaultSpeechSettings(qwen.id), voice: 'Serena', language: 'French' }, qwen);
beforeEach(async () => {
    resetCacheUser(); await cache.clear(); await bindCacheUser('qwen-owner', cache, storage, docs);
    jest.mocked(fetchCatalog).mockResolvedValue([mini, qwen]);
    await rememberSubmitted('qwen-job', request, { prompt: request.prompt! }, settings);
});
test('available saved Qwen reopens Speech and restores its model, script, voice and language together', async () => {
    // The saved model wins even if a caller supplies a stale MiniMax id.
    expect(await submittedHref(api, 'qwen-job', mini.id, () => true)).toEqual({ pathname: '/speech', params: { reopen: 'qwen-job' } });
    const saved = (await submittedRequests.list()).find(item => item.id === 'qwen-job')!;
    expect(saved.request.extraInputs).toEqual({ tts_voice: 'Serena', tts_language: 'French' });
    expect(restoreSpeech(saved.request)).toMatchObject({ modelId: qwen.id, script: 'Bonjour', settings: { voice: 'Serena', language: 'French' } });
});
test.each([{ catalog: [] }, { catalog: [mini] }, { catalog: [mini, { ...qwen, gated: true }] }])('unavailable Qwen never routes through an available MiniMax studio: %p', async ({ catalog }) => {
    jest.mocked(fetchCatalog).mockResolvedValue(catalog);
    expect(await submittedHref(api, 'qwen-job', qwen.id, () => true)).toEqual({ pathname: '/create/[modelId]',
        params: { modelId: qwen.id, prompt: '', kind: 'prompt-unavailable' } });
});
test('saved controls cannot be relabelled as the other speech model', () => {
    expect(restoreSpeech({ ...request, modelId: mini.id })).toBeNull();
    const miniRecipe = buildSpeechRequest('MiniMax', defaultSpeechSettings(mini.id), mini);
    expect(restoreSpeech({ ...miniRecipe, modelId: qwen.id })).toBeNull();
});

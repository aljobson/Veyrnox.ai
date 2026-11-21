import { bindCacheUser, getCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, createMemoryStorage, POLICIES, type Cache } from '../src/lib/cache';
import { loadDialogueCast, saveDialogueCast, forgetDialogueCastSpeakers } from '../src/lib/speech/dialogueCastStore';
import { rememberSubmitted, submittedRequests, submittedHref } from '../src/lib/submittedRequests';
import { buildDialogueRequest, restoreDialogue } from '../src/lib/speech/dialogue';
import { buildSpeechRequest } from '../src/lib/speech/studio';
import { DEFAULT_TTS_SETTINGS } from '../src/lib/speech/shared';
import { restoreSpeech } from '../src/lib/speech/restore';
import { DEFAULT_CINEMA } from '../src/lib/cinemaCamera';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { readCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
import type { ApiClient } from '../src/lib/api';
import type { FormSnapshot } from '../src/lib/createHandoff';
import type { SubmitRequest } from '../src/lib/generationSubmit';

jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => ['dialogue', 'handoff', Math.random()].join('-') }));
const storage = createMemoryStorage(), cache = createCache(storage), docs = createMemoryStorage();
const model: CatalogModel = { id: 'elevenlabs-dialogue', name: 'Dialogue', modality: 'text-to-audio', credits: 6, gated: false, durations: [], capabilities: { inputs: { prompt: {} } } };
const speech = { ...model, id: 'minimax-speech-2.6-hd' }, other = { ...model, id: 'other' };
const settings: FormSnapshot = { opts: { aspect: null, count: 1, seed: '', negative: '', voice: '', audioSeconds: '' }, cameraOn: false, cinema: DEFAULT_CINEMA, characterOn: false, character: {} };
const turns = [{ speaker: 'Ana', text: 'Hello' }, { speaker: 'Ben', text: 'Hi' }];
const cast = [{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Sarah' }];
const request = () => buildDialogueRequest(turns, cast, model);
const api = { request: jest.fn() } as unknown as ApiClient;
beforeEach(async () => {
    resetCacheUser(); await cache.clear(); await bindCacheUser('a', cache, storage, docs);
    jest.mocked(fetchCatalog).mockResolvedValue([model, speech, other]);
});
test('cast uses per-account cache and persists only normalized names and voices', async () => {
    await saveDialogueCast([{ ...cast[0], script: 'Never save', voice: 'George' }, cast[1], { speaker: 'ANA', voice: 'Roger' }], cache);
    expect((await cache.read(POLICIES.dialogueCast, 'a'))?.value).toEqual(cast);
    expect(await loadDialogueCast(cache)).toEqual(cast);
    await bindCacheUser('b', cache, storage, docs);
    expect(await loadDialogueCast(cache, 'a')).toEqual([]);
    expect(await loadDialogueCast(cache)).toEqual([]);
    expect(await cache.read(POLICIES.dialogueCast, 'a')).toBeNull();
    await saveDialogueCast(cast, cache); await wipeCache(cache, docs);
    expect(await cache.read(POLICIES.dialogueCast, 'b')).toBeNull();
});
test('failed cache reads and writes retain a usable default cast', async () => {
    const broken = { ...cache, read: jest.fn().mockRejectedValue(new Error('disk')), write: jest.fn().mockRejectedValue(new Error('disk')) } as Cache;
    expect(await loadDialogueCast(broken)).toEqual([]);
    await expect(saveDialogueCast(cast, broken)).resolves.toBeUndefined();
});
test('late cast read cannot return names after an account change, even a round trip', async () => {
    let release!: (value: unknown) => void;
    const slow = { ...cache, read: jest.fn().mockImplementation(() => new Promise<unknown>(resolve => { release = resolve; })) } as Cache;
    const read = loadDialogueCast(slow);
    await bindCacheUser('b', cache, storage, docs); await bindCacheUser('a', cache, storage, docs);
    release({ value: cast }); expect(await read).toEqual([]);
});
test('a cast write finishing after signout clears its payload', async () => {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const slow = { ...cache, write: jest.fn().mockImplementationOnce(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); }) } as Cache;
    const write = saveDialogueCast(cast, slow); await started; resetCacheUser(); release(); await write;
    expect(slow.write).toHaveBeenLastCalledWith(POLICIES.dialogueCast, null, 'a');
});
test('Make another routes only job ids into both studios and restores the saved request', async () => {
    const r = request(); await rememberSubmitted('dialogue-job', r, { prompt: r.prompt! }, settings);
    expect(await submittedHref(api, 'dialogue-job', model.id, () => true)).toEqual({ pathname: '/dialogue', params: { reopen: 'dialogue-job' } });
    expect(restoreDialogue((await submittedRequests.list()).find(item => item.id === 'dialogue-job')!.request)).toEqual({ turns, assignments: cast });
    const controls = { ...DEFAULT_TTS_SETTINGS, speed: 1.4, volume: 2, pitch: 4 };
    const voice = buildSpeechRequest('Speech script', controls, speech);
    await rememberSubmitted('speech-job', voice, { prompt: voice.prompt! }, settings);
    expect(await submittedHref(api, 'speech-job', speech.id, () => true)).toEqual({ pathname: '/speech', params: { reopen: 'speech-job' } });
    expect(restoreSpeech((await submittedRequests.list()).find(item => item.id === 'speech-job')!.request)).toEqual({ script: 'Speech script', settings: controls });
    expect(api.request).not.toHaveBeenCalled();
});
test('other accounts never read a remembered job; the empty studio receives only the unknown id', async () => {
    await rememberSubmitted('private-job', request(), {}, settings);
    await bindCacheUser('b', cache, storage, docs);
    expect(getCacheUser()).toBe('b');
    expect((await submittedRequests.list()).some(item => item.id === 'private-job')).toBe(false);
    expect(await submittedHref(api, 'private-job', model.id, () => true)).toEqual({ pathname: '/dialogue', params: { reopen: 'private-job' } });
});
test.each([model, speech])('model switching and unavailable $id use generic handoff with no hidden controls', async source => {
    const r = source.id === model.id ? request() : buildSpeechRequest('Speech', DEFAULT_TTS_SETTINGS, speech);
    await rememberSubmitted('switch-job', r, { prompt: r.prompt! }, settings);
    const href = await submittedHref(api, 'switch-job', source.id, () => true, other.id);
    expect(href?.pathname).toBe('/create/[modelId]');
    const params = href!.params as Record<string, string>;
    const handoff = readCreativeSourceHandoff(params.sourceHandoff, params.recipe, params.modelId);
    expect(JSON.stringify({ href, handoff })).not.toMatch(/dialogue_voice_|tts_/);
    jest.mocked(fetchCatalog).mockResolvedValue([{ ...source, gated: true }]);
    expect((await submittedHref(api, 'switch-job', source.id, () => true))?.pathname).toBe('/create/[modelId]');
});
test('Make another on other models stays generic', async () => {
    await rememberSubmitted('other-job', { ...request(), modelId: other.id, extraInputs: {} }, { prompt: 'Other' }, settings);
    expect((await submittedHref(api, 'other-job', other.id, () => true))?.pathname).toBe('/create/[modelId]');
});


test.each([model, speech])('R01: legacy $id jobs preserve their prompt through generic Create', async source => {
    const legacyInputs: SubmitRequest['extraInputs'][] = [undefined, {}, { seed: 12 }];
    for (const extraInputs of legacyInputs) {
        const r = { modelId: source.id, prompt: 'Legacy words', durationSeconds: null, confirmedCredits: 6, extraInputs };
        await rememberSubmitted('legacy-job', r, { prompt: r.prompt }, settings);
        const href = await submittedHref(api, 'legacy-job', source.id, () => true);
        expect(href?.pathname).toBe('/create/[modelId]');
        expect(href?.params).toMatchObject({ modelId: source.id, prompt: r.prompt });
    }
});
test.each([model, speech])('R01: corrupt studio controls on $id still reach the studio for its restore note', async source => {
    const extraInputs: NonNullable<SubmitRequest['extraInputs']> = source.id === model.id ? { dialogue_voice_1: 'invalid' } : { tts_voice: 'invalid' };
    await rememberSubmitted('corrupt-studio-job', { modelId: source.id, prompt: 'Broken', durationSeconds: null, extraInputs }, { prompt: 'Broken' }, settings);
    expect(await submittedHref(api, 'corrupt-studio-job', source.id, () => true)).toEqual({
        pathname: source.id === model.id ? '/dialogue' : '/speech', params: { reopen: 'corrupt-studio-job' },
    });
});
test.each([model, speech])('R05: no saved $id request and unavailable catalog keep the missing fallback', async source => {
    jest.mocked(fetchCatalog).mockRejectedValue(new Error('catalog offline'));
    expect(await submittedHref(api, 'unknown-catalog-job', source.id, () => true)).toEqual({
        pathname: '/create/[modelId]', params: { modelId: source.id, prompt: '', kind: 'prompt-unavailable' },
    });
});
test('R02: a reopened cast edit or unavailable restore cannot erase unrelated preferences', async () => {
    const unrelated = [{ speaker: 'Mia', voice: 'Sarah' }, { speaker: 'Tom', voice: 'George' }];
    await saveDialogueCast(unrelated, cache);
    const reopened = buildDialogueRequest([{ speaker: 'Zoe', text: 'One' }, { speaker: 'Max', text: 'Two' }],
        [{ speaker: 'Zoe', voice: 'George' }, { speaker: 'Max', voice: 'Sarah' }], model);
    expect(restoreDialogue(reopened)).not.toBeNull();
    expect(await loadDialogueCast(cache)).toEqual(unrelated);
    await saveDialogueCast([{ speaker: 'Zoe', voice: 'Roger' }], cache);
    expect(await loadDialogueCast(cache)).toEqual([{ speaker: 'Zoe', voice: 'Roger' }, ...unrelated]);
    expect(restoreDialogue({ ...reopened, prompt: 'Broken' })).toBeNull();
    await saveDialogueCast([{ speaker: 'Ana', voice: 'Sarah' }], cache);
    expect(await loadDialogueCast(cache)).toEqual(expect.arrayContaining(unrelated));
    expect((await loadDialogueCast(cache)).some(item => item.speaker === 'Max')).toBe(false);
});
test('R02/R03: queued upserts and case-insensitive forgets read the latest account map', async () => {
    const unrelated = [{ speaker: 'Mia', voice: 'Sarah' }, { speaker: 'Tom', voice: 'George' }];
    await saveDialogueCast(unrelated, cache);
    await Promise.all([
        saveDialogueCast([{ speaker: 'Ana', voice: 'Roger' }, { speaker: 'Ben', voice: 'Aria' }], cache),
        saveDialogueCast([{ speaker: 'Zoe', voice: 'George' }], cache),
        forgetDialogueCastSpeakers(['ANA', 'ben'], cache),
    ]);
    expect(await loadDialogueCast(cache)).toEqual([{ speaker: 'Zoe', voice: 'George' }, ...unrelated]);
});
test('R02: a failed checked read never overwrites the account map', async () => {
    const unreadable = { ...cache, readChecked: jest.fn().mockResolvedValue({ state: 'error' }), write: jest.fn() } as Cache;
    await saveDialogueCast(cast, unreadable);
    await forgetDialogueCastSpeakers(['Ana'], unreadable);
    expect(unreadable.write).not.toHaveBeenCalled();
});

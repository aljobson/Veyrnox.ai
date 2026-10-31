jest.mock('expo-crypto', () => ({ randomUUID: () => `film-${Math.random()}` }));
import { acceptedSettings, createHandoff, nearestDuration, type FormSnapshot } from '../src/lib/createHandoff';
import { readCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
import { DEFAULT_CINEMA } from '../src/lib/cinemaCamera';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createMemoryStorage, createCache } from '../src/lib/cache';
import { rememberSubmitted, submittedHref } from '../src/lib/submittedRequests';
import { accountHandoffStore } from '../src/lib/accountHandoffStore';
import { filmReturnParams, rememberFilmJob, settleFilmJob, returnMatches, filmReturns, markFilmSwitch } from '../src/lib/filmGenerationReturns';
import { localFilmId, inheritFilmIdentity } from '../src/lib/filmHandoffIdentity';
import { emptyFilm, promptContext, type Film, type Shot } from '../src/lib/filmStudio';

jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
const model: CatalogModel = { id: 'video', name: 'Video', modality: 'text-to-video', durations: [5, 10], credits: 3, gated: false,
    capabilities: { inputs: { prompt: { max: 2000 }, seed: {}, negative_prompt: { max: 100 }, aspect_ratio: { values: ['9:16', '16:9'] } }, media: { image: { maxFiles: 2 } } } };
const snapshot: FormSnapshot = { opts: { aspect: '9:16', count: 4, seed: '42', negative: 'rain', voice: 'soft', audioSeconds: '', resolution: undefined, audio: undefined },
    cameraOn: true, cinema: DEFAULT_CINEMA, characterOn: true, character: { character_type: 'Human' } };
const carry = { prompt: 'A bird', duration: '8', aspect: '9:16', tpl: 'Paper', tid: 'paper', tneeds: 'picture', tsource: '9:16', tratio: '9/16', tposter: 'https://veyrnox.ai/p.jpg', recipe: 'faceless-reel', followup: 'generated-sound', startOddling: 'fox', kind: 'video', sourceJob: 'original' };
const refs = [{ slot: 'image', origin: 'asset', asset_id: 'asset-1' }, { slot: 'endImage', origin: 'upload', key: 'upload-1' }, { slot: 'audio', origin: 'upload', key: 'sound' }] as const;
const storage = createMemoryStorage(), cache = createCache(storage);
beforeEach(async () => { resetCacheUser(); await bindCacheUser('person', cache, storage, createMemoryStorage()); jest.mocked(fetchCatalog).mockResolvedValue([model]); });
const read = (href: ReturnType<typeof createHandoff>) => readCreativeSourceHandoff(href.params.sourceHandoff, href.params.recipe, href.params.modelId)!;

test('P1: changing models carries template, workflow metadata, closest settings and compatible re-staged references', () => {
    const href = createHandoff(model, carry, snapshot, refs);
    expect(href.params).toMatchObject({ ...carry, modelId: 'video' });
    const target = read(href);
    expect(target.references).toEqual([{ ...refs[0] }, { ...refs[1], slot: 'image' }]);
    expect(target.adjusted).toBe(2);
    expect(target.settings).toMatchObject({ cameraOn: true, characterOn: false, opts: { aspect: '9:16', seed: '42', count: 1, voice: '' } });
    expect(nearestDuration(model, 8)).toBe(10);
    expect(acceptedSettings({ ...model, capabilities: { inputs: { aspect_ratio: { values: ['1:1', '16:9'] } } } }, snapshot).opts.aspect).toBe('1:1');
});
test.each([false, true])('P2: attaching with model change=%s preserves a settings snapshot and Faceless sound continuation', changed => {
    const target = changed ? { ...model, id: 'different', modality: 'text-to-image' } : model;
    const href = createHandoff(target, carry, snapshot, [...refs, refs[0], { slot: 'image', origin: 'upload', key: 'new-file' }], { followup: 'generated-sound' });
    expect(href.params).toMatchObject({ recipe: 'faceless-reel', followup: 'generated-sound', startOddling: 'fox', tid: 'paper' });
    expect(read(href)).toMatchObject({ recipe: 'faceless-reel', followup: 'generated-sound', settings: { cameraOn: true, characterOn: changed, opts: { seed: '42', negative: 'rain', count: changed ? 4 : 1 } } });
    expect(read(href).references?.filter(r => r.origin === 'asset')).toEqual([refs[0]]);
});
const api = { request: jest.fn().mockResolvedValue({ mime_type: 'image/png' }) } as any;
async function submit() {
    await rememberSubmitted('job-1', { modelId: 'video', prompt: 'A bird', durationSeconds: 8, confirmedCredits: 3, references: refs, sourceRights: true }, carry, snapshot);
}
test('P3: Retry uses the request saved for that job, with available references by asset id', async () => {
    await submit();
    const href = await submittedHref(api, 'job-1', model.id, () => true);
    expect(href?.params).toMatchObject({ prompt: 'A bird', duration: '8', aspect: '9:16', tid: 'paper' });
    expect(read(href as ReturnType<typeof createHandoff>).references).toEqual([refs[0]]);
});
test('P4: Make another restores the same handoff; older jobs explicitly report the missing prompt', async () => {
    await submit();
    expect((await submittedHref(api, 'job-1', model.id, () => true))?.params).toMatchObject(carry);
    expect((await submittedHref(api, 'old-job', model.id, () => true))?.params).toEqual({ modelId: 'video', prompt: '', kind: 'prompt-unavailable' });
    await wipeCache(); await bindCacheUser('other', cache, storage, createMemoryStorage());
    expect((await submittedHref(api, 'job-1', model.id, () => true))?.params).toMatchObject({ kind: 'prompt-unavailable' });
});
test('per-account histories are bounded and revoke writes that outlive sign-out', async () => {
    const store = accountHandoffStore<{ id: string }>('bounded-test', 2, createMemoryStorage());
    await store.put({ id: '1' }); await store.put({ id: '2' }); await store.put({ id: '3' });
    expect(await store.list()).toEqual([{ id: '2' }, { id: '3' }]);
    const late = store.put({ id: 'late' }); resetCacheUser(); await late;
    expect(await store.list()).toEqual([]);
});
function filmWithPrompt(): Film {
    const shot = { id: 'S1', location: '', props: '', characters: '', oneAction: true } as Shot;
    const film = { ...emptyFilm(), name: 'Film', shots: [shot] };
    film.prompts = [{ shot: 'S1', version: 1, content: 'A bird', context: promptContext(film, shot), at: '' }];
    return film;
}
test('P9: film handoff records completion against the exact shot and prompt, without touching manual verdicts', async () => {
    const film = filmWithPrompt(), params = filmReturnParams(film, 'S1');
    expect(params).toMatchObject({ filmId: localFilmId(film), shotId: 'S1', promptVersion: '1', promptContext: film.prompts[0].context });
    film.attempts.push({ shot: 'S1', version: 1, verdict: 'accepted', result: 'manual', changed: 'manual', at: '' });
    const before = JSON.stringify(film);
    await rememberFilmJob('film-job', params, 'A bird'); await settleFilmJob('film-job', 'succeeded', localFilmId(film));
    const item = (await filmReturns.list()).find(i => i.id === 'film-job')!;
    expect(item.state).toBe('succeeded'); expect(returnMatches(film, item)).toBe(true);
    expect(JSON.stringify(film)).toBe(before); expect(film.attempts[0].verdict).toBe('accepted');
});
test('P9: switching films before completion keeps the result as unattached shot history', async () => {
    const first = filmWithPrompt(), second = { ...filmWithPrompt(), name: 'Other film' };
    await rememberFilmJob('switched-job', filmReturnParams(first, 'S1'), 'A bird');
    await markFilmSwitch(localFilmId(second)); await settleFilmJob('switched-job', 'succeeded', localFilmId(second));
    const item = (await filmReturns.list()).find(i => i.id === 'switched-job')!;
    expect(item.filmId).toBe(localFilmId(first)); expect(item.switched).toBe(true);
    expect(returnMatches(first, item)).toBe(false); expect(returnMatches(second, item)).toBe(false);
});
test('P9: a prompt revision leaves the older result in history and preserves newer autosaved state', async () => {
    const film = filmWithPrompt(); await rememberFilmJob('revised-job', filmReturnParams(film, 'S1'), 'A bird');
    const revised = { ...film, prompts: [...film.prompts, { ...film.prompts[0], version: 2, content: 'A second bird' }] };
    inheritFilmIdentity(film, revised);
    await settleFilmJob('revised-job', 'succeeded', localFilmId(revised));
    const item = (await filmReturns.list()).find(i => i.id === 'revised-job')!;
    expect(returnMatches(revised, item)).toBe(false); expect(revised.prompts.at(-1)?.content).toBe('A second bird');
});
test('P9: a film switch racing completion cannot be lost by a later history write', async () => {
    const first = filmWithPrompt(), second = { ...filmWithPrompt(), name: 'Switched during completion' };
    await rememberFilmJob('racing-job', filmReturnParams(first, 'S1'), 'A bird');
    await Promise.all([markFilmSwitch(localFilmId(second)), settleFilmJob('racing-job', 'succeeded')]);
    const item = (await filmReturns.list()).find(i => i.id === 'racing-job')!;
    expect(item.state).toBe('succeeded'); expect(item.switched).toBe(true); expect(returnMatches(first, item)).toBe(false);
    await rememberFilmJob('racing-job', filmReturnParams(first, 'S1'), 'A bird');
    expect((await filmReturns.list()).find(i => i.id === 'racing-job')?.state).toBe('succeeded');
});

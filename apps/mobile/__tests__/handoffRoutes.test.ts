import { publishPick, resolvePublishPick } from '../src/lib/publishHandoff';
import { t } from '../src/lib/i18n';
import { resolveAppLink } from '../src/lib/resolveAppLink';
import { mapAppLink } from '../src/lib/appLinks';
import { fetchCatalog, mediaApi, type CatalogModel } from '../src/lib/media';
import { fetchPresets, type Preset } from '../src/lib/presets';
import { createUploadStore } from '../src/lib/cinemaUploadStore';
import { createMemoryStorage, createCache } from '../src/lib/cache';
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { continueWatchingHref, rememberEpisodeRoot, savedWatchPosition } from '../src/lib/cinemaHandoff';
import { inputTools, toolGroups } from '../src/lib/toolDirectory';
import { skillPromptHref } from '../src/lib/createHandoff';

jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111', parent = '22222222-2222-4222-8222-222222222222';
const model: CatalogModel = { id: 'video', name: 'Video', modality: 'text-to-video', durations: [5], credits: 1, gated: false, capabilities: null };
const job = { job_id: id, state: 'succeeded' as const, model_id: 'editor-server-render', credits: 0, created_at: '', has_asset: true };
const storage = createMemoryStorage(), cache = createCache(storage);
beforeEach(async () => { resetCacheUser(); await bindCacheUser(id, cache, storage, createMemoryStorage()); jest.mocked(fetchCatalog).mockResolvedValue([model]); });

test('B1: exported editor render is selected without a public catalog entry', async () => {
    const request = jest.fn().mockResolvedValueOnce({ ...job, output_type: 'editor-render' }).mockResolvedValueOnce({ mime_type: 'video/mp4', url: 'https://asset' });
    const result = await resolvePublishPick({ request } as any, id, [job], [], () => true);
    expect(result?.pick).toMatchObject({ job: { job_id: id, output_type: 'editor-render' }, mediaType: 'video' });
    expect(request.mock.calls[0][0]).toBe(`/api/v1/jobs/${id}`);
    expect(publishPick({ ...job, output_type: 'editor-render' }, [])?.mediaType).toBe('video');
});
test('B2: canonical web query resolves presetHref with prompt, template and recipe', async () => {
    jest.mocked(fetchPresets).mockResolvedValue([{ id: 'paper', modelId: 'video', prompt: 'Fold a paper bird', title: 'Paper bird', durationSeconds: 5, available: true } as Preset]);
    const result = await resolveAppLink('https://veyrnox.ai/app/create?model=wrong&preset=paper&recipe=faceless-reel');
    const url = new URL(result, 'https://app');
    expect(url.pathname).toBe('/create/video');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ prompt: 'Fold a paper bird', tid: 'paper', duration: '5', recipe: 'faceless-reel' });
    expect(await resolveAppLink('https://veyrnox.ai/app/create?model=video')).toBe('/create/video');
    expect(await resolveAppLink('https://veyrnox.ai/app/create?model=unknown')).toBe('/create');
    expect(mapAppLink('https://veyrnox.ai/app/create?preset=../../bad')).toBe('/create');
    expect(await resolveAppLink('https://veyrnox.ai/app/create?preset=unknown')).toBe('/create');
    jest.mocked(fetchPresets).mockRejectedValue(new Error('offline'));
    expect(await resolveAppLink('https://veyrnox.ai/app/create?preset=paper')).toBe('/templates/paper');
});
test('B3: episode upload runner retains the parent that creator detail reads', async () => {
    const store = createUploadStore(createMemoryStorage()); await store.setOwner(id);
    const release = store.acquire(store.ticket(), id, parent);
    expect(store.runningHref()).toEqual({ pathname: '/cinema/creator/[id]', params: { id, parent } });
    release!(); expect(store.runningHref()).toBeNull();
});
test('P5: prompt tools receive the actual prompt and current model', () => {
    for (const skill of ['prompt-writer', 'fix-my-prompt']) expect(skillPromptHref(skill, 'My scene', 'video')).toEqual({ pathname: '/chat/skills', params: { skill, prompt: 'My scene', modelId: 'video' } });
});
test('P6: an older job outside listJobs is fetched, preselected, and checked for publishable media', async () => {
    const request = jest.fn().mockResolvedValueOnce({ state: 'succeeded', model_id: 'video', credits: 1 }).mockResolvedValueOnce({ mime_type: 'video/mp4' });
    expect((await resolvePublishPick({ request } as any, id, [], [model], () => true))?.pick?.job.job_id).toBe(id);
    const unavailable = jest.fn().mockResolvedValue({ state: 'running' });
    expect(await resolvePublishPick({ request: unavailable } as any, id, [], [model], () => true)).toEqual({ error: 'handoff.publishPending' });
    const expired = jest.fn().mockResolvedValueOnce({ state: 'succeeded', model_id: 'video' }).mockRejectedValueOnce(new Error('expired'));
    expect(await resolvePublishPick({ request: expired } as any, id, [], [model], () => true)).toEqual({ error: 'handoff.publishMissing' });
});
test('P7: Continue watching supplies the known root, preserving legacy playback without a mapping', async () => {
    const item = { contentId: id, title: 'Episode', creator: '', position: 20, duration: 90 };
    expect((await continueWatchingHref(item)).params).not.toHaveProperty('series');
    await rememberEpisodeRoot(id, parent);
    expect((await continueWatchingHref(item)).params).toMatchObject({ id, series: parent, position: '20' });
    await wipeCache();
    expect((await continueWatchingHref(item)).params).not.toHaveProperty('series');
});
test('P8: watch finds saved position beyond page one, and restarts near-complete titles', async () => {
    const item = { contentId: id, title: '', creator: '', duration: 90, position: 20 };
    const list = jest.fn().mockResolvedValueOnce({ items: [], next: parent }).mockResolvedValueOnce({ items: [item], next: null });
    expect(await savedWatchPosition({ list }, id, () => true)).toBe(20);
    expect(list).toHaveBeenLastCalledWith(parent);
    expect(await savedWatchPosition({ list: jest.fn().mockResolvedValue({ items: [{ ...item, position: 87 }], next: null }) }, id, () => true)).toBe(0);
    expect(await savedWatchPosition({ list: jest.fn().mockResolvedValue({ items: [item] }) }, id, () => false)).toBe(0);
});
test('P10: reference mode includes optional reference slots; photo retains image edit/upscale tools and reference matches the source kind', () => {
    const reference = { ...model, id: 'reference', modality: 'text-to-image', capabilities: { media: { image: { required: false } } } };
    const photo = { ...model, id: 'photo', modality: 'image-to-video', capabilities: { media: { image: { required: true } } } };
    expect(inputTools([model, reference, photo], 'image', 'reference')).toEqual([reference, photo]);
    expect(toolGroups(inputTools([model, reference, photo], 'image', 'reference'), true).flatMap(g => g.tools)).toEqual([reference, photo]);
    const edit = { ...photo, id: 'edit', modality: 'image-to-image' };
    const audio = { ...reference, id: 'audio', capabilities: { media: { audio: { required: false } } } };
    expect(inputTools([model, reference, photo, edit, audio], 'image', 'reference')).toEqual([reference, photo, edit]);
    expect(inputTools([model, reference, photo, edit, audio], 'image', 'photo')).toEqual([photo, edit]);
});
test('late Publish lookup cannot preselect into a new account or screen', async () => {
    let resolve!: (x: any) => void, current = true;
    const request = jest.fn(() => new Promise(r => { resolve = r; }));
    const result = resolvePublishPick({ request } as any, id, [], [model], () => current);
    current = false; resolve({ state: 'succeeded', model_id: 'video' });
    expect(await result).toBeNull(); expect(request).toHaveBeenCalledTimes(1);
});

test('a public preset link survives the cold-start account binding', async () => {
    resetCacheUser();
    let finish!: (value: Preset[]) => void;
    jest.mocked(fetchPresets).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const link = resolveAppLink('https://veyrnox.ai/app/create?preset=paper');
    await bindCacheUser(id, cache, storage, createMemoryStorage());
    finish([{ id: 'paper', modelId: 'video', prompt: 'Bird', title: 'Paper', available: true } as Preset]);
    expect(await link).toContain('/create/video?');
});
test.each(['model=video', 'preset=paper'])('a hanging public lookup falls back after 1.5 s: %s', async query => {
    jest.useFakeTimers();
    try {
        jest.mocked(fetchCatalog).mockReturnValue(new Promise(() => {}));
        jest.mocked(fetchPresets).mockReturnValue(new Promise(() => {}));
        const path = `https://veyrnox.ai/app/create?${query}`;
        let resolved = false;
        const link = Promise.resolve(resolveAppLink(path)).then(value => { resolved = true; return value; });
        await jest.advanceTimersByTimeAsync(1499); expect(resolved).toBe(false);
        await jest.advanceTimersByTimeAsync(1); expect(await link).toBe(mapAppLink(path));
        expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
});
test('a rejected model lookup uses the mapped route and a newer link revokes an older lookup', async () => {
    jest.mocked(fetchCatalog).mockRejectedValueOnce(new Error('offline'));
    expect(await resolveAppLink('https://veyrnox.ai/app/create?model=video')).toBe('/create/video');
    let finish!: (value: CatalogModel[]) => void;
    jest.mocked(fetchCatalog).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const old = resolveAppLink('https://veyrnox.ai/app/create?model=video');
    resolveAppLink('https://veyrnox.ai/app/library'); finish([model]);
    // A superseded lookup resolves to the newest link's route, never an older screen.
    expect(await old).toBe(mapAppLink('https://veyrnox.ai/app/library'));
});
test('a fetched editor render has a translated label rather than its raw job id', async () => {
    const request = jest.fn().mockResolvedValueOnce({ state: 'succeeded', model_id: 'editor-server-render', output_type: 'editor-render' }).mockResolvedValueOnce({ mime_type: 'video/mp4' });
    const result = await resolvePublishPick({ request } as any, id, [], [], () => true);
    expect(result?.pick?.name).toBe(t('handoff.editedVideo'));
    expect(result?.pick?.name).not.toBe(id);
});

import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FilmGenerationHistory } from '../src/components/film/FilmGenerationHistory';
import { FilmPromptsStage } from '../src/components/film/FilmPromptsStage';
import { FilmPromptOutput } from '../src/components/film/FilmPromptOutput';
import { appStorage, bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import { accountHandoffStore } from '../src/lib/accountHandoffStore';
import { emptyFilm, promptContext, type Film, type Shot } from '../src/lib/filmStudio';
import { filmReturns, filmReturnParams, rememberFilmJob, refreshFilmReturns, MAX_PENDING_AGE_MS } from '../src/lib/filmGenerationReturns';
import { localFilmId, inheritFilmIdentity, persistFilmIdentity, restoreFilmIdentity, persistPhoneFilmIdentity, restorePhoneFilmIdentity } from '../src/lib/filmHandoffIdentity';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';

const mockRequest = jest.fn(), mockApi = { request: mockRequest } as any;
const mockPush = jest.fn();
let mockFocused = true;
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (effect: () => void | (() => void)) => {
        const React = jest.requireActual('react');
        React.useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]);
    },
}));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `film-${Math.random()}` }));
jest.mock('../src/components/film/FilmPromptOutput', () => ({ ...jest.requireActual('../src/components/film/FilmPromptOutput'), FilmPromptOutput: jest.fn(() => null) }));
void [RN.View, RN.Text, RN.Pressable];
let root: Root;
function filmWithPrompt(): Film {
    const shot = { id: 'S1', location: '', props: '', characters: '', oneAction: true } as Shot;
    const film = { ...emptyFilm(), name: 'Film', shots: [shot] };
    film.prompts = [{ shot: 'S1', version: 1, content: 'A bird', context: promptContext(film, shot), at: '' }];
    return film;
}
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    await wipeCache(); resetCacheUser(); const storage = createMemoryStorage();
    await bindCacheUser('film-owner', createCache(storage), storage, createMemoryStorage());
    mockRequest.mockReset().mockResolvedValue({ state: 'running' }); mockPush.mockClear(); mockFocused = true;
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });
const render = (film: Film) => act(async () => root.render(<FilmGenerationHistory film={film} shotId="S1" onResult={jest.fn()} />));

test('corrupt account history is empty and the next write repairs it', async () => {
    const storage = createMemoryStorage(), key = 'veyrnox.cache.v1.handoff-corrupt.film-owner';
    await storage.set(key, '{broken');
    const store = accountHandoffStore<{ id: string }>('corrupt', 2, storage);
    expect(await store.list()).toEqual([]);
    await store.put({ id: 'recovered' });
    expect(await store.list()).toEqual([{ id: 'recovered' }]);
    expect(JSON.parse((await storage.get(key))!).items).toEqual([{ id: 'recovered' }]);
});
test('film identity never serializes the film and persists one small identity per slot', async () => {
    const film = filmWithPrompt(), serialize = jest.fn(() => ({ huge: 'x'.repeat(1000000) }));
    Object.defineProperty(film, 'toJSON', { value: serialize });
    const id = localFilmId(film);
    const write = jest.spyOn(appStorage, 'set');
    for (let i = 0; i < 5; i++) {
        const edited = { ...film, name: `Edit ${i}` }; inheritFilmIdentity(film, edited);
        expect(localFilmId(edited)).toBe(id);
        await persistPhoneFilmIdentity(edited); await persistFilmIdentity(edited, 'cloud-one');
    }
    await persistPhoneFilmIdentity(film); await persistFilmIdentity(film, 'cloud-one');
    expect(serialize).not.toHaveBeenCalled();
    for (const [, raw] of write.mock.calls) {
        expect(raw.length).toBeLessThan(300);
        expect(JSON.parse(raw).items).toHaveLength(1);
    }
    const phone = filmWithPrompt(), cloud = filmWithPrompt();
    // Slot identity survives content changes, rather than matching the entire document.
    phone.name = 'Saved phone changes'; cloud.name = 'Saved cloud changes';
    await restorePhoneFilmIdentity(phone); await restoreFilmIdentity(cloud, 'cloud-one');
    expect(localFilmId(phone)).toBe(id); expect(localFilmId(cloud)).toBe(id);
    expect(localFilmId(filmWithPrompt())).not.toBe(id);
});
test('FilmPromptsStage defers return parameters until the Create action is pressed', async () => {
    const film = filmWithPrompt();
    await act(async () => root.render(<FilmPromptsStage film={film} change={jest.fn()} catalog={[]} live />));
    const props = jest.mocked(FilmPromptOutput).mock.calls.at(-1)![0];
    expect(typeof props.returnParams).toBe('function');
    expect(props.returnParams?.()).toMatchObject({ filmId: localFilmId(film), shotId: 'S1', promptVersion: '1' });
});
test.each([new ApiError(404, 'missing'), new ApiError(400, 'job_not_found')])('a not-found film job settles as failed: %s', async error => {
    const film = filmWithPrompt(); await rememberFilmJob('gone', filmReturnParams(film, 'S1'), 'A bird');
    mockRequest.mockRejectedValue(error);
    expect((await refreshFilmReturns(mockApi, film, () => true))[0].state).toBe('failed');
    await refreshFilmReturns(mockApi, film, () => true); expect(mockRequest).toHaveBeenCalledTimes(1);
});
test('pending film jobs expire after seven days without another request', async () => {
    const film = filmWithPrompt(); await rememberFilmJob('expired', filmReturnParams(film, 'S1'), 'A bird');
    await filmReturns.update('expired', item => ({ ...item!, createdAt: Date.now() - MAX_PENDING_AGE_MS - 1 }));
    expect((await refreshFilmReturns(mockApi, film, () => true))[0].state).toBe('failed');
    expect(mockRequest).not.toHaveBeenCalled();
});
test('history does not refetch on each edit, backs off pending work, and stops at completion', async () => {
    jest.useFakeTimers();
    const film = filmWithPrompt(); await rememberFilmJob('pending', filmReturnParams(film, 'S1'), 'A bird');
    await render(film); expect(mockRequest).toHaveBeenCalledTimes(1);
    const edited = { ...film, name: 'One keystroke' }; inheritFilmIdentity(film, edited);
    await render(edited); expect(mockRequest).toHaveBeenCalledTimes(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); }); expect(mockRequest).toHaveBeenCalledTimes(2);
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); }); expect(mockRequest).toHaveBeenCalledTimes(2);
    mockRequest.mockResolvedValue({ state: 'succeeded' });
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); }); expect(mockRequest).toHaveBeenCalledTimes(3);
    await act(async () => { await jest.advanceTimersByTimeAsync(120000); }); expect(mockRequest).toHaveBeenCalledTimes(3);
});
test('history uses dedicated translated controls with the prompt version in accessible labels', async () => {
    const film = filmWithPrompt(); await rememberFilmJob('done', filmReturnParams(film, 'S1'), 'A bird');
    mockRequest.mockResolvedValue({ state: 'succeeded' }); await render(film);
    for (const key of ['handoff.openFilmJobVersion', 'handoff.useFilmResultVersion']) {
        const control = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t(key, { version: 1 }));
        expect(control).toHaveLength(1);
    }
});

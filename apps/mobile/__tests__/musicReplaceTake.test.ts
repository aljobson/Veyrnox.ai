import { ApiError, type ApiClient } from '../src/lib/api';
import { createReplaceTake } from '../src/lib/music/replaceTake';
import { createSongActionFlow } from '../src/lib/music/actionFlow';
import { replaceAction } from '../src/lib/music/replaceAction';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { subscribeSongChanges } from '../src/lib/music/songChanges';
import { sectionSong, readyView, generationStart } from './fixtures/musicSectionActions';
import { SONG_ID, VERSION_ID, deferred } from './fixtures/musicActions';
let live: boolean, request: jest.Mock, keeper: ReturnType<typeof createReplaceTake>;
const candidate = readyView.candidates[0];
beforeEach(() => { live = true; request = jest.fn().mockResolvedValue({ version_id: candidate.version_id, idempotent: false });
    keeper = createReplaceTake({ request } as unknown as ApiClient, SONG_ID, readyView.id, () => live, jest.fn()); });
afterEach(resetCacheUser);
test('no automatic commit; explicit double tap sends one deterministic request and notifies', async () => {
    const changed = jest.fn(), stop = subscribeSongChanges(changed), wait = deferred<unknown>();
    expect(request).not.toHaveBeenCalled(); request.mockReturnValue(wait.promise);
    const first = keeper.keep(candidate), second = keeper.keep(candidate); expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ generation_id: readyView.id, version_id: candidate.version_id,
        idempotency_key: `replace-commit.${readyView.id}.${candidate.version_id}` });
    expect(keeper.canKeep(readyView.candidates[1])).toBe(false);
    wait.resolve({ version_id: candidate.version_id, idempotent: false }); await Promise.all([first, second]);
    expect(keeper.snapshot()).toMatchObject({ phase: 'committed', label: 'A' });
    for (const c of readyView.candidates) expect(keeper.canKeep(c)).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1); stop();
});
test.each([{ state: 'running' }, { state: 'queued' }, { state: 'failed' }, { version_id: null }, { version_id: 'bad' }, { version_id: `${VERSION_ID}\n` }])('only ready UUID candidates can commit: %p', async patch => {
    await keeper.keep({ ...candidate, ...patch }); expect(request).not.toHaveBeenCalled();
});
test('unknown outcome never automatically retries; only same take can retry with same key', async () => {
    request.mockRejectedValueOnce(new ApiError(503, 'take_commit_unknown'));
    await keeper.keep(candidate); expect(keeper.snapshot().phase).toBe('unknown'); expect(request).toHaveBeenCalledTimes(1);
    await keeper.keep(readyView.candidates[1]); expect(request).toHaveBeenCalledTimes(1);
    await keeper.keep(candidate); expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
    expect(keeper.snapshot().phase).toBe('committed');
});
test.each(['take_commit_conflict', 'revision_conflict'])('%s is definitive for the pair', async code => {
    request.mockRejectedValueOnce(new ApiError(409, code)); await keeper.keep(candidate);
    expect(keeper.snapshot().phase).toBe(code === 'revision_conflict' ? 'changed' : 'conflict');
    for (const c of readyView.candidates) { expect(keeper.canKeep(c)).toBe(false); await keeper.keep(c); }
    expect(request).toHaveBeenCalledTimes(1);
});
test('another writer advancing the current source is a definitive revision conflict', async () => {
    let current = VERSION_ID;
    request.mockImplementation(async () => {
        if (current !== VERSION_ID) throw new ApiError(409, 'revision_conflict');
        return { version_id: candidate.version_id, idempotent: false };
    });
    current = '99999999-2222-4333-8444-555555555555';
    await keeper.keep(candidate); expect(keeper.snapshot().phase).toBe('changed');
    await keeper.keep(candidate); expect(request).toHaveBeenCalledTimes(1);
});
test('account change blocks late commit success, notification and future commits', async () => {
    await bindCacheUser('commit-owner'); const wait = deferred<unknown>();
    request.mockResolvedValueOnce(sectionSong);
    const flow = createSongActionFlow({ request } as unknown as ApiClient, replaceAction(SONG_ID), SONG_ID); await flow.load();
    keeper = createReplaceTake({ request } as unknown as ApiClient, SONG_ID, generationStart.generation_id, flow.isLive, flow.fail);
    request.mockReturnValue(wait.promise); const changed = jest.fn(), stop = subscribeSongChanges(changed);
    const saving = keeper.keep(candidate); await bindCacheUser('different-owner');
    wait.resolve({ version_id: candidate.version_id, idempotent: false }); await saving;
    expect(changed).not.toHaveBeenCalled(); expect(keeper.snapshot().phase).not.toBe('committed');
    const count = request.mock.calls.length; await keeper.keep(candidate); expect(request).toHaveBeenCalledTimes(count);
    stop(); flow.dispose();
});

declare const __dirname: string;
const { readFileSync } = require('fs');
const { resolve } = require('path');
import { ApiError } from '../src/lib/api';
import { creatorMessage, draftBody, emptyDraft } from '../src/lib/cinemaDrafts';
import { ROOT_TYPES, VIDEO_TYPES, childType, parentTypeOf, listContent, nextPosition, studioDraftBody, withdrawBody, importBody, fetchCreatorPoster, studioMessage } from '../src/lib/cinemaStudio';
const ID = '11111111-1111-4111-8111-111111111111';
const input = { ...emptyDraft(), title: ' Film ' };
const root = { parentId: null, parentType: null, position: null };
const child = { parentId: ID, parentType: 'SERIES', position: 1 };
const source = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8') as string;
const quoted = (text: string) => [...text.matchAll(/'([^']*)'/g)].map(x => x[1]);
test('type vocabulary and hierarchy', () => {
    expect(ROOT_TYPES).toEqual(['SERIES', 'FILM', 'SHORT', 'TRAILER']);
    expect(VIDEO_TYPES).toEqual(['FILM', 'SHORT', 'TRAILER', 'EPISODE']);
    expect(childType('SERIES')).toBe('SEASON'); expect(childType('SEASON')).toBe('EPISODE'); expect(childType('FILM')).toBeNull();
    expect(parentTypeOf('SEASON')).toBe('SERIES'); expect(parentTypeOf('EPISODE')).toBe('SEASON'); expect(parentTypeOf('SERIES')).toBeNull();
});
test('one-level content paths and invalid parent makes no request', async () => {
    const request = jest.fn().mockResolvedValue({ content: [] });
    await listContent({ request }); expect(request).toHaveBeenLastCalledWith('/api/v1/cinema/content');
    await listContent({ request }, ID); expect(request).toHaveBeenLastCalledWith(`/api/v1/cinema/content?parent_id=${ID}`);
    request.mockClear(); expect(() => listContent({ request }, 'bad')).toThrow(new ApiError(400, 'invalid_query')); expect(request).not.toHaveBeenCalled();
});
test('next number and bounded refusal', () => {
    expect(nextPosition([])).toBe(1); expect(nextPosition([{ position: 3 }, { position: 1 }])).toBe(4);
    expect(() => nextPosition([{ position: 10000 }])).toThrow();
});
test('roots preserve draftBody and children have exactly the server required keys', () => {
    expect(studioDraftBody(input, root)).toEqual(draftBody(input));
    expect(studioDraftBody({ ...input, content_type: 'SERIES' }, root)).toEqual({ ...draftBody(input), content_type: 'SERIES' });
    const body = studioDraftBody({ ...input, content_type: 'SEASON' }, child);
    expect(Object.keys(body).sort()).toEqual(quoted(source('lib/cinema/contentApi.js').match(/const fields = \[([^\]]+)\]/)![1]).sort());
    expect(body).toMatchObject({ parent_id: ID, position: 1, title: 'Film' }); expect(body).not.toHaveProperty('categories');
});
test.each([
    [{ content_type: 'EPISODE' }, {}], [{}, { position: 0 }], [{}, { position: 10001 }], [{}, { position: 1.5 }],
    [{ categories: ['drama'] }, {}], [{}, { parentId: 'bad' }], [{ title: ' ' }, {}], [{ language: 'EN' }, {}],
    [{ synopsis: 'x'.repeat(2001) }, {}], [{ ai_disclosures: ['bad'] }, {}],
])('rejects malformed child %j %j', (bad, context) => {
    expect(() => studioDraftBody({ ...input, content_type: 'SEASON', ...bad }, { ...child, ...context })).toThrow(new ApiError(400, 'invalid_draft'));
});
test('withdrawal and import match server keys; reasons use code points', () => {
    const body = withdrawBody(ID, '  why  '); expect(body).toEqual({ content_id: ID, reason: 'why' });
    expect(Object.keys(body).sort()).toEqual(quoted(source('lib/cinema/publishApi.js').match(/withdraw: \[([^\]]+)\]/)![1]).sort());
    expect(withdrawBody(ID, '🎬'.repeat(500)).reason).toHaveLength(1000);
    for (const [id, reason] of [[ID, 'ab'], [ID, '🎬'.repeat(501)], ['bad', 'reason']]) expect(() => withdrawBody(id, reason)).toThrow(new ApiError(400, 'invalid_withdrawal'));
    expect(importBody(ID, ID)).toEqual({ content_id: ID, job_id: ID });
    expect(Object.keys(importBody(ID, ID)).sort()).toEqual(quoted(source('lib/cinema/libraryUploadApi.js').match(/Object.keys\(body\).some\(k=>!\[([^\]]+)\]/)![1]).sort());
    expect(() => importBody('bad', ID)).toThrow(new ApiError(400, 'invalid_upload')); expect(() => importBody(ID, 'bad')).toThrow();
});
test('poster validates JPEG bytes and forbids transport caching', async () => {
    const stream = jest.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([255, 216, 255]).buffer });
    expect(await fetchCreatorPoster({ stream }, ID)).toBe('data:image/jpeg;base64,/9j/');
    expect(stream).toHaveBeenCalledWith(`/api/v1/cinema/posters/${ID}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
    for (const bytes of [[], [137, 80, 78, 71], new Uint8Array(5 * 1024 * 1024 + 1)]) {
        stream.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array(bytes).buffer });
        expect(await fetchCreatorPoster({ stream }, ID)).toBeNull();
    }
    stream.mockResolvedValue({ ok: false, status: 404 }); expect(await fetchCreatorPoster({ stream }, ID)).toBeNull();
    stream.mockRejectedValue(new Error('offline')); expect(await fetchCreatorPoster({ stream }, ID)).toBeNull();
});
test.each([
    ['position_taken', 'cinema.creatorWorkspace.thatNumberIsAlreadyInUse'], ['draft_limit_reached', 'cinema.creatorWorkspace.youHaveReachedThePreviewDraft'],
    ['not_withdrawable', 'cinema.creatorWorkspace.thisTitleCannotBeWithdrawnIn'], ['already_published', 'cinema.creatorWorkspace.thisTitleIsAlreadyPublished'],
    ['suspended', 'cinema.creatorWorkspace.thisTitleWasSuspendedByAn'], ['content_not_found', 'cinema.creatorWorkspace.thatDraftIsNoLongerAvailable'],
    ['no_episodes', 'cinema.creatorWorkspace.addAtLeastOneEpisodeTo'], ['source_not_found', 'cinema.videoUpload.thatLibraryVideoIsNoLonger'],
    ['source_not_video', 'cinema.videoUpload.chooseAFinishedVideoFromYour'], ['upload_capacity_reached', 'cinema.videoUpload.thePreviewStorageOrDailyUpload'],
    ['draft_locked', 'cinemaUpload.revision'], ['structure_locked', 'cinemaUpload.revision'], ['invalid_parent', 'cinemaUpload.revision'],
])('studio message %s', (code, key) => expect(studioMessage(new ApiError(code === 'upload_capacity_reached' ? 429 : 409, code))).toBe(key));
test('existing messages stay identical for every original code and video root type', () => {
    const table = source('apps/mobile/src/lib/cinemaDrafts.ts').match(/const messages: Record<string, string> = \{([\s\S]*?)\n    \}/)![1];
    const codes = [...table.matchAll(/(\w+): '/g)].map(x => x[1]);
    for (const code of codes) for (const contentType of [undefined, 'FILM', 'SHORT', 'TRAILER']) {
        const error = new ApiError(409, code); expect(studioMessage(error, { contentType })).toBe(creatorMessage(error));
    }
    expect(studioMessage(new ApiError(422, 'video_not_ready'), { contentType: 'SERIES' })).toBe('cinema.creatorWorkspace.everyEpisodeOrTheFilmItself');
    expect(studioMessage(new Error('offline'))).toBe(creatorMessage(new Error('offline')));
});

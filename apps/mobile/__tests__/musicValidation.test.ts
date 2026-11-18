import { hookPlayback } from '../src/lib/music/player';
import { isMusicSongRow, isMusicSongDetail, isMusicVersion, isMusicHook, isShareLink, isMusicLifecycle } from '../src/lib/music/validate';
import { song, version, hook, trashedRow, link } from './fixtures/music';

const missing = (value: object, key: string) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
const lifecycle = { id: 's1', revision: 3, lifecycle_status: 'trashed', updated_at: version.created_at };
test.each([
    [isMusicSongRow, { id: 's1', title: 'Title' }], [isMusicSongRow, trashedRow], [isMusicSongDetail, song],
    [isMusicVersion, version], [isMusicHook, hook], [isShareLink, link], [isMusicLifecycle, lifecycle],
])('accepts the documented shape', (validate, fixture) => { expect((validate as (v: unknown) => boolean)(fixture)).toBe(true); });
for (const [name, validate, fixture, required] of [
    ['row', isMusicSongRow, trashedRow, ['id', 'title']],
    ['detail', isMusicSongDetail, song, ['id', 'title', 'job_id', 'version_id', 'current_version', 'versions', 'actions', 'provenance']],
    ['version', isMusicVersion, version, Object.keys(version)],
    ['hook', isMusicHook, hook, Object.keys(hook)],
    ['link', isShareLink, link, Object.keys(link)],
    ['lifecycle', isMusicLifecycle, lifecycle, Object.keys(lifecycle)],
] as const) {
    describe(name, () => {
        test.each(required)('rejects missing %s', key => expect(validate(missing(fixture, key))).toBe(false));
        test.each(Object.keys(fixture))('rejects wrong type %s for promised fields', key => {
            if (name === 'row' && ['visibility', 'workspace_id', 'created_at', 'updated_at', 'status', 'feedback'].includes(key)) return;
            expect(validate({ ...fixture, [key]: false })).toBe(false);
        });
    });
}
test.each(Object.keys({ ...version, is_current: true }))('detail validates every nested version field %s', key => {
    expect(isMusicSongDetail({ ...song, versions: [missing(song.versions[0], key)] })).toBe(false);
    expect(isMusicSongDetail({ ...song, versions: [{ ...song.versions[0], [key]: [] }] })).toBe(false);
});
test.each(Object.keys(version))('detail validates every current version field %s', key => {
    expect(isMusicSongDetail({ ...song, current_version: missing(version, key) })).toBe(false);
    expect(isMusicSongDetail({ ...song, current_version: { ...version, [key]: [] } })).toBe(false);
});
test('optional fields reject wrong types and numbers must be finite', () => {
    for (const key of ['job_id', 'version_id', 'lifecycle_status', 'workspace_name', 'audio_url', 'revision']) {
        expect(isMusicSongRow({ id: 's', title: 't', [key]: false })).toBe(false);
    }
    expect(isMusicSongRow({ id: 's', title: 't', revision: NaN })).toBe(false);
    expect(isMusicSongDetail({ ...song, actions: [1] })).toBe(false);
    expect(isMusicVersion({ ...version, version_number: Infinity })).toBe(false);
});
test.each(['https://evil.test/asset', '/api/v1/jobs/nope/asset', `${hook.audio_url}?x=1`, `${hook.audio_url}/extra`, `${hook.audio_url}\n`])('hook rejects unsafe path %s', audio_url => {
    expect(isMusicHook({ ...hook, audio_url })).toBe(true);
    expect(() => hookPlayback({ ...hook, audio_url })).toThrow('bad_response');
});
test.each([{ start_seconds: NaN }, { end_seconds: Infinity }])('hook rejects invalid range %p', range => {
    expect(isMusicHook({ ...hook, ...range })).toBe(false);
});

test.each([{ start_seconds: -1 }, { end_seconds: 4 }, { end_seconds: 3 }])('playback rejects a shaped hook with invalid bounds %p', range => {
    expect(isMusicHook({ ...hook, ...range })).toBe(true);
    expect(() => hookPlayback({ ...hook, ...range })).toThrow('bad_response');
});

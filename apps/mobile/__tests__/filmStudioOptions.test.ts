import { emptyFilm, parseFilm } from '../src/lib/filmStudio';
import { boardId, clipLengths, frameFormats, isStudio, newShot, nextShotId, normalizeFilmStack, promptOpenState, sanitizeShotId, setupModels, shotIdProblem } from '../src/lib/filmStudioOptions';
import type { CatalogModel } from '../src/lib/media';
const model = (id: string, over: Partial<CatalogModel> = {}): CatalogModel => ({ id, name: id, modality: 'text-to-video', credits: 1, gated: false,
    durations: [5, 10, 15], capabilities: { inputs: { prompt: { max: 100 }, aspect_ratio: { values: ['9:16', '16:9'] } } }, ...over });
const video = model('video'), image = model('image', { modality: 'text-to-image' });
const blocked = ['clips', 'topic', 'plan_id'].map(key => model(key, { capabilities: { inputs: { prompt: {}, [key]: {} } } }));
const catalog = [video, image, model('short', { durations: [5] }), model('gated', { gated: true }), ...blocked, model('no-prompt', { capabilities: { inputs: {} } })];

test('setup models use the web prompt filter and video duration window', () => {
    expect(setupModels(catalog, 'video')).toEqual([video]);
    expect(setupModels(catalog, 'image')).toEqual([image]);
});
test('lengths, formats and normalization follow the selected workflow and supported schema', () => {
    const stack = { ...emptyFilm().stack, video: 'video', seconds: '12', aspect: '1:1' };
    expect(clipLengths(stack, catalog)).toEqual([10, 15]);
    expect(clipLengths({ ...stack, video: '' }, catalog)).toEqual([10]);
    expect(clipLengths({ ...stack, videoAccess: 'External' }, catalog)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(frameFormats(stack, catalog)).toEqual(['9:16', '16:9']);
    expect(frameFormats(stack, [model('video', { capabilities: { inputs: { aspect_ratio: { values: ['4:3'] } } } })])).toEqual(['16:9', '9:16', '1:1']);
    expect(normalizeFilmStack(stack, 'image', 'image', catalog)).toEqual({ ...stack, image: 'image', seconds: '10', aspect: '9:16' });
    expect(normalizeFilmStack(stack, 'videoAccess', 'External', catalog)).toEqual({ ...stack, videoAccess: 'External' });
    expect(normalizeFilmStack(stack, 'video', 'legacy name', catalog)).toEqual({ ...stack, video: 'legacy name' });
});
test('new cards preserve stack seconds, blank lane fields and reserve every historical id', () => {
    const film = emptyFilm(); film.stack.seconds = '15';
    const first = newShot(film); film.shots.push(first);
    expect(first).toMatchObject({ id: 'sc01-sh01', seconds: '15', complexity: '', text: '', textPlacement: '', textContext: '', oneAction: false });
    expect(nextShotId(film)).toBe('sc01-sh02');
    film.shots = [];
    film.prompts.push({ shot: first.id, version: 1, content: '', context: '', at: '' });
    film.attempts.push({ shot: 'sc01-sh02', version: 1, verdict: 'rejected', result: '', changed: '', at: '' });
    expect(newShot(film).id).toBe('sc01-sh03');
    expect(parseFilm(JSON.stringify({ ...film, shots: [newShot(film)] })).ok).toBe(true);
});
test('id drafts sanitize, reject invalid formats, duplicates and abandoned history', () => {
    const film = emptyFilm(); film.shots = [newShot(film)]; film.shots.push(newShot(film));
    film.prompts.push({ shot: 'old', version: 1, content: '', context: '', at: '' });
    expect(sanitizeShotId('sc 01/!a')).toBe('sc01a');
    for (const id of ['', '_shot', '-a', 'a'.repeat(62)]) expect(shotIdProblem(film, 0, id)).toBe('format');
    expect(shotIdProblem(film, 0, film.shots[1].id)).toBe('duplicate');
    expect(shotIdProblem(film, 0, 'old')).toBe('history');
    expect(shotIdProblem(film, 0, film.shots[0].id)).toBeNull();
    expect(shotIdProblem(film, 0, 'a'.repeat(61))).toBeNull();
});
test('board allocation avoids both existing and same-scaffold ids', () => {
    const film = emptyFilm(); film.boards = ['light', 'light-style'].map(id => ({ id, name: 'other', type: 'style', decision: 'revise', references: [] }));
    expect(boardId(film, 'light', 'style', [])).toBe('light-style-2');
    expect(boardId(film, 'light', 'style', ['light-style-2'])).toBe('light-style-3');
});
test('prompt open states refuse each unsupported case in order', () => {
    const options = { access: 'Studio', live: true, prompt: 'hello', duration: 10, aspect: '16:9' };
    expect(isStudio('Studio')).toBe(true); expect(isStudio('studio')).toBe(false);
    expect(promptOpenState(video, options)).toEqual({ ok: true });
    expect(promptOpenState(video, { ...options, access: 'External' })).toEqual({ ok: false, reason: 'access' });
    expect(promptOpenState(null, options)).toEqual({ ok: false, reason: 'catalog' });
    expect(promptOpenState(video, { ...options, live: false })).toEqual({ ok: false, reason: 'catalog' });
    for (const m of [...blocked, catalog.at(-1)!]) expect(promptOpenState(m, options)).toEqual({ ok: false, reason: 'catalog' });
    expect(promptOpenState(video, { ...options, prompt: 'x'.repeat(101) })).toEqual({ ok: false, reason: 'limit' });
    expect(promptOpenState(video, { ...options, duration: 12 })).toEqual({ ok: false, reason: 'duration' });
    expect(promptOpenState(video, { ...options, aspect: '1:1' })).toEqual({ ok: false, reason: 'aspect' });
    expect(promptOpenState(video, { ...options, aspect: undefined })).toEqual({ ok: true });
    expect(promptOpenState(model('plain', { capabilities: { inputs: { prompt: {} } } }), options)).toEqual({ ok: true });
});

import { FILM_STAGES, handoffFor, isLocked, parseFilm, promptContext, shotRow, shotRows, stageIssues, stageStatuses, summarize, type Film } from '../src/lib/filmStudio';
import { loadStudio, saveStudio } from '../src/lib/filmStudioStore';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import type { CatalogModel } from '../src/lib/media';

// The app has no Node type definitions, so the two Node pieces this file needs are declared here.
declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
const join = (...parts: string[]): string => (require('path') as { join: (...p: string[]) => string }).join(...parts);

// The web's own rules, loaded from its source, so a change there that the phone copy misses fails here.
const webSource = readFileSync(join(__dirname, '..', '..', '..', 'app', 'veyrnox', '_lib', 'filmStudio.js'), 'utf8').replace(/^export /gm, '');
const web = new Function(`${webSource}\nreturn { emptyFilm, stageIssues, isLocked, lockAsset, promptContext, buildShotPrompt, nextPromptVersion, logFilmAttempt, shotAssets, assetKey, PROMPT_DETAILS, STYLE_BOARDS, FILM_STAGES, SHOT_LANES, ACCEPTANCE_CHECKS };`)();

const SHOT: Record<string, any> = {
    id: 'S1', location: '@room:v1', time: 'dusk', characters: '@hero:v1', props: 'none', description: 'She opens the door.', dialogue: 'none', seconds: '10', complexity: 'low',
    goal: 'Show arrival', action: 'opens', dramaturgy: 'tension', blocking: 'door left', acting: 'calm', style: 'soft', size: 'medium', movement: 'static', lens: '35mm', angle: 'eye level', cut: 'hard', pace: 'slow', transition: 'cut', oneAction: true,
};
const refs = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ source: `${prefix}-${i}`, caption: `caption ${i}`, kind: 'reference' }));
const board = (name: string, type: string, n: number) => ({ id: `b-${name}`, name, type, decision: 'approved', references: refs(n, name) });

function baseFilm(): any {
    const film = web.emptyFilm();
    return {
        ...film,
        name: 'Test film',
        script: 'A short film.',
        stack: { image: 'Image Model', video: 'Test Video', imageAccess: 'Studio', videoAccess: 'Studio', seconds: '10', aspect: '16:9' },
        shots: [SHOT],
        boards: [board('@room:v1', 'location', 8), board('@hero:v1', 'character', 10), ...web.STYLE_BOARDS.map((n: string) => board(n, 'style', 1))],
        assets: [
            { tag: '@room', version: 1, type: 'location', descriptor: 'A small room with a green door.', references: ['room-1.png'], tests: {} },
            { tag: '@hero', version: 1, type: 'character', descriptor: 'A tall woman in a grey coat.', references: ['hero-1.png'], tests: {} },
        ],
    };
}
function passing(film: any): any {
    const withTests = { ...film, assets: film.assets.map((a: any) => ({ ...a, tests: {} })) };
    // Fill each matrix row through the web's own matrix by locking with generated passes.
    const filled = { ...withTests };
    filled.assets = withTests.assets.map((a: any) => {
        const rows = (globalThis as any).__matrix(filled, a);
        return { ...a, tests: Object.fromEntries(rows.map((r: any, i: number) => [r.id, { result: `out-${a.tag}-${i}.png`, verdict: 'pass' }])) };
    });
    return filled;
}
const matrixSource = readFileSync(join(__dirname, '..', '..', '..', 'app', 'veyrnox', '_lib', 'filmStudio.js'), 'utf8').replace(/^export /gm, '');
(globalThis as any).__matrix = new Function(`${matrixSource}\nreturn testMatrix;`)();

function lockedFilm(): any {
    let film = passing(baseFilm());
    for (const a of [...film.assets]) film = web.lockAsset(film, web.assetKey(a));
    return film;
}
function withPrompt(film: any): any {
    const details = Object.fromEntries(web.PROMPT_DETAILS.map(([k]: string[]) => [k, `detail ${k}`]));
    const content = web.buildShotPrompt(film, film.shots[0], details);
    return { ...film, prompts: [web.nextPromptVersion(film, film.shots[0], content)] };
}
const catalogModel = (over: Partial<CatalogModel> = {}): CatalogModel => ({ id: 'test-video', name: 'Test Video', modality: 'text-to-video', credits: 12, gated: false, durations: [5, 10, 15], capabilities: { inputs: { prompt: { max: 4000 } } }, ...over });

describe('the phone copy of the web rules', () => {
    test('stage checks agree on an empty, a half-built, a locked and a prompted studio', () => {
        const stages: any[] = [web.emptyFilm(), baseFilm(), passing(baseFilm()), lockedFilm(), withPrompt(lockedFilm())];
        stages.forEach((film, n) => {
            for (let s = 0; s < 7; s++) expect({ n, s, issues: stageIssues(film as Film, s) }).toEqual({ n, s, issues: web.stageIssues(film, s) });
        });
    });

    test('a lock holds only while the passport, boards and tests are unchanged, as on the web', () => {
        const film = lockedFilm();
        for (const a of film.assets) expect(isLocked(film, a)).toBe(web.isLocked(film, a));
        expect(film.assets.every((a: any) => isLocked(film, a))).toBe(true);
        const changed = { ...film, assets: film.assets.map((a: any) => (a.tag === '@hero' ? { ...a, descriptor: 'A different woman.' } : a)) };
        for (const a of changed.assets) expect(isLocked(changed, a)).toBe(web.isLocked(changed, a));
        expect(isLocked(changed, changed.assets[1])).toBe(false);
    });

    test('prompt context matches, so a prompt written on the web reads as current here', () => {
        const film = withPrompt(lockedFilm());
        expect(promptContext(film, film.shots[0])).toBe(web.promptContext(film, film.shots[0]));
        expect(shotRow(film, film.shots[0]).state).toBe('prompt-ready');
    });

    test('the stage names and the shot fields are the web’s', () => {
        expect(FILM_STAGES.map(([id, title]) => [id, title])).toEqual(web.FILM_STAGES);
    });
});

describe('parseFilm', () => {
    test('accepts a web export and keeps the shots', () => {
        const parsed = parseFilm(JSON.stringify(withPrompt(lockedFilm())));
        expect(parsed.ok && parsed.film.shots[0].id).toBe('S1');
    });
    test('refuses non-JSON, the wrong schema, a bad aspect and duplicate shots', () => {
        expect(parseFilm('nope')).toEqual({ ok: false, error: 'That is not a Film Studio JSON export.' });
        expect(parseFilm(JSON.stringify({ ...baseFilm(), schema: 2 })).ok).toBe(false);
        expect(parseFilm(JSON.stringify({ ...baseFilm(), stack: { ...baseFilm().stack, aspect: '4:3' } })).ok).toBe(false);
        const dup = parseFilm(JSON.stringify({ ...baseFilm(), shots: [SHOT, SHOT] }));
        expect(dup).toEqual({ ok: false, error: 'The studio file contains duplicate identifiers.' });
    });
    test('refuses a file over 1 MB', () => {
        expect(parseFilm(' '.repeat(1_000_001)).ok).toBe(false);
    });
});

describe('status', () => {
    test('stages list what is left, shots show where each stands, the summary counts them', () => {
        const half = baseFilm();
        expect(stageStatuses(half)[5]).toMatchObject({ done: false, open: 2 });
        expect(shotRow(half, half.shots[0]).state).toBe('blocked');
        const locked = lockedFilm();
        expect(shotRow(locked, locked.shots[0]).state).toBe('no-prompt');
        const done = withPrompt(locked);
        expect(summarize(done)).toMatchObject({ shots: 1, assets: 2, lockedAssets: 2, acceptedShots: 0, stagesDone: 7 });
        expect(shotRows(done)).toHaveLength(1);
    });
    test('an out-of-date prompt is flagged', () => {
        const film = withPrompt(lockedFilm());
        const edited = { ...film, shots: [{ ...film.shots[0], blocking: 'door right' }] };
        expect(shotRow(edited, edited.shots[0]).state).toBe('prompt-stale');
    });
});

describe('handoff to Create', () => {
    const film = withPrompt(lockedFilm());
    test('offers the catalog price for the shot’s length and the full prompt', () => {
        const offer = handoffFor(film, film.shots[0], [catalogModel()]);
        expect(offer).toMatchObject({ ok: true, credits: 24, seconds: 10 });
        expect(offer.ok && offer.prompt).toBe(film.prompts[0].content);
    });
    test('matches the studio’s video model by name or id, ignoring case and punctuation', () => {
        const base = lockedFilm();
        const named = withPrompt({ ...base, stack: { ...base.stack, video: 'test-VIDEO' } });
        expect(handoffFor(named, named.shots[0], [catalogModel()]).ok).toBe(true);
    });
    test('refuses when the model is missing, gated, lacks the length, or the prompt is too long', () => {
        expect(handoffFor(film, film.shots[0], [])).toMatchObject({ ok: false });
        expect(handoffFor(film, film.shots[0], [catalogModel({ gated: true })])).toMatchObject({ ok: false });
        expect(handoffFor(film, film.shots[0], [catalogModel({ durations: [5] })])).toMatchObject({ ok: false, reason: expect.stringContaining('10-second') });
        const small = handoffFor(film, film.shots[0], [catalogModel({ capabilities: { inputs: { prompt: { max: 50 } } } })]);
        expect(small).toMatchObject({ ok: false, reason: expect.stringContaining('never cut short') });
    });
    test('refuses while assets are draft, no prompt exists, the prompt is stale or a take is accepted', () => {
        const draft = baseFilm();
        expect(handoffFor(draft, draft.shots[0], [catalogModel()])).toMatchObject({ ok: false });
        const locked = lockedFilm();
        expect(handoffFor(locked, locked.shots[0], [catalogModel()])).toMatchObject({ ok: false, reason: expect.stringContaining('prompt') });
        const stale = { ...film, shots: [{ ...film.shots[0], blocking: 'door right' }] };
        expect(handoffFor(stale, stale.shots[0], [catalogModel()])).toMatchObject({ ok: false, reason: expect.stringContaining('out of date') });
        const accepted = web.logFilmAttempt(film, film.prompts[0], { result: 'take-1.mp4', changed: 'first', verdict: 'accepted', checks: web.ACCEPTANCE_CHECKS });
        expect(handoffFor(accepted, accepted.shots[0], [catalogModel()])).toMatchObject({ ok: false, reason: expect.stringContaining('accepted') });
    });
});

describe('the saved copy', () => {
    const cache = () => createCache(createMemoryStorage());
    const raw = JSON.stringify(baseFilm());
    test('saves only text that parses, per account', async () => {
        const c = cache();
        expect(await saveStudio('not json', c, 'user-a')).toMatchObject({ ok: false });
        expect(await loadStudio(c, 'user-a')).toBeNull();
        expect(await saveStudio(raw, c, 'user-a')).toMatchObject({ ok: true });
        expect((await loadStudio(c, 'user-a'))?.film.name).toBe('Test film');
        expect(await loadStudio(c, 'user-b')).toBeNull();
    });
    test('needs a signed-in account', async () => {
        expect(await saveStudio(raw, cache(), undefined)).toEqual({ ok: false, error: 'Sign in to keep a studio on this phone.' });
    });
});

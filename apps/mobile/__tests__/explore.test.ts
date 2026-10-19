declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

import { ALL_CATEGORIES, categoriesOf, filterByCategory, firstModelFor, pickUp, promptHref, recentCreations } from '../src/lib/explore';
import type { CatalogModel, Job } from '../src/lib/media';
import { presetHref, type Preset } from '../src/lib/presets';

const preset = (id: string, category: string): Preset => ({
    id,
    title: id,
    category,
    modelId: 'm',
    modelName: 'M',
    prompt: 'p',
    needs: null,
    durationSeconds: null,
    credits: 3,
    isNew: false,
    previewUrl: null,
    posterUrl: null,
});

const job = (id: string, state: Job['state'], hasAsset = state === 'succeeded', at = '2026-10-19T10:00:00Z'): Job => ({
    job_id: id,
    state,
    credits: 3,
    model_id: 'kling-3',
    created_at: at,
    has_asset: hasAsset,
    label: `label ${id}`,
});

describe('Explore categories', () => {
    const list = [preset('a', 'ANIMALS'), preset('b', 'CINEMATIC'), preset('c', 'ANIMALS'), preset('d', 'OTHER')];

    test('the chips are All, then each category once in the order the server sent them', () => {
        expect(categoriesOf(list)).toEqual([ALL_CATEGORIES, 'ANIMALS', 'CINEMATIC', 'OTHER']);
        expect(categoriesOf([])).toEqual([ALL_CATEGORIES]);
    });

    test('All shows everything and a category shows only its own', () => {
        expect(filterByCategory(list, ALL_CATEGORIES)).toHaveLength(4);
        expect(filterByCategory(list, 'ANIMALS').map((p) => p.id)).toEqual(['a', 'c']);
        expect(filterByCategory(list, 'GONE')).toEqual([]);
    });
});

describe('pick up where you left off', () => {
    test('something still being made comes first', () => {
        const out = pickUp([job('new', 'succeeded'), job('busy', 'running')]);
        expect(out).toMatchObject({ kind: 'making', job: { job_id: 'busy' } });
        expect(pickUp([job('q', 'queued')])).toMatchObject({ kind: 'making' });
    });

    test('otherwise the latest finished creation', () => {
        const out = pickUp([job('failed1', 'failed'), job('done1', 'succeeded'), job('done2', 'succeeded')]);
        expect(out).toMatchObject({ kind: 'latest', job: { job_id: 'done1' } });
    });

    test('a finished job with no file, or nothing at all, gives nothing', () => {
        expect(pickUp([job('gone', 'succeeded', false)])).toBeNull();
        expect(pickUp([job('f', 'failed')])).toBeNull();
        expect(pickUp([])).toBeNull();
    });
});

describe('recent creations', () => {
    test('finished creations with a file, newest first, capped', () => {
        const jobs = [job('a', 'succeeded'), job('b', 'failed'), job('c', 'succeeded', false), job('d', 'succeeded'), job('e', 'succeeded')];
        expect(recentCreations(jobs, 2).map((j) => j.job_id)).toEqual(['a', 'd']);
        expect(recentCreations(jobs, 10).map((j) => j.job_id)).toEqual(['a', 'd', 'e']);
    });
});

describe('the prompt box', () => {
    const model = (id: string, modality: string, extra: Partial<CatalogModel> = {}) =>
        ({ id, name: id, modality, credits: 3, gated: false, durations: [], capabilities: { inputs: { prompt: { max: 1000 } } }, ...extra }) as unknown as CatalogModel;

    test('uses the first model of the kind asked for', () => {
        const catalog = [model('nano-banana', 'text-to-image'), model('veo-fast', 'text-to-video'), model('kling-3', 'text-to-video')];
        expect(firstModelFor(catalog, 'image')?.id).toBe('nano-banana');
        expect(firstModelFor(catalog, 'video')?.id).toBe('veo-fast');
    });

    test('skips a model that is gated, needs a file, or takes a topic instead of a prompt', () => {
        const catalog = [
            model('gated', 'text-to-image', { gated: true }),
            model('needs-file', 'image-to-video', { capabilities: { inputs: { prompt: {} }, media: { image: { required: true } } } }),
            model('auto-short', 'text-to-video', { capabilities: { inputs: { topic: {} } } }),
            model('ok', 'text-to-video'),
        ];
        expect(firstModelFor(catalog, 'video')?.id).toBe('ok');
        expect(firstModelFor(catalog, 'image')).toBeNull();
    });

    test('no model of that kind gives nothing', () => {
        expect(firstModelFor([model('sfx', 'text-to-audio')], 'video')).toBeNull();
        expect(firstModelFor([], 'image')).toBeNull();
    });

    test('opens Create on the model with the trimmed, capped prompt', () => {
        expect(promptHref('nano-banana', '  a red fox  ')).toEqual({ pathname: '/create/[modelId]', params: { modelId: 'nano-banana', prompt: 'a red fox' } });
        const long = promptHref('m', 'x'.repeat(5000));
        expect((long.params.prompt as string).length).toBe(4000);
    });
});

describe('a template tap', () => {
    test('opens Create on its model with the prompt, and the length when it has one', () => {
        expect(presetHref({ ...preset('a', 'X'), modelId: 'kling-3', prompt: 'orbit', durationSeconds: 10 })).toEqual({
            pathname: '/create/[modelId]',
            params: { modelId: 'kling-3', prompt: 'orbit', duration: '10' },
        });
        expect(presetHref({ ...preset('a', 'X'), modelId: 'nano-banana', prompt: 'fox' }).params).toEqual({ modelId: 'nano-banana', prompt: 'fox' });
    });
});

describe('the Explore screen', () => {
    const screen = () => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '(app)', '(tabs)', 'index.tsx'), 'utf8');

    test('starts a creation from words or from a template', () => {
        expect(screen()).toContain('router.push(promptHref(model.id, prompt))');
        expect(screen()).toContain('router.push(presetHref(p))');
    });

    test('nothing the old Home linked to became unreachable: the tabs, the chip and avatar, and the More row cover it', () => {
        const text = screen();
        // Quick edit, Projects and Chat have no tab yet, so they stay one tap from the home.
        for (const href of ['/edit', '/projects', '/chat', '/create/presets']) expect(text).toContain(`href="${href}"`);
    });
});

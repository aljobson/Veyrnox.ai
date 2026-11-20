import { PHONE_ONLY, TOOL_TASKS, isTool, requiresSource, toolGroups, toolNeeds, toolQualifiers } from '../src/lib/toolDirectory';
import type { CatalogModel } from '../src/lib/media';

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

const model = (id: string, media: Record<string, { required?: boolean }> = {}, credits = 3): CatalogModel => ({
    id, name: `Name ${id}`, modality: 'image-to-image', credits, gated: false, durations: [], capabilities: { inputs: {}, media },
});

describe('the tasks match the web /tools page', () => {
    const web = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'veyrnox', '_lib', 'tools.js'), 'utf8');
    const body = web.match(/export const TOOL_TASKS = \[([\s\S]*?)\n\];/)?.[1] ?? '';
    const theirs = [...body.matchAll(/key: '([^']+)', label: '((?:[^'\\]|\\.)*)', blurb: '((?:[^'\\]|\\.)*)', ids: \[([^\]]*)\]/g)].map((m) => ({
        key: m[1], label: m[2].replace(/\\'/g, "'"), blurb: m[3].replace(/\\'/g, "'"), ids: [...(m[4] as string).matchAll(/'([^']+)'/g)].map((x) => x[1]),
    }));
    test('same tasks, labels, blurbs, models and order', () => {
        expect(theirs.length).toBe(10);
        expect(TOOL_TASKS.map((t) => ({ key: t.key, label: t.label, blurb: t.blurb, ids: t.ids.filter((id) => !PHONE_ONLY.includes(id)) }))).toEqual(theirs);
    });
    test('no phone-only models and no Face filters task', () => {
        expect(PHONE_ONLY).toEqual([]);
        expect(TOOL_TASKS.find((t) => t.key === 'face-filters')).toBeUndefined();
    });
});

describe('tool groups', () => {
    const media = { image: { required: true } };
    test('a tool needs a required upload; a plain prompt model is not a tool', () => {
        expect(isTool(model('a', media))).toBe(true);
        expect(isTool(model('b', { image: { required: false } }))).toBe(false);
        expect(isTool(model('c'))).toBe(false);
    });
    test('input-first paths only include tools that require the chosen source', () => {
        expect(requiresSource(model('photo', { image: { required: true } }), 'image')).toBe(true);
        expect(requiresSource(model('photo', { image: { required: true } }), 'video')).toBe(false);
        expect(requiresSource(model('clip', { video: { required: true } }), 'video')).toBe(true);
    });
    test('says what a tool needs in words', () => {
        expect(toolNeeds(model('a', media))).toBe('an image');
        expect(toolNeeds(model('a', { image: { required: true }, audio: { required: true } }))).toBe('an image and audio');
        expect(toolNeeds(model('a', { image: { required: true }, video: { required: true }, audio: { required: true } }))).toBe('an image and a video and audio');
    });
    test('groups follow the table order and skip empty ones', () => {
        const g = toolGroups([model('bria-expand', media), model('topaz-upscale', media), model('plain')]);
        expect(g.map((x) => x.key)).toEqual(['upscale', 'expand']);
    });
    test('a required-upload model the table does not name still shows, under More tools', () => {
        const g = toolGroups([model('brand-new-tool', media)]);
        expect(g).toHaveLength(1);
        expect(g[0]).toMatchObject({ key: 'other', label: 'More tools' });
        expect(g[0].tools[0].id).toBe('brand-new-tool');
    });
    test('nothing in the catalog is no groups', () => expect(toolGroups([])).toEqual([]));
    // QA 4.T6 / 4.T12: Relight is a Face filter and Video Upscale a task of its own. Both are catalog rows that are
    // inactive until fal billing is verified (0356/0357, 0202), so the phone shows them only when the live catalog
    // serves them, at the catalog price. Nothing here invents a row.
    test('Video Upscale shows as its own group, at its catalog price, once the catalog serves it', () => {
        const video = { video: { required: true } };
        const g = toolGroups([model('topaz-upscale-video', video, 49)]);
        expect(g).toHaveLength(1);
        expect(g[0]).toMatchObject({ key: 'video-upscale' });
        expect(g[0].tools[0].credits).toBe(49);
    });
    test('a face model is in no Tools group, and without a catalog row there is no Video Upscale', () => {
        expect(toolGroups([model('face-relight', media, 7)]).map((x) => x.key)).not.toContain('face-filters');
        expect(toolGroups([model('topaz-upscale', media, 5)]).map((x) => x.key)).toEqual(['upscale']);
    });
});

describe('rows with the same public name are told apart from catalog data', () => {
    const named = (id: string, credits: number, presentation: Record<string, unknown> = {}, bestValue = false): CatalogModel => ({
        id, name: 'Kling 3.0 Pro I2V', modality: 'image-to-video', credits, gated: false, bestValue, durations: [5], capabilities: { inputs: {}, media: {}, presentation },
    });
    test('sound in, sound out: each row says which', () => {
        const q = toolQualifiers([named('kling-3.0-i2v', 40, { audioIncluded: true }), named('kling-3.0-i2v-kie', 29, { audioIncluded: false })]);
        expect(q.get('kling-3.0-i2v')).toBe('With sound');
        expect(q.get('kling-3.0-i2v-kie')).toBe('No sound');
    });
    test('the same output: the cheaper one says so, from its catalog price', () => {
        const q = toolQualifiers([named('a', 9), named('b', 2)]);
        expect(q.get('b')).toBe('Lower price');
        expect(q.has('a')).toBe(false);
    });
    test('the same output: a best-value row is named first', () => {
        const q = toolQualifiers([named('a', 9), named('b', 9, {}, true)]);
        expect(q.get('b')).toBe('Best value');
    });
    test('distinct names get no qualifier', () => {
        expect(toolQualifiers([model('a'), model('b')]).size).toBe(0);
    });
});

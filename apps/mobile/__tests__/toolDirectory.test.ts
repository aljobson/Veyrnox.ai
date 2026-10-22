import { TOOL_TASKS, isTool, requiresSource, toolGroups, toolNeeds } from '../src/lib/toolDirectory';
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
        expect(theirs.length).toBe(11);
        expect(TOOL_TASKS.map((t) => ({ key: t.key, label: t.label, blurb: t.blurb, ids: [...t.ids] }))).toEqual(theirs);
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
});

import { consumeCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
import en from '../src/lib/i18n/messages/en';
import type { CatalogModel } from '../src/lib/media';
import { ODDLINGS } from '../src/lib/oddlings';
import { buildStudioPrompt, type Picks } from '../src/lib/oddlingsBuilder';
import { PORTRAIT_MODEL_ID, offerFor, portraitLink, portraitModel, portraitHandoff, shortLink, shortModel, shortTopic } from '../src/lib/oddlingsHandoff';

declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
const { join } = require('path') as { join: (...p: string[]) => string };

const model = (over: Partial<CatalogModel> & { id: string }, inputs: Record<string, unknown>): CatalogModel => ({
    name: over.id, modality: 'text-to-image', credits: 4, gated: false, durations: [], capabilities: { inputs }, ...over,
});
const catalog: CatalogModel[] = [
    model({ id: 'other-image' }, { prompt: { max: 2000 } }),
    model({ id: PORTRAIT_MODEL_ID, credits: 6 }, { prompt: { max: 2000 } }),
    model({ id: 'auto-short-32s', modality: 'text-to-video', credits: 120, durations: [32] }, { topic: { max: 400 } }),
];
const picks = ODDLINGS[0].picks as Picks;

describe('which models', () => {
    test('the portrait goes to the same model as on the web, only when it is open', () => {
        expect(portraitModel(catalog)?.id).toBe(PORTRAIT_MODEL_ID);
        expect(portraitModel(catalog.map((m) => (m.id === PORTRAIT_MODEL_ID ? { ...m, gated: true } : m)))?.id).toBe('other-image');
        expect(portraitModel([])).toBeNull();
    });

    test('Auto Short is the video model that takes a topic', () => {
        expect(shortModel(catalog)?.id).toBe('auto-short-32s');
        expect(shortModel(catalog.filter((m) => m.id !== 'auto-short-32s'))).toBeNull();
    });

    test('the price shown is the catalog price', () => {
        expect(offerFor(portraitModel(catalog))?.credits).toBe(6);
        expect(offerFor(shortModel(catalog))?.credits).toBe(120 * Math.ceil(32 / 5));
        expect(offerFor(null)).toBeNull();
    });
});

describe('what is handed over', () => {
    test('the portrait link carries the full builder prompt for that model', () => {
        const link = portraitLink(portraitModel(catalog)!, picks, 'On a stage');
        expect(link.pathname).toBe('/create/[modelId]');
        expect(link.params.modelId).toBe(PORTRAIT_MODEL_ID);
        expect(link.params.prompt).toBe(buildStudioPrompt({ picks, scene: 'On a stage' }).trim());
        expect(link.params.prompt.startsWith('Portrait of an original adult character, not a real person')).toBe(true);
    });

    test('the short topic names the creator and fits the model limit', () => {
        for (const o of ODDLINGS) {
            const topic = shortTopic(o.picks as Picks, 'Walking into frame', 400);
            expect(topic.length).toBeLessThanOrEqual(400);
            expect(topic).toContain(o.name);
            expect(topic).toContain('original fictional adult');
        }
        const link = shortLink(shortModel(catalog)!, picks, '');
        expect(link.params.modelId).toBe('auto-short-32s');
        expect(link.params.prompt.length).toBeLessThanOrEqual(400);
    });

    test('a tight limit drops the look and scene before the creator', () => {
        const topic = shortTopic({ ...picks, oddling_name: 'Ada' }, 'x'.repeat(300), 120);
        expect(topic.startsWith('A vertical short starring Ada')).toBe(true);
        expect(topic.length).toBeLessThanOrEqual(120);
    });
});

describe('the card', () => {
    const src = readFileSync(join(__dirname, '..', 'src/components/oddlings/HandoffCard.tsx'), 'utf8');

    test('refuses to open Create offline, and only after the check', () => {
        expect(src.indexOf('ensureOnline()')).toBeGreaterThan(-1);
        expect(src.indexOf('ensureOnline()')).toBeLessThan(src.indexOf('router.push'));
    });

    test('shows a price on each button and sends nothing itself', () => {
        expect(src).toContain('offerFor(');
        expect(src).not.toMatch(/api\.request|\.post\(|generations/);
    });

    test('every string it asks for exists', () => {
        const catalogEn = en as Record<string, string>;
        for (const m of src.matchAll(/\b(t|plural)\(\s*'([A-Za-z0-9_.]+)'/g)) expect(m[1] === 'plural' ? `${m[2]}.other` in catalogEn : m[2] in catalogEn).toBe(true);
    });
});

describe('opening move', () => {
    test('the short topic uses the chosen move and falls back to the first', () => {
        const { MOTIONS } = require('../src/lib/oddlingsBuilder');
        expect(shortTopic(picks, '', 2000, MOTIONS[3].id)).toContain(MOTIONS[3].phrase);
        expect(shortTopic(picks, '', 2000, 'nope')).toContain(MOTIONS[0].phrase);
    });
});

test('portrait priority and eligibility match the web, including references and best value', () => {
    const image = (id: string, extra = {}) => model({ id, ...extra }, { prompt: {} });
    const ref = (id: string, media = { image: { required: true } }) => image(id, { capabilities: { inputs: { prompt: {} }, media } });
    const fixtures = [
        [image('flux-2-pro', { gated: true }), image('nano-banana-pro-grsai')],
        [image('plain'), image('best', { bestValue: true })],
        [ref('nano-banana-pro-edit'), ref('nano-banana-pro-edit-grsai')],
        [ref('nano-banana-pro-edit-grsai', { image: { required: true }, audio: { required: true } } as any), ref('nano-banana-pro-edit')],
    ];
    const { spawnSync } = require('child_process');
    const webModels = fixtures.map(list => list.map(m => ({ ...m, kind: 'image', takesPrompt: true, media: m.capabilities?.media })));
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `import {oddlingPortraitModel,buildOddlingStudioPrompt} from './app/veyrnox/_lib/oddlingStudio.js'; console.log(JSON.stringify({ids:${JSON.stringify(webModels)}.map((ms,i)=>oddlingPortraitModel(ms,{reference:i>1})?.id),prompt:buildOddlingStudioPrompt(${JSON.stringify({ picks, scene: 'Stage', referenceNote: 'Red light', hasReference: true })})}));`], { cwd: join(__dirname, '../../..'), encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    expect(run.status).toBe(0);
    const web = JSON.parse(run.stdout);
    expect(fixtures.map((list, i) => portraitModel(list, { reference: i > 1 })?.id)).toEqual(web.ids);
    expect(web.ids).toEqual(['nano-banana-pro-grsai', 'best', 'nano-banana-pro-edit-grsai', 'nano-banana-pro-edit']);
    expect(buildStudioPrompt({ picks, scene: 'Stage', referenceNote: 'Red light', hasReference: true })).toBe(web.prompt);
    const references = [{ slot: 'image', origin: 'upload', key: 'private-key' }] as const;
    const handoff = portraitHandoff({ models: fixtures[2], picks, scene: 'Stage', references, referenceNote: 'Red light' })!;
    expect(handoff.href.params.prompt).toContain('visual reference direction: Red light');
    expect(handoff.href.params.prompt).not.toContain(picks.oddling_name);
    const staged = consumeCreativeSourceHandoff(handoff.href.params.sourceHandoff, 'oddling', handoff.model.id)!;
    expect(staged).toMatchObject({ aspect: '9:16', picks, references, rightsConfirmed: false });
});

import { ODDLINGS } from '../src/lib/oddlings';
import type { CatalogModel } from '../src/lib/media';
import { MOTIONS } from '../src/lib/oddlingsBuilder';
import { ANIMATE_MODEL_ID, ANIMATE_SECONDS, animateLink, animationCredits, animationModel, animationPrompt, looksLikeWebp, startOddlingId } from '../src/lib/oddlingsAnimate';

declare const require: (id: string) => any;
declare const __dirname: string;
const { spawnSync } = require('child_process') as { spawnSync: (cmd: string, args: string[], opts: object) => { status: number | null; stdout: string; stderr: string } };
const { join } = require('path') as { join: (...p: string[]) => string };

const model = (over: Partial<CatalogModel> & { media?: Record<string, { required?: boolean }> }): CatalogModel => ({
    id: 'm', name: 'M', modality: 'text-to-video', credits: 40, gated: false, durations: [5, 10],
    capabilities: { inputs: { prompt: { max: 2000 } }, media: over.media ?? { image: { required: true } } },
    ...over,
}) as CatalogModel;

describe('animate this portrait', () => {
    test('the words match the web for every character and opening move', () => {
        const run = spawnSync(process.execPath, [join(__dirname, '..', 'scripts', 'oddlings-animate-reference.mjs')], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
        expect(run.status).toBe(0);
        const web = JSON.parse(run.stdout) as Record<string, string>;
        expect(Object.keys(web)).toHaveLength(ODDLINGS.length * (MOTIONS.length + 2));
        for (const o of ODDLINGS) {
            for (const motion of [...MOTIONS.map((m) => m.id), '', 'unknown-move']) expect(animationPrompt(o.name, motion)).toBe(web[`${o.id}|${motion}`]);
        }
    });

    test('the model is an open video model whose only required file is the image, at five seconds', () => {
        const ok = model({ id: 'a' });
        expect(animationModel([ok])?.id).toBe('a');
        expect(animationModel([model({ id: 'gated', gated: true })])).toBeNull();
        expect(animationModel([model({ id: 'img', modality: 'text-to-image' })])).toBeNull();
        expect(animationModel([model({ id: 'ten', durations: [10] })])).toBeNull();
        expect(animationModel([model({ id: 'noimage', media: { image: { required: false } } })])).toBeNull();
        expect(animationModel([model({ id: 'two', media: { image: { required: true }, video: { required: true } } })])).toBeNull();
        expect(animationModel([model({ id: 'two', media: { image: { required: true }, endImage: { required: false } } })])?.id).toBe('two');
    });

    test('the web preferred model wins when open, otherwise the first that fits', () => {
        expect(animationModel([model({ id: 'a' }), model({ id: ANIMATE_MODEL_ID })])?.id).toBe(ANIMATE_MODEL_ID);
        expect(animationModel([model({ id: 'a' }), model({ id: 'b' })])?.id).toBe('a');
        expect(animationModel([model({ id: ANIMATE_MODEL_ID, gated: true }), model({ id: 'b' })])?.id).toBe('b');
    });

    test('the price is the catalog price for five seconds', () => {
        expect(ANIMATE_SECONDS).toBe(5);
        expect(animationCredits(model({ credits: 40 }))).toBe(40);
    });

    test('the link carries the words, five seconds and a cast id, and nothing for anyone else', () => {
        const o = ODDLINGS[3];
        const link = animateLink(model({ id: 'a' }), o.id, MOTIONS[2].id)!;
        expect(link.pathname).toBe('/create/[modelId]');
        expect(link.params).toEqual({ modelId: 'a', prompt: animationPrompt(o.name, MOTIONS[2].id), duration: '5', startOddling: o.id });
        expect(animateLink(model({ id: 'a' }), 'not-a-character')).toBeNull();
    });

    test('Create accepts only a cast id for the start portrait', () => {
        expect(startOddlingId(ODDLINGS[0].id)).toBe(ODDLINGS[0].id);
        for (const bad of [undefined, '', '../etc/passwd', 'https://example.com/a.webp', ['x'], 5]) expect(startOddlingId(bad)).toBeNull();
    });

    test('only a WebP of sane size is taken as the portrait', () => {
        const webp = new Uint8Array(40);
        webp.set([0x52, 0x49, 0x46, 0x46], 0);
        webp.set([0x57, 0x45, 0x42, 0x50], 8);
        expect(looksLikeWebp(webp)).toBe(true);
        webp.set([0x89, 0x50, 0x4e, 0x47], 0);
        expect(looksLikeWebp(webp)).toBe(false);
        expect(looksLikeWebp(new Uint8Array(5))).toBe(false);
    });
});

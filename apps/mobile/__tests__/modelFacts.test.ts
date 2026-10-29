import { modelFacts, outputDurationLabel, priceUnit, sourceDurationLimit } from '../src/lib/modelFacts';
import { estimateCredits, kindOf, type CatalogModel } from '../src/lib/media';
import { chooseLocale } from '../src/lib/i18n';
declare const require: (id: string) => any;
declare const __dirname: string;
const { spawnSync } = require('child_process');
const { resolve } = require('path');
const model = (id: string, modality: string, capabilities: CatalogModel['capabilities'], durations: number[] = []): CatalogModel => ({
    id, name: id, modality, capabilities, durations, credits: 7, gated: false,
});
const fixtures = [
    model('video', 'text-to-video', { inputs: { prompt: {} } }, [5, 10]),
    model('mapped', 'image-to-video', { presentation: { durationByOption: { '5': '6', '10': '12s' } }, media: { image: { required: true } } }, [5, 10]),
    model('fixed', 'text-to-video', { presentation: { fixedDurationLabel: '8s' } }, [5]),
    model('latentsync', 'video-to-video', { media: { video: { required: true, maxSeconds: 60 }, audio: { required: true, maxSeconds: 30 } } }, [5]),
    model('speech', 'text-to-speech', { kind: 'speech', inputs: { prompt: { max: 300 } } }),
    model('track', 'text-to-audio', { inputs: { duration: { min: 10, max: 120, default: 30 }, prompt: {} } }),
    model('stems', 'audio-to-audio', { outputStems: ['Vocals', 'Drums'], media: { audio: { required: true, maxSeconds: 90 } } }),
    model('image', 'text-to-image', { inputs: { prompt: {}, aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] }, style_name: { type: 'enum', values: ['film', 'photo'] } }, media: { endImage: { required: false } } }),
];
// Literal rows follow web modelPages.js:81-106: Mode, video lengths (83-87), audio
// duration (89-93), stems (94), prompt (95), media (96-100), then enums (102-106).
const expected = [
    [['Mode', 'text to video'], ['Clip lengths', '5 s, 10 s'], ['Prompt', 'Text prompt']],
    [['Mode', 'image to video'], ['Clip lengths', '6 s, 12 s'], ['Image input', 'Required']],
    [['Mode', 'text to video'], ['Clip lengths', '8 s']],
    [['Mode', 'video to video'], ['Clip lengths', 'Follows source duration (up to 30 s)'], ['Video input', 'Required, up to 60 s'], ['Audio input', 'Required, up to 30 s']],
    [['Mode', 'text to speech'], ['Output duration', 'Depends on text and voice'], ['Prompt', 'Text prompt']],
    [['Mode', 'text to audio'], ['Output duration', '10–120 s (30 s default)'], ['Prompt', 'Text prompt']],
    [['Mode', 'audio to audio'], ['Output stems', 'Vocals, Drums'], ['Audio input', 'Required, up to 90 s']],
    [['Mode', 'text to image'], ['Prompt', 'Text prompt'], ['EndImage input', 'Optional'], ['Aspect ratio', '1:1, 16:9'], ['Style name', 'film, photo']],
];
test.each(fixtures.map((m, i) => [m.id, m, expected[i]] as const))('%s facts follow the web row order and wording', (_, m, rows) => {
    expect(modelFacts(m)).toEqual(rows.map(([label, value]) => ({ label, value })));
});
test('all seven explicit mode keys and media labels resolve in Spanish', () => {
    chooseLocale('es');
    try {
        const modes = ['text-to-image', 'text-to-video', 'image-to-video', 'text-to-audio', 'image-to-image', 'video-to-video', 'audio-to-audio'];
        for (const modality of modes) {
            const facts = modelFacts(model('mode', modality, { media: { image: {}, video: {}, audio: {} } }));
            expect(facts[0].value).not.toBe(modality.replace(/-/g, ' '));
            expect(JSON.stringify(facts)).not.toMatch(/modelPage\.|model\.media\./);
            expect(facts).toHaveLength(4);
        }
    } finally { chooseLocale('en'); }
});
test('source limits, output labels and price units equal the actual web helpers', () => {
    const extra = [
        model('range', 'audio', { inputs: { duration: { min: 1, max: 20 } } }),
        model('fixedAudio', 'audio', { presentation: { fixedDurationLabel: '15s' } }),
        model('speechNoMax', 'speech', { kind: 'speech' }),
        model('plain', 'audio', null),
        model('fallback', 'video', null),
        model('zero', 'audio', { media: { audio: { required: true, maxSeconds: 0 }, video: { required: true, maxSeconds: 20 } } }),
        model('optional', 'video', { media: { audio: { required: false, maxSeconds: 20 } } }),
        model('emptyMap', 'video', { presentation: { durationByOption: { '5': '' } }, media: { audio: { required: true, maxSeconds: 20 } } }),
    ];
    const all = [...fixtures, ...extra];
    const script = `import { sourceDurationLimit, modelPriceUnit } from './app/veyrnox/_lib/modelPricing.js';
        import { outputDurationLabel } from './app/veyrnox/_lib/chatMedia.js';
        const models = ${JSON.stringify(all.map(m => ({ ...m, kind: kindOf(m.modality) })))};
        console.log(JSON.stringify(models.map(m => [sourceDurationLimit(m), modelPriceUnit(m), [undefined,5,10,99].map(s => outputDurationLabel(m,s))])));`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: resolve(__dirname, '../../..'), encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' });
    expect(all.map(m => [sourceDurationLimit(m), priceUnit(m), [undefined, 5, 10, 99].map(s => outputDurationLabel(m, s))])).toEqual(JSON.parse(run.stdout));
});

test('frozen library work order duration cases preserve existing model facts', () => {
    const durationRow = (m: CatalogModel) => modelFacts(m).find(f => f.label === 'Output duration');
    expect(modelFacts(model('source-eight', 'video-to-video', { media: { video: { required: true, maxSeconds: 8 } } }, [5])))
        .toContainEqual({ label: 'Clip lengths', value: 'Follows source duration (up to 8 s)' });
    expect(durationRow(model('range', 'text-to-audio', { inputs: { duration: { min: 5, max: 60, default: 30 } } })))
        .toEqual({ label: 'Output duration', value: '5–60 s (30 s default)' });
    const fixed = model('fixed-ten', 'text-to-audio', { presentation: { fixedDurationLabel: '10s' }, media: { audio: { required: true, maxSeconds: 8 } } });
    expect(durationRow(fixed)).toEqual({ label: 'Output duration', value: '10 s' });
    expect(sourceDurationLimit(fixed)).toBeNull();
    expect(durationRow(model('speech', 'text-to-audio', { kind: 'speech' })))
        .toEqual({ label: 'Output duration', value: 'Depends on text and voice' });
    expect(durationRow(model('plain', 'text-to-audio', {}))).toBeUndefined();
});

test('actual reference and source-driven catalog models retain web/mobile price and duration parity', () => {
    const script = `import { toPublicModels } from './lib/publicCatalog.js';
        import { sourceDurationLimit, modelPriceUnit } from './app/veyrnox/_lib/modelPricing.js';
        import { modelFacts } from './app/veyrnox/_lib/modelPages.js';
        const endpoints = ['fal-ai/kling-video/o1/video-to-video/reference', 'fal-ai/latentsync', 'fal-ai/mmaudio-v2', 'fal-ai/topaz/upscale/video', 'fal-ai/kling-video/ai-avatar/v2/standard'];
        const models = toPublicModels(endpoints.map((endpoint, i) => ({ id: String(i), name: endpoint, provider_endpoint: endpoint, modality: 'video-to-video', credits_5s: i === 0 ? 47 : 7 })));
        const withoutPresentation = m => ({ ...m, capabilities: { ...m.capabilities, presentation: undefined } });
        models.push(withoutPresentation(models[0]), withoutPresentation(models[2]));
        console.log(JSON.stringify(models.map(model => ({ model, limit: sourceDurationLimit(model), unit: modelPriceUnit(model), clipLength: modelFacts({ ...model, kind: 'video' }).find(f => f.label === 'Clip lengths').value }))));`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: resolve(__dirname, '../../..'), encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' });
    const rows: { model: CatalogModel; limit: number | null; unit: string; clipLength: string }[] = JSON.parse(run.stdout);
    expect(rows.map(row => row.limit)).toEqual([null, 40, null, 10, 10, null, 8]);
    expect(rows.map(row => row.unit)).toEqual([
        'per 5 s clip; 10 s costs double.', 'per generation (source up to 40 s).', 'per 8 s clip.',
        'per generation (source up to 10 s).', 'per generation (source up to 10 s).',
        'per 5 s clip; 10 s costs double.', 'per generation (source up to 8 s).',
    ]);
    for (const row of rows) {
        expect(sourceDurationLimit(row.model)).toBe(row.limit);
        expect(priceUnit(row.model)).toBe(row.unit);
        expect(modelFacts(row.model)).toContainEqual({ label: 'Clip lengths', value: row.clipLength });
    }
    for (const row of [rows[0], rows[5]]) {
        expect(row.clipLength).toBe('5 s, 10 s');
        expect(estimateCredits(row.model, 5)).toBe(47);
        expect(estimateCredits(row.model, 10)).toBe(94);
    }
});

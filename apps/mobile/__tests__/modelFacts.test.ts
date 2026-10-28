import { modelFacts, outputDurationLabel, priceUnit, sourceDurationLimit } from '../src/lib/modelFacts';
import { kindOf, type CatalogModel } from '../src/lib/media';
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
    model('latentsync', 'video-to-video', { media: { video: { required: true, maxSeconds: 60 }, audio: { required: true, maxSeconds: 30 } } }, [5, 10]),
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

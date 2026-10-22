declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

import { isPosterUrl, nearestAspect, parseRatio, readTemplate, templateParams } from '../src/lib/templateHandoff';
import { parsePresets, presetHref } from '../src/lib/presets';

const HOSTS = ['veyrnox.ai'];

describe('reading a ratio', () => {
    test('the feed writes "w / h", a model writes "w:h"; both read as width over height', () => {
        expect(parseRatio('9 / 16')).toBeCloseTo(0.5625);
        expect(parseRatio('406 / 720')).toBeCloseTo(0.5639, 3);
        expect(parseRatio('16:9')).toBeCloseTo(1.7778, 3);
        expect(parseRatio(' 1 / 1 ')).toBe(1);
    });

    test('anything else is no ratio', () => {
        for (const bad of ['', 'auto', '0 / 5', '5 / 0', '16-9', null, undefined, 4, '9 / 16 / 2']) expect(parseRatio(bad)).toBeNull();
    });
});

describe('the nearest aspect a model offers', () => {
    const video = ['16:9', '9:16', '1:1', '4:3'];

    test('a vertical template opens vertical, a wide one wide', () => {
        expect(nearestAspect(parseRatio('9 / 16'), video)).toBe('9:16');
        expect(nearestAspect(parseRatio('406 / 720'), video)).toBe('9:16');
        expect(nearestAspect(parseRatio('720 / 406'), video)).toBe('16:9');
        expect(nearestAspect(parseRatio('1 / 1'), video)).toBe('1:1');
    });

    test('a shape the model lacks takes the closest it has', () => {
        expect(nearestAspect(parseRatio('4 / 5'), video)).toBe('1:1');
        expect(nearestAspect(parseRatio('1 / 2'), ['16:9', '9:16'])).toBe('9:16');
    });

    test('values that are not ratios are skipped, and nothing to match gives null', () => {
        expect(nearestAspect(parseRatio('9 / 16'), ['auto', '16:9', '9:16'])).toBe('9:16');
        expect(nearestAspect(parseRatio('9 / 16'), ['auto'])).toBeNull();
        expect(nearestAspect(parseRatio('9 / 16'), [])).toBeNull();
        expect(nearestAspect(null, video)).toBeNull();
    });
});

describe('what travels in the link, and what is read back', () => {
    const preset = { title: 'Wild Ride', needs: 'A clear starting photo', posterUrl: 'https://veyrnox.ai/p/wild.jpg', previewAspect: '406 / 720' };

    test('a template sends its name, need, shape and picture; a bare one only its name', () => {
        expect(templateParams(preset)).toEqual({ tpl: 'Wild Ride', tneeds: 'A clear starting photo', tratio: '406 / 720', tposter: 'https://veyrnox.ai/p/wild.jpg' });
        expect(templateParams({ title: 'T', needs: null, posterUrl: null })).toEqual({ tpl: 'T' });
    });

    test('what was sent reads back the same', () => {
        const read = readTemplate(templateParams(preset), HOSTS);
        expect(read).toMatchObject({ title: 'Wild Ride', needs: 'A clear starting photo', poster: 'https://veyrnox.ai/p/wild.jpg' });
        expect(read?.ratio).toBeCloseTo(0.5639, 3);
    });

    test('a link without a name is not a template', () => {
        expect(readTemplate({}, HOSTS)).toBeNull();
        expect(readTemplate({ tpl: '  ' }, HOSTS)).toBeNull();
    });

    test('long text is cut, repeated parameters are ignored', () => {
        const read = readTemplate({ tpl: 'x'.repeat(500), tneeds: 'y'.repeat(900) }, HOSTS);
        expect(read?.title).toHaveLength(80);
        expect(read?.needs).toHaveLength(200);
        expect(readTemplate({ tpl: ['a', 'b'] }, HOSTS)).toBeNull();
    });

    test('a picture only from our own host over https', () => {
        expect(isPosterUrl('https://veyrnox.ai/a.jpg', HOSTS)).toBe(true);
        for (const bad of ['http://veyrnox.ai/a.jpg', 'https://evil.example/a.jpg', 'https://veyrnox.ai.evil.example/a.jpg', 'javascript:alert(1)', 'not a url', `https://veyrnox.ai/${'a'.repeat(400)}`]) expect(isPosterUrl(bad, HOSTS)).toBe(false);
        expect(readTemplate({ tpl: 'T', tposter: 'https://evil.example/a.jpg' }, HOSTS)?.poster).toBeNull();
    });
});

describe('a template tap from the feed', () => {
    const feed = {
        presets: [{ id: 'w', title: 'Wild Ride', category: 'VFX', modelId: 'kling-3.0-i2v', modelName: 'Kling 3.0', modality: 'image-to-video', prompt: 'a car spins', needs: 'A clear photo', durationSeconds: 10, credits: 20, posterUrl: 'https://veyrnox.ai/w.jpg', previewAspect: '406 / 720' }],
    };

    test('the feed keeps the template shape, and the link carries it into Create', () => {
        const [p] = parsePresets(feed);
        expect(p.previewAspect).toBe('406 / 720');
        expect(presetHref(p).params).toEqual({ modelId: 'kling-3.0-i2v', prompt: 'a car spins', duration: '10', tpl: 'Wild Ride', tneeds: 'A clear photo', tratio: '406 / 720', tposter: 'https://veyrnox.ai/w.jpg' });
    });
});

describe('where it shows on Create', () => {
    const screen = read('app', '(app)', 'create', '[modelId].tsx');

    test('Create reads the template, opens in its nearest shape and shows the banner and the photo hint', () => {
        expect(screen).toContain('readTemplate(');
        expect(screen).toContain('nearestAspect(template?.ratio ?? null, o.aspects)');
        expect(screen).toContain('<TemplateBanner');
        expect(screen).toMatch(/hint=\{s\.slot === 'image' && template\?\.needs/);
    });
});

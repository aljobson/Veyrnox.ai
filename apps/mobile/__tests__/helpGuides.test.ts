import { HELP_GUIDES } from '../src/lib/helpGuidesData';
import { guideById, guideDestination, presentGuide } from '../src/lib/helpGuides';
import en from '../src/lib/i18n/messages/en/helpGuides';

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const say = (key: string): string => (en as Record<string, string>)[key];

describe('generated guide content stays identical to the web source', () => {
    test('all titles, summaries, ordered steps and links match, before mobile overrides', () => {
        const source = read('../../app/veyrnox/_lib/guides.js')
            .replace('export const GUIDES', 'const GUIDES')
            .replace('export function guideById', 'function guideById');
        const web = new Function(`${source}\nreturn GUIDES;`)();
        expect(web).toHaveLength(5);
        expect(HELP_GUIDES.map(g => ({
            id: g.id, title: say(g.title), summary: say(g.summary),
            steps: g.steps.map(s => ({ title: say(s.title), body: say(s.body) })),
            links: g.links.map(l => ({ label: say(l.label), href: l.href })),
        }))).toEqual(web);
    });

    test('the generator is reproducible, including the English area', () => {
        const { execFileSync } = require('child_process');
        expect(() => execFileSync('node', ['scripts/sync-help-guides.mjs', '--check'], { cwd: root })).not.toThrow();
    });
});

describe('phone presentation is separate from shared guide content', () => {
    test('Credits describes native store purchase, with no Stripe checkout', () => {
        const guide = guideById('credits')!;
        const shown = presentGuide(guide, say);
        expect(shown.steps[2].body).toMatch(/App Store.*Google Play/);
        expect(shown.steps[2].body).not.toContain('Stripe');
        expect(say(guide.steps[2].body)).toContain('Stripe');
    });

    test('Library favourites belong to this phone, not the browser', () => {
        const guide = guideById('library')!;
        expect(presentGuide(guide, say).steps[2].body).toContain('this phone');
        expect(presentGuide(guide, say).steps[2].body).not.toContain('browser');
        expect(say(guide.steps[2].body)).toContain('browser');
    });

    test('Create does not tell phone readers to use a right-hand model list', () => {
        expect(presentGuide(guideById('first-generation')!, say).steps[1].body).not.toContain('right');
    });

    test('unknown or missing IDs have no guide', () => {
        for (const id of [undefined, '', 'missing', 'constructor', '../credits']) expect(guideById(id)).toBeNull();
    });
});

describe('guide destinations', () => {
    test.each([
        ['/app/create', '/create'], ['/pricing', '/pricing'], ['/presets', '/create/presets'],
        ['/tools', '/create/tools'], ['/app/library', '/library'], ['/app/credits', '/credits'],
    ])('%s opens the existing phone screen %s', (href, route) => {
        expect(guideDestination(href)).toEqual({ kind: 'native', href: route });
        const base = `src/app/(app)`;
        expect(fs.existsSync(path.join(root, `${base}/${route}.tsx`)) ||
            fs.existsSync(path.join(root, `${base}/(tabs)/${route}.tsx`))).toBe(true);
    });

    test.each(['/legal/aup', '/legal/refund', '/guides/future-guide'])('%s falls back to the public page', href => {
        expect(guideDestination(href)).toEqual({ kind: 'web', href: `https://veyrnox.ai${href}` });
    });
});

describe('Help guide entry and screens', () => {
    test('All guides returns through history, replacing the detail when there is no history', () => {
        const detail = read('src/app/(app)/guides/[id].tsx');
        expect(detail).toContain('onPress={allGuides}');
        expect(detail).toContain('if (router.canGoBack()) router.back();');
        expect(detail).toContain("else router.replace('/guides');");
        expect(detail).not.toContain('<Link href="/guides"');
        expect(detail).not.toContain("router.push('/guides')");
    });

    test('Help opens the list and the list opens a detail with the selected ID', () => {
        expect(read('src/app/(app)/help.tsx')).toContain('href="/guides"');
        const list = read('src/app/(app)/guides/index.tsx');
        expect(list).toContain('HELP_GUIDES.map');
        expect(list).toContain("pathname: '/guides/[id]'");
        expect(list).toContain('params: { id: guide.id }');
    });

    test('details render ordered steps and links, with quiet unknown-ID and browser failure states', () => {
        const detail = read('src/app/(app)/guides/[id].tsx');
        expect(detail).toContain('guide.steps.map');
        expect(detail).toContain('guide.links.map');
        expect(detail).toContain("t('helpGuides.step'");
        expect(detail).toContain("t('helpGuides.unavailable')");
        expect(detail).toContain('accessibilityRole="header"');
        expect(detail).toContain('touchTarget');
        expect(detail).toContain('router.push(destination.href)');
        expect(detail).toContain('await WebBrowser.openBrowserAsync(destination.href)');
        expect(detail).toContain('catch');
    });
});

import { MOBILE_FEATURES, WEB_INVENTORY_EXCLUSIONS, WEB_ROUTE_DISPOSITIONS, audioFeatureIds, directoryFeatures, featureHref, menuFeatures, searchableFeatures } from '../src/lib/featureRegistry';
import { FILM_STUDIO_ENABLED } from '../src/lib/filmStudioSwitch';
import en from '../src/lib/i18n/messages/en';

declare const require: (id: string) => any;
declare const __dirname: string;

const fs = require('fs') as { existsSync: (path: string) => boolean; readFileSync: (path: string, encoding: 'utf8') => string };
const path = require('path') as { join: (...parts: string[]) => string };
const ROOT = path.join(__dirname, '..', '..', '..');
const MOBILE_APP = path.join(ROOT, 'apps', 'mobile', 'src', 'app');

const nativeRouteExists = (href: string): boolean => {
    if (href === '/') return fs.existsSync(path.join(MOBILE_APP, '(app)', '(tabs)', 'index.tsx'));
    const bare = href.replace(/^\//, '');
    const parts = bare.split('/');
    const dynamic = parts.length > 1 ? path.join(MOBILE_APP, '(app)', ...parts.slice(0, -1), '[slug].tsx') : '';
    return [
        path.join(MOBILE_APP, `${bare}.tsx`),
        path.join(MOBILE_APP, bare, 'index.tsx'),
        path.join(MOBILE_APP, '(app)', `${bare}.tsx`),
        path.join(MOBILE_APP, '(app)', bare, 'index.tsx'),
        path.join(MOBILE_APP, '(app)', '(tabs)', `${bare}.tsx`),
        dynamic,
    ].some((candidate) => candidate.length > 0 && fs.existsSync(candidate));
};

const generatedWebRoutes = (): string[] => {
    const source = fs.readFileSync(path.join(ROOT, 'lib', 'generatedProductInventory.js'), 'utf8');
    return [...source.matchAll(/"route": "([^"]+)"/g)].map((match) => match[1]);
};

const studioWebRoutes = (): string[] => {
    const source = fs.readFileSync(path.join(ROOT, 'app', 'veyrnox', '_lib', 'studioNavigation.js'), 'utf8').split('export const STUDIO_HOME')[0];
    return [...source.matchAll(/href: '([^']+)'/g)].map((match) => match[1]);
};

describe('mobile feature registry', () => {
    test('owns unique feature ids, routes, menu placement, Audio groups and first-goal targets', () => {
        expect(new Set(MOBILE_FEATURES.map((feature) => feature.id)).size).toBe(MOBILE_FEATURES.length);
        expect(menuFeatures('tools').map((feature) => feature.id)).toEqual(['create', 'audio', 'smartCut', 'editor', 'publish', 'cinema']);
        expect(menuFeatures('assets').map((feature) => feature.id)).toEqual(['library', 'brandKit', 'credits', 'chat']);
        expect(menuFeatures('footer').map((feature) => feature.id)).toEqual(['help']);
        expect(audioFeatureIds('studios')).toEqual(['music', 'speech', 'dialogue']);
        expect(audioFeatureIds('performance')).toEqual(['lipSync', 'dubbing', 'talkingPhoto', 'singingPhoto']);
        expect(featureHref('editor')).toBe('/editor');
        expect(featureHref('publish')).toBe('/publish');
    });

    test('uses the same availability rule for search and the feature directory', () => {
        const off = searchableFeatures({ filmStudio: false, musicAvailable: true });
        const on = searchableFeatures({ filmStudio: true, musicAvailable: true });
        expect(off.some((feature) => feature.id === 'film')).toBe(false);
        expect(on.some((feature) => feature.id === 'film')).toBe(true);
        const musicOff = searchableFeatures({ filmStudio: true, musicAvailable: false });
        expect(musicOff.some((feature) => feature.id === 'yourMusic')).toBe(false);
        expect(musicOff.some((feature) => feature.id === 'music')).toBe(false);
        expect(off.find((feature) => feature.id === 'editor')?.keywords).toContain('studio');
        expect(off.find((feature) => feature.id === 'tools')?.keywords).not.toContain('face filters');
    });

    test('every searchable feature has translated copy and a real native route', () => {
        const catalog = en as Record<string, string>;
        for (const feature of MOBILE_FEATURES) {
            if (feature.keywords) {
                expect({ id: feature.id, key: feature.titleKey, value: catalog[feature.titleKey] }).toEqual({ id: feature.id, key: feature.titleKey, value: expect.any(String) });
            }
            expect({ id: feature.id, href: feature.href, exists: nativeRouteExists(feature.href) }).toEqual({ id: feature.id, href: feature.href, exists: true });
        }
    });

    test('accounts for every generated web route by exact disposition or reviewed exclusion', () => {
        const inventory = generatedWebRoutes();
        const dispositions = new Map(WEB_ROUTE_DISPOSITIONS.map((item) => [item.webHref, item]));
        const exclusions = new Map(WEB_INVENTORY_EXCLUSIONS.map((item) => [item.webHref, item.reason]));
        expect(WEB_INVENTORY_EXCLUSIONS.every((item) => item.reason.trim().length > 0)).toBe(true);
        expect(inventory.filter((route) => !dispositions.has(route) && !exclusions.has(route))).toEqual([]);
        expect(inventory.filter((route) => dispositions.has(route) && exclusions.has(route))).toEqual([]);
        expect([...exclusions.keys()].filter((route) => !inventory.includes(route))).toEqual([]);
        expect(dispositions.get('/presets/[id]')?.featureId).toBe('templates');
        expect(dispositions.get('/music/tracks/[slug]')?.featureId).toBe('musicDiscover');
        expect(dispositions.get('/app/music/workspaces')).toEqual(expect.objectContaining({ status: 'gap', featureId: 'musicWorkspaces' }));
        expect(dispositions.get('/app/publish/plan')).toEqual(expect.objectContaining({ status: 'gap', featureId: 'publishPlan' }));
    });

    test('gives every native feature a non-search entry point or a recorded disposition reason', () => {
        const directory = new Set(directoryFeatures({ filmStudio: true, musicAvailable: true }).map((feature) => feature.id));
        const dispositions = new Map(WEB_ROUTE_DISPOSITIONS.map((item) => [item.featureId, item]));
        const orphaned = MOBILE_FEATURES.filter((feature) => {
            const visible = directory.has(feature.id) || Boolean(feature.menu || feature.audio || feature.entryPoint);
            const disposition = dispositions.get(feature.id);
            const recorded = disposition && disposition.status !== 'native' && Boolean(disposition.reason);
            return !visible && !recorded;
        }).map((feature) => feature.id);
        expect(orphaned).toEqual([]);
        const studioSource = fs.readFileSync(path.join(MOBILE_APP, '(app)', '(tabs)', 'editor.tsx'), 'utf8');
        const publishSource = fs.readFileSync(path.join(MOBILE_APP, '(app)', '(tabs)', 'publish.tsx'), 'utf8');
        for (const feature of MOBILE_FEATURES.filter((item) => item.entryPoint)) {
            const source = feature.entryPoint === 'studio' ? studioSource : publishSource;
            const claim = feature.entryPoint === 'studio' ? `mobileFeature('${feature.id}')` : `path: '${feature.href}'`;
            expect({ id: feature.id, entryPoint: feature.entryPoint, rendered: source.includes(claim) }).toEqual({ id: feature.id, entryPoint: feature.entryPoint, rendered: true });
        }
        expect(fs.existsSync(path.join(ROOT, 'apps', 'mobile', 'src', 'app', '(app)', '(tabs)', 'editor.tsx'))).toBe(true);
        expect(featureHref('editor')).toBe('/editor');
    });

    test('maps every declared web Studio destination by exact href, including duplicate and missing keys', () => {
        const dispositions = new Map(WEB_ROUTE_DISPOSITIONS.map((item) => [item.webHref, item]));
        expect(studioWebRoutes().filter((route) => !dispositions.has(route))).toEqual([]);
        expect(dispositions.get('/app/music')?.featureId).toBe('yourMusic');
        expect(dispositions.get('/app/dialogue')?.featureId).toBe('dialogue');
        expect(dispositions.get('/mcp')?.featureId).toBe('mcp');
        expect(dispositions.get('/guides')?.featureId).toBe('guides');
        expect(dispositions.get('/app/film-studio')).toEqual(expect.objectContaining({ status: FILM_STUDIO_ENABLED ? 'native' : 'build-time', featureId: 'film' }));
    });
});

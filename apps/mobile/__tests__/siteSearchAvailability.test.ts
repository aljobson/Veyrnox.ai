import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screenEntries } from '../src/lib/siteSearch';

const title = (key: string): string => key;

test('server-backed Music search follows the live capability while local studios remain discoverable', () => {
    const off = screenEntries(title, { musicAvailable: false }).map((entry) => entry.href);
    const on = screenEntries(title, { musicAvailable: true }).map((entry) => entry.href);

    for (const href of ['/music', '/music/create', '/music/discover', '/music/playlists']) {
        expect(off).not.toContain(href);
        expect(on).toContain(href);
    }
    for (const href of ['/beats', '/instruments']) {
        expect(off).toContain(href);
        expect(on).toContain(href);
    }
});

test('registry screens win duplicate creative-feature hrefs and search hrefs stay unique', () => {
    const entries = screenEntries(title, { musicAvailable: true });
    const hrefs = entries.map((entry) => entry.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of ['/features/lip-sync', '/features/video-dubbing', '/features/ai-talking-photo-generator', '/features/singing-photo']) {
        const matches = entries.filter((entry) => entry.href === href);
        expect(matches).toHaveLength(1);
        expect(matches[0].id).toMatch(/^screen:/);
    }
});

test('the Search screen passes the live Music probe into screen entry construction', () => {
    const source = readFileSync(resolve(__dirname, '../src/app/(app)/search.tsx'), 'utf8');
    expect(source).toContain('const musicAvailable = useMusicAvailable()');
    expect(source).toContain('{ musicAvailable }');
    expect(source).toContain('[models, musicAvailable]');
});

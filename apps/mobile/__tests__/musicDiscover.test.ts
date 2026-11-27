import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DISCOVER_SEEDS, buildSamplePrompt } from '../src/lib/music/discoverSeeds';
import enPlaylists from '../src/lib/i18n/messages/en/musicPlaylists';
import enDiscover from '../src/lib/i18n/messages/en/musicDiscover';
import { CATALOGS, LOCALE_CODES, createTranslator } from '../src/lib/i18n';
const source = readFileSync(resolve(__dirname, '../../../lib/musicDiscover.js'), 'utf8').replace(/export /g, '');
// The web module is pure and import-free. Evaluate this repo file only; never import it in the app bundle.
const web = new Function(`${source}; return { seeds: MUSIC_DISCOVER_LISTED_BEATS, prompt: buildMusicSamplePrompt };`)();
test('all listed seeds match every copied web field, including recipes', () => {
    expect(DISCOVER_SEEDS).toHaveLength(web.seeds.length);
    expect(DISCOVER_SEEDS).toEqual(web.seeds.map((seed: Record<string, unknown>) => Object.fromEntries(Object.keys(DISCOVER_SEEDS[0]).map(key => [key, seed[key]]))));
});
test('prompt equals default mix output, bounded at 500 characters', () => {
    for (const seed of DISCOVER_SEEDS) for (const direction of ['', '  Gentle piano  ', 'x'.repeat(900)]) {
        expect(buildSamplePrompt(seed, direction)).toBe(web.prompt(seed, direction).slice(0, 500));
        expect(buildSamplePrompt(seed, direction).length).toBeLessThanOrEqual(500);
        expect(buildSamplePrompt(seed, direction)).not.toContain('Mix plan:');
    }
});
test.each(LOCALE_CODES)('%s has all new keys with exact placeholders', locale => {
    const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const [key, english] of Object.entries({ ...enPlaylists, ...enDiscover })) {
        if (key.endsWith('.one') && !new Intl.PluralRules(locale).resolvedOptions().pluralCategories.includes('one')) continue;
        const translated = CATALOGS[locale]![key]; expect(translated?.trim()).toBeTruthy(); expect(slots(translated!)).toEqual(slots(english));
    }
});
test('playlist and compass assets are distinct registered 96px PNGs', () => {
    const icons = readFileSync(resolve(__dirname, '../src/lib/menuIcons.ts'), 'utf8');
    const existing = [...icons.matchAll(/assets\/icons\/([\w-]+\.png)/g)].map(match => match[1]);
    for (const name of ['playlist.png', 'compass.png']) {
        expect(existing).toContain(name);
        const png = readFileSync(resolve(__dirname, '../assets/icons', name));
        expect(png.readUInt32BE(16)).toBe(96); expect(png.readUInt32BE(20)).toBe(96);
        for (const other of existing.filter(n => n !== name)) expect(png.equals(readFileSync(resolve(__dirname, '../assets/icons', other)))).toBe(false);
    }
});

test.each(LOCALE_CODES)('%s uses its plural category for unavailable-song cleanup', locale => {
    const tr = createTranslator(locale, CATALOGS), rules = new Intl.PluralRules(locale);
    for (const count of [0, 1, 2, 3, 5, 11, 21, 100, 1_000_000]) {
        const key = `musicPlaylists.removeUnavailable.${rules.select(count)}`;
        expect(CATALOGS[locale]![key]).toBeDefined();
        expect(tr.plural('musicPlaylists.removeUnavailable', count)).toBe(tr.t(key, { count }));
    }
});

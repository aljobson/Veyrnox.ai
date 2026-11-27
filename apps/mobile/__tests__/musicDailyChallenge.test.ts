import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCurrentMusicDailyChallenge, isMusicDailyChallenge } from '../src/lib/music/dailyChallenge';
import { APP_CATALOGS } from '../src/lib/i18n/catalogs';
import musicDailyChallengeByLocale from '../src/lib/i18n/messages/musicDailyChallenge';
import { resolveMusicCreateHandoff } from '../src/lib/music/createHandoff';
import { entitlements, input } from './fixtures/musicCreate';

const challenge = {
    catalog_version: 'v1' as const,
    id: 'v1:2026-11-24:glass-after-rain',
    date: '2026-11-24',
    reset_at: '2026-11-25T00:00:00.000Z',
    title_key: 'music.dailyChallenge.prompt.glass-after-rain.title',
    prompt_key: 'music.dailyChallenge.prompt.glass-after-rain.prompt',
    no_reward: true as const,
};

test('mobile accepts only the bundled v1 catalog and exact key pair', () => {
    expect(isMusicDailyChallenge(challenge)).toBe(true);
    expect(isMusicDailyChallenge({ ...challenge, catalog_version: 'v2' })).toBe(false);
    expect(isMusicDailyChallenge({ ...challenge, id: 'v1:2026-11-24:not-bundled' })).toBe(false);
    expect(isMusicDailyChallenge({ ...challenge, prompt_key: 'music.dailyChallenge.prompt.velvet-steps.prompt' })).toBe(false);
    expect(isMusicDailyChallenge({ ...challenge, reset_at: '2026-11-26T00:00:00.000Z' })).toBe(false);
});

test('every supported non-English catalog bundles all challenge copy', () => {
    const keys = Object.keys(musicDailyChallengeByLocale.es);
    expect(keys).toHaveLength(17);
    for (const [locale, catalog] of Object.entries(APP_CATALOGS)) {
        for (const key of keys) {
            expect(catalog[key]).toBeTruthy();
            expect(catalog[key]).not.toBe(key);
        }
        expect(catalog['music.dailyChallenge.eyebrow']).toBe(musicDailyChallengeByLocale[locale as keyof typeof musicDailyChallengeByLocale]['music.dailyChallenge.eyebrow']);
    }
});

test('mobile rejects cached challenges outside their UTC day', () => {
    expect(isCurrentMusicDailyChallenge(challenge, Date.parse('2026-11-24T00:00:00.000Z'))).toBe(true);
    expect(isCurrentMusicDailyChallenge(challenge, Date.parse('2026-11-24T23:59:59.999Z'))).toBe(true);
    expect(isCurrentMusicDailyChallenge(challenge, Date.parse(challenge.reset_at))).toBe(false);
    expect(isCurrentMusicDailyChallenge(challenge, Date.parse('2026-11-23T23:59:59.999Z'))).toBe(false);
});

test('Create gives a listed sample precedence and a late challenge cannot overwrite an edit', () => {
    const enabled = { ...entitlements, features: { ...entitlements.features, dailyChallenge: true }, daily_challenge: challenge };
    const empty = { ...input, prompt: '', title: '', lyrics: '', styles: '' };
    const translate = (key: string) => `translated:${key}`;
    expect(resolveMusicCreateHandoff({ sampleId: 'neon-rain', challengeId: challenge.id, entitlements: enabled,
        input: empty, rights: false, touched: false, pending: false, translate,
        now: Date.parse('2026-11-24T12:00:00.000Z') })).toMatchObject({ title: 'Neon Rain' });
    expect(resolveMusicCreateHandoff({ challengeId: challenge.id, entitlements: enabled, input: empty,
        rights: false, touched: false, pending: false, translate, now: Date.parse('2026-11-24T12:00:00.000Z') })).toEqual({
        prompt: `translated:${challenge.prompt_key}`, title: `translated:${challenge.title_key}`,
    });
    expect(resolveMusicCreateHandoff({ challengeId: challenge.id, entitlements: enabled, input: empty,
        rights: false, touched: true, pending: false, translate, now: Date.parse('2026-11-24T12:00:00.000Z') })).toBeNull();
    expect(resolveMusicCreateHandoff({ challengeId: challenge.id, entitlements: enabled, input: { ...empty, prompt: 'my edit' },
        rights: false, touched: false, pending: false, translate, now: Date.parse('2026-11-24T12:00:00.000Z') })).toBeNull();
    expect(resolveMusicCreateHandoff({ challengeId: challenge.id, entitlements: enabled, input: empty,
        rights: false, touched: false, pending: false, translate, now: Date.parse(challenge.reset_at) })).toBeNull();
    expect(resolveMusicCreateHandoff({ templatePrompt: '  soulful rain  ', templateTitle: '  Midnight Soul  ', entitlements: enabled,
        input: empty, rights: false, touched: false, pending: false, translate })).toEqual({ prompt: 'soulful rain', title: 'Midnight Soul' });
    expect(resolveMusicCreateHandoff({ templatePrompt: 'soulful rain', templateTitle: 'Midnight Soul', entitlements: enabled,
        input: { ...empty, prompt: 'my edit' }, rights: false, touched: false, pending: false, translate })).toBeNull();

    const source = readFileSync(resolve(__dirname, '../src/app/(app)/music/create.tsx'), 'utf8');
    expect(source).toMatch(/resolveMusicCreateHandoff\(/);
    expect(source).toMatch(/touched: touched\.current === flow/);
    const seedEffect = source.slice(source.indexOf('useEffect(() => {'), source.indexOf('const lock ='));
    expect(seedEffect).not.toMatch(/flow\.(?:review|confirm)\(\)/);
});

test('Explore hides failed challenge reads and deep-links only the stable id', () => {
    const source = readFileSync(resolve(__dirname, '../src/app/(app)/music/explore.tsx'), 'utf8');
    expect(source).toMatch(/mine !== challengeRequest\.current/);
    expect(source).toMatch(/next && isCurrentMusicDailyChallenge\(next\) \? next : null/);
    expect(source).toMatch(/mounted\.current && mine === challengeRequest\.current/);
    expect(source).toMatch(/params: \{ challenge: challenge\.id \}/);
});

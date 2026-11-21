import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import en from '../src/lib/i18n/messages/en';
import messages from '../src/lib/i18n/messages/en/musicRender';
import { CATALOGS } from '../src/lib/i18n';
import { renderMessage, RENDER_DEFINITIVE_CODES } from '../src/lib/music/renderMessages';
const slots = (value: string) => [...value.matchAll(/\{([^}]+)\}/g)].map(m => m[1]).sort();
test('all keys live in the new area and generated registry', () => {
    for (const [key, value] of Object.entries(messages)) { expect(key).toMatch(/^musicRender\./); expect(en[key as keyof typeof en]).toBe(value); }
    expect(execFileSync(process.execPath, ['scripts/gen-en-registry.mjs', '--check'], { cwd: resolve(__dirname, '..'), encoding: 'utf8' })).toContain('English registry is current');
});
test.each(['ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'] as const)('%s covers every key, placeholders and required reviews', locale => {
    const catalog = CATALOGS[locale] as Record<string, string>;
    const equal = JSON.parse(readFileSync(resolve(__dirname, `../src/lib/i18n/review/${locale}-equal.json`), 'utf8'));
    const length = JSON.parse(readFileSync(resolve(__dirname, `../src/lib/i18n/review/${locale}-length.json`), 'utf8'));
    for (const [key, english] of Object.entries(messages)) {
        const translation = catalog[key]; expect(translation?.trim()).toBeTruthy(); expect(slots(translation)).toEqual(slots(english));
        if (translation === english) expect(equal[key]).toEqual(expect.any(String));
        if ([...translation].length > [...english].length * 1.6) expect(length).toContainEqual({ id: key, english, translation, ratio: Number(([...translation].length / [...english].length).toFixed(2)) });
    }
});
test.each([...RENDER_DEFINITIVE_CODES, 'temporarily_unavailable', 'network', 'bad_response', 'private_internal_detail'])('%s never shows raw server text', code => {
    expect(renderMessage(code)).not.toContain(code); expect(renderMessage(code)).not.toMatch(/^musicRender\./);
});
test('every literal route/parser/render error has explicit copy', () => {
    const base = resolve(__dirname, '../../..');
    const route = readFileSync(resolve(base, 'app/api/v1/music/songs/[id]/render/route.js'), 'utf8');
    const parser = readFileSync(resolve(base, 'lib/musicEditing.js'), 'utf8').split('export function parseMusicLocalRender')[1];
    const wav = readFileSync(resolve(base, 'lib/musicWavRender.js'), 'utf8').split('export function renderPcmWavMix')[0];
    const codes = [...route.matchAll(/error: '([^']+)'/g), ...parser.matchAll(/error: '([^']+)'/g), ...wav.matchAll(/refusal\('([^']+)'\)/g)]
        .map(m => m[1]).filter(code => !code.startsWith('crop_'));
    for (const code of codes) {
        if (code === 'temporarily_unavailable') expect(renderMessage(code)).toBe(messages['musicRender.uncertain']);
        else { expect(RENDER_DEFINITIVE_CODES).toContain(code); expect(renderMessage(code)).not.toBe(messages['musicRender.uncertain']); }
    }
});

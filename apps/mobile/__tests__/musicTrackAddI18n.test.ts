import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import messages from '../src/lib/i18n/messages/en/musicTrackAdd';
import en from '../src/lib/i18n/messages/en';
import { CATALOGS, t } from '../src/lib/i18n';
import { trackAddMessage, trackAddStatusMessage } from '../src/lib/music/trackAddMessages';
import { trackFailed, uploadFailureRefund, partFailureRefund } from './fixtures/musicTrackAdd';
const slots = (value: string) => [...value.matchAll(/\{([^}]+)\}/g)].map(m => m[1]).sort();
test('every track-add key is registered in its own namespace', () => {
    for (const [key, value] of Object.entries(messages)) {
        expect(key).toMatch(/^musicTrackAdd\./); expect(value.trim()).not.toBe(''); expect(en[key as keyof typeof en]).toBe(value);
    }
});
test.each(['ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'] as const)('%s supplies every translation and preserves placeholders', locale => {
    const catalog = CATALOGS[locale] as Record<string, string>;
    const review = JSON.parse(readFileSync(resolve(__dirname, `../src/lib/i18n/review/${locale}-equal.json`), 'utf8'));
    for (const [key, english] of Object.entries(messages)) {
        expect(typeof catalog[key]).toBe('string'); expect(catalog[key].trim()).not.toBe(''); expect(slots(catalog[key])).toEqual(slots(english));
        if (catalog[key] === english) expect(review[key]).toEqual(expect.any(String));
    }
});
test('English generated registry is current', () => {
    expect(execFileSync(process.execPath, ['scripts/gen-en-registry.mjs', '--check'], { cwd: resolve(__dirname, '..'), encoding: 'utf8' })).toContain('English registry is current');
});
test('both indistinguishable refund outcomes use identical neutral copy without amounts', () => {
    expect(uploadFailureRefund).toEqual(partFailureRefund);
    const copy = [uploadFailureRefund, partFailureRefund].map(value => trackAddStatusMessage(value, false));
    expect(copy).toEqual(['A refund has been recorded for this request.', 'A refund has been recorded for this request.']);
    expect(copy.join(' ')).not.toMatch(/\d|credits|both|all/i);
    expect(trackAddStatusMessage(trackFailed, false)).toBe(t('musicTrackAdd.failed'));
    expect(trackAddStatusMessage(trackFailed, true)).toBe(t('musicTrackAdd.refundPending'));
});
test.each(['private_internal_detail', 'insufficient_balance', 'subscription_required', 'music_track_add_unavailable', 'track_add_acceptance_unknown'])('%s never leaks a raw code', code => {
    expect(trackAddMessage(code)).not.toContain(code); expect(trackAddMessage(code)).not.toMatch(/^music\w*\./);
});

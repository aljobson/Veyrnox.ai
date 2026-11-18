import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import messages from '../src/lib/i18n/messages/en/musicActions';
import en from '../src/lib/i18n/messages/en';
import { t } from '../src/lib/i18n';
import { actionMessage } from '../src/lib/music/actionMessages';
test('all action copy is registered and uses the agreed namespaces', () => {
    for (const [key, value] of Object.entries(messages)) {
        expect(key).toMatch(/^musicActions\.(action|stems|crop)\./); expect(value.trim()).not.toBe('');
        expect(en[key as keyof typeof en]).toBe(value);
    }
});
test('English generated registry check passes', () => {
    expect(execFileSync(process.execPath, ['scripts/gen-en-registry.mjs', '--check'], { cwd: resolve(__dirname, '..'), encoding: 'utf8' })).toContain('English registry is current');
});
test('unknown error codes are never exposed to people', () => {
    expect(actionMessage('private_internal_detail')).toBe(t('musicActions.action.error'));
    expect(actionMessage('source_changed')).toBe(t('musicActions.action.changed'));
    expect(actionMessage('crop_range_invalid')).toBe(t('musicActions.action.range'));
});

import { APP_CATALOGS } from '../src/lib/i18n';
import beat from '../src/lib/i18n/messages/en/beat';
import beatMix from '../src/lib/i18n/messages/en/beatMix';

const slots = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
test.each(Object.entries(APP_CATALOGS))('%s contains every English beat key without fallback and preserves placeholders', (_locale, own) => {
    const catalog: Record<string, string> = own;
    for (const [key, value] of Object.entries(beat)) {
        expect(Object.hasOwn(catalog, key)).toBe(true);
        expect(catalog[key]?.trim()).toBeTruthy();
        expect(slots(catalog[key])).toEqual(slots(value));
    }
});

test.each(Object.entries(APP_CATALOGS))('%s contains every English mixer key without fallback and preserves placeholders', (_locale, own) => {
    const catalog: Record<string, string> = own;
    for (const [key, value] of Object.entries(beatMix)) {
        expect(Object.hasOwn(catalog, key)).toBe(true);
        expect(catalog[key]?.trim()).toBeTruthy();
        expect(slots(catalog[key])).toEqual(slots(value));
    }
});

test('Korean pattern copy and destructive messages keep particles on the noun rather than the slot letter', () => {
    const ko = APP_CATALOGS.ko as Record<string, string>;
    expect(ko['beat.pattern.copy']).toBe('{from} 패턴을 {to} 패턴에 복사');
    expect(ko['beat.pattern.clearTitle']).toBe('{pattern} 패턴을 지울까요?');
    expect(ko['beat.pattern.replaceBody']).toBe('복사하면 {to} 패턴이 교체됩니다. ‘실행 취소’로 복원할 수 있습니다.');
    for (const key of ['beat.pattern.copy', 'beat.pattern.clearTitle', 'beat.pattern.replaceTitle', 'beat.pattern.replaceBody',
        'beat.pattern.copied', 'beat.pattern.cleared', 'beat.pattern.selected', 'beat.pattern.usage']) {
        expect(ko[key]).not.toMatch(/\{(?:pattern|from|to)\}[을이가]/);
    }
});

const midiRecordKeys = Object.keys(beat).filter(key => key.startsWith('beat.midiRecord.'));
const midiSlots: Record<string, string[]> = {
    'beat.midiRecord.countInProgress': ['{current}', '{total}'],
    'beat.midiRecord.noteCount': ['{count}'],
    'beat.midiRecord.key.label': ['{note}', '{state}', '{velocity}'],
    'beat.midiRecord.recorded': ['{count}'],
};

test('MIDI recording copy exposes the complete control, status and recovery contract', () => {
    expect(midiRecordKeys).toEqual([
        'beat.midiRecord.title', 'beat.midiRecord.record', 'beat.midiRecord.stop', 'beat.midiRecord.cancelCountIn',
        'beat.midiRecord.cancelStarting', 'beat.midiRecord.countIn', 'beat.midiRecord.countInProgress',
        'beat.midiRecord.quantise', 'beat.midiRecord.locked', 'beat.midiRecord.noteCount',
        'beat.midiRecord.key.capturing', 'beat.midiRecord.key.audition', 'beat.midiRecord.key.label', 'beat.midiRecord.key.hint',
        'beat.midiRecord.status.idle', 'beat.midiRecord.status.starting', 'beat.midiRecord.status.countIn',
        'beat.midiRecord.status.recording', 'beat.midiRecord.status.finishing', 'beat.midiRecord.status.failed',
        'beat.midiRecord.saved', 'beat.midiRecord.empty', 'beat.midiRecord.recovery.title', 'beat.midiRecord.recovery.cancel',
        'beat.midiRecord.recovery.restore', 'beat.midiRecord.recovery.restore.detail',
        'beat.midiRecord.recovery.retry', 'beat.midiRecord.recovery.retry.detail', 'beat.midiRecord.recovery.retryQuantise',
        'beat.midiRecord.recovery.saveNew', 'beat.midiRecord.recovery.saveAsNew', 'beat.midiRecord.recovery.discard',
        'beat.midiRecord.recovery.discardTitle', 'beat.midiRecord.recovery.discardBody',
        'beat.midiRecord.recovery.conflict', 'beat.midiRecord.recovery.conflict.detail', 'beat.midiRecord.recovery.revoked',
        'beat.midiRecord.recovery.discardOnly.detail',
        'beat.midiRecord.recovery.pending', 'beat.midiRecord.recorded', 'beat.midiRecord.unavailable',
        'beat.midiRecord.targetRemoved', 'beat.midiRecord.newBeatSaved',
    ]);
    for (const [key, value] of Object.entries(beat).filter(([key]) => key.startsWith('beat.midiRecord.'))) {
        expect(slots(value)).toEqual(midiSlots[key] ?? []);
    }
});

test.each(Object.entries(APP_CATALOGS))('%s MIDI recording controls stay distinct and recovery is explicit', (_locale, own) => {
    const catalog = own as Record<string, string>;
    expect(new Set(['record', 'stop', 'cancelCountIn'].map(action => catalog[`beat.midiRecord.${action}`])).size).toBe(3);
    expect(catalog['beat.midiRecord.recovery.discardTitle']).toBeTruthy();
    expect(catalog['beat.midiRecord.recovery.discardBody']).toBeTruthy();
    expect(catalog['beat.midiRecord.recovery.conflict']).not.toBe(catalog['beat.midiRecord.recovery.pending']);
    for (const key of midiRecordKeys) {
        expect(Object.hasOwn(catalog, key)).toBe(true);
        expect(slots(catalog[key])).toEqual(midiSlots[key] ?? []);
    }
});

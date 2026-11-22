import { APP_CATALOGS } from '../src/lib/i18n';
import beat from '../src/lib/i18n/messages/en/beat';

const slots = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
test.each(Object.entries(APP_CATALOGS))('%s contains every English beat key without fallback and preserves placeholders', (_locale, own) => {
    const catalog: Record<string, string> = own;
    for (const [key, value] of Object.entries(beat)) {
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

import { briefLength } from '../src/lib/facelessReel';

test('the brief counter counts what the prompt uses: trimmed, without trailing . ! ?', () => {
    expect(briefLength({ topic: '  Tides in a jar...   ' } as Parameters<typeof briefLength>[0])).toBe('Tides in a jar'.length);
});

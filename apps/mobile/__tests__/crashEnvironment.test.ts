import { crashEnvironment } from '../src/lib/crashEnvironment';

describe('crashEnvironment', () => {
    test('a real device reports under the app environment', () => {
        expect(crashEnvironment('production', true)).toBe('production');
        expect(crashEnvironment('staging', true)).toBe('staging');
    });

    test('a simulator never reports as production or staging', () => {
        expect(crashEnvironment('production', false)).toBe('simulator');
        expect(crashEnvironment('staging', false)).toBe('simulator');
    });
});

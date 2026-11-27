import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Expo native-module discovery has a bounded build-safe timeout', () => {
    const source = readFileSync(resolve(
        __dirname,
        '../node_modules/expo-modules-autolinking/build/platforms/apple/moduleScanner.js',
    ), 'utf8');
    expect(source).toContain('timeout: 30000');
    expect(source).not.toContain('timeout: 5000');
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('iOS passkey sign-in stays on enabled local credential providers', () => {
    const source = readFileSync(resolve(
        __dirname,
        '../node_modules/react-native-passkeys/ios/ReactNativePasskeysModule.swift',
    ), 'utf8');
    const getFlow = source.slice(source.indexOf('AsyncFunction("get")'), source.indexOf('AsyncFunction("create")'));

    expect(getFlow).toContain('platformKeyAssertionRequest,');
    expect(getFlow).not.toContain('crossPlatformKeyAssertionRequest');
    expect(getFlow).not.toContain('prepareCrossPlatformAssertionRequest');
});

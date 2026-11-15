export {};
declare const require: (name: string) => any;
declare const process: { env: Record<string, string | undefined> };
const eas = require('../eas.json');
const appJson = require('../app.json');
const appConfig = require('../app.config.js');
const { parseBuildNumber, describeMatch } = require('../scripts/simulator-build-number.mjs');

const base = appJson.expo;
const KEYS = ['EAS_BUILD_PROFILE', 'VEYRNOX_SIMULATOR_BUILD_NUMBER'];
const run = (env: Record<string, string | undefined>) => {
    const saved = KEYS.map((k) => [k, process.env[k]] as const);
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    try {
        return appConfig({ config: base });
    } finally {
        for (const [k, v] of saved) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
};

test('the simulator profile extends production without incrementing its counter', () => {
    expect(eas.build['production-simulator'].extends).toBe('production');
    expect(eas.build['production-simulator'].autoIncrement).toBe(false);
    expect(eas.build.production.autoIncrement).toBe(true);
});
test('a simulator build takes the production build number', () => {
    const out = run({ EAS_BUILD_PROFILE: 'production-simulator', VEYRNOX_SIMULATOR_BUILD_NUMBER: '54' });
    expect(out.ios.buildNumber).toBe('54');
    expect(out.ios.bundleIdentifier).toBe(base.ios.bundleIdentifier);
    expect(base.ios.buildNumber).toBeUndefined();
});
test.each(['production', 'preview', 'development', undefined])('profile %s never reads the simulator variable', (profile) => {
    expect(run({ EAS_BUILD_PROFILE: profile, VEYRNOX_SIMULATOR_BUILD_NUMBER: '54' })).toBe(base);
});
test('without the variable the config is unchanged', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(run({ EAS_BUILD_PROFILE: 'production-simulator' })).toBe(base);
});
test.each(['0', '-1', '5.4', 'abc', '1234567890'])('rejects a bad build number %s', (value) => {
    expect(() => run({ EAS_BUILD_PROFILE: 'production-simulator', VEYRNOX_SIMULATOR_BUILD_NUMBER: value })).toThrow(/positive integer/);
});
test('reads the number from eas build:version:get output', () => {
    expect(parseBuildNumber('Resolved "production" environment\n\niOS buildNumber - 54\n')).toBe('54');
    expect(() => parseBuildNumber('nothing here')).toThrow();
});
test('verify wording', () => {
    expect(describeMatch('54', '54')).toMatch(/^OK/);
    expect(describeMatch('1', '54')).toMatch(/^MISMATCH/);
});

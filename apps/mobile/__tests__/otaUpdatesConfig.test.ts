export {};
declare const require: (name: string) => any;
const { expo } = require('../app.json');
const eas = require('../eas.json');

test('app points at this project\'s EAS Update endpoint', () => {
    expect(expo.updates.url).toBe(`https://u.expo.dev/${expo.extra.eas.projectId}`);
});
test('updates only reach builds with the same native code', () => {
    expect(expo.runtimeVersion).toEqual({ policy: 'fingerprint' });
});
test('launch never waits on the network and nothing reloads the running app', () => {
    expect(expo.updates.checkAutomatically).toBe('ON_LOAD');
    expect(expo.updates.fallbackToCacheTimeout).toBe(0);
});
test.each(['development', 'preview', 'production'])('build profile %s publishes to its own channel', (name) => {
    expect(eas.build[name].channel).toBe(name);
});
test('production-simulator inherits the production channel rather than setting its own', () => {
    expect(eas.build['production-simulator'].extends).toBe('production');
    expect(eas.build['production-simulator'].channel).toBeUndefined();
});

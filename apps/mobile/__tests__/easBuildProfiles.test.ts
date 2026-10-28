declare const require: (id: string) => any;
const eas = require('../eas.json');

// Every store and internal build must contain the app's JavaScript. @sentry/react-native bundles inside its
// sentry-cli upload step in release builds, so without Sentry upload credentials the bundle is never made, and
// SENTRY_ALLOW_FAILURE would let that empty build succeed (1.0.0 builds 3 and 4 crashed on launch this way).
// Only the production profile uploads source maps: SENTRY_AUTH_TOKEN is a secret in its EAS environment, and a
// missing or rejected token fails the build instead of shipping an empty app.
// A profile's settings with its `extends` chain applied, as EAS resolves them.
const resolve = (name: string): any => {
    const own = eas.build[name];
    if (!own.extends) return own;
    const base = resolve(own.extends);
    return { ...base, ...own, env: { ...base.env, ...own.env }, ios: { ...base.ios, ...own.ios } };
};
const profiles = Object.keys(eas.build).map((name) => [name, resolve(name)] as [string, any]);

describe('EAS build profiles always bundle the JavaScript', () => {
    const releaseProfiles = profiles.filter(([name, profile]) => !profile.developmentClient && name !== 'production');

    test.each(releaseProfiles)('%s bundles directly instead of through the Sentry upload', (_name, profile) => {
        expect(profile.env?.SENTRY_DISABLE_AUTO_UPLOAD).toBe('true');
    });

    test('production uploads source maps with the token from its own EAS environment', () => {
        expect(eas.build.production.environment).toBe('production');
        expect(eas.build.production.env.SENTRY_DISABLE_AUTO_UPLOAD).toBeUndefined();
    });

    test.each(profiles)('%s never hides a failed Sentry step', (_name, profile) => {
        expect(profile.env?.SENTRY_ALLOW_FAILURE).toBeUndefined();
    });

    // It reuses the last store build's number, so an upload would replace that build's source maps.
    test('production-simulator is production built for the simulator, without taking a build number or uploading', () => {
        expect(eas.build['production-simulator']).toEqual({ extends: 'production', autoIncrement: false, ios: { simulator: true }, env: { SENTRY_DISABLE_AUTO_UPLOAD: 'true' } });
    });

    test('store submissions name the App Store Connect app', () => {
        expect(eas.submit.production.ios.ascAppId).toBe('6824181474');
    });
});

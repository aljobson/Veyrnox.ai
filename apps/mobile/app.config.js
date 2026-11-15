// Dynamic layer over app.json. The only thing it changes is the iOS build number of the
// production-simulator profile, so a simulator build carries the same CFBundleVersion as the
// current TestFlight/production build (see docs/mobile/SIMULATOR-BUILD-NUMBER.md).
//
// Why it is needed: with cli.appVersionSource "remote" EAS only supplies the remote counter to
// store builds. A simulator build falls back to the default build number 1.
//
// VEYRNOX_SIMULATOR_BUILD_NUMBER is an EAS "production" environment variable written by
// `npm run build:ios-simulator`. It is read ONLY when EAS_BUILD_PROFILE is production-simulator,
// so a production/TestFlight build never sees it and its remote counter is untouched.
const SIMULATOR_PROFILE = 'production-simulator';
const BUILD_NUMBER = /^[1-9][0-9]{0,8}$/;

module.exports = ({ config }) => {
    const wanted = process.env.VEYRNOX_SIMULATOR_BUILD_NUMBER;
    if (process.env.EAS_BUILD_PROFILE !== SIMULATOR_PROFILE) return config;
    if (!wanted) {
        console.warn('production-simulator build without VEYRNOX_SIMULATOR_BUILD_NUMBER: build number stays 1. Use `npm run build:ios-simulator`.');
        return config;
    }
    if (!BUILD_NUMBER.test(wanted)) {
        throw new Error(`VEYRNOX_SIMULATOR_BUILD_NUMBER must be a positive integer, got "${wanted}"`);
    }
    return { ...config, ios: { ...config.ios, buildNumber: wanted } };
};

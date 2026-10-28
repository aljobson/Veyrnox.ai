const fs = require('fs');
const path = require('path');
const vm = require('vm');
declare const __dirname: string;

const appRoot = path.resolve(__dirname, '..');
function resolver(flag?: string) {
    const sandbox = {
        require: (name: string) => name === 'expo/metro-config' ? { getDefaultConfig: () => ({ resolver: {} }) } : require(name),
        __dirname: appRoot, module: { exports: {} as any }, process: { env: { VEYRNOX_NATIVE_PURCHASES: flag } },
    };
    vm.runInNewContext(fs.readFileSync(path.join(appRoot, 'metro.config.js'), 'utf8'), sandbox);
    return sandbox.module.exports.resolver.resolveRequest;
}
const browserPackage = '@revenuecat/purchases-js-hybrid-mappings';
test.each(['ios', 'android'])('flagged %s release export selects the native-only stub', platform => {
    const context = { dev: false, resolveRequest: jest.fn() };
    expect(resolver('1')(context, browserPackage, platform)).toEqual({ type: 'sourceFile', filePath: path.join(appRoot, 'src/lib/purchasesNativeOnly.js') });
    expect(context.resolveRequest).not.toHaveBeenCalled();
});
test.each([[undefined, 'ios', false], ['0', 'ios', false], ['1', 'web', false], ['1', 'ios', true]])('flag %s platform %s dev %s preserves the real resolver', (flag, platform, dev) => {
    const context = { dev, resolveRequest: jest.fn(() => 'real package') };
    expect(resolver(flag as string | undefined)(context, browserPackage, platform)).toBe('real package');
    expect(context.resolveRequest).toHaveBeenCalledWith(context, browserPackage, platform);
});
test('unrelated modules and default Jest resolution retain the original packages', () => {
    const context = { dev: false, resolveRequest: jest.fn(() => 'original') };
    expect(resolver('1')(context, 'react-native-purchases', 'ios')).toBe('original');
    expect((require as any).resolve(browserPackage)).toContain('node_modules/@revenuecat/purchases-js-hybrid-mappings/');
});
test.each(['ios', 'android'])('the installed SDK uses RNPurchases and never accesses the browser stub on %s', platform => {
    const native = { setupPurchases: jest.fn(), setLogHandler: jest.fn(), getAppUserID: jest.fn().mockResolvedValue('native-user') };
    jest.isolateModules(() => {
        jest.doMock('react-native', () => ({ NativeModules: { RNPurchases: native }, Platform: { OS: platform }, NativeEventEmitter: class { addListener() {} } }));
        jest.doMock(browserPackage, () => jest.requireActual('../src/lib/purchasesNativeOnly.js'));
        const environment = require('react-native-purchases/dist/utils/environment');
        expect(environment.isExpoGo()).toBe(false);
        expect(environment.isRorkSandbox()).toBe(false);
        expect(environment.shouldUseBrowserMode()).toBe(false);
        const purchases = require('react-native-purchases').default;
        purchases.configure({ apiKey: 'appl_native_release', appUserID: 'native-user' });
        expect(native.setupPurchases).toHaveBeenCalled();
    });
    jest.dontMock('react-native'); jest.dontMock(browserPackage);
});

test.each(['Expo Go', 'Rork', 'web'])('%s still selects browser mode with the unflagged resolver', environment => {
    const context = { dev: false, resolveRequest: jest.fn(() => 'real browser SDK') };
    expect(resolver()(context, browserPackage, environment === 'web' ? 'web' : 'ios')).toBe('real browser SDK');
    const originalExpo = (globalThis as any).expo;
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
        if (environment === 'Expo Go') (globalThis as any).expo = { modules: { ExpoGo: {} } };
        jest.isolateModules(() => {
            jest.doMock('react-native', () => ({ NativeModules: environment === 'Rork' ? { RorkSandbox: {} } : {}, Platform: { OS: environment === 'web' ? 'web' : 'ios' } }));
            expect(require('react-native-purchases/dist/utils/environment').shouldUseBrowserMode()).toBe(true);
        });
    } finally {
        (globalThis as any).expo = originalExpo;
        jest.dontMock('react-native'); log.mockRestore();
    }
});

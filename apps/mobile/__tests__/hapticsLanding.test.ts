const loadHaptics = () => {
    let module: typeof import('../src/lib/haptics');
    jest.isolateModules(() => { module = require('../src/lib/haptics'); });
    return module!;
};
afterEach(() => { jest.resetModules(); jest.dontMock('expo-haptics'); });

test('playLanding gives one light impact', async () => {
    const impactAsync = jest.fn(async () => {});
    jest.doMock('expo-haptics', () => ({ impactAsync, selectionAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light' }, NotificationFeedbackType: { Success: 's', Error: 'e' } }));
    await loadHaptics().playLanding();
    expect(impactAsync).toHaveBeenCalledTimes(1);
    expect(impactAsync).toHaveBeenCalledWith('light');
});
test('playLanding never throws when the impact fails', async () => {
    jest.doMock('expo-haptics', () => ({ impactAsync: jest.fn(async () => { throw new Error('no motor'); }), ImpactFeedbackStyle: { Light: 'light' } }));
    await expect(loadHaptics().playLanding()).resolves.toBeUndefined();
});
test('playLanding is quiet in a build without the native module', async () => {
    jest.doMock('expo-haptics', () => { throw new Error('native module missing'); });
    await expect(loadHaptics().playLanding()).resolves.toBeUndefined();
});

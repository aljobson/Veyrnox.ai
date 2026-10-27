const mockValues = new Map<string, string>();
const mockSetScheme = jest.fn(),
    mockReload = jest.fn(async () => {});
let mockPlatform = 'ios';
jest.mock('expo-secure-store', () => ({
    getItem: (key: string) => mockValues.get(key) ?? null,
    setItem: (key: string, value: string) => mockValues.set(key, value),
    deleteItemAsync: async (key: string) => {
        mockValues.delete(key);
    },
}));
jest.mock('react-native', () => ({
    Platform: {
        get OS() {
            return mockPlatform;
        },
    },
    Appearance: { getColorScheme: () => 'dark', setColorScheme: mockSetScheme },
    DynamicColorIOS: (values: object) => values,
}));
jest.mock('expo', () => ({ reloadAppAsync: () => mockReload() }));
let theme: typeof import('../src/theme');
beforeEach(() => {
    jest.resetModules();
    mockValues.clear();
    mockSetScheme.mockClear();
    mockReload.mockClear();
    mockPlatform = 'ios';
    theme = require('../src/theme');
});
test('light/dark/system changes update native chrome without reload and notify mounted v2 text', async () => {
    const listener = jest.fn(),
        off = theme.subscribeAppearance(listener);
    await theme.applyAppearance({ theme: 'light' }, '/appearance');
    expect(mockSetScheme).toHaveBeenLastCalledWith('light');
    expect(mockReload).not.toHaveBeenCalled();
    await theme.applyAppearance({ theme: 'system' }, '/appearance');
    expect(mockSetScheme).toHaveBeenLastCalledWith('unspecified');
    expect(mockReload).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
});
test('accent persistence reloads and consumes the saved route once', async () => {
    await theme.applyAppearance({ accent: 'rose' }, '/appearance');
    expect(mockValues.get('veyrnox.accent')).toBe('rose');
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(await theme.takeThemeReturnPath()).toBe('/appearance');
    expect(await theme.takeThemeReturnPath()).toBeNull();
    jest.resetModules();
    theme = require('../src/theme');
    expect(theme.getAppearance().accent).toBe('rose');
    expect(theme.studioColors.accent).toBe(theme.accentPairs.rose.dark[0]);
});
test('Android changes reload while an identical apply is a no-op for reload', async () => {
    mockPlatform = 'android';
    await theme.applyAppearance({ theme: 'dark' }, '/account');
    expect(mockReload).toHaveBeenCalledTimes(1);
    await theme.applyAppearance({ theme: 'dark' }, '/account');
    expect(mockReload).toHaveBeenCalledTimes(1);
});
test('OLED reloads despite native dark being unchanged, and Studio remains standard dark', async () => {
    await theme.applyAppearance({ theme: 'dark' });
    await theme.applyAppearance({ theme: 'oled' }, '/appearance');
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(mockSetScheme).toHaveBeenLastCalledWith('dark');
    jest.resetModules();
    theme = require('../src/theme');
    expect(theme.paletteForScheme('dark').background).toBe('#000000');
    expect(theme.studioColors.background).toBe('#0a0a0b');
});

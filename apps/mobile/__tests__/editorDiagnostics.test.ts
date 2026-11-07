jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' }, nativeBuildVersion: '31' } }));

function load(editor: string | undefined, full: string | undefined) {
    jest.resetModules();
    if (editor === undefined) delete process.env.EXPO_PUBLIC_EDITOR_ENABLED; else process.env.EXPO_PUBLIC_EDITOR_ENABLED = editor;
    if (full === undefined) delete process.env.EXPO_PUBLIC_FULL_EDITOR_ENABLED; else process.env.EXPO_PUBLIC_FULL_EDITOR_ENABLED = full;
    return require('../src/lib/editorDiagnostics') as typeof import('../src/lib/editorDiagnostics');
}

test('says the editor switches are on, with the build and the workspace count', () => {
    const { editorDiagnostics } = load('true', 'true');
    expect(editorDiagnostics(1)).toBe('Build 1.0.0 (31) · editor switch on · full editor on · workspaces 1');
});

test('says the editor switch is off when the build was made without it', () => {
    const { editorDiagnostics } = load(undefined, undefined);
    expect(editorDiagnostics(null)).toBe('Build 1.0.0 (31) · editor switch off · full editor off · workspaces ?');
});

test('a switch that is not exactly "true" counts as off', () => {
    const { editorDiagnostics } = load('1', 'TRUE');
    expect(editorDiagnostics(0)).toContain('editor switch off · full editor off · workspaces 0');
});

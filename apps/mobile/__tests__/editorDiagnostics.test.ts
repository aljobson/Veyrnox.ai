jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));
jest.mock('expo-application', () => ({ nativeBuildVersion: '31' }));

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

test('defaults the shipped editors on when a local build omits EAS profile variables', () => {
    const { editorDiagnostics } = load(undefined, undefined);
    expect(editorDiagnostics(null)).toBe('Build 1.0.0 (31) · editor switch on · full editor on · workspaces ?');
});

test('an explicit false switch remains the rollback', () => {
    const { editorDiagnostics } = load('false', 'false');
    expect(editorDiagnostics(0)).toContain('editor switch off · full editor off · workspaces 0');
});

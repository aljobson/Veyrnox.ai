import {
    allowHostedEditorNavigation,
    buildSessionSeed,
    hostedEditorUrl,
    HOSTED_EDITOR_INJECTION,
    nativeEditorSessionInjection,
    parseHostedEditorMessage,
    seedSecondsLeft,
    sessionInjection,
} from '../src/lib/hostedEditor';

const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const token = (claims: object) => `x.${encode(claims)}.y`;

test('opens the exact project in the hosted editor without putting credentials in the URL', () => {
    const url = hostedEditorUrl('https://veyrnox.ai/api', 'project id');
    expect(url).toBe('https://veyrnox.ai/app/editor?project=project+id');
    expect(url).not.toContain('token');
});

test('only permits the editor document plus non-network document URLs', () => {
    expect(allowHostedEditorNavigation('https://veyrnox.ai/app/editor?project=1', 'https://veyrnox.ai')).toBe(true);
    expect(allowHostedEditorNavigation('about:blank', 'https://veyrnox.ai')).toBe(true);
    expect(allowHostedEditorNavigation('blob:https://veyrnox.ai/id', 'https://veyrnox.ai')).toBe(true);
    expect(allowHostedEditorNavigation('https://veyrnox.ai/app/credits', 'https://veyrnox.ai')).toBe(false);
    expect(allowHostedEditorNavigation('https://evil.test/app/editor', 'https://veyrnox.ai')).toBe(false);
    expect(allowHostedEditorNavigation('not a url', 'https://veyrnox.ai')).toBe(false);
});

test('hands only a short-lived access session to the intended origin', () => {
    const seed = buildSessionSeed(token({ sub: 'user-1', email: 'a@example.test', exp: 3600 }));
    expect(seed).toEqual({
        access_token: expect.any(String),
        refresh_token: null,
        token_type: 'bearer',
        expires_at: 3600,
        user: { id: 'user-1', email: 'a@example.test' },
    });
    expect(seedSecondsLeft(seed!, 1_000_000)).toBe(2600);
    const script = sessionInjection(seed!, 'https://veyrnox.ai');
    expect(script).toContain('location.origin!=="https://veyrnox.ai"');
    expect(script).toContain('veyrnox_supabase_session');
    expect(script).not.toContain('refresh_token":"x');
    expect(buildSessionSeed('bad')).toBeNull();
});

test.each(['light', 'dark'] as const)('opts analytics out and applies the mobile %s theme before the page starts', (theme) => {
    const seed = buildSessionSeed(token({ sub: 'user-1', exp: 3600 }))!;
    const script = nativeEditorSessionInjection(seed, 'https://veyrnox.ai', theme);
    expect(script).toContain('veyrnox_analytics_preference_v1');
    expect(script).toContain('\\"analytics\\":false');
    expect(script).toContain('\\"replay\\":false');
    expect(script).toContain('window.__veyrnoxNativeEditor=1');
    expect(script).toContain(`localStorage.setItem('veyrnox_theme',"${theme}")`);
    expect(script).toContain(`document.documentElement.setAttribute('data-theme',"${theme}")`);
});

test('parses only bounded messages from the page', () => {
    expect(parseHostedEditorMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseHostedEditorMessage('{"type":"open-credits"}')).toEqual({ type: 'open-credits' });
    expect(parseHostedEditorMessage('{"type":"error","message":"bad"}')).toEqual({ type: 'error', message: 'bad' });
    expect(parseHostedEditorMessage('{"type":"other"}')).toBeNull();
    expect(parseHostedEditorMessage('x')).toBeNull();
    expect(parseHostedEditorMessage('x'.repeat(1001))).toBeNull();
});

test('production instrumentation keeps embedded editor chrome usable and captures Credits before the website purchase flow', () => {
    expect(HOSTED_EDITOR_INJECTION).toContain('[data-storage-notice]');
    expect(HOSTED_EDITOR_INJECTION).toContain('body>button[data-print="hide"]');
    expect(HOSTED_EDITOR_INJECTION).toContain('veyrnox-native-editor-style');
    expect(HOSTED_EDITOR_INJECTION).toContain("post({type:'open-credits'})");
    expect(HOSTED_EDITOR_INJECTION).toContain('stopImmediatePropagation');
    expect(HOSTED_EDITOR_INJECTION).not.toContain('access_token');
});

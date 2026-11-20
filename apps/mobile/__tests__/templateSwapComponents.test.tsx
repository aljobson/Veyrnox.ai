import { act } from 'react';
import { createRoot } from 'test-renderer';
import { SwapComposer } from '../src/components/templates/SwapComposer';
import { SwapAttemptStatus } from '../src/components/templates/SwapAttemptStatus';
import { markOffline, markOnline } from '../src/lib/networkState';
let mockAttempts: any[] = [], mockOwner: string | null = 'a';
const mockActions = { choose: jest.fn(), submit: jest.fn(async () => {}), reconcile: jest.fn(async () => {}), cancel: jest.fn() };
jest.mock('../src/lib/templateSwap/runtime', () => ({ useSwapRuntime: () => ({ attempts: mockAttempts, accountId: mockOwner, actions: mockActions, beginSessionTask: () => ({ current: () => true }) }) }));
jest.mock('../src/components/templates/SwapVisionHost', () => ({ SwapVisionHost: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../src/lib/i18n', () => ({ t: (key: string) => key }));
jest.mock('../src/components/ui', () => ({ Card: 'Card', Text: 'Text', Button: 'Button', themedStyles: (fn: Function) => fn, useThemedStyles: (fn: Function) => fn({}) }));
const offer = { id: 't', model: 'kling-o1-reference' as const, name: 'Kling O1', credits: 47, durationSeconds: 5 as const, images: 2 as const, role: 'main character' };
const ready = { accountId: 'a', templateId: 't', key: 'key', state: 'ready', files: [{}, {}], urls: ['file://frontal', 'file://crop'] };
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockAttempts = []; mockOwner = 'a'; jest.clearAllMocks(); markOnline(); });
test('empty, ready, busy, blocked, offline and signed-out controls are honest', async () => {
    const root = createRoot();
    const render = async () => { await act(async () => root.render(<SwapComposer offer={offer} />)); };
    const button = (key: string) => root.container.queryAll(n => n.props.label === `presets.swap.${key}`)[0];
    try {
        await render(); expect(button('generate').props.disabled).toBe(true);
        mockAttempts = [ready]; await render(); expect(button('generate').props.disabled).toBe(false);
        expect(root.container.queryAll(n => n.props.source?.uri?.startsWith('file://'))).toHaveLength(2);
        for (const state of ['processing', 'uploading', 'submitting']) { mockAttempts = [{ ...ready, state }]; await render(); expect(button('generate').props.disabled).toBe(true); }
        mockAttempts = [{ ...ready, state: 'photo_error', errorCode: 'no_face' }]; await render(); expect(button('retry')).toBeDefined(); expect(button('generate').props.disabled).toBe(true);
        mockAttempts = [ready]; await render(); await act(async () => markOffline()); expect(button('generate').props.disabled).toBe(true);
        mockOwner = null; mockAttempts = []; await render(); expect(button('signin')).toBeDefined(); expect(button('generate').props.disabled).toBe(true);
    } finally { await act(async () => root.unmount()); }
});
test.each(['unknown', 'unresolved', 'refund_pending', 'refunded', 'not_charged', 'queued', 'running', 'succeeded'])('money state %s renders outside composer gate', async state => {
    const root = createRoot(); mockAttempts = [{ ...ready, state, body: { max_charge_credits: 47 } }];
    try {
        await act(async () => root.render(<SwapAttemptStatus templateId="t" />));
        const strings = root.container.queryAll(n => typeof n.props.children === 'string').map(n => n.props.children);
        expect(strings).toContain(`presets.swap.${state}`);
        expect(strings.includes('presets.swap.refunded')).toBe(state === 'refunded');
        if (['unknown', 'unresolved', 'refund_pending'].includes(state)) expect(root.container.queryAll(n => n.props.label === 'presets.swap.check')).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
});

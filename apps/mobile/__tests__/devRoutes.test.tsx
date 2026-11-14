import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import Probe from '../src/app/(app)/cinema/probe';
import DevS1Editor from '../src/app/(app)/dev-s1-editor';
import NotFound from '../src/app/+not-found';
import { t } from '../src/lib/i18n';
import { S1_FLAG } from '../src/lib/editorSpike';

const mockRedirect = jest.fn((_props: { href: string }) => null);
jest.mock('expo-router', () => ({
    Redirect: (props: { href: string }) => mockRedirect(props), Stack: { Screen: () => null }, useLocalSearchParams: () => ({}),
}));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ addListener: () => ({ remove: () => {} }), replace: () => {}, play: () => {} }), VideoView: () => null }));
jest.mock('../src/components/dev/EditorSpikeHarness', () => ({ EditorSpikeHarness: () => require('react').createElement(require('react-native').Text, null, 'spike harness') }));
void [RN.View, RN.Text];
const flags = globalThis as unknown as { __DEV__: boolean; IS_REACT_ACT_ENVIRONMENT: boolean };
const textOf = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
let root: Root;
const wasDev = flags.__DEV__;
beforeEach(() => { flags.IS_REACT_ACT_ENVIRONMENT = true; mockRedirect.mockClear(); delete process.env.EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); flags.__DEV__ = wasDev; delete process.env.EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE; });
const hrefs = () => mockRedirect.mock.calls.map(call => call[0].href);

describe('in a release build the development screens send their address Home', () => {
    beforeEach(() => { flags.__DEV__ = false; });
    test('the Cinema playback probe', async () => {
        await act(async () => root.render(<Probe />));
        expect(hrefs()).toContain('/');
        expect(textOf(root.container)).toBe('');
    });
    test('the editor spike, when the build was not made for it', async () => {
        await act(async () => root.render(<DevS1Editor />));
        expect(hrefs()).toContain('/');
        expect(textOf(root.container)).toBe('');
    });
    test('the editor spike still opens in a build made with its flag', async () => {
        process.env.EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE = '1';
        await act(async () => root.render(<DevS1Editor />));
        expect(hrefs()).toEqual([]);
        expect(textOf(root.container)).toContain('spike harness');
    });
});

describe('in a development build they still open', () => {
    beforeEach(() => { flags.__DEV__ = true; });
    test('the probe waits for its code and token', async () => {
        await act(async () => root.render(<Probe />));
        expect(hrefs()).toEqual([]);
        expect(textOf(root.container)).toContain(t('cinema.waitingforcodeandtoken'));
    });
    test('the editor spike shows its note without the flag', async () => {
        await act(async () => root.render(<DevS1Editor />));
        expect(hrefs()).toEqual([]);
        expect(textOf(root.container)).toContain(t('devs1editor.spikeS1isoffinthisbuild', { value1: S1_FLAG }));
    });
});

test('a path with no screen goes to the root instead of an unmatched-route page', async () => {
    await act(async () => root.render(<NotFound />));
    expect(hrefs()).toEqual(['/']);
    expect(textOf(root.container)).toBe('');
});

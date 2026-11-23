import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import Probe from '../src/app/(app)/cinema/probe';
import DevB1Beat from '../src/app/(app)/dev-b1-beat';
import DevN0Beat from '../src/app/(app)/dev-n0-beat';
import NotFound from '../src/app/+not-found';
import { t } from '../src/lib/i18n';
import { B1_FLAG } from '../src/lib/beatEngineSpike';
import { N0_FLAG } from '../src/lib/beatNative/session';

const mockRedirect = jest.fn((_props: { href: string }) => null);
const mockB1Harness = jest.fn(() => null);
const mockN0Harness = jest.fn(() => null);
jest.mock('expo-router', () => ({
    Redirect: (props: { href: string }) => mockRedirect(props), Stack: { Screen: () => null }, useLocalSearchParams: () => ({}),
}));
jest.mock('expo-device', () => ({ modelName: 'Test phone' }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ addListener: () => ({ remove: () => {} }), replace: () => {}, play: () => {} }), VideoView: () => null }));
jest.mock('../src/components/dev/BeatEngineSpikeHarness', () => ({ BeatEngineSpikeHarness: () => mockB1Harness() }));
jest.mock('../src/components/dev/NativeBeatEngineHarness', () => ({ NativeBeatEngineHarness: () => mockN0Harness() }));
jest.mock('../src/components/EmptyState', () => ({ EmptyState: (p: { title: string }) => require('react').createElement(require('react-native').Text, null, p.title) }));
void [RN.View, RN.Text];
const flags = globalThis as unknown as { __DEV__: boolean; IS_REACT_ACT_ENVIRONMENT: boolean };
const textOf = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
let root: Root;
const wasDev = flags.__DEV__;
beforeEach(() => {
    flags.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks();
    delete process.env.EXPO_PUBLIC_DEV_B1_BEAT_SPIKE; delete process.env.EXPO_PUBLIC_DEV_N0_BEAT_SPIKE;
    root = createRoot();
});
afterEach(async () => {
    await act(async () => root.unmount()); flags.__DEV__ = wasDev;
    delete process.env.EXPO_PUBLIC_DEV_B1_BEAT_SPIKE; delete process.env.EXPO_PUBLIC_DEV_N0_BEAT_SPIKE;
});
const hrefs = () => mockRedirect.mock.calls.map(call => call[0].href);

describe('in a release build the development screens send their address Home', () => {
    beforeEach(() => { flags.__DEV__ = false; });
    test('the Cinema playback probe', async () => {
        await act(async () => root.render(<Probe />));
        expect(hrefs()).toContain('/');
        expect(textOf(root.container)).toBe('');
    });
    test.each([
        ['B1 WebView engine', DevB1Beat, mockB1Harness],
        ['N0 native engine', DevN0Beat, mockN0Harness],
    ] as const)('%s redirects Home before mounting its diagnostic harness', async (_name, Screen, harness) => {
        await act(async () => root.render(<Screen />));
        expect(hrefs()).toEqual(['/']);
        expect(textOf(root.container)).toBe('');
        expect(harness).not.toHaveBeenCalled();
    });
});

describe('in a development build they still open', () => {
    beforeEach(() => { flags.__DEV__ = true; });
    test('the probe waits for its code and token', async () => {
        await act(async () => root.render(<Probe />));
        expect(hrefs()).toEqual([]);
        expect(textOf(root.container)).toContain(t('cinema.waitingforcodeandtoken'));
    });
    test.each([
        ['B1 WebView engine', DevB1Beat, B1_FLAG, mockB1Harness],
        ['N0 native engine', DevN0Beat, N0_FLAG, mockN0Harness],
    ] as const)('%s shows an off note without mounting its harness when the flag is absent', async (_name, Screen, flag, harness) => {
        await act(async () => root.render(<Screen />));
        expect(hrefs()).toEqual([]);
        expect(textOf(root.container)).toContain(flag);
        expect(harness).not.toHaveBeenCalled();
    });
    test('the two harnesses mount only after their own explicit flag is enabled', async () => {
        process.env.EXPO_PUBLIC_DEV_B1_BEAT_SPIKE = '1';
        await act(async () => root.render(<DevB1Beat />));
        expect(mockB1Harness).toHaveBeenCalledTimes(1); expect(mockN0Harness).not.toHaveBeenCalled();
        process.env.EXPO_PUBLIC_DEV_N0_BEAT_SPIKE = '1';
        await act(async () => root.render(<DevN0Beat />));
        expect(mockN0Harness).toHaveBeenCalledTimes(1);
    });
});

test('ordinary app and EAS build configuration never enables diagnostic beat routes', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    for (const name of ['app.json', 'app.config.js', 'eas.json']) {
        const source = readFileSync(join(__dirname, '..', name), 'utf8');
        expect(source).not.toContain('EXPO_PUBLIC_DEV_B1_BEAT_SPIKE');
        expect(source).not.toContain('EXPO_PUBLIC_DEV_N0_BEAT_SPIKE');
    }
});

test('a path with no screen says so instead of redirecting silently or showing an unmatched-route page', async () => {
    await act(async () => root.render(<NotFound />));
    expect(hrefs()).toEqual([]);
    expect(textOf(root.container)).toBe(t('notFound.title'));
});

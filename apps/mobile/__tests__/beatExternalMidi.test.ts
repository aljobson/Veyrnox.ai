import { act, createElement } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatExternalMidiCapture } from '../src/components/beats/BeatExternalMidiCapture';
import { createExternalMidiController, createMidiByteStreamParser, type ExternalMidiPort } from '../src/lib/beatNative/externalMidi';
import { t } from '../src/lib/i18n';

const mockNativeExternalMidiPort = jest.fn<ExternalMidiPort | null, []>();
jest.mock('../src/lib/beatNative/nativeExternalMidi', () => ({ nativeExternalMidiPort: () => mockNativeExternalMidiPort() }));

function harness() {
    const listeners = new Map<string, Set<(event: any) => void>>();
    const connect = jest.fn(async () => undefined), disconnect = jest.fn(async () => undefined);
    const port: ExternalMidiPort = {
        requestAccess: jest.fn(async () => ({ permission: 'granted' as const, devices: [{ id: 'keys', name: 'Keys', connected: true }] })),
        connect, disconnect,
        addListener(event, listener) {
            const found = listeners.get(event) ?? new Set(); found.add(listener); listeners.set(event, found);
            return { remove: () => found.delete(listener) };
        },
    };
    return { port, connect, disconnect, send: (event: string, value: unknown) => listeners.get(event)?.forEach(listener => listener(value)) };
}

test('permission, connect, disconnect and device changes stay explicit', async () => {
    const h = harness(), controller = createExternalMidiController(h.port, jest.fn());
    expect(controller.snapshot().permission).toBe('unknown');
    await controller.requestAccess(); expect(controller.snapshot()).toEqual(expect.objectContaining({ permission: 'granted', devices: [{ id: 'keys', name: 'Keys', connected: true }] }));
    await controller.connect('keys'); expect(h.connect).toHaveBeenCalledWith('keys'); expect(controller.snapshot().connectedId).toBe('keys');
    h.send('devices', { devices: [], connectedId: null }); expect(controller.snapshot().connectedId).toBeNull();
    await controller.disconnect(); expect(h.disconnect).toHaveBeenCalled();
});

test('native messages use the shared web parser and disposal removes hot-plug listeners', async () => {
    const h = harness(), message = jest.fn(), controller = createExternalMidiController(h.port, message);
    h.send('message', { bytes: [0x91, 64, 99], receivedAtMs: 12 });
    h.send('message', { bytes: [0x91, 64, 0], receivedAtMs: 18 });
    expect(message.mock.calls.map(call => call[0])).toEqual([
        { type: 'on', pitch: 64, velocity: 99, channel: 1, receivedAtMs: 12 },
        { type: 'off', pitch: 64, velocity: 0, channel: 1, receivedAtMs: 18 },
    ]);
    controller.dispose(); h.send('devices', { devices: [{ id: 'late', name: 'Late', connected: true }], connectedId: 'late' });
    expect(controller.snapshot().devices).toEqual([]); expect(h.disconnect).toHaveBeenCalled();
});

test('byte-stream framing handles running status, realtime bytes, split callbacks and SysEx', () => {
    const packets: number[][] = [], parser = createMidiByteStreamParser(bytes => packets.push(bytes));
    parser.push([0x90, 60, 100, 0xf8, 62]);
    parser.push([0, 0xf0, 1, 2, 3, 0xf8, 0xf7, 0xc1, 7, 0x80, 62, 0]);
    expect(packets).toEqual([
        [0x90, 60, 100],
        [0x90, 62, 0],
        [0xc1, 7],
        [0x80, 62, 0],
    ]);
    parser.reset(); parser.push([64, 99]);
    expect(packets).toHaveLength(4);
});

test('controller preserves parser state across native chunks and ignores clock bytes', () => {
    const h = harness(), message = jest.fn(), controller = createExternalMidiController(h.port, message);
    h.send('message', { bytes: [0x92, 60, 100, 0xf8, 61], receivedAtMs: 12 });
    h.send('message', { bytes: [0], receivedAtMs: 13 });
    expect(message.mock.calls.map(call => call[0])).toEqual([
        { type: 'on', pitch: 60, velocity: 100, channel: 2, receivedAtMs: 12 },
        { type: 'off', pitch: 61, velocity: 0, channel: 2, receivedAtMs: 13 },
    ]);
    controller.dispose();
});

test('missing native capability reports unavailable without inventing permission', async () => {
    const controller = createExternalMidiController(null, jest.fn());
    await controller.requestAccess(); expect(controller.snapshot()).toEqual({ permission: 'unavailable', devices: [], connectedId: null, error: null });
});

test('permission refusal and connection failure are recoverable state, not a crash', async () => {
    const h = harness();
    h.port.requestAccess = jest.fn(async () => { throw new Error('midi_permission_denied'); });
    h.port.connect = jest.fn(async () => { throw new Error('midi_connect_failed'); });
    const controller = createExternalMidiController(h.port, jest.fn());
    await controller.requestAccess(); expect(controller.snapshot()).toEqual(expect.objectContaining({ permission: 'denied', error: 'midi_permission_denied' }));
    expect(await controller.connect('gone')).toBe(false);
    expect(controller.snapshot()).toEqual(expect.objectContaining({ connectedId: null, error: 'midi_connect_failed' }));
    controller.dispose();
});

test('external MIDI UI lists devices and connects only after the user chooses one', async () => {
    const h = harness(); mockNativeExternalMidiPort.mockReturnValue(h.port);
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
    const root: Root = createRoot();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(createElement(BeatExternalMidiCapture,
        { track: { id: 'midi-track' } as never, audio: () => null, onError: jest.fn() })));
    await act(async () => Promise.resolve());
    expect(h.connect).not.toHaveBeenCalled();
    const control = root.container.queryAll(node => node.props.accessibilityLabel === t('beat.midi.external.connect', { name: 'Keys' }))[0];
    expect(control).toBeDefined();
    await act(async () => (control.props.onClick ?? control.props.onPress)({ nativeEvent: {} }));
    expect(h.connect).toHaveBeenCalledWith('keys');
    expect(root.container.queryAll(node => node.props.accessibilityLabel === t('beat.midi.external.disconnect', { name: 'Keys' }))).toHaveLength(1);
    await act(async () => root.unmount());
    jest.restoreAllMocks();
});

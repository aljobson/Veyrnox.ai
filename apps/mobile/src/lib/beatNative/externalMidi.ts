// External MIDI is intentionally separate from BeatKeyboard's on-screen events. This controller owns
// native permission, device and hot-plug state; the recording reducer remains platform-neutral.
// @ts-ignore shared JavaScript parser is the web/native MIDI wire contract.
import { parseMidiMessage } from '../../../../../app/veyrnox/_lib/music/beat/beatWebMidi.mjs';

export type ExternalMidiPermission = 'unknown' | 'granted' | 'denied' | 'unavailable';
export type ExternalMidiDevice = { id: string; name: string; manufacturer?: string; connected: boolean };
export type ExternalMidiMessage = { type: 'on' | 'off'; pitch: number; velocity: number; channel: number; receivedAtMs: number };
export type ExternalMidiSnapshot = { permission: ExternalMidiPermission; devices: ExternalMidiDevice[]; connectedId: string | null; error: string | null };
export type ExternalMidiSubscription = { remove(): void };
export type ExternalMidiPort = {
    requestAccess(): Promise<{ permission: ExternalMidiPermission; devices: ExternalMidiDevice[] }>;
    connect(deviceId: string): Promise<void>;
    disconnect(): Promise<void>;
    addListener(event: 'devices' | 'message' | 'status', listener: (event: any) => void): ExternalMidiSubscription;
};

type MidiPacketListener = (bytes: number[]) => void;

/** Stateful MIDI 1.0 byte-stream framing shared by iOS and Android native callbacks. */
export function createMidiByteStreamParser(onPacket: MidiPacketListener) {
    let runningStatus: number | null = null;
    let data: number[] = [];
    let expected = 0;
    let systemRemaining = 0;
    let inSysEx = false;
    const reset = () => { runningStatus = null; data = []; expected = 0; systemRemaining = 0; inSysEx = false; };
    const channelLength = (status: number) => {
        const family = status & 0xf0;
        return family === 0xc0 || family === 0xd0 ? 1 : 2;
    };
    const systemLength = (status: number) => status === 0xf2 ? 2 : status === 0xf1 || status === 0xf3 ? 1 : 0;
    return {
        push(chunk: unknown) {
            if (!Array.isArray(chunk)) return;
            for (const raw of chunk) {
                const byte = Number(raw);
                if (!Number.isInteger(byte) || byte < 0 || byte > 255) continue;
                if (byte >= 0xf8) continue; // Realtime bytes may appear anywhere and never disturb running status.
                if (inSysEx) { if (byte === 0xf7) inSysEx = false; continue; }
                if (byte & 0x80) {
                    data = [];
                    if (byte === 0xf0) { inSysEx = true; runningStatus = null; expected = 0; systemRemaining = 0; continue; }
                    if (byte >= 0xf0) {
                        runningStatus = null; expected = 0; systemRemaining = systemLength(byte); continue;
                    }
                    runningStatus = byte; expected = channelLength(byte); systemRemaining = 0; continue;
                }
                if (systemRemaining > 0) { systemRemaining -= 1; continue; }
                if (runningStatus === null || expected === 0) continue;
                data.push(byte);
                if (data.length === expected) { onPacket([runningStatus, ...data]); data = []; }
            }
        },
        reset,
    };
}

export function createExternalMidiController(port: ExternalMidiPort | null, onMessage: (message: ExternalMidiMessage) => void) {
    let snapshot: ExternalMidiSnapshot = { permission: port ? 'unknown' : 'unavailable', devices: [], connectedId: null, error: null };
    let disposed = false, operation = 0;
    const listeners = new Set<() => void>();
    const emit = (patch: Partial<ExternalMidiSnapshot>) => {
        if (disposed) return;
        snapshot = { ...snapshot, ...patch };
        listeners.forEach(listener => listener());
    };
    let messageTime = 0;
    const parser = createMidiByteStreamParser(bytes => {
        const parsed = parseMidiMessage(bytes);
        if (parsed?.type === 'on' || parsed?.type === 'off') onMessage({
            type: parsed.type, pitch: parsed.pitch, velocity: parsed.velocity, channel: parsed.channel,
            receivedAtMs: messageTime,
        });
    });
    const subscriptions = port ? [
        port.addListener('devices', event => {
            const connectedId = event.connectedId ?? null; if (!connectedId) parser.reset();
            emit({ devices: event.devices ?? [], connectedId });
        }),
        port.addListener('status', event => {
            const connectedId = event.connectedId ?? null; if (!connectedId) parser.reset();
            emit({ connectedId, error: event.error ?? null });
        }),
        port.addListener('message', event => {
            messageTime = Number.isFinite(event.receivedAtMs) ? event.receivedAtMs : 0;
            parser.push(event.bytes);
        }),
    ] : [];
    return {
        snapshot: () => snapshot,
        subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
        async requestAccess() {
            if (!port) return snapshot;
            const token = ++operation;
            try {
                const result = await port.requestAccess();
                if (!disposed && token === operation) emit({ permission: result.permission, devices: result.devices, error: null });
            } catch (error) {
                if (!disposed && token === operation) emit({ permission: 'denied', error: error instanceof Error ? error.message : String(error) });
            }
            return snapshot;
        },
        async connect(deviceId: string) {
            if (!port || disposed) return false;
            const token = ++operation;
            try {
                await port.connect(deviceId);
                if (!disposed && token === operation) emit({ connectedId: deviceId, error: null });
                return !disposed && token === operation;
            } catch (error) {
                if (!disposed && token === operation) emit({ connectedId: null, error: error instanceof Error ? error.message : String(error) });
                return false;
            }
        },
        async disconnect() {
            const token = ++operation;
            try { await port?.disconnect(); } finally { if (!disposed && token === operation) emit({ connectedId: null }); }
        },
        dispose() {
            if (disposed) return;
            disposed = true; operation++; parser.reset(); subscriptions.forEach(subscription => subscription.remove()); listeners.clear();
            void port?.disconnect().catch(() => undefined);
        },
    };
}

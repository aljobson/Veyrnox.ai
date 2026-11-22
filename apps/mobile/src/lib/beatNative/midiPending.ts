import * as Crypto from 'expo-crypto';
import { validateBeat, type BeatDoc } from './doc';
import { validOwner, type BeatFiles } from './persist';
import type { Instrument } from './midi';
// @ts-ignore shared JavaScript; this validator is the durable web/native contract.
import { validPendingTake } from '../../../../../app/veyrnox/_lib/music/beat/beatPendingTake.mjs';

export const MIDI_PENDING_VERSION = 1 as const;
export const MIDI_PENDING_MAX_BYTES = 512 * 1024;
export const midiPendingFile = (beatId: string) => `${beatId}.midi-take`;
export const midiRevokedFile = (beatId: string) => `${beatId}.midi-revoked`;

export type MidiTakeNote = { start: number; end: number; pitch: number; velocity: number };
export type MidiTake = {
    instrument: Instrument;
    name: string;
    trackId: string;
    startTick: number;
    endLimit: number;
    snap: number;
    notes: MidiTakeNote[];
};
export type MidiPendingTarget = { kind: 'existing' | 'new'; beatId: string };
export type MidiPreparedEnvelope = {
    version: typeof MIDI_PENDING_VERSION;
    state: 'prepared';
    owner: string;
    beatId: string;
    createdAt: number;
    take: MidiTake;
    baseFingerprint: string;
    expectedFingerprint: string;
    baseContentFingerprint: string;
    expectedContentFingerprint: string;
    target: MidiPendingTarget;
};
export type MidiRevokedEnvelope = {
    version: typeof MIDI_PENDING_VERSION;
    state: 'revoked';
    owner: string;
    beatId: string;
    createdAt: number;
};

export type MidiPendingErrorCode = 'invalid_pending_take' | 'pending_take_too_large' | 'pending_take_stale';
export class MidiPendingError extends Error {
    constructor(readonly code: MidiPendingErrorCode) { super(code); this.name = 'MidiPendingError'; }
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validFingerprint = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function validPreparedEnvelope(value: unknown, owner: string, beatId: string): value is MidiPreparedEnvelope {
    if (!isObject(value) || value.version !== MIDI_PENDING_VERSION || value.state !== 'prepared'
        || value.owner !== owner || value.beatId !== beatId || !Number.isSafeInteger(value.createdAt) || Number(value.createdAt) < 0
        || !validFingerprint(value.baseFingerprint) || !validFingerprint(value.expectedFingerprint)
        || !validFingerprint(value.baseContentFingerprint) || !validFingerprint(value.expectedContentFingerprint)
        || !validPendingTake(value.take) || !isObject(value.target)
        || !['existing', 'new'].includes(String(value.target.kind)) || !validId(value.target.beatId)) return false;
    const take = value.take as unknown as Record<string, unknown>;
    if (typeof take.name !== 'string' || take.name.length < 1 || take.name.length > 128) return false;
    return value.target.kind === 'new' ? value.target.beatId !== beatId : value.target.beatId === beatId;
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value).filter(key => key !== 'updatedAt').sort().map(key => [key, canonical(value[key])]));
}

/** Stable content identity for CAS/recovery. Volatile save timestamps do not create false conflicts. */
export async function beatFingerprint(doc: BeatDoc, options: { excludeLiveMix?: boolean } = {}): Promise<string> {
    if (!validateBeat(doc).ok) throw new MidiPendingError('invalid_pending_take');
    const value = options.excludeLiveMix ? { ...doc, tracks: doc.tracks.map(track => {
        const { gain: _gain, pan: _pan, mute: _mute, solo: _solo, ...content } = track;
        return content;
    }) } : doc;
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(value)));
}

export type MidiPendingIdentity = { owner: string; beatId: string; isCurrent?(): boolean };
export function createMidiPendingStore(files: BeatFiles, identity: MidiPendingIdentity) {
    if (!validOwner(identity.owner) || !validId(identity.beatId)) throw new MidiPendingError('invalid_pending_take');
    const filename = midiPendingFile(identity.beatId);
    const revokedFilename = midiRevokedFile(identity.beatId);
    let revoked = false;
    let writes: Promise<void> = Promise.resolve();
    const assertCurrent = () => { if (identity.isCurrent && !identity.isCurrent()) throw new MidiPendingError('pending_take_stale'); };
    const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
        const result = writes.catch(() => undefined).then(operation);
        writes = result.then(() => undefined, () => undefined);
        return result;
    };
    const encode = (value: MidiPreparedEnvelope | MidiRevokedEnvelope) => {
        const text = JSON.stringify(value);
        if (byteLength(text) > MIDI_PENDING_MAX_BYTES) throw new MidiPendingError('pending_take_too_large');
        return text;
    };
    return {
        async read(): Promise<MidiPreparedEnvelope | null> {
            assertCurrent();
            if (revoked) return null;
            const revokedRow = await files.read(revokedFilename);
            assertCurrent();
            if (revoked || revokedRow !== null) return null;
            const raw = await files.read(filename);
            assertCurrent();
            if (revoked) return null;
            if (raw === null) return null;
            if (byteLength(raw) > MIDI_PENDING_MAX_BYTES) throw new MidiPendingError('pending_take_too_large');
            let parsed: unknown;
            try { parsed = JSON.parse(raw); } catch { throw new MidiPendingError('invalid_pending_take'); }
            if (isObject(parsed) && parsed.state === 'revoked' && parsed.owner === identity.owner && parsed.beatId === identity.beatId) return null;
            if (!validPreparedEnvelope(parsed, identity.owner, identity.beatId)) throw new MidiPendingError('invalid_pending_take');
            return structuredClone(parsed);
        },
        async prepare(input: Omit<MidiPreparedEnvelope, 'version' | 'state' | 'owner' | 'beatId' | 'createdAt'> & { createdAt?: number }): Promise<MidiPreparedEnvelope> {
            assertCurrent();
            if (revoked) throw new MidiPendingError('pending_take_stale');
            const envelope: MidiPreparedEnvelope = { version: MIDI_PENDING_VERSION, state: 'prepared', owner: identity.owner,
                beatId: identity.beatId, createdAt: input.createdAt ?? Date.now(), take: structuredClone(input.take),
                baseFingerprint: input.baseFingerprint, expectedFingerprint: input.expectedFingerprint,
                baseContentFingerprint: input.baseContentFingerprint, expectedContentFingerprint: input.expectedContentFingerprint,
                target: structuredClone(input.target) };
            if (!validPreparedEnvelope(envelope, identity.owner, identity.beatId)) throw new MidiPendingError('invalid_pending_take');
            return enqueue(async () => {
                if (revoked) throw new MidiPendingError('pending_take_stale');
                assertCurrent();
                await files.write(filename, encode(envelope));
                assertCurrent();
                await files.remove(revokedFilename);
                assertCurrent();
                return envelope;
            });
        },
        async remove(): Promise<void> {
            assertCurrent();
            if (revoked) throw new MidiPendingError('pending_take_stale');
            await enqueue(async () => {
                if (revoked) throw new MidiPendingError('pending_take_stale');
                assertCurrent(); await files.remove(filename); assertCurrent();
            });
        },
        /** Security cleanup is deliberately limited to the captured old-owner file adapter. */
        async revoke(): Promise<void> {
            revoked = true;
            const tombstone: MidiRevokedEnvelope = { version: MIDI_PENDING_VERSION, state: 'revoked', owner: identity.owner,
                beatId: identity.beatId, createdAt: Date.now() };
            await enqueue(async () => {
                let quarantined = false, rowMarked = false, lastError: unknown;
                try { await files.write(revokedFilename, encode(tombstone)); quarantined = true; } catch (error) { lastError = error; }
                try { await files.write(filename, encode(tombstone)); rowMarked = true; } catch (error) { lastError = error; }
                try { await files.remove(filename); return; }
                catch (error) {
                    if (quarantined || rowMarked) return;
                    throw lastError ?? error;
                }
            });
        },
    };
}
export type MidiPendingStore = ReturnType<typeof createMidiPendingStore>;

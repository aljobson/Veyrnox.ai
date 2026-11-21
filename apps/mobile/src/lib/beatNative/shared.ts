// One typed seam over the shared web beat engine (app/veyrnox/_lib/music/beat/*). Nothing here copies web code:
// it re-exports the same modules the web page runs, so a fix to a voice or a mix node lands on both.
// Pattern: src/lib/instrumentShared.ts. Metro and Jest both resolve the web folder (metro.config.js watchFolders).
// @ts-ignore plain-JS web module, typed by the casts below
import * as engine from '../../../../../app/veyrnox/_lib/music/beat/beatEngine.js';
import type { BeatDoc } from './doc';

export type ParamLike = {
    value: number;
    setValueAtTime(value: number, at: number): unknown;
    linearRampToValueAtTime(value: number, at: number): unknown;
    exponentialRampToValueAtTime(value: number, at: number): unknown;
    setTargetAtTime(value: number, at: number, timeConstant: number): unknown;
    cancelScheduledValues(at: number): unknown;
};

/** The slice of a Web Audio context the engine touches (a real browser context, a native one, or the test double). */
export type EngineContext = {
    currentTime: number;
    sampleRate: number;
    state: string;
    destination: unknown;
    resume(): Promise<void>;
    close(): Promise<void>;
    [method: string]: unknown;
};

export type BeatTrackInstrument = { id: 'piano' | 'guitar' | 'bass' | 'synth' | 'drums' | 'wavetable'; preset: string };
export type BeatTrack = { id: string; instrument: BeatTrackInstrument; gain: number; pan: number };
export type BeatVoice = { endTime: number; ended: Promise<void>; release(at: number): void; stop(at: number): void };

/** Engine-owned run; callers only retain its identity. A doc run (N5 mix graph) also exposes its strips. */
export type Run = object;
export type MixRunHandle = Run & { channels: Map<string, { schedule(window: { fromSec: number; toSec: number; contextTime: number }): void }> };

export type BeatEngine = {
    context: EngineContext;
    now(): number;
    resume(): Promise<void>;
    close(): Promise<void>;
    startRun(doc: BeatDoc, opts?: { automationActive?: boolean; onError?: (message: string) => void }): MixRunHandle;
    startRun(doc: null): Run;
    stopRun(run: Run): void;
    setTrackMix(run: Run, id: string, gain: number, pan: number, doc?: BeatDoc): unknown;
    meterTap(id: string): unknown;
    live: Run;
    playMidi(track: BeatTrack | { id: string; instrument: { engine: 'voice' | 'wavetable'; id: string; preset: string }; gain: number; pan: number }, pitch: number, velocity: number, at: number, run?: Run, gain?: number): BeatVoice;
    playPad(pad: string, velocity: number, at: number, destination?: unknown, kit?: string): void;
    click(at: number, accent: boolean, destination: unknown): void;
};

export const createBeatEngine = (engine as unknown as { createBeatEngine: () => BeatEngine }).createBeatEngine;

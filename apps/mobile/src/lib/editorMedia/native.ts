import { requireOptionalNativeModule } from 'expo';
import type { EditorMediaProgressStage, FrameDescriptor } from './protocol';
export type NativeProgressEvent = { account: string; project: string; owner: string; token: string; stage: EditorMediaProgressStage; value: number };
export interface NativeEditorMediaModule {
    capabilities(): Promise<Record<string, unknown>>;
    setOwner(account: string | null, clientOwner: string, clientEpoch: number): Promise<void>;
    setProjectGeneration(account: string, project: string, generation: number): Promise<void>;
    inspect(account: string, project: string, owner: string, token: string, uri: string): Promise<Record<string, unknown>>;
    sampleFrames(account: string, project: string, owner: string, token: string, request: unknown): Promise<Record<string, unknown>>;
    decodePcm(account: string, project: string, owner: string, token: string, request: unknown): Promise<Record<string, unknown>>;
    mixAudio(account: string, project: string, owner: string, token: string, mixJSON: string, sources: Readonly<Record<string, string>>, frames: number, fps: number): Promise<Record<string, unknown>>;
    beginEncode(account: string, project: string, owner: string, token: string, request: unknown): Promise<Record<string, unknown>>;
    appendFrameBatch(account: string, project: string, owner: string, token: string, sessionId: string, frames: readonly FrameDescriptor[]): Promise<Record<string, unknown>>;
    finishEncode(account: string, project: string, owner: string, token: string, sessionId: string, audioArtifactId: string | null): Promise<Record<string, unknown>>;
    cancel(account: string, project: string, owner: string, token: string): void;
    cancelProject(account: string, project: string): Promise<void>;
    release(account: string, project: string, artifactId: string): Promise<void>;
    pickColor?(initialHex: string): Promise<string | null>;
    addListener(event: 'progress', listener: (event: NativeProgressEvent) => void): { remove(): void };
}
export function optionalEditorMediaModule(): NativeEditorMediaModule | null {
    try { return requireOptionalNativeModule<NativeEditorMediaModule>('VeyrnoxEditorMedia'); } catch { return null; }
}

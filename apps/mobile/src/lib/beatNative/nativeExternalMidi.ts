import { requireOptionalNativeModule } from 'expo';
import type { ExternalMidiPort } from './externalMidi';

export function nativeExternalMidiPort(): ExternalMidiPort | null {
    try { return requireOptionalNativeModule<ExternalMidiPort>('VeyrnoxBeatMidi'); } catch { return null; }
}

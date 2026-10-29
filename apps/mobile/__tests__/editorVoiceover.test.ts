import { clock, isWavHeader, meterLevel, voiceoverLimitSeconds, voiceoverMedia } from '../src/lib/editorVoiceover';
import { VOICEOVER_OPTIONS } from '../src/lib/voiceoverRecorder';

jest.mock('expo-audio', () => ({ IOSOutputFormat: { LINEARPCM: 'lpcm' }, AudioQuality: { MAX: 127 } }));
const mockChanges = new Set<() => void>(), mockFiles = new Set<string>();
const mockMoves = jest.fn(), mockDeletes = jest.fn();
jest.mock('../src/lib/appCache', () => ({ subscribeCacheUser: (fn: () => void) => { mockChanges.add(fn); return () => mockChanges.delete(fn); } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'take-id' }));
jest.mock('expo-file-system', () => {
    class Entry {
        uri: string;
        constructor(...parts: Array<string | { uri: string }>) { this.uri = parts.map(p => typeof p === 'string' ? p : p.uri).join('/'); }
        get exists() { return mockFiles.has(this.uri); }
        create() { mockFiles.add(this.uri); }
        delete() { mockDeletes(this.uri); for (const file of mockFiles) if (file.startsWith(this.uri)) mockFiles.delete(file); }
        moveSync(destination: Entry) { mockMoves(this.uri, destination.uri); mockFiles.delete(this.uri); mockFiles.add(destination.uri); }
    }
    return { Directory: Entry, File: Entry, Paths: { cache: 'file://cache' } };
});

test('limits recording to both ten minutes and remaining whole timeline seconds', () => {
    expect(voiceoverLimitSeconds(0, 30)).toBe(600);
    expect(voiceoverLimitSeconds(17400, 30)).toBe(20);
    expect(voiceoverLimitSeconds(17999, 30)).toBe(0);
    expect(voiceoverLimitSeconds(-100, 24)).toBe(600);
    expect(voiceoverLimitSeconds(19000, 30)).toBe(0);
});
test('meter clamps dBFS and ignores missing or non-finite measurements', () => {
    expect([-90, -60, -30, 0, 10, undefined, NaN, Infinity].map(meterLevel)).toEqual([0, 0, .5, 1, 1, 0, 0, 0]);
    expect(clock(65)).toBe('1:05');
});
test('WAV signature excludes CAF and MPEG4 containers and truncated headers', () => {
    const bytes = (s: string) => Uint8Array.from([...s].map(c => c.charCodeAt(0)));
    expect(isWavHeader(bytes('RIFF1234WAVE'))).toBe(true);
    for (const value of ['caff1234WAVE', '1234ftypM4A ', 'RIFF1234WAV']) expect(isWavHeader(bytes(value))).toBe(false);
});
test('voiceover media uses the shared audio shape and truncates its name', () => {
    expect(voiceoverMedia('l-id', 1.99, 30, 'x'.repeat(200))).toEqual({ id: 'l-id', name: 'x'.repeat(120), kind: 'audio', frames: 59, hasAudio: true, width: 0, height: 0 });
    expect(voiceoverMedia('l-id', 0, 30, 'Voice').frames).toBe(1);
});
test('WAV PCM format fits the existing upload limit at the maximum duration', () => {
    expect(VOICEOVER_OPTIONS).toMatchObject({ extension: '.wav', sampleRate: 16000, numberOfChannels: 1, bitRate: 256000, isMeteringEnabled: true, ios: { outputFormat: 'lpcm', audioQuality: 127, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false } });
    expect(600 * VOICEOVER_OPTIONS.sampleRate * VOICEOVER_OPTIONS.numberOfChannels * 2 + 4096).toBeLessThan(20 * 1024 * 1024);
});
test('takes are moved into the dedicated cache and cleared on launch, account change and sign-out', () => {
    mockFiles.add('file://cache/veyrnox-voiceover');
    const takes = require('../src/lib/editorVoiceoverTakes') as typeof import('../src/lib/editorVoiceoverTakes');
    expect(mockDeletes).toHaveBeenCalledWith('file://cache/veyrnox-voiceover');
    for (const _event of ['owner change', 'sign-out']) {
        mockFiles.add('file://native.wav');
        expect(takes.adoptTake('file://native.wav')).toBe('file://cache/veyrnox-voiceover/take-take-id.wav');
        expect(mockMoves).toHaveBeenCalledWith('file://native.wav', 'file://cache/veyrnox-voiceover/take-take-id.wav');
        mockChanges.forEach(fn => fn());
        expect(mockFiles.size).toBe(0);
    }
    const uri = takes.adoptTake('file://other.wav'); takes.discardTake(uri);
    expect(mockFiles.has(uri!)).toBe(false);
});

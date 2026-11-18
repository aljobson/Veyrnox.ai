import {
    MUSIC_BPM_MAX, MUSIC_KEY_SCALES, MUSIC_TIME_SIGNATURES, mashupSeconds, parseMusicLibraryTabAction, parseMusicRemixQuote,
    parseMusicTempoControls, parsePlaylistCreate, parsePlaylistPatch, publicLyrics, renderPcmWavCrop, pcmWavSeconds,
} from '../src/lib/music/shared';

const UUID = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';
const KEY = 'music-key-12345678';

// A 1 s, 8 kHz, mono, 16-bit PCM WAV.
function wavOneSecond(): Uint8Array {
    const rate = 8000, data = rate * 2, b = new Uint8Array(44 + data), v = new DataView(b.buffer);
    const tag = (o: number, s: string) => [...s].forEach((c, i) => { b[o + i] = c.charCodeAt(0); });
    tag(0, 'RIFF'); v.setUint32(4, 36 + data, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, data, true);
    return b;
}

test('library-tab actions parse', () => {
    expect(parseMusicLibraryTabAction({ action: 'listen', song_id: UUID })).toMatchObject({ ok: true, action: 'listen', songId: UUID });
    expect(parseMusicLibraryTabAction({ action: 'create_hook', song_id: UUID, version_id: UUID, title: 'Hook', start_seconds: 1, end_seconds: 10, idempotency_key: KEY }).ok).toBe(true);
    expect(parseMusicLibraryTabAction({ action: 'create_hook', song_id: UUID, version_id: UUID, title: 'Hook', start_seconds: 1, end_seconds: 2, idempotency_key: KEY })).toEqual({ ok: false, error: 'hook_range_invalid' });
    expect(parseMusicLibraryTabAction({ action: 'set_cover', song_id: UUID, job_id: null })).toMatchObject({ ok: true, jobId: null });
    expect(parseMusicLibraryTabAction({ action: 'nope' })).toEqual({ ok: false, error: 'action_invalid' });
});

test('lyrics are trimmed to plain text or null', () => {
    expect(publicLyrics('  ')).toBeNull();
    expect(publicLyrics('la'.repeat(2000))!.length).toBe(3000);
});

test('playlist parsers', () => {
    expect(parsePlaylistCreate({ title: ' Mix ', idempotency_key: KEY })).toMatchObject({ ok: true, title: 'Mix' });
    expect(parsePlaylistCreate({ title: '', idempotency_key: KEY }).ok).toBe(false);
    expect(parsePlaylistPatch({ action: 'pin', expected_revision: 1, pinned: true, idempotency_key: KEY }).ok).toBe(true);
    expect(parsePlaylistPatch({ action: 'replace', expected_revision: 1, song_ids: [UUID, UUID], idempotency_key: KEY }).ok).toBe(false);
});

test('tempo controls', () => {
    expect(parseMusicTempoControls({ bpm: 120, key_scale: MUSIC_KEY_SCALES[0], time_signature: MUSIC_TIME_SIGNATURES[0].value })).toMatchObject({ ok: true, used: true });
    expect(parseMusicTempoControls({})).toMatchObject({ ok: true, used: false });
    expect(parseMusicTempoControls({ bpm: MUSIC_BPM_MAX + 1 })).toEqual({ ok: false, error: 'bpm_invalid' });
});

test('remix quote parsing and mashup length', () => {
    const sample = { kind: 'sample', version_id: UUID, prompt: 'p', rights_confirmed: true, start_seconds: 0, end_seconds: 10, extend_seconds: 30 };
    expect(parseMusicRemixQuote(sample)).toMatchObject({ ok: true, kind: 'sample', endSeconds: 10 });
    expect(parseMusicRemixQuote({ ...sample, rights_confirmed: false })).toEqual({ ok: false, error: 'source_rights_required' });
    expect(mashupSeconds(200, 90.1239)).toBe(90.123);
});

test('wav crop runs in the phone runtime', () => {
    const src = wavOneSecond();
    expect(pcmWavSeconds(src)).toBeCloseTo(1, 3);
    const out = renderPcmWavCrop(src, 0.25, 0.75);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.seconds).toBeCloseTo(0.5, 3);
});

test('pcmWavSeconds answers null for unreadable or unsupported audio', () => {
    expect(pcmWavSeconds(new Uint8Array(0))).toBeNull();
    expect(pcmWavSeconds(new Uint8Array(64).fill(7))).toBeNull(); // not RIFF/WAVE
    const mp3ish = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
    expect(pcmWavSeconds(mp3ish)).toBeNull();
});

import { createEditorSpeechClient, insertAutomaticCaptions } from '../src/lib/editorSpeechNative';
import { emptyTimeline } from '../src/lib/nativeEditorModel';

type NativeSpeechModule = NonNullable<Parameters<typeof createEditorSpeechClient>[0]>;
type MockNativeSpeech = jest.Mocked<NativeSpeechModule>;

const native = (permission = 'authorized'): MockNativeSpeech => ({
    permission: jest.fn(async () => ({ ok: true, permission })), requestPermission: jest.fn(async () => ({ ok: true, permission })),
    capabilities: jest.fn(async () => ({ ok: true, platform: 'ios', automaticCaptions: true, onDeviceRecognition: true,
        translation: true })),
    transcribe: jest.fn(async () => ({ ok: true, locale: 'en-US', onDevice: true, text: 'Hello world',
        segments: [{ text: 'Hello', startMs: 0, durationMs: 400 }, { text: 'world', startMs: 450, durationMs: 350 }] })),
    transcribePcm: jest.fn(async () => ({ ok: true, locale: 'en-US', onDevice: true, text: 'Hello world',
        segments: [{ text: 'Hello', startMs: 0, durationMs: 400 }, { text: 'world', startMs: 450, durationMs: 350 }] })),
    translate: jest.fn(async () => ({ ok: true, onDevice: true, sourceLocale: 'en-US', targetLocale: 'fr-FR', texts: ['Bonjour le monde'] })), cancel: jest.fn(),
}) as unknown as MockNativeSpeech;

test.each(['denied', 'restricted', 'revoked'] as const)('maps %s permission deterministically', async state => {
    const module = native(state), client = createEditorSpeechClient(module);
    await expect(client.transcribe('account', 'project', 'file:///input.mp4', 'en-US')).resolves.toEqual({ ok: false,
        code: state === 'revoked' ? 'permission-revoked' : state === 'restricted' ? 'permission-restricted' : 'permission-denied' });
    expect(module.transcribe).not.toHaveBeenCalled();
});

test('requires and preserves on-device timed recognition', async () => {
    const module = native(), client = createEditorSpeechClient(module);
    await expect(client.capabilities('en-US')).resolves.toMatchObject({ platform: 'ios', automaticCaptions: true, onDeviceRecognition: true,
        translation: true });
    await expect(client.transcribe('account', 'project', 'file:///input.mp4', 'en-US')).resolves.toEqual({ ok: true, value: {
        locale: 'en-US', onDevice: true, text: 'Hello world', segments: [{ text: 'Hello', startMs: 0, durationMs: 400 },
            { text: 'world', startMs: 450, durationMs: 350 }],
    } });
});

test('transcribes the bounded owned PCM artifact rather than passing its raw URI to Speech', async () => {
    const module = native(), client = createEditorSpeechClient(module);
    await expect(client.transcribePcm('account', 'project', 'artifact-123', 'en-US')).resolves.toMatchObject({ ok: true,
        value: { locale: 'en-US', onDevice: true, text: 'Hello world' } });
    expect(module.transcribePcm).toHaveBeenCalledWith('account', 'project', expect.stringMatching(/^speech-/),
        expect.stringMatching(/^speech-/), 'artifact-123', 'en-US');
    expect(module.transcribe).not.toHaveBeenCalled();
    await expect(client.transcribePcm('account', 'project', '../escape', 'en-US')).resolves.toEqual({ ok: false, code: 'invalid-input' });
});

test('translates complete cue phrases and estimates translated word timing inside the original cue', async () => {
    const module = native(), client = createEditorSpeechClient(module);
    const transcript = { locale: 'en-US', onDevice: true as const, text: 'Hello world', segments: [
        { text: 'Hello', startMs: 0, durationMs: 400 }, { text: 'world', startMs: 450, durationMs: 350 },
    ] };
    await expect(client.translate(transcript, 'fr-FR')).resolves.toEqual({ ok: true, value: {
        sourceLocale: 'en-US', locale: 'fr-FR', onDevice: true, text: 'Bonjour le monde', segments: [
            { text: 'Bonjour', startMs: 0, durationMs: 267, estimated: true },
            { text: 'le', startMs: 267, durationMs: 266, estimated: true },
            { text: 'monde', startMs: 533, durationMs: 267, estimated: true },
        ],
    } });
    expect(module.translate).toHaveBeenCalledWith('en-US', 'fr-FR', ['Hello world']);

    const translated = await client.translate(transcript, 'fr-FR');
    expect(translated.ok).toBe(true);
    if (translated.ok) expect(insertAutomaticCaptions({ ...emptyTimeline(), fps: 30 }, translated.value)?.text[0])
        .toMatchObject({ start: 0, len: 24, text: 'Bonjour le monde', wordsEstimated: true });
});

test('batches transcripts beyond the native 150-text translation bound', async () => {
    const module = native();
    module.translate.mockImplementation(async (_source, _target, texts) => ({ ok: true, onDevice: true,
        sourceLocale: 'en-US', targetLocale: 'fr-FR', texts: texts.map(text => `fr:${text}`) }));
    const client = createEditorSpeechClient(module), segments = Array.from({ length: 151 }, (_, index) => ({
        text: `phrase${index}`, startMs: index * 5_000, durationMs: 900,
    }));
    const result = await client.translate({ locale: 'en-US', onDevice: true, text: '', segments }, 'fr-FR');
    expect(result.ok).toBe(true); expect(module.translate).toHaveBeenCalledTimes(2);
    expect(module.translate.mock.calls.map(call => call[2].length)).toEqual([150, 1]);
});

test('aborting cancels the native recognition token', async () => {
    type NativeTranscription = Awaited<ReturnType<NativeSpeechModule['transcribe']>>;
    let resolve!: (value: NativeTranscription | PromiseLike<NativeTranscription>) => void; const module = native();
    module.transcribe = jest.fn<ReturnType<NativeSpeechModule['transcribe']>, Parameters<NativeSpeechModule['transcribe']>>(
        () => new Promise<NativeTranscription>(value => { resolve = value; }));
    const client = createEditorSpeechClient(module), controller = new AbortController();
    const result = client.transcribe('account', 'project', 'file:///input.mp4', 'en-US', controller.signal);
    await Promise.resolve(); await Promise.resolve(); controller.abort(); resolve({ ok: false, code: 'cancelled' });
    await expect(result).resolves.toEqual({ ok: false, code: 'cancelled' }); expect(module.cancel).toHaveBeenCalledTimes(1);
});

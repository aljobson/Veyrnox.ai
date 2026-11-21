import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { ApiError } from '../src/lib/api';
import { SmartCutAnalysisCard } from '../src/components/smart-cut/SmartCutAnalysisCard';
import { rawText, t } from '../src/lib/i18n';
import type { SpeechAnalysis } from '../src/lib/speechCut';

jest.setTimeout(30000);

let mockOwner: string;
let mockListeners: Set<() => void>;
const mockFetchQuote = jest.fn(), mockStart = jest.fn(), mockPoll = jest.fn(), mockRecover = jest.fn(), mockForget = jest.fn(), mockSpeechKeyFor = jest.fn();
const mockApi = {};
jest.mock('../src/lib/appCache', () => {
    mockOwner = 'owner'; mockListeners = new Set();
    return { getCacheUser: () => mockOwner, subscribeCacheUser: (listener: () => void) => { mockListeners.add(listener); return () => mockListeners.delete(listener); } };
});
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/editorFlag', () => ({ EDITOR_SPEECH_CUT_ENABLED: true }));
jest.mock('../src/lib/speechAnalysis', () => ({
    fetchSpeechQuote: (...args: unknown[]) => mockFetchQuote(...args),
    startSpeech: (...args: unknown[]) => mockStart(...args),
    pollSpeech: (...args: unknown[]) => mockPoll(...args),
    recoverSpeech: (...args: unknown[]) => mockRecover(...args),
    speechKeyFor: (...args: unknown[]) => mockSpeechKeyFor(...args),
    forgetSpeechKey: (...args: unknown[]) => mockForget(...args),
    speechMessage: (error: unknown) => String((error as { code?: string } | null)?.code || 'speech_failed'),
}));

const clip = { jobId: '33333333-3333-4333-8333-333333333333', label: 'Interview', duration: 12 };
const analysis: SpeechAnalysis = {
    version: 1, assetId: clip.jobId, duration: clip.duration, provider: 'fal-scribe-v2', transcript: 'hello', language: 'en', timingQuality: 'word',
    chunks: [{ start: 1, end: 1.5, text: 'hello' }],
};
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
let root: Root, onAnalysed: jest.Mock;
const button = (label: string) => root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === rawText(label))[0];
const lines = () => root.container.queryAll(node => node.children.some(child => typeof child === 'string')).map(node => node.children.filter(child => typeof child === 'string').join(''));
async function render(clips = [clip], onBusyChange?: (busy: boolean) => void) {
    await act(async () => root.render(<SmartCutAnalysisCard clips={clips} analyses={new Map()} onAnalysed={onAnalysed} onBusyChange={onBusyChange} />));
}
async function press(label: string) {
    const control = button(label); expect(control).toBeDefined();
    await act(async () => { control.props.onClick(event); await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); mockOwner = 'owner'; root = createRoot(); onAnalysed = jest.fn();
    mockSpeechKeyFor.mockReset().mockReturnValue('speech-key');
    mockFetchQuote.mockResolvedValue({ credits: 7, max_seconds: 60, languages: ['en'] });
});
afterEach(async () => { await act(async () => root.unmount()); });

test('requires explicit confirmation and never understates conflicting later debit evidence', async () => {
    mockStart.mockResolvedValue({ id: 'request', status: 'queued', credits: 0 });
    mockPoll.mockResolvedValue({ id: 'request', status: 'completed', analysis, credits: 7 });
    await render();
    expect(mockStart).not.toHaveBeenCalled();
    expect(button(t('app.smartCut.native.analyse.start')).props.accessibilityState.disabled).toBe(false);
    await press(t('app.smartCut.native.analyse.start'));
    expect(mockStart).toHaveBeenCalledTimes(1); expect(mockPoll).toHaveBeenCalledTimes(1);
    expect(onAnalysed).toHaveBeenCalledWith(clip.jobId, analysis);
    expect(lines()).toContain(t('app.smartCut.native.analyse.charged', { name: clip.label, credits: 7 }));
});

test('a transient quote failure explains that nothing started and can retry', async () => {
    mockFetchQuote.mockRejectedValueOnce(new ApiError(503, 'unavailable'))
        .mockResolvedValueOnce({ credits: 7, max_seconds: 60, languages: ['en'] });
    await render();
    expect(lines()).toContain(t('app.smartCut.native.analyse.quoteFailed'));
    expect(mockStart).not.toHaveBeenCalled();

    await press(t('app.smartCut.native.analyse.quoteRetry'));

    expect(mockFetchQuote).toHaveBeenCalledTimes(2);
    expect(button(t('app.smartCut.native.analyse.start'))).toBeDefined();
});

test('rejects and names a completed analysis that belongs to a different clip', async () => {
    const mismatched = { ...analysis, assetId: '44444444-4444-4444-8444-444444444444' };
    mockStart.mockResolvedValue({ id: 'request', status: 'completed', analysis: mismatched, credits: 0 });
    await render(); await press(t('app.smartCut.native.analyse.start'));
    expect(onAnalysed).not.toHaveBeenCalled();
    expect(lines()).toContain(t('app.smartCut.native.analyse.mismatchNoCharge', { name: clip.label, reason: 'analysis_asset_mismatch' }));
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeUndefined();
    expect(button(t('app.smartCut.native.analyse.start'))).toBeUndefined();
});

test.each(['consent_declined', 'insufficient_balance'])('%s is definitive and allows a fresh confirmed attempt', async (code) => {
    mockStart.mockRejectedValueOnce(new ApiError(code === 'insufficient_balance' ? 402 : 403, code));
    await render(); await press(t('app.smartCut.native.analyse.start'));
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeUndefined();
    expect(button(t('app.smartCut.native.analyse.start'))).toBeDefined();
});

test('an outcome whose acceptance is unknown stays recoverable', async () => {
    const onBusyChange = jest.fn();
    mockStart.mockRejectedValueOnce(new ApiError(503, 'outcome_pending'));
    await render([clip], onBusyChange); await press(t('app.smartCut.native.analyse.start'));
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeDefined();
    expect(button(t('app.smartCut.native.analyse.start'))).toBeUndefined();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
});

test('a transient polling failure keeps the accepted request recoverable', async () => {
    mockStart.mockResolvedValue({ id: 'request', status: 'queued', credits: 7 });
    mockPoll.mockRejectedValue(new ApiError(503, 'internal'));
    await render(); await press(t('app.smartCut.native.analyse.start'));
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeDefined();
    expect(button(t('app.smartCut.native.analyse.start'))).toBeUndefined();
});

test('adding a clip preserves a pending recovery key and its billing guidance', async () => {
    const second = { jobId: '55555555-5555-4555-8555-555555555555', label: 'Second take', duration: 9 };
    mockStart.mockRejectedValueOnce(new ApiError(503, 'outcome_pending'));
    await render(); await press(t('app.smartCut.native.analyse.start'));
    expect(lines()).toContain('outcome_pending');

    await render([clip, second]);

    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeDefined();
    expect(lines()).toContain('outcome_pending');
    mockRecover.mockResolvedValue({ id: 'request', status: 'completed', analysis, credits: 7 });
    await press(t('app.smartCut.native.analyse.checkStatus'));
    expect(mockRecover).toHaveBeenCalledWith(mockApi, 'speech-key', 'owner', expect.any(AbortSignal));
});

test('no speech is terminal for this clip and does not strand a status action', async () => {
    mockStart.mockResolvedValue({ id: 'request', status: 'completed', speech: false, credits: 0 });
    await render(); await press(t('app.smartCut.native.analyse.start'));
    expect(lines()).toContain(t('app.smartCut.native.analyse.noSpeech', { name: clip.label }));
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeUndefined();
    expect(button(t('app.smartCut.native.analyse.start'))).toBeUndefined();
    expect(lines()).toContain(t('app.smartCut.native.analyse.terminalBlocked', { names: clip.label }));
    expect(lines()).not.toContain(t('app.smartCut.native.analyse.blocked', { names: clip.label }));
});

test('missing billing evidence stays a per-clip maximum instead of being called free', async () => {
    mockStart.mockResolvedValue({ id: 'request', status: 'completed', analysis });
    await render(); await press(t('app.smartCut.native.analyse.start'));
    expect(lines()).toContain(t('app.smartCut.native.analyse.clipMaximum', { name: clip.label, credits: 7 }));
    expect(lines()).not.toContain(t('app.smartCut.native.analyse.reused', { name: clip.label }));
});

test('a new completed analysis reports the durable positive debit', async () => {
    mockStart.mockResolvedValue({ id: 'request', status: 'completed', analysis, credits: 7 });
    await render(); await press(t('app.smartCut.native.analyse.start'));
    expect(lines()).toContain(t('app.smartCut.native.analyse.charged', { name: clip.label, credits: 7 }));
});

test('price changes refresh the confirmed maximum before a retry', async () => {
    mockStart.mockRejectedValueOnce(new ApiError(409, 'price_changed', { credits: 9 }));
    await render(); await press(t('app.smartCut.native.analyse.start'));
    expect(lines()).toContain(t('app.smartCut.native.analyse.maximum', { total: 9, credits: 9 }));
    mockStart.mockResolvedValueOnce({ id: 'request', status: 'completed', analysis, credits: 9 });
    await press(t('app.smartCut.native.analyse.start'));
    expect(mockStart.mock.calls[1][1]).toMatchObject({ credits: 9, key: 'speech-key' });
});

test('a refunded POST forgets the failed key and a retry uses a fresh key', async () => {
    mockSpeechKeyFor.mockReturnValueOnce('refunded-key').mockReturnValueOnce('fresh-key');
    mockStart.mockRejectedValueOnce(new ApiError(502, 'provider_rejected', { refunded: true, credits: 7 }));
    await render(); await press(t('app.smartCut.native.analyse.start'));
    expect(mockForget).toHaveBeenCalledWith('owner', clip.jobId);
    expect(lines()).toContain(t('app.smartCut.native.analyse.refunded', { name: clip.label }));
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeUndefined();
    mockStart.mockResolvedValueOnce({ id: 'retry', status: 'completed', analysis, credits: 7 });
    await press(t('app.smartCut.native.analyse.start'));
    expect(mockStart.mock.calls[1][1]).toMatchObject({ key: 'fresh-key' });
});

test('cancellation is neutral, recoverable, and account change never releases the old analysis', async () => {
    mockStart.mockImplementation((_api, _input, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })));
    await render();
    await press(t('app.smartCut.native.analyse.start'));
    await press(t('app.smartCut.native.analyse.cancel'));
    expect(lines()).toContain(t('app.smartCut.native.analyse.cancelled'));
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeDefined();
    await act(async () => { mockOwner = 'other'; mockListeners.forEach(listener => listener()); });
    expect(onAnalysed).not.toHaveBeenCalled();
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeUndefined();
});

test('status recovery uses the same key and accepts a durable completed result', async () => {
    mockStart.mockResolvedValue({ id: 'request', status: 'failed', refunded: false, credits: 7 });
    mockRecover.mockResolvedValue({ id: 'request', status: 'completed', analysis, credits: 7 });
    await render(); await press(t('app.smartCut.native.analyse.start'));
    expect(lines()).toContain(t('app.smartCut.native.analyse.failedCharged', { name: clip.label, credits: 7 }));
    await press(t('app.smartCut.native.analyse.checkStatus'));
    expect(mockRecover).toHaveBeenCalledWith(mockApi, 'speech-key', 'owner', expect.any(AbortSignal));
    expect(onAnalysed).toHaveBeenCalledWith(clip.jobId, analysis);
});

test('a repeatedly confirmed non-refunded failure becomes terminal instead of looping forever', async () => {
    mockStart.mockResolvedValue({ id: 'request', status: 'failed', refunded: false, credits: 7 });
    mockRecover.mockResolvedValue({ id: 'request', status: 'failed', refunded: false, credits: 7 });
    await render(); await press(t('app.smartCut.native.analyse.start'));
    await press(t('app.smartCut.native.analyse.checkStatus'));
    expect(lines()).toContain(t('app.smartCut.native.analyse.failedConfirmed', { name: clip.label }));
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeUndefined();
    expect(button(t('app.smartCut.native.analyse.start'))).toBeUndefined();
});

test('a repeatedly malformed accepted result becomes terminal instead of looping forever', async () => {
    mockStart.mockRejectedValue(new ApiError(503, 'outcome_pending'));
    mockRecover.mockRejectedValue(new ApiError(200, 'bad_response'));
    await render(); await press(t('app.smartCut.native.analyse.start'));
    await press(t('app.smartCut.native.analyse.checkStatus'));
    expect(lines()).toContain(t('app.smartCut.native.analyse.clipMaximum', { name: clip.label, credits: 7 }));
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeUndefined();
    expect(button(t('app.smartCut.native.analyse.start'))).toBeUndefined();
});

test('an ineligible clip is named in the blocker and cannot expose a paid confirmation', async () => {
    const long = { ...clip, label: 'Long interview', duration: 61 };
    await render([long]);
    expect(lines()).toContain(t('app.smartCut.native.analyse.ineligibleBlocked', { names: long.label }));
    expect(button(t('app.smartCut.native.analyse.start'))).toBeUndefined();
});

test('a missing accepted request leaves recovery and allows a newly confirmed attempt', async () => {
    mockStart.mockResolvedValue({ id: 'request', status: 'failed', refunded: false, credits: 7 });
    mockRecover.mockRejectedValue(new ApiError(404, 'request_not_found'));
    await render(); await press(t('app.smartCut.native.analyse.start'));
    await press(t('app.smartCut.native.analyse.checkStatus'));
    expect(mockForget).toHaveBeenCalledWith('owner', clip.jobId);
    expect(lines()).toContain(t('app.smartCut.native.analyse.notAccepted', { name: clip.label }));
    expect(button(t('app.smartCut.native.analyse.checkStatus'))).toBeUndefined();
    expect(button(t('app.smartCut.native.analyse.start'))).toBeDefined();
});

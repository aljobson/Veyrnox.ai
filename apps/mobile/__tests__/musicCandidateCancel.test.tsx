import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { AccessibilityInfo, Alert } from 'react-native';
import { MusicCandidateCard } from '../src/components/music/MusicCandidateCard';
import { MusicQueue } from '../src/components/music/MusicQueue';
import { ApiError, type ApiClient } from '../src/lib/api';
import { plural, t } from '../src/lib/i18n';
import { custom, view } from './fixtures/musicCreate';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../src/components/music/MusicPlayer', () => ({ MusicPlayer: () => null }));

let root: Root;
let request: jest.Mock;
let api: ApiClient;
const candidate = { ...view.candidates[0], state: 'queued' };
const buttons = () => root.container.queryAll(node => node.props.accessibilityRole === 'button');
const button = (label: string) => buttons().find(node => node.props.accessibilityLabel === label);
const visible = (value: string) => root.container.queryAll(node => node.children.includes(value));
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks();
    request = jest.fn(); api = { request } as unknown as ApiClient;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
});
afterEach(async () => {
    await act(async () => root.unmount());
    jest.restoreAllMocks(); jest.useRealTimers();
});

test('queued candidate probes immediately, confirms once, refreshes and keeps exact paid copy', async () => {
    const refresh = jest.fn(), afterCancel = jest.fn();
    let finish!: (value: unknown) => void;
    request.mockResolvedValueOnce({ cancellable: true, credits: 5 })
        .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await act(async () => root.render(<MusicCandidateCard candidate={candidate} onPlay={jest.fn()}
        cancellation={{ api, refresh, afterCancel }} />));
    await flush();
    expect(request).toHaveBeenCalledWith(`/api/v1/jobs/${candidate.job_id}/cancel`, { method: 'GET' });
    expect(button(t('jobCancel.confirm'))).toBeDefined();
    await act(async () => button(t('jobCancel.confirm'))!.props.onClick({ nativeEvent: {} }));
    const actions = alert.mock.calls[0][2]!;
    const confirm = actions.find(action => action.style === 'destructive')!;
    await act(async () => { confirm.onPress?.(); confirm.onPress?.(); });
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    await act(async () => finish({ cancelled: true, replayed: false, credits: 5 }));
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(afterCancel).toHaveBeenCalledTimes(1);
    expect(visible(plural('jobCancel.cancelled', 5))).toHaveLength(1);
    expect(button(t('jobCancel.confirm'))).toBeUndefined();
});

test('transient GET and job_started refusal stay on the bounded queued re-check path', async () => {
    request.mockRejectedValueOnce(new ApiError(503, 'temporarily_unavailable'))
        .mockResolvedValueOnce({ cancellable: true, credits: 5 })
        .mockRejectedValueOnce(new ApiError(409, 'job_started'))
        .mockResolvedValueOnce({ cancellable: true, credits: 5 });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await act(async () => root.render(<MusicCandidateCard candidate={candidate} onPlay={jest.fn()}
        cancellation={{ api, refresh: jest.fn() }} />)); await flush();
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTimeAsync(15_000));
    expect(button(t('jobCancel.confirm'))).toBeDefined();
    await act(async () => button(t('jobCancel.confirm'))!.props.onClick({ nativeEvent: {} }));
    await act(async () => alert.mock.calls[0][2]!.find(action => action.style === 'destructive')!.onPress?.()); await flush();
    expect(visible(t('jobCancel.started'))).toHaveLength(1);
    await act(async () => jest.advanceTimersByTimeAsync(15_000));
    expect(button(t('jobCancel.confirm'))).toBeDefined();
    expect(visible(t('jobCancel.started'))).toHaveLength(0);
});

test('probe honors Retry-After, keeps checking false and reveals a later true capability', async () => {
    request.mockRejectedValueOnce(new ApiError(429, 'rate_limited', { retryAfterSeconds: 18 }))
        .mockResolvedValueOnce({ cancellable: false, credits: 0 })
        .mockResolvedValueOnce({ cancellable: true, credits: 0 });
    await act(async () => root.render(<MusicCandidateCard candidate={candidate} onPlay={jest.fn()}
        cancellation={{ api, refresh: jest.fn() }} />));
    await flush(); expect(request).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTimeAsync(17_999)); expect(request).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTimeAsync(1)); expect(request).toHaveBeenCalledTimes(2);
    expect(button(t('jobCancel.confirm'))).toBeUndefined();
    await act(async () => jest.advanceTimersByTimeAsync(14_999)); expect(request).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTimeAsync(1)); expect(request).toHaveBeenCalledTimes(3);
    expect(button(t('jobCancel.confirm'))).toBeDefined();
    await act(async () => root.unmount()); root = createRoot();
    await act(async () => jest.advanceTimersByTimeAsync(60_000)); expect(request).toHaveBeenCalledTimes(3);
});

test('a late probe cannot resurrect the action after a confirmed free cancellation', async () => {
    let gets = 0, finishProbe!: (value: unknown) => void;
    request.mockImplementation((_path, init) => {
        if (init?.method === 'POST') return { cancelled: true, replayed: false, credits: 0 };
        if (++gets === 1) return { cancellable: true, credits: 0 };
        return new Promise(resolve => { finishProbe = resolve; });
    });
    const refresh = jest.fn(), alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await act(async () => root.render(<MusicCandidateCard candidate={candidate} onPlay={jest.fn()}
        cancellation={{ api, refresh }} />)); await flush();
    await act(async () => jest.advanceTimersByTimeAsync(15_000));
    await act(async () => button(t('jobCancel.confirm'))!.props.onClick({ nativeEvent: {} }));
    const actions = alert.mock.calls[0][2]!;
    expect(alert.mock.calls[0][1]).toBe(t('jobCancel.confirmFree'));
    await act(async () => actions.find(action => action.style === 'destructive')!.onPress?.()); await flush();
    expect(visible(t('jobCancel.cancelledFree'))).toHaveLength(1);
    await act(async () => finishProbe({ cancellable: true, credits: 0 })); await flush();
    expect(button(t('jobCancel.confirm'))).toBeUndefined();
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
});

test('uncertain refusal refreshes the owner and resumes bounded probing', async () => {
    request.mockResolvedValueOnce({ cancellable: true, credits: 5 })
        .mockRejectedValueOnce(new ApiError(0, 'network'))
        .mockResolvedValueOnce({ cancellable: true, credits: 5 });
    const refresh = jest.fn(), alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await act(async () => root.render(<MusicCandidateCard candidate={candidate} onPlay={jest.fn()}
        cancellation={{ api, refresh }} />)); await flush();
    await act(async () => button(t('jobCancel.confirm'))!.props.onClick({ nativeEvent: {} }));
    await act(async () => alert.mock.calls[0][2]!.find(action => action.style === 'destructive')!.onPress?.()); await flush();
    expect(visible(t('jobCancel.unsure'))).toHaveLength(1); expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTimeAsync(14_999)); expect(request).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTimeAsync(1)); expect(request).toHaveBeenCalledTimes(3);
    expect(button(t('jobCancel.confirm'))).toBeDefined();
});

test('MusicQueue probes each queued candidate through its owning generation refresh', async () => {
    request.mockResolvedValue({ cancellable: true, credits: 5 });
    const refresh = jest.fn();
    const queuedView = { ...view, state: 'queued' as const,
        candidates: view.candidates.map(item => ({ ...item, state: 'queued' as const })) };
    const entry = { id: view.id, createdAt: 0, missing: false, input: custom, view: queuedView };
    await act(async () => root.render(<MusicQueue entries={[entry]} activeCount={1} limit={4} api={api} refresh={refresh} />));
    await flush();
    expect(request.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(queuedView.candidates.length);
    expect(buttons().filter(node => node.props.accessibilityLabel === t('jobCancel.confirm'))).toHaveLength(queuedView.candidates.length);
});

test('terminal user cancellation persists zero-credit truth without exposing a cancel action', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await act(async () => root.render(<MusicCandidateCard candidate={{ ...candidate, state: 'refunded',
        error_code: 'user_cancelled', credits: 0 }} onPlay={jest.fn()} />));
    expect(visible(t('music.create.cancelled'))).toHaveLength(1);
    expect(visible(t('jobCancel.cancelledFree'))).toHaveLength(1);
    expect(button(t('jobCancel.confirm'))).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(t('jobCancel.cancelledFree'));
});

test.each([[0, 'music.create.refundedFree'], [5, 'music.create.refundedPaid']] as const)(
    'operational refund with %i credits uses source-accurate copy', async (credits, key) => {
        await act(async () => root.render(<MusicCandidateCard candidate={{ ...candidate, state: 'refunded',
            error_code: 'provider_failed', credits }} onPlay={jest.fn()} />));
        expect(visible(t(key))).toHaveLength(1);
        expect(visible(t('music.create.refunded'))).toHaveLength(0);
    });

test('older projection without credits keeps only permanent Cancelled copy', async () => {
    await act(async () => root.render(<MusicCandidateCard candidate={{ ...candidate, state: 'refunded',
        error_code: 'user_cancelled', credits: undefined }} onPlay={jest.fn()} />));
    expect(visible(t('music.create.cancelled'))).toHaveLength(1);
    expect(visible(t('jobCancel.done'))).toHaveLength(0);
});

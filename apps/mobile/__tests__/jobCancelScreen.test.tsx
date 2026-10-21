import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import JobScreen from '../src/app/(app)/job/[id]';
import { ApiError } from '../src/lib/api';
import { mediaApi, waitForJob, type JobState } from '../src/lib/media';
import { plural, t } from '../src/lib/i18n';

const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: () => null, useLocalSearchParams: () => ({ id: 'job-id' }), useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('../src/components/JobProvenance', () => ({ JobProvenance: () => null }));
jest.mock('../src/components/StemList', () => ({ StemList: () => null }));
jest.mock('../src/lib/output', () => ({ saveOutput: jest.fn(), shareOutput: jest.fn() }));
jest.mock('../src/lib/media', () => ({ mediaApi: jest.fn(), waitForJob: jest.fn() }));
void [RN.ActivityIndicator, RN.Pressable, RN.ScrollView, RN.StyleSheet, RN.Text, RN.View];
let root: Root;
let onState: (state: JobState) => void;
let finish: (state: JobState) => void;
let getJob: jest.Mock;
let alert: jest.SpyInstance;
function pendingPoll(_media: unknown, _id: string, update: (state: JobState) => void) {
    onState = update; update('queued');
    return new Promise<JobState>(resolve => { finish = resolve; });
}
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    getJob = jest.fn().mockResolvedValue({ state: 'failed', credits: 17, model_id: 'model', error_code: 'user_cancelled', refunded: true });
    jest.mocked(mediaApi).mockReturnValue({ getJob, getAsset: jest.fn() } as unknown as ReturnType<typeof mediaApi>);
    jest.mocked(waitForJob).mockImplementation(pendingPoll);
    mockRequest.mockResolvedValue({ cancellable: true, credits: 17 });
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); });
async function render() { await act(async () => root.render(<JobScreen />)); }
function buttons(label = t('jobCancel.confirm')) {
    return root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label);
}
function text(message: string) { return root.container.queryAll(node => node.children.includes(message)); }
async function open() {
    expect(buttons()).toHaveLength(1);
    await act(async () => buttons()[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
function confirm() { return alert.mock.calls[0][2][1].onPress; }
function live(message: string) {
    expect(text(message)).toHaveLength(1);
    expect(text(message)[0].props.accessibilityLiveRegion).toBe('polite');
}
test.each([false, null, 'off'])('quietly hides unavailable status %p', async status => {
    if (status === 'off') mockRequest.mockRejectedValue(new ApiError(404, 'not_found'));
    else mockRequest.mockResolvedValue(status === null ? null : { cancellable: status, credits: 17 });
    await render();
    expect(buttons()).toHaveLength(0);
    expect(text(t('jobCancel.unsure'))).toHaveLength(0);
    expect(text(t('jobCancel.unavailable'))).toHaveLength(0);
});
test('checks once per queued poll, hides on running, ignores a stale status response', async () => {
    await render(); expect(mockRequest).toHaveBeenCalledTimes(1);
    let resolve!: (r: unknown) => void;
    mockRequest.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await act(async () => onState('queued'));
    expect(mockRequest).toHaveBeenCalledTimes(2);
    await act(async () => onState('running'));
    await act(async () => resolve({ cancellable: true, credits: 17 }));
    expect(buttons()).toHaveLength(0);
});
test.each([0, 1, 17])('confirmation uses server credits %i and catalog copy', async credits => {
    mockRequest.mockResolvedValue({ cancellable: true, credits });
    await render(); await open();
    expect(alert).toHaveBeenCalledWith(t('jobCancel.confirmTitle'), credits ? plural('jobCancel.confirmPaid', credits) : t('jobCancel.confirmFree'), expect.any(Array));
    expect(alert.mock.calls[0][2][0]).toMatchObject({ text: t('jobCancel.keep'), style: 'cancel' });
    expect(alert.mock.calls[0][2][1]).toMatchObject({ style: 'destructive' });
});
test('one POST despite repeated confirmation; busy control, done feedback and re-poll', async () => {
    await render(); await open();
    let resolve!: (r: unknown) => void;
    mockRequest.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    let sending!: Promise<void>;
    await act(async () => { sending = confirm()(); void confirm()(); });
    expect(mockRequest.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    expect(buttons(t('jobCancel.cancelling'))[0].props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    mockRequest.mockResolvedValue({ cancellable: false, credits: 17 });
    await act(async () => { resolve({ cancelled: true, replayed: false, credits: 17 }); await sending; });
    live(t('jobCancel.done'));
    expect(waitForJob).toHaveBeenCalledTimes(2);
    await act(async () => { onState('failed'); finish('failed'); });
    expect(text(plural('jobCancel.cancelled', 17))).toHaveLength(1);
    expect(text(t('job.failed'))).toHaveLength(0);
});
test.each([
    [409, 'job_started', 'started', true], [409, 'job_finished', 'finished', true],
    [404, 'not_found', 'unavailable', true], [403, 'account_frozen', 'frozen', false],
    [429, 'rate_limited', 'rateLimited', false],
] as const)('typed refusal %s/%s has visible feedback', async (status, code, key, hidden) => {
    await render(); await open();
    mockRequest.mockRejectedValueOnce(new ApiError(status, code));
    await act(async () => confirm()());
    live(t(`jobCancel.${key}`));
    expect(buttons()).toHaveLength(hidden ? 0 : 1);
    expect(waitForJob).toHaveBeenCalledTimes(1);
});
test('lost acknowledgement re-polls, then shows the authoritative cancellation', async () => {
    await render(); await open();
    mockRequest.mockRejectedValueOnce(new ApiError(502, 'internal'));
    await act(async () => confirm()());
    live(t('jobCancel.unsure'));
    expect(waitForJob).toHaveBeenCalledTimes(2);
    expect(root.container.queryAll(node => node.children.some(c => typeof c === 'string' && c.includes('Nothing was changed')))).toHaveLength(0);
    await act(async () => { onState('failed'); finish('failed'); });
    expect(text(plural('jobCancel.cancelled', 17))).toHaveLength(1);
    expect(text(t('job.failed'))).toHaveLength(0);
    expect(buttons()).toHaveLength(0);
});
test.each([0, 1])('terminal cancelled job uses the refunded flag and server credits %i', async credits => {
    getJob.mockResolvedValue({ state: 'failed', credits, model_id: 'model', error_code: 'user_cancelled', refunded: true });
    await render(); await act(async () => { onState('failed'); finish('failed'); });
    expect(text(credits ? plural('jobCancel.cancelled', credits) : t('jobCancel.cancelledFree'))).toHaveLength(1);
    expect(text(t('job.failed'))).toHaveLength(0);
    expect(text(t('recovery.retry'))).toHaveLength(1);
});
test('user_cancelled without a confirmed refund still shows the ordinary failed state', async () => {
    getJob.mockResolvedValue({ state: 'failed', credits: 17, model_id: 'model', error_code: 'user_cancelled', refunded: false });
    await render(); await act(async () => { onState('failed'); finish('failed'); });
    expect(text(t('job.failed'))).toHaveLength(1);
});

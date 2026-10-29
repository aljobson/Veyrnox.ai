import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import JobScreen from '../src/app/(app)/job/[id]';
import { mediaApi, waitForJob, type JobState } from '../src/lib/media';
import { plural, t } from '../src/lib/i18n';

const mockApi = { request: jest.fn(async () => ({ cancellable: false })) };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: () => null, useLocalSearchParams: () => ({ id: 'job' }), useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('../src/components/JobProvenance', () => ({ JobProvenance: () => null }));
jest.mock('../src/components/StemList', () => ({ StemList: () => null }));
jest.mock('../src/components/InlineMedia', () => ({ InlineMedia: () => null }));
jest.mock('../src/components/FacelessSoundCard', () => ({ FacelessSoundCard: () => null }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: (props: any) => jest.requireActual('react').createElement('mock-vey', props) }));
jest.mock('../src/lib/output', () => ({ saveOutput: jest.fn(), shareOutput: jest.fn() }));
jest.mock('../src/lib/media', () => ({ mediaApi: jest.fn(), waitForJob: jest.fn() }));
jest.mock('../src/lib/celebrate', () => ({ celebrateOutput: jest.fn(), afterCelebration: jest.fn() }));
jest.mock('../src/lib/storeReview', () => ({ loadReviewAsk: async () => null }));
void [RN.ActivityIndicator, RN.View, RN.Text, RN.StyleSheet, RN.ScrollView, RN.Pressable];
let root: Root, update: (state: JobState) => void, finish: (state: JobState) => void;
const getJob = jest.fn();
const getAsset = jest.fn();
const vey = () => root.container.queryAll(n => n.type === 'mock-vey');
function live(key: string) {
    const nodes = root.container.queryAll(n => n.children.includes(key));
    expect(nodes).toHaveLength(1); expect(nodes[0].props.accessibilityLiveRegion).toBe('polite');
}
async function render() { await act(async () => root.render(<JobScreen />)); }
async function complete(state: JobState) { await act(async () => { update(state); finish(state); }); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks();
    getJob.mockResolvedValue({ state: 'failed', model_id: 'model', credits: 17 });
    getAsset.mockResolvedValue({ url: 'https://file', mime_type: 'image/png' });
    jest.mocked(mediaApi).mockReturnValue({ getJob, getAsset } as unknown as ReturnType<typeof mediaApi>);
    jest.mocked(waitForJob).mockImplementation((_media, _id, onState) => {
        update = onState; onState('queued'); return new Promise<JobState>(resolve => { finish = resolve; });
    });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
test('waiting uses interactive working Vey, no spinner, and unchanged status and waiting controls', async () => {
    await render(); expect(vey()).toHaveLength(1); expect(vey()[0].props).toMatchObject({ mood: 'working', width: 96, interactive: true });
    expect(root.container.queryAll(n => n.type.includes('ActivityIndicator'))).toHaveLength(0);
    live(t('job.queued'));
    await act(async () => update('running')); live(t('job.running'));
    expect(vey()[0].props.mood).toBe('working');
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('job.stopWaiting'))).toHaveLength(1);
    expect(root.container.queryAll(n => n.children.includes(t('job.waiting', { elapsed: '0s' })))).toHaveLength(1);
});
test('poll-ended still-working status retains working Vey', async () => {
    await render(); await complete('running'); expect(vey()[0].props.mood).toBe('working'); live(t('job.stillWorking'));
});
test('failure uses worried Vey above the unchanged live error', async () => {
    await render(); await complete('failed'); expect(vey()[0].props.mood).toBe('worried'); live(t('job.failed'));
    const error = root.container.queryAll(n => n.children.includes(t('job.failed')))[0];
    expect(error.parent!.children.indexOf(vey()[0])).toBeLessThan(error.parent!.children.indexOf(error));
});
test.each([0, 17])('user-cancelled refunded job uses idle, preserving refunded text (%i credits)', async credits => {
    getJob.mockResolvedValue({ state: 'failed', model_id: 'model', credits, error_code: 'user_cancelled', refunded: true });
    await render(); await complete('failed'); expect(vey()[0].props.mood).toBe('idle');
    live(credits ? plural('jobCancel.cancelled', credits) : t('jobCancel.cancelledFree'));
});
test('result replaces Vey', async () => {
    getJob.mockResolvedValue({ state: 'succeeded', model_id: 'model' });
    await render(); await complete('succeeded'); expect(vey()).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.source?.uri === 'https://file')).toHaveLength(1);
});

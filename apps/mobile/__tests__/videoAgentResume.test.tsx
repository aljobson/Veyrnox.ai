import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Agent from '../src/app/(app)/create/agent';
import { AGENT_MODEL_ID, RESUME_MAX_AGE_MS, RESUME_MAX_PAGES, pickResumableAgentJob, findResumableAgentJob, approvePlan, requestPlan } from '../src/lib/montage';
import type { Job, JobPage } from '../src/lib/media';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
declare const require: (id: string) => any;
declare const __dirname: string;
const { spawnSync } = require('child_process');
const { resolve } = require('path');
const now = Date.now();
const job = (overrides: Partial<Job> = {}): Job => ({ job_id: 'agent-job', model_id: AGENT_MODEL_ID, state: 'running', credits: 20, created_at: new Date(now - 60_000).toISOString(), has_asset: false, ...overrides });
const next = { before: new Date(now - 600_000).toISOString(), before_id: 'cursor' };
const images = () => Array.from({ length: 24 }, (_, i) => job({ job_id: `image-${i}`, model_id: 'image', created_at: new Date(now - i * 20_000).toISOString() }));
const page = (jobs: Job[], cursor: JobPage['next'] = null): JobPage => ({ jobs, next: cursor });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('newest running agent job wins over an older queued one', () => {
    expect(pickResumableAgentJob([job(), job({ job_id: 'old', state: 'queued' })], now)).toEqual({ jobId: 'agent-job', credits: 20 });
    expect(pickResumableAgentJob([job({ state: 'queued', credits: NaN })], now)).toEqual({ jobId: 'agent-job', credits: 0 });
});
test.each([
    { state: 'succeeded' }, { state: 'failed' }, { model_id: 'image' }, { job_id: '' },
    { created_at: new Date(now - 61 * 60_000).toISOString() }, { created_at: new Date(now - RESUME_MAX_AGE_MS).toISOString() },
    { created_at: new Date(now + 1).toISOString() }, { created_at: 'not a date' },
] as Partial<Job>[])('rejects nonresumable row %p', overrides => expect(pickResumableAgentJob([job(overrides)], now)).toBeNull());
test('matches the web picker after the web history filter on equivalent valid timestamps', () => {
    // The phone additionally rejects future/unparsable server timestamps, tested above.
    const rows = [job({ model_id: 'image' }), job({ state: 'succeeded' }), job({ created_at: new Date(now - 61 * 60_000).toISOString() }), job({ job_id: '' }), job(), job({ job_id: 'old', state: 'queued' })];
    const histories = [rows, rows.slice(0, 4)];
    const script = `import { pickResumable } from './app/veyrnox/_lib/videoAgentResume.js';
        import { jobsToWatch } from './app/veyrnox/_lib/jobHistory.js';
        const histories = ${JSON.stringify(histories)};
        console.log(JSON.stringify(histories.map(rows => {
            const history = rows.map(j => ({...j, submitted_at: Date.parse(j.created_at), settled: ['succeeded','failed'].includes(j.state) ? j.state : undefined}));
            const hit = pickResumable(jobsToWatch(history, ${now}), 'video-agent');
            return hit ? {jobId: hit.job_id, credits: hit.credits} : null;
        })));`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: resolve(__dirname, '../../..'), encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' });
    expect(histories.map(rows => pickResumableAgentJob(rows, now))).toEqual(JSON.parse(run.stdout));
});
test('finds an agent run on page two behind 24 newer jobs', async () => {
    const list = jest.fn().mockResolvedValueOnce(page(images(), next)).mockResolvedValueOnce(page([job()]));
    expect(await findResumableAgentJob(list, () => true, now)).toEqual({ jobId: 'agent-job', credits: 20 });
    expect(list.mock.calls).toEqual([[undefined], [next]]);
});
test('stops paging once rows are older than the resume window', async () => {
    const list = jest.fn().mockResolvedValue(page([job({ model_id: 'image', created_at: new Date(now - 61 * 60_000).toISOString() })], next));
    expect(await findResumableAgentJob(list, () => true, now)).toBeNull(); expect(list).toHaveBeenCalledTimes(1);
});
test('stops at the page cap', async () => {
    const list = jest.fn().mockResolvedValue(page(images(), next));
    expect(await findResumableAgentJob(list, () => true, now)).toBeNull(); expect(list).toHaveBeenCalledTimes(RESUME_MAX_PAGES); expect(RESUME_MAX_PAGES).toBe(5);
});
test('stops when next is null', async () => {
    const list = jest.fn().mockResolvedValue(page(images()));
    expect(await findResumableAgentJob(list, () => true, now)).toBeNull(); expect(list).toHaveBeenCalledTimes(1);
});
test.each([page([], next), page([job({ model_id: 'image', created_at: 'invalid' })], next)])('stops on an empty or unparsable page', async value => {
    const list = jest.fn().mockResolvedValue(value);
    expect(await findResumableAgentJob(list, () => true, now)).toBeNull(); expect(list).toHaveBeenCalledTimes(1);
});
test('abandons when no longer current', async () => {
    const list = jest.fn().mockResolvedValue(page([job()], next));
    expect(await findResumableAgentJob(list, () => false, now)).toBeUndefined(); expect(list).toHaveBeenCalledTimes(1);
});
test('propagates page rejection to the caller', async () => {
    await expect(findResumableAgentJob(() => Promise.reject(Error('offline')), () => true, now)).rejects.toThrow('offline');
});

const mockList = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockApi = {};
let mockOwner = 'owner';
let mockAccountChange: (() => void) | undefined;
let mockFocus: () => (() => void);
let mockBlur: (() => void) | undefined;
jest.mock('expo-router', () => ({
    Stack: { Screen: () => null }, Link: ({ children }: any) => children,
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
    useFocusEffect: (fn: () => (() => void)) => {
        mockFocus = fn;
        require('react').useEffect(() => { mockBlur = fn(); return () => { mockBlur?.(); mockBlur = undefined; }; }, [fn]);
    },
}));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockAccountChange = fn; return () => { mockAccountChange = undefined; }; } }));
jest.mock('../src/lib/media', () => ({ mediaApi: () => ({ listJobs: mockList }) }));
jest.mock('../src/lib/montage', () => ({ ...jest.requireActual('../src/lib/montage'), requestPlan: jest.fn(), approvePlan: jest.fn() }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.ActivityIndicator];
let root: Root;
const listeners = new Set<(state: RN.AppStateStatus) => void>();
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const hasText = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
const hasCard = () => hasText(t('agentResume.title'));
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const click = (label: string) => act(async () => control(label).props.onClick(event));
const render = () => act(async () => root.render(<Agent />));
const switchAccount = () => act(async () => { mockOwner = 'new-owner'; mockAccountChange?.(); });
const blur = () => act(async () => { mockBlur?.(); mockBlur = undefined; });
const focus = () => act(async () => { mockBlur = mockFocus(); });
const foreground = () => act(async () => { for (const listener of listeners) listener('active'); });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(); mockOwner = 'owner'; mockAccountChange = undefined; mockBlur = undefined; listeners.clear();
    mockList.mockReset().mockResolvedValue(page([])); mockPush.mockReset(); mockReplace.mockReset();
    jest.mocked(requestPlan).mockReset().mockResolvedValue({ planId: 'p', idempotencyKey: 'k', credits: 20, seconds: 10, summary: 'A quiet sea', aspect: '9:16', narrationText: '', expiresAt: Math.floor(Date.now() / 1000) + 1800 });
    jest.mocked(approvePlan).mockReset();
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation((_event, fn) => { listeners.add(fn); return { remove: jest.fn(() => { listeners.delete(fn); }) }; });
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
test('a running job shows a polite resume card and opens progress', async () => {
    mockList.mockResolvedValue(page([job()])); await render(); expect(hasCard()).toBe(true);
    expect(root.container.queryAll(n => n.props.accessibilityLiveRegion === 'polite').length).toBeGreaterThan(0);
    await click(t('agentResume.open')); expect(mockPush).toHaveBeenCalledWith({ pathname: '/job/[id]', params: { id: 'agent-job' } });
});
test('no resumable job means no card', async () => { await render(); expect(hasCard()).toBe(false); });
test('account change discards a pending old read and applies the new account read', async () => {
    const old = deferred<JobPage>();
    mockList.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([job({ job_id: 'new-account' })]));
    await render(); await switchAccount();
    await act(async () => old.resolve(page([job()])));
    await click(t('agentResume.open')); expect(mockPush).toHaveBeenCalledWith({ pathname: '/job/[id]', params: { id: 'new-account' } });
});
test('ignores page two of the old account after an account switch', async () => {
    const old = deferred<JobPage>(); const current = deferred<JobPage>();
    mockList.mockResolvedValueOnce(page(images(), next)).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await render(); expect(mockList).toHaveBeenCalledTimes(2);
    await switchAccount();
    await act(async () => old.resolve(page([job()], next)));
    expect(hasCard()).toBe(false); expect(mockList).toHaveBeenCalledTimes(3);
    await act(async () => current.resolve(page([job({ job_id: 'new-account' })])));
    await click(t('agentResume.open')); expect(mockPush).toHaveBeenCalledWith({ pathname: '/job/[id]', params: { id: 'new-account' } });
});
test('a newer check supersedes an older check mid-pagination', async () => {
    const old = deferred<JobPage>();
    mockList.mockResolvedValueOnce(page(images(), next)).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([job({ job_id: 'new-check' })]));
    await render(); await foreground();
    await act(async () => old.resolve(page([job()], next)));
    expect(mockList).toHaveBeenCalledTimes(3);
    await click(t('agentResume.open')); expect(mockPush).toHaveBeenCalledWith({ pathname: '/job/[id]', params: { id: 'new-check' } });
});
test('hides the card after returning from a finished run', async () => {
    mockList.mockResolvedValue(page([job()])); await render(); await click(t('agentResume.open')); await blur();
    mockList.mockResolvedValue(page([job({ state: 'succeeded' })])); await focus(); expect(hasCard()).toBe(false);
});
test('finds a run after returning to the foreground', async () => {
    mockList.mockRejectedValueOnce(Error('offline')); await render(); expect(hasCard()).toBe(false);
    mockList.mockResolvedValue(page([job()])); await foreground(); expect(hasCard()).toBe(true);
    await blur(); expect(listeners.size).toBe(0); const count = mockList.mock.calls.length;
    await foreground(); expect(mockList).toHaveBeenCalledTimes(count);
});
test('drops a focus check that is still pending at blur', async () => {
    const pending = deferred<JobPage>(); mockList.mockReturnValue(pending.promise); await render(); await blur();
    await act(async () => pending.resolve(page([job()], next))); expect(hasCard()).toBe(false); expect(mockList).toHaveBeenCalledTimes(1);
});
test('unmount abandons pending pagination and produces no update warning', async () => {
    const pending = deferred<JobPage>(); mockList.mockReturnValue(pending.promise);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await render(); await act(async () => root.unmount());
    await act(async () => pending.resolve(page([job()], next)));
    expect(mockList).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
});
test.each([0, 401, 403, 404, 429, 503])('failed check (%s) hides the card without exposing error text', async status => {
    mockList.mockResolvedValueOnce(page([job()])); await render(); expect(hasCard()).toBe(true);
    mockList.mockRejectedValue(new ApiError(status, 'private_failure')); await foreground();
    expect(hasCard()).toBe(false); expect(hasText('private_failure')).toBe(false);
});
test('synchronous API throws are swallowed', async () => {
    mockList.mockImplementation(() => { throw Error('stub api'); }); await render(); expect(hasCard()).toBe(false);
});
test('an in-progress approval refusal triggers another paginated check and keeps the Library link', async () => {
    await render();
    await act(async () => control(t('videoAgent.briefLabel')).props.onChangeText('A quiet sea at dawn'));
    await click(`${t('videoAgent.plan')}, free`);
    mockList.mockResolvedValueOnce(page(images(), next)).mockResolvedValueOnce(page([job()]));
    jest.mocked(approvePlan).mockRejectedValueOnce(new ApiError(409, 'video_agent_in_progress'));
    await click(t('videoAgent.approve', { credits: '20' }));
    expect(mockList).toHaveBeenCalledTimes(3); expect(mockList.mock.calls[2]).toEqual([next]);
    expect(hasCard()).toBe(true); expect(hasText(t('videoAgent.library'))).toBe(true);
});
test('resume card is hidden during approval', async () => {
    mockList.mockResolvedValue(page([job()])); await render();
    await act(async () => control(t('videoAgent.briefLabel')).props.onChangeText('A quiet sea at dawn'));
    await click(`${t('videoAgent.plan')}, free`);
    const approval = deferred<string>(); jest.mocked(approvePlan).mockReturnValue(approval.promise);
    await click(t('videoAgent.approve', { credits: '20' })); expect(hasCard()).toBe(false);
    await act(async () => approval.resolve('approved'));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/job/[id]', params: { id: 'approved' } });
});

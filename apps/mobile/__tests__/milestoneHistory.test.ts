const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItem: (k: string) => mockStore.get(k) ?? null, setItem: (k: string, v: string) => mockStore.set(k, v) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'a', subscribeCacheUser: () => () => undefined }));
jest.mock('../src/lib/haptics', () => ({ playSuccess: jest.fn() }));
import type { ApiClient } from '../src/lib/api';
import type { CatalogModel } from '../src/lib/media';
import type { CelebrationEvent } from '../src/lib/veyMotion';

const model = (id: string, modality: string) => ({ id, name: id, modality, credits: 1, gated: false, durations: [], capabilities: {} }) as CatalogModel;
const catalog = [model('veo', 'text-to-video'), model('flux', 'text-to-image')];
const job = (job_id: string, model_id: string, state = 'succeeded') => ({ job_id, state, model_id, credits: 1, has_asset: true, created_at: '2026-10-09T10:00:00Z' });
const apiWith = (jobs: unknown[]) => ({ request: jest.fn(async () => ({ jobs, next: null })) }) as unknown as ApiClient;

let celebrate: typeof import('../src/lib/celebrate');
let history: typeof import('../src/lib/milestoneHistory');
let events: CelebrationEvent[];
beforeEach(() => {
    mockStore.clear();
    jest.resetModules();
    celebrate = require('../src/lib/celebrate');
    history = require('../src/lib/milestoneHistory');
    events = [];
    require('../src/lib/veyMotion').onCelebrate((e: CelebrationEvent) => { events.push(e); e.onShown(); e.onDone(); });
});

test('an account that already made a video never sees "Your first video!"', async () => {
    await history.settleFirstMilestones(apiWith([job('old-v', 'veo'), job('old-i', 'flux')]), catalog);
    celebrate.noteLocalSubmission('new');
    expect(celebrate.celebrateOutput('new', 'video/mp4', true).big).toBe(false);
    expect(events).toHaveLength(0);
});

test('an account with pictures only still gets its first video, not a first creation', async () => {
    await history.settleFirstMilestones(apiWith([job('old-i', 'flux')]), catalog);
    celebrate.noteLocalSubmission('new');
    celebrate.celebrateOutput('new', 'video/mp4', true);
    expect(events.map((e) => e.kind)).toEqual(['firstVideo']);
});

test('a brand-new account keeps both milestones, and this device\'s own submissions never count as earlier', async () => {
    celebrate.noteLocalSubmission('mine');
    await history.settleFirstMilestones(apiWith([job('mine', 'veo')]), catalog);
    celebrate.celebrateOutput('mine', 'video/mp4', true);
    expect(events.map((e) => e.kind)).toEqual(['firstCreation']);
});

test('failed or unreadable history changes nothing', async () => {
    await history.settleFirstMilestones(apiWith([job('f', 'veo', 'failed')]), catalog);
    await history.settleFirstMilestones({ request: jest.fn(async () => { throw new Error('offline'); }) } as unknown as ApiClient, catalog);
    celebrate.noteLocalSubmission('new');
    celebrate.celebrateOutput('new', 'video/mp4', true);
    expect(events.map((e) => e.kind)).toEqual(['firstCreation']);
});

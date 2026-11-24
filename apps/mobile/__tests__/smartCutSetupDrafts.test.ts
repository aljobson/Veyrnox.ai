import { createMemoryStorage } from '../src/lib/cache';
import { readSmartCutSetupDraft, removeSmartCutSetupDraft, validSmartCutSetupDraft, writeSmartCutSetupDraft, type SmartCutSetupDraft } from '../src/lib/smartCutSetupDrafts';

const OWNER = '11111111-1111-4111-8111-111111111111';
let mockActive = OWNER;
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockActive, userDocStorage: {} }));
const draft = (): SmartCutSetupDraft => ({
    owner: OWNER, updatedAt: 123, clips: [{ jobId: '22222222-2222-4222-8222-222222222222', label: 'Take one', length: 12, start: 1, end: 10 }],
    script: 'Keep this line', notes: 'Prefer the complete take', pacing: 'balanced', language: 'auto', removeFillers: false,
    skippedFillers: [], captionsOn: true, captionPreset: 'simple',
});

beforeEach(() => { mockActive = OWNER; });

test('validated Smart Cut setup survives a restart without analysis or plan data', async () => {
    const storage = createMemoryStorage();
    expect(await writeSmartCutSetupDraft(draft(), storage)).toBe(true);
    expect(await readSmartCutSetupDraft(OWNER, storage)).toEqual(draft());
    expect(JSON.stringify(await readSmartCutSetupDraft(OWNER, storage))).not.toMatch(/transcript|analysis|segments|plan/);
});

test('malformed, foreign and account-switched drafts are refused and removed', async () => {
    const storage = createMemoryStorage();
    expect(validSmartCutSetupDraft({ ...draft(), pacing: 'instant' }, OWNER)).toBe(false);
    expect(await writeSmartCutSetupDraft({ ...draft(), owner: '33333333-3333-4333-8333-333333333333' }, storage)).toBe(false);
    expect(await writeSmartCutSetupDraft(draft(), storage)).toBe(true);
    mockActive = '33333333-3333-4333-8333-333333333333';
    expect(await readSmartCutSetupDraft(OWNER, storage)).toBeNull();
    expect(await storage.keys()).toEqual([]);
});

test('discard removes the account-scoped setup draft', async () => {
    const storage = createMemoryStorage();
    await writeSmartCutSetupDraft(draft(), storage);
    await removeSmartCutSetupDraft(OWNER, storage);
    expect(await readSmartCutSetupDraft(OWNER, storage)).toBeNull();
});

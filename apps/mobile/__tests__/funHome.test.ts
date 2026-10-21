import { celebrateFinished, newlyFinished, resetCelebrations } from '../src/lib/celebrate';
import { heroPicks, needsPhoto } from '../src/lib/explore';
import type { Job } from '../src/lib/media';
import type { Preset } from '../src/lib/presets';
import { CHEER_MS, onVeyReaction } from '../src/lib/veyMotion';

const mockPlaySuccess = jest.fn(() => Promise.resolve());
jest.mock('../src/lib/haptics', () => ({ playSuccess: () => mockPlaySuccess() }));

const preset = (id: string, over: Partial<Preset> = {}): Preset => ({
    id,
    title: id,
    category: 'OTHER',
    modelId: 'm',
    modelName: 'M',
    modality: 'video',
    prompt: 'p',
    needs: null,
    durationSeconds: 5,
    credits: 10,
    isNew: false,
    previewUrl: null,
    posterUrl: `https://img.test/${id}.jpg`,
    ...over,
});

const job = (id: string, state: Job['state']): Job => ({ job_id: id, state, credits: 5, model_id: 'm', created_at: '2026-10-21T10:00:00Z', has_asset: state === 'succeeded' });

describe('the templates the home leads with', () => {
    test('only ones with a picture, and never audio', () => {
        const picks = heroPicks([preset('a', { posterUrl: null }), preset('b', { modality: 'audio' }), preset('c'), preset('d')]);
        expect(picks.map((p) => p.id)).toEqual(['c', 'd']);
    });

    test('new ones come first, one per category while there are enough categories', () => {
        const picks = heroPicks([
            preset('old-a', { category: 'A' }),
            preset('old-b', { category: 'B' }),
            preset('new-a', { category: 'A', isNew: true }),
            preset('new-a2', { category: 'A', isNew: true }),
            preset('old-c', { category: 'C' }),
        ]);
        expect(picks.map((p) => p.id)).toEqual(['new-a', 'old-b', 'old-c']);
    });

    test('ones that start from words come before ones that ask for a photo, so a tap really starts', () => {
        const photo = { modality: 'image-to-video', needs: 'A clear photo' };
        const picks = heroPicks([
            preset('needs-photo', { ...photo, isNew: true }),
            preset('words-a', { category: 'A' }),
            preset('words-b', { category: 'B' }),
            preset('words-c', { category: 'C' }),
        ]);
        expect(picks.map((p) => p.id)).toEqual(['words-a', 'words-b', 'words-c']);
        // With too few of those, the photo ones fill the row rather than leaving it short.
        expect(heroPicks([preset('words-a'), preset('needs-photo', photo)]).map((p) => p.id)).toEqual(['words-a', 'needs-photo']);
    });

    test('a template needs a photo only when it animates one', () => {
        expect(needsPhoto(preset('a', { modality: 'image-to-video' }))).toBe(true);
        expect(needsPhoto(preset('b', { modality: 'text-to-video', needs: 'An optional starting image' }))).toBe(false);
        expect(needsPhoto(preset('c', { modality: 'text-to-image' }))).toBe(false);
    });

    test('fills from the same category when there is only one, and stops at the count', () => {
        const same = [preset('1'), preset('2'), preset('3'), preset('4')];
        expect(heroPicks(same).map((p) => p.id)).toEqual(['1', '2', '3']);
        expect(heroPicks(same, 2)).toHaveLength(2);
        expect(heroPicks([])).toEqual([]);
    });
});

describe('a finished creation gets a cheer and a buzz', () => {
    beforeEach(() => {
        resetCelebrations();
        mockPlaySuccess.mockClear();
    });

    test('a creation seen unfinished and then finished counts; one that was already done does not', () => {
        const before = new Map([['a', false], ['b', true]]);
        const now = [job('a', 'succeeded'), job('b', 'succeeded'), job('c', 'succeeded')];
        expect(newlyFinished(before, now).map((j) => j.job_id)).toEqual(['a']);
        expect(newlyFinished(null, now)).toEqual([]);
    });

    test('the first read of the list celebrates nothing', () => {
        expect(celebrateFinished([job('a', 'succeeded'), job('b', 'running')])).toBe(0);
        expect(mockPlaySuccess).not.toHaveBeenCalled();
    });

    test('a creation that finishes between two reads makes Vey cheer once and buzzes once', () => {
        const heard: [string, number][] = [];
        const off = onVeyReaction((mood, ms) => heard.push([mood, ms]));
        celebrateFinished([job('a', 'running'), job('b', 'queued')]);
        expect(celebrateFinished([job('a', 'succeeded'), job('b', 'succeeded')])).toBe(2);
        expect(heard).toEqual([['cheer', CHEER_MS]]);
        expect(mockPlaySuccess).toHaveBeenCalledTimes(1);
        // The same list again is no news.
        expect(celebrateFinished([job('a', 'succeeded'), job('b', 'succeeded')])).toBe(0);
        expect(mockPlaySuccess).toHaveBeenCalledTimes(1);
        off();
    });

    test('a failed creation is not a celebration', () => {
        celebrateFinished([job('a', 'running')]);
        expect(celebrateFinished([job('a', 'failed')])).toBe(0);
        expect(mockPlaySuccess).not.toHaveBeenCalled();
    });
});

describe('the buzz is optional', () => {
    afterEach(() => jest.resetModules());

    test('plays a success notification when the native module is there', async () => {
        const notificationAsync = jest.fn(() => Promise.resolve());
        jest.doMock('expo-haptics', () => ({ notificationAsync, NotificationFeedbackType: { Success: 'success' } }), { virtual: true });
        const { playSuccess: play } = jest.requireActual('../src/lib/haptics') as typeof import('../src/lib/haptics');
        await play();
        expect(notificationAsync).toHaveBeenCalledWith('success');
    });

    test('stays quiet, without throwing, when the native module is missing', async () => {
        jest.doMock('expo-haptics', () => { throw new Error('native module not linked'); }, { virtual: true });
        const { playSuccess: play } = jest.requireActual('../src/lib/haptics') as typeof import('../src/lib/haptics');
        await expect(play()).resolves.toBeUndefined();
    });
});

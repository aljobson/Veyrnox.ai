import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import Create from '../src/app/(app)/(tabs)/create';
import { fetchCatalogCached, type CatalogModel } from '../src/lib/media';
import { type CacheMeta } from '../src/lib/cache';
import { t } from '../src/lib/i18n';

const mockPrompt: CatalogModel = { id: 'prompt-image', name: 'Prompt image', modality: 'text-to-image', credits: 2, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: jest.fn() }));
jest.mock('../src/lib/useFaceFiltersAvailable', () => ({ useFaceFiltersAvailable: () => false }));
jest.mock('../src/lib/montage', () => ({ fetchAgentListing: async () => null }));
jest.mock('../src/lib/firstGoalStore', () => ({ readFirstGoal: async () => 'skipped', writeFirstGoal: async () => undefined, homeStartRecorded: () => false })); // the first-goal question is already answered
jest.mock('../src/auth/AuthProvider', () => { const api = {}; return { useAuth: () => ({ api }) }; }); // a stable client, so the first-goal effect runs once
jest.mock('../src/lib/firstGoalSync', () => ({ fetchRemoteFirstGoal: async () => ({ kind: 'unavailable' }), pushFirstGoal: jest.fn(async () => undefined) })); // the server is not asked here

let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const buttons = () => root.container.queryAll(n => n.props.accessibilityRole === 'button');
const hasText = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.mocked(fetchCatalogCached).mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('a failed catalog load shows the error with a Retry that loads the goals', async () => {
    jest.mocked(fetchCatalogCached)
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementationOnce(async (onData?: (models: CatalogModel[], meta: CacheMeta) => void) => {
            const meta: CacheMeta = { fromCache: false, stale: false, savedAt: Date.now(), ageMs: 0 };
            onData?.([mockPrompt], meta);
            return { value: [mockPrompt], meta };
        });
    await act(async () => root.render(<Create />));
    expect(hasText(t('create.loadError'))).toBe(true);
    const retry = buttons().find(n => n.props.accessibilityLabel === t('recovery.retry'));
    expect(retry).toBeDefined();
    expect(buttons().find(n => n.props.accessibilityLabel === t('create.goal.image'))).toBeUndefined();
    await act(async () => { retry!.props.onClick(event); });
    expect(fetchCatalogCached).toHaveBeenCalledTimes(2);
    expect(hasText(t('create.loadError'))).toBe(false);
    expect(buttons().find(n => n.props.accessibilityLabel === t('create.goal.image'))).toBeDefined();
});

test('a second failure keeps the error and the Retry', async () => {
    jest.mocked(fetchCatalogCached).mockRejectedValue(new Error('offline'));
    await act(async () => root.render(<Create />));
    await act(async () => { buttons().find(n => n.props.accessibilityLabel === t('recovery.retry'))!.props.onClick(event); });
    expect(fetchCatalogCached).toHaveBeenCalledTimes(2);
    expect(hasText(t('create.loadError'))).toBe(true);
    expect(buttons().find(n => n.props.accessibilityLabel === t('recovery.retry'))).toBeDefined();
});

import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import Create from '../src/app/(app)/(tabs)/create';
import { fetchCatalogCached, type CatalogModel } from '../src/lib/media';
import { type CacheMeta } from '../src/lib/cache';
import { t } from '../src/lib/i18n';
import { readFirstGoal, writeFirstGoal } from '../src/lib/firstGoalStore';
const mockPrompt: CatalogModel = { id: 'prompt-image', name: 'Prompt image', modality: 'text-to-image', credits: 2, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };


const mockPush = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: jest.fn() }));
jest.mock('../src/lib/useFaceFiltersAvailable', () => ({ useFaceFiltersAvailable: () => false }));
jest.mock('../src/lib/montage', () => ({ fetchAgentListing: async () => null }));
jest.mock('../src/lib/firstGoalStore', () => ({ readFirstGoal: jest.fn(), writeFirstGoal: jest.fn(async () => undefined) }));

let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const buttons = () => root.container.queryAll(n => n.props.accessibilityRole === 'button');
const labelled = (label: string) => buttons().find(n => n.props.accessibilityLabel === label);
const hasText = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
const meta: CacheMeta = { fromCache: false, stale: false, savedAt: Date.now(), ageMs: 0 };

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    mockPush.mockReset();
    jest.mocked(writeFirstGoal).mockClear();
    jest.mocked(fetchCatalogCached).mockReset().mockImplementation(async (onData?: (models: CatalogModel[], meta: CacheMeta) => void) => {
        onData?.([mockPrompt], meta);
        return { value: [mockPrompt], meta };
    });
});
afterEach(async () => { await act(async () => root.unmount()); });

test('a first visit asks what to make first; a creation goal opens the starter form with an example prompt and remembers the choice', async () => {
    jest.mocked(readFirstGoal).mockResolvedValue(null);
    await act(async () => root.render(<Create />));
    expect(hasText(t('create.firstGoal.title'))).toBe(true);
    await act(async () => { labelled(t('create.firstGoal.image'))!.props.onClick(event); });
    expect(writeFirstGoal).toHaveBeenCalledWith('image');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/create/[modelId]', params: { modelId: 'prompt-image', prompt: t('create.firstGoal.example.image') } });
    expect(hasText(t('create.firstGoal.title'))).toBe(false);
});

test('Edit and Publish go to their own tab; Skip only remembers that the question was dismissed', async () => {
    jest.mocked(readFirstGoal).mockResolvedValue(null);
    await act(async () => root.render(<Create />));
    await act(async () => { labelled(t('create.firstGoal.publish'))!.props.onClick(event); });
    expect(mockPush).toHaveBeenCalledWith('/publish');
    expect(writeFirstGoal).toHaveBeenCalledWith('publish');

    await act(async () => root.unmount());
    root = createRoot();
    mockPush.mockReset();
    await act(async () => root.render(<Create />));
    await act(async () => { labelled(t('create.firstGoal.skip'))!.props.onClick(event); });
    expect(writeFirstGoal).toHaveBeenLastCalledWith('skipped');
    expect(mockPush).not.toHaveBeenCalled();
    expect(hasText(t('create.firstGoal.title'))).toBe(false);
});

test('once answered, the question is not asked again', async () => {
    jest.mocked(readFirstGoal).mockResolvedValue('audio');
    await act(async () => root.render(<Create />));
    expect(hasText(t('create.firstGoal.title'))).toBe(false);
    expect(labelled(t('create.goal.image'))).toBeDefined();
});

test('"Not sure yet" shows an example for each creation area; picking one opens the form with it and remembers that goal', async () => {
    jest.mocked(readFirstGoal).mockResolvedValue(null);
    await act(async () => root.render(<Create />));
    await act(async () => { labelled(t('create.firstGoal.unsure'))!.props.onClick(event); });
    expect(writeFirstGoal).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(hasText(t('create.firstGoal.title'))).toBe(true);
    const rows = buttons().filter(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.includes(t('create.firstGoal.example.image')));
    expect(rows.length).toBe(1);
    expect(buttons().some(n => String(n.props.accessibilityLabel).includes(t('create.firstGoal.example.video')))).toBe(true);
    expect(buttons().some(n => String(n.props.accessibilityLabel).includes(t('create.firstGoal.example.audio')))).toBe(true);
    expect(labelled(t('create.firstGoal.edit'))).toBeUndefined();
    await act(async () => { rows[0].props.onClick(event); });
    expect(writeFirstGoal).toHaveBeenCalledWith('image');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/create/[modelId]', params: { modelId: 'prompt-image', prompt: t('create.firstGoal.example.image') } });
});

test('Skip from the examples remembers the dismissal and shows the usual goal list', async () => {
    jest.mocked(readFirstGoal).mockResolvedValue(null);
    await act(async () => root.render(<Create />));
    await act(async () => { labelled(t('create.firstGoal.unsure'))!.props.onClick(event); });
    await act(async () => { labelled(t('create.firstGoal.skip'))!.props.onClick(event); });
    expect(writeFirstGoal).toHaveBeenLastCalledWith('skipped');
    expect(hasText(t('create.firstGoal.title'))).toBe(false);
    expect(labelled(t('create.goal.image'))).toBeDefined();
});

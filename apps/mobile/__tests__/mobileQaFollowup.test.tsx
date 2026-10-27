import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { useChatAutoScroll } from '../src/lib/useChatAutoScroll';
import { useFaceFiltersAvailable } from '../src/lib/useFaceFiltersAvailable';
import { fetchCatalogCached, type CatalogModel } from '../src/lib/media';

const mockFocus = new Set<() => void>();
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => {
    require('react').useEffect(() => {
        mockFocus.add(callback);
        callback();
        return () => { mockFocus.delete(callback); };
    }, [callback]);
} }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: jest.fn() }));
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); jest.clearAllMocks(); });

test('chat follows new messages and send start, but respects dragging during and after streaming', async () => {
    const scrollToEnd = jest.fn();
    let scroll!: ReturnType<typeof useChatAutoScroll>;
    function Chat({ count, sending }: { count: number; sending: boolean }) {
        scroll = useChatAutoScroll(count, sending);
        scroll.messageList.current = { scrollToEnd } as never;
        return null;
    }
    const render = async (count: number, sending: boolean) => {
        await act(async () => root.render(<Chat count={count} sending={sending} />));
    };
    await render(0, false);
    expect(scrollToEnd).not.toHaveBeenCalled();
    await render(2, false);
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    scroll.onScrollBeginDrag();
    await render(2, true);
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
    await render(4, true);
    scroll.onContentSizeChange();
    expect(scrollToEnd).toHaveBeenCalledTimes(4);
    scroll.onScrollBeginDrag();
    scroll.onContentSizeChange();
    await render(4, true);
    await render(4, false);
    scroll.onContentSizeChange();
    expect(scrollToEnd).toHaveBeenCalledTimes(4);
    await render(3, false);
    scroll.onContentSizeChange();
    expect(scrollToEnd).toHaveBeenCalledTimes(4);
    await render(5, false);
    expect(scrollToEnd).toHaveBeenCalledTimes(5);
});

test('Face Filters consumers share pending catalog reads and retain availability on refocus or failure', async () => {
    const fetch = jest.mocked(fetchCatalogCached);
    let publish!: (models: CatalogModel[]) => void;
    let finish!: () => void;
    let fail!: () => void;
    const meta = { fromCache: false, stale: false, savedAt: 0, ageMs: 0 };
    fetch.mockImplementation(onData => new Promise((resolve, reject) => {
        publish = models => onData?.(models, meta);
        finish = () => resolve({ value: [], meta });
        fail = () => reject(new Error('offline'));
    }));
    const values: Record<string, boolean> = {};
    function Entry({ name }: { name: string }) { values[name] = useFaceFiltersAvailable(); return null; }
    await act(async () => root.render(<><Entry name="drawer" /><Entry name="create" /><Entry name="tools" /><Entry name="search" /></>));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Object.values(values)).toEqual([false, false, false, false]);
    const model: CatalogModel = { id: 'face-retouch', name: 'Retouch', modality: 'image-to-image', credits: 1, gated: false, durations: [], capabilities: { media: { image: { required: true } } } };
    await act(async () => { publish([model]); finish(); });
    expect(Object.values(values)).toEqual([true, true, true, true]);
    await act(async () => { mockFocus.forEach(focus => focus()); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Object.values(values)).toEqual([true, true, true, true]);
    await act(async () => fail());
    expect(Object.values(values)).toEqual([true, true, true, true]);
    await act(async () => { mockFocus.forEach(focus => focus()); });
    await act(async () => { publish([{ ...model, gated: true }]); finish(); });
    expect(Object.values(values)).toEqual([false, false, false, false]);
});

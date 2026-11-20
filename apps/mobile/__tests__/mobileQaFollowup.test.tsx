import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { useChatAutoScroll } from '../src/lib/useChatAutoScroll';
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
const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height } } }) as Parameters<ReturnType<typeof useChatAutoScroll>['onLayout']>[0];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); jest.clearAllMocks(); });

test('chat follows new messages and send start, but respects dragging during and after streaming', async () => {
    const scrollToEnd = jest.fn(), scrollToOffset = jest.fn();
    let scroll!: ReturnType<typeof useChatAutoScroll>;
    function Chat({ count, sending }: { count: number; sending: boolean }) {
        scroll = useChatAutoScroll(count, sending);
        scroll.messageList.current = { scrollToEnd, scrollToOffset } as never;
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
    scroll.onContentSizeChange(300, 1000);
    expect(scrollToEnd).toHaveBeenCalledTimes(4);
    scroll.onScrollBeginDrag();
    scroll.onContentSizeChange(300, 1000);
    await render(4, true);
    await render(4, false);
    scroll.onContentSizeChange(300, 1000);
    expect(scrollToEnd).toHaveBeenCalledTimes(4);
    await render(3, false);
    scroll.onContentSizeChange(300, 1000);
    expect(scrollToEnd).toHaveBeenCalledTimes(4);
    await render(5, false);
    expect(scrollToEnd).toHaveBeenCalledTimes(5);
});

test('chat keeps the newest message in view when the keyboard opens or the list shrinks, unless the person scrolled up', async () => {
    const scrollToEnd = jest.fn(), scrollToOffset = jest.fn();
    let scroll!: ReturnType<typeof useChatAutoScroll>;
    function Chat({ count, keyboard }: { count: number; keyboard: boolean }) {
        scroll = useChatAutoScroll(count, false, keyboard);
        scroll.messageList.current = { scrollToEnd, scrollToOffset } as never;
        return null;
    }
    const at = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y }, layoutMeasurement: { width: 300, height: 400 }, contentSize: { width: 300, height: 1000 } } }) as never;
    await act(async () => root.render(<Chat count={4} keyboard={false} />));
    scroll.onLayout(layout(600));
    scroll.onContentSizeChange(300, 1000);
    scrollToEnd.mockClear();
    scrollToOffset.mockClear();
    await act(async () => root.render(<Chat count={4} keyboard />));
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 400, animated: true });
    scroll.onLayout(layout(400));
    expect(scrollToOffset).toHaveBeenCalledTimes(2);
    scroll.onScrollBeginDrag();
    scroll.onScroll(at(100));
    scroll.onScrollEndDrag(at(100));
    await act(async () => root.render(<Chat count={4} keyboard={false} />));
    await act(async () => root.render(<Chat count={4} keyboard />));
    scroll.onLayout(layout(400));
    scroll.onContentSizeChange(300, 1000);
    expect(scrollToOffset).toHaveBeenCalledTimes(2);
    scroll.onScrollBeginDrag();
    scroll.onMomentumScrollEnd(at(600));
    scroll.onContentSizeChange(300, 1000);
    expect(scrollToOffset).toHaveBeenCalledTimes(3);
    expect(scrollToEnd).not.toHaveBeenCalled();
});

test('chat uses measured native sizes for sends, streamed growth and composer shrink', async () => {
    const scrollToEnd = jest.fn(), scrollToOffset = jest.fn();
    let scroll!: ReturnType<typeof useChatAutoScroll>;
    function Chat({ count, sending }: { count: number; sending: boolean }) {
        scroll = useChatAutoScroll(count, sending);
        scroll.messageList.current = { scrollToEnd, scrollToOffset } as never;
        return null;
    }
    await act(async () => root.render(<Chat count={2} sending={false} />));
    expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: false });
    scroll.onLayout(layout(600));
    scroll.onContentSizeChange(300, 900);
    scrollToEnd.mockClear();
    scrollToOffset.mockClear();

    await act(async () => root.render(<Chat count={4} sending />));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 300, animated: false });
    scroll.onContentSizeChange(300, 1200);
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 600, animated: false });
    scroll.onContentSizeChange(300, 1260);
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 660, animated: false });
    scroll.onLayout(layout(500));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 760, animated: false });
    expect(scrollToEnd).not.toHaveBeenCalled();

    scrollToOffset.mockClear();
    scroll.onScrollBeginDrag();
    scroll.onContentSizeChange(300, 1320);
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(scrollToEnd).not.toHaveBeenCalled();
});

test('chat clamps short or empty measured content to offset zero', async () => {
    const scrollToEnd = jest.fn(), scrollToOffset = jest.fn();
    let scroll!: ReturnType<typeof useChatAutoScroll>;
    function Chat() {
        scroll = useChatAutoScroll(2, false);
        scroll.messageList.current = { scrollToEnd, scrollToOffset } as never;
        return null;
    }
    await act(async () => root.render(<Chat />));
    scroll.onContentSizeChange(300, 200);
    expect(scrollToOffset).not.toHaveBeenCalled();
    scrollToEnd.mockClear();
    scroll.onLayout(layout(600));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
    scroll.onContentSizeChange(300, 0);
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
    expect(scrollToEnd).not.toHaveBeenCalled();
});


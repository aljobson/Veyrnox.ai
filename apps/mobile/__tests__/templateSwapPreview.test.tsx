import { act } from 'react';
import { createRoot } from 'test-renderer';
import { fetchSwapPreview, parseSwapPreview } from '../src/lib/templateSwap/preview';
import { SwapTemplatePreview } from '../src/components/templates/SwapTemplatePreview';
let mockPreview: any = undefined;
jest.mock('../src/lib/templateSwap/preview', () => ({ ...jest.requireActual('../src/lib/templateSwap/preview'), useSwapPreview: () => mockPreview }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../src/components/ui', () => ({ Text: 'Text' }));
const body = { template: { id: 'community-billboard-product-swap', name: 'Billboard swap', clip: { video: '/showcase/a.mp4', poster: '/showcase/a.jpg', aspectRatio: '406 / 720' } } };
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
test('poster comes from clip.poster joined to the API origin, ratio is clamped', () => {
    expect(parseSwapPreview(body, 'https://x.test')).toEqual({ title: 'Billboard swap', posterUrl: 'https://x.test/showcase/a.jpg', ratio: 406 / 720 });
    expect(parseSwapPreview({ template: { name: 'n', clip: { poster: '/p.jpg', aspectRatio: '1 / 9' } } }, 'https://x.test')?.ratio).toBe(9 / 16);
    expect(parseSwapPreview({ template: { clip: { poster: '/p.jpg' } } }, 'https://x.test')?.ratio).toBe(9 / 16);
});
test.each([null, {}, { template: { clip: null } }, { template: { clip: { poster: 'https://evil.test/a.jpg' } } }, { template: { clip: { poster: '//evil.test/a.jpg' } } }, { template: { clip: { poster: '/a b.jpg' } } }])('refuses %j', value => {
    expect(parseSwapPreview(value, 'https://x.test')).toBeNull();
});
test('fetch asks the template route, and a miss, bad id or network error gives null', async () => {
    const fetcher = jest.fn(async () => ({ ok: true, json: async () => body })) as any;
    expect((await fetchSwapPreview('community-billboard-product-swap', fetcher))?.posterUrl).toMatch(/\/showcase\/a\.jpg$/);
    expect(fetcher.mock.calls[0][0]).toMatch(/\/api\/templates\/community-billboard-product-swap$/);
    expect(await fetchSwapPreview('../x', fetcher)).toBeNull();
    expect(await fetchSwapPreview('a', (async () => ({ ok: false })) as any)).toBeNull();
    expect(await fetchSwapPreview('a', (async () => { throw new Error('offline'); }) as any)).toBeNull();
});
test('component shows the poster with alt text, a title when the gallery gave none, and nothing when there is no poster', async () => {
    const root = createRoot();
    try {
        mockPreview = { title: 'Billboard swap', posterUrl: 'https://x.test/a.jpg', ratio: 0.5 };
        await act(async () => root.render(<SwapTemplatePreview id="t" />));
        const image = root.container.queryAll(n => n.props.source?.uri === 'https://x.test/a.jpg')[0];
        expect(image.props.accessibilityLabel).toBe('Billboard swap');
        expect(root.container.queryAll(n => n.props.children === 'Billboard swap')).toHaveLength(1);
        await act(async () => root.render(<SwapTemplatePreview id="t" title="Gallery title" />));
        expect(root.container.queryAll(n => n.props.children === 'Billboard swap')).toHaveLength(0);
        mockPreview = null;
        await act(async () => root.render(<SwapTemplatePreview id="t" />));
        expect(root.container.queryAll(n => n.props.source)).toHaveLength(0);
    } finally { await act(async () => root.unmount()); }
});

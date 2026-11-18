import { act } from 'react';
import { createRoot } from 'test-renderer';
import { useSwapRedirect } from '../src/lib/templateSwap/availability';
import { resolveAppLink } from '../src/lib/resolveAppLink';
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ replace: mockReplace }), useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
jest.mock('../src/lib/templateSwap/runtimeFlag', () => ({ TEMPLATE_SWAP_RUNTIME: true }));
jest.mock('../src/lib/presets', () => ({ fetchPresets: jest.fn(async () => [{ id: 'swap', available: false, modelId: 'missing' }]), presetHref: jest.fn(() => ({ pathname: '/create/presets', params: { unavailable: 'swap' } })) }));
jest.mock('../src/lib/media', () => ({ fetchCatalog: jest.fn(async () => []) }));
const offer = { id: 'swap', model: 'kling-o1-reference', credits: 47, images: 2, durationSeconds: 5, role: 'main character' };
let savedFetch: typeof fetch;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; savedFetch = global.fetch; global.fetch = jest.fn(async () => ({ status: 200, json: async () => offer })) as never; });
afterEach(() => { global.fetch = savedFetch; jest.clearAllMocks(); });
test('deep link resolves O1 before legacy availability and missing-model routing', async () => {
    expect(await resolveAppLink('https://veyrnox.ai/app/create?preset=swap')).toBe('/templates/swap');
    global.fetch = jest.fn(async () => ({ status: 404 })) as never;
    expect(await resolveAppLink('https://veyrnox.ai/app/create?preset=swap')).toBe('/create/presets?unavailable=swap');
});
test('shared focus resolver used by Create and unavailable fallback replaces only on a valid offer', async () => {
    const root = createRoot(); function Probe({ id }: { id: string }) { useSwapRedirect(id); return null; }
    try {
        await act(async () => root.render(<Probe id="swap" />));
        expect(mockReplace).toHaveBeenCalledWith({ pathname: '/templates/[id]', params: { id: 'swap' } });
        mockReplace.mockClear(); global.fetch = jest.fn(async () => ({ status: 404 })) as never;
        await act(async () => root.render(<Probe id="other" />)); expect(mockReplace).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
});

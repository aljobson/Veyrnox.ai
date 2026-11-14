import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { SignedInRedirect, SIGNED_IN_HOME } from '../src/components/SignedInRedirect';
import { PENDING_LINK_SLOT, PENDING_LINK_TTL_MS } from '../src/lib/pendingLink';

const mockSlots = new Map<string, string>();
const mockRedirect = jest.fn((_props: { href: string }) => null);
jest.mock('expo-secure-store', () => ({
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItem: (key: string) => mockSlots.get(key) ?? null,
    setItem: (key: string, value: string) => { mockSlots.set(key, value); },
    deleteItemAsync: async (key: string) => { mockSlots.delete(key); },
}));
jest.mock('expo-router', () => ({ Redirect: (props: { href: string }) => mockRedirect(props) }));

const TOKEN = 'abc_DEF-123.sig_456';
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockSlots.clear(); mockRedirect.mockClear(); root = createRoot(); });
afterEach(async () => act(async () => root.unmount()));
const hrefs = () => mockRedirect.mock.calls.map(call => call[0].href);

test('with nothing kept, a signed-in person goes to the tabs as before', async () => {
    await act(async () => root.render(<SignedInRedirect />));
    expect(SIGNED_IN_HOME).toBe('/(app)/(tabs)');
    expect(new Set(hrefs())).toEqual(new Set(['/(app)/(tabs)']));
});
test('a kept destination is followed, stays the same across re-renders, and is removed', async () => {
    mockSlots.set(PENDING_LINK_SLOT, JSON.stringify({ route: `/team-invite?token=${TOKEN}`, at: Date.now() }));
    await act(async () => root.render(<SignedInRedirect />));
    await act(async () => root.render(<SignedInRedirect />));
    expect(new Set(hrefs())).toEqual(new Set([`/team-invite?token=${TOKEN}`]));
    expect(mockSlots.has(PENDING_LINK_SLOT)).toBe(false);
});
test('an expired or tampered destination is ignored and removed', async () => {
    mockSlots.set(PENDING_LINK_SLOT, JSON.stringify({ route: '/library', at: Date.now() - PENDING_LINK_TTL_MS - 1000 }));
    await act(async () => root.render(<SignedInRedirect />));
    expect(new Set(hrefs())).toEqual(new Set(['/(app)/(tabs)']));
    expect(mockSlots.has(PENDING_LINK_SLOT)).toBe(false);
    await act(async () => root.unmount());
    mockRedirect.mockClear(); root = createRoot();
    mockSlots.set(PENDING_LINK_SLOT, JSON.stringify({ route: '//evil.test/x', at: Date.now() }));
    await act(async () => root.render(<SignedInRedirect />));
    expect(new Set(hrefs())).toEqual(new Set(['/(app)/(tabs)']));
});

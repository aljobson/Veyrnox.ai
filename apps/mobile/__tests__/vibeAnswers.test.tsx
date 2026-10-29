import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as SecureStore from 'expo-secure-store';
import * as store from '../src/lib/creatorProfileStore';
import { useVibeAnswers } from '../src/lib/useVibeAnswers';
import { bindCacheUser, resetCacheUser, getCacheUser } from '../src/lib/appCache';
import { notifyVibeChanged, subscribeVibe } from '../src/lib/vibeEvents';
import type { CreatorAnswers } from '../src/lib/creatorAnswers';
import type { SessionTask } from '../src/auth/sessionTask';
const mockDisk = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async (key: string) => mockDisk.get(key) ?? null), setItemAsync: jest.fn(async (key: string, value: string) => { mockDisk.set(key, value); }), deleteItemAsync: jest.fn(async (key: string) => { mockDisk.delete(key); }) }));
jest.mock('../src/lib/creatorProfile', () => ({ ...jest.requireActual('../src/lib/creatorProfile'), CREATOR_PROFILE_ENABLED: true }));
const answers: CreatorAnswers = { look: 'neon_rain', goal: 'story', pace: 'octopus', chaos: 2, destination: 'tiktok', audience: 'me', voice: 'calm' };
const chosen = (a = answers) => ({ version: 1 as const, state: 'completed' as const, answers: a, synced: true });
let generation = 0, root: Root, rendered: (CreatorAnswers | null)[];
const task = (): SessionTask => { const gen = generation, user = getCacheUser() ?? null; return { gen, user, current: () => generation === gen && getCacheUser() === user, tokens: async () => null }; };
function Probe({ attempt = 0 }: { attempt?: number }) { rendered.push(useVibeAnswers(attempt)); return null; }
beforeEach(async () => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; generation++; resetCacheUser(); await bindCacheUser('A'); mockDisk.clear(); rendered = []; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
test('remote chosen after the initial null reaches a mounted reader', async () => {
    await act(async () => root.render(<Probe />)); expect(rendered.at(-1)).toBeNull();
    await act(async () => { await store.vibeOffered({ request: async <T,>() => ({ status: 'completed', answers }) as T }, task()); });
    expect(rendered.at(-1)).toEqual(answers);
});
test('finish and retake update the reader, then Reset clears it', async () => {
    const api = { request: async <T,>() => ({}) as T }; await act(async () => root.render(<Probe />));
    for (const chaos of [2, 4]) {
        await act(async () => { await store.runVibeIntent(api, task(), { kind: 'save', answers: { ...answers, chaos } }); }); expect(rendered.at(-1)?.chaos).toBe(chaos);
    }
    await act(async () => { await store.runVibeIntent(api, task(), { kind: 'reset' }); }); expect(rendered.at(-1)).toBeNull();
});
test('an old-owner store does not notify and a switch never renders old answers', async () => {
    await store.storeVibe(chosen(), 'A'); await act(async () => root.render(<Probe />)); expect(rendered.at(-1)).toEqual(answers);
    rendered.length = 0; await act(async () => { await bindCacheUser('B'); }); expect(rendered.every(v => v === null)).toBe(true);
    const notify = jest.fn(), off = subscribeVibe(notify); await store.storeVibe(chosen(), 'A'); expect(notify).not.toHaveBeenCalled(); off();
});
test('a slow load overtaken by a newer change is dropped', async () => {
    let resolve!: (v: ReturnType<typeof chosen>) => void; const old = new Promise<ReturnType<typeof chosen>>(r => { resolve = r; });
    jest.spyOn(store, 'loadVibe').mockReturnValueOnce(old).mockResolvedValueOnce(chosen({ ...answers, chaos: 4 }));
    await act(async () => root.render(<Probe />)); await act(async () => notifyVibeChanged()); expect(rendered.at(-1)?.chaos).toBe(4);
    await act(async () => resolve(chosen())); expect(rendered.at(-1)?.chaos).toBe(4);
});
test('refreshKey re-reads without a storage notification', async () => {
    await act(async () => root.render(<Probe />)); mockDisk.set('veyrnox.vibe.v2', JSON.stringify({ owner: 'A', value: JSON.stringify(chosen()) }));
    await act(async () => root.render(<Probe attempt={1} />)); expect(rendered.at(-1)).toEqual(answers);
});
test('failed storage write emits no changed event', async () => {
    const notify = jest.fn(), off = subscribeVibe(notify); jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('disk'));
    await expect(store.storeVibe(chosen(), 'A')).rejects.toThrow('disk'); expect(notify).not.toHaveBeenCalled(); off();
});

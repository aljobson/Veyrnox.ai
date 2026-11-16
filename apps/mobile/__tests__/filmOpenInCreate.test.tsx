jest.mock('../src/auth/AuthProvider', () => { const api = { request: jest.fn() }; return { useAuth: () => ({ api }) }; });
import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/film/shot/[id]';
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { getOpenedFilm, openCloudFilm } from '../src/lib/filmCloud';
import { saveStudio } from '../src/lib/filmStudioStore';
import { appCache } from '../src/lib/appCache';
declare const __dirname: string;
const { readFileSync } = require('fs'); const { resolve } = require('path');
const source = readFileSync(resolve(__dirname, '../../../app/veyrnox/_lib/filmStudio.js'), 'utf8').replace(/^export /gm, '');
const web = new Function(`${source}\nreturn { emptyFilm, SHOT_LANES, promptContext };`)();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: 'S1' }), useRouter: () => ({ push: mockPush }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => cb([{ id: 'video', name: 'Video', modality: 'text-to-video', credits: 12, durations: [10], gated: false, capabilities: { inputs: { prompt: { max: 4000 } } } }]) }));
void [RN.ScrollView, RN.Text, RN.Pressable, RN.StyleSheet, RN.View, RN.ActivityIndicator];
let root: Root;
const has = (text: string) => root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(text))).length > 0;
function film() {
    const f = { ...web.emptyFilm(), name: 'Alice film', stack: { ...web.emptyFilm().stack, video: 'Video' },
        shots: [{ ...Object.fromEntries(web.SHOT_LANES.flatMap(([, fields]: any) => fields.map(([key]: any) => [key, 'detail']))), id: 'S1', oneAction: true, location: '', characters: 'none', props: 'none', seconds: '10', description: 'Alice private shot' }] };
    f.prompts = [{ shot: 'S1', version: 1, content: 'Alice prompt', context: web.promptContext(f, f.shots[0]), at: '2026-10-21' }];
    return f;
}
async function mount() { root = createRoot(); await act(async () => root.render(<Screen />)); }
beforeEach(async () => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; resetCacheUser(); await wipeCache(); await bindCacheUser('alice'); jest.clearAllMocks(); });
afterEach(async () => { if (root) await act(async () => root.unmount()); jest.restoreAllMocks(); resetCacheUser(); });
test('Open in Create hands the shot prompt, model, length and format to Create', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await openCloudFilm({ request: jest.fn().mockResolvedValue({ project: { id, revision: 1 }, studio_json: JSON.stringify(film()) }) }, id);
    await mount();
    const open = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.children.some((c: any) => typeof c !== 'string' && c.children?.includes('Open in Create')))[0];
    expect(open).toBeDefined();
    await act(async () => open.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toMatchObject({ pathname: '/create/[modelId]', params: { modelId: 'video', prompt: 'Alice prompt', duration: '10' } });
    expect(has('Shot 1')).toBe(true); expect(has('S1 ·')).toBe(false);
});

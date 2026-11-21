import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { FinishedShapeWarning, SmartCutShapeHint, SmartCutShapeSession } from '../src/components/create/SmartCutShapeHint';
import type { ApiClient } from '../src/lib/api';
import { rawText, t } from '../src/lib/i18n';
jest.setTimeout(30000);
let mockOwner = 'owner';
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: () => () => {} }));
let root: Root;
const request = jest.fn();
const api = { request } as unknown as ApiClient;
const old = { job_id: 'old', state: 'succeeded', has_asset: true, video_width: 1080, video_height: 1920, shape_ambiguous: false };
const latest = { ...old, job_id: 'new', video_width: 1920, video_height: 1080 };
const button = () => root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === rawText(t('videoShape.match', { shape: `${t('videoShape.portrait')} 9:16` })));
async function render(finished = false, video = true) {
    await act(async () => root.render(<SmartCutShapeSession key={mockOwner}>
        <SmartCutShapeHint api={api} video={video} options={['16:9', '9:16']} value="16:9" onChange={() => {}} />
        {finished ? <FinishedShapeWarning api={api} id="new" requested={null} /> : null}
    </SmartCutShapeSession>));
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockOwner = 'owner'; request.mockReset(); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test('completion refresh waits for measurement, bypasses the mounted cache once, and updates the hint', async () => {
    let finish!: () => void, measured = false;
    request.mockImplementation(async (path: string) => {
        if (path.endsWith('/shapes')) return new Promise(resolve => { finish = () => { measured = true; resolve({ shapes: [{ job_id: 'new', width: 1920, height: 1080 }] }); }; });
        return { jobs: [measured ? latest : old] };
    });
    await render(); expect(button()).toHaveLength(1); expect(request).toHaveBeenCalledTimes(1);
    await render(false, false); await render(); expect(request).toHaveBeenCalledTimes(1);
    await render(true); expect(button()).toHaveLength(1); expect(request).toHaveBeenCalledTimes(2);
    await act(async () => finish());
    expect(button()).toHaveLength(0); expect(request).toHaveBeenCalledTimes(3);
    await render(true); expect(request).toHaveBeenCalledTimes(3);
});
test('an unreadable completion keeps the old hint and does not retry', async () => {
    request.mockImplementation(async (path: string) => path.endsWith('/shapes') ? { shapes: [] } : { jobs: [old] });
    await render(); await render(true);
    expect(button()).toHaveLength(1); expect(request).toHaveBeenCalledTimes(3);
    await render(true); expect(request).toHaveBeenCalledTimes(3);
});
test('another account never sees the mounted account cache', async () => {
    request.mockResolvedValue({ jobs: [old] });
    await render(); expect(button()).toHaveLength(1);
    mockOwner = 'other'; request.mockResolvedValue({ jobs: [] });
    await render(); expect(button()).toHaveLength(0); expect(request).toHaveBeenCalledTimes(2);
});
test('a nonstandard previous shape names its exact dimensions in the hint and unsupported sentence', async () => {
    request.mockResolvedValue({ jobs: [{ ...old, video_width: 1280, video_height: 768 }] });
    await render();
    const previous = `${t('videoShape.landscape')} 1280x768`;
    const chosen = `${t('videoShape.landscape')} 16:9`;
    for (const value of [t('videoShape.hint', { previous, chosen }), t('videoShape.unsupported', { shape: previous })]) {
        expect(root.container.queryAll(node => node.children.includes(rawText(value)))).toHaveLength(1);
    }
    expect(root.container.queryAll(node => node.props.accessibilityRole === 'button')).toHaveLength(0);
});

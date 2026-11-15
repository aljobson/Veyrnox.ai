import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';

const mockList = jest.fn();
jest.mock('../src/lib/submittedRequests', () => ({ submittedRequests: { list: () => mockList() } }));
jest.mock('../src/lib/clipboard', () => ({ copyText: jest.fn(async () => true) }));
const mockGetProvenance = jest.fn();
jest.mock('../src/lib/media', () => ({ mediaApi: () => ({ getProvenance: mockGetProvenance }) }));
const { JobProvenance } = require('../src/components/JobProvenance') as typeof import('../src/components/JobProvenance');
const { copyText } = require('../src/lib/clipboard') as typeof import('../src/lib/clipboard');

const SHA = 'a'.repeat(64);
const body = (mime: string) => ({ generated: true, model: { id: 'm', name: 'Kling 3.0' }, credits: 32, completed_at: '2026-11-14T22:49:14Z', content: { sha256: SHA, mime_type: mime, size_bytes: 14680064 } });
let root: Root;
const flat = (n: any): string => typeof n === 'string' ? n : [n.props?.accessibilityLabel, ...(n.children ?? []).map(flat)].filter(Boolean).join(' ');
const texts = () => flat(root.container);
async function press(label: string) {
    const node = root.container.queryAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label && typeof n.props.onClick === 'function')[0];
    await act(async () => { await node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test.each(['image/png', 'video/mp4', 'audio/mpeg', 'application/zip'])('%s: shows model, date, cost and prompt; hides technical rows', async (mime) => {
    mockGetProvenance.mockResolvedValue(body(mime));
    mockList.mockResolvedValue([{ id: 'job1', request: { prompt: 'a red fox at dawn' } }]);
    await act(async () => root.render(<JobProvenance api={{} as any} jobId="job1" />));
    await press('Show how this was made');
    const s = texts();
    expect(s).toContain('Kling 3.0'); expect(s).toContain('a red fox at dawn'); expect(s).toContain('Copy prompt');
    expect(s).not.toContain(SHA); expect(s).not.toContain(mime); expect(s).toContain('Technical details');
});

test('technical details keep the file type, exact time and SHA-256', async () => {
    mockGetProvenance.mockResolvedValue(body('video/mp4'));
    mockList.mockResolvedValue([]);
    await act(async () => root.render(<JobProvenance api={{} as any} jobId="job1" />));
    await press('Show how this was made');
    expect(texts()).toContain('The prompt is not saved on this phone');
    await press('Show technical details');
    const s = texts();
    expect(s).toContain(SHA); expect(s).toContain('video/mp4'); expect(s).toContain('Exact time');
});

test('Copy prompt copies the saved prompt', async () => {
    mockGetProvenance.mockResolvedValue(body('image/png'));
    mockList.mockResolvedValue([{ id: 'job1', request: { prompt: 'a red fox' } }]);
    await act(async () => root.render(<JobProvenance api={{} as any} jobId="job1" />));
    await press('Show how this was made');
    await press('Copy prompt');
    expect(copyText).toHaveBeenCalledWith('a red fox');
});

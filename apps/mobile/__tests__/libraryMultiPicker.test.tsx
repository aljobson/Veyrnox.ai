import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { LibraryMultiPicker } from '../src/components/LibraryMultiPicker';
import { t } from '../src/lib/i18n';

const job = (id: string, model_id: string, created_at: string) => ({ job_id: id, model_id, state: 'succeeded', has_asset: true, held: false, label: `name-${id}`, created_at });
const mockModels = [{ id: 'img', name: 'Img', modality: 'text-to-image' }, { id: 'vid', name: 'Vid', modality: 'text-to-video' }];
const mockJobs = [job('i1', 'img', '2026-11-04T10:00:00Z'), job('i2', 'img', '2026-11-04T09:00:00Z'), job('v1', 'vid', '2026-11-04T08:00:00Z')];
jest.mock('../src/lib/media', () => ({
    ...jest.requireActual('../src/lib/media'),
    mediaApi: () => ({ listJobs: async () => ({ jobs: mockJobs, next: null }), getAsset: async () => ({ url: 'https://files.test/a.png', mime_type: 'image/png' }) }),
    fetchCatalogCached: async (cb: (m: unknown[]) => void) => { cb(mockModels); return mockModels; },
}));

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
const click = (n: any) => act(async () => n.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
const rows = () => root.container.queryAll(n => n.props.accessibilityRole === 'checkbox');

test('picks in order, stops at the model\'s limit for a kind, and hands back the order chosen', async () => {
    const onConfirm = jest.fn();
    await act(async () => root.render(<LibraryMultiPicker api={{} as never} capacity={{ image: 1, video: 1, audio: 0 }} onConfirm={onConfirm} onClose={jest.fn()} />));
    expect(rows()).toHaveLength(3);
    await click(rows()[2]);                       // the video first
    await click(rows()[0]);                       // then the newest picture
    await click(rows()[1]);                       // a second picture: over the limit of 1, ignored
    await click(root.container.queryAll(n => n.props.accessibilityLabel === t('app.create.addFiles.add') && n.props.onClick)[0]);
    expect(onConfirm).toHaveBeenCalledWith([{ jobId: 'v1', name: 'name-v1', kind: 'video' }, { jobId: 'i1', name: 'name-i1', kind: 'image' }]);
});

test('a kind the model cannot take is not offered', async () => {
    await act(async () => root.render(<LibraryMultiPicker api={{} as never} capacity={{ image: 2, video: 0, audio: 0 }} onConfirm={jest.fn()} onClose={jest.fn()} />));
    expect(rows()).toHaveLength(2);
});

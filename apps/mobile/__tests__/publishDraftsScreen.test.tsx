import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import Drafts from '../src/app/(app)/publish/drafts';

const B1 = '44444444-4444-4444-8444-444444444444';
const B2 = '55555555-5555-4555-8555-555555555555';
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
const mockPush = jest.fn();
jest.setTimeout(20000);

jest.mock('react-native', () => {
    const React = require('react');
    const actual = jest.requireActual('react-native');
    const SectionList = (props: any) => React.createElement('SectionList', props,
        props.ListHeaderComponent,
        ...props.sections.flatMap((section: any, sectionIndex: number) => [
            React.createElement(React.Fragment, { key: `header-${section.batchId ?? sectionIndex}` }, props.renderSectionHeader({ section })),
            ...section.data.map((item: any, index: number) => React.createElement(React.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index, section }))),
        ]),
    );
    return Object.defineProperty(Object.create(actual), 'SectionList', { value: SectionList });
});
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }) }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('../src/components/publish/NetworkLogo', () => ({ NetworkLogo: () => null }));
jest.mock('../src/components/VeyLoader', () => ({ VeyLoader: () => null }));

const rawDraft = (index: number, batch: string | null) => ({
    id: `draft-${String(index).padStart(3, '0')}`,
    draft_batch_id: batch,
    global_text: `Draft ${index}`,
    scheduled_at: null,
    created_at: `2026-11-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    media: [],
    networks: [index % 2 ? 'linkedin' : 'tiktok'],
});

let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    jest.clearAllMocks();
    const drafts = Array.from({ length: 60 }, (_, index) => rawDraft(index, index % 3 === 0 ? B1 : index % 3 === 1 ? B2 : null));
    mockRequest.mockResolvedValue({ drafts, approvalEnabled: true });
});
afterEach(async () => { await act(async () => root.unmount()); });

test('large draft sections preserve batch order, stable item keys and refresh to the newest response', async () => {
    await act(async () => root.render(<Drafts />));
    const list = () => root.container.queryAll(node => node.type === 'SectionList')[0];
    expect(list().props.sections.map((section: any) => section.batchId)).toEqual([B1, B2, null]);
    expect(list().props.sections.map((section: any) => section.data.length)).toEqual([20, 20, 20]);
    expect(list().props.sections[0].data.map((item: any) => item.id)).toEqual(Array.from({ length: 20 }, (_, index) => `draft-${String(index * 3).padStart(3, '0')}`));
    const items = list().props.sections.flatMap((section: any) => section.data);
    expect(new Set(items.map((item: any) => list().props.keyExtractor(item))).size).toBe(60);

    mockRequest.mockResolvedValueOnce({ drafts: [rawDraft(99, B2)], approvalEnabled: false });
    await act(async () => { await list().props.refreshControl.props.onRefresh(); });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(list().props.sections).toHaveLength(1);
    expect(list().props.sections[0].data.map((item: any) => item.id)).toEqual(['draft-099']);
});

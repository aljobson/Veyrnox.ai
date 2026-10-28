import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import BestTime from '../src/app/(app)/publish/best-time';
import { BestTimeHeatmap, CELL, LABEL_MIN } from '../src/components/publish/BestTimeHeatmap';
import { heatGrid, dayName, hourText } from '../src/lib/publishHeatmap';
import { parseInsights } from '../src/lib/publishInsights';
import { t } from '../src/lib/i18n';
import type { ApiClient } from '../src/lib/api';
import { deferred, press, textOf } from './publishDepthTestHelpers';
const mockRequest = jest.fn(); let mockApi = { request: mockRequest } as unknown as ApiClient;
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
void [RN.Pressable, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator];
const response = (day = 1, hour = 12) => ({ insights: { timezone: 'Europe/London', measured_posts: 20, recorded_posts: 25, history_days: 30, heatmap: [
    { day, hour, posts: 5, score: 9 }, { day: 2, hour: 1, posts: 3, score: 3 }, { day: 2, hour: 2, posts: 3, score: 6 }, { day: 2, hour: 3, posts: 3, score: 0 }, { day: 3, hour: 1, posts: 1, score: 100 },
] } });
const accounts = { accounts: ['A', 'B'].map(id => ({ id, display_name: id, network: 'twitter', status: 'active' })) };
let root: Root, announce: jest.SpyInstance;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); root = createRoot();
    Object.defineProperty(RN.Platform, 'OS', { configurable: true, value: 'ios' });
    announce = jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    mockApi = { request: mockRequest } as unknown as ApiClient;
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/accounts') ? accounts : response());
});
afterEach(async () => { await act(async () => root.unmount()); announce.mockRestore(); });
const cells = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && /posts:|publications :/.test(n.props.accessibilityLabel ?? ''));
async function select(id: string) {
    const match = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel?.startsWith(`${id}, twitter,`));
    expect(match).toHaveLength(1); await act(async () => match[0].props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1 }));
}
test('grid preserves web measurement, levels, zero maximum and missing cells', () => {
    const i = parseInsights(response())!, grid = heatGrid(i);
    expect(grid).toHaveLength(24); expect(grid[0]).toHaveLength(7);
    expect(grid[12][0].level).toBe(3); expect(grid[1][1].level).toBe(1); expect(grid[2][1].level).toBe(2); expect(grid[3][1].level).toBe(0);
    expect(grid[1][2].measured).toBe(false); expect(grid[0][0]).toMatchObject({ posts: 0, score: null, measured: false, level: null });
    expect(heatGrid({ ...i, cells: [{ day: 1, hour: 0, posts: 3, score: 0 }] })[0][0].level).toBe(0);
});
test('168 labelled cells, scores, legend, selected details and one mount announcement', async () => {
    await act(async () => root.render(<BestTime />)); expect(cells()).toHaveLength(168);
    const label = t('publishTiming.heat.cell', { day: dayName(1), hour: hourText(12), score: '9', count: '5' });
    expect(textOf(cells().find(n => n.props.accessibilityLabel === label)!)).toBe('9');
    expect(textOf(cells()[0])).toBe('—');
    for (const key of ['lower', 'higher', 'insufficient', 'scroll']) expect(textOf(root.container)).toContain(t(`publishTiming.heat.${key}`));
    expect(announce).toHaveBeenCalledTimes(1); expect(announce.mock.calls[0][0]).toContain('Heatmap');
    await act(async () => root.render(<BestTime />)); expect(announce).toHaveBeenCalledTimes(1);
    await press(root, label); expect(textOf(root.container)).toContain(label); expect(announce).toHaveBeenLastCalledWith(label);
    await press(root, label); expect(cells().find(n => n.props.accessibilityLabel === label)!.props.accessibilityState.selected).toBe(false);
});
test('switch waits for B identity; selected re-tap preserves A without fetching or announcing', async () => {
    const b = deferred<unknown>(); mockRequest.mockImplementation((path: string) => Promise.resolve(path.endsWith('/accounts') ? accounts : path.endsWith('=B') ? b.promise : response()));
    await act(async () => root.render(<BestTime />)); const count = mockRequest.mock.calls.length, aSummary = announce.mock.calls[0][0];
    await select('A'); expect(cells()).toHaveLength(168); expect(mockRequest).toHaveBeenCalledTimes(count); expect(announce).toHaveBeenCalledTimes(1);
    await select('B'); expect(cells()).toHaveLength(0); expect(announce).toHaveBeenCalledTimes(1);
    await act(async () => b.resolve(response(7, 20))); expect(cells()).toHaveLength(168); expect(announce).toHaveBeenCalledTimes(2); expect(announce.mock.calls[1][0]).not.toBe(aSummary);
});
test('API change hides old data and remounts summary only after new data', async () => {
    await act(async () => root.render(<BestTime />)); const wait = deferred<unknown>();
    mockApi = { request: jest.fn((path: string) => Promise.resolve(path.endsWith('/accounts') ? accounts : wait.promise)) } as unknown as ApiClient;
    await act(async () => root.render(<BestTime />)); expect(cells()).toHaveLength(0); expect(announce).toHaveBeenCalledTimes(1);
    await act(async () => wait.resolve(response(6, 18))); expect(announce).toHaveBeenCalledTimes(2);
});
test('no heatmap when top slots are empty', async () => {
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/accounts') ? accounts : { insights: { ...response().insights, heatmap: [] } });
    await act(async () => root.render(<BestTime />)); expect(cells()).toHaveLength(0); expect(announce).not.toHaveBeenCalled();
});
test.each([1, 2])('320 point grid at fontScale %s keeps 44 point cells inside horizontal scroller', async fontScale => {
    const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 320, height: 700, scale: 1, fontScale });
    await act(async () => root.render(<BestTimeHeatmap insights={parseInsights(response())!} />));
    expect(LABEL_MIN + CELL).toBeLessThanOrEqual(288); expect(cells()).toHaveLength(168);
    for (const node of cells()) { const style = RN.StyleSheet.flatten(node.props.style); expect(style.width).toBe(CELL); expect(style.minHeight).toBeGreaterThanOrEqual(44); }
    expect(root.container.queryAll(n => n.props.horizontal === true).length).toBeGreaterThan(0);
    expect(textOf(root.container)).toContain(t('publishTiming.heat.scroll')); dimensions.mockRestore();
});

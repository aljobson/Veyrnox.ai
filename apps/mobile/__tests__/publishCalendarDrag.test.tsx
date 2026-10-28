import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Calendar from '../src/app/(app)/publish/calendar';
import { ApiError, type ApiClient } from '../src/lib/api';
import { brandStore } from '../src/lib/publishBrand';
import { dayKey, parseCalendar, type CalendarPost } from '../src/lib/publishCalendar';
import { useCalendarDrag, measureDropTargets } from '../src/components/publish/useCalendarDrag';
import { pendingDelays } from '../src/lib/publishCalendarMove';
import { dateText, timeText } from '../src/components/WhenPicker';
import { moveTime } from '../src/components/publish/CalendarMoveSheet';
import { t } from '../src/lib/i18n';
import { buttons, deferred, input, press, textOf, OTHER } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockPush = jest.fn(); let mockApi = { request: mockRequest } as unknown as ApiClient;
const mockMeasure = jest.fn();
jest.mock('../src/components/UnlockCard', () => ({ UnlockCard: () => null }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }) }));
var mockUser = 'owner'; var mockListeners = new Set<() => void>();
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockUser, subscribeCacheUser: (fn: () => void) => { (mockListeners ??= new Set()).add(fn); return () => mockListeners.delete(fn); } }));
jest.mock('../src/components/publish/useCalendarDrag', () => ({ ...jest.requireActual('../src/components/publish/useCalendarDrag'), measureDropTargets: (...args: unknown[]) => mockMeasure(...args) }));
void [RN.Pressable, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.RefreshControl, RN.Modal];
const OLD = new Date(2030, 0, 2, 12, 34), NEW = new Date(2030, 0, 3, 12, 34), THIRD = new Date(2030, 0, 4, 16, 0);
const raw = (id = 'A', at = OLD.toISOString(), status = 'scheduled', target = 'pending') => ({ id, global_text: `${id} caption`, status, scheduled_at: at, can_reschedule: true, targets: [{ id: `${id}-t`, network: 'twitter', publish_status: target }] });
let root: Root, rows: ReturnType<typeof raw>[], role: string, announce: jest.SpyInstance;
const originalOS = RN.Platform.OS;
const patch = jest.fn(), read = jest.fn();
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.setSystemTime(new Date(2030, 0, 1));
    jest.clearAllMocks(); brandStore.set(null); mockUser = 'owner'; role = 'owner'; rows = [raw(), raw('B')]; root = createRoot();
    Object.defineProperty(RN.Platform, 'OS', { configurable: true, value: 'ios' }); announce = jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    mockApi = { request: mockRequest } as unknown as ApiClient;
    mockMeasure.mockImplementation((_refs, done) => done([{ key: dayKey(NEW), x: 10, y: 20, width: 40, height: 48 }]));
    patch.mockReset().mockImplementation(async (id: string, body: { scheduledAt: string }) => { rows = rows.map(p => p.id === id ? { ...p, scheduled_at: body.scheduledAt } : p); return { scheduled_at: body.scheduledAt }; });
    read.mockReset().mockImplementation(async (id: string) => ({ post: rows.find(p => p.id === id) }));
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path.endsWith('/accounts')) return { brandRole: role, accounts: [] };
        if (path.includes('/calendar?')) return { posts: rows };
        const id = path.split('/')[5];
        return init?.method === 'PATCH' ? patch(id, JSON.parse(init.body as string)) : read(id);
    });
});
afterEach(async () => { await act(async () => root.unmount()); announce.mockRestore(); Object.defineProperty(RN.Platform, 'OS', { configurable: true, value: originalOS }); brandStore.set(null); jest.useRealTimers(); });
const render = async () => { await act(async () => root.render(<Calendar />)); };
const event = (pageX = 30, pageY = 35) => ({ persist: () => {}, currentTarget: 1, target: 1, nativeEvent: { pageX, pageY, timestamp: Date.now() } });
const row = (id = 'A') => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel?.endsWith(`${id} caption`))[0];
const wrapper = (id = 'A') => row(id).parent!;
const list = () => root.container.queryAll(n => typeof n.props.scrollEnabled === 'boolean')[0];
const text = () => textOf(root.container);
const click = async (key: string) => press(root, t(`publishTiming.move.${key}`));
async function arm(id = 'A') {
    await act(async () => row(id).props.onResponderGrant(event()));
    await act(async () => jest.advanceTimersByTime(400));
}
async function call(prop: string, id = 'A', point = event()) { await act(async () => wrapper(id).props[prop](point)); }
async function menu(id = 'A', when = NEW) {
    await act(async () => row(id).props.onAccessibilityAction({ nativeEvent: { actionName: 'move' } }));
    await input(root, t('whenPicker.dateyearmonthday'), dateText(when)); await input(root, t('whenPicker.timehourminute'), timeText(when));
}
async function move(id = 'A') { await menu(id); await click('save'); }
async function advance(ms: number) { await act(async () => { jest.advanceTimersByTime(ms); }); }
async function refresh() {
    const control = root.container.queryAll(n => n.props.refreshControl)[0].props.refreshControl;
    await act(async () => { await control.props.onRefresh(); });
}
const status = (key: string, id = 'A', at = NEW.toISOString()) => t(`publishTiming.move.${key}`, { post: `${id} caption`, time: moveTime(at) });
const pending = () => { expect(text()).toContain(status('pending')); expect(buttons(root, t('publishTiming.move.keep'))).toHaveLength(0); };
test('month drag preserves local time and sends exactly one CAS PATCH after confirmation', async () => {
    await render(); await press(root, t('calendar.month')); await arm(); expect(list().props.scrollEnabled).toBe(false);
    expect(wrapper().props.onMoveShouldSetResponderCapture()).toBe(true); await call('onResponderGrant');
    await act(async () => row().props.onResponderTerminate(event())); // grant precedes Pressable termination
    expect(list().props.scrollEnabled).toBe(false); await call('onResponderMove'); await call('onResponderRelease');
    expect(text()).toContain(t('publishTiming.move.new', { time: moveTime(NEW.toISOString()), zone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    expect(patch).not.toHaveBeenCalled(); await click('save');
    expect(patch).toHaveBeenCalledTimes(1); expect(patch).toHaveBeenCalledWith('A', { expectedAt: OLD.toISOString(), scheduledAt: NEW.toISOString() });
    expect(announce).toHaveBeenCalledWith(status('done'));
});
test('hold without moving cancels, then short tap still opens the post', async () => {
    await render(); await arm(); await act(async () => row().props.onResponderRelease(event()));
    expect(list().props.scrollEnabled).toBe(true); expect(buttons(root, t('publishTiming.move.save'))).toHaveLength(0);
    await act(async () => row().props.onClick(event())); expect(mockPush).toHaveBeenCalledTimes(1); expect(patch).not.toHaveBeenCalled();
});
test.each(['onResponderTerminate', 'onResponderReject', 'outside'])('%s cancels takeover without a sheet or write', async kind => {
    await render(); await arm(); await call('onResponderGrant');
    await act(async () => row().props.onResponderTerminate(event()));
    await call(kind === 'outside' ? 'onResponderRelease' : kind, 'A', event(500, 500));
    expect(list().props.scrollEnabled).toBe(true); expect(buttons(root, t('publishTiming.move.save'))).toHaveLength(0); expect(patch).not.toHaveBeenCalled();
});
test('week strip is an overlay, exists only when armed and measures on layout', async () => {
    await render(); expect(root.container.queryAll(n => n.props.accessibilityElementsHidden && RN.StyleSheet.flatten(n.props.style)?.position === 'absolute')).toHaveLength(0);
    await arm(); const strip = root.container.queryAll(n => n.props.accessibilityElementsHidden && RN.StyleSheet.flatten(n.props.style)?.position === 'absolute')[0];
    expect(strip).toBeDefined(); const count = mockMeasure.mock.calls.length;
    await act(async () => strip.props.onLayout()); expect(mockMeasure).toHaveBeenCalledTimes(count + 1);
});
test('timeout committed on server resolves by timestamp equality without another PATCH', async () => {
    patch.mockRejectedValue(new ApiError(0, 'network', { timedOut: true }));
    read.mockImplementation(async () => { rows[0] = raw('A', NEW.toISOString().replace('Z', '+00:00')); return { post: rows[0] }; });
    await render(); await move(); pending(); await advance(2000);
    expect(patch).toHaveBeenCalledTimes(1); expect(announce).toHaveBeenCalledWith(status('done')); expect(text()).not.toContain(status('pending'));
});
test('HTTP 408 keeps the optimistic move pending until a read confirms the commit', async () => {
    patch.mockRejectedValue(new ApiError(408, 'request_timeout'));
    await render(); await move(); pending();
    expect(row().props.accessibilityActions).toBeUndefined();
    await advance(2000); pending();
    read.mockImplementation(async () => { rows[0] = raw('A', NEW.toISOString()); return { post: rows[0] }; });
    await advance(4000);
    expect(announce).toHaveBeenCalledWith(status('done')); expect(patch).toHaveBeenCalledTimes(1);
});
test('expired time and exhausted checks cannot disprove a late commit; manual Check remains available', async () => {
    jest.setSystemTime(new Date(+NEW - 61_000));
    patch.mockRejectedValue(new ApiError(408, 'request_timeout'));
    await render(); await move();
    for (const delay of pendingDelays) await advance(delay);
    expect(read).toHaveBeenCalledTimes(4); expect(text()).toContain(status('stillPending'));
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(4);
    expect(buttons(root, t('publishTiming.move.retry'))).toHaveLength(0);
    expect(buttons(root, t('publishTiming.move.check'))).toHaveLength(1);
    expect(buttons(root, t('publishTiming.move.keep'))).toHaveLength(0);
    expect(row().props.accessibilityActions).toBeUndefined();
    read.mockImplementation(async () => { rows[0] = raw('A', NEW.toISOString()); return { post: rows[0] }; });
    await click('check');
    expect(announce).toHaveBeenCalledWith(status('done')); expect(text()).not.toContain(status('stillPending'));
});
test('old snapshots before commit keep the new day until the third read', async () => {
    patch.mockRejectedValue(new ApiError(0, 'network', { timedOut: true }));
    read.mockResolvedValueOnce({ post: raw() }).mockResolvedValueOnce({ post: raw() }).mockImplementation(async () => { rows[0] = raw('A', NEW.toISOString()); return { post: rows[0] }; });
    await render(); await move(); await advance(2000); pending(); await advance(4000); pending();
    expect(text()).not.toContain('Nothing was posted'); expect(announce.mock.calls.some(([m]) => m === status('done'))).toBe(false);
    await advance(8000); expect(announce.mock.calls.filter(([m]) => m === status('done'))).toHaveLength(1);
});
test('bounded checks, failed read, manual Check and byte-identical retry with refusal remain pending', async () => {
    patch.mockRejectedValue(new ApiError(0, 'network')); read.mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValue({ post: raw() });
    await render(); await move(); for (const delay of pendingDelays) await advance(delay);
    expect(read).toHaveBeenCalledTimes(4); expect(text()).toContain(status('stillPending')); await advance(60_000); expect(read).toHaveBeenCalledTimes(4);
    patch.mockRejectedValue(new ApiError(400, 'INVALID_SCHEDULE')); await click('retry');
    expect(patch).toHaveBeenCalledTimes(2); expect(patch.mock.calls[1]).toEqual(patch.mock.calls[0]);
    expect(read).toHaveBeenCalledTimes(5); expect(text()).toContain(status('stillPending')); expect(text()).not.toContain('Nothing was posted');
    read.mockImplementation(async () => { rows[0] = raw('A', NEW.toISOString()); return { post: rows[0] }; });
    await click('check'); expect(read).toHaveBeenCalledTimes(6); expect(announce).toHaveBeenCalledWith(status('done'));
});
test('retry disappears at the 60 second boundary while Check remains', async () => {
    patch.mockRejectedValue(new ApiError(0, 'network')); await render(); await move();
    await act(async () => jest.setSystemTime(new Date(+NEW - 30_000))); await render();
    expect(buttons(root, t('publishTiming.move.retry'))).toHaveLength(0); expect(buttons(root, t('publishTiming.move.check'))).toHaveLength(1);
});
test.each([
    ['other', 'scheduled', 'pending', THIRD.toISOString(), 'serverHas'],
    ['published', 'published', 'pending', OLD.toISOString(), 'started'],
    ['publishing', 'scheduled', 'publishing', OLD.toISOString(), 'started'],
    ['canceled old', 'canceled', 'pending', OLD.toISOString(), 'canceled'],
    ['canceled new', 'canceled', 'pending', NEW.toISOString(), 'canceled'],
    ['draft', 'draft', 'pending', OLD.toISOString(), 'unscheduled'],
])('pending resolution %s is status-accurate', async (_name, state, target, at, key) => {
    patch.mockRejectedValue(new ApiError(0, 'network'));
    read.mockImplementation(async () => { rows[0] = raw('A', at, state, target); return { post: rows[0] }; });
    await render(); await move(); await advance(2000); expect(text()).toContain(status(key, 'A', at)); expect(announce).toHaveBeenCalledWith(status(key, 'A', at));
    expect(buttons(root, t('publishTiming.move.reload'))).toHaveLength(1); await advance(60_000); expect(read).toHaveBeenCalledTimes(1);
    if (key === 'canceled') expect(announce.mock.calls.some(([m]) => m === status('done') || m.includes('publishing has started'))).toBe(false);
});
test('404 re-read resolves gone', async () => {
    patch.mockRejectedValue(new ApiError(0, 'network')); read.mockRejectedValue(new ApiError(404, 'POST_NOT_FOUND'));
    await render(); await move(); await advance(2000); expect(text()).toContain(t('publishCompose.thatpostisnolongerthere')); expect(buttons(root, t('publishTiming.move.reload'))).toHaveLength(1);
});
test('502 and failed re-read keep pending; closing preserves it and blocks a second move of that post', async () => {
    patch.mockRejectedValue(new ApiError(502, 'internal')); read.mockRejectedValue(new ApiError(0, 'network'));
    await render(); await move(); await advance(2000); pending(); expect(row().props.accessibilityActions).toBeUndefined(); expect(wrapper().props.onMoveShouldSetResponderCapture).toBeUndefined();
    await click('close'); expect(text()).toContain(status('pending')); await advance(4000); expect(read).toHaveBeenCalledTimes(2);
    await arm('B'); expect(list().props.scrollEnabled).toBe(false);
});
test.each([400, 429, 409])('definite %s refusal undoes only A and offers the proper recovery', async code => {
    patch.mockRejectedValue(new ApiError(code, code === 409 ? 'POST_BUSY' : 'INVALID_SCHEDULE'));
    await render(); await move(); expect(read).not.toHaveBeenCalled(); expect(text()).not.toContain(status('pending'));
    expect(row().props.accessibilityActions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'move' })]));
    expect(buttons(root, t('publishTiming.move.retry'))).toHaveLength(code === 429 ? 1 : 0);
    expect(buttons(root, t('publishTiming.move.reload'))).toHaveLength(code === 409 ? 1 : 0);
    expect(buttons(root, t('publishTiming.move.close'))).toHaveLength(1);
});
test.each([OLD, THIRD])('answered SCHEDULE_CHANGED reads %s and resolves', async at => {
    patch.mockRejectedValue(new ApiError(409, 'SCHEDULE_CHANGED')); read.mockImplementation(async () => { rows[0] = raw('A', at.toISOString()); return { post: rows[0] }; });
    await render(); await move(); expect(read).toHaveBeenCalledTimes(1); expect(text()).not.toContain(status('pending'));
    if (at === THIRD) expect(text()).toContain(status('serverHas', 'A', at.toISOString()));
});
test.each(['viewer', 'reviewer'])('%s has neither move actions nor drag capture', async value => {
    role = value; await render(); expect(row().props.accessibilityActions).toBeUndefined(); expect(wrapper().props.onMoveShouldSetResponderCapture).toBeUndefined();
    await arm(); expect(list().props.scrollEnabled).toBe(true); expect(patch).not.toHaveBeenCalled();
});
test('visible Move-to button edits WhenPicker and submits', async () => {
    await render(); const label = t('publishTiming.move.to', { time: OLD.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) });
    const matches = buttons(root, label); expect(matches).toHaveLength(2);
    await act(async () => matches[0].props.onClick(event())); await input(root, t('whenPicker.dateyearmonthday'), dateText(THIRD)); await input(root, t('whenPicker.timehourminute'), timeText(THIRD));
    await click('save'); expect(patch).toHaveBeenCalledWith('A', { expectedAt: OLD.toISOString(), scheduledAt: THIRD.toISOString() });
});
test('refresh and range navigation preserve pending entries and checks while offscreen', async () => {
    patch.mockRejectedValue(new ApiError(0, 'network')); await render(); await move(); await advance(2000); await click('close');
    await refresh(); expect(text()).toContain(status('pending'));
    await press(root, t('calendar.next')); expect(text()).toContain(status('pending')); await press(root, t('calendar.prev')); expect(text()).toContain(status('pending'));
    read.mockImplementation(async () => { rows[0] = raw('A', NEW.toISOString()); return { post: rows[0] }; });
    await advance(4000); expect(announce).toHaveBeenCalledWith(status('done'));
});
test.each([false, true])('two independent moves resolve/refuse in either order: refusal first %s', async refuseFirst => {
    const b = deferred<unknown>(); patch.mockImplementation((id: string) => id === 'A' ? Promise.reject(new ApiError(0, 'network')) : b.promise);
    await render(); await move(); await click('close'); await menu('B'); await click('save');
    const resolveA = async () => { read.mockImplementation(async () => { rows[0] = raw('A', (refuseFirst ? NEW : THIRD).toISOString()); return { post: rows[0] }; }); await advance(2000); };
    const refuseB = async () => { await act(async () => b.reject(new ApiError(400, 'INVALID_SCHEDULE'))); };
    if (refuseFirst) { await refuseB(); await resolveA(); } else { await resolveA(); await refuseB(); }
    expect(text()).not.toContain(status('pending')); expect(row('B').props.accessibilityLabel).toContain('12:34');
    expect(announce).toHaveBeenCalledWith(status(refuseFirst ? 'done' : 'serverHas', 'A', (refuseFirst ? NEW : THIRD).toISOString()));
    expect(text()).toContain('B caption');
});
test('another successful move reload preserves pending A and announcements name each post', async () => {
    patch.mockImplementation(async (id: string, body: { scheduledAt: string }) => { if (id === 'A') throw new ApiError(0, 'network'); rows[1] = raw('B', body.scheduledAt); return { scheduled_at: body.scheduledAt }; });
    await render(); await move(); await click('close'); await move('B'); expect(text()).toContain(status('pending')); expect(announce).toHaveBeenCalledWith(status('done', 'B'));
    read.mockImplementation(async () => { rows[0] = raw('A', NEW.toISOString()); return { post: rows[0] }; }); await advance(2000);
    expect(announce).toHaveBeenCalledWith(status('done')); expect(status('done')).not.toBe(status('done', 'B'));
});
test('identical captions resolving to the same time each announce once, including after the sheet closes', async () => {
    rows = rows.map(p => ({ ...p, global_text: 'Same caption' }));
    const a = deferred<unknown>(), b = deferred<unknown>();
    patch.mockRejectedValue(new ApiError(0, 'network'));
    read.mockImplementation((id: string) => id === 'A' ? a.promise : b.promise);
    await render();
    const label = t('publishTiming.move.to', { time: OLD.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) });
    for (let i = 0; i < 2; i++) {
        await act(async () => buttons(root, label)[0].props.onClick(event()));
        await input(root, t('whenPicker.dateyearmonthday'), dateText(NEW));
        await input(root, t('whenPicker.timehourminute'), timeText(NEW));
        await click('save'); await click('close');
    }
    await advance(2000);
    const done = t('publishTiming.move.done', { post: 'Same caption', time: moveTime(NEW.toISOString()) });
    for (const [index, held] of [a, b].entries()) {
        rows[index] = { ...rows[index], scheduled_at: NEW.toISOString() };
        await act(async () => held.resolve({ post: rows[index] }));
        expect(announce.mock.calls.filter(([message]) => message === done)).toHaveLength(index + 1);
    }
    await render(); expect(announce.mock.calls.filter(([message]) => message === done)).toHaveLength(2);
});
test('one in-flight request disables manual actions and prevents timer overlap', async () => {
    const held = deferred<unknown>(); patch.mockRejectedValue(new ApiError(0, 'network')); read.mockReturnValue(held.promise);
    await render(); await move(); await advance(2000);
    for (const key of ['check', 'retry']) expect(buttons(root, t(`publishTiming.move.${key}`))[0].props.accessibilityState.disabled).toBe(true);
    await advance(60_000); expect(read).toHaveBeenCalledTimes(1);
    await act(async () => held.resolve({ post: raw() })); expect(read).toHaveBeenCalledTimes(1); pending();
});
test.each(['patch', 'read', 'timer', 'user', 'api'])('scope reset during %s ignores late results and cancels checks', async stage => {
    const held = deferred<unknown>(); patch.mockImplementation(() => stage === 'patch' ? held.promise : Promise.reject(new ApiError(0, 'network')));
    read.mockReturnValue(held.promise); await render(); await move(); if (stage === 'read') await advance(2000);
    const count = announce.mock.calls.length, reads = read.mock.calls.length;
    if (stage === 'api') { mockApi = { request: mockRequest } as unknown as ApiClient; await render(); }
    else if (stage === 'user') await act(async () => { mockUser = 'other'; mockListeners.forEach(fn => fn()); });
    else await act(async () => brandStore.set(OTHER));
    await act(async () => held.resolve(stage === 'patch' ? { scheduled_at: NEW.toISOString() } : { post: raw('A', NEW.toISOString()) }));
    await advance(60_000); expect(read).toHaveBeenCalledTimes(reads); expect(announce).toHaveBeenCalledTimes(count); expect(text()).not.toContain(status('pending'));
    expect(buttons(root, t('publishTiming.move.save'))).toHaveLength(0);
});
test('reload cancels armed row and re-enables scrolling', async () => {
    await render(); await arm(); expect(list().props.scrollEnabled).toBe(false); await refresh(); expect(list().props.scrollEnabled).toBe(true); expect(patch).not.toHaveBeenCalled();
});
test('sheet survives a list reload and uses the live server expectedAt, not its captured row', async () => {
    await render(); await menu(); rows[0] = raw('A', THIRD.toISOString()); await refresh();
    expect(text()).toContain(t('publishTiming.move.now', { time: moveTime(THIRD.toISOString()) }));
    await click('save'); expect(patch).toHaveBeenCalledWith('A', { expectedAt: THIRD.toISOString(), scheduledAt: NEW.toISOString() });
});
test('429 retry keeps the pair; editing afterwards builds a fresh attempt from the server row', async () => {
    patch.mockRejectedValue(new ApiError(429, 'rate')); await render(); await move(); await click('retry');
    expect(patch.mock.calls[1]).toEqual(patch.mock.calls[0]); rows[0] = raw('A', THIRD.toISOString()); await refresh();
    await input(root, t('whenPicker.timehourminute'), '17:45'); await click('save');
    expect(patch.mock.calls[2][1]).toEqual({ expectedAt: THIRD.toISOString(), scheduledAt: new Date(2030, 0, 3, 17, 45).toISOString() });
});
test('closed pending sheet can be recovered from the row Check button', async () => {
    patch.mockRejectedValue(new ApiError(0, 'network')); await render(); await move(); await click('close');
    expect(buttons(root, t('publishTiming.move.check'))).toHaveLength(1); await click('check'); expect(read).toHaveBeenCalledTimes(1);
    expect(text()).toContain(t('publishTiming.move.expected', { time: moveTime(OLD.toISOString()) }));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('whenPicker.dateyearmonthday'))).toHaveLength(0);
});
test('checks continue offscreen and the overlay returns when navigating back', async () => {
    patch.mockRejectedValue(new ApiError(0, 'network')); await render(); await move(); await click('close');
    rows = [raw('B')]; await press(root, t('calendar.next')); expect(row()).toBeUndefined();
    read.mockResolvedValue({ post: raw() }); await advance(2000); expect(read).toHaveBeenCalledTimes(1);
    rows = [raw(), raw('B')]; await press(root, t('calendar.prev')); expect(text()).toContain(status('pending'));
    read.mockImplementation(async () => { rows[0] = raw('A', NEW.toISOString()); return { post: rows[0] }; });
    await advance(4000); expect(announce).toHaveBeenCalledWith(status('done'));
});
test('window resizing cancels an armed gesture', async () => {
    const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 320, height: 700, fontScale: 1, scale: 1 });
    await render(); await arm(); dimensions.mockReturnValue({ width: 700, height: 320, fontScale: 1, scale: 1 }); await render();
    expect(list().props.scrollEnabled).toBe(true); expect(patch).not.toHaveBeenCalled(); dimensions.mockRestore();
});

function DragHarness({ posts }: { posts: CalendarPost[] | null }) {
    const drag = useCalendarDrag(mockPush, 'week', posts, measureDropTargets), post = posts?.find(p => p.id === 'A');
    return <RN.View accessibilityState={{ busy: !!drag.armed }}>
        {post ? <RN.View ref={drag.rowRef(post.id)} {...drag.responderProps(post)}>
            <RN.Pressable accessibilityRole="button" accessibilityLabel="A caption" {...drag.rowProps(post)}><RN.Text>{post.text}</RN.Text></RN.Pressable>
        </RN.View> : null}
    </RN.View>;
}
test('another row patch leaves an armed drag intact; held row removal cancels it', async () => {
    const serverRows = parseCalendar({ posts: rows }).posts;
    await act(async () => root.render(<DragHarness posts={serverRows} />)); await arm();
    await act(async () => root.render(<DragHarness posts={[serverRows[0], { ...serverRows[1], scheduledAt: THIRD.toISOString() }]} />));
    expect(wrapper().props.onMoveShouldSetResponderCapture()).toBe(true);
    await call('onResponderGrant'); await call('onResponderRelease'); expect(mockPush).toHaveBeenCalledWith(serverRows[0], NEW);
    await arm(); await act(async () => root.render(<DragHarness posts={[serverRows[1]]} />));
    expect(root.container.queryAll(n => n.props.accessibilityState?.busy === true)).toHaveLength(0);
});

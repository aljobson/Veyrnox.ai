import {
    SMART_CUT_PROGRESS_ID,
    createSmartCutProgressNotifier,
    smartCutCompleteContent,
    smartCutProgressContent,
    smartCutProgressStageKey,
} from '../src/lib/smartCutProgressNotification';

const flush = async () => { await new Promise<void>((resolve) => setImmediate(resolve)); };

test('Lock Screen progress is generic and never includes asset or transcript data', () => {
    const content = smartCutProgressContent('transcribing', 1, 3);
    expect(content.data).toEqual({ type: 'smart-cut' });
    expect(content.title).toBeTruthy();
    expect(content.body).toContain('2');
    expect(content.body).toContain('3');
    expect(JSON.stringify(content)).not.toMatch(/job[_ -]?id|filename|transcript|Interview/i);
    expect(content.sticky).toBe(true);
    expect(smartCutCompleteContent().sticky).toBe(false);
});

test('one stable silent notification is updated only with existing permission and completion retires progress', async () => {
    const port = {
        getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
        setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
        scheduleNotificationAsync: jest.fn().mockResolvedValue(SMART_CUT_PROGRESS_ID),
        dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
    };
    const notifier = createSmartCutProgressNotifier(true, port as any);
    notifier.update('queued', 0, 2);
    notifier.update('queued', 0, 2);
    notifier.update('transcribing', 0, 2);
    notifier.complete();
    notifier.update('retrying', 0, 2);
    await flush(); await flush();

    expect(port.getPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(port.scheduleNotificationAsync).toHaveBeenCalledTimes(3);
    expect(port.scheduleNotificationAsync.mock.calls.every(([request]) => request.identifier === SMART_CUT_PROGRESS_ID)).toBe(true);
    expect(port.scheduleNotificationAsync.mock.calls[2][0].content.sticky).toBe(false);
});

test('retry progress is distinct from transcribing and unchanged polls do not re-post a banner', async () => {
    expect(smartCutProgressStageKey('retrying')).toBe('editorSpeech.retrying');
    expect(smartCutProgressContent('retrying', 0, 1).body).not.toEqual(smartCutProgressContent('transcribing', 0, 1).body);
    const port = {
        getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
        setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
        scheduleNotificationAsync: jest.fn().mockResolvedValue(SMART_CUT_PROGRESS_ID),
        dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
    };
    const notifier = createSmartCutProgressNotifier(true, port as any);
    notifier.update('transcribing', 0, 2);
    notifier.update('transcribing', 0, 2);
    await flush(); await flush();
    expect(port.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test('disabled or denied notifications never prompt and never schedule', async () => {
    const denied = {
        getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
        setNotificationChannelAsync: jest.fn(),
        scheduleNotificationAsync: jest.fn(),
        dismissNotificationAsync: jest.fn(),
    };
    createSmartCutProgressNotifier(false, denied as any).update('queued', 0, 1);
    await flush();
    expect(denied.getPermissionsAsync).not.toHaveBeenCalled();

    createSmartCutProgressNotifier(true, denied as any).update('queued', 0, 1);
    await flush(); await flush();
    expect(denied.getPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(denied.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('Live Activity updates even when banner permission is denied, and completion closes it', async () => {
    const denied = {
        getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
        setNotificationChannelAsync: jest.fn(), scheduleNotificationAsync: jest.fn(), dismissNotificationAsync: jest.fn(),
    };
    const live = { update: jest.fn().mockResolvedValue(undefined), complete: jest.fn().mockResolvedValue(undefined), dismiss: jest.fn().mockResolvedValue(undefined) };
    const notifier = createSmartCutProgressNotifier(true, denied as any, live);
    notifier.update('transcribing', 0, 2);
    notifier.complete();
    await flush(); await flush();
    expect(live.update).toHaveBeenCalledWith('transcribing', 0, 2);
    expect(live.complete).toHaveBeenCalledTimes(1);
    expect(denied.scheduleNotificationAsync).not.toHaveBeenCalled();
});

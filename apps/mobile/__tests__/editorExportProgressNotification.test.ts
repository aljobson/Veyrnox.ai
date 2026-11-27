import {
    EDITOR_EXPORT_PROGRESS_ID,
    createEditorExportProgressNotifier,
    dismissEditorExportProgressNotification,
    editorExportCompleteContent,
    editorExportProgressContent,
    syncEditorExportProgressNotifier,
} from '../src/lib/editorExportProgressNotification';

const flush = async () => { await new Promise<void>((resolve) => setImmediate(resolve)); };

test('export Lock Screen text is generic and contains no project or file identity', () => {
    const content = editorExportProgressContent('rendering');
    expect(content.data).toEqual({ type: 'editor-export' });
    expect(content.body).toContain('Rendering');
    expect(JSON.stringify(content)).not.toMatch(/project[_ -]?id|filename|transcript|Interview/i);
    expect(content.sticky).toBe(false);
    expect(editorExportCompleteContent().sticky).toBe(false);
});

test('one silent notification advances through export stages and completes', async () => {
    const port = {
        getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
        setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
        scheduleNotificationAsync: jest.fn().mockResolvedValue(EDITOR_EXPORT_PROGRESS_ID),
        dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
    };
    const notifier = createEditorExportProgressNotifier(true, port as never);
    notifier.update('uploading'); notifier.update('uploading'); notifier.update('sending'); notifier.update('rendering'); notifier.complete();
    await flush(); await flush();
    expect(port.getPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(port.scheduleNotificationAsync).toHaveBeenCalledTimes(4);
    expect(port.scheduleNotificationAsync.mock.calls.every(([request]) => request.identifier === EDITOR_EXPORT_PROGRESS_ID)).toBe(true);
    expect(port.scheduleNotificationAsync.mock.calls.at(-1)?.[0].content.sticky).toBe(false);
});

test('disabled or denied export notifications never prompt and never schedule', async () => {
    const denied = {
        getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }), setNotificationChannelAsync: jest.fn(),
        scheduleNotificationAsync: jest.fn(), dismissNotificationAsync: jest.fn(),
    };
    createEditorExportProgressNotifier(false, denied as never).update('rendering'); await flush();
    expect(denied.getPermissionsAsync).not.toHaveBeenCalled();
    createEditorExportProgressNotifier(true, denied as never).update('rendering'); await flush(); await flush();
    expect(denied.getPermissionsAsync).toHaveBeenCalledTimes(1); expect(denied.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('dismiss retires the fixed card without consulting permission', async () => {
    const port = { getPermissionsAsync: jest.fn(), setNotificationChannelAsync: jest.fn(), scheduleNotificationAsync: jest.fn(),
        dismissNotificationAsync: jest.fn().mockResolvedValue(undefined) };
    createEditorExportProgressNotifier(false, port as never).dismiss(); await flush(); await flush();
    expect(port.getPermissionsAsync).not.toHaveBeenCalled();
    expect(port.dismissNotificationAsync).toHaveBeenCalledWith(EDITOR_EXPORT_PROGRESS_ID);
    await dismissEditorExportProgressNotification(port); expect(port.dismissNotificationAsync).toHaveBeenCalledTimes(2);
});

test('server-export phases update, complete and retire exactly one notifier', () => {
    const notifier = { update: jest.fn(), complete: jest.fn(), dismiss: jest.fn() };
    const make = jest.fn(() => notifier);
    let current = syncEditorExportProgressNotifier(null, 'uploading', true, make);
    expect(current).toBe(notifier); expect(notifier.update).toHaveBeenLastCalledWith('uploading');
    current = syncEditorExportProgressNotifier(current, 'sending', true, make);
    current = syncEditorExportProgressNotifier(current, 'rendering', true, make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(notifier.update.mock.calls.map(([stage]) => stage)).toEqual(['uploading', 'sending', 'rendering']);
    expect(syncEditorExportProgressNotifier(current, 'done', true, make)).toBeNull();
    expect(notifier.complete).toHaveBeenCalledTimes(1);
    expect(syncEditorExportProgressNotifier(notifier, 'failed', true, make)).toBeNull();
    expect(notifier.dismiss).toHaveBeenCalledTimes(1);
    expect(syncEditorExportProgressNotifier(notifier, 'rendering', false, make)).toBeNull();
    expect(notifier.dismiss).toHaveBeenCalledTimes(2);
});

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { t } from './i18n';

export const EDITOR_EXPORT_PROGRESS_ID = 'veyrnox-editor-export-progress';
export const EDITOR_EXPORT_PROGRESS_CHANNEL = 'editor-export-progress';
export type EditorExportProgressStage = 'uploading' | 'sending' | 'rendering';

type NotificationsPort = Pick<typeof Notifications,
    'dismissNotificationAsync' | 'getPermissionsAsync' | 'scheduleNotificationAsync' | 'setNotificationChannelAsync'>;

export function editorExportProgressContent(stage: EditorExportProgressStage) {
    return {
        title: t('editorServerExport.title'),
        body: t(`editorServerExport.${stage}` as Parameters<typeof t>[0]),
        data: { type: 'editor-export' },
        sound: false as const,
        priority: Notifications.AndroidNotificationPriority.LOW,
        interruptionLevel: 'passive' as const,
        // This is a best-effort fallback rather than a server-backed Live Activity.
        // Keep it swipeable so a killed app cannot strand an ongoing card forever.
        sticky: false,
        autoDismiss: true,
        threadIdentifier: EDITOR_EXPORT_PROGRESS_ID,
    };
}

export function editorExportCompleteContent() {
    return {
        title: t('editorServerExport.title'),
        body: t('editorServerExport.done'),
        data: { type: 'editor-export' },
        sound: false as const,
        priority: Notifications.AndroidNotificationPriority.LOW,
        interruptionLevel: 'passive' as const,
        sticky: false,
        autoDismiss: true,
        threadIdentifier: EDITOR_EXPORT_PROGRESS_ID,
    };
}

export interface EditorExportProgressNotifier {
    update(stage: EditorExportProgressStage): void;
    complete(): void;
    dismiss(): void;
}

export type EditorExportNotificationPhase = 'idle' | 'preparing' | 'quoted' | EditorExportProgressStage | 'done' | 'failed' | 'error';

export function dismissEditorExportProgressNotification(port: Pick<typeof Notifications, 'dismissNotificationAsync'> = Notifications): Promise<void> {
    return port.dismissNotificationAsync(EDITOR_EXPORT_PROGRESS_ID).catch(() => undefined);
}

export function syncEditorExportProgressNotifier(current: EditorExportProgressNotifier | null,
    phase: EditorExportNotificationPhase, enabled: boolean,
    make: () => EditorExportProgressNotifier = () => createEditorExportProgressNotifier(enabled)): EditorExportProgressNotifier | null {
    if (phase === 'uploading' || phase === 'sending' || phase === 'rendering') {
        if (!enabled) { current?.dismiss(); return null; }
        const next = current ?? make(); next.update(phase); return next;
    }
    if (phase === 'done') current?.complete();
    else if (phase === 'idle' || phase === 'failed' || phase === 'error') current?.dismiss();
    return phase === 'preparing' || phase === 'quoted' ? current : null;
}

/** Uses one privacy-minimal OS card. It reads existing permission and never prompts. */
export function createEditorExportProgressNotifier(enabled: boolean, port: NotificationsPort = Notifications): EditorExportProgressNotifier {
    let ended = false, last: EditorExportProgressStage | null = null;
    let available: Promise<boolean> | null = null, chain = Promise.resolve();
    function allowed(): Promise<boolean> {
        if (!enabled) return Promise.resolve(false);
        available ??= (async () => {
            try {
                const permission = await port.getPermissionsAsync();
                if (!permission.granted) return false;
                if (Platform.OS === 'android') await port.setNotificationChannelAsync(EDITOR_EXPORT_PROGRESS_CHANNEL, {
                    name: t('editorServerExport.title'), importance: Notifications.AndroidImportance.LOW, sound: null,
                    vibrationPattern: null, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
                });
                return true;
            } catch { return false; }
        })();
        return available;
    }
    const enqueue = (task: () => Promise<void>) => { chain = chain.then(task, task).catch(() => undefined); };
    return {
        update(stage) {
            if (ended || last === stage) return; last = stage;
            enqueue(async () => { if (await allowed()) await port.scheduleNotificationAsync({ identifier: EDITOR_EXPORT_PROGRESS_ID,
                content: editorExportProgressContent(stage), trigger: Platform.OS === 'android' ? { channelId: EDITOR_EXPORT_PROGRESS_CHANNEL } : null }); });
        },
        complete() {
            if (ended) return; ended = true;
            enqueue(async () => { if (await allowed()) await port.scheduleNotificationAsync({ identifier: EDITOR_EXPORT_PROGRESS_ID,
                content: editorExportCompleteContent(), trigger: Platform.OS === 'android' ? { channelId: EDITOR_EXPORT_PROGRESS_CHANNEL } : null }); });
        },
        dismiss() {
            if (ended) return; ended = true;
            // Removal never needs notification permission. In particular, this still
            // retires a card after the preference is disabled or permission is revoked.
            enqueue(async () => { await port.dismissNotificationAsync(EDITOR_EXPORT_PROGRESS_ID); });
        },
    };
}

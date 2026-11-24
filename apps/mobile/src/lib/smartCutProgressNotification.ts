import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { t } from './i18n';
import { createSmartCutLiveActivity, type SmartCutLiveActivityPort } from './smartCutLiveActivity';

export const SMART_CUT_PROGRESS_ID = 'veyrnox-smart-cut-progress';
export const SMART_CUT_PROGRESS_CHANNEL = 'smart-cut-progress';

export type SmartCutProgressStage = 'queued' | 'transcribing' | 'retrying' | 'checking';

type NotificationsPort = Pick<typeof Notifications,
    'dismissNotificationAsync' | 'getPermissionsAsync' | 'scheduleNotificationAsync' | 'setNotificationChannelAsync'>;

export const smartCutProgressStageKey = (stage: SmartCutProgressStage) => stage === 'queued'
    ? 'editorSpeech.queued'
    : stage === 'retrying'
        ? 'editorSpeech.retrying'
    : stage === 'checking'
        ? 'editorSpeech.planning'
        : 'editorSpeech.transcribing';

/** Generic on purpose: Lock Screen text never exposes media content or account identity. */
export function smartCutProgressContent(stage: SmartCutProgressStage, done: number, total: number) {
    const current = Math.min(Math.max(1, Math.floor(done) + 1), Math.max(1, Math.floor(total)));
    const count = Math.max(1, Math.floor(total));
    return {
        title: t('app.smartCut.native.analyse.title'),
        body: `${t('app.smartCut.native.analyse.running', { done: current, total: count })} ${t(smartCutProgressStageKey(stage))}`,
        data: { type: 'smart-cut' },
        sound: false as const,
        priority: Notifications.AndroidNotificationPriority.LOW,
        interruptionLevel: 'passive' as const,
        sticky: true,
        autoDismiss: false,
        threadIdentifier: SMART_CUT_PROGRESS_ID,
    };
}

export function smartCutCompleteContent() {
    return {
        title: t('app.smartCut.native.analyse.title'),
        body: t('app.smartCut.native.analyse.done'),
        data: { type: 'smart-cut' },
        sound: false as const,
        priority: Notifications.AndroidNotificationPriority.LOW,
        interruptionLevel: 'passive' as const,
        sticky: false,
        autoDismiss: true,
        threadIdentifier: SMART_CUT_PROGRESS_ID,
    };
}

export interface SmartCutProgressNotifier {
    update(stage: SmartCutProgressStage, done: number, total: number): void;
    complete(): void;
    dismiss(): void;
}

/**
 * Updates one stable OS notification instead of generating a notification per polling tick.
 * Permission is read, never requested. Callers pass the in-app notification preference so an
 * analysis cannot bypass a person's Account setting.
 */
export function createSmartCutProgressNotifier(enabled: boolean, port: NotificationsPort = Notifications,
    liveActivity: SmartCutLiveActivityPort = createSmartCutLiveActivity(enabled)): SmartCutProgressNotifier {
    let ended = false;
    let lastProgress: string | null = null;
    let available: Promise<boolean> | null = null;
    let chain = Promise.resolve();

    function allowed(): Promise<boolean> {
        if (!enabled) return Promise.resolve(false);
        available ??= (async () => {
            try {
                const permission = await port.getPermissionsAsync();
                if (!permission.granted) return false;
                if (Platform.OS === 'android') {
                    await port.setNotificationChannelAsync(SMART_CUT_PROGRESS_CHANNEL, {
                        name: t('app.smartCut.native.analyse.title'),
                        importance: Notifications.AndroidImportance.LOW,
                        sound: null,
                        vibrationPattern: null,
                        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
                    });
                }
                return true;
            } catch { return false; }
        })();
        return available;
    }

    function enqueue(task: () => Promise<void>) {
        chain = chain.then(task, task).catch(() => undefined);
    }

    return {
        update(stage, done, total) {
            if (ended) return;
            const progress = `${stage}:${Math.floor(done)}:${Math.floor(total)}`;
            if (progress === lastProgress) return;
            lastProgress = progress;
            enqueue(() => liveActivity.update(stage, done, total));
            enqueue(async () => {
                if (!(await allowed())) return;
                await port.scheduleNotificationAsync({
                    identifier: SMART_CUT_PROGRESS_ID,
                    content: smartCutProgressContent(stage, done, total),
                    trigger: Platform.OS === 'android' ? { channelId: SMART_CUT_PROGRESS_CHANNEL } : null,
                });
            });
        },
        complete() {
            if (ended) return;
            enqueue(() => liveActivity.complete());
            enqueue(async () => {
                if (!(await allowed())) return;
                await port.scheduleNotificationAsync({
                    identifier: SMART_CUT_PROGRESS_ID,
                    content: smartCutCompleteContent(),
                    trigger: Platform.OS === 'android' ? { channelId: SMART_CUT_PROGRESS_CHANNEL } : null,
                });
            });
            ended = true;
        },
        dismiss() {
            if (ended) return;
            ended = true;
            enqueue(() => liveActivity.dismiss());
            enqueue(async () => {
                if (!(await allowed())) return;
                await port.dismissNotificationAsync(SMART_CUT_PROGRESS_ID);
            });
        },
    };
}

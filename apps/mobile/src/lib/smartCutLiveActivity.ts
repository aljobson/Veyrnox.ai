import { Platform } from 'react-native';
import { t } from './i18n';
import type { SmartCutProgressStage } from './smartCutProgressNotification';
import SmartCutLiveActivity, { type SmartCutLiveActivityProps } from '../components/smart-cut/SmartCutLiveActivity';

type Instance = {
    update(props: SmartCutLiveActivityProps, staleDate?: Date): Promise<void>;
    end(policy?: 'default' | 'immediate', props?: SmartCutLiveActivityProps, contentDate?: Date): Promise<void>;
};
type Factory = { getInstances(): Instance[]; start(props: SmartCutLiveActivityProps, url?: string, staleDate?: Date): Instance };

export interface SmartCutLiveActivityPort {
    update(stage: SmartCutProgressStage, done: number, total: number): Promise<void>;
    complete(): Promise<void>;
    dismiss(): Promise<void>;
}

const stageKey = (stage: SmartCutProgressStage) => stage === 'queued'
    ? 'editorSpeech.queued'
    : stage === 'retrying'
        ? 'editorSpeech.retrying'
        : stage === 'checking'
            ? 'editorSpeech.planning'
            : 'editorSpeech.transcribing';

export function smartCutLiveActivityProps(stage: SmartCutProgressStage, done: number, total: number, complete = false): SmartCutLiveActivityProps {
    const count = Math.max(1, Math.floor(total));
    const current = complete ? count : Math.min(Math.max(1, Math.floor(done) + 1), count);
    return {
        title: t('app.smartCut.native.analyse.title'),
        status: complete ? t('app.smartCut.native.analyse.done') : t(stageKey(stage)),
        current,
        total: count,
        progress: complete ? 1 : Math.min(0.98, Math.max(0.02, (Math.max(0, done) + 0.2) / count)),
        complete,
    };
}

function nativeFactory(): Factory | null {
    if (Platform.OS !== 'ios') return null;
    return SmartCutLiveActivity as Factory;
}

export function createSmartCutLiveActivity(enabled: boolean, factory: Factory | null = nativeFactory()): SmartCutLiveActivityPort {
    let last: SmartCutLiveActivityProps = smartCutLiveActivityProps('queued', 0, 1);
    const instances = () => factory?.getInstances() || [];
    return {
        async update(stage, done, total) {
            if (!enabled || !factory) return;
            last = smartCutLiveActivityProps(stage, done, total);
            const active = instances();
            if (active.length) await Promise.all(active.map(instance => instance.update(last, new Date(Date.now() + 5 * 60_000))));
            else factory.start(last, 'ai.veyrnox.app://smart-cut', new Date(Date.now() + 5 * 60_000));
        },
        async complete() {
            if (!enabled || !factory) return;
            last = smartCutLiveActivityProps('checking', last.total, last.total, true);
            await Promise.all(instances().map(instance => instance.end('default', last, new Date())));
        },
        async dismiss() {
            if (!enabled || !factory) return;
            await Promise.all(instances().map(instance => instance.end('immediate', undefined, new Date())));
        },
    };
}

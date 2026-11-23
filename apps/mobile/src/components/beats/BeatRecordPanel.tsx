import { useEffect, useState, useSyncExternalStore } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Button, Text } from '../ui';
import { t, plural } from '../../lib/i18n';
import type { BeatDoc } from '../../lib/beatNative/doc';
import type { TakeRecording, TakeRecordingView } from '../../lib/beatNative/takeRecording';
import { beatReadOnly, readLatency } from '../../lib/beatNative/takeShared';
import { latencyStorage } from '../../lib/beatNative/latencyStore';
import { BeatCalibrationSheet } from './BeatCalibrationSheet';
export function BeatRecordPanel({ doc, controller, view, playing, externalLocked = false }: { doc: BeatDoc; controller: TakeRecording; view: TakeRecordingView; playing: boolean; externalLocked?: boolean }) {
    const [countIn, setCountIn] = useState(false), [calibrate, setCalibrate] = useState(false);
    const storage = latencyStorage();
    useSyncExternalStore(storage.subscribe, storage.snapshot, storage.snapshot);
    const capture = controller.capture(), latency = readLatency('default', storage), locked = controller.locked();
    useEffect(() => { if (!view.armedId) setCalibrate(false); }, [view.armedId]);
    const readOnly = beatReadOnly(doc);
    return <View>
        {doc.tracks.filter(track => track.kind === 'audio').map(track => <Button key={track.id}
            label={t(view.armedId === track.id ? 'beatTakes.disarm' : 'beatTakes.arm', { track: track.name })}
            accessibilityState={{ selected: view.armedId === track.id }} disabled={Platform.OS === 'android' || locked || externalLocked || readOnly || calibrate}
            onPress={() => void controller.arm(view.armedId === track.id ? null : track.id)} />)}
        {Platform.OS === 'android' ? <Text>{t('beatTakes.android')}</Text> : null}
        {readOnly ? <Text accessibilityRole="alert">{t('beatTakes.readOnly')}</Text> : null}
        {view.error ? <Text accessibilityRole="alert">{view.error}</Text> : null}
        {view.denied ? <Button label={t('beatTakes.settings')} onPress={() => void Linking.openSettings()} /> : null}
        {view.armedId ? <>
            <Text>{t('beatTakes.headphones')}</Text>
            <Text>{latency ? t('beatTakes.latency', { ms: Math.round(latency.ms) }) : t('beatTakes.notCalibrated')}</Text>
            <Button variant="secondary" label={t('beatTakes.countIn')} accessibilityRole="switch" accessibilityState={{ checked: countIn }}
                disabled={locked || externalLocked || calibrate} onPress={() => setCountIn(v => !v)}>
                <Text testID={countIn ? 'beat-count-in-selected' : undefined} variant="bodyStrong">
                    {countIn ? '✓ ' : ''}{t('beatTakes.countIn')}
                </Text>
            </Button>
            <Button label={t('beatTakes.calibrate')} disabled={locked || externalLocked || playing || calibrate} onPress={() => setCalibrate(true)} />
            <Button label={t(locked ? 'beatTakes.stop' : 'beatTakes.record')} disabled={(!locked && externalLocked) || readOnly || calibrate || view.status === 'finishing' || view.status === 'opening'} onPress={() => void (locked ? controller.finish() : controller.record(countIn))} />
        </> : null}
        {locked ? <Text accessibilityLiveRegion="polite">{t(view.status === 'finishing' ? 'beatTakes.finishing' : 'beatTakes.status', { seconds: view.seconds.toFixed(1), pass: view.pass })}</Text> : null}
        {view.status === 'error' || view.recoveryFailed ? <Button label={t('beatTakes.retry')} onPress={() => void controller.retry()} /> : null}
        {view.status === 'error' ? <Button label={t('beatTakes.discard')} onPress={() => void controller.discard()} /> : null}
        {view.recovery.length ? <>
            <Button label={plural('beatTakes.recover', view.recovery.length)} disabled={locked || readOnly} onPress={() => void controller.recover()} />
            <Button label={t('beatTakes.discard')} disabled={locked} onPress={() => void controller.recover(true)} />
        </> : null}
        {calibrate && capture && view.armedId ? <BeatCalibrationSheet capture={capture} onClose={() => setCalibrate(false)} /> : null}
    </View>;
}

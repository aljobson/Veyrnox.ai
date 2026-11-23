import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import type { BeatKeyboardProps } from './BeatKeyboard';
import { createExternalMidiController, type ExternalMidiMessage, type ExternalMidiSnapshot } from '../../lib/beatNative/externalMidi';
import { nativeExternalMidiPort } from '../../lib/beatNative/nativeExternalMidi';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

type Props = Pick<BeatKeyboardProps, 'track' | 'audio' | 'onError' | 'onNoteOn' | 'onNoteOff'> & { disabled?: boolean };

export function BeatExternalMidiCapture(props: Props) {
    const s = useThemedStyles(styles);
    const latest = useRef(props); latest.current = props;
    const controllerRef = useRef<ReturnType<typeof createExternalMidiController> | null>(null);
    const [snapshot, setSnapshot] = useState<ExternalMidiSnapshot>({ permission: 'unknown', devices: [], connectedId: null, error: null });
    const [busyId, setBusyId] = useState<string | null>(null);
    const held = useRef(new Map<string, Pick<ExternalMidiMessage, 'pitch' | 'velocity'>>()), usedAudio = useRef<ReturnType<Props['audio']>>(null);
    const foreground = useRef(AppState.currentState === 'active');
    const releaseAll = useCallback(() => {
        const audio = usedAudio.current, contextTime = audio?.now?.() ?? 0;
        held.current.forEach((note, keyId) => {
            audio?.noteOff(keyId);
            latest.current.onNoteOff?.({ keyId, ...note, contextTime, source: 'external' });
        });
        held.current.clear();
    }, []);
    useEffect(() => { if (props.disabled) releaseAll(); }, [props.disabled, releaseAll]);
    useEffect(() => {
        const listener = AppState.addEventListener('change', state => { foreground.current = state === 'active'; if (!foreground.current) releaseAll(); });
        return () => listener.remove();
    }, [releaseAll]);
    useEffect(() => {
        const receive = (message: ExternalMidiMessage) => {
            const current = latest.current;
            const keyId = `external:${message.channel}:${message.pitch}`;
            if (message.type === 'on' && (current.disabled || !foreground.current)) return;
            if (message.type === 'off' && !held.current.has(keyId)) return;
            const audio = current.audio(), contextTime = audio?.now?.() ?? 0; if (audio) usedAudio.current = audio;
            if (message.type === 'on') {
                if (held.current.has(keyId)) audio?.noteOff(keyId);
                held.current.set(keyId, { pitch: message.pitch, velocity: message.velocity });
                current.onNoteOn?.({ keyId, pitch: message.pitch, velocity: message.velocity, contextTime, source: 'external' });
                if (audio) void audio.noteOn(keyId, current.track, message.pitch, message.velocity).catch(current.onError);
            } else if (held.current.delete(keyId)) {
                audio?.noteOff(keyId);
                current.onNoteOff?.({ keyId, pitch: message.pitch, velocity: message.velocity, contextTime, source: 'external' });
            }
        };
        const activeController = createExternalMidiController(nativeExternalMidiPort(), receive);
        controllerRef.current = activeController;
        let alive = true;
        const publish = () => {
            const next = activeController.snapshot();
            if (!next.connectedId) releaseAll();
            if (alive) setSnapshot({ ...next, devices: [...next.devices] });
        };
        const unsubscribe = activeController.subscribe(publish);
        publish();
        void activeController.requestAccess().then(publish);
        return () => {
            alive = false; unsubscribe(); activeController.dispose(); controllerRef.current = null;
            releaseAll(); usedAudio.current = null;
        };
    }, [releaseAll]);
    const changeConnection = async (deviceId: string, connected: boolean) => {
        const active = controllerRef.current; if (!active || busyId) return;
        setBusyId(deviceId);
        try {
            if (connected) { releaseAll(); await active.disconnect(); }
            else await active.connect(deviceId);
        } finally { setBusyId(null); }
    };
    const connected = snapshot.devices.find(device => device.id === snapshot.connectedId);
    return <View testID="beat-external-midi" style={s.surface} accessible={false}>
        <View style={s.heading}>
            <Text variant="bodyStrong">{t('beat.midi.external.title')}</Text>
            <Text variant="footnote" tone="secondary">
                {connected ? t('beat.midi.external.connected', { name: connected.name }) : t('beat.midi.external.disconnected')}
            </Text>
        </View>
        {snapshot.permission === 'unavailable' ? <Text tone="secondary">{t('beat.midi.external.unavailable')}</Text> : null}
        {snapshot.permission === 'denied' ? <Text tone="danger">{t('beat.midi.external.denied')}</Text> : null}
        {snapshot.permission === 'granted' && snapshot.devices.length === 0 ? <Text tone="secondary">{t('beat.midi.external.none')}</Text> : null}
        {snapshot.devices.map(device => {
            const isConnected = snapshot.connectedId === device.id;
            return <View key={device.id} style={s.device}>
                <View style={s.deviceText}>
                    <Text variant="bodyStrong">{device.name}</Text>
                    {device.manufacturer ? <Text variant="footnote" tone="secondary">{device.manufacturer}</Text> : null}
                </View>
                <Button size="sm" variant={isConnected ? 'secondary' : 'primary'}
                    label={t(isConnected ? 'beat.midi.external.disconnect' : 'beat.midi.external.connect', { name: device.name })}
                    loading={busyId === device.id} disabled={!!busyId || (!isConnected && props.disabled)}
                    onPress={() => void changeConnection(device.id, isConnected)} />
            </View>;
        })}
        {snapshot.error ? <Text variant="footnote" tone="danger">{t('beat.midi.external.error', { error: snapshot.error })}</Text> : null}
    </View>;
}

const styles = themedStyles(p => ({
    surface: { gap: ds.space.sm, borderWidth: 1, borderColor: p.borderStrong, borderRadius: ds.radius.md, padding: ds.space.md },
    heading: { gap: ds.space.xxs },
    device: { minHeight: 52, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.md },
    deviceText: { flex: 1, minWidth: 140, gap: ds.space.xxs },
}));

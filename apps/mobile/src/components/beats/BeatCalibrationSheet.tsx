import { useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { calibrateTake } from '../../lib/beatNative/calibration';
import { latencyStorage } from '../../lib/beatNative/latencyStore';
import type { Capture } from '../../lib/beatNative/takeShared';
export function BeatCalibrationSheet({ capture, onClose }: { capture: Capture; onClose(): void }) {
    const s = useThemedStyles(sheets), abort = useRef(new AbortController());
    const [running, setRunning] = useState(false), [error, setError] = useState(false), [ms, setMs] = useState<number | null>(null);
    useEffect(() => () => abort.current.abort(), []);
    const start = async () => {
        setRunning(true); setError(false);
        try { const result = await calibrateTake(capture, latencyStorage(), abort.current.signal); await latencyStorage().flush(); if (!abort.current.signal.aborted) setMs(result); }
        catch { if (!abort.current.signal.aborted) setError(true); }
        finally { if (!abort.current.signal.aborted) setRunning(false); }
    };
    return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={s.backdrop}><View style={s.sheet} accessibilityViewIsModal>
            <Text accessibilityRole="header">{t('beatTakes.calibrate')}</Text>
            <Text>{t('beatTakes.calibrationHint')}</Text>
            {error ? <Text accessibilityRole="alert">{t('beatTakes.calibrationError')}</Text> : null}
            {ms !== null ? <Text>{t('beatTakes.latency', { ms: Math.round(ms) })}</Text> : null}
            <Button label={t(running ? 'beatTakes.calibrating' : 'beatTakes.startCalibration')} disabled={running} onPress={() => void start()} />
            <Button label={t('beatTakes.close')} onPress={onClose} />
        </View></View>
    </Modal>;
}
const sheets = themedStyles(p => ({ backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: p.bg }, sheet: { padding: 24, gap: 16, backgroundColor: p.bgElevated1 } }));

import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';
import { useServerExport, type ServerExportProps } from './useServerExport';

export function ServerExportSheet(props: ServerExportProps) {
    const state = useServerExport(props);
    const working = ['preparing', 'uploading', 'sending', 'rendering'].includes(state.phase);
    const cancel = () => {
        if (state.phase === 'uploading') { void state.cancel(); return; }
        Alert.alert(t('editorServerExport.cancel'), t('editorServerExport.cancelConfirm', { credits: state.credits }), [
            { text: t('editorServerExport.close'), style: 'cancel' },
            { text: t('editorServerExport.cancel'), style: 'destructive', onPress: () => void state.cancel() },
        ]);
    };
    return <Modal visible={props.visible} animationType="none" transparent onRequestClose={state.close}>
        <View style={styles.backdrop}><ScrollView style={styles.sheet} contentContainerStyle={styles.content}>
            <Text accessibilityRole="header" style={styles.heading}>{t('editorServerExport.title')}</Text>
            {state.message ? <Text accessibilityRole="alert" style={styles.text}>{state.message}</Text> : null}
            {working ? <Text accessibilityLiveRegion="polite" style={styles.text}>{t(`editorServerExport.${state.phase}` as Parameters<typeof t>[0])}</Text> : null}
            {state.phase === 'uploading' ? <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(state.progress * 100) }} style={styles.track}><View style={[styles.fill, { width: `${state.progress * 100}%` }]} /></View> : null}
            {!working && !state.job ? <View>
                {(['1080p', '720p'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={value} accessibilityState={{ selected: state.resolution === value }} onPress={() => state.choose(value)} style={[styles.button, touchTarget]}>
                    <Text style={styles.text}>{state.limits[value] ? t('editorServerExport.resolution', { resolution: value, seconds: state.limits[value]! }) : value}</Text>
                </Pressable>)}
            </View> : null}
            {state.blocked.length ? <View>
                <Text style={styles.text}>{t('editorServerExport.notOnPhone')}</Text>
                {state.blocked.map((item, index) => <Text key={`${item.id}-${index}`} style={styles.text}>{item.name ? `${item.name}: ` : ''}{t(`editorServerExport.${item.reason}` as Parameters<typeof t>[0])}</Text>)}
            </View> : null}
            {state.phase === 'quoted' && state.quote ? <View>
                <Text style={styles.text}>{t('editorServerExport.confirm', { credits: state.quote.credits, resolution: state.resolution })}</Text>
                {state.files.length ? <Text style={styles.text}>{t('editorServerExport.retention', { count: state.files.length, mb: (state.files.reduce((sum, file) => sum + file.size, 0) / 1048576).toFixed(1) })}</Text> : null}
                <Text style={styles.text}>{t('editorServerExport.fidelity')}</Text>
                <Button label={t('editorServerExport.start')} onPress={() => void state.confirm()} />
            </View> : null}
            {state.needsCredits ? <Button label={t('editorServerExport.credits')} onPress={state.buyCredits} /> : null}
            {state.phase === 'error' || state.unavailable ? <Button label={t('editorServerExport.checkAgain')} onPress={() => void state.retry()} /> : null}
            {state.phase === 'uploading' || state.job?.phase === 'rendering' ? <Button label={t('editorServerExport.cancel')} onPress={cancel} /> : null}
            {state.phase === 'failed' ? <Text style={styles.text}>{t(state.job?.refunded ? 'editorServerExport.refunded' : 'editorServerExport.failedNoRefund')}</Text> : null}
            {state.phase === 'done' ? <View>
                <Text accessibilityRole="header" style={styles.heading}>{t('editorServerExport.done')}</Text>
                {state.job?.renderId ? <Button label={t('editorServerExport.share')} onPress={() => void state.share()} /> : null}
                <Button label={t('editorServerExport.library')} onPress={state.library} />
                <Button label={t('editorServerExport.publish')} onPress={state.publish} />
            </View> : null}
            {!working && !state.job ? <Button label={t('editorServerExport.without')} onPress={state.fallback} /> : null}
            <Button label={t('editorServerExport.close')} onPress={state.close} />
        </ScrollView></View>
    </Modal>;
}
function Button({ label, onPress }: { label: string; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.button, touchTarget]}><Text style={styles.text}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
    sheet: { maxHeight: '90%', backgroundColor: colors.background }, content: { padding: 24, gap: 12 },
    heading: { fontSize: 22, fontWeight: '700', color: colors.text }, text: { color: colors.text, fontSize: 16, marginVertical: 6 },
    button: { justifyContent: 'center', paddingHorizontal: 12, marginVertical: 4, borderWidth: 1, borderColor: colors.muted, borderRadius: 8 },
    track: { height: 4, backgroundColor: colors.muted }, fill: { height: 4, backgroundColor: colors.accent },
});

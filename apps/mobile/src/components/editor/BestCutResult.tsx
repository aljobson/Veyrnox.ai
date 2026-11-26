import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Icon, Text } from '../ui';
import type { ApiClient } from '../../lib/api';
import { framesIn, type Timeline } from '../../lib/nativeEditorModel';
import { bestCutWarningKey, type BestCutPlan } from '../../lib/bestCutPlan';
import { t } from '../../lib/i18n';
import { createFrameStore } from './editorFrameStore';
import { PlaybackPreview, PlaybackTransport } from './EditorPlayback';
import { studioColors as colors } from '../../theme';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';
import { modalSafePadding } from '../../lib/modalLayout';
export function BestCutResult({ before, after, plan, api, uris, onOpen, onCreateAnother, captionsOmitted, refunded }: { onOpen(): void; onCreateAnother(instruction?: string): void; before: Timeline; after: Timeline; plan: BestCutPlan | null; api: ApiClient; uris: Record<string, string>; captionsOmitted?: boolean; refunded?: number }) {
    const insets = useOptionalSafeAreaInsets();
    const [open, setOpen] = useState(false), [view, setView] = useState<'before' | 'after'>('after');
    const [playing, setPlaying] = useState(false), [store] = useState(createFrameStore);
    const timeline = view === 'before' ? before : after, total = framesIn(timeline);
    useEffect(() => { if (!playing || !open) return; const timer = setInterval(() => { const next = store.get() + 1; if (next >= total) { setPlaying(false); store.set(0); } else store.set(next); }, 1000 / timeline.fps); return () => clearInterval(timer); }, [playing, open, total, timeline.fps, store]);
    const show = (next: 'before' | 'after' = 'after') => { onOpen(); setView(next); store.set(0); setOpen(true); };
    return <><View accessibilityLiveRegion="polite" style={styles.applied}>
        <View style={styles.appliedIcon}><Icon name="check" size={20} tint={colors.accentInk} /></View>
        <View style={styles.appliedCopy}><Text variant="bodyStrong">AI Edit applied</Text><Text variant="caption" tone="secondary">Review every section or keep editing on the timeline.</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Review AI Edit" onPress={() => show('after')} style={styles.reviewButton}><Text variant="caption" tone="accent">Review</Text></Pressable>
    </View>
    <View style={styles.actions}><Button variant="secondary" label="Create Another AI Edit" onPress={() => onCreateAnother()} /><Button variant="tertiary" label={t('bestCut.before')} onPress={() => show('before')} /></View>
    <View style={{ gap: 8 }}>{plan?.warnings.map(w => <Text key={w}>{t(bestCutWarningKey(w))}</Text>)}
        {captionsOmitted ? <Text>{t('bestCut.captionsOmitted')}</Text> : null}
        {refunded ? <Text>{t('bestCut.refunded', { n: refunded })}</Text> : null}</View>
    <Modal visible={open} onRequestClose={() => { setOpen(false); setPlaying(false); }} animationType="slide">
        <ScrollView contentContainerStyle={[styles.modal, modalSafePadding(insets, 24)]}>
            <View style={styles.modalHeader}><Pressable accessibilityRole="button" accessibilityLabel="Close AI Edit review" onPress={() => { setOpen(false); setPlaying(false); }} style={styles.close}><Icon name="close" size={24} tint={colors.text} /></Pressable><Text variant="title3">AI Edit review</Text><View style={styles.close} /></View>
            <View style={styles.tabs}>{(['before', 'after'] as const).map(v => <Chip key={v} label={t(v === 'before' ? 'bestCut.before' : 'bestCut.afterView')} selected={v === view} onPress={() => { setView(v); setPlaying(false); store.set(0); }} />)}</View>
            <View style={styles.preview}><PlaybackPreview frameStore={store} timeline={timeline} api={api} playing={playing} localMediaUris={uris} /></View>
            <PlaybackTransport frameStore={store} total={total} fps={timeline.fps} playing={playing} onSeek={store.set} onPlaying={setPlaying} />
            {plan ? <View style={styles.summary}><Text variant="bodyStrong">{t('bestCut.changed')}</Text><Text tone="secondary">{t('bestCut.summary', { pauses: plan.removedPauses, retakes: plan.removedRetakes, matched: plan.matchedLines })}</Text><Text variant="caption" tone="secondary">{t('bestCut.dropped', { n: plan.droppedClips })}</Text></View> : null}
            {plan?.ranges.map((range, index) => <Pressable key={`${range.mediaId}-${range.start}`} accessibilityRole="button" accessibilityLabel={`Review section ${index + 1}`} onPress={() => { setView('after'); setPlaying(false); store.set(range.start); }} style={styles.section}>
                <View style={styles.sectionNumber}><Text variant="caption" tone="accent">{index + 1}</Text></View><View style={styles.sectionCopy}><Text variant="bodyStrong">Section {index + 1}</Text><Text numberOfLines={3} tone="secondary">{range.label}</Text><Text variant="caption" tone="secondary">{(range.from / plan.fps).toFixed(2)}–{(range.to / plan.fps).toFixed(2)}</Text></View><Icon name="play" size={20} tint={colors.accent} />
            </Pressable>)}
            {!!plan?.missingLines.length && <Text>{t('bestCut.missing', { lines: plan.missingLines.join(', ') })}</Text>}
            <Text variant="bodyStrong">Try a different cut</Text>
            <View style={styles.redoGrid}>
                <Button variant="secondary" label="Shorter" onPress={() => { setOpen(false); onCreateAnother('Make this cut shorter and keep only the strongest moments.'); }} />
                <Button variant="secondary" label="Longer" onPress={() => { setOpen(false); onCreateAnother('Keep more context and make this cut longer.'); }} />
                <Button variant="secondary" label="More visual" onPress={() => { setOpen(false); onCreateAnother('Prioritise visually strong moments and reactions.'); }} />
                <Button variant="secondary" label="Less expressive" onPress={() => { setOpen(false); onCreateAnother('Use a calmer, less expressive edit.'); }} />
            </View>
            <Button label="Keep this cut" onPress={() => { setOpen(false); setPlaying(false); }} />
        </ScrollView></Modal></>;
}

const styles = StyleSheet.create({
    applied: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft },
    appliedIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.accent },
    appliedCopy: { flex: 1, gap: 2 },
    reviewButton: { minWidth: 62, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    actions: { gap: 8 },
    modal: { gap: 16, backgroundColor: colors.background },
    modalHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    tabs: { flexDirection: 'row', gap: 8 },
    preview: { height: 320, overflow: 'hidden', borderRadius: 22, backgroundColor: '#050506' },
    summary: { gap: 6, padding: 16, borderRadius: 18, backgroundColor: colors.surface },
    section: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    sectionNumber: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.accentSoft },
    sectionCopy: { flex: 1, gap: 4 },
    redoGrid: { gap: 8 },
});

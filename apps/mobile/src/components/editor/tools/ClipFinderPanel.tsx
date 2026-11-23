import { useEffect, useRef, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, View } from 'react-native';
import { formatNumber, plural, t } from '../../../lib/i18n';
import { rawText } from '../../../lib/i18n/translate';
import type { ClipFinderReasonCode, ClipFinderRow } from '../../../lib/editorClipAnalysis';
import { ds } from '../../../theme';
import { themedStyles, useThemedStyles } from '../../ui/AppearanceContext';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';

export type ClipFinderAvailability = 'checking' | 'available' | 'unsupported';
export type ClipFinderStatus = 'idle' | 'preparing' | 'reading-picture' | 'reading-sound' | 'ranking' | 'done' | 'error';
export type ClipFinderPanelRow = ClipFinderRow;
export type ClipFinderPanelProps = {
    availability: ClipFinderAvailability;
    blocker?: string | null;
    status: ClipFinderStatus;
    progress: number;
    fps: number;
    rows: readonly ClipFinderPanelRow[];
    error?: string | null;
    hadAudio?: boolean;
    previewingId?: string | null;
    onFind(): void;
    onCancel(): void;
    onToggle(id: string): void;
    onPreview(id: string): void;
    onApply(): void;
};

const reasonText = (code: ClipFinderReasonCode) => code === 'lively-audio' ? t('editorClips.reason.livelyAudio')
    : code === 'speech-rich' ? t('editorClips.reason.speechRich')
    : code === 'cut-aligned' ? t('editorClips.reason.cutAligned')
    : code === 'continuous-shot' ? t('editorClips.reason.continuousShot')
    : code === 'frequent-cuts' ? t('editorClips.reason.frequentCuts')
    : code === 'good-length' ? t('editorClips.reason.goodLength') : t('editorClips.reason.fallback');
const stageText = (status: ClipFinderStatus) => status === 'reading-picture' ? t('editorClips.readingPicture')
    : status === 'reading-sound' ? t('editorClips.readingSound')
    : status === 'ranking' ? t('editorClips.ranking') : t('editorClips.preparing');

export function ClipFinderPanel({ availability, blocker, status, progress, fps, rows, error, hadAudio = true, previewingId,
    onFind, onCancel, onToggle, onPreview, onApply }: ClipFinderPanelProps) {
    const styles = useThemedStyles(sheets), summary = useRef<ComponentRef<typeof View>>(null);
    const running = status === 'preparing' || status === 'reading-picture' || status === 'reading-sound' || status === 'ranking';
    const done = status === 'done', selected = rows.filter(row => row.ticked).length;
    const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    const stage = stageText(status);
    const progressText = t('editorClips.progress', { stage, value1: percent });
    const statusText = availability === 'checking' ? t('editorClips.checking')
        : availability === 'unsupported' ? t('editorClips.unsupported') : error || blocker || null;
    useEffect(() => {
        if (!done) return;
        const node = findNodeHandle(summary.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, [done]);
    const seconds = (frame: number) => `${formatNumber(frame / fps, 1)}s`;

    return <View style={styles.container}>
        <Text variant="title2">{t('editorClips.title')}</Text>
        <Text tone="secondary">{t('editorClips.help')}</Text>
        <Text>{t('editorClips.outcome')}</Text>
        <View style={styles.localBadge}><Text variant="footnote" tone="accent">{t('editorClips.private')}</Text></View>
        <Text variant="footnote" tone="secondary">{t('editorClips.disclaimer')}</Text>
        {statusText ? <Text accessibilityRole={status === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite"
            tone={status === 'error' ? 'danger' : 'secondary'}>{statusText}</Text> : null}
        {running ? <View style={styles.progressGroup}>
            <Text accessibilityLiveRegion="polite" tone="secondary">{progressText}</Text>
            <View accessibilityRole="progressbar" accessibilityLabel={rawText(progressText)}
                accessibilityValue={{ min: 0, max: 100, now: percent, text: rawText(progressText) }} style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(2, percent)}%` }]} />
            </View>
            <Button size="md" variant="secondary" label={t('editorClips.cancel')} onPress={onCancel} />
        </View> : <Button size="md" label={done ? t('editorClips.again') : t('editorClips.find')}
            disabled={availability !== 'available' || !!blocker} onPress={onFind} />}
        {done ? <View style={styles.results}>
            {!hadAudio ? <Text accessibilityLiveRegion="polite" tone="secondary">{t('editorClips.silent')}</Text> : null}
            <View ref={summary} accessible focusable accessibilityRole="summary"
                accessibilityLabel={rawText(rows.length ? plural('editorClips.summary', rows.length, { selected }) : t('editorClips.empty'))}>
                <Text accessibilityLiveRegion="polite" tone="secondary">
                    {rows.length ? plural('editorClips.summary', rows.length, { selected }) : t('editorClips.empty')}
                </Text>
            </View>
            {rows.map(row => {
                const start = seconds(row.startFrame), end = seconds(row.endFrame), durationValue = (row.endFrame - row.startFrame) / fps;
                const duration = plural('editorClips.duration', durationValue, { duration: formatNumber(durationValue, 1) });
                const rank = row.rank === 1 ? t('editorClips.topPick') : t('editorClips.suggestion', { value1: row.rank });
                const reasons = row.reasons.map(reasonText);
                const label = t('editorClips.rowLabel', { rank, start, end, duration, reasons: reasons.join('. ') });
                const previewing = previewingId === row.id;
                return <View key={row.id} testID={`clip-finder-row-${row.id}`} style={styles.card}>
                    <View style={styles.cardCopy}>
                        <Text variant="bodyStrong">{rank}</Text>
                        <Text style={styles.time}>{t('editorClips.range', { start, end })}</Text>
                        <Text variant="footnote" tone="secondary">{duration}</Text>
                    </View>
                    <Pressable testID={`clip-finder-toggle-${row.id}`} accessibilityRole="checkbox" accessibilityLabel={rawText(label)}
                        accessibilityState={{ checked: row.ticked, disabled: running }} disabled={running} onPress={() => onToggle(row.id)}
                        style={({ pressed }) => [styles.checkboxHit, pressed && styles.pressed]}>
                        <View style={[styles.checkbox, row.ticked && styles.checkboxChecked]}>
                            <Text variant="bodyStrong" tone={row.ticked ? 'onAccent' : 'secondary'}>{row.ticked ? '✓' : ''}</Text>
                        </View>
                        <Text variant="bodyStrong">{t('editorClips.select', { value1: row.rank })}</Text>
                    </Pressable>
                    <View style={styles.reasons}>{reasons.map(reason => <View key={reason} style={styles.reason}>
                        <Text variant="footnote" tone="secondary">{reason}</Text>
                    </View>)}</View>
                    <Button size="md" variant={previewing ? 'secondary' : 'tertiary'} tone="accent"
                        label={t(previewing ? 'editorClips.pause' : 'editorClips.preview', { value1: row.rank })}
                        onPress={() => onPreview(row.id)} />
                </View>;
            })}
            {rows.length ? <View style={styles.applyGroup}>
                {!selected ? <Text accessibilityLiveRegion="polite" tone="secondary">{t('editorClips.choose')}</Text> : null}
                <Button size="lg" label={selected ? plural('editorClips.apply', selected) : t('editorClips.applyNone')}
                    disabled={!selected} onPress={onApply} />
            </View> : null}
        </View> : null}
    </View>;
}

const sheets = themedStyles(p => ({
    container: { gap: ds.space.md, paddingBottom: ds.space.xl },
    localBadge: { alignSelf: 'flex-start', borderWidth: 1, borderColor: p.borderStrong, backgroundColor: p.bgElevated1,
        borderRadius: ds.radius.pill, paddingHorizontal: ds.space.md, paddingVertical: ds.space.xs },
    progressGroup: { gap: ds.space.sm }, progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: p.bgElevated2 },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: p.accent }, results: { gap: ds.space.lg },
    card: { gap: ds.space.sm, padding: ds.space.md, borderWidth: 1, borderColor: p.borderSubtle, borderRadius: ds.radius.lg, backgroundColor: p.bgElevated1 },
    cardCopy: { gap: ds.space.xs, alignItems: 'flex-start' }, time: { fontVariant: ['tabular-nums'] },
    checkboxHit: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    checkbox: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: ds.radius.sm,
        borderWidth: 2, borderColor: p.borderStrong, backgroundColor: p.surface },
    checkboxChecked: { borderColor: p.accent, backgroundColor: p.accent }, reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    reason: { borderWidth: 1, borderColor: p.borderSubtle, borderRadius: ds.radius.pill, paddingHorizontal: ds.space.sm, paddingVertical: ds.space.xs,
        backgroundColor: p.surface }, applyGroup: { gap: ds.space.sm }, pressed: { opacity: 0.65 },
}));

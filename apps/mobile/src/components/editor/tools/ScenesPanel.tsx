import { useEffect, useRef, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, View } from 'react-native';
import { formatNumber, t } from '../../../lib/i18n';
import { rawText } from '../../../lib/i18n/translate';
import type { SceneAvailability, ScenePanelStatus } from './useEditorSceneAnalysis';
import type { SceneRow } from '../../../lib/editorSceneAnalysis';
import { ds } from '../../../theme';
import { themedStyles, useThemedStyles } from '../../ui/AppearanceContext';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';

export type ScenePanelRow = SceneRow;
type Props = {
    availability: SceneAvailability;
    blocker?: string | null;
    status: ScenePanelStatus;
    progress: number;
    rows: readonly ScenePanelRow[];
    error?: string | null;
    onDetect(): void;
    onCancel(): void;
    onToggle(frame: number): void;
    onPreview(frame: number): void;
    onApply(): void;
};

export function ScenesPanel({ availability, blocker, status, progress, rows, error, onDetect, onCancel, onToggle, onPreview, onApply }: Props) {
    const styles = useThemedStyles(sheets), summary = useRef<ComponentRef<typeof View>>(null);
    const running = status === 'preparing' || status === 'analyzing', done = status === 'done';
    const selected = rows.filter(row => row.ticked).length;
    const hard = rows.filter(row => row.kind === 'hard'), possible = rows.filter(row => row.kind === 'possible');
    useEffect(() => {
        if (!done) return;
        const node = findNodeHandle(summary.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, [done]);
    const statusText = availability === 'checking' ? t('editorScenes.checking') : availability === 'unsupported' ? t('editorScenes.unsupported') : blocker || error || null;
    const progressText = status === 'preparing' ? t('editorScenes.preparing') : t('editorScenes.analyzing', { value1: Math.round(progress * 100) });
    const section = (title: string, items: readonly ScenePanelRow[], note?: string) => items.length ? <View style={styles.section}>
        <Text variant="title3">{title}</Text>{note ? <Text tone="secondary">{note}</Text> : null}
        {items.map(row => {
            const time = `${formatNumber(row.frame / 30, 2)}s`;
            const label = t(row.kind === 'hard' ? 'editorScenes.hardMark' : 'editorScenes.possibleMark', { value1: time });
            return <View key={row.frame} style={styles.row}>
                <Pressable testID={`scene-toggle-${row.frame}`} accessibilityRole="checkbox" accessibilityLabel={rawText(label)}
                    accessibilityState={{ checked: row.ticked, disabled: running }} disabled={running} onPress={() => onToggle(row.frame)}
                    style={({ pressed }) => [styles.checkboxHit, pressed && styles.pressed]}>
                    <View style={[styles.checkbox, row.ticked && styles.checkboxChecked]}><Text variant="bodyStrong" tone={row.ticked ? 'onAccent' : 'secondary'}>{row.ticked ? '✓' : row.kind === 'hard' ? '|' : '○'}</Text></View>
                    <Text variant="bodyStrong" style={styles.time}>{time}</Text>
                </Pressable>
                <Button size="md" variant="tertiary" tone="accent" label={t('editorScenes.preview', { value1: time })}
                    accessibilityLabel={t('editorScenes.preview', { value1: time })} onPress={() => onPreview(row.frame)} />
            </View>;
        })}
    </View> : null;
    return <View style={styles.container}>
        <Text variant="title2">{t('editorScenes.title')}</Text>
        <Text tone="secondary">{t('editorScenes.help')}</Text>
        <View style={styles.localBadge}><Text variant="footnote" tone="accent">{t('editorScenes.private')}</Text></View>
        {statusText ? <Text accessibilityRole={status === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite" tone={status === 'error' ? 'danger' : 'secondary'}>{statusText}</Text> : null}
        {running ? <View style={styles.progressGroup}>
            <Text accessibilityLiveRegion="polite" tone="secondary">{progressText}</Text>
            <View accessibilityRole="progressbar" accessibilityLabel={rawText(progressText)} accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(2, Math.round(progress * 100))}%` }]} />
            </View>
            <Button size="md" variant="secondary" label={t('editorScenes.cancel')} onPress={onCancel} />
        </View> : <Button size="md" label={done ? t('editorScenes.again') : t('editorScenes.detect')} disabled={availability !== 'available' || !!blocker} onPress={onDetect} />}
        {done ? <View style={styles.results}>
            <View ref={summary} accessible><Text accessibilityLiveRegion="polite" tone="secondary">
                {rows.length ? t('editorScenes.timelineHint', { value1: rows.length }) : t('editorScenes.empty')}
            </Text></View>
            {section(t('editorScenes.hard'), hard)}
            {section(t('editorScenes.possible'), possible, t('editorScenes.review'))}
            {rows.length ? <Button size="lg" label={selected ? t('editorScenes.apply', { value1: selected }) : t('editorScenes.choose')} disabled={!selected} onPress={onApply} /> : null}
        </View> : null}
    </View>;
}

const sheets = themedStyles(p => ({
    container: { gap: ds.space.md, paddingBottom: ds.space.xl },
    localBadge: { alignSelf: 'flex-start', borderWidth: 1, borderColor: p.borderStrong, backgroundColor: p.bgElevated1, borderRadius: ds.radius.pill, paddingHorizontal: ds.space.md,
        paddingVertical: ds.space.xs },
    progressGroup: { gap: ds.space.sm }, progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: p.bgElevated2 },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: p.accent }, results: { gap: ds.space.lg }, section: { gap: ds.space.sm },
    row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.sm, borderTopWidth: 1, borderColor: p.borderSubtle },
    checkboxHit: { minHeight: 44, flex: 1, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    checkbox: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: ds.radius.sm, borderWidth: 2, borderColor: p.borderStrong, backgroundColor: p.surface },
    checkboxChecked: { borderColor: p.accent, backgroundColor: p.accent }, time: { fontVariant: ['tabular-nums'] }, pressed: { opacity: 0.65 },
}));

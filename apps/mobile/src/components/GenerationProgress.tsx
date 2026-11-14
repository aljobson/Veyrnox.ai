import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from './ui';
import { ds } from '../theme';
import { t } from '../lib/i18n';
import { elapsedSeconds, estimatePercent, expectedDurationMs, jobModelId, noteJobStarted, type ProgressKind } from '../lib/generationProgress';

const TICK_MS = 1000;

export interface GenerationProgressProps {
    jobId: string;
    // The model, when known, sets how long the job usually takes; otherwise the kind does.
    modelId?: string | null;
    kind?: ProgressKind | null;
    // Compact rows (editor, film, chat) show the bar, the figure and the time only.
    compact?: boolean;
    // When the job was submitted, if the caller stored it (ms since epoch).
    startedAt?: number;
}

/** "45 s" or "1 min 18 s", from whole seconds. */
export function formatElapsed(seconds: number): string {
    if (seconds < 60) return t('libraryCreate.elapsed', { seconds: String(seconds) });
    return t('job.elapsedMinutes', { minutes: String(Math.floor(seconds / 60)), seconds: String(seconds % 60) });
}

// One progress bar for every running generation in the app. Providers do not report
// how far along a job is, so the figure is an estimate (lib/generationProgress.ts) that
// stops short of 100 until the job settles; the caller stops rendering this when it does.
export function GenerationProgress({ jobId, modelId, kind, compact = false, startedAt: submittedAt }: GenerationProgressProps) {
    const styles = useThemedStyles(sheets);
    const [startedAt] = useState(() => noteJobStarted(jobId, submittedAt));
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(timer);
    }, []);
    const seconds = elapsedSeconds(startedAt, now);
    const percent = estimatePercent(now - startedAt, expectedDurationMs(modelId ?? jobModelId(jobId), kind));
    const figure = t('job.percent', { percent: String(percent) });
    const elapsed = formatElapsed(seconds);
    return <View style={styles.wrap}>
        {compact ? null : <Text variant="body" style={styles.center}>{t('job.patient')}</Text>}
        <View style={styles.row}>
            <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityLabel={t('job.progressLabel')}
                accessibilityValue={{ min: 0, max: 100, now: percent, text: figure }}>
                <View style={[styles.fill, { width: `${percent}%` }]} />
            </View>
            <Text variant="footnote" style={styles.figure} accessibilityElementsHidden importantForAccessibility="no">{figure}</Text>
        </View>
        <Text variant="footnote" tone="tertiary" style={compact ? undefined : styles.center}>
            {compact ? t('job.elapsedSoFar', { elapsed }) : t('job.waiting', { elapsed })}
        </Text>
    </View>;
}

const sheets = themedStyles(p => ({
    wrap: { width: '100%', gap: ds.space.xs },
    center: { textAlign: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: p.borderStrong },
    fill: { height: '100%', borderRadius: 3, backgroundColor: p.accent },
    figure: { minWidth: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },
}));

import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { dayName, heatGrid, hourText, scoreText } from '../../lib/publishHeatmap';
import { summarizeInsights, type Insights } from '../../lib/publishInsights';
import { formatNumber, t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';

export const CELL = 44, LABEL_MIN = 44;
export function BestTimeHeatmap({ insights }: { insights: Insights }) {
    const styles = useThemedStyles(sheets), grid = heatGrid(insights), top = summarizeInsights(insights).topSlots;
    const [selected, setSelected] = useState<string | null>(null);
    const [heights, setHeights] = useState<number[]>(Array(8).fill(CELL));
    // Either side may wrap at large font sizes. Share each row's measured height.
    const measureRow = (index: number, height: number) => setHeights(previous => {
        if (Math.ceil(height) <= previous[index]) return previous;
        return previous.map((value, i) => i === index ? Math.ceil(height) : value);
    });
    const summary = t('publishTiming.heat.summary', { measured: formatNumber(grid.flat().filter(c => c.measured).length), slots: top.map(c => `${dayName(c.day)} ${hourText(c.hour)}`).join(', ') });
    useAnnouncement(summary, { onMount: true });
    const label = (cell: typeof grid[number][number]) => t(cell.measured ? 'publishTiming.heat.cell' : 'publishTiming.heat.thin', { day: dayName(cell.day), hour: hourText(cell.hour), score: scoreText(cell.score ?? 0), count: formatNumber(cell.posts) });
    const cell = grid.flat().find(c => `${c.day}-${c.hour}` === selected), detail = cell ? label(cell) : '';
    useAnnouncement(detail);
    const tones = [styles.tone0, styles.tone1, styles.tone2, styles.tone3];
    const inks = [styles.ink0, styles.ink1, styles.ink2, styles.ink3];
    return <View style={styles.box}>
        <Text accessibilityRole="header" variant="bodyStrong">{t('publishTiming.heat.title')}</Text>
        <Text>{t('publishTiming.heat.zone', { zone: insights.timezone })}</Text>
        <Text tone="secondary">{t('publishTiming.heat.scroll')}</Text>
        <View style={styles.grid}>
            <View style={styles.labels}>
                <View style={[styles.labelCell, { minHeight: heights[0] }]} />
                {Array.from({ length: 7 }, (_, d) => <View key={d} onLayout={e => measureRow(d + 1, e.nativeEvent.layout.height)} style={[styles.labelCell, { minHeight: heights[d + 1] }]}><Text>{dayName(d + 1)}</Text></View>)}
            </View>
            <ScrollView horizontal style={styles.scroller} contentOffset={{ x: Math.max(0, (top[0]?.hour ?? 0) - 1) * CELL, y: 0 }}>
                <View>
                    <View onLayout={e => measureRow(0, e.nativeEvent.layout.height)} style={[styles.row, { minHeight: heights[0] }]}>{grid.map((_, h) => <View key={h} style={styles.cell}><Text style={styles.value}>{hourText(h)}</Text></View>)}</View>
                    {Array.from({ length: 7 }, (_, d) => <View key={d} onLayout={e => measureRow(d + 1, e.nativeEvent.layout.height)} style={[styles.row, { minHeight: heights[d + 1] }]}>
                        {grid.map(row => {
                            const c = row[d], key = `${c.day}-${c.hour}`, on = key === selected;
                            return <Pressable key={key} accessibilityRole="button" accessibilityLabel={label(c)} accessibilityState={{ selected: on }} onPress={() => setSelected(on ? null : key)} style={[styles.cell, c.level === null ? styles.thin : tones[c.level], on && styles.selected]}>
                                <Text style={[styles.value, c.level === null ? undefined : inks[c.level]]}>{c.measured ? scoreText(c.score!) : '—'}</Text>
                            </Pressable>;
                        })}
                    </View>)}
                </View>
            </ScrollView>
        </View>
        <View style={styles.legend}><Text>{t('publishTiming.heat.lower')}</Text>{tones.map((tone, i) => <View key={i} style={[styles.swatch, tone]} />)}<Text>{t('publishTiming.heat.higher')}</Text></View>
        <Text tone="secondary">{t('publishTiming.heat.insufficient')}</Text>
        {detail ? <Text>{detail}</Text> : null}
    </View>;
}
// Blend opaque tints so contrast is predictable on both themes and all accent choices.
function tint(accent: string, surface: string, amount: number) {
    return '#' + [1, 3, 5].map(i => Math.round(parseInt(accent.slice(i, i + 2), 16) * amount + parseInt(surface.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')).join('');
}
function ink(background: string) {
    const c = [1, 3, 5].map(i => parseInt(background.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722 > 0.179 ? '#000000' : '#ffffff';
}
const sheets = themedStyles(p => {
    const tones = [0.15, 0.4, 0.7, 1].map(amount => tint(p.accent, p.surface, amount));
    return {
    box: { gap: 8 }, grid: { flexDirection: 'row' }, scroller: { flex: 1 },
    labels: { minWidth: LABEL_MIN, maxWidth: 96, flexShrink: 1 },
    labelCell: { minHeight: CELL, justifyContent: 'center', paddingRight: 4 },
    row: { flexDirection: 'row' }, cell: { width: CELL, minHeight: CELL, justifyContent: 'center', alignItems: 'center', paddingVertical: 6 },
    value: { maxWidth: '100%', textAlign: 'center' },
    thin: { backgroundColor: p.surface }, selected: { borderWidth: 2, borderColor: p.textPrimary },
    tone0: { backgroundColor: tones[0] }, tone1: { backgroundColor: tones[1] },
    tone2: { backgroundColor: tones[2] }, tone3: { backgroundColor: tones[3] },
    ink0: { color: ink(tones[0]) }, ink1: { color: ink(tones[1]) }, ink2: { color: ink(tones[2]) }, ink3: { color: ink(tones[3]) },
    legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }, swatch: { width: 20, height: 20 },
    };
});

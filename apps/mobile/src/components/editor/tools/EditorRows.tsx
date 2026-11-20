import { Pressable, Text, View } from 'react-native';
import { rawText, t, formatNumber } from '../../../lib/i18n';
import { formatTimecode as timecode } from '../../../lib/editorTimeline';
import type { Media, Clip, TextClip, Timeline, TrackKind } from '../../../lib/nativeEditorModel';
import { styles } from '../fullEditorStyles';
export const seconds = (frames = 0, fps = 30) => `${formatNumber(Math.max(0, frames / fps), 1)}s`;
export function ProjectMediaRow({ item, fps, onAdd }: { item: Media; fps: number; onAdd(item: Media): void }) {
    const name = item.name || t('editor.untitledMedia');
    const label = t('editor.addtotimeline', { value1: name });
    const source = item.assetSource ? t('editor.project') : item.id.startsWith('j-') ? t('editor.library') : item.id.startsWith('l-') ? t('editor.thisdevice') : t('editor.project');
    return <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)} onPress={() => onAdd(item)} style={({ pressed }) => [styles.mediaRow, pressed && styles.pressed]}><View
        style={styles.mediaThumb}><Text style={styles.mediaThumbText}>{item.kind === 'audio' ? '♫' : item.kind === 'image' ? '▧' : '▶'}</Text></View><View style={styles.rowCopy}><Text
        style={styles.rowTitle} numberOfLines={1}>{name}</Text><Text style={styles.muted}>{source} · {item.kind || t('editor.media')} · {seconds(item.frames, fps)}</Text></View><View
        style={[styles.action, styles.compactControl]}><Text style={styles.actionText}>{t('editor.add')}</Text></View></Pressable>;
}
export function InspectorClip({ track, item, timeline, selected, onPress }: { track: TrackKind; item: Clip; timeline: Timeline; selected: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={rawText(timeline.media[item.mediaId || '']?.name || item.id)} accessibilityState={{ selected }} onPress={onPress}
        style={[styles.mediaRow, selected && styles.mediaRowSelected]}><View style={styles.mediaThumb}><Text style={styles.mediaThumbText}>♫</Text></View><View style={styles.rowCopy}><Text
        style={styles.rowTitle}>{timeline.media[item.mediaId || '']?.name || t('editor.clip', { value1: t(`editor.track.${track}`) })}</Text><Text style={styles.muted}>{seconds(item.len,
        timeline.fps)}</Text></View></Pressable>;
}
export function TranscriptRow({ item, fps, selected, onPress }: { item: TextClip; fps: number; selected: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={rawText(`${timecode(item.start, fps)} ${item.text}`)} accessibilityState={{ selected }} onPress={onPress} style={({ pressed
        }) => [styles.transcriptRow, selected && styles.mediaRowSelected, pressed && styles.pressed]}><Text style={styles.transcriptTime}>{timecode(item.start, fps)}</Text><Text
        style={styles.transcriptText} numberOfLines={2}>{item.text}</Text></Pressable>;
}

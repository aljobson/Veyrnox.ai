import { View } from 'react-native';
import { useThemedStyles } from '../ui';
import { previewBars } from '../../lib/beatNative/rollGeometry';
import type { MidiClip } from '../../lib/beatNative/midi';
import { pianoStyles } from './pianoStyles';
export function MidiClipPreview({ clip }: { clip: MidiClip }) {
    const s = useThemedStyles(pianoStyles);
    return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 256, height: 30, overflow: 'hidden' }}>
        {previewBars(clip, 256, 30).map((rect, i) => <View key={i} style={[s.preview, { position: 'absolute', ...rect }]} />)}
    </View>;
}

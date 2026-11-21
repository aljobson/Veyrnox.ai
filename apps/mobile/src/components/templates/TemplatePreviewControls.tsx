import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { rawText } from '../../lib/i18n/translate';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Icon, themedStyles, useThemedStyles } from '../ui';

// The round play control on a template tile. It sits beside the tile's open target, never inside it, so a screen reader
// reaches both and a tap on play does not open the template.
export function TemplatePlayButton({ title, playing, style, onPress }: { readonly title: string; readonly playing: boolean; readonly style?: StyleProp<ViewStyle>; onPress(): void }) {
    const styles = useThemedStyles(sheets);
    return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={rawText(`${t(playing ? 'music.pause' : 'music.play')}, ${title}`)} accessibilityState={{ selected: playing }} hitSlop={6} style={({ pressed }) => [styles.button, style, pressed && styles.pressed]}>
        <Icon name={playing ? 'pauseCircle' : 'play'} size={16} />
    </Pressable>;
}

// Loaded on first play so a screen that only lists templates never creates a video player (see TemplateVideoPreview).
export function TemplateVideoLayer(props: { readonly url: string; onFail(): void }) {
    const { TemplateVideoPreview } = require('./TemplateVideoPreview') as typeof import('./TemplateVideoPreview');
    return <TemplateVideoPreview {...props} />;
}

const sheets = themedStyles((p) => ({
    button: { position: 'absolute', top: ds.space.sm, end: ds.space.sm, width: 32, height: 32, borderRadius: ds.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bgElevated1 },
    pressed: { backgroundColor: p.surfacePressed },
}));

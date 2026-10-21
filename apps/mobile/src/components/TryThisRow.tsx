import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { needsPhoto } from '../lib/explore';
import { t } from '../lib/i18n';
import { presetPrice, type Preset } from '../lib/presets';
import { colors } from '../theme';

type Props = {
    // Null while the templates load: three empty tiles hold the space so the page does not jump when they arrive.
    presets: readonly Preset[] | null;
    onOpen: (p: Preset) => void;
};

// The top of the home: a few finished-looking results to start from in one tap, ahead of the blank prompt box.
export function TryThisRow({ presets, onOpen }: Props) {
    return (
        <View style={styles.wrap}>
            <Text style={styles.heading} accessibilityRole="header">{t('explore.tryThis')}</Text>
            <View style={styles.row}>
                {presets === null
                    ? [0, 1, 2].map((i) => <View key={i} style={[styles.card, styles.empty]} />)
                    : presets.map((p) => (
                          <Pressable
                              key={p.id}
                              accessibilityRole="button"
                              accessibilityLabel={`${p.title}, ${presetPrice(p)}`}
                              accessibilityHint={t(needsPhoto(p) ? 'explore.tryPhoto' : 'explore.tryIt')}
                              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                              onPress={() => onOpen(p)}
                          >
                              {p.posterUrl ? <Image source={{ uri: p.posterUrl }} style={styles.poster} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
                              <View style={styles.caption}>
                                  <Text style={styles.cardName} numberOfLines={2}>{p.title}</Text>
                                  <Text style={styles.go}>{t(needsPhoto(p) ? 'explore.tryPhoto' : 'explore.tryIt')} ›</Text>
                              </View>
                          </Pressable>
                      ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { gap: 10 },
    heading: { color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
    row: { flexDirection: 'row', gap: 10 },
    card: { flex: 1, aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    empty: { opacity: 0.5 },
    // A press shrinks the card a little, so a tap answers at once.
    pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
    poster: { ...StyleSheet.absoluteFill },
    caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 8, gap: 2, backgroundColor: 'rgba(0,0,0,0.62)' },
    cardName: { color: '#fff', fontSize: 13, fontWeight: '600' },
    go: { color: colors.accent, fontSize: 12, fontWeight: '700' },
});

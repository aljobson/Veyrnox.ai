import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import type { CatalogModel } from '../lib/media';
import { LOOK_IDS, lookMatrix, type LookId } from '../lib/instantLooks';
import { faceIcon } from '../lib/featureIcons';
import { t } from '../lib/i18n';
import { colors } from '../theme';
import { IconBadge } from './ui';
import { InstantPhoto } from './InstantPhoto';

export interface LookStripProps {
    thumb: string | null;           // small copy of the photo; null shows plain tiles
    enabled: boolean;               // a photo is attached and the live preview exists
    live: boolean;                  // true when the GPU preview is available
    look: LookId | null;            // selected on-device look, if any
    modelId: string | null;         // selected AI filter, if any
    models: readonly CatalogModel[];
    busy: boolean;
    onLook: (id: LookId) => void;
    onModel: (model: CatalogModel) => void;
}

const TILE = 68;

// Every category in one swipeable row: instant looks first, then the AI face filters.
export function LookStrip({ thumb, enabled, live, look, modelId, models, busy, onLook, onModel }: LookStripProps) {
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
            {LOOK_IDS.map(id => {
                const selected = look === id && !modelId;
                const name = t(`faceFilters.look.${id}`);
                return (
                    <Pressable key={id} accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected, disabled: !enabled || busy }} disabled={!enabled || busy} onPress={() => onLook(id)} style={styles.item}>
                        <View style={[styles.tile, !enabled && styles.empty, selected && styles.selected]}>
                            {thumb && live ? <InstantPhoto uri={thumb} matrix={lookMatrix({ id, strength: 1 })} label={name} cover style={StyleSheet.absoluteFill} /> : null}
                        </View>
                        <Text numberOfLines={1} style={[styles.name, selected && styles.nameOn]}>{name}</Text>
                    </Pressable>
                );
            })}
            {models.length ? <View style={styles.divider} /> : null}
            {models.map(m => {
                const selected = modelId === m.id;
                return (
                    <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.name}. ${t(`faceFilters.${m.id}`)}. ${t('faceFilters.price', { credits: String(m.credits) })}`} accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => onModel(m)} style={styles.item}>
                        <View style={[styles.tile, styles.ai, selected && styles.selected]}>
                            <IconBadge {...faceIcon(m.id)} size="lg" />
                            <View style={styles.badge}><Text style={styles.badgeText}>{t('faceFilters.aiBadge')}</Text></View>
                        </View>
                        <Text numberOfLines={2} style={[styles.name, styles.nameAi, selected && styles.nameOn]}>{m.name}</Text>
                        <Text style={styles.price}>{m.credits}</Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}
const styles = StyleSheet.create({
    row: { gap: 12, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'flex-start' },
    item: { width: TILE + 8, alignItems: 'center', gap: 4, minHeight: 44 },
    tile: { width: TILE, height: TILE, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    empty: { opacity: 0.45 },
    ai: { borderColor: colors.border },
    selected: { borderColor: colors.accent },
    name: { color: colors.muted, fontSize: 12, fontWeight: '600' },
    nameAi: { textAlign: 'center', minHeight: 30 },
    nameOn: { color: colors.text },
    price: { color: colors.money, fontSize: 11, fontWeight: '600' },
    divider: { width: 1, alignSelf: 'stretch', marginVertical: 6, backgroundColor: colors.border },
    badge: { position: 'absolute', top: 4, right: 4, paddingHorizontal: 5, borderRadius: 8, backgroundColor: colors.accent },
    badgeText: { color: colors.accentInk, fontSize: 9, fontWeight: '800' },
});

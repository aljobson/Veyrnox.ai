import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CatalogList, kindTitleKey } from '../../components/CatalogList';
import { priceLines } from '../../lib/catalogPages';
import { t } from '../../lib/i18n';
import { VEY_CLEARANCE } from '../../components/VeyMascot';
import { colors, radius, space, type } from '../../theme';
import { MIN_TARGET } from '../../lib/a11y';

// What each model costs, in credits, from the public catalogue (read-only). It shows prices only: credits are
// bought in the store, and nothing on this screen links anywhere to buy them.
export default function Pricing() {
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('prc.title') }} />
            <Text style={styles.note}>{t('prc.intro')}</Text>
            <CatalogList
                render={(g) => (
                    <>
                        <Text style={styles.heading} accessibilityRole="header">{t(kindTitleKey(g.kind))}</Text>
                        {g.models.map((m) => (
                            <View key={m.id} style={styles.row} accessible accessibilityLabel={`${m.name}: ${priceLines(m).map((p) => (p.seconds ? t('prc.perClip', { seconds: p.seconds, credits: p.credits }) : t('prc.each', { credits: p.credits }))).join(', ')}`}>
                                <Text style={styles.name}>{m.name}</Text>
                                <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                                    {priceLines(m).map((p) => (
                                        <Text key={p.seconds ?? 'one'} style={styles.price}>
                                            {p.seconds ? t('prc.perClip', { seconds: p.seconds, credits: p.credits }) : t('prc.each', { credits: p.credits })}
                                        </Text>
                                    ))}
                                </View>
                            </View>
                        ))}
                    </>
                )}
            />
            <Text style={styles.note}>{t('prc.refund')}</Text>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: space.lg, paddingBottom: space.lg + VEY_CLEARANCE, gap: 20 },
    heading: { color: colors.muted, ...type.footnote, textTransform: 'uppercase' },
    row: { minHeight: MIN_TARGET, flexDirection: 'row', justifyContent: 'space-between', gap: space.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 14 },
    name: { color: colors.text, ...type.body, flexShrink: 1 },
    price: { color: colors.text, ...type.footnote },
    note: { color: colors.muted, ...type.small },
});

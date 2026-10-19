import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CatalogList, kindTitleKey } from '../../components/CatalogList';
import { priceLines } from '../../lib/catalogPages';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

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
    content: { padding: 16, gap: 20 },
    heading: { color: colors.muted, fontSize: 14, textTransform: 'uppercase' },
    row: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    name: { color: colors.text, fontSize: 16, flexShrink: 1 },
    price: { color: colors.text, fontSize: 14 },
    note: { color: colors.muted, fontSize: 13 },
});

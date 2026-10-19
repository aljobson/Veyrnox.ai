import { Link, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { CatalogList, kindTitleKey } from '../../components/CatalogList';
import { needs, priceLines } from '../../lib/catalogPages';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// Every model the app can use, from the public catalogue (read-only). A row opens Create on that model, where the
// price is shown again before anything is bought.
export default function Models() {
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('mdl.title') }} />
            <Text style={styles.note}>{t('mdl.intro')}</Text>
            <CatalogList
                render={(g) => (
                    <>
                        <Text style={styles.heading} accessibilityRole="header">{t(kindTitleKey(g.kind))}</Text>
                        {g.models.map((m) => {
                            const from = priceLines(m)[0].credits;
                            const extra = needs(m);
                            return (
                                <Link key={m.id} href={`/create/${encodeURIComponent(m.id)}`} asChild>
                                    <Pressable accessibilityRole="button" accessibilityLabel={t('mdl.rowLabel', { name: m.name, credits: from })} style={styles.row}>
                                        <Text style={styles.name}>{m.name}</Text>
                                        <Text style={styles.note}>
                                            {t('mdl.from', { credits: from })}
                                            {extra.length ? ` · ${t('mdl.needs', { items: extra.join(', ') })}` : ''}
                                        </Text>
                                    </Pressable>
                                </Link>
                            );
                        })}
                    </>
                )}
            />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 20 },
    heading: { color: colors.muted, fontSize: 14, textTransform: 'uppercase' },
    row: { minHeight: 44, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    note: { color: colors.muted, fontSize: 13 },
});

import { Link, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { VEY_CLEARANCE } from '../../components/VeyMascot';
import { t } from '../../lib/i18n';
import { fetchCatalog } from '../../lib/media';
import { modelEntries, screenEntries, searchEntries, type SearchEntry } from '../../lib/siteSearch';
import { colors } from '../../theme';

// Search the app's own screens and the model catalogue. Nothing leaves the phone except the catalogue fetch the
// app already makes; if that fails, screens are still searchable.
export default function Search() {
    const [query, setQuery] = useState('');
    const [models, setModels] = useState<SearchEntry[]>([]);
    useEffect(() => {
        let live = true;
        fetchCatalog().then((m) => live && setModels(modelEntries(m)), () => undefined);
        return () => {
            live = false;
        };
    }, []);
    const entries = useMemo(() => [...screenEntries((k) => t(k as Parameters<typeof t>[0])), ...models], [models]);
    const results = useMemo(() => searchEntries(query, entries), [query, entries]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('srch.title') }} />
            <TextInput
                accessibilityLabel={t('srch.label')}
                placeholder={t('srch.placeholder')}
                placeholderTextColor={colors.muted}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
                maxLength={80}
                style={styles.input}
                value={query}
                onChangeText={setQuery}
            />
            {query.trim() && results.length === 0 ? <Text style={styles.note} accessibilityLiveRegion="polite">{t('srch.none', { query: query.trim() })}</Text> : null}
            <FlatList
                data={results}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(e) => e.id}
                contentContainerStyle={{ gap: 8, paddingBottom: VEY_CLEARANCE }}
                renderItem={({ item }) => (
                    <Link href={item.href as never} asChild>
                        <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${t(item.kind === 'model' ? 'srch.kindModel' : 'srch.kindScreen')}`} style={styles.row}>
                            <Text style={styles.name}>{item.title}</Text>
                            <Text style={styles.note}>{item.kind === 'model' ? `${t('srch.kindModel')} · ${item.detail}` : t('srch.kindScreen')}</Text>
                        </Pressable>
                    </Link>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    input: { minHeight: 44, color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
    row: { minHeight: 44, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    note: { color: colors.muted, fontSize: 13 },
});

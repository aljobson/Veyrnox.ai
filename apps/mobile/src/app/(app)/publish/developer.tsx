import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DeveloperKeys } from '../../../components/developer/DeveloperKeys';
import { DeveloperLogs } from '../../../components/developer/DeveloperLogs';
import { DeveloperWebhooks } from '../../../components/developer/DeveloperWebhooks';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { styles as shared } from '../../../components/account/shared';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';

type Tab = 'keys' | 'hooks' | 'logs';

// Publish developer tools for the chosen brand: API keys, webhooks and the request log. For owners and managers;
// anyone else, and any account without the plan or the feature, gets the server's answer in plain words.
export default function Developer() {
    const [tab, setTab] = useState<Tab>('keys');
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('dev.title') }} />
            <Text style={shared.help}>{t('dev.intro')}</Text>
            <View style={styles.tabs} accessibilityRole="tablist">
                {(['keys', 'hooks', 'logs'] as const).map((k) => (
                    <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabOn]}>
                        <Text style={{ color: colors.text }}>{t(`dev.tab.${k}`)}</Text>
                    </Pressable>
                ))}
            </View>
            {tab === 'keys' ? <DeveloperKeys /> : tab === 'hooks' ? <DeveloperWebhooks /> : <DeveloperLogs />}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 16, paddingBottom: 16 + VEY_CLEARANCE },
    tabs: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    tabOn: { borderColor: colors.accent },
});

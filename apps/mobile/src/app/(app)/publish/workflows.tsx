import * as WebBrowser from 'expo-web-browser';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { API_BASE, type ApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import {
    fetchWorkflows, fetchWorkflowPlan, planManagementKey, planPeriodKey, workflowErrorKey,
    type Workflow, type WorkflowPlan,
} from '../../../lib/publishWorkflows';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

type ReadState<T> = { api: ApiClient; value: T | null; message: string | null };
const displayDate = (value: string | null): string => value ? new Date(value).toLocaleDateString() : t('publishWorkflows.unknown');
const displayNumber = (value: number | null): string => value === null ? t('publishWorkflows.unknown') : value.toLocaleString();

export default function Workflows() {
    const api = usePublishApi();
    const [workflows, setWorkflows] = useState<ReadState<Workflow[]> | null>(null);
    const [plan, setPlan] = useState<ReadState<WorkflowPlan> | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [webError, setWebError] = useState(false);
    const [reload, setReload] = useState(0);

    useFocusEffect(useCallback(() => {
        // Drop old-brand results on focus/refresh, and ignore requests completed after blur or a brand change.
        let active = true;
        setWorkflows(null);
        setPlan(null);
        setExpanded(null);
        setWebError(false);
        void fetchWorkflows(api).then(
            (value) => { if (active) setWorkflows({ api, value, message: null }); },
            (error) => { if (active) setWorkflows({ api, value: null, message: workflowErrorKey(error) }); },
        );
        // Independent reads: a closed inbox must not hide a person's plan status.
        void fetchWorkflowPlan(api).then(
            (value) => { if (active) setPlan({ api, value, message: value ? null : 'publishWorkflows.unavailable' }); },
            (error) => { if (active) setPlan({ api, value: null, message: workflowErrorKey(error) }); },
        );
        return () => { active = false; };
    }, [api, reload]));

    const currentWorkflows = workflows?.api === api ? workflows : null;
    const currentPlan = plan?.api === api ? plan : null;

    async function continueOnWeb() {
        setWebError(false);
        try { await WebBrowser.openBrowserAsync(`${API_BASE}/app/publish/workflows`); }
        catch { setWebError(true); }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('publishWorkflows.title') }} />
            <FlatList
                data={currentWorkflows?.value ?? []}
                keyExtractor={(item) => item.id}
                extraData={expanded}
                contentContainerStyle={styles.content}
                ListHeaderComponent={
                    <View style={styles.section}>
                        <Text accessibilityRole="header" style={styles.heading}>{t('publishWorkflows.title')}</Text>
                        <Text style={styles.muted}>{t('publishWorkflows.intro')}</Text>
                        <Pressable accessibilityRole="button" style={[styles.action, touchTarget]} onPress={() => setReload((n) => n + 1)}>
                            <Text style={styles.link}>{t('publishWorkflows.refresh')}</Text>
                        </Pressable>
                        <PlanCard state={currentPlan} />
                    </View>
                }
                ListEmptyComponent={
                    <Text style={styles.muted} accessibilityLiveRegion="polite">
                        {t(currentWorkflows?.message ?? (currentWorkflows ? 'publishWorkflows.empty' : 'publishWorkflows.loading'))}
                    </Text>
                }
                ListFooterComponent={currentWorkflows?.value ? (
                    <View style={styles.section}>
                        <Text style={styles.muted}>{t('publishWorkflows.webOnly')}</Text>
                        <Pressable accessibilityRole="link" style={[styles.action, touchTarget]} onPress={() => void continueOnWeb()}>
                            <Text style={styles.link}>{t('publishWorkflows.continueWeb')}</Text>
                        </Pressable>
                        {webError ? <Text style={styles.muted} accessibilityLiveRegion="polite">{t('publishWorkflows.webFailed')}</Text> : null}
                    </View>
                ) : undefined}
                renderItem={({ item }) => (
                    <View style={styles.card}>
                        <Text accessibilityRole="header" style={styles.name}>{item.name || t('publishWorkflows.unnamed')}</Text>
                        <Text style={styles.body}>{t('publishWorkflows.status', {
                            state: t(item.enabled === null ? 'publishWorkflows.unknown' : item.enabled ? 'publishWorkflows.on' : 'publishWorkflows.off'),
                        })}</Text>
                        <Text style={styles.body}>{t('publishWorkflows.trigger', {
                            kind: t(`publishWorkflows.kind.${item.kind}`), match: t(`publishWorkflows.match.${item.matchMode}`),
                            keyword: item.keyword || t('publishWorkflows.unknown'),
                        })}</Text>
                        <Text style={styles.muted}>{t('publishWorkflows.suggestions', { count: displayNumber(item.suggestionCount) })}</Text>
                        <Text style={styles.muted}>{t('publishWorkflows.lastEdited', { date: displayDate(item.updatedAt) })}</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('publishWorkflows.detailsLabel', { name: item.name || t('publishWorkflows.unnamed') })}
                            accessibilityState={{ expanded: expanded === item.id }}
                            style={[styles.action, touchTarget]}
                            onPress={() => setExpanded(expanded === item.id ? null : item.id)}
                        >
                            <Text style={styles.link}>{t(expanded === item.id ? 'publishWorkflows.hideDetails' : 'publishWorkflows.details')}</Text>
                        </Pressable>
                        {expanded === item.id ? (
                            <View style={styles.section}>
                                <Text style={styles.body}>{item.allAccounts ? t('publishWorkflows.allAccounts') : t('publishWorkflows.accounts', {
                                    account: [item.network, item.accountName].filter(Boolean).join(' · ') || t('publishWorkflows.unknown'),
                                })}</Text>
                                <Text accessibilityRole="header" style={styles.name}>{t('publishWorkflows.reply')}</Text>
                                <Text style={styles.body}>{item.replyText || t('publishWorkflows.unknown')}</Text>
                            </View>
                        ) : null}
                    </View>
                )}
            />
        </View>
    );
}

function PlanCard({ state }: { state: ReadState<WorkflowPlan> | null }) {
    const plan = state?.value;
    const managementKey = plan ? planManagementKey(plan.source) : null;
    return (
        <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>{t('publishWorkflows.planTitle')}</Text>
            {!plan ? <Text style={styles.muted}>{t(state?.message ?? 'publishWorkflows.loading')}</Text> : (
                <>
                    <Text style={styles.body}>{t('publishWorkflows.currentPlan', { plan: t(`publishWorkflows.tier.${plan.tier}`) })}</Text>
                    {plan.tier === 'publish' && plan.periodEnd ? <Text style={styles.body}>{t(planPeriodKey(plan), { date: displayDate(plan.periodEnd) })}</Text> : null}
                    <Text style={styles.body}>{t('publishWorkflows.accountLimit', { count: displayNumber(plan.accountLimit) })}</Text>
                    <Text style={styles.body}>{t('publishWorkflows.analyticsDays', { count: displayNumber(plan.analyticsDays) })}</Text>
                    <Text style={styles.body}>{t('publishWorkflows.bestTime', {
                        state: t(plan.bestTimeEnabled === null ? 'publishWorkflows.unknown' : plan.bestTimeEnabled ? 'publishWorkflows.enabled' : 'publishWorkflows.disabled'),
                    })}</Text>
                    {managementKey ? <Text style={styles.muted}>{t(managementKey)}</Text> : null}
                </>
            )}
        </View>
    );
}

// No custom animation, including the inline detail view and loading state.
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 8 },
    content: { gap: 12, paddingBottom: VEY_CLEARANCE },
    section: { gap: 8 },
    card: { gap: 6, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    body: { color: colors.body, fontSize: 14 },
    muted: { color: colors.muted, fontSize: 13, paddingVertical: 2 },
    action: { minWidth: 44, paddingHorizontal: 8 },
    link: { color: colors.accent, textDecorationLine: 'underline' },
});

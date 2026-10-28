import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../../lib/i18n';
import { touchTarget } from '../../lib/a11y';
import { skillIcon, workflowIcon } from '../../lib/featureIcons';
import type { Skill } from '../../lib/studioSkills';
import { workflowSteps, type Workflow } from '../../lib/studioWorkflows';
import { ds, LIST_END_PADDING } from '../../theme';
import { Button, Card, IconBadge, Text, themedStyles, useThemedStyles } from '../ui';
import { useReducedMotion } from '../ui/useReducedMotion';

export function WorkflowDetails({ workflow, busy, onClose, onOpen, onStart }: { workflow: Workflow | null; busy: boolean; onClose: () => void; onOpen: (skill: Skill) => void; onStart: (workflow: Workflow) => void }) {
    const styles = useThemedStyles(sheets);
    const reducedMotion = useReducedMotion();
    const insets = useSafeAreaInsets();
    return <Modal visible={!!workflow} animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={onClose}>
        {workflow ? <View style={styles.screen}>
            <Button variant="tertiary" label={t('chatDepth.wfClose')} icon="close" containerStyle={styles.close} onPress={onClose} />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: LIST_END_PADDING + insets.bottom }]}>
                <IconBadge {...workflowIcon(workflow.id)} size="xl" />
                <Text variant="caption" tone="accent">{t('skillsUi.wfGuided')}</Text>
                <Text variant="title1" accessibilityRole="header">{workflow.name}</Text>
                <Text variant="callout" tone="secondary">{workflow.blurb}</Text>
                <Text variant="title3" accessibilityRole="header">{t('chatDepth.wfSteps', { count: workflowSteps(workflow).length })}</Text>
                <Text variant="caption" tone="secondary">{t('chatDepth.wfApprove')}</Text>
                {workflowSteps(workflow).map((skill, i) => <Card key={skill.id} style={styles.step}>
                    <View style={styles.number}><Text variant="caption">{i + 1}</Text></View>
                    <IconBadge {...skillIcon(skill.id, skill.group)} size="sm" />
                    <View style={styles.copy}><Text variant="callout">{skill.name}</Text><Text variant="caption" tone="tertiary">{skill.blurb}</Text></View>
                    <Button variant="secondary" size="sm" label={t('chatDepth.wfOpen')} accessibilityLabel={`${t('chatDepth.wfOpen')}: ${skill.name}`} disabled={busy} style={touchTarget} onPress={() => onOpen(skill)} />
                </Card>)}
                <Card style={styles.outcome}><Text variant="title3" accessibilityRole="header">{t('chatDepth.wfOutcome')}</Text><Text>{workflow.outcome}</Text></Card>
                <Button variant="primary" label={t('chatDepth.wfStart')} icon="arrowRight" disabled={busy} onPress={() => onStart(workflow)} />
                <Text variant="caption" tone="tertiary">{t('chatDepth.wfPriceNote')}</Text>
            </ScrollView>
        </View> : null}
    </Modal>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg }, close: { alignSelf: 'flex-end', margin: ds.space.sm },
    content: { padding: ds.space.lg, gap: ds.space.md }, outcome: { gap: ds.space.sm },
    step: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ds.space.sm }, copy: { flex: 1, minWidth: 100, gap: 4 },
    number: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: p.borderSubtle, alignItems: 'center', justifyContent: 'center' },
}));

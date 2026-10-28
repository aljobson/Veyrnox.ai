import { Modal, ScrollView, View } from 'react-native';
import { t } from '../../lib/i18n';
import { touchTarget } from '../../lib/a11y';
import type { Skill } from '../../lib/studioSkills';
import { workflowSteps, type Workflow } from '../../lib/studioWorkflows';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';

export function WorkflowDetails({ workflow, busy, onClose, onOpen, onStart }: { workflow: Workflow | null; busy: boolean; onClose: () => void; onOpen: (skill: Skill) => void; onStart: (workflow: Workflow) => void }) {
    const styles = useThemedStyles(sheets);
    return <Modal visible={!!workflow} animationType="none" presentationStyle="pageSheet" onRequestClose={onClose}>
        {workflow ? <View style={styles.screen}>
            <Button variant="tertiary" label={t('chatDepth.wfClose')} containerStyle={touchTarget} onPress={onClose} />
            <ScrollView keyboardShouldPersistTaps="handled">
                <Text variant="title2" accessibilityRole="header">{workflow.name}</Text>
                <Text variant="bodyStrong">{t('chatDepth.wfOutcome')}</Text><Text>{workflow.outcome}</Text>
                {workflowSteps(workflow).map((skill, i) => <View key={skill.id} style={styles.step}>
                    <Text>{i + 1}. {skill.name}</Text>
                    <Button variant="secondary" label={t('chatDepth.wfOpen')} accessibilityLabel={`${t('chatDepth.wfOpen')}: ${skill.name}`} disabled={busy} containerStyle={touchTarget} onPress={() => onOpen(skill)} />
                </View>)}
                <Text>{t('chatDepth.wfApprove')}</Text><Text>{t('chatDepth.wfPriceNote')}</Text>
                <Button variant="primary" label={t('chatDepth.wfStart')} disabled={busy} containerStyle={touchTarget} onPress={() => onStart(workflow)} />
            </ScrollView>
        </View> : null}
    </Modal>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, padding: 20, backgroundColor: p.bg }, step: { marginVertical: 12, gap: 8 } }));

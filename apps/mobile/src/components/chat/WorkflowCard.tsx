import { rawText } from '../../lib/i18n/translate';
import { View } from 'react-native';
import { t } from '../../lib/i18n';
import { skillIcon, workflowIcon } from '../../lib/featureIcons';
import { workflowSteps, type Workflow } from '../../lib/studioWorkflows';
import { Card, Icon, IconBadge, Text, themedStyles, useThemedStyles } from '../ui';

export function WorkflowCard({ workflow, disabled, onPress }: { workflow: Workflow; disabled: boolean; onPress: () => void }) {
    const styles = useThemedStyles(sheets);
    const steps = workflowSteps(workflow);
    return <Card onPress={onPress} disabled={disabled} accessibilityState={{ disabled }}
        accessibilityLabel={rawText(`${t('chatDepth.wfView')}: ${workflow.name}`)} style={styles.card}>
        <View style={styles.row}>
            <IconBadge {...workflowIcon(workflow.id)} size="lg" />
            <View style={styles.copy}><Text variant="bodyStrong">{workflow.name}</Text>
                <Text variant="caption" tone="secondary">{t('chatDepth.wfSteps', { count: steps.length })}</Text></View>
        </View>
        <Text variant="callout" tone="secondary">{workflow.blurb}</Text>
        <View style={styles.icons}>{steps.map((skill, i) => <View key={skill.id} style={i ? styles.overlap : undefined}>
            <IconBadge {...skillIcon(skill.id, skill.group)} size="sm" />
        </View>)}</View>
        <View style={styles.row}><Text variant="callout">{t('chatDepth.wfView')}</Text><Icon name="arrowRight" size={20} /></View>
    </Card>;
}
const sheets = themedStyles(() => ({
    card: { gap: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    copy: { flex: 1, gap: 4 }, icons: { flexDirection: 'row' }, overlap: { marginLeft: -8 },
}));

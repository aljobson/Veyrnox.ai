import { Pressable } from 'react-native';
import { t } from '../../lib/i18n';
import { skillIcon } from '../../lib/featureIcons';
import type { Skill } from '../../lib/studioSkills';
import { Card, Checkbox, IconBadge, Text, themedStyles, useThemedStyles } from '../ui';

export function SkillCard({ skill, selected, disabled = false, onPress, select }: {
    skill: Skill; selected: boolean; disabled?: boolean; onPress: () => void;
    select?: { onToggle(): void; disabled: boolean };
}) {
    const styles = useThemedStyles(sheets);
    return <Card selected={selected} style={styles.card}>
        <Pressable style={styles.body} accessibilityRole="button" accessibilityLabel={`${skill.name}. ${skill.blurb}`}
            accessibilityState={{ selected: select ? undefined : selected, disabled }} disabled={disabled}
            onPress={() => { if (!disabled) onPress(); }}>
            <IconBadge {...skillIcon(skill.id, skill.group)} />
            <Text variant="callout" numberOfLines={2}>{skill.name}</Text>
            <Text variant="caption" tone="tertiary" numberOfLines={3}>{skill.blurb}</Text>
        </Pressable>
        {select ? <Checkbox checked={selected} disabled={select.disabled}
            accessibilityLabel={t('skillsUi.selectSkill', { name: skill.name })}
            accessibilityState={{ checked: selected, disabled: select.disabled }}
            onChange={() => { if (!select.disabled) select.onToggle(); }}>
            <Text variant="caption">{t('skillsUi.select')}</Text>
        </Checkbox> : null}
    </Card>;
}
const sheets = themedStyles(() => ({
    card: { flex: 1, minHeight: 96, padding: 13, gap: 8 },
    body: { flex: 1, minHeight: 44, gap: 5 },
}));

import { SkillCard } from './SkillCard';
import { displayLabel } from '../../lib/displayLabels';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { SKILL_GROUPS, SKILLS, MAX_SELECTED_SKILLS, type Skill } from '../../lib/studioSkills';
import { t } from '../../lib/i18n';
import { Button, Icon, Text, themedStyles, useThemedStyles } from '../ui';

export function ConversationEmpty({ selectedIds = [], lockedIds = [], saving = false, onToggle, applyStarter }: { selectedIds?: readonly string[]; lockedIds?: readonly string[]; saving?: boolean; onToggle?: (skill: Skill) => Promise<void>; skillNote?: string | null; applyStarter?: (skill: Skill) => Promise<void> }) {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    return (
        <View style={styles.empty}>
            <Text variant="display" style={styles.hero}>{t('chat.workspace.title')}</Text>
            <Text variant="footnote" style={styles.heroHelp}>{t('chat.workspace.priceHelp')}</Text>
            <View style={styles.skillsBlock}>
                <Text variant="caption" style={styles.eyebrow}>{t('chat.workspace.skillsEyebrow')}</Text>
                <Text variant="callout" style={styles.skillsHelp}>{t('chat.workspace.skillsHelp')}</Text>
                <Text variant="caption">{t('chatDepth.selected', { count: selectedIds.length, max: MAX_SELECTED_SKILLS })}</Text>
                {SKILL_GROUPS.filter((group) => group !== 'Film').map((group) => (
                    <View key={displayLabel(group)} style={styles.skillGroup}>
                        <Text variant="footnote" accessibilityRole="header" style={styles.skillGroupLabel}>{displayLabel(group)}</Text>
                        <View style={styles.skillGrid}>
                            {SKILLS.filter((skill) => skill.group === group).map((skill) => {
                                const selected = selectedIds.includes(skill.id);
                                return (
                                    <View key={skill.id} style={styles.starter}>
                                        <SkillCard skill={skill} selected={selected}
                                            disabled={saving || lockedIds.includes(skill.id) || (!selected && selectedIds.length >= MAX_SELECTED_SKILLS)}
                                            onPress={() => { if (!lockedIds.includes(skill.id)) void (onToggle ?? applyStarter)?.(skill); }} />
                                    </View>
                                );
                            })}
                        </View>
                    </View>
                ))}
                <Button accessibilityRole="button" containerStyle={styles.filmLink} onPress={() => router.push('/film')} variant="tertiary" size="md" label={t('chat.openFilmStudio')}>
                    <Text variant="footnote" style={styles.filmLinkText}>{t('chat.openFilmStudio')}</Text><Icon name="arrowRight" size={20} />
                </Button>
            </View>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    empty: { paddingTop: 24, paddingBottom: 20 },
    hero: { color: p.textPrimary, textAlign: 'center' },
    heroHelp: { color: p.textTertiary, textAlign: 'center', marginTop: 10, paddingHorizontal: 18 },
    skillsBlock: { marginTop: 28 },
    eyebrow: { color: p.accent },
    skillsHelp: { color: p.textSecondary, marginTop: 4, marginBottom: 18 },
    skillGroup: { marginBottom: 18 },
    skillGroupLabel: { color: p.textPrimary, marginBottom: 8 },
    skillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    starter: { width: '48.7%', minHeight: 108 },
    filmLink: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
    filmLinkText: { color: p.textPrimary },
}));

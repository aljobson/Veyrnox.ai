import { displayLabel } from '../../lib/displayLabels';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { SKILL_GROUPS, SKILLS, type Skill } from '../../lib/studioSkills';
import { t } from '../../lib/i18n';
import { Button, Card, Icon, Text, themedStyles, useThemedStyles } from '../ui';

export function ConversationEmpty({ skillNote, applyStarter }: { skillNote: string | null; applyStarter: (skill: Skill) => Promise<void> }) {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    return (
        <View style={styles.empty}>
            <Text variant="display" style={styles.hero}>{t('chat.workspace.title')}</Text>
            <Text variant="footnote" style={styles.heroHelp}>{t('chat.workspace.priceHelp')}</Text>
            <View style={styles.skillsBlock}>
                <Text variant="caption" style={styles.eyebrow}>{t('chat.workspace.skillsEyebrow')}</Text>
                <Text variant="callout" style={styles.skillsHelp}>{t('chat.workspace.skillsHelp')}</Text>
                {SKILL_GROUPS.filter((group) => group !== 'Film').map((group) => (
                    <View key={displayLabel(group)} style={styles.skillGroup}>
                        <Text variant="footnote" style={styles.skillGroupLabel}>{displayLabel(group)}</Text>
                        <View style={styles.skillGrid}>
                            {SKILLS.filter((skill) => skill.group === group).map((skill) => {
                                const selected = skillNote === skill.name;
                                return (
                                    <Card
                                        key={skill.id}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${skill.name}. ${skill.blurb}`}
                                        accessibilityState={{ selected }}
                                        selected={selected}
                                        style={[styles.starter]}
                                        onPress={() => void applyStarter(skill)}
                                    >
                                        <Text variant="callout" style={styles.starterName}>{skill.name}</Text>
                                        <Text variant="caption" style={styles.starterBlurb}>{skill.blurb}</Text>
                                    </Card>
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
    starter: { width: '48.7%', minHeight: 108, padding: 13, gap: 5 },
    starterName: { color: p.textPrimary },
    starterBlurb: { color: p.textTertiary },
    filmLink: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
    filmLinkText: { color: p.textPrimary },
}));

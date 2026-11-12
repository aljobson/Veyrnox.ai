import { Pressable, View } from 'react-native';
import { FIRST_GOALS, type FirstGoal } from '../../lib/firstGoal';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';

// Literal keys, so the translation tooling can see every string this card uses.
const LABEL: Record<FirstGoal, () => string> = {
    image: () => t('create.firstGoal.image'),
    video: () => t('create.firstGoal.video'),
    audio: () => t('create.firstGoal.audio'),
    edit: () => t('create.firstGoal.edit'),
    publish: () => t('create.firstGoal.publish'),
    unsure: () => t('create.firstGoal.unsure'),
};

interface FirstGoalCardProps {
    readonly onChoose: (goal: FirstGoal) => void;
    readonly onSkip: () => void;
}

// One question, once per phone, skippable: "What do you want to make first?". Creation goals open the starter form with
// an example prompt filled in; Edit and Publish go to their tab; "Not sure" and Skip reveal the usual goal list.
export function FirstGoalCard({ onChoose, onSkip }: FirstGoalCardProps) {
    const styles = useThemedStyles(sheets);
    return (
        <Card style={styles.card}>
            <Text variant="title2" tone="primary" accessibilityRole="header">{t('create.firstGoal.title')}</Text>
            <View style={styles.choices}>
                {FIRST_GOALS.map((goal) => (
                    <Pressable key={goal} accessibilityRole="button" accessibilityLabel={LABEL[goal]()} onPress={() => onChoose(goal)}
                        style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
                        <Text variant="bodyStrong" tone="primary">{LABEL[goal]()}</Text>
                    </Pressable>
                ))}
            </View>
            <Button variant="tertiary" label={t('create.firstGoal.skip')} onPress={onSkip} />
        </Card>
    );
}

const sheets = themedStyles((p) => ({
    card: { gap: ds.space.md },
    choices: { gap: ds.space.sm },
    choice: { minHeight: 52, justifyContent: 'center', paddingHorizontal: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1 },
    pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
}));

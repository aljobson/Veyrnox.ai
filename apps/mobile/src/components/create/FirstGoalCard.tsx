import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { FIRST_GOALS, FIRST_GOAL_EXAMPLES, type FirstGoal } from '../../lib/firstGoal';
import { t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { ds } from '../../theme';
import { Button, Card, Text, themedStyles, usePressStyle, useThemedStyles } from '../ui';

// Literal keys, so the translation tooling can see every string this card uses.
const LABEL: Record<FirstGoal, () => string> = {
    image: () => t('create.firstGoal.image'),
    video: () => t('create.firstGoal.video'),
    audio: () => t('create.firstGoal.audio'),
    edit: () => t('create.firstGoal.edit'),
    publish: () => t('create.firstGoal.publish'),
    unsure: () => t('create.firstGoal.unsure'),
};

// The example prompt a creation goal opens the form with. Literal keys, so the translation tooling sees them.
export const EXAMPLE: Record<'image' | 'video' | 'audio', () => string> = {
    image: () => t('create.firstGoal.example.image'),
    video: () => t('create.firstGoal.example.video'),
    audio: () => t('create.firstGoal.example.audio'),
};

interface FirstGoalCardProps {
    readonly onChoose: (goal: FirstGoal) => void;
    readonly onSkip: () => void;
}

// One question, once per phone, skippable: "What do you want to make first?". Creation goals open the starter form with
// an example prompt filled in; Edit and Publish go to their tab; "Not sure" lists one example per area; Skip reveals the usual goal list.
export function FirstGoalCard({ onChoose, onSkip }: FirstGoalCardProps) {
    const styles = useThemedStyles(sheets);
    const pressStyle = usePressStyle();
    // "Not sure yet" stays inside the card and lists one example per creation area; nothing is stored until one is picked.
    const [view, setView] = useState<'ask' | 'examples'>('ask');
    if (view === 'examples') {
        return (
            <Card style={styles.card}>
                <Text variant="title2" tone="primary" accessibilityRole="header">{t('create.firstGoal.title')}</Text>
                <View style={styles.choices}>
                    {FIRST_GOAL_EXAMPLES.map((goal) => (
                        <Pressable key={goal} accessibilityRole="button" accessibilityLabel={rawText(`${LABEL[goal]()}. ${EXAMPLE[goal]()}`)} onPress={() => onChoose(goal)}
                            style={({ pressed }) => [styles.example, pressed && pressStyle]}>
                            <Text variant="bodyStrong" tone="primary">{LABEL[goal]()}</Text>
                            <Text variant="footnote" tone="secondary">{EXAMPLE[goal]()}</Text>
                        </Pressable>
                    ))}
                </View>
                <Button variant="tertiary" label={t('create.firstGoal.skip')} onPress={onSkip} />
            </Card>
        );
    }
    return (
        <Card style={styles.card}>
            <Text variant="title2" tone="primary" accessibilityRole="header">{t('create.firstGoal.title')}</Text>
            <View style={styles.choices}>
                {FIRST_GOALS.map((goal) => (
                    <Pressable key={goal} accessibilityRole="button" accessibilityLabel={LABEL[goal]()} onPress={() => (goal === 'unsure' ? setView('examples') : onChoose(goal))}
                        style={({ pressed }) => [styles.choice, pressed && pressStyle]}>
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
    example: { minHeight: 64, justifyContent: 'center', gap: ds.space.xs, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1 },
}));

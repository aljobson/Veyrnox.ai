import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE } from '../../lib/api';
import type { ChatModel } from '../../lib/chat';
import { copyText } from '../../lib/clipboard';
import { skillIcon } from '../../lib/featureIcons';
import { plural, t } from '../../lib/i18n';
import { MAX_SELECTED_SKILLS, skillOverview, type Skill } from '../../lib/studioSkills';
import { ds, LIST_END_PADDING } from '../../theme';
import { Button, Card, IconBadge, Text, themedStyles, useThemedStyles } from '../ui';
import { useReducedMotion } from '../ui/useReducedMotion';
import { useAnnouncement } from '../../lib/useAnnouncement';

export function SkillDetails({ skill, chosen, count, busy, model, onClose, onUse, onToggle }: {
    skill: Skill | null; chosen: boolean; count: number; busy: boolean; model?: ChatModel;
    onClose(): void; onUse(skill: Skill): void; onToggle(skill: Skill): void;
}) {
    const styles = useThemedStyles(sheets);
    const reducedMotion = useReducedMotion();
    const insets = useSafeAreaInsets();
    const [copied, setCopied] = useState(false);
    // iOS ignores live regions; announce the selection count and the copy result (announcementsIos rule).
    useAnnouncement(skill ? t('chatDepth.selected', { count, max: MAX_SELECTED_SKILLS }) : null);
    useAnnouncement(copied ? t('skillsUi.copied') : null);
    const generation = useRef(0);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        generation.current++;
        setCopied(false);
        return () => { generation.current++; if (timer.current) clearTimeout(timer.current); };
    }, [skill?.id]);
    async function copyLink(value: Skill) {
        const version = generation.current;
        const message = `${API_BASE}/app/skills?skill=${encodeURIComponent(value.id)}`;
        const success = await copyText(message);
        if (version !== generation.current) return;
        if (success) {
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
        } else { await Share.share({ message }).catch(() => undefined); }
    }
    const overview = skill ? skillOverview(skill) : null;
    const atLimit = !chosen && count >= MAX_SELECTED_SKILLS;
    return <Modal visible={!!skill} presentationStyle="pageSheet" animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose}>
        {skill && overview ? <View style={styles.screen} onAccessibilityEscape={onClose}>
            <Button variant="tertiary" label={t('common.close')} icon="close" onPress={onClose} containerStyle={styles.close} />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: LIST_END_PADDING + insets.bottom }]}>
                <IconBadge {...skillIcon(skill.id, skill.group)} size="xl" />
                <Text variant="caption" tone="accent">{t('chat.skills.title')}</Text>
                <Text variant="title1" accessibilityRole="header">{skill.name}</Text>
                <Text variant="callout" tone="secondary">{skill.blurb}</Text>
                <Text variant="title3" accessibilityRole="header">{t('skillsUi.bestFor')}</Text><Text>{t(overview.bestForKey)}</Text>
                <Text variant="title3" accessibilityRole="header">{t('skillsUi.output')}</Text><Text>{t(overview.outputKey)}</Text>
                <Card style={styles.how}>
                    <Text variant="title3" accessibilityRole="header">{t('skillsUi.how')}</Text>
                    {[skill.starter, ...overview.howTo.map(key => t(key))].map((step, i) => <View key={i} style={styles.step}>
                        <View style={styles.number}><Text variant="caption">{i + 1}</Text></View><Text style={styles.copy}>{step}</Text>
                    </View>)}
                </Card>
                <Button label={t('skillsUi.use')} icon="arrowRight" disabled={busy || !model} onPress={() => onUse(skill)} />
                <View>
                    <Button variant="secondary" label={t(chosen ? 'skillsUi.removeFromSelection' : 'skillsUi.addToSelection')}
                        disabled={busy || !model || atLimit} onPress={() => onToggle(skill)} />
                    <Text variant="caption">{t('chatDepth.selected', { count, max: MAX_SELECTED_SKILLS })}</Text>
                </View>
                {atLimit ? <Text variant="caption">{t('skillsUi.limit', { max: MAX_SELECTED_SKILLS })}</Text> : null}
                <Button variant="tertiary" label={t(copied ? 'skillsUi.copied' : 'skillsUi.copyLink')} onPress={() => void copyLink(skill)}><Text>{t(copied ? 'skillsUi.copied' : 'skillsUi.copyLink')}</Text></Button>
                {model ? <Text variant="caption" tone="tertiary">{plural('chat.creditsPerReply', model.credits_per_reply)}{' · '}{t('skillsUi.generationSeparate')}</Text> : null}
            </ScrollView>
        </View> : null}
    </Modal>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg }, close: { alignSelf: 'flex-end', margin: ds.space.sm },
    content: { padding: ds.space.lg, gap: ds.space.md }, how: { gap: ds.space.md },
    step: { flexDirection: 'row', alignItems: 'flex-start', gap: ds.space.md }, copy: { flex: 1 },
    number: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: p.borderSubtle, alignItems: 'center', justifyContent: 'center' },
}));
